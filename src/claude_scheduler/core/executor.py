"""Execute a task via claude -p with timeout, locking, and session tracking."""
import dataclasses
import json
import subprocess
import fcntl
import os
from hashlib import sha1
from datetime import datetime
from pathlib import Path
from .models import Task
from .prompts import wrap_prompt
from .secrets import resolve_secret_ref, SecretResolutionError

LOCK_DIR = Path.home() / ".claude-scheduler" / "locks"
PROFILE_LOCK_DIR = Path.home() / ".claude-scheduler" / "profile-locks"

def _find_claude() -> str:
    """Find the claude CLI binary, checking common locations."""
    import shutil
    # Check PATH first
    found = shutil.which("claude")
    if found:
        return found
    # Common install locations
    for path in [
        os.path.expanduser("~/.local/bin/claude"),
        os.path.expanduser("~/.claude/bin/claude"),
        "/usr/local/bin/claude",
    ]:
        if os.path.isfile(path) and os.access(path, os.X_OK):
            return path
    return "claude"  # fallback, will raise FileNotFoundError


def build_claude_command(task: Task) -> list[str]:
    return [
        _find_claude(), "-p", task.prompt,
        "--allowedTools", task.tools,
        "--max-turns", str(task.max_turns),
        "--model", task.model,
        "--output-format", "json",
    ]

def _extract_session_id(stdout: str) -> str:
    """Extract session_id from claude JSON output."""
    try:
        data = json.loads(stdout)
        return data.get("session_id", "")
    except (json.JSONDecodeError, TypeError):
        return ""

def _extract_cost(stdout: str) -> dict:
    """Extract token usage and cost from claude JSON output."""
    try:
        data = json.loads(stdout)
        return {
            "input_tokens": data.get("input_tokens", 0),
            "output_tokens": data.get("output_tokens", 0),
            "cost_usd": data.get("cost_usd", 0.0),
        }
    except (json.JSONDecodeError, TypeError):
        return {"input_tokens": 0, "output_tokens": 0, "cost_usd": 0.0}


def _extract_structured_output(stdout: str) -> str:
    try:
        outer = json.loads(stdout)
        inner_text = outer.get("result", "") or outer.get("response", "")
        if not isinstance(inner_text, str):
            return ""
        cleaned = _strip_code_fence(inner_text)
        json.loads(cleaned)
        return cleaned
    except (json.JSONDecodeError, TypeError, AttributeError):
        return ""

def _acquire_lock(task: Task) -> int | None:
    LOCK_DIR.mkdir(parents=True, exist_ok=True)
    lock_path = LOCK_DIR / f"{task.slug}.lock"
    fd = os.open(str(lock_path), os.O_CREAT | os.O_WRONLY)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        os.write(fd, str(os.getpid()).encode())
        return fd
    except BlockingIOError:
        os.close(fd)
        return None

def _release_lock(fd: int, task: Task):
    fcntl.flock(fd, fcntl.LOCK_UN)
    os.close(fd)
    lock_path = LOCK_DIR / f"{task.slug}.lock"
    lock_path.unlink(missing_ok=True)

def _profile_lock_key(account) -> str | None:
    """Return a stable key for the profile-level lock, or None if no lock needed.

    config_dir accounts share the CLI credential file, so two concurrent runs
    against the same profile can corrupt the auth refresh. api_key accounts
    have no shared on-disk state — no lock needed.
    """
    if account is None:
        return None
    if account.kind != "config_dir":
        return None
    if not account.config_dir:
        return None
    return sha1(account.config_dir.encode()).hexdigest()[:16]


def _acquire_profile_lock(account):
    key = _profile_lock_key(account)
    if key is None:
        return None
    PROFILE_LOCK_DIR.mkdir(parents=True, exist_ok=True)
    lock_path = PROFILE_LOCK_DIR / f"{key}.lock"
    fd = os.open(str(lock_path), os.O_CREAT | os.O_WRONLY)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return fd
    except BlockingIOError:
        os.close(fd)
        return "BUSY"


def _release_profile_lock(fd):
    if fd is None or fd == "BUSY":
        return
    fcntl.flock(fd, fcntl.LOCK_UN)
    os.close(fd)


def _strip_code_fence(s: str) -> str:
    s = s.strip()
    if s.startswith("```"):
        s = s.split("\n", 1)[1] if "\n" in s else s[3:]
    if s.endswith("```"):
        s = s.rsplit("```", 1)[0]
    return s.strip()


def _fanout_brainstorm_children(task: Task, structured_output: str) -> str:
    try:
        parsed = json.loads(structured_output)
        actions = parsed.get("actions", [])
        if not isinstance(actions, list) or len(actions) != 3:
            raise ValueError("brainstorm output must contain exactly 3 actions")

        parent_dir = task.file_path.parent
        parent_dir.mkdir(parents=True, exist_ok=True)

        for idx, action in enumerate(actions, start=1):
            if not isinstance(action, dict):
                raise ValueError("brainstorm actions must be objects")
            child_path = parent_dir / f"{task.file_path.stem}-action-{idx}.task"
            if child_path.exists():
                continue

            action_name = str(action.get("name", "")).strip() or f"action-{idx}"
            action_prompt = str(action.get("prompt", "")).strip()
            action_tools = str(action.get("tools", "")).strip() or task.tools

            lines = [
                f"# name: {task.name} :: {action_name}",
                "# schedule: manual",
                "# kind: default",
                "# enabled: true",
                f"# max_turns: {task.max_turns}",
                f"# timeout: {task.timeout}",
                f"# tools: {action_tools}",
                "# model: opus",
            ]
            if task.account:
                lines.append(f"# account: {task.account}")

            lines.extend(["", "---", "", action_prompt, ""])
            child_path.write_text("\n".join(lines))
        return ""
    except Exception as exc:
        return f"brainstorm fan-out warning: {exc}"


def execute_task(task: Task, logs_dir: Path,
                 attempt: int = 1, db=None) -> dict:
    if task.kind in ("advisor", "brainstorm"):
        new_prompt = wrap_prompt(task.kind, task.prompt)
        new_model = task.model
        if not task.model or task.model in ("sonnet", "claude-sonnet-4", "claude-sonnet-4-6", "default"):
            new_model = "opus"
        task = dataclasses.replace(task, prompt=new_prompt, model=new_model)

    logs_dir.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    log_file = logs_dir / f"{task.slug}-{ts}-a{attempt}.json"

    # Acquire lock (prevent duplicate runs)
    lock_fd = _acquire_lock(task)
    if lock_fd is None:
        return {"status": "skipped", "reason": "already running",
                "log_file": str(log_file), "exit_code": None,
                "stderr": "", "stdout": "", "session_id": ""}

    workdir = os.path.expanduser(task.workdir) if task.workdir else None
    profile_lock_fd = None
    account = None
    env = None

    if task.kind in ("advisor", "brainstorm") and task.account == "" and db is not None:
        default_account = db.get_default_account()
        if default_account:
            task = dataclasses.replace(task, account=default_account.name)

    cmd = build_claude_command(task)

    try:
        if task.account:
            if db is None:
                return {
                    "status": "failed",
                    "error_message": "account configured but no db handle for lookup",
                    "log_file": str(log_file),
                    "exit_code": None,
                    "stderr": "",
                    "stdout": "",
                    "session_id": "",
                }
            account = db.get_account_by_name(task.account)
            if account is None:
                return {
                    "status": "failed",
                    "error_message": f"account {task.account!r} not found",
                    "log_file": str(log_file),
                    "exit_code": None,
                    "stderr": "",
                    "stdout": "",
                    "session_id": "",
                }
            profile_lock_fd = _acquire_profile_lock(account)
            if profile_lock_fd == "BUSY":
                return {
                    "status": "skipped",
                    "reason": "profile busy",
                    "account_id": account.id,
                    "log_file": str(log_file),
                    "exit_code": None,
                    "stderr": "",
                    "stdout": "",
                    "session_id": "",
                }

            env = os.environ.copy()
            if account.kind == "config_dir":
                env["CLAUDE_CONFIG_DIR"] = account.config_dir
                env.pop("ANTHROPIC_API_KEY", None)
            elif account.kind == "api_key":
                try:
                    env["ANTHROPIC_API_KEY"] = resolve_secret_ref(account.api_key_ref)
                except SecretResolutionError as exc:
                    return {
                        "status": "failed",
                        "error_message": str(exc),
                        "account_id": account.id,
                        "log_file": str(log_file),
                        "exit_code": None,
                        "stderr": "",
                        "stdout": "",
                        "session_id": "",
                    }
                env.pop("CLAUDE_CONFIG_DIR", None)

        proc = subprocess.run(
            cmd, capture_output=True, timeout=task.timeout, cwd=workdir, env=env)

        stdout = proc.stdout.decode(errors="replace")
        stderr = proc.stderr.decode(errors="replace")
        session_id = _extract_session_id(stdout)
        cost = _extract_cost(stdout)

        # Write output to log
        log_file.write_bytes(proc.stdout or b"")

        if proc.returncode == 0:
            structured_output = ""
            fanout_warning = ""
            if task.kind in ("advisor", "brainstorm"):
                structured_output = _extract_structured_output(stdout)
                if task.kind == "brainstorm" and structured_output:
                    fanout_warning = _fanout_brainstorm_children(task, structured_output)
            if account and db is not None:
                db.touch_account_last_used(account.id)
            result = {**{"status": "success", "exit_code": 0,
                         "log_file": str(log_file),
                         "stderr": stderr, "stdout": stdout,
                         "session_id": session_id,
                         "structured_output": structured_output},
                      **cost,
                      **({"account_id": account.id} if account else {})}
            if fanout_warning:
                result["fanout_warning"] = fanout_warning
            return result
        else:
            return {**{"status": "failed", "exit_code": proc.returncode,
                    "log_file": str(log_file),
                    "stderr": stderr, "stdout": stdout,
                    "session_id": session_id,
                    "error_message": f"Exit code {proc.returncode}"}, **cost,
                    **({"account_id": account.id} if account else {})}

    except subprocess.TimeoutExpired:
        return {**{"status": "timeout", "exit_code": None,
                "log_file": str(log_file), "stderr": "",
                "stdout": "", "session_id": "",
                "error_message": f"Timed out after {task.timeout}s"},
                **({"account_id": account.id} if account else {})}

    except FileNotFoundError:
        return {**{"status": "failed", "exit_code": None,
                "log_file": str(log_file), "stderr": "",
                "stdout": "", "session_id": "",
                "error_message": "claude CLI not found in PATH"},
                **({"account_id": account.id} if account else {})}
    finally:
        _release_profile_lock(profile_lock_fd)
        _release_lock(lock_fd, task)


def _strip_write_tools(tools: str) -> str:
    """Remove write-capable tools from a tools string, leaving read-only tools."""
    write_patterns = ["Edit", "Write", "Bash(git push", "Bash(gh pr", "Bash(rm ", "Bash(mv "]
    parts = [t.strip() for t in tools.split(",")]
    return ",".join(p for p in parts if not any(p.startswith(w) for w in write_patterns))


def execute_two_phase(task: Task, logs_dir: Path, db) -> dict:
    """Execute a task in two phases: read-only analysis, then optional write phase.

    High-security tasks first gather information without making changes, then
    optionally pause for human approval before executing the recommended actions.
    """
    import dataclasses

    read_tools = _strip_write_tools(task.tools)
    read_prompt = (
        f"{task.prompt}\n\n"
        "IMPORTANT: You are in READ-ONLY mode. Do NOT make any changes.\n"
        "Produce a structured analysis as JSON with these keys:\n"
        '- "findings": what you discovered\n'
        '- "recommended_actions": specific actions to take\n'
        '- "risk_level": low/medium/high\n'
        "Output ONLY the JSON."
    )

    # Run read-only phase with write tools stripped
    read_task = dataclasses.replace(task, tools=read_tools, prompt=read_prompt)
    read_result = execute_task(read_task, logs_dir, attempt=1, db=db)

    if read_result["status"] != "success":
        return read_result

    # Persist the analysis as a context artifact
    artifact_id = db.create_artifact(
        task.name, 0, "analysis", read_result.get("stdout", ""))

    if task.write_requires_approval:
        from .notify import _send_desktop, _log_notification
        title = "Claude Scheduler — Approval Needed"
        msg = (
            f"{task.name}: Read phase complete. "
            f"Review artifact #{artifact_id} then run: cs approve {artifact_id}"
        )
        _send_desktop(title, msg, "action", f"./cs approve {artifact_id}")
        _log_notification(db, task.name, "action", title, msg, f"./cs approve {artifact_id}")

        db.create_approval(task.name, artifact_id)
        return {
            "status": "awaiting_approval",
            "artifact_id": artifact_id,
            "session_id": read_result.get("session_id", ""),
            **read_result,
        }

    return _execute_write_phase(task, read_result, logs_dir, db)


def _execute_write_phase(task: Task, read_result: dict, logs_dir: Path, db=None) -> dict:
    """Execute the write phase using analysis from the read phase as context."""
    import dataclasses

    write_tools = task.write_tools or task.tools
    write_prompt = (
        f"You are executing the WRITE phase for task: {task.name}\n\n"
        f"Context from the read phase analysis:\n"
        f"```json\n{read_result.get('stdout', '')[:5000]}\n```\n\n"
        "Execute ONLY the recommended actions from the analysis.\n"
        "Do not explore or investigate further.\n"
        "Start with 'EXECUTED:' followed by what you did."
    )

    write_task = dataclasses.replace(task, tools=write_tools, prompt=write_prompt)
    return execute_task(write_task, logs_dir, attempt=1, db=db)
