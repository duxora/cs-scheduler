"""Parse .task files into Task objects."""
import re
from pathlib import Path
import dataclasses

from .models import Task, DEFAULTS
from claude_scheduler.console import console

VALID_SCHEDULES = [
    r'^daily \d{2}:\d{2}$',
    r'^weekly \w+ \d{2}:\d{2}$',
    r'^every \d+[hm]$',
]

def validate_schedule(schedule: str) -> bool:
    """Check if schedule string matches a known format."""
    return any(re.match(p, schedule) for p in VALID_SCHEDULES)

INT_FIELDS = {"max_turns", "timeout", "retry", "retry_delay", "remediation_max_turns"}
BOOL_FIELDS = {"enabled", "write_requires_approval", "auto_pr"}
FLOAT_FIELDS = {"budget_usd"}

def parse_task(path: Path) -> Task:
    path = Path(path)
    if not path.exists():
        raise FileNotFoundError(f"Task file not found: {path}")

    text = path.read_text()
    parts = text.split("\n---\n", maxsplit=1)
    if len(parts) != 2:
        parts = re.split(r'\n---\s*\n', text, maxsplit=1)

    header_text = parts[0] if len(parts) == 2 else text
    prompt = parts[1].strip() if len(parts) == 2 else ""

    fields = {}
    for line in header_text.splitlines():
        m = re.match(r'^#\s+(\w+):\s+(.+)$', line)
        if m:
            fields[m.group(1)] = m.group(2).strip()

    if "name" not in fields:
        raise ValueError(f"Missing required field 'name' in {path}")
    if "schedule" not in fields:
        raise ValueError(f"Missing required field 'schedule' in {path}")

    kwargs = {"name": fields.pop("name"), "schedule": fields.pop("schedule"),
              "prompt": prompt, "file_path": path}

    if not validate_schedule(kwargs["schedule"]):
        console.print(f"[yellow]Warning: unrecognized schedule format '{kwargs['schedule']}' in {path}[/yellow]")

    for key, val in fields.items():
        if key in INT_FIELDS:
            kwargs[key] = int(val)
        elif key in BOOL_FIELDS:
            kwargs[key] = val.lower() == "true"
        elif key in FLOAT_FIELDS:
            kwargs[key] = float(val)
        else:
            kwargs[key] = val

    # Drop headers the model does not declare. An unknown header (e.g. a hand-added `retired:`)
    # would otherwise raise TypeError, which find_tasks does not catch - killing discovery for
    # EVERY task, not just this one.
    known = {f.name for f in dataclasses.fields(Task)}
    unknown = sorted(set(kwargs) - known)
    if unknown:
        console.print(f"[yellow]Warning: ignoring unknown header(s) {', '.join(unknown)} in {path}[/yellow]")
        kwargs = {k: v for k, v in kwargs.items() if k in known}

    return Task(**kwargs)

def find_tasks(tasks_dir: Path) -> list[Task]:
    tasks_dir = Path(tasks_dir)
    tasks = []
    for f in sorted(tasks_dir.glob("*.task")):
        try:
            tasks.append(parse_task(f))
        except (ValueError, FileNotFoundError) as e:
            console.print(f"[yellow]Warning: skipping {f.name}: {e}[/yellow]")
    return tasks
