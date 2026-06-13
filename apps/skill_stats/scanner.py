"""Scan Claude Code transcripts for skill usage and cache aggregates in SQLite."""
from __future__ import annotations

import json
import os
import sqlite3
from datetime import date
from glob import glob
from pathlib import Path

PROJECTS_DIR = os.path.expanduser("~/.claude/projects")
DB_PATH = Path(__file__).parent.parent.parent / "claude-scheduler" / "data" / "skill_usage.db"
OWNED_SKILL_GLOB = os.path.expanduser("~/.claude/skills/*/SKILL.md")
OWNED_COMMAND_GLOB = os.path.expanduser("~/.claude/commands/*.md")
ALL_SKILL_GLOB = os.path.expanduser("~/.claude/**/SKILL.md")
ALL_COMMAND_GLOB = os.path.expanduser("~/.claude/**/commands/*.md")


def _ensure_db(db_path: str | Path) -> sqlite3.Connection:
    resolved = Path(db_path)
    resolved.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(resolved))
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS skill_events(
            file TEXT,
            skill TEXT,
            day TEXT,
            count INTEGER,
            PRIMARY KEY(file, skill, day)
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS scan_state(
            file TEXT PRIMARY KEY,
            mtime REAL
        )
        """
    )
    conn.commit()
    return conn


def _safe_resolve(path: Path) -> Path:
    try:
        return path.resolve()
    except OSError:
        return path


def discover_owned() -> dict[str, dict]:
    inventory: dict[str, dict[str, object]] = {}

    for skill_match in glob(OWNED_SKILL_GLOB):
        resolved = _safe_resolve(Path(skill_match))
        name = resolved.parent.name
        entry = inventory.setdefault(name, {"kind": "skill", "sources": set()})
        entry["kind"] = "skill"
        entry["sources"].add(str(resolved.parent.parent))

    for command_match in glob(OWNED_COMMAND_GLOB):
        resolved = _safe_resolve(Path(command_match))
        name = resolved.stem
        entry = inventory.setdefault(name, {"kind": "command", "sources": set()})
        entry["sources"].add(str(resolved.parent))

    return {
        name: {
            "kind": str(entry["kind"]),
            "sources": sorted(str(source) for source in entry["sources"]),
        }
        for name, entry in sorted(inventory.items())
    }


def discover_all() -> set[str]:
    inventory: set[str] = set()

    for skill_match in glob(ALL_SKILL_GLOB, recursive=True):
        resolved = _safe_resolve(Path(skill_match))
        inventory.add(resolved.parent.name)

    for command_match in glob(ALL_COMMAND_GLOB, recursive=True):
        resolved = _safe_resolve(Path(command_match))
        inventory.add(resolved.stem)

    return inventory


def _extract_invocations(line: str) -> list[tuple[str, str]]:
    try:
        obj = json.loads(line)
    except json.JSONDecodeError:
        return []

    timestamp = obj.get("timestamp")
    if not isinstance(timestamp, str) or len(timestamp) < 10:
        return []

    message = obj.get("message")
    if not isinstance(message, dict):
        return []

    content = message.get("content")
    if not isinstance(content, list):
        return []

    invocations: list[tuple[str, str]] = []
    for block in content:
        if not isinstance(block, dict):
            continue
        if block.get("type") != "tool_use" or block.get("name") != "Skill":
            continue
        raw_input = block.get("input")
        if not isinstance(raw_input, dict):
            continue
        skill_name = raw_input.get("skill")
        if not isinstance(skill_name, str) or not skill_name:
            continue
        invocations.append((skill_name.split(":")[-1], timestamp[:10]))
    return invocations


def scan(
    full: bool = False,
    db_path: str | Path | None = None,
    projects_dir: str | Path | None = None,
) -> dict[str, int]:
    target_db = db_path or DB_PATH
    source_dir = Path(projects_dir or PROJECTS_DIR).expanduser()
    conn = _ensure_db(target_db)
    files_scanned = 0
    files_skipped = 0
    invocations_seen = 0

    try:
        state_rows = conn.execute("SELECT file, mtime FROM scan_state").fetchall()
        scan_state = {row[0]: row[1] for row in state_rows}

        if not source_dir.exists():
            return {
                "files_scanned": 0,
                "files_skipped": 0,
                "invocations_seen": 0,
            }

        for path in sorted(source_dir.rglob("*.jsonl")):
            file_key = str(path)
            try:
                mtime = path.stat().st_mtime
            except OSError:
                continue

            if not full and scan_state.get(file_key) == mtime:
                files_skipped += 1
                continue

            counts: dict[tuple[str, str], int] = {}
            try:
                with path.open("r", encoding="utf-8") as handle:
                    for line in handle:
                        invocations = _extract_invocations(line)
                        invocations_seen += len(invocations)
                        for skill_name, day in invocations:
                            counts[(skill_name, day)] = counts.get((skill_name, day), 0) + 1
            except OSError:
                continue

            conn.execute("DELETE FROM skill_events WHERE file = ?", (file_key,))
            if counts:
                conn.executemany(
                    "INSERT INTO skill_events(file, skill, day, count) VALUES (?, ?, ?, ?)",
                    [(file_key, skill, day, count) for (skill, day), count in counts.items()],
                )
            conn.execute(
                "INSERT INTO scan_state(file, mtime) VALUES (?, ?) "
                "ON CONFLICT(file) DO UPDATE SET mtime = excluded.mtime",
                (file_key, mtime),
            )
            files_scanned += 1

        conn.commit()
        return {
            "files_scanned": files_scanned,
            "files_skipped": files_skipped,
            "invocations_seen": invocations_seen,
        }
    finally:
        conn.close()


def aggregate(
    db_path: str | Path | None = None,
    owned: dict[str, dict] | None = None,
    full: set[str] | None = None,
    today: date | None = None,
) -> dict:
    target_db = db_path or DB_PATH
    owned_map = owned if owned is not None else discover_owned()
    full_set = full if full is not None else discover_all()
    conn = _ensure_db(target_db)
    try:
        rows = conn.execute(
            "SELECT skill, day, SUM(count) FROM skill_events GROUP BY skill, day"
        ).fetchall()
    finally:
        conn.close()

    by_skill: dict[str, dict[str, int]] = {}
    history_since: str | None = None
    max_day: str | None = None

    for skill_name, day, count in rows:
        if history_since is None or day < history_since:
            history_since = day
        if max_day is None or day > max_day:
            max_day = day
        skill_days = by_skill.setdefault(skill_name, {})
        skill_days[day] = skill_days.get(day, 0) + int(count)

    if today is None:
        today = date.fromisoformat(max_day) if max_day else date.today()

    top: list[dict] = []
    unmatched: list[dict] = []
    enhance_candidates: list[dict] = []
    used_skill_names: set[str] = set()
    total_invocations = 0

    for skill_name, day_counts in by_skill.items():
        total = sum(day_counts.values())
        last_used = max(day_counts)
        count_7d = sum(
            count
            for day, count in day_counts.items()
            if 0 <= (today - date.fromisoformat(day)).days <= 6
        )
        count_30d = sum(
            count
            for day, count in day_counts.items()
            if 0 <= (today - date.fromisoformat(day)).days <= 29
        )
        if skill_name not in full_set:
            unmatched.append({"name": skill_name, "total": total})
            continue

        total_invocations += total
        owned_entry = owned_map.get(skill_name)
        top.append(
            {
                "name": skill_name,
                "kind": owned_entry["kind"] if owned_entry else None,
                "total": total,
                "count_7d": count_7d,
                "count_30d": count_30d,
                "last_used": last_used,
            }
        )
        if owned_entry:
            used_skill_names.add(skill_name)
            enhance_candidates.append(
                {
                    "name": skill_name,
                    "kind": owned_entry["kind"],
                    "total": total,
                    "count_30d": count_30d,
                    "last_used": last_used,
                }
            )

    retire_candidates = [
        {
            "name": skill_name,
            "kind": owned_map[skill_name]["kind"],
            "sources": owned_map[skill_name]["sources"],
            "last_used": None,
        }
        for skill_name in sorted(owned_map)
        if skill_name not in used_skill_names
    ]

    top.sort(key=lambda item: (-item["total"], item["name"]))
    unmatched.sort(key=lambda item: (-item["total"], item["name"]))
    enhance_candidates.sort(key=lambda item: (-item["count_30d"], -item["total"], item["name"]))

    return {
        "summary": {
            "skills_on_disk": len(owned_map),
            "skills_used": len(used_skill_names),
            "skills_unused": len(owned_map) - len(used_skill_names),
            "total_invocations": total_invocations,
            "history_since": history_since,
        },
        "top": top[:30],
        "retire_candidates": retire_candidates,
        "enhance_candidates": enhance_candidates[:10],
        "unmatched": unmatched[:30],
    }


if __name__ == "__main__":
    scan(full=True)
    print(json.dumps(aggregate()["summary"], indent=2))
