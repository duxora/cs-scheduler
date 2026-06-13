from __future__ import annotations

import json
import os
from datetime import date
from pathlib import Path

from apps.skill_stats import scanner


def _write_jsonl(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row) + "\n")


def _skill_event(ts: str, skill: str) -> dict:
    return {
        "timestamp": ts,
        "message": {
            "content": [
                {
                    "type": "tool_use",
                    "name": "Skill",
                    "input": {"skill": skill, "args": ""},
                }
            ]
        },
    }


def _owned(
    name: str,
    kind: str,
    source: str,
    *,
    description: str = "",
    situational: bool = False,
) -> dict:
    return {
        name: {
            "kind": kind,
            "sources": [source],
            "description": description,
            "situational": situational,
        }
    }


def test_namespaced_invocation_uses_full_set_basename(tmp_path):
    projects_dir = tmp_path / "projects"
    db_path = tmp_path / "skill_usage.db"
    session = projects_dir / "session.jsonl"

    _write_jsonl(session, [_skill_event("2026-06-13T10:00:00Z", "superpowers:brainstorming")])
    scanner.scan(full=True, db_path=db_path, projects_dir=projects_dir)

    payload = scanner.aggregate(
        db_path=db_path,
        owned={},
        full={"brainstorming"},
        today=date(2026, 6, 13),
    )

    assert payload["summary"]["total_invocations"] == 1
    assert payload["top"] == [
        {
            "name": "brainstorming",
            "kind": None,
            "total": 1,
            "count_7d": 1,
            "count_30d": 1,
            "last_used": "2026-06-13",
        }
    ]
    assert payload["summary"]["history_days"] == 0


def test_owned_command_counts_as_used_with_command_kind(tmp_path):
    projects_dir = tmp_path / "projects"
    db_path = tmp_path / "skill_usage.db"
    session = projects_dir / "session.jsonl"

    _write_jsonl(session, [_skill_event("2026-06-13T10:00:00Z", "review-local")])
    scanner.scan(full=True, db_path=db_path, projects_dir=projects_dir)

    payload = scanner.aggregate(
        db_path=db_path,
        owned=_owned("review-local", "command", "/commands"),
        full={"review-local"},
        today=date(2026, 6, 13),
    )

    assert payload["summary"]["skills_used"] == 1
    assert payload["top"][0]["kind"] == "command"
    assert payload["enhance_candidates"] == [
        {
            "name": "review-local",
            "kind": "command",
            "total": 1,
            "count_30d": 1,
            "last_used": "2026-06-13",
        }
    ]


def test_noise_invocation_stays_unmatched(tmp_path):
    projects_dir = tmp_path / "projects"
    db_path = tmp_path / "skill_usage.db"
    session = projects_dir / "session.jsonl"

    _write_jsonl(session, [_skill_event("2026-06-13T10:00:00Z", "bash")])
    scanner.scan(full=True, db_path=db_path, projects_dir=projects_dir)

    payload = scanner.aggregate(
        db_path=db_path,
        owned=_owned("brainstorming", "skill", "/skills"),
        full={"brainstorming"},
        today=date(2026, 6, 13),
    )

    assert payload["summary"]["skills_used"] == 0
    assert payload["summary"]["total_invocations"] == 0
    assert payload["top"] == []
    assert payload["unmatched"] == [{"name": "bash", "total": 1}]


def test_retire_candidates_use_owned_set_only(tmp_path):
    projects_dir = tmp_path / "projects"
    db_path = tmp_path / "skill_usage.db"
    session = projects_dir / "session.jsonl"

    _write_jsonl(session, [_skill_event("2026-06-13T10:00:00Z", "superpowers:brainstorming")])
    scanner.scan(full=True, db_path=db_path, projects_dir=projects_dir)

    owned = _owned("review-local", "command", "/commands")
    payload = scanner.aggregate(
        db_path=db_path,
        owned=owned,
        full={"brainstorming", "review-local"},
        today=date(2026, 6, 13),
    )

    assert payload["top"] == [
        {
            "name": "brainstorming",
            "kind": None,
            "total": 1,
            "count_7d": 1,
            "count_30d": 1,
            "last_used": "2026-06-13",
        }
    ]
    assert payload["retire_candidates"] == [
        {
            "name": "review-local",
            "kind": "command",
            "sources": ["/commands"],
            "last_used": None,
            "situational": False,
            "description": "",
        }
    ]
    assert payload["enhance_candidates"] == []


def test_incremental_scan_skips_unchanged_and_replaces_changed_counts(tmp_path):
    projects_dir = tmp_path / "projects"
    db_path = tmp_path / "skill_usage.db"
    session = projects_dir / "session.jsonl"

    _write_jsonl(session, [_skill_event("2026-06-13T10:00:00Z", "brainstorming")])

    first = scanner.scan(full=False, db_path=db_path, projects_dir=projects_dir)
    assert first == {"files_scanned": 1, "files_skipped": 0, "invocations_seen": 1}

    second = scanner.scan(full=False, db_path=db_path, projects_dir=projects_dir)
    assert second == {"files_scanned": 0, "files_skipped": 1, "invocations_seen": 0}

    current_mtime = session.stat().st_mtime
    _write_jsonl(
        session,
        [
            _skill_event("2026-06-13T10:00:00Z", "brainstorming"),
            _skill_event("2026-06-13T11:00:00Z", "brainstorming"),
        ],
    )
    os.utime(session, (current_mtime + 1, current_mtime + 1))

    third = scanner.scan(full=False, db_path=db_path, projects_dir=projects_dir)
    assert third == {"files_scanned": 1, "files_skipped": 0, "invocations_seen": 2}

    payload = scanner.aggregate(
        db_path=db_path,
        owned=_owned("brainstorming", "skill", "/skills"),
        full={"brainstorming"},
        today=date(2026, 6, 13),
    )
    assert payload["summary"]["total_invocations"] == 2
    assert payload["top"][0]["total"] == 2


def test_windows_respect_injected_today(tmp_path):
    projects_dir = tmp_path / "projects"
    db_path = tmp_path / "skill_usage.db"
    session = projects_dir / "session.jsonl"

    _write_jsonl(
        session,
        [
            _skill_event("2026-06-13T10:00:00Z", "brainstorming"),
            _skill_event("2026-06-07T10:00:00Z", "brainstorming"),
            _skill_event("2026-05-20T10:00:00Z", "brainstorming"),
            _skill_event("2026-05-14T10:00:00Z", "brainstorming"),
        ],
    )
    scanner.scan(full=True, db_path=db_path, projects_dir=projects_dir)

    payload = scanner.aggregate(
        db_path=db_path,
        owned=_owned("brainstorming", "skill", "/skills"),
        full={"brainstorming"},
        today=date(2026, 6, 13),
    )

    assert payload["top"] == [
        {
            "name": "brainstorming",
            "kind": "skill",
            "total": 4,
            "count_7d": 2,
            "count_30d": 3,
            "last_used": "2026-06-13",
        }
    ]
    assert payload["enhance_candidates"] == [
        {
            "name": "brainstorming",
            "kind": "skill",
            "total": 4,
            "count_30d": 3,
            "last_used": "2026-06-13",
        }
    ]
    assert payload["summary"]["history_days"] == 30


def test_situational_unused_skills_sort_last_and_expose_description(tmp_path):
    projects_dir = tmp_path / "projects"
    db_path = tmp_path / "skill_usage.db"
    session = projects_dir / "session.jsonl"

    _write_jsonl(session, [_skill_event("2026-06-13T10:00:00Z", "brainstorming")])
    scanner.scan(full=True, db_path=db_path, projects_dir=projects_dir)

    owned = {}
    owned.update(
        _owned(
            "manual-helper",
            "skill",
            "/skills",
            description="Manual-invoke only helper for one-off setup-time tasks.",
            situational=True,
        )
    )
    owned.update(_owned("plain-unused", "skill", "/skills"))

    payload = scanner.aggregate(
        db_path=db_path,
        owned=owned,
        full={"brainstorming", "manual-helper", "plain-unused"},
        today=date(2026, 6, 20),
    )

    assert payload["summary"]["history_days"] == 7
    assert payload["retire_candidates"] == [
        {
            "name": "plain-unused",
            "kind": "skill",
            "sources": ["/skills"],
            "last_used": None,
            "situational": False,
            "description": "",
        },
        {
            "name": "manual-helper",
            "kind": "skill",
            "sources": ["/skills"],
            "last_used": None,
            "situational": True,
            "description": "Manual-invoke only helper for one-off setup-time tasks.",
        },
    ]
