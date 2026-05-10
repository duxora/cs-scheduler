"""Scheduler web routes — dashboard, history, errors, tickets, and task management."""
import hashlib
import os
import shutil
import sqlite3
import subprocess
import sys
from pathlib import Path

from fastapi import APIRouter, Form, HTTPException, Query, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from jinja2 import ChoiceLoader, FileSystemLoader
from pydantic import BaseModel, Field

from server.config import TASKS_DIR, LOGS_DIR, DATA_DIR

from claude_scheduler.core.db import Database
from claude_scheduler.core.parser import find_tasks
from claude_scheduler.core.secrets import validate_secret_ref

router = APIRouter()
SERVER_TEMPLATES = Path(__file__).parent.parent.parent / "server" / "templates"
APP_TEMPLATES = Path(__file__).parent / "templates"
_loader = ChoiceLoader([
    FileSystemLoader(str(APP_TEMPLATES)),
    FileSystemLoader(str(SERVER_TEMPLATES)),
])
templates = Jinja2Templates(directory=str(APP_TEMPLATES))
templates.env.loader = _loader

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def get_db() -> Database:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    return Database(DATA_DIR / "scheduler.db")


def app_context(request: Request, **kwargs):
    """Build template context with sidebar navigation data."""
    from server.main import APPS
    return {"request": request, "apps": APPS, **kwargs}


def _slug(name: str) -> str:
    return name.lower().replace(" ", "-").strip("-")


def _find_task_by_slug(slug: str):
    """Return (Task, error_string) — one of them is always None."""
    tasks = find_tasks(TASKS_DIR)
    for t in tasks:
        if t.slug == slug:
            return t, None
    return None, f"Task '{slug}' not found"


def _normalized_config_dir(config_dir: str | None) -> str | None:
    if not config_dir:
        return None
    try:
        return str(Path(config_dir).expanduser().resolve())
    except (OSError, RuntimeError, ValueError):
        return None


def _has_claude_credentials(config_dir: Path) -> bool:
    cred_file = config_dir / ".credentials.json"
    if cred_file.is_file():
        return True

    if sys.platform != "darwin":
        return False

    abs_path = config_dir.resolve()
    home_claude = os.path.expanduser("~/.claude")
    if str(abs_path) == home_claude:
        service = "Claude Code-credentials"
    else:
        service = f"Claude Code-credentials-{hashlib.sha256(str(abs_path).encode()).hexdigest()[:8]}"

    try:
        result = subprocess.run(
            ["security", "find-generic-password", "-s", service],
            capture_output=True,
            timeout=5,
        )
        return result.returncode == 0
    except (OSError, subprocess.TimeoutExpired, FileNotFoundError):
        return False


# ---------------------------------------------------------------------------
# Pages
# ---------------------------------------------------------------------------

@router.get("/", response_class=HTMLResponse)
async def dashboard(request: Request):
    db = get_db()
    try:
        tasks = find_tasks(TASKS_DIR)
        states = db.get_all_task_states()
        states_map = {s["task_name"]: s for s in states}
        runs = db.get_run_history(limit=100)
        total_cost = sum(r.cost_usd for r in runs)
        stats = {
            "total_tasks": len(tasks),
            "enabled": sum(1 for t in tasks if t.enabled),
            "disabled": sum(1 for t in tasks if not t.enabled),
            "total_runs": len(runs),
            "successes": sum(1 for r in runs if r.status == "success"),
            "failures": sum(1 for r in runs if r.status in ("failed", "timeout")),
            "total_cost": total_cost,
        }
        return templates.TemplateResponse("dashboard.html", app_context(
            request, tasks=tasks, states=states_map, stats=stats,
        ))
    finally:
        db.close()


@router.get("/partials/status-table", response_class=HTMLResponse)
async def status_table_partial(request: Request):
    """HTMX partial — returns just the task status table rows for live refresh."""
    db = get_db()
    try:
        tasks = find_tasks(TASKS_DIR)
        states = db.get_all_task_states()
        states_map = {s["task_name"]: s for s in states}
        return templates.TemplateResponse("partials/status_table.html", app_context(
            request, tasks=tasks, states=states_map,
        ))
    finally:
        db.close()


@router.get("/history", response_class=HTMLResponse)
async def history(
    request: Request,
    task: str = Query(default=None),
    n: int = Query(default=50),
):
    db = get_db()
    try:
        runs = db.get_run_history(task_name=task, limit=n)
        return templates.TemplateResponse("history.html", app_context(
            request, runs=runs, filter_task=task, limit=n,
        ))
    finally:
        db.close()


@router.get("/errors", response_class=HTMLResponse)
async def errors(
    request: Request,
    task: str = Query(default=None),
):
    db = get_db()
    try:
        errs = db.get_errors(task_name=task)
        return templates.TemplateResponse("errors.html", app_context(
            request, errors=errs, filter_task=task,
        ))
    finally:
        db.close()


@router.get("/tickets", response_class=HTMLResponse)
async def tickets(
    request: Request,
    status: str = Query(default=None),
):
    db = get_db()
    try:
        items = db.get_tickets(status=status)
        return templates.TemplateResponse("tickets.html", app_context(
            request, tickets=items, filter_status=status,
        ))
    finally:
        db.close()


@router.get("/notifications", response_class=HTMLResponse)
async def notifications(
    request: Request,
    all: str = Query(default=None),
):
    db = get_db()
    try:
        show_all = all == "true"
        items = db.get_notifications(unread_only=not show_all)
        return templates.TemplateResponse("notifications.html", app_context(
            request, notifications=items, show_all=show_all,
        ))
    finally:
        db.close()


@router.get("/doctor", response_class=HTMLResponse)
async def doctor(request: Request):
    checks = []

    # 1. Claude CLI available
    try:
        result = subprocess.run(
            ["claude", "--version"], capture_output=True, text=True, timeout=5,
        )
        checks.append({
            "name": "Claude CLI",
            "ok": result.returncode == 0,
            "detail": result.stdout.strip() if result.returncode == 0 else result.stderr.strip(),
        })
    except Exception as e:
        checks.append({"name": "Claude CLI", "ok": False, "detail": str(e)})

    # 2. Task count
    tasks = find_tasks(TASKS_DIR)
    checks.append({
        "name": "Task files",
        "ok": len(tasks) > 0,
        "detail": f"{len(tasks)} task(s) found in {TASKS_DIR}",
    })

    # 3. Stale runs
    db = get_db()
    try:
        stale = db.recover_stale_runs(max_age_seconds=3600)
        checks.append({
            "name": "Stale runs",
            "ok": len(stale) == 0,
            "detail": f"{len(stale)} stale run(s) recovered" if stale else "No stale runs",
        })

        # 4. Open tickets
        open_tickets = db.get_tickets(status="open")
        checks.append({
            "name": "Open tickets",
            "ok": len(open_tickets) == 0,
            "detail": f"{len(open_tickets)} open ticket(s)" if open_tickets else "No open tickets",
        })
    finally:
        db.close()

    # 5. Disk space
    usage = shutil.disk_usage("/")
    free_gb = usage.free / (1024 ** 3)
    checks.append({
        "name": "Disk space",
        "ok": free_gb > 1.0,
        "detail": f"{free_gb:.1f} GB free",
    })

    return templates.TemplateResponse("doctor.html", app_context(
        request, checks=checks,
    ))


@router.get("/tasks/{slug}", response_class=HTMLResponse)
async def task_detail(request: Request, slug: str):
    task, err = _find_task_by_slug(slug)
    if err:
        return HTMLResponse(f"<h1>404</h1><p>{err}</p>", status_code=404)

    db = get_db()
    try:
        runs = db.get_run_history(task_name=task.name, limit=20)
        errs = db.get_errors(task_name=task.name, limit=10)
        state = db.get_task_state(task.name)
        return templates.TemplateResponse("task_detail.html", app_context(
            request, task=task, runs=runs, errors=errs, state=state,
        ))
    finally:
        db.close()


@router.get("/tasks-new", response_class=HTMLResponse)
async def tasks_new_form(request: Request):
    return templates.TemplateResponse("task_new.html", app_context(request))


@router.get("/logs/{slug}", response_class=HTMLResponse)
async def view_log(request: Request, slug: str):
    task, err = _find_task_by_slug(slug)
    if err:
        return HTMLResponse(f"<h1>404</h1><p>{err}</p>", status_code=404)

    # Find most recent log file matching the task slug
    log_content = ""
    log_file = None
    if LOGS_DIR.exists():
        candidates = sorted(LOGS_DIR.glob(f"{slug}*"), key=lambda p: p.stat().st_mtime, reverse=True)
        if candidates:
            log_file = candidates[0]
            raw = log_file.read_text(errors="replace")
            # Show last 5000 chars
            log_content = raw[-5000:] if len(raw) > 5000 else raw

    return templates.TemplateResponse("log_view.html", app_context(
        request, task=task, log_content=log_content,
        log_file=str(log_file) if log_file else None,
    ))


@router.get("/approvals", response_class=HTMLResponse)
async def approvals(request: Request):
    db = get_db()
    try:
        pending = db.get_pending_approvals()
        # Enrich with artifact content
        for item in pending:
            artifact = db.get_artifact(item["artifact_id"])
            item["artifact"] = artifact
        return templates.TemplateResponse("approvals.html", app_context(
            request, approvals=pending,
        ))
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Actions (POST — redirect via 303)
# ---------------------------------------------------------------------------

@router.post("/api/run/{slug}", response_class=HTMLResponse)
async def run_task(slug: str):
    task, err = _find_task_by_slug(slug)
    if err:
        return HTMLResponse(
            '<span class="text-red-400">Task not found</span>',
            status_code=404,
        )

    db = get_db()
    try:
        from claude_scheduler.core.orchestrator import Orchestrator
        orch = Orchestrator(tasks_dir=TASKS_DIR, logs_dir=LOGS_DIR, db=db)
        orch.run_single(task)
        state = db.get_task_state(task.name)
        status = state["last_status"] if state else "unknown"
        color = "green" if status == "success" else "red"
        return HTMLResponse(
            f'<span class="text-{color}-400 font-medium">{status}</span>'
        )
    except Exception as e:
        return HTMLResponse(
            f'<span class="text-red-400">Error: {e}</span>',
            status_code=500,
        )
    finally:
        db.close()


@router.post("/api/toggle/{slug}")
async def toggle_task(slug: str):
    task, err = _find_task_by_slug(slug)
    if err:
        return RedirectResponse(url="/scheduler/", status_code=303)

    # Toggle enabled flag in .task file
    content = task.file_path.read_text()
    if task.enabled:
        content = content.replace("# enabled: true", "# enabled: false", 1)
        if "# enabled:" not in content:
            # Insert enabled: false after the schedule line
            content = content.replace(
                f"# schedule: {task.schedule}",
                f"# schedule: {task.schedule}\n# enabled: false",
                1,
            )
    else:
        content = content.replace("# enabled: false", "# enabled: true", 1)

    task.file_path.write_text(content)
    return RedirectResponse(url="/scheduler/", status_code=303)


@router.post("/api/tickets/{ticket_id}/approve")
async def resolve_ticket(ticket_id: int):
    db = get_db()
    try:
        db.update_ticket(ticket_id, status="resolved")
    finally:
        db.close()
    return RedirectResponse(url="/scheduler/tickets", status_code=303)


@router.post("/api/notifications/mark-read")
async def mark_notifications_read():
    db = get_db()
    try:
        db.mark_notifications_read()
    finally:
        db.close()
    return RedirectResponse(url="/scheduler/notifications", status_code=303)


@router.post("/api/delete/{slug}")
async def delete_task(slug: str):
    task, err = _find_task_by_slug(slug)
    if err:
        return RedirectResponse(url="/scheduler/", status_code=303)
    task.file_path.unlink()
    return RedirectResponse(url="/scheduler/", status_code=303)


@router.post("/tasks-new")
async def create_task(
    request: Request,
    name: str = Form(...),
    schedule: str = Form(...),
    prompt: str = Form(...),
    kind: str = Form(default="default"),
    model: str = Form(default="claude-sonnet-4-6"),
    max_turns: int = Form(default=10),
    timeout: int = Form(default=300),
    tools: str = Form(default="Read,Grep,Glob"),
    workdir: str = Form(default=""),
    enabled: bool = Form(default=True),
):
    if kind not in {"default", "advisor", "brainstorm"}:
        raise HTTPException(status_code=400, detail="invalid kind")

    TASKS_DIR.mkdir(parents=True, exist_ok=True)
    slug = _slug(name)
    task_path = TASKS_DIR / f"{slug}.task"

    lines = [
        f"# name: {name}",
        f"# schedule: {schedule}",
    ]
    if kind != "default":
        lines.append(f"# kind: {kind}")
    lines.extend([
        f"# model: {model}",
        f"# max_turns: {max_turns}",
        f"# timeout: {timeout}",
        f"# tools: {tools}",
    ])
    if workdir:
        lines.append(f"# workdir: {workdir}")
    if not enabled:
        lines.append("# enabled: false")

    lines.append("")
    lines.append("---")
    lines.append("")
    lines.append(prompt.strip())
    lines.append("")

    task_path.write_text("\n".join(lines))
    return RedirectResponse(url=f"/scheduler/tasks/{slug}", status_code=303)


@router.post("/api/update-prompt/{slug}")
async def update_prompt(slug: str, prompt: str = Form(...)):
    """Update the prompt in a .task file."""
    task, err = _find_task_by_slug(slug)
    if err:
        return RedirectResponse(url="/scheduler/", status_code=303)

    content = task.file_path.read_text()
    # Replace everything after --- with the new prompt
    parts = content.split("---", 1)
    if len(parts) == 2:
        new_content = parts[0] + "---\n" + prompt.strip() + "\n"
    else:
        new_content = content + "\n---\n" + prompt.strip() + "\n"
    task.file_path.write_text(new_content)
    return RedirectResponse(url=f"/scheduler/tasks/{slug}", status_code=303)


@router.post("/api/generate-prompt", response_class=HTMLResponse)
async def generate_prompt(
    description: str = Form(...),
    workdir: str = Form(default=""),
):
    """Use Claude to generate a structured task prompt from a short description."""
    import subprocess as sp

    system = (
        "You are a prompt engineer for Claude Code automated tasks. "
        "Given a short description, write a clear, detailed prompt that Claude will execute as a scheduled task. "
        "The prompt should be specific, actionable, and include what to check, what to output, and how to handle edge cases. "
        "Output ONLY the prompt text, no explanation or markdown fencing."
    )
    user_msg = f"Task description: {description}"
    if workdir:
        user_msg += f"\nWorking directory: {workdir}"

    try:
        result = sp.run(
            ["claude", "-p", user_msg, "--output-format", "text"],
            capture_output=True, text=True, timeout=60,
            env={**__import__("os").environ, "CLAUDE_SYSTEM_PROMPT": system},
        )
        if result.returncode == 0 and result.stdout.strip():
            prompt = result.stdout.strip()
        else:
            prompt = f"# Failed to generate. Error: {result.stderr[:200]}\n# Please write your prompt manually."
    except Exception as e:
        prompt = f"# Generation failed: {e}\n# Please write your prompt manually."

    # Return just the textarea content for HTMX swap
    return HTMLResponse(
        f'<textarea name="prompt" rows="12" '
        f'class="w-full bg-hub-bg border border-hub-border rounded px-3 py-2 text-sm font-mono '
        f'focus:border-hub-accent focus:outline-none text-hub-text">{prompt}</textarea>'
    )


@router.post("/api/improve-prompt", response_class=HTMLResponse)
async def improve_prompt(
    prompt: str = Form(...),
    feedback: str = Form(default=""),
):
    """Use Claude to improve an existing task prompt."""
    import subprocess as sp

    system = (
        "You are a prompt engineer for Claude Code automated tasks. "
        "Improve the given prompt to be clearer, more specific, and more robust. "
        "Keep the same intent but make it better structured with clear steps and edge case handling. "
        "Output ONLY the improved prompt text, no explanation or markdown fencing."
    )
    user_msg = f"Current prompt:\n{prompt}"
    if feedback:
        user_msg += f"\n\nUser feedback: {feedback}"

    try:
        result = sp.run(
            ["claude", "-p", user_msg, "--output-format", "text"],
            capture_output=True, text=True, timeout=60,
            env={**__import__("os").environ, "CLAUDE_SYSTEM_PROMPT": system},
        )
        if result.returncode == 0 and result.stdout.strip():
            improved = result.stdout.strip()
        else:
            improved = prompt  # Keep original on failure
    except Exception:
        improved = prompt

    return HTMLResponse(
        f'<textarea name="prompt" rows="12" '
        f'class="w-full bg-hub-bg border border-hub-border rounded px-3 py-2 text-sm font-mono '
        f'focus:border-hub-accent focus:outline-none text-hub-text">{improved}</textarea>'
    )


@router.post("/api/approvals/{approval_id}/approve")
async def approve(approval_id: int):
    db = get_db()
    try:
        db.update_approval(approval_id, status="approved")
    finally:
        db.close()
    return RedirectResponse(url="/scheduler/approvals", status_code=303)


@router.post("/api/approvals/{approval_id}/reject")
async def reject(approval_id: int):
    db = get_db()
    try:
        db.update_approval(approval_id, status="rejected")
    finally:
        db.close()
    return RedirectResponse(url="/scheduler/approvals", status_code=303)


def _task_to_dict(task, state=None):
    """Serialize a Task object to JSON-safe dict."""
    d = {
        "name": task.name,
        "slug": task.slug,
        "schedule": task.schedule,
        "enabled": task.enabled,
        "model": getattr(task, "model", "claude-sonnet-4-6"),
        "max_turns": getattr(task, "max_turns", 10),
        "timeout": getattr(task, "timeout", 300),
        "tools": getattr(task, "tools", []),
        "workdir": getattr(task, "workdir", ""),
        "file_path": str(task.file_path),
        "prompt": getattr(task, "prompt", ""),
    }
    if state:
        d["last_status"] = state.get("last_status")
        d["last_run_at"] = state.get("last_run_at")
        d["next_run_at"] = state.get("next_run_at")
        d["run_count"] = state.get("run_count", 0)
    return d


def _run_to_dict(run):
    """Serialize a RunRecord to JSON-safe dict."""
    return {
        "id": run.id,
        "task_name": run.task_name,
        "status": run.status,
        "started_at": run.started_at,
        "finished_at": run.completed_at,
        "duration_seconds": run.duration_seconds,
        "cost_usd": run.cost_usd,
        "error": run.error_message,
    }


@router.get("/api/tasks", response_class=JSONResponse)
async def api_tasks():
    db = get_db()
    try:
        tasks = find_tasks(TASKS_DIR)
        states = db.get_all_task_states()
        states_map = {s["task_name"]: s for s in states}
        return JSONResponse([_task_to_dict(t, states_map.get(t.name)) for t in tasks])
    finally:
        db.close()


@router.get("/api/tasks/{slug}", response_class=JSONResponse)
async def api_task_detail_json(slug: str):
    task, err = _find_task_by_slug(slug)
    if err:
        return JSONResponse({"error": err}, status_code=404)
    db = get_db()
    try:
        state = db.get_task_state(task.name)
        runs = db.get_run_history(task_name=task.name, limit=20)
        errs = db.get_errors(task_name=task.name, limit=10)
        return JSONResponse({
            "task": _task_to_dict(task, state),
            "runs": [_run_to_dict(r) for r in runs],
            "errors": [{"message": e.error_message, "timestamp": e.occurred_at, "task_name": e.task_name} for e in errs],
        })
    finally:
        db.close()


@router.get("/api/stats", response_class=JSONResponse)
async def api_stats():
    db = get_db()
    try:
        tasks = find_tasks(TASKS_DIR)
        runs = db.get_run_history(limit=100)
        total_cost = sum(r.cost_usd for r in runs)
        return JSONResponse({
            "total_tasks": len(tasks),
            "enabled": sum(1 for t in tasks if t.enabled),
            "disabled": sum(1 for t in tasks if not t.enabled),
            "total_runs": len(runs),
            "successes": sum(1 for r in runs if r.status == "success"),
            "failures": sum(1 for r in runs if r.status in ("failed", "timeout")),
            "total_cost": total_cost,
        })
    finally:
        db.close()


@router.get("/api/history", response_class=JSONResponse)
async def api_history(task: str = Query(default=None), n: int = Query(default=50)):
    db = get_db()
    try:
        runs = db.get_run_history(task_name=task, limit=n)
        return JSONResponse([_run_to_dict(r) for r in runs])
    finally:
        db.close()


@router.get("/api/errors", response_class=JSONResponse)
async def api_errors_json(task: str = Query(default=None)):
    db = get_db()
    try:
        errs = db.get_errors(task_name=task)
        return JSONResponse([
            {"message": e.error_message, "timestamp": e.occurred_at, "task_name": e.task_name}
            for e in errs
        ])
    finally:
        db.close()


@router.get("/api/tickets", response_class=JSONResponse)
async def api_tickets_json(status: str = Query(default=None)):
    db = get_db()
    try:
        items = db.get_tickets(status=status)
        return JSONResponse([dict(t) for t in items])
    finally:
        db.close()


@router.get("/api/notifications", response_class=JSONResponse)
async def api_notifications_json(all: str = Query(default=None)):
    db = get_db()
    try:
        show_all = all == "true"
        items = db.get_notifications(unread_only=not show_all)
        return JSONResponse([dict(n) for n in items])
    finally:
        db.close()


@router.get("/api/doctor", response_class=JSONResponse)
async def api_doctor():
    checks = []
    try:
        result = subprocess.run(
            ["claude", "--version"], capture_output=True, text=True, timeout=5,
        )
        checks.append({
            "name": "Claude CLI", "ok": result.returncode == 0,
            "detail": result.stdout.strip() if result.returncode == 0 else result.stderr.strip(),
        })
    except Exception as e:
        checks.append({"name": "Claude CLI", "ok": False, "detail": str(e)})

    tasks = find_tasks(TASKS_DIR)
    checks.append({"name": "Task files", "ok": len(tasks) > 0, "detail": f"{len(tasks)} task(s) found"})

    db = get_db()
    try:
        stale = db.recover_stale_runs(max_age_seconds=3600)
        checks.append({
            "name": "Stale runs", "ok": len(stale) == 0,
            "detail": f"{len(stale)} stale run(s) recovered" if stale else "No stale runs",
        })
        open_tickets = db.get_tickets(status="open")
        checks.append({
            "name": "Open tickets", "ok": len(open_tickets) == 0,
            "detail": f"{len(open_tickets)} open ticket(s)" if open_tickets else "No open tickets",
        })
    finally:
        db.close()

    usage = shutil.disk_usage("/")
    free_gb = usage.free / (1024 ** 3)
    checks.append({"name": "Disk space", "ok": free_gb > 1.0, "detail": f"{free_gb:.1f} GB free"})
    return JSONResponse(checks)


@router.get("/api/logs/{slug}", response_class=JSONResponse)
async def api_logs(slug: str):
    task, err = _find_task_by_slug(slug)
    if err:
        return JSONResponse({"error": err}, status_code=404)
    log_content = ""
    log_file = None
    if LOGS_DIR.exists():
        candidates = sorted(LOGS_DIR.glob(f"{slug}*"), key=lambda p: p.stat().st_mtime, reverse=True)
        if candidates:
            log_file = candidates[0]
            raw = log_file.read_text(errors="replace")
            log_content = raw[-5000:] if len(raw) > 5000 else raw
    return JSONResponse({"task_name": task.name, "log_file": str(log_file) if log_file else None, "content": log_content})


@router.get("/api/approvals", response_class=JSONResponse)
async def api_approvals_json():
    db = get_db()
    try:
        pending = db.get_pending_approvals()
        for item in pending:
            artifact = db.get_artifact(item["artifact_id"])
            item["artifact"] = dict(artifact) if artifact else None
        return JSONResponse([dict(a) for a in pending])
    finally:
        db.close()


class AccountCreate(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    kind: str
    config_dir: str | None = None
    api_key_ref: str | None = None
    plan_tier: str | None = None
    is_default: bool = False


class AccountUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=64)
    config_dir: str | None = None
    api_key_ref: str | None = None
    plan_tier: str | None = None


class AccountImport(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    config_dir: str = Field(min_length=1)
    plan_tier: str | None = None
    is_default: bool = False
    skip_credentials_check: bool = False


def _account_to_dict(a, db=None) -> dict:
    base = {
        "id": a.id,
        "name": a.name,
        "kind": a.kind,
        "config_dir": a.config_dir or None,
        "api_key_ref": a.api_key_ref or None,
        "plan_tier": a.plan_tier or None,
        "is_default": bool(a.is_default),
        "created_at": a.created_at,
        "last_used_at": a.last_used_at or None,
    }
    if db is None:
        return base
    base.update(_account_health(a, db))
    return base


def _account_health(a, db) -> dict:
    from datetime import datetime, timezone, timedelta
    from claude_scheduler.core.notify import (
        _AUTH_COOLDOWN_DIR, _AUTH_COOLDOWN_SECONDS,
    )
    import time

    now = datetime.now(timezone.utc)
    cutoff_24h = (now - timedelta(hours=24)).isoformat()
    cutoff_30d = (now - timedelta(days=30)).isoformat()

    runs_24h = db.execute(
        "SELECT COUNT(*) FROM task_runs WHERE account_id=? AND started_at >= ?",
        (a.id, cutoff_24h),
    ).fetchone()[0]
    failures_24h = db.execute(
        "SELECT COUNT(*) FROM task_runs"
        " WHERE account_id=? AND started_at >= ? AND status='failed'",
        (a.id, cutoff_24h),
    ).fetchone()[0]
    cost_30d_row = db.execute(
        "SELECT COALESCE(SUM(cost_usd), 0.0) FROM task_runs"
        " WHERE account_id=? AND started_at >= ?",
        (a.id, cutoff_30d),
    ).fetchone()
    cost_30d = float(cost_30d_row[0] or 0.0)

    sentinel = _AUTH_COOLDOWN_DIR / a.id
    auth_recent = False
    try:
        mtime = sentinel.stat().st_mtime
        auth_recent = (time.time() - mtime) < _AUTH_COOLDOWN_SECONDS
    except FileNotFoundError:
        pass

    if auth_recent:
        health = "auth_failure"
    elif not a.last_used_at:
        health = "untested"
    else:
        try:
            last_used = datetime.fromisoformat(a.last_used_at.replace("Z", "+00:00"))
            health = "idle" if (now - last_used) > timedelta(days=30) else "active"
        except (ValueError, TypeError):
            health = "untested"

    return {
        "runs_24h": int(runs_24h or 0),
        "failures_24h": int(failures_24h or 0),
        "cost_30d_usd": round(cost_30d, 4),
        "auth_failure_recent": auth_recent,
        "health": health,
    }


@router.get("/api/accounts")
async def api_accounts_list():
    db = get_db()
    try:
        return JSONResponse([_account_to_dict(a, db) for a in db.list_accounts()])
    finally:
        db.close()


@router.post("/api/accounts", status_code=201)
async def api_accounts_create(payload: AccountCreate):
    if payload.kind not in ("config_dir", "api_key"):
        return JSONResponse({"error": "kind must be 'config_dir' or 'api_key'"}, status_code=400)
    if payload.kind == "config_dir":
        if not payload.config_dir:
            return JSONResponse({"error": "config_dir is required when kind='config_dir'"}, status_code=400)
        if payload.api_key_ref:
            return JSONResponse({"error": "api_key_ref must be empty when kind='config_dir'"}, status_code=400)
    else:
        if not payload.api_key_ref:
            return JSONResponse({"error": "api_key_ref is required when kind='api_key'"}, status_code=400)
        if payload.config_dir:
            return JSONResponse({"error": "config_dir must be empty when kind='api_key'"}, status_code=400)
        try:
            validate_secret_ref(payload.api_key_ref)
        except ValueError as e:
            return JSONResponse({"error": f"invalid api_key_ref: {e}"}, status_code=400)
    db = get_db()
    try:
        acc = db.create_account(
            name=payload.name,
            kind=payload.kind,
            config_dir=payload.config_dir,
            api_key_ref=payload.api_key_ref,
            plan_tier=payload.plan_tier,
            is_default=payload.is_default,
        )
    except sqlite3.IntegrityError as e:
        return JSONResponse({"error": str(e)}, status_code=409)
    finally:
        db.close()
    return JSONResponse(_account_to_dict(acc), status_code=201)


@router.get("/api/accounts/check-name")
async def api_accounts_check_name(name: str = ""):
    name = (name or "").strip()
    if not name:
        return JSONResponse({"available": False, "reason": "name is required"})
    db = get_db()
    try:
        existing = db.get_account_by_name(name)
        return JSONResponse({
            "available": existing is None,
            "reason": "already taken" if existing else None,
        })
    finally:
        db.close()


@router.get("/api/accounts/check")
async def api_accounts_check_credentials(config_dir: str = ""):
    raw = (config_dir or "").strip()
    if not raw:
        return JSONResponse({
            "dir_exists": False,
            "has_credentials": False,
            "expanded_path": "",
        })
    try:
        expanded = Path(raw).expanduser()
        dir_exists = expanded.is_dir()
        has_credentials = _has_claude_credentials(expanded)
        return JSONResponse({
            "dir_exists": dir_exists,
            "has_credentials": has_credentials,
            "expanded_path": str(expanded),
        })
    except (OSError, RuntimeError, ValueError):
        return JSONResponse({
            "dir_exists": False,
            "has_credentials": False,
            "expanded_path": "",
        })


@router.get("/api/accounts/discover")
async def api_accounts_discover():
    home = Path.home()
    candidates = [home / ".claude", home / ".claude-fleet"]
    profiles_root = home / ".claude-profiles"
    if profiles_root.exists():
        candidates.extend(sorted(child for child in profiles_root.iterdir() if child.is_dir()))

    db = get_db()
    try:
        accounts = db.list_accounts()
    finally:
        db.close()

    seen: set[str] = set()
    rows = []
    for candidate in candidates:
        try:
            expanded = candidate.expanduser().resolve()
        except (OSError, RuntimeError, ValueError):
            continue
        config_dir = str(expanded)
        if config_dir in seen:
            continue
        seen.add(config_dir)

        dir_exists = expanded.is_dir()
        has_credentials = _has_claude_credentials(expanded) if dir_exists else False
        has_history = False
        if dir_exists:
            has_history = (expanded / ".claude.json").is_file() or (expanded / "history.jsonl").is_file()

        registered_account_id = None
        already_registered = False
        for account in accounts:
            account_dir = _normalized_config_dir(account.config_dir)
            if account_dir and account_dir == config_dir:
                already_registered = True
                registered_account_id = account.id
                break

        rows.append({
            "config_dir": config_dir,
            "name_suggestion": expanded.name.lstrip(".").lower(),
            "dir_exists": dir_exists,
            "has_credentials": has_credentials,
            "has_history": has_history,
            "already_registered": already_registered,
            "registered_account_id": registered_account_id,
        })

    return JSONResponse({"candidates": rows})


@router.post("/api/accounts/import", status_code=201)
async def api_accounts_import(payload: AccountImport):
    try:
        expanded = Path(payload.config_dir).expanduser().resolve()
    except (OSError, RuntimeError, ValueError):
        return JSONResponse({"error": "config_dir does not exist"}, status_code=400)

    if not expanded.is_dir():
        return JSONResponse({"error": "config_dir does not exist"}, status_code=400)
    if not payload.skip_credentials_check and not _has_claude_credentials(expanded):
        return JSONResponse({
            "error": "no Claude credentials found for this dir; run `claude /login` with CLAUDE_CONFIG_DIR=<dir> first, or pass skip_credentials_check=true",
        }, status_code=400)

    db = get_db()
    try:
        for acc in db.list_accounts():
            account_dir = _normalized_config_dir(acc.config_dir)
            if account_dir == str(expanded):
                return JSONResponse({
                    "error": f"config_dir already registered as {acc.name}",
                }, status_code=409)
        try:
            acc = db.create_account(
                name=payload.name,
                kind="config_dir",
                config_dir=str(expanded),
                plan_tier=payload.plan_tier,
                is_default=payload.is_default,
            )
        except sqlite3.IntegrityError as e:
            return JSONResponse({"error": str(e)}, status_code=409)
    finally:
        db.close()

    return JSONResponse(_account_to_dict(acc), status_code=201)


@router.get("/api/accounts/{account_id}")
async def api_accounts_get(account_id: str):
    db = get_db()
    try:
        acc = db.get_account(account_id)
        if not acc:
            return JSONResponse({"error": "not found"}, status_code=404)
        return JSONResponse(_account_to_dict(acc, db))
    finally:
        db.close()


@router.patch("/api/accounts/{account_id}")
async def api_accounts_update(account_id: str, payload: AccountUpdate):
    fields = payload.model_dump(exclude_unset=True)
    if fields.get("api_key_ref"):
        try:
            validate_secret_ref(fields["api_key_ref"])
        except ValueError as e:
            return JSONResponse({"error": f"invalid api_key_ref: {e}"}, status_code=400)
    db = get_db()
    try:
        if not db.get_account(account_id):
            return JSONResponse({"error": "not found"}, status_code=404)
        acc = db.update_account(account_id, **fields)
    except (ValueError, sqlite3.IntegrityError) as e:
        return JSONResponse({"error": str(e)}, status_code=400)
    finally:
        db.close()
    return JSONResponse(_account_to_dict(acc))


@router.delete("/api/accounts/{account_id}", status_code=204)
async def api_accounts_delete(account_id: str):
    db = get_db()
    try:
        if db.delete_account(account_id):
            return JSONResponse(None, status_code=204)
        return JSONResponse({"error": "not found"}, status_code=404)
    finally:
        db.close()


@router.post("/api/accounts/{account_id}/default")
async def api_accounts_set_default(account_id: str):
    db = get_db()
    try:
        if not db.get_account(account_id):
            return JSONResponse({"error": "not found"}, status_code=404)
        return JSONResponse(_account_to_dict(db.set_default_account(account_id)))
    finally:
        db.close()


@router.post("/api/accounts/{account_id}/test")
async def api_accounts_test(account_id: str):
    import os
    import time as _time
    from claude_scheduler.core.secrets import resolve_secret_ref, SecretResolutionError

    db = get_db()
    try:
        acc = db.get_account(account_id)
        if not acc:
            return JSONResponse({"error": "not found"}, status_code=404)
    finally:
        db.close()

    claude_bin = shutil.which("claude")
    if not claude_bin:
        return JSONResponse({
            "ok": False,
            "exit_code": None,
            "stderr_tail": "claude CLI not found in PATH",
            "took_ms": 0,
        }, status_code=200)

    env = os.environ.copy()
    if acc.kind == "config_dir":
        if not acc.config_dir:
            return JSONResponse({
                "ok": False,
                "exit_code": None,
                "stderr_tail": "account has no config_dir",
                "took_ms": 0,
            }, status_code=200)
        env["CLAUDE_CONFIG_DIR"] = acc.config_dir
        env.pop("ANTHROPIC_API_KEY", None)
    else:
        if not acc.api_key_ref:
            return JSONResponse({
                "ok": False,
                "exit_code": None,
                "stderr_tail": "account has no api_key_ref",
                "took_ms": 0,
            }, status_code=200)
        try:
            env["ANTHROPIC_API_KEY"] = resolve_secret_ref(acc.api_key_ref)
        except SecretResolutionError as e:
            return JSONResponse({
                "ok": False,
                "exit_code": None,
                "stderr_tail": f"secret resolution failed: {e}",
                "took_ms": 0,
            }, status_code=200)
        env.pop("CLAUDE_CONFIG_DIR", None)

    cmd = [claude_bin, "-p", "say ok", "--max-turns", "1", "--output-format", "json"]
    t0 = _time.monotonic()
    try:
        proc = subprocess.run(cmd, capture_output=True, timeout=30, env=env)
    except subprocess.TimeoutExpired:
        return JSONResponse({
            "ok": False,
            "exit_code": None,
            "stderr_tail": "timed out after 30s",
            "took_ms": int((_time.monotonic() - t0) * 1000),
        }, status_code=200)

    took_ms = int((_time.monotonic() - t0) * 1000)
    stderr = proc.stderr.decode(errors="replace") if proc.stderr else ""
    return JSONResponse({
        "ok": proc.returncode == 0,
        "exit_code": proc.returncode,
        "stderr_tail": stderr[-400:] if stderr else "",
        "took_ms": took_ms,
    })
