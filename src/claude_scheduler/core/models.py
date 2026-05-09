"""Data models for claude-scheduler."""
from dataclasses import dataclass, field
from pathlib import Path

DEFAULTS = {
    "model": "claude-sonnet-4-6",
    "max_turns": 10,
    "timeout": 300,
    "tools": "Read,Grep,Glob",
    "enabled": True,
    "retry": 0,
    "retry_delay": 60,
    "notify": "errors",
    "on_failure": "notify",
    "remediation_max_turns": 15,
}

@dataclass
class Task:
    name: str
    schedule: str
    prompt: str
    file_path: Path
    workdir: str = ""
    tools: str = DEFAULTS["tools"]
    max_turns: int = DEFAULTS["max_turns"]
    model: str = DEFAULTS["model"]
    timeout: int = DEFAULTS["timeout"]
    enabled: bool = DEFAULTS["enabled"]
    retry: int = DEFAULTS["retry"]
    retry_delay: int = DEFAULTS["retry_delay"]
    notify: str = DEFAULTS["notify"]
    on_failure: str = DEFAULTS["on_failure"]
    remediation_tools: str = ""
    remediation_max_turns: int = DEFAULTS["remediation_max_turns"]
    budget_usd: float = 0.0
    security_level: str = "low"  # low | medium | high
    write_tools: str = ""
    write_requires_approval: bool = False
    context_sharing: str = "artifact"  # artifact | session | none
    depends_on: str = ""        # Task slug that must succeed first
    isolation: str = "none"     # none | worktree
    auto_pr: bool = False
    webhook: str = ""
    webhook_on: str = "errors"  # all | errors | none
    trigger: str = "schedule"   # schedule | file_watch
    watch_paths: str = ""

    @property
    def slug(self) -> str:
        return self.name.lower().replace(" ", "-").strip("-")

@dataclass
class RunRecord:
    id: int = 0
    task_name: str = ""
    task_file: str = ""
    started_at: str = ""
    completed_at: str = ""
    status: str = "running"  # running | success | failed | timeout
    exit_code: int | None = None
    attempt: int = 1
    duration_seconds: float = 0.0
    log_file: str = ""
    error_message: str = ""
    session_id: str = ""  # claude session ID for --resume chaining
    input_tokens: int = 0
    output_tokens: int = 0
    cost_usd: float = 0.0

@dataclass
class ErrorRecord:
    id: int = 0
    task_name: str = ""
    run_id: int = 0
    occurred_at: str = ""
    error_type: str = ""  # timeout | crash | exit_code | parse_error
    error_message: str = ""
    stderr_output: str = ""
    notified: bool = False

@dataclass
class Ticket:
    id: int = 0
    task_name: str = ""
    error_id: int = 0
    run_session_id: str = ""         # session from failed task
    remediation_session_id: str = "" # session from remediation attempt
    created_at: str = ""
    status: str = "open"  # open | investigating | resolved | closed
    investigation: str = ""
    resolution: str = ""
    resolved_at: str = ""
    user_guidance: str = ""


@dataclass
class Account:
    id: str = ""
    name: str = ""
    kind: str = "config_dir"
    config_dir: str = ""
    api_key_ref: str = ""
    plan_tier: str = ""
    is_default: bool = False
    created_at: str = ""
    last_used_at: str = ""
