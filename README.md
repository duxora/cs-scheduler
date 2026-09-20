# claude-scheduler

Scheduled AI tasks for Claude Code. A self-healing periodic task runner built for Claude Code power users who want to automate recurring development workflows.

Define tasks as `.task` files, schedule them with cron-like syntax, and let Claude Code execute them autonomously -- with retry logic, failure investigation, and remediation agents built in.

## Install

**Prerequisites:** Python 3.12+, [Claude CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated.

```
pip install claude-scheduler
```

## Testing

```
/Users/ducduong/.pyenv/versions/3.12.3/bin/python -m pytest tests/ -q
```

See `tests/CLAUDE.md` for why bare `python3` doesn't work here (wrong interpreter, wrong Python version).

## Quickstart

```bash
cs init                          # Initialize config and task directory
cs new                           # Create a new task (interactive)
cs run my-task.task --dry-run    # Preview without executing
cs serve                         # Start the scheduler daemon
```

## Task File Format

Tasks are plain text files with a comment header and a prompt body, separated by `---`.

```
# name: Daily Dependency Audit
# schedule: daily 09:00
# workdir: ~/workspace/myproject
# tools: Read,Grep,Glob
# max_turns: 5
# model: claude-sonnet-4-6
# timeout: 300
# enabled: true
---
Check all dependencies for known vulnerabilities.
Report findings grouped by severity.
```

### Header Fields

| Field | Default | Description |
|-------|---------|-------------|
| `name` | (required) | Human-readable task name |
| `schedule` | (required) | `daily HH:MM`, `weekly DAY HH:MM`, or `every Nh` |
| `workdir` | current dir | Working directory for execution |
| `tools` | `Read,Grep,Glob` | Allowed Claude tools (comma-separated) |
| `max_turns` | `10` | Max conversation turns |
| `model` | `claude-sonnet-4-6` | Claude model to use |
| `timeout` | `300` | Execution timeout in seconds |
| `enabled` | `true` | Whether the task runs on schedule |
| `retry` | `0` | Max retry attempts on failure |
| `retry_delay` | `60` | Initial backoff delay in seconds (doubles each attempt) |
| `notify` | `errors` | Notification level: `all`, `errors`, `none` |
| `on_failure` | `notify` | Failure action: `investigate`, `retry`, `notify`, `ignore` |
| `remediation_tools` | - | Tools available to the remediation agent |
| `remediation_max_turns` | `15` | Max turns for remediation agent |

## CLI Reference

### Daemon

| Command | Description |
|---------|-------------|
| `cs init` | Initialize config directory and default settings |
| `cs serve` | Start the scheduler daemon |
| `cs serve --install` | Install as launchd (macOS) or systemd (Linux) service |
| `cs serve --uninstall` | Remove the system service |

### Task Management

| Command | Description |
|---------|-------------|
| `cs new` | Create a new task interactively or with `--name`/`--prompt` flags |
| `cs enable <slug>` | Enable a disabled task |
| `cs disable <slug>` | Disable a task without deleting it |

### Execution

| Command | Description |
|---------|-------------|
| `cs run <file> [--dry-run]` | Run a single task (or preview with `--dry-run`) |
| `cs run-all [--schedule TYPE]` | Run all tasks matching a schedule type |

### Monitoring

| Command | Description |
|---------|-------------|
| `cs status` | Dashboard showing all tasks with health indicators |
| `cs history [--task NAME] [-n 20]` | Run history with optional task filter |
| `cs errors [--task NAME]` | Error records |
| `cs tickets [--status open]` | Remediation tickets |
| `cs notifications [--all]` | Notification inbox (default: unread only) |
| `cs doctor` | System health check (CLI, disk, stale runs) |
| `cs logs <task> [--follow]` | View task output logs |
| `cs dashboard` | Open the TUI dashboard |

### Remediation and Approvals

| Command | Description |
|---------|-------------|
| `cs approvals` | List pending approval requests |
| `cs approve <id> [--note "..."]` | Approve a pending change |
| `cs reject <id> [--note "..."]` | Reject a pending change |
| `cs artifacts <task>` | Show context artifacts for a task |
| `cs remediate <ticket-id> [--guidance "..."]` | Trigger remediation with optional guidance |

## Web Dashboard

Start the web UI (part of the tools-hub server):

```
cs serve
```

Available at `http://localhost:7070/scheduler/`. Features:

- Task overview with status, schedule, and health indicators
- Run history with duration and cost tracking
- AI-assisted prompt generation and improvement
- Create and edit tasks from the browser
- Enable/disable tasks with one click
- Error log viewer and remediation ticket management
- System health checks (doctor)
- Approval workflow for proposed changes

## Configuration

Configuration lives at `~/.config/claude-scheduler/config.toml`.

```toml
[server]
host = "127.0.0.1"
port = 7070

[paths]
tasks = "~/workspace/tools/claude-scheduler/tasks"
logs = "~/workspace/tools/claude-scheduler/logs"
data = "~/workspace/tools/claude-scheduler/data"

[defaults]
model = "claude-sonnet-4-6"
max_turns = 10
timeout = 300
tools = "Read,Grep,Glob"
notify = "errors"
on_failure = "notify"
```

## Auto-Start

Register the scheduler as a system service so it starts on login:

**macOS (launchd):**

```bash
cs serve --install      # Creates ~/Library/LaunchAgents plist
cs serve --uninstall    # Removes the plist and unloads the agent
```

**Linux (systemd):**

```bash
cs serve --install      # Creates ~/.config/systemd/user/ unit file
cs serve --uninstall    # Disables and removes the unit
```

## Remediation Flow

When a task fails with `on_failure: investigate`, the scheduler:

1. Records the error and the Claude session ID
2. Resumes the failed session with `claude -p --resume <session_id>`, giving the remediation agent full context of everything the task did
3. If the agent fixes the issue, the task is re-run automatically
4. If the agent needs human input, a ticket is created -- resolve it with `cs remediate <id> --guidance "try X"`

Each step preserves the full conversation context from prior sessions.

## License

MIT
