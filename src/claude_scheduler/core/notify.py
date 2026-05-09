"""Notification system — macOS alerts + Telegram + persistent SQLite log."""
import logging
import os
import re
import shutil
import subprocess
import time
from pathlib import Path

from .db import Database

logger = logging.getLogger(__name__)

_HAS_TERMINAL_NOTIFIER = shutil.which("terminal-notifier") is not None

_AUTH_COOLDOWN_DIR = Path.home() / ".claude-scheduler" / "auth-alert-cooldown"
_AUTH_COOLDOWN_SECONDS = 6 * 60 * 60  # 6 hours

# Phrases the claude CLI prints when an OAuth profile has expired or been
# revoked. Match case-insensitively. Keep the list specific - false positives
# would dedupe legitimate non-auth failures.
_AUTH_PATTERNS = (
    re.compile(r"please run\s*[`'\"]?/login", re.IGNORECASE),
    re.compile(r"please run\s*[`'\"]?claude\s+/login", re.IGNORECASE),
    re.compile(r"\b(authentication|auth)\s+(required|failed|expired)\b", re.IGNORECASE),
    re.compile(r"\boauth\s+(token\s+)?(expired|invalid|revoked)\b", re.IGNORECASE),
    re.compile(r"\bcredentials?\s+(expired|missing|invalid)\b", re.IGNORECASE),
    re.compile(r"\b401\b\s*(unauthorized)?", re.IGNORECASE),
    re.compile(r"\bunauthorized\b", re.IGNORECASE),
    re.compile(r"not\s+(logged\s+in|authenticated)", re.IGNORECASE),
)

SOUNDS = {
    "info": "Glass",
    "warning": "Purr",
    "error": "Basso",
    "action": "Sosumi",
}

def _escape(s: str) -> str:
    return s.replace("\\", "\\\\").replace('"', '\\"')


def _auth_failure_pattern(stderr: str) -> bool:
    if not stderr:
        return False
    return any(p.search(stderr) for p in _AUTH_PATTERNS)


def _auth_cooldown_active(account_id: str) -> bool:
    sentinel = _AUTH_COOLDOWN_DIR / account_id
    try:
        mtime = sentinel.stat().st_mtime
    except FileNotFoundError:
        return False
    return (time.time() - mtime) < _AUTH_COOLDOWN_SECONDS


def _auth_cooldown_touch(account_id: str) -> None:
    _AUTH_COOLDOWN_DIR.mkdir(parents=True, exist_ok=True)
    sentinel = _AUTH_COOLDOWN_DIR / account_id
    sentinel.touch()
    os.utime(sentinel, None)

def _send_desktop(title: str, message: str, severity: str = "info",
                  action_cmd: str = ""):
    sound = SOUNDS.get(severity, "default")

    if _HAS_TERMINAL_NOTIFIER:
        cmd = [
            "terminal-notifier",
            "-title", title,
            "-message", message,
            "-sound", sound,
            "-group", "claude-scheduler",
            "-sender", "com.apple.Terminal",
        ]
        if action_cmd:
            cmd.extend(["-execute", action_cmd])
        subprocess.run(cmd, capture_output=True, timeout=5)
    else:
        script = (
            f'display notification "{_escape(message)}"'
            f' with title "{_escape(title)}"'
            f' sound name "{sound}"'
        )
        subprocess.run(["osascript", "-e", script],
                       capture_output=True, timeout=5)

def _log_notification(db: Database | None, task_name: str, severity: str,
                      title: str, message: str, action_cmd: str = ""):
    if db is None:
        return
    from datetime import datetime, timezone
    db.execute(
        "INSERT INTO notifications"
        " (task_name, severity, title, message, sent_at, action_cmd)"
        " VALUES (?, ?, ?, ?, ?, ?)",
        (task_name, severity, title, message,
         datetime.now(timezone.utc).isoformat(), action_cmd))
    db.conn.commit()

def _send_telegram(text: str):
    """Send notification to the Scheduler Telegram topic."""
    try:
        import sys
        sys.path.insert(0, str(__import__("pathlib").Path.home()
                                / "workspace" / "tools" / "telegram-bridge" / "src"))
        from telegram_bridge.notify import send_to_scheduler
        send_to_scheduler(text)
    except Exception as e:
        logger.warning("Telegram notification failed: %s", e)


def notify_error(task_name: str, error_message: str,
                 attempt: int = 1, db: Database = None):
    title = "Claude Scheduler — Task Failed"
    msg = f"{task_name} (attempt {attempt}): {error_message[:100]}"
    action = f"./cs errors --task '{task_name}'"
    _send_desktop(title, msg, "error", action)
    _log_notification(db, task_name, "error", title, msg, action)
    _send_telegram(f"❌ *{task_name}* failed (attempt {attempt})\n{error_message[:200]}")

def notify_success(task_name: str, db: Database = None):
    title = "Claude Scheduler"
    msg = f"{task_name} completed successfully"
    _send_desktop(title, msg, "info")
    _log_notification(db, task_name, "info", title, msg)
    _send_telegram(f"✅ *{task_name}* completed successfully")

def notify_ticket(task_name: str, ticket_id: int, db: Database = None):
    title = "Claude Scheduler — Action Needed"
    msg = (f"{task_name}: ticket #{ticket_id} needs your input")
    action = f"./cs remediate {ticket_id}"
    _send_desktop(title, msg, "action", action)
    _log_notification(db, task_name, "action", title, msg, action)
    _send_telegram(f"⚠️ *{task_name}*: ticket #{ticket_id} needs your input")


def notify_auth_failure(account, db: Database = None) -> bool:
    if account is None or getattr(account, "kind", None) != "config_dir":
        return False
    if _auth_cooldown_active(account.id):
        return False

    config_dir = account.config_dir or "~/.claude-profiles/<name>"
    relogin_cmd = f"CLAUDE_CONFIG_DIR={config_dir} claude /login"
    title = "Claude Scheduler — re-login required"
    msg = f"Account '{account.name}' OAuth expired. Run: {relogin_cmd}"

    _send_desktop(title, msg, "action", relogin_cmd)
    _log_notification(db, f"account:{account.name}", "action", title, msg,
                      relogin_cmd)
    _send_telegram(
        f"🔐 *{account.name}* - Claude OAuth expired\n"
        f"Re-login:\n`{relogin_cmd}`"
    )
    _auth_cooldown_touch(account.id)
    return True
