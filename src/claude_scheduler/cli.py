#!/usr/bin/env python3
"""cs — Claude Scheduler CLI."""
import argcomplete
import argparse
import hashlib
import os
import sqlite3
import subprocess
import sys
from pathlib import Path

from rich.table import Table
from rich.panel import Panel

# Ensure project root is on sys.path so 'apps' package is importable
_PROJECT_ROOT = str(Path(__file__).resolve().parent.parent.parent)
if _PROJECT_ROOT not in sys.path:
    sys.path.insert(0, _PROJECT_ROOT)

from claude_scheduler import __version__
from claude_scheduler.console import console
from claude_scheduler.config import get_config, init_config


def get_db():
    from claude_scheduler.core.db import Database
    cfg = get_config()
    cfg.paths.data_dir.mkdir(parents=True, exist_ok=True)
    return Database(cfg.paths.data_dir / "scheduler.db")


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


# ── Init ──

def cmd_init(args):
    cfg = init_config()
    console.print("[green]Initialized claude-scheduler[/green]")
    console.print(f"  Config: {cfg.paths.tasks_dir.parent / 'config.toml'}")
    console.print(f"  Tasks:  {cfg.paths.tasks_dir}")
    console.print(f"  Logs:   {cfg.paths.logs_dir}")
    console.print(f"  Data:   {cfg.paths.data_dir}")
    console.print("\nNext: [bold]cs new[/bold] to create your first task")


# ── Serve ──

def cmd_serve(args):
    cfg = get_config()
    port = args.port or cfg.server.port
    host = cfg.server.host

    if args.install:
        from claude_scheduler.core.platform import install_service
        install_service(port, "cs")
        return
    if args.uninstall:
        from claude_scheduler.core.platform import uninstall_service
        uninstall_service()
        return

    import uvicorn
    from claude_scheduler.web.app import app
    console.print(f"Dashboard at [bold]http://{host}:{port}[/bold]")
    uvicorn.run(app, host=host, port=port, log_level="info")


# ── Task management ──

TASK_TEMPLATE = """\
# name: {name}
# schedule: {schedule}
# workdir: {workdir}
# model: claude-sonnet-4-6
# tools: Read,Grep,Glob
# max_turns: 10
# timeout: 300
# retry: 1
# notify: errors
# on_failure: investigate
# enabled: true
---
{prompt}
"""

def cmd_new(args):
    import os, subprocess
    cfg = get_config()
    tasks_dir = cfg.paths.tasks_dir
    tasks_dir.mkdir(parents=True, exist_ok=True)

    if args.edit:
        edit_path = Path(args.edit)
        if not edit_path.exists():
            console.print(f"[red]File not found: {edit_path}[/red]")
            return
        editor = os.environ.get("EDITOR", "vim")
        subprocess.call([editor, str(edit_path)])
        console.print(f"[green]Updated:[/green] {edit_path}")
        return

    name = args.name or input("Task name: ").strip()
    slug = name.lower().replace(" ", "-").strip("-")
    path = tasks_dir / f"{slug}.task"

    if args.prompt:
        schedule = args.schedule or "daily 09:00"
        workdir = args.workdir or str(Path.home() / "workspace")
        path.write_text(TASK_TEMPLATE.format(
            name=name, schedule=schedule,
            workdir=workdir, prompt=args.prompt + "\n",
        ))
        console.print(f"[green]Created:[/green] {path}")
        console.print(f"[bold]Edit:[/bold]    cs new --edit {path}")
        console.print(f"[bold]Test:[/bold]    cs run {path} --dry-run")
    else:
        schedule = args.schedule or input("Schedule (daily HH:MM / weekly DAY HH:MM / every Nh): ").strip()
        workdir = args.workdir or input(f"Working directory [{Path.home() / 'workspace'}]: ").strip()
        workdir = workdir or str(Path.home() / "workspace")

        template = TASK_TEMPLATE.format(
            name=name, schedule=schedule, workdir=workdir,
            prompt="# Write your prompt here.\n# Multi-line supported.\n",
        )
        path.write_text(template)

        editor = os.environ.get("EDITOR", "vim")
        console.print(f"\n[bold]Opening {editor} for prompt...[/bold]\n")
        subprocess.call([editor, str(path)])

        if not path.exists() or path.stat().st_size == 0:
            console.print("[red]Aborted — empty file.[/red]")
            return

        console.print(f"[green]Created:[/green] {path}")
        console.print(f"[bold]Test:[/bold]    cs run {path} --dry-run")


def _set_enabled(slug: str, enabled: bool):
    import re
    cfg = get_config()
    tasks_dir = cfg.paths.tasks_dir
    tasks_dir.mkdir(parents=True, exist_ok=True)
    for f in tasks_dir.glob("*.task"):
        text = f.read_text()
        if "# name:" in text:
            name_match = re.search(r'^# name:\s+(.+)$', text, re.MULTILINE)
            if name_match:
                name = name_match.group(1).strip()
                task_slug = name.lower().replace(" ", "-").strip("-")
                if task_slug == slug:
                    val = "true" if enabled else "false"
                    if re.search(r'^# enabled:', text, re.MULTILINE):
                        text = re.sub(r'^(# enabled:)\s+\w+', f'\\1 {val}', text,
                                      flags=re.MULTILINE)
                    else:
                        text = text.replace("\n---", f"\n# enabled: {val}\n---", 1)
                    f.write_text(text)
                    if enabled:
                        console.print(f"[green]Enabled[/green]: {name}")
                    else:
                        console.print(f"[red]Disabled[/red]: {name}")
                    return
    console.print(f"[red]Task with slug '{slug}' not found[/red]")

def cmd_delete(args):
    import re
    cfg = get_config()
    tasks_dir = cfg.paths.tasks_dir
    for f in tasks_dir.glob("*.task"):
        text = f.read_text()
        name_match = re.search(r'^# name:\s+(.+)$', text, re.MULTILINE)
        if name_match:
            name = name_match.group(1).strip()
            task_slug = name.lower().replace(" ", "-").strip("-")
            if task_slug == args.task_slug:
                if not args.force:
                    confirm = input(f"Delete task '{name}' ({f})? [y/N] ").strip().lower()
                    if confirm != "y":
                        console.print("[dim]Cancelled.[/dim]")
                        return
                f.unlink()
                console.print(f"[green]Deleted[/green]: {name} ({f.name})")
                return
    console.print(f"[red]Task with slug '{args.task_slug}' not found[/red]")

def cmd_enable(args):
    _set_enabled(args.task_slug, True)

def cmd_disable(args):
    _set_enabled(args.task_slug, False)


# ── Install / Uninstall launchd agents ──

def cmd_install(args):
    import shutil
    cfg = get_config()
    cs_path = shutil.which("cs")
    if not cs_path:
        console.print("[red]cs not found in PATH[/red]")
        return
    from claude_scheduler.core.launchd import install
    install(cfg.paths.tasks_dir, cfg.paths.logs_dir, cs_path, dry_run=args.dry_run)

def cmd_uninstall(args):
    from claude_scheduler.core.launchd import uninstall
    uninstall()


# ── Execution ──

def cmd_run(args):
    from claude_scheduler.core.parser import parse_task
    task = parse_task(Path(args.task_file))
    if args.dry_run:
        from claude_scheduler.core.executor import build_claude_command
        cmd = build_claude_command(task)
        t = Table(show_header=False, box=None)
        t.add_row("[bold]Task[/bold]", task.name)
        t.add_row("[bold]Schedule[/bold]", task.schedule)
        t.add_row("[bold]Workdir[/bold]", task.workdir or "(current)")
        t.add_row("[bold]Model[/bold]", task.model)
        t.add_row("[bold]Tools[/bold]", task.tools)
        t.add_row("[bold]Turns[/bold]", str(task.max_turns))
        t.add_row("[bold]Timeout[/bold]", f"{task.timeout}s")
        t.add_row("[bold]Retry[/bold]", f"{task.retry}x (delay: {task.retry_delay}s)")
        t.add_row("[bold]On fail[/bold]", task.on_failure)
        t.add_row("[bold]Command[/bold]", f"{' '.join(cmd[:6])}...")
        console.print(t)
        return
    db = get_db()
    cfg = get_config()
    from claude_scheduler.core.orchestrator import Orchestrator
    orch = Orchestrator(cfg.paths.tasks_dir, cfg.paths.logs_dir, db)
    orch.run_single(task)
    db.close()

def cmd_run_all(args):
    db = get_db()
    cfg = get_config()
    from claude_scheduler.core.orchestrator import Orchestrator
    orch = Orchestrator(cfg.paths.tasks_dir, cfg.paths.logs_dir, db)
    results = orch.run_schedule(args.schedule or "all")
    console.print(f"\nResults: [green]{results['success']}[/green]/{results['total']} succeeded, [red]{results['failed']}[/red] failed")
    db.close()


# ── Monitoring ──

def cmd_status(args):
    from claude_scheduler.core import monitor
    db = get_db()
    cfg = get_config()
    monitor.show_status(db, cfg.paths.tasks_dir)
    db.close()

def cmd_history(args):
    from claude_scheduler.core import monitor
    db = get_db()
    monitor.show_history(db, args.task, args.n)
    db.close()

def cmd_errors(args):
    from claude_scheduler.core import monitor
    db = get_db()
    monitor.show_errors(db, args.task)
    db.close()

def cmd_tickets(args):
    from claude_scheduler.core import monitor
    db = get_db()
    monitor.show_tickets(db, args.status)
    db.close()

def cmd_notifications(args):
    from claude_scheduler.core import monitor
    db = get_db()
    if args.mark_read:
        monitor.mark_notifications_read(db)
    elif args.act is not None:
        monitor.act_on_notification(db, args.act)
    else:
        monitor.show_notifications(db, unread_only=not args.all)
    db.close()

def cmd_doctor(args):
    from claude_scheduler.core import monitor
    db = get_db()
    cfg = get_config()
    monitor.show_doctor(db, cfg.paths.tasks_dir, cfg.paths.logs_dir)
    db.close()

def cmd_dashboard(args):
    db = get_db()
    cfg = get_config()
    from claude_scheduler.core.tui import run_tui
    run_tui(db, cfg.paths.tasks_dir, cfg.paths.logs_dir)
    db.close()

def cmd_logs(args):
    import subprocess
    cfg = get_config()
    files = sorted(cfg.paths.logs_dir.glob(f"*{args.task}*"), key=lambda f: f.stat().st_mtime)
    if not files:
        console.print(f"[dim]No logs found for '{args.task}'[/dim]")
        return
    latest = files[-1]
    if args.follow:
        subprocess.run(["tail", "-f", str(latest)])
    else:
        print(latest.read_text())


# ── Remediation & Approvals ──

def cmd_remediate(args):
    db = get_db()
    cfg = get_config()
    from claude_scheduler.core.orchestrator import Orchestrator
    orch = Orchestrator(cfg.paths.tasks_dir, cfg.paths.logs_dir, db)
    orch.remediate_ticket(args.ticket_id, args.guidance or "")
    db.close()

def cmd_approvals(args):
    db = get_db()
    approvals = db.get_pending_approvals()
    if not approvals:
        console.print("[dim]No pending approvals.[/dim]")
        db.close()
        return
    t = Table(title="Pending Approvals")
    t.add_column("ID", style="bold")
    t.add_column("Task")
    t.add_column("Artifact")
    t.add_column("Created")
    for a in approvals:
        created = a["created_at"][:19] if a["created_at"] else "-"
        t.add_row(str(a["id"]), a["task_name"], f"#{a['artifact_id']}", created)
    console.print(t)
    db.close()

def cmd_approve(args):
    db = get_db()
    db.update_approval(args.approval_id, "approved", args.note or "")
    console.print(f"[green]Approval #{args.approval_id} approved.[/green]")
    db.close()

def cmd_reject(args):
    db = get_db()
    db.update_approval(args.rejection_id, "rejected", args.note or "")
    console.print(f"[red]Approval #{args.rejection_id} rejected.[/red]")
    db.close()

def cmd_artifacts(args):
    db = get_db()
    artifacts = db.get_artifacts(args.task_name)
    if not artifacts:
        console.print(f"[dim]No artifacts for '{args.task_name}'.[/dim]")
        db.close()
        return
    for a in artifacts:
        console.print(Panel(
            a["content"][:2000],
            title=f"Artifact #{a['id']} ({a['artifact_type']}) -- {a['created_at'][:19]}"))
    db.close()


# ── Course feedback ──

def cmd_feedback(args):
    """Record feedback for a course lesson."""
    import json
    course_dir = Path.home() / ".config" / "claude-scheduler" / "courses" / args.course
    progress_file = course_dir / "progress.json"
    if not progress_file.exists():
        console.print(f"[red]Course '{args.course}' not found[/red]")
        return
    data = json.loads(progress_file.read_text())
    entry = {
        "day": data["current_day"] - 1,
        "rating": args.rating,
        "note": args.note or "",
    }
    data.setdefault("feedback", []).append(entry)
    progress_file.write_text(json.dumps(data, indent=2))
    console.print(f"[green]Feedback recorded[/green] for day {entry['day']}: rating {args.rating}/5")


# ── Workflow ──

def cmd_workflow_run(args):
    from claude_scheduler.workflow.parser import parse_workflow
    from claude_scheduler.workflow.runner import WorkflowRunner
    cfg = get_config()
    wf = parse_workflow(Path(args.workflow_file))
    if args.dry_run:
        t = Table(show_header=False, box=None)
        t.add_row("[bold]Workflow[/bold]", wf.name)
        t.add_row("[bold]Trigger[/bold]", wf.trigger)
        t.add_row("[bold]Steps[/bold]", str(len(wf.steps)))
        t.add_row("[bold]Security[/bold]", wf.security_level)
        for s in wf.steps:
            t.add_row(f"  Step {s.order}", s.description)
        console.print(t)
        return
    runner = WorkflowRunner(logs_dir=cfg.paths.logs_dir)
    result = runner.run(wf)
    if result["status"] == "success":
        console.print(f"[green]Workflow '{wf.name}' completed successfully[/green]")
    else:
        console.print(f"[red]Workflow '{wf.name}' failed at step {result.get('failed_step')}[/red]")

def cmd_workflow_list(args):
    from claude_scheduler.workflow.parser import find_workflows
    cfg = get_config()
    workflows = find_workflows(cfg.paths.tasks_dir)
    if not workflows:
        console.print("[dim]No workflows found.[/dim]")
        return
    t = Table(title="Workflows")
    t.add_column("Name")
    t.add_column("Trigger")
    t.add_column("Steps")
    t.add_column("Security")
    for wf in workflows:
        t.add_row(wf.name, wf.trigger, str(len(wf.steps)), wf.security_level)
    console.print(t)

def cmd_workflow_from_sop(args):
    console.print("[yellow]SOP converter will be implemented in Phase 5[/yellow]")


# ── Gateway ──

def cmd_gateway_audit(args):
    from claude_scheduler.gateway.audit import AuditLogger
    cfg = get_config()
    logger = AuditLogger(cfg.paths.data_dir / "audit.jsonl")
    entries = logger.query(task=args.task or "")
    if not entries:
        console.print("[dim]No audit entries found.[/dim]")
        return
    t = Table(title="Audit Log")
    t.add_column("Time")
    t.add_column("Task")
    t.add_column("Tool")
    t.add_column("Args", max_width=40)
    t.add_column("Decision")
    t.add_column("Reason")
    for e in entries[-50:]:
        style = "green" if e["decision"] == "allow" else "red"
        t.add_row(
            e["ts"][:19], e["task"], e["tool"],
            e.get("args", "")[:40], f"[{style}]{e['decision']}[/{style}]",
            e.get("reason", ""),
        )
    console.print(t)

def cmd_gateway_policy_list(args):
    from claude_scheduler.gateway.policy import load_policies
    cfg = get_config()
    policy_file = cfg.paths.tasks_dir.parent / "policies" / "default.toml"
    if not policy_file.exists():
        console.print(f"[dim]No policy file at {policy_file}[/dim]")
        return
    policies = load_policies(policy_file)
    for name, p in policies.items():
        console.print(Panel(
            f"Tools: {', '.join(p.allowed_tools)}\n"
            f"Denied: {', '.join(p.denied_patterns)}\n"
            f"Bash: {', '.join(p.bash_allowlist) or 'any'}\n"
            f"Approval: {', '.join(p.require_approval) or 'none'}\n"
            f"Rate: {p.max_calls_per_minute}/min\n"
            f"Network isolation: {p.network_isolation}",
            title=f"Policy: {name}",
        ))


# ── Debate ──

def cmd_debate(args):
    from apps.socratic_bot.debate import DebateSession
    from apps.socratic_bot.scorer import build_scoring_prompt, parse_score
    import subprocess, json

    mode = args.mode or "socratic"
    topic = args.topic or ""
    session = DebateSession(mode=mode)

    console.print(f"[bold]Debate mode: {mode}[/bold]")
    if topic:
        console.print(f"[dim]Topic: {topic}[/dim]")
    console.print("[dim]Type 'quit' to end, 'score' to get scored[/dim]\n")

    if topic:
        response = session.send(topic)
        console.print(f"[cyan]Bot:[/cyan] {response}\n")

    while True:
        try:
            user_input = input("You: ").strip()
        except (EOFError, KeyboardInterrupt):
            break
        if not user_input:
            continue
        if user_input.lower() == "quit":
            break
        if user_input.lower() == "score":
            prompt = build_scoring_prompt(session.history)
            cmd = ["claude", "-p", prompt, "--output-format", "json"]
            proc = subprocess.run(cmd, capture_output=True, timeout=120)
            score = parse_score(proc.stdout.decode(errors="replace"))
            console.print(Panel(
                f"Logic: {score.get('logic', 0)}/5\n"
                f"Evidence: {score.get('evidence', 0)}/5\n"
                f"Counterarguments: {score.get('counterarguments', 0)}/5\n"
                f"Clarity: {score.get('clarity', 0)}/5\n"
                f"Overall: {score.get('overall', 0)}/5\n"
                f"Feedback: {score.get('feedback', '')}",
                title="Argument Score",
            ))
            continue
        response = session.send(user_input)
        console.print(f"\n[cyan]Bot:[/cyan] {response}\n")

    summary = session.summary()
    console.print(f"\n[dim]Session: {summary['turns']} turns, mode: {summary['mode']}[/dim]")


# ── Journal ──

def cmd_journal(args):
    from claude_scheduler.journal.daily import get_daily_prompt
    from claude_scheduler.journal.reviewer import build_review_prompt
    from claude_scheduler.journal.tracker import JournalTracker
    import os, subprocess, tempfile, json
    from datetime import date

    cfg = get_config()
    tracker = JournalTracker(cfg.paths.data_dir / "journal.db")

    prompt = get_daily_prompt()
    console.print(Panel(prompt, title="Today's Prompt"))
    console.print("[dim]Opening editor... Write 200-500 words, then save and close.[/dim]\n")

    with tempfile.NamedTemporaryFile(mode="w", suffix=".md", delete=False) as f:
        f.write(f"# Journal Entry - {date.today()}\n\nPrompt: {prompt}\n\n---\n\n")
        tmp_path = f.name

    editor = os.environ.get("EDITOR", "vim")
    subprocess.call([editor, tmp_path])

    text = Path(tmp_path).read_text()
    # Extract just the user's writing (after the ---)
    if "---" in text:
        text = text.split("---", 1)[1].strip()

    if len(text) < 10:
        console.print("[red]Entry too short. Skipping review.[/red]")
        Path(tmp_path).unlink()
        return

    word_count = len(text.split())
    console.print(f"[green]Written: {word_count} words[/green]")
    console.print("[dim]Reviewing with Claude...[/dim]")

    review_prompt = build_review_prompt(text)
    cmd = ["claude", "-p", review_prompt, "--output-format", "json"]
    proc = subprocess.run(cmd, capture_output=True, timeout=120)

    try:
        data = json.loads(proc.stdout.decode(errors="replace"))
        review = json.loads(data.get("result", "{}")) if isinstance(data.get("result"), str) else data
    except (json.JSONDecodeError, TypeError):
        review = {}

    if review:
        console.print(Panel(
            f"Grammar: {review.get('grammar_score', '?')}/5\n"
            f"Vocabulary: {review.get('vocabulary_score', '?')}/5\n"
            f"Reasoning: {review.get('reasoning_score', '?')}/5\n"
            f"Feedback: {review.get('overall_feedback', 'N/A')}",
            title="Review",
        ))
        tracker.record_session(
            str(date.today()), prompt, text,
            review.get("grammar_score", 0),
            review.get("vocabulary_score", 0),
            review.get("reasoning_score", 0),
            word_count,
        )

    Path(tmp_path).unlink(missing_ok=True)

def cmd_journal_stats(args):
    from claude_scheduler.journal.tracker import JournalTracker
    cfg = get_config()
    tracker = JournalTracker(cfg.paths.data_dir / "journal.db")
    stats = tracker.get_stats()
    streak = tracker.get_streak()
    t = Table(show_header=False, box=None, title="Journal Stats")
    t.add_row("[bold]Total sessions[/bold]", str(stats["total_sessions"]))
    t.add_row("[bold]Avg grammar[/bold]", f"{stats['avg_grammar']}/5")
    t.add_row("[bold]Avg vocabulary[/bold]", f"{stats['avg_vocab']}/5")
    t.add_row("[bold]Avg reasoning[/bold]", f"{stats['avg_reasoning']}/5")
    t.add_row("[bold]Avg words[/bold]", str(stats["avg_words"]))
    t.add_row("[bold]Current streak[/bold]", f"{streak} days")
    console.print(t)

def cmd_journal_streak(args):
    from claude_scheduler.journal.tracker import JournalTracker
    cfg = get_config()
    tracker = JournalTracker(cfg.paths.data_dir / "journal.db")
    streak = tracker.get_streak()
    if streak > 0:
        console.print(f"[green]Current streak: {streak} day{'s' if streak != 1 else ''}[/green]")
    else:
        console.print("[dim]No streak. Start journaling today![/dim]")


# ── Speaking Coach ──

def cmd_speak(args):
    from apps.speaking_coach.session import SpeakingSession
    scenario = getattr(args, "scenario", None) or "free"
    session = SpeakingSession(scenario=scenario)
    opening = session.get_opening()
    console.print(f"[bold]Scenario: {session.scenario_info['name']}[/bold]")
    console.print(f"\n[cyan]Coach:[/cyan] {opening}\n")
    console.print("[dim]Type 'quit' to end session[/dim]\n")

    while True:
        try:
            user_input = input("You: ").strip()
        except (EOFError, KeyboardInterrupt):
            break
        if not user_input or user_input.lower() == "quit":
            break
        ev = session.evaluate_response(user_input)
        if ev.get("natural_response"):
            console.print(f"\n[cyan]Coach:[/cyan] {ev['natural_response']}")
        if ev.get("grammar_corrections"):
            console.print(f"[yellow]Corrections:[/yellow] {', '.join(ev['grammar_corrections'])}")
        if ev.get("tip"):
            console.print(f"[green]Tip:[/green] {ev['tip']}\n")

    summary = session.get_summary()
    if summary.get("turns", 0) > 0:
        console.print(Panel(
            f"Turns: {summary['turns']}\n"
            f"Grammar: {summary['avg_grammar']}/5\n"
            f"Vocabulary: {summary['avg_vocabulary']}/5\n"
            f"Fluency: {summary['avg_fluency']}/5",
            title="Session Summary",
        ))

def cmd_speak_progress(args):
    from apps.speaking_coach.progress import SpeakingTracker
    cfg = get_config()
    tracker = SpeakingTracker(cfg.paths.data_dir / "speaking.db")
    progress = tracker.get_progress()
    t = Table(show_header=False, box=None, title="Speaking Progress")
    t.add_row("[bold]Total sessions[/bold]", str(progress["total_sessions"]))
    t.add_row("[bold]Total turns[/bold]", str(progress["total_turns"]))
    t.add_row("[bold]Avg grammar[/bold]", f"{progress['avg_grammar']}/5")
    t.add_row("[bold]Avg vocabulary[/bold]", f"{progress['avg_vocabulary']}/5")
    t.add_row("[bold]Avg fluency[/bold]", f"{progress['avg_fluency']}/5")
    t.add_row("[bold]Avg overall[/bold]", f"{progress['avg_overall']}/5")
    console.print(t)


# ── Demo ──

def cmd_demo(args):
    from claude_scheduler.demo.runner import run_demo, run_all_demos
    from claude_scheduler.demo.scripts import list_demos as _list_demos

    workdir = str(Path(__file__).parent.parent.parent)  # automation-hub root

    if args.demo_name == "list":
        print("\nAvailable Demos\n")
        for d in _list_demos():
            print(f"  {d['key']:<12} {d['description']}")
        print(f"\nUsage: cs demo <name> [--gif] [--no-record]")
        print(f"       cs demo all    — run all demos")
        print(f"       cs demo clear  — delete recorded files\n")
        return

    record = not args.no_record
    to_gif = args.gif

    if args.demo_name == "clear":
        from claude_scheduler.demo.recorder import get_output_dir
        demo_dir = get_output_dir()
        count = 0
        for f in demo_dir.iterdir():
            if f.suffix in (".cast", ".gif", ".txt", ".mov", ".mp4"):
                f.unlink()
                count += 1
        console.print(f"[green]Cleared {count} demo files from {demo_dir}[/green]")
        return

    if args.demo_name == "all":
        paths = run_all_demos(record=record, workdir=workdir, to_gif=to_gif)
        if paths:
            console.print("\n[green]Recordings saved:[/green]")
            for p in paths:
                console.print(f"  {p}")
    else:
        path = run_demo(args.demo_name, record=record, workdir=workdir, to_gif=to_gif)
        if path:
            console.print(f"\n[green]Recording saved:[/green] {path}")


# ── Knowledge Base ──

def cmd_kb_search(args):
    from apps.knowledge_base.search import VaultSearch
    cfg = get_config()
    search = VaultSearch(cfg.paths.data_dir / "kb_index.db")
    results = search.search(args.query)
    if not results:
        console.print("[dim]No results found.[/dim]")
        return
    for r in results:
        console.print(f"[bold]{r['title']}[/bold] ({r['path']})")
        if r.get("snippet"):
            console.print(f"  {r['snippet'][:200]}")
        console.print()

def cmd_kb_reindex(args):
    from apps.knowledge_base.indexer import VaultIndexer
    cfg = get_config()
    vault_path = args.vault or str(Path.home() / "Documents" / "Obsidian")
    indexer = VaultIndexer(cfg.paths.data_dir / "kb_index.db")
    stats = indexer.index_vault(Path(vault_path))
    console.print(f"[green]Indexed: {stats['indexed']}, Skipped: {stats['skipped']}, Errors: {stats['errors']}[/green]")

def cmd_kb_ask(args):
    from apps.knowledge_base.search import VaultSearch
    from apps.knowledge_base.synthesizer import synthesize
    cfg = get_config()
    search = VaultSearch(cfg.paths.data_dir / "kb_index.db")
    results = search.search(args.question, limit=5)
    if not results:
        console.print("[dim]No relevant notes found.[/dim]")
        return
    answer = synthesize(args.question, results)
    console.print(Panel(answer, title="Answer"))


# ── Accounts ──

def cmd_accounts_list(args):
    db = get_db()
    accounts = db.list_accounts()
    if not accounts:
        console.print("[dim]No accounts configured. Try: cs accounts add <name>[/dim]")
        return
    t = Table(title="Claude accounts")
    t.add_column("Name")
    t.add_column("Kind")
    t.add_column("Ref")
    t.add_column("Plan")
    t.add_column("Default")
    t.add_column("Last used")
    for a in accounts:
        ref = a.config_dir or a.api_key_ref or ""
        t.add_row(
            a.name,
            a.kind,
            ref,
            a.plan_tier or "-",
            "★" if a.is_default else "",
            a.last_used_at or "-",
        )
    console.print(t)


def cmd_accounts_discover(args):
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
        registered_as = "-"
        for account in accounts:
            account_dir = _normalized_config_dir(account.config_dir)
            if account_dir and account_dir == config_dir:
                registered_as = account.name
                break

        rows.append({
            "name_suggestion": expanded.name.lstrip(".").lower(),
            "config_dir": config_dir,
            "dir_exists": "yes" if dir_exists else "no",
            "has_credentials": "yes" if has_credentials else "no",
            "registered_as": registered_as,
        })

    t = Table(title="Claude config dirs")
    t.add_column("name_suggestion")
    t.add_column("config_dir")
    t.add_column("dir_exists")
    t.add_column("has_credentials")
    t.add_column("registered_as")
    for row in rows:
        t.add_row(
            row["name_suggestion"],
            row["config_dir"],
            row["dir_exists"],
            row["has_credentials"],
            row["registered_as"],
        )
    console.print(t)


def cmd_accounts_add(args):
    import os
    import subprocess
    from pathlib import Path

    db = get_db()
    if db.get_account_by_name(args.name):
        console.print(f"[red]Account '{args.name}' already exists[/red]")
        sys.exit(1)

    if args.kind == "config_dir":
        config_dir = Path(args.config_dir).expanduser() if args.config_dir else Path.home() / ".claude-profiles" / args.name
        config_dir.mkdir(parents=True, exist_ok=True)
        try:
            config_dir.chmod(0o700)
        except OSError:
            pass
        if not args.no_login:
            console.print(f"[bold]Launching claude /login for {args.name}...[/bold]")
            console.print(f"  CLAUDE_CONFIG_DIR={config_dir}")
            env = {**os.environ, "CLAUDE_CONFIG_DIR": str(config_dir)}
            try:
                subprocess.run(["claude", "/login"], env=env, check=False)
            except FileNotFoundError:
                console.print("[red]`claude` CLI not found in PATH[/red]")
                sys.exit(1)
            cred = config_dir / ".credentials.json"
            if not cred.exists():
                console.print(f"[red]Login did not produce credentials at {cred}[/red]")
                console.print("[dim]Re-run with `--no-login` if you want to register anyway.[/dim]")
                sys.exit(1)
        acct = db.create_account(
            args.name,
            "config_dir",
            config_dir=str(config_dir),
            plan_tier=args.plan_tier,
            is_default=args.default,
        )
    else:
        ref = args.api_key_ref
        if not (ref.startswith("keychain:") or ref.startswith("op://")):
            console.print("[red]--api-key-ref must start with 'keychain:' or 'op://'[/red]")
            sys.exit(1)
        acct = db.create_account(
            args.name,
            "api_key",
            api_key_ref=ref,
            plan_tier=args.plan_tier or "api",
            is_default=args.default,
        )
    console.print(f"[green]Created account '{acct.name}' ({acct.kind})[/green]")
    if acct.is_default:
        console.print("  [dim]Set as default.[/dim]")


def cmd_accounts_import(args):
    db = get_db()
    try:
        try:
            expanded = Path(args.config_dir).expanduser().resolve()
        except (OSError, RuntimeError, ValueError):
            console.print("[red]config_dir does not exist[/red]")
            sys.exit(1)

        if not expanded.is_dir():
            console.print("[red]config_dir does not exist[/red]")
            sys.exit(1)
        if not args.skip_credentials_check and not _has_claude_credentials(expanded):
            console.print("[red]no Claude credentials found for this dir; run `claude /login` with CLAUDE_CONFIG_DIR=<dir> first, or pass skip_credentials_check=true[/red]")
            sys.exit(1)

        for account in db.list_accounts():
            account_dir = _normalized_config_dir(account.config_dir)
            if account_dir == str(expanded):
                console.print(f"[red]config_dir already registered as {account.name}[/red]")
                sys.exit(1)
        try:
            acct = db.create_account(
                args.name,
                "config_dir",
                config_dir=str(expanded),
                plan_tier=args.plan_tier,
                is_default=args.default,
            )
        except sqlite3.IntegrityError as e:
            console.print(f"[red]{e}[/red]")
            sys.exit(1)
    finally:
        db.close()

    console.print(f"[green]Imported[/green] id={acct.id} name={acct.name}")


def cmd_accounts_remove(args):
    db = get_db()
    acct = db.get_account_by_name(args.name)
    if not acct:
        console.print(f"[red]No account named '{args.name}'[/red]")
        sys.exit(1)
    if not args.force:
        ans = input(f"Delete account '{args.name}' ({acct.kind})? [y/N] ").strip().lower()
        if ans not in ("y", "yes"):
            console.print("[dim]Aborted.[/dim]")
            return
    db.delete_account(acct.id)
    console.print(f"[green]Removed account '{acct.name}'[/green]")
    if acct.config_dir:
        console.print(f"  [dim]Profile dir not deleted: {acct.config_dir}[/dim]")
        console.print(f"  [dim]rm -rf {acct.config_dir}  # to remove credentials[/dim]")


def cmd_accounts_set_default(args):
    db = get_db()
    acct = db.get_account_by_name(args.name)
    if not acct:
        console.print(f"[red]No account named '{args.name}'[/red]")
        sys.exit(1)
    db.set_default_account(acct.id)
    console.print(f"[green]Default account: '{acct.name}'[/green]")


# ── Argument parser ──

def main():
    parser = argparse.ArgumentParser(
        prog="cs",
        description="Claude Scheduler — scheduled AI tasks for Claude Code",
    )
    parser.add_argument("--version", "-V", action="version", version=f"claude-scheduler {__version__}")
    sub = parser.add_subparsers(dest="command", required=True)

    # init
    p = sub.add_parser("init", help="First-time setup")
    p.set_defaults(func=cmd_init)

    # serve
    p = sub.add_parser("serve", help="Start web dashboard")
    p.add_argument("--port", "-p", type=int, default=None, help="Port (default: from config)")
    p.add_argument("--install", action="store_true", help="Install as system service (auto-start on login)")
    p.add_argument("--uninstall", action="store_true", help="Remove system service")
    p.set_defaults(func=cmd_serve)

    # new
    p = sub.add_parser("new", help="Create a new task")
    p.add_argument("--name", help="Task name")
    p.add_argument("--schedule", help="Schedule (e.g. 'daily 09:00', 'every 2h')")
    p.add_argument("--workdir", help="Working directory")
    p.add_argument("--prompt", help="Inline prompt (skips editor)")
    p.add_argument("--edit", metavar="FILE", help="Open existing .task file in $EDITOR")
    p.set_defaults(func=cmd_new)

    # enable / disable
    p = sub.add_parser("enable", help="Enable a task")
    p.add_argument("task_slug")
    p.set_defaults(func=cmd_enable)

    p = sub.add_parser("disable", help="Disable a task")
    p.add_argument("task_slug")
    p.set_defaults(func=cmd_disable)

    p = sub.add_parser("delete", help="Delete a task")
    p.add_argument("task_slug")
    p.add_argument("--force", "-f", action="store_true", help="Skip confirmation")
    p.set_defaults(func=cmd_delete)

    p = sub.add_parser("install", help="Install launchd agents for all enabled tasks")
    p.add_argument("--dry-run", action="store_true", help="Preview without installing")
    p.set_defaults(func=cmd_install)

    p = sub.add_parser("uninstall", help="Remove all launchd agents")
    p.set_defaults(func=cmd_uninstall)

    # run
    p = sub.add_parser("run", help="Run a single task")
    p.add_argument("task_file")
    p.add_argument("--dry-run", action="store_true", help="Preview without executing")
    p.set_defaults(func=cmd_run)

    p = sub.add_parser("run-all", help="Run all enabled tasks")
    p.add_argument("--schedule", "-s", default="all")
    p.set_defaults(func=cmd_run_all)

    # monitoring
    p = sub.add_parser("status", help="Task status dashboard")
    p.set_defaults(func=cmd_status)

    p = sub.add_parser("history", help="Run history")
    p.add_argument("--task", "-t")
    p.add_argument("-n", type=int, default=20)
    p.set_defaults(func=cmd_history)

    p = sub.add_parser("errors", help="Error log")
    p.add_argument("--task", "-t")
    p.set_defaults(func=cmd_errors)

    p = sub.add_parser("tickets", help="Remediation tickets")
    p.add_argument("--status", "-s")
    p.set_defaults(func=cmd_tickets)

    p = sub.add_parser("notifications", help="Notification inbox")
    p.add_argument("--all", "-a", action="store_true", help="Show all (inc. read)")
    p.add_argument("--mark-read", action="store_true")
    p.add_argument("--act", type=int, metavar="ID")
    p.set_defaults(func=cmd_notifications)

    # accounts
    acc_parser = sub.add_parser("accounts", help="Manage Claude accounts")
    acc_sub = acc_parser.add_subparsers(dest="acc_command", required=True)

    p = acc_sub.add_parser("list", help="List configured accounts")
    p.set_defaults(func=cmd_accounts_list)

    p = acc_sub.add_parser("add", help="Add a new account")
    p.add_argument("name")
    p.add_argument("--kind", choices=["config_dir", "api_key"], default="config_dir")
    p.add_argument("--config-dir", help="Profile dir (default ~/.claude-profiles/<name>)")
    p.add_argument("--api-key-ref", help="keychain:<name> or op://Vault/Item/field")
    p.add_argument("--plan-tier", choices=["pro", "max", "team", "api"])
    p.add_argument("--default", action="store_true", help="Set as default account")
    p.add_argument("--no-login", action="store_true", help="Skip claude /login (config_dir only)")
    p.set_defaults(func=cmd_accounts_add)

    p = acc_sub.add_parser("remove", help="Delete an account record")
    p.add_argument("name")
    p.add_argument("--force", "-f", action="store_true")
    p.set_defaults(func=cmd_accounts_remove)

    p = acc_sub.add_parser("discover", help="Discover importable config dirs")
    p.set_defaults(func=cmd_accounts_discover)

    p = acc_sub.add_parser("import", help="Import an existing config dir")
    p.add_argument("name")
    p.add_argument("--config-dir", required=True, help="Existing Claude config dir")
    p.add_argument("--plan-tier", choices=["pro", "max", "team", "api"])
    p.add_argument("--default", action="store_true", help="Set as default account")
    p.add_argument("--no-credentials-check", dest="skip_credentials_check", action="store_true", help="Import even if no credentials are detected")
    p.set_defaults(func=cmd_accounts_import)

    p = acc_sub.add_parser("set-default", help="Set the default account")
    p.add_argument("name")
    p.set_defaults(func=cmd_accounts_set_default)

    p = sub.add_parser("doctor", help="Health check")
    p.set_defaults(func=cmd_doctor)

    p = sub.add_parser("dashboard", help="TUI dashboard")
    p.set_defaults(func=cmd_dashboard)

    p = sub.add_parser("logs", help="View task logs")
    p.add_argument("task")
    p.add_argument("--follow", "-f", action="store_true")
    p.set_defaults(func=cmd_logs)

    # remediation & approvals
    p = sub.add_parser("remediate", help="Trigger ticket remediation")
    p.add_argument("ticket_id", type=int)
    p.add_argument("--guidance", "-g")
    p.set_defaults(func=cmd_remediate)

    p = sub.add_parser("approvals", help="List pending approvals")
    p.set_defaults(func=cmd_approvals)

    p = sub.add_parser("approve", help="Approve a pending item")
    p.add_argument("approval_id", type=int)
    p.add_argument("--note", "-n")
    p.set_defaults(func=cmd_approve)

    p = sub.add_parser("reject", help="Reject a pending item")
    p.add_argument("rejection_id", type=int)
    p.add_argument("--note", "-n")
    p.set_defaults(func=cmd_reject)

    p = sub.add_parser("artifacts", help="Show task artifacts")
    p.add_argument("task_name")
    p.set_defaults(func=cmd_artifacts)

    # course feedback
    p = sub.add_parser("feedback", help="Rate a course lesson")
    p.add_argument("course", help="Course name (e.g. pm-ai-era)")
    p.add_argument("--rating", "-r", type=int, required=True, choices=[1, 2, 3, 4, 5])
    p.add_argument("--note", "-n", help="Optional feedback note")
    p.set_defaults(func=cmd_feedback)

    # workflow
    wf_parser = sub.add_parser("workflow", help="Workflow management")
    wf_sub = wf_parser.add_subparsers(dest="wf_command", required=True)

    p = wf_sub.add_parser("run", help="Run a workflow")
    p.add_argument("workflow_file")
    p.add_argument("--dry-run", action="store_true")
    p.set_defaults(func=cmd_workflow_run)

    p = wf_sub.add_parser("list", help="List workflows")
    p.set_defaults(func=cmd_workflow_list)

    p = wf_sub.add_parser("from-sop", help="Convert SOP to workflow")
    p.add_argument("sop_file")
    p.set_defaults(func=cmd_workflow_from_sop)

    # gateway
    gw_parser = sub.add_parser("gateway", help="Security gateway")
    gw_sub = gw_parser.add_subparsers(dest="gw_command", required=True)

    p = gw_sub.add_parser("audit", help="View audit log")
    p.add_argument("--task", "-t")
    p.set_defaults(func=cmd_gateway_audit)

    p = gw_sub.add_parser("policy", help="List policies")
    p.set_defaults(func=cmd_gateway_policy_list)

    # debate
    p = sub.add_parser("debate", help="Socratic debate bot")
    p.add_argument("--mode", "-m", choices=["socratic", "devil", "steelman"], default="socratic")
    p.add_argument("--topic", "-t")
    p.set_defaults(func=cmd_debate)

    # journal
    j_parser = sub.add_parser("journal", help="Daily reflection journal")
    j_sub = j_parser.add_subparsers(dest="j_command")

    p = j_sub.add_parser("write", help="Write today's entry")
    p.set_defaults(func=cmd_journal)

    p = j_sub.add_parser("stats", help="View journal statistics")
    p.set_defaults(func=cmd_journal_stats)

    p = j_sub.add_parser("streak", help="View current streak")
    p.set_defaults(func=cmd_journal_streak)

    # Set default journal action to write
    j_parser.set_defaults(func=cmd_journal)

    # speak
    sp_parser = sub.add_parser("speak", help="English speaking coach")
    sp_sub = sp_parser.add_subparsers(dest="sp_command")

    p = sp_sub.add_parser("start", help="Start speaking session")
    p.add_argument("--scenario", "-s", choices=["standup", "code_review", "presentation", "interview", "free"], default="free")
    p.set_defaults(func=cmd_speak)

    p = sp_sub.add_parser("progress", help="View speaking progress")
    p.set_defaults(func=cmd_speak_progress)

    sp_parser.set_defaults(func=cmd_speak)

    # kb (knowledge base)
    kb_parser = sub.add_parser("kb", help="Knowledge base (Obsidian bridge)")
    kb_sub = kb_parser.add_subparsers(dest="kb_command", required=True)

    p = kb_sub.add_parser("search", help="Search notes")
    p.add_argument("query")
    p.set_defaults(func=cmd_kb_search)

    p = kb_sub.add_parser("reindex", help="Reindex vault")
    p.add_argument("--vault", "-v", help="Path to Obsidian vault")
    p.set_defaults(func=cmd_kb_reindex)

    p = kb_sub.add_parser("ask", help="Ask a question using your notes")
    p.add_argument("question")
    p.set_defaults(func=cmd_kb_ask)

    # demo
    p = sub.add_parser("demo", help="Record demo videos of tools")
    p.add_argument("demo_name", nargs="?", default="list",
                   help="Demo to run: workflow, gateway, debate, journal, speak, kb, all, list")
    p.add_argument("--no-record", action="store_true", help="Run without recording")
    p.add_argument("--gif", action="store_true", help="Convert to GIF (requires agg)")
    p.set_defaults(func=cmd_demo)

    argcomplete.autocomplete(parser)
    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
