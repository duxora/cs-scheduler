"""Main orchestrator — ties parser, executor, retry, remediation, and DB together."""
from pathlib import Path
from .models import Task
from .parser import find_tasks
from .db import Database
from .retry import run_with_retry
from .notify import notify_error, notify_success, notify_ticket
from .remediate import remediate_error
from claude_scheduler.console import console

ROOT_DIR = Path(__file__).parent.parent

class Orchestrator:
    def __init__(self, tasks_dir: Path, logs_dir: Path, db: Database):
        self.tasks_dir = tasks_dir
        self.logs_dir = logs_dir
        self.db = db

    def find_tasks(self, schedule_type: str = "all") -> list[Task]:
        tasks = find_tasks(self.tasks_dir)
        # Always exclude disabled tasks regardless of schedule_type
        tasks = [t for t in tasks if t.enabled]
        if schedule_type != "all":
            tasks = [t for t in tasks if t.schedule.startswith(schedule_type)]
        return tasks

    def _check_budget(self, task: Task) -> bool:
        """Return False and notify if task has exceeded its monthly budget."""
        if not task.budget_usd:
            return True
        rows = self.db.execute(
            "SELECT COALESCE(SUM(cost_usd), 0) FROM task_runs"
            " WHERE task_name=? AND started_at > datetime('now', '-30 days')",
            (task.name,)).fetchone()
        spent = rows[0]
        if spent >= task.budget_usd:
            notify_error(
                task.name,
                f"Monthly budget ${task.budget_usd} exceeded (spent ${spent:.2f})",
                db=self.db)
            return False
        return True

    def run_single(self, task: Task):
        if not self._check_budget(task):
            return

        result = run_with_retry(task, self.logs_dir, db=self.db)
        status = result["status"]
        attempt = result.get("attempt", 1)
        session_id = result.get("session_id", "")

        run_id = self.db.start_run(
            task.name, str(task.file_path), result.get("log_file", ""),
            attempt=attempt, session_id=session_id)
        if result.get("account_id"):
            self.db.execute(
                "UPDATE task_runs SET account_id=? WHERE id=?",
                (result["account_id"], run_id))
            self.db.conn.commit()
        if result.get("structured_output"):
            self.db.set_run_structured_output(run_id, result["structured_output"])
        self.db.complete_run(
            run_id, status,
            exit_code=result.get("exit_code"),
            error_message=result.get("error_message", ""))

        # Store cost data if available from executor
        if "cost_usd" in result:
            self.db.set_run_cost(
                run_id,
                result.get("input_tokens", 0),
                result.get("output_tokens", 0),
                result.get("cost_usd", 0.0))

        db_status = "failed" if status in ("failed", "timeout") else status
        self.db.update_task_state(task.name, db_status)

        if status == "success":
            if task.notify == "all":
                notify_success(task.name)
            return

        # --- Failure path ---
        stderr = result.get("stderr", "")
        error_msg = result.get("error_message", f"Task failed: {status}")

        error_type = "timeout" if status == "timeout" else "exit_code"
        err_id = self.db.record_error(
            task.name, run_id, error_type, error_msg, stderr)

        if task.notify in ("errors", "all"):
            notify_error(task.name, error_msg, attempt)

        if task.on_failure == "investigate":
            state = self.db.get_task_state(task.name)
            consec = state["consecutive_failures"] if state else 1

            rem_result = remediate_error(
                task=task,
                error_message=error_msg,
                stderr_output=stderr,
                attempt=attempt,
                consecutive_failures=consec,
                session_id=session_id,
                logs_dir=self.logs_dir,
            )

            if rem_result["success"]:
                verify = run_with_retry(task, self.logs_dir, db=self.db)
                if verify["status"] == "success":
                    self.db.update_task_state(task.name, "success")
                    notify_success(task.name)
                    return

            ticket_id = self.db.create_ticket(
                task.name, err_id, rem_result.get("output", ""),
                run_session_id=session_id,
                remediation_session_id=rem_result.get("session_id", ""))
            notify_ticket(task.name, ticket_id)

    def _rotate_logs(self, max_age_days: int = 30):
        """Delete log files older than max_age_days."""
        import time
        cutoff = time.time() - (max_age_days * 86400)
        for f in self.logs_dir.glob("*.json"):
            if f.stat().st_mtime < cutoff:
                f.unlink()

    def _resolve_execution_order(self, tasks: list[Task]) -> list[Task]:
        completed = {s["task_name"] for s in self.db.get_all_task_states()
                     if s.get("last_status") == "success"}
        ready = []
        for task in tasks:
            if not task.depends_on:
                ready.append(task)
            elif task.depends_on in completed:
                ready.append(task)
            else:
                console.print(f"[dim]Skipping {task.name}: waiting on {task.depends_on}[/dim]")
        return ready

    def run_schedule(self, schedule_type: str = "all"):
        self._rotate_logs()
        self.db.recover_stale_runs()

        tasks = self.find_tasks(schedule_type)
        tasks = self._resolve_execution_order(tasks)
        results = {"total": len(tasks), "success": 0, "failed": 0}
        for task in tasks:
            try:
                self.run_single(task)
                state = self.db.get_task_state(task.name)
                if state and state["last_status"] == "success":
                    results["success"] += 1
                else:
                    results["failed"] += 1
            except Exception as e:
                results["failed"] += 1
                console.print(f"[red]Error running {task.name}: {e}[/red]")
        return results

    def remediate_ticket(self, ticket_id: int, guidance: str = ""):
        ticket = self.db.get_ticket(ticket_id)
        self.db.update_ticket(ticket_id, status="investigating",
                              user_guidance=guidance)

        tasks = find_tasks(self.tasks_dir)
        task = next((t for t in tasks if t.name == ticket.task_name), None)
        if not task:
            self.db.update_ticket(ticket_id, status="closed",
                                  resolution=f"Task '{ticket.task_name}' not found")
            return

        errors = self.db.get_errors(ticket.task_name)
        err = errors[0] if errors else None

        resume_id = (ticket.remediation_session_id
                     or ticket.run_session_id or "")

        result = remediate_error(
            task=task,
            error_message=err.error_message if err else "unknown",
            stderr_output=err.stderr_output if err else "",
            user_guidance=guidance,
            session_id=resume_id,
            logs_dir=self.logs_dir,
        )

        if result["success"]:
            self.db.update_ticket(ticket_id, status="resolved",
                                  resolution=result["output"][:500])
            notify_success(f"{task.name} (remediated)")
        else:
            self.db.update_ticket(ticket_id, status="open",
                                  investigation=result["output"][:500],
                                  remediation_session_id=result.get("session_id", ""))
            notify_ticket(task.name, ticket_id)
