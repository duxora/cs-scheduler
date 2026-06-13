"""Scan Claude Code transcripts for skill usage and cache aggregates in SQLite."""
from __future__ import annotations

import json
import os
import re
import sqlite3
import subprocess
from datetime import date
from glob import glob
from pathlib import Path
from typing import Any

PROJECTS_DIR = os.path.expanduser("~/.claude/projects")
DB_PATH = Path(__file__).parent.parent.parent / "claude-scheduler" / "data" / "skill_usage.db"
OWNED_SKILL_GLOB = os.path.expanduser("~/.claude/skills/*/SKILL.md")
OWNED_COMMAND_GLOB = os.path.expanduser("~/.claude/commands/*.md")
ALL_SKILL_GLOB = os.path.expanduser("~/.claude/**/SKILL.md")
ALL_COMMAND_GLOB = os.path.expanduser("~/.claude/**/commands/*.md")
MCP_NAME_PATTERN = re.compile(r"(?m)^([A-Za-z0-9][\w:.-]*):\s")
SITUATIONAL_MARKERS = (
    "manual-invoke only",
    "manual-only",
    "never auto-fires",
    "setup-time",
    "one-off",
    "situational",
    "run before first use",
)


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
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS mcp_events(
            file TEXT,
            server TEXT,
            tool TEXT,
            day TEXT,
            count INTEGER,
            PRIMARY KEY(file, server, tool, day)
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS mcp_inventory(
            name TEXT PRIMARY KEY,
            captured_at TEXT
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


def _trim_description(value: str) -> str:
    collapsed = " ".join(value.strip().split())
    return collapsed[:160]


def _extract_frontmatter_description(text: str) -> str:
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return ""

    for line in lines[1:]:
        stripped = line.strip()
        if stripped == "---":
            break
        if stripped.lower().startswith("description:"):
            return _trim_description(stripped.split(":", 1)[1])

    return ""


def _extract_leading_prose(text: str) -> str:
    lines = text.splitlines()
    paragraph: list[str] = []
    in_frontmatter = False
    frontmatter_closed = False

    for index, line in enumerate(lines):
        stripped = line.strip()

        if index == 0 and stripped == "---":
            in_frontmatter = True
            continue

        if in_frontmatter:
            if stripped == "---":
                in_frontmatter = False
                frontmatter_closed = True
            continue

        if not stripped:
            if paragraph:
                break
            continue

        if stripped.startswith("#"):
            continue

        if frontmatter_closed or not stripped.startswith("---"):
            paragraph.append(stripped)

    return _trim_description(" ".join(paragraph))


def _read_owned_metadata(path: Path, kind: str) -> dict[str, Any]:
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        text = ""

    description = _extract_frontmatter_description(text)
    if kind == "command" and not description:
        description = _extract_leading_prose(text)

    normalized_description = _trim_description(description) if description else ""
    lowered = normalized_description.lower()
    situational = any(marker in lowered for marker in SITUATIONAL_MARKERS)
    return {
        "description": normalized_description,
        "situational": situational,
    }


def discover_owned() -> dict[str, dict]:
    inventory: dict[str, dict[str, object]] = {}

    for skill_match in glob(OWNED_SKILL_GLOB):
        resolved = _safe_resolve(Path(skill_match))
        name = resolved.parent.name
        metadata = _read_owned_metadata(resolved, "skill")
        entry = inventory.setdefault(
            name,
            {
                "kind": "skill",
                "sources": set(),
                "description": "",
                "situational": False,
            },
        )
        entry["kind"] = "skill"
        entry["sources"].add(str(resolved.parent.parent))
        if metadata["description"] and not entry["description"]:
            entry["description"] = metadata["description"]
        entry["situational"] = bool(entry["situational"] or metadata["situational"])

    for command_match in glob(OWNED_COMMAND_GLOB):
        resolved = _safe_resolve(Path(command_match))
        name = resolved.stem
        metadata = _read_owned_metadata(resolved, "command")
        entry = inventory.setdefault(
            name,
            {
                "kind": "command",
                "sources": set(),
                "description": "",
                "situational": False,
            },
        )
        entry["sources"].add(str(resolved.parent))
        if metadata["description"] and not entry["description"]:
            entry["description"] = metadata["description"]
        entry["situational"] = bool(entry["situational"] or metadata["situational"])

    return {
        name: {
            "kind": str(entry["kind"]),
            "sources": sorted(str(source) for source in entry["sources"]),
            "description": str(entry["description"]),
            "situational": bool(entry["situational"]),
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


def _extract_events(line: str) -> tuple[list[tuple[str, str]], list[tuple[str, str, str]]]:
    try:
        obj = json.loads(line)
    except json.JSONDecodeError:
        return [], []

    timestamp = obj.get("timestamp")
    if not isinstance(timestamp, str) or len(timestamp) < 10:
        return [], []

    message = obj.get("message")
    if not isinstance(message, dict):
        return [], []

    content = message.get("content")
    if not isinstance(content, list):
        return [], []

    skill_invocations: list[tuple[str, str]] = []
    mcp_invocations: list[tuple[str, str, str]] = []
    for block in content:
        if not isinstance(block, dict):
            continue
        if block.get("type") != "tool_use":
            continue

        block_name = block.get("name")
        if not isinstance(block_name, str):
            continue

        if block_name == "Skill":
            raw_input = block.get("input")
            if not isinstance(raw_input, dict):
                continue
            skill_name = raw_input.get("skill")
            if not isinstance(skill_name, str) or not skill_name:
                continue
            skill_invocations.append((skill_name.split(":")[-1], timestamp[:10]))
            continue

        if not block_name.startswith("mcp__"):
            continue

        parts = block_name.split("__")
        if len(parts) < 3 or not parts[1]:
            continue
        server = parts[1]
        tool = "__".join(parts[2:]) or block_name
        mcp_invocations.append((server, tool, timestamp[:10]))

    return skill_invocations, mcp_invocations


def _load_mcp_inventory(conn: sqlite3.Connection) -> tuple[list[str], str | None]:
    rows = conn.execute(
        "SELECT name, captured_at FROM mcp_inventory ORDER BY name"
    ).fetchall()
    inventory = [str(row[0]) for row in rows]
    captured_at = rows[0][1] if rows else None
    return inventory, captured_at


def _normalize_mcp_inventory_name(name: str) -> str:
    return name.replace(":", "_")


def _mcp_base_token(value: str) -> str:
    return value.split("-")[0].split("_")[0]


def _run_mcp_list() -> str:
    completed = subprocess.run(
        ["claude", "mcp", "list"],
        capture_output=True,
        check=False,
        text=True,
        timeout=30,
    )
    if completed.returncode != 0:
        return ""
    return completed.stdout


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

            skill_counts: dict[tuple[str, str], int] = {}
            mcp_counts: dict[tuple[str, str, str], int] = {}
            try:
                with path.open("r", encoding="utf-8") as handle:
                    for line in handle:
                        skill_invocations, mcp_invocations = _extract_events(line)
                        invocations_seen += len(skill_invocations) + len(mcp_invocations)
                        for skill_name, day in skill_invocations:
                            skill_counts[(skill_name, day)] = skill_counts.get((skill_name, day), 0) + 1
                        for server, tool, day in mcp_invocations:
                            key = (server, tool, day)
                            mcp_counts[key] = mcp_counts.get(key, 0) + 1
            except OSError:
                continue

            conn.execute("DELETE FROM skill_events WHERE file = ?", (file_key,))
            conn.execute("DELETE FROM mcp_events WHERE file = ?", (file_key,))
            if skill_counts:
                conn.executemany(
                    "INSERT INTO skill_events(file, skill, day, count) VALUES (?, ?, ?, ?)",
                    [(file_key, skill, day, count) for (skill, day), count in skill_counts.items()],
                )
            if mcp_counts:
                conn.executemany(
                    "INSERT INTO mcp_events(file, server, tool, day, count) VALUES (?, ?, ?, ?, ?)",
                    [
                        (file_key, server, tool, day, count)
                        for (server, tool, day), count in mcp_counts.items()
                    ],
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


def capture_mcp_inventory(
    db_path: str | Path | None = None,
    runner: Any | None = None,
) -> list[str]:
    target_db = db_path or DB_PATH
    conn = _ensure_db(target_db)
    inventory_runner = runner or _run_mcp_list
    try:
        current_inventory, _ = _load_mcp_inventory(conn)
        try:
            output = inventory_runner()
        except Exception:
            return current_inventory

        if not isinstance(output, str):
            return current_inventory

        names = sorted(set(MCP_NAME_PATTERN.findall(output)))
        if not names:
            return current_inventory

        captured_at = date.today().isoformat()
        conn.execute("DELETE FROM mcp_inventory")
        conn.executemany(
            "INSERT INTO mcp_inventory(name, captured_at) VALUES (?, ?)",
            [(name, captured_at) for name in names],
        )
        conn.commit()
        return names
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

    history_days = 0
    if history_since is not None:
        history_days = (today - date.fromisoformat(history_since)).days

    top: list[dict] = []
    unmatched: list[dict] = []
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

    retire_candidates = [
        {
            "name": skill_name,
            "kind": owned_map[skill_name]["kind"],
            "sources": owned_map[skill_name]["sources"],
            "last_used": None,
            "situational": bool(owned_map[skill_name].get("situational", False)),
            "description": str(owned_map[skill_name].get("description", "")),
        }
        for skill_name in owned_map
        if skill_name not in used_skill_names
    ]

    top.sort(key=lambda item: (-item["total"], item["name"]))
    unmatched.sort(key=lambda item: (-item["total"], item["name"]))
    retire_candidates.sort(key=lambda item: (item["situational"], item["name"]))

    return {
        "summary": {
            "skills_on_disk": len(owned_map),
            "skills_used": len(used_skill_names),
            "skills_unused": len(owned_map) - len(used_skill_names),
            "total_invocations": total_invocations,
            "history_since": history_since,
            "history_days": history_days,
        },
        "top": top[:30],
        "retire_candidates": retire_candidates,
        "unmatched": unmatched[:30],
    }


def aggregate_mcp(
    db_path: str | Path | None = None,
    inventory: list[str] | None = None,
    today: date | None = None,
) -> dict:
    target_db = db_path or DB_PATH
    conn = _ensure_db(target_db)
    try:
        rows = conn.execute(
            "SELECT server, tool, day, SUM(count) FROM mcp_events GROUP BY server, tool, day"
        ).fetchall()
        stored_inventory, captured_at = _load_mcp_inventory(conn)
    finally:
        conn.close()

    inventory_names = sorted(set(inventory if inventory is not None else stored_inventory))
    inventory_captured_at = captured_at if inventory is None else None

    by_server: dict[str, dict[str, dict[str, int]]] = {}
    history_since: str | None = None
    max_day: str | None = None

    for server, tool, day, count in rows:
        if history_since is None or day < history_since:
            history_since = day
        if max_day is None or day > max_day:
            max_day = day
        server_tools = by_server.setdefault(str(server), {})
        tool_days = server_tools.setdefault(str(tool), {})
        tool_days[day] = tool_days.get(day, 0) + int(count)

    if today is None:
        today = date.fromisoformat(max_day) if max_day else date.today()

    history_days = 0
    if history_since is not None:
        history_days = (today - date.fromisoformat(history_since)).days

    top_servers: list[dict[str, Any]] = []
    used_segments = set(by_server)
    total_invocations = 0
    distinct_tools: set[tuple[str, str]] = set()

    for server, tools in by_server.items():
        last_used = max(day for day_counts in tools.values() for day in day_counts)
        count_30d = 0
        server_total = 0
        tool_totals: list[dict[str, Any]] = []

        for tool, day_counts in tools.items():
            total = sum(day_counts.values())
            distinct_tools.add((server, tool))
            server_total += total
            count_30d += sum(
                count
                for day, count in day_counts.items()
                if 0 <= (today - date.fromisoformat(day)).days <= 29
            )
            tool_totals.append({"tool": tool, "total": total})

        total_invocations += server_total
        tool_totals.sort(key=lambda item: (-item["total"], item["tool"]))
        top_servers.append(
            {
                "name": server,
                "total": server_total,
                "count_30d": count_30d,
                "last_used": last_used,
                "top_tools": tool_totals[:5],
            }
        )

    configured_usage: set[str] = set()
    retire_candidates: list[dict[str, str]] = []
    active_elsewhere: list[dict[str, int]] = []

    for configured_name in inventory_names:
        normalized = _normalize_mcp_inventory_name(configured_name)
        base_token = _mcp_base_token(normalized)
        if normalized in used_segments or base_token in used_segments:
            configured_usage.add(configured_name)
            continue
        retire_candidates.append(
            {
                "name": configured_name,
                "reason": f"configured, 0 usage in {history_days}d window",
            }
        )

    matched_used_segments = {
        _normalize_mcp_inventory_name(name)
        for name in configured_usage
        if _normalize_mcp_inventory_name(name) in used_segments
    }
    matched_used_segments.update(
        segment
        for segment in used_segments
        if any(_mcp_base_token(_normalize_mcp_inventory_name(name)) == segment for name in configured_usage)
    )

    for server in used_segments:
        if server in matched_used_segments:
            continue
        server_total = sum(
            count
            for day_counts in by_server[server].values()
            for count in day_counts.values()
        )
        active_elsewhere.append({"name": server, "total": server_total})

    top_servers.sort(key=lambda item: (-item["total"], item["name"]))
    retire_candidates.sort(key=lambda item: item["name"])
    active_elsewhere.sort(key=lambda item: (-item["total"], item["name"]))

    return {
        "summary": {
            "servers_configured": len(inventory_names),
            "servers_used": len(configured_usage),
            "servers_unused": len(inventory_names) - len(configured_usage),
            "total_invocations": total_invocations,
            "distinct_tools": len(distinct_tools),
            "history_since": history_since,
            "history_days": history_days,
            "inventory_captured_at": inventory_captured_at,
        },
        "top_servers": top_servers,
        "retire_candidates": retire_candidates,
        "active_elsewhere": active_elsewhere,
    }


if __name__ == "__main__":
    scan(full=True)
    capture_mcp_inventory()
    print(
        json.dumps(
            {
                "skill_summary": aggregate()["summary"],
                "mcp_summary": aggregate_mcp()["summary"],
            },
            indent=2,
        )
    )
