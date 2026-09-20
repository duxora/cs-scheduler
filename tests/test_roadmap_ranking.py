"""Tests for the epic roadmap decision signals.

Covers `_progress_from_rows` / `_unmet_dependencies` directly, plus
GET /workflow/api/roadmap end-to-end against a disposable sqlite db.
Schema/fixture pattern copied from tests/test_dev_workflow_routes.py.
"""
from __future__ import annotations

import json
import sqlite3

import pytest
from fastapi.testclient import TestClient

from apps.dev_workflow.routes import (
    _progress_from_rows,
    _unmet_dependencies,
    get_descendant_leaves,
)

# ── Minimal tkt schema - only what routes.py reads, + depends_on ───────────

SCHEMA_SQL = """
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  repo_path TEXT,
  context TEXT,
  priority TEXT,
  mode TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  archived_at TEXT
);

CREATE TABLE tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  type TEXT DEFAULT 'task',
  priority TEXT DEFAULT 'medium',
  status TEXT DEFAULT 'open',
  domain TEXT,
  spec_path TEXT,
  pr_number INTEGER,
  branch TEXT,
  supersedes INTEGER,
  model TEXT,
  effort TEXT,
  parent_id INTEGER,
  actual_effort_minutes INTEGER,
  actual_model_used TEXT,
  rework_count INTEGER NOT NULL DEFAULT 0,
  energy TEXT,
  context TEXT,
  slug TEXT,
  depends_on TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT,
  due_date TEXT
);
"""


def _seed(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA_SQL)
    conn.execute(
        "INSERT INTO projects (id, name, repo_path, context) VALUES (?, ?, ?, ?)",
        ("dev-flow", "dev-flow", "/tmp/dev-flow", "personal"),
    )
    conn.commit()


def _insert_task(conn: sqlite3.Connection, **fields) -> int:
    fields.setdefault("project_id", "dev-flow")
    fields.setdefault("type", "task")
    fields.setdefault("priority", "medium")
    fields.setdefault("status", "open")
    cols = ", ".join(fields)
    placeholders = ", ".join("?" for _ in fields)
    cur = conn.execute(
        f"INSERT INTO tasks ({cols}) VALUES ({placeholders})", list(fields.values())
    )
    conn.commit()
    return cur.lastrowid


@pytest.fixture
def conn():
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    _seed(c)
    try:
        yield c
    finally:
        c.close()


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    """TestClient with dev_workflow routes pointed at an isolated sqlite."""
    db_path = tmp_path_factory.mktemp("backlog") / "backlog.db"
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    try:
        _seed(conn)
    finally:
        conn.close()

    import apps.dev_workflow.routes as routes

    original = routes.TKT_DB_PATH
    routes.TKT_DB_PATH = db_path

    from server.main import app

    try:
        with TestClient(app) as c:
            yield c
    finally:
        routes.TKT_DB_PATH = original


# ── _progress_from_rows: cancelled excluded from denominator ───────────────

def test_progress_excludes_cancelled_from_denominator():
    # 12 done + 6 cancelled + 0 open/in_progress -> should read as 100%, not 67%.
    rows = [{"status": "done"} for _ in range(12)] + [{"status": "cancelled"} for _ in range(6)]
    progress = _progress_from_rows(rows)
    assert progress["percent"] == 100
    assert progress["cancelled"] == 6
    assert progress["done"] == 12


def test_progress_excludes_cancelled_from_denominator_partial():
    # 12 done + 1 cancelled -> 12/12 = 100%, not 12/13 = 92%.
    rows = [{"status": "done"} for _ in range(12)] + [{"status": "cancelled"}]
    assert _progress_from_rows(rows)["percent"] == 100


def test_progress_all_cancelled_denominator_zero():
    rows = [{"status": "cancelled"} for _ in range(3)]
    progress = _progress_from_rows(rows)
    assert progress["percent"] == 0
    assert progress["total"] == 3


# ── get_descendant_leaves / _unmet_dependencies ─────────────────────────────

def test_unmet_dependencies_true_when_dep_not_done(conn):
    dep_id = _insert_task(conn, title="dep", status="open")
    assert _unmet_dependencies(conn, json.dumps([dep_id])) is True


def test_unmet_dependencies_false_when_dep_done(conn):
    dep_id = _insert_task(conn, title="dep", status="done")
    assert _unmet_dependencies(conn, json.dumps([dep_id])) is False


def test_unmet_dependencies_false_when_no_depends_on(conn):
    assert _unmet_dependencies(conn, None) is False
    assert _unmet_dependencies(conn, "") is False


def test_get_descendant_leaves_excludes_containers(conn):
    epic_id = _insert_task(conn, title="Epic", type="epic")
    _insert_task(conn, title="Leaf child", parent_id=epic_id, status="open")
    leaves = get_descendant_leaves(conn, epic_id)
    assert len(leaves) == 1
    assert leaves[0]["title"] == "Leaf child"


# ── Route-level: closeable, next_tasks cap, in_flight, blocked_count ───────

def test_roadmap_next_tasks_capped_at_3(client):
    import apps.dev_workflow.routes as routes

    conn = sqlite3.connect(str(routes.TKT_DB_PATH))
    conn.row_factory = sqlite3.Row
    try:
        epic_id = _insert_task(conn, title="Epic with many claimables", type="epic", priority="high")
        for i in range(5):
            _insert_task(
                conn,
                title=f"Claimable {i}",
                parent_id=epic_id,
                status="open",
                priority="medium",
                created_at=f"2026-01-0{i + 1} 00:00:00",
            )
        conn.commit()
    finally:
        conn.close()

    resp = client.get("/workflow/api/roadmap").json()
    epic = next(e for e in resp if e["id"] == epic_id)
    assert len(epic["next_tasks"]) == 3
    assert epic["closeable"] is False


def test_roadmap_in_flight_reports_both_in_progress_children(client):
    import apps.dev_workflow.routes as routes

    conn = sqlite3.connect(str(routes.TKT_DB_PATH))
    conn.row_factory = sqlite3.Row
    try:
        epic_id = _insert_task(conn, title="Epic with two running", type="epic", priority="high")
        _insert_task(conn, title="Running 1", parent_id=epic_id, status="in_progress")
        _insert_task(conn, title="Running 2", parent_id=epic_id, status="in_progress")
        conn.commit()
    finally:
        conn.close()

    resp = client.get("/workflow/api/roadmap").json()
    epic = next(e for e in resp if e["id"] == epic_id)
    assert len(epic["in_flight"]) == 2
    assert {t["title"] for t in epic["in_flight"]} == {"Running 1", "Running 2"}


def test_roadmap_closeable_epic_returns_empty_next_tasks(client):
    import apps.dev_workflow.routes as routes

    conn = sqlite3.connect(str(routes.TKT_DB_PATH))
    conn.row_factory = sqlite3.Row
    try:
        epic_id = _insert_task(conn, title="Finished epic", type="epic", priority="medium")
        _insert_task(conn, title="Done child", parent_id=epic_id, status="done")
        _insert_task(conn, title="Cancelled child", parent_id=epic_id, status="cancelled")
        conn.commit()
    finally:
        conn.close()

    resp = client.get("/workflow/api/roadmap", params={"include_done": "true"}).json()
    epic = next(e for e in resp if e["id"] == epic_id)
    assert epic["closeable"] is True
    assert epic["next_tasks"] == []
    assert epic["progress"]["percent"] == 100


def test_roadmap_deferred_child_blocks_closeable(client):
    """Deferred is postponed, not withdrawn - it stays in the percent
    denominator (unlike cancelled) AND must block closeable, or the two
    contradict each other (percent < 100 but closeable True)."""
    import apps.dev_workflow.routes as routes

    conn = sqlite3.connect(str(routes.TKT_DB_PATH))
    conn.row_factory = sqlite3.Row
    try:
        epic_id = _insert_task(conn, title="Epic with a deferred child", type="epic", priority="medium")
        for i in range(12):
            _insert_task(conn, title=f"Done {i}", parent_id=epic_id, status="done")
        _insert_task(conn, title="Deferred child", parent_id=epic_id, status="deferred")
        conn.commit()
    finally:
        conn.close()

    resp = client.get("/workflow/api/roadmap", params={"include_done": "true"}).json()
    epic = next(e for e in resp if e["id"] == epic_id)
    assert epic["progress"]["percent"] < 100
    assert epic["closeable"] is False


def test_roadmap_next_tasks_excludes_unmet_dependency(client):
    import apps.dev_workflow.routes as routes

    conn = sqlite3.connect(str(routes.TKT_DB_PATH))
    conn.row_factory = sqlite3.Row
    try:
        epic_id = _insert_task(conn, title="Epic with blocked child", type="epic", priority="high")
        blocker_id = _insert_task(conn, title="Blocker", status="open")
        _insert_task(
            conn,
            title="Blocked child",
            parent_id=epic_id,
            status="open",
            depends_on=json.dumps([blocker_id]),
        )
        conn.commit()
    finally:
        conn.close()

    resp = client.get("/workflow/api/roadmap").json()
    epic = next(e for e in resp if e["id"] == epic_id)
    assert epic["next_tasks"] == []


def test_roadmap_blocked_count_reports_unmet_dependencies(client):
    """blocked_count separates 'N blocked' from 'N can start' - open/backlog
    children with an unmet depends_on must count here, not in next_tasks."""
    import apps.dev_workflow.routes as routes

    conn = sqlite3.connect(str(routes.TKT_DB_PATH))
    conn.row_factory = sqlite3.Row
    try:
        epic_id = _insert_task(conn, title="Epic with mixed children", type="epic", priority="high")
        blocker_id = _insert_task(conn, title="Blocker", status="open")
        _insert_task(
            conn,
            title="Blocked child A",
            parent_id=epic_id,
            status="open",
            depends_on=json.dumps([blocker_id]),
        )
        _insert_task(
            conn,
            title="Blocked child B",
            parent_id=epic_id,
            status="backlog",
            depends_on=json.dumps([blocker_id]),
        )
        _insert_task(conn, title="Claimable child", parent_id=epic_id, status="open")
        conn.commit()
    finally:
        conn.close()

    resp = client.get("/workflow/api/roadmap").json()
    epic = next(e for e in resp if e["id"] == epic_id)
    assert epic["blocked_count"] == 2
    assert len(epic["next_tasks"]) == 1
    assert epic["next_tasks"][0]["title"] == "Claimable child"


def test_roadmap_blocked_count_zero_when_no_dependencies(client):
    import apps.dev_workflow.routes as routes

    conn = sqlite3.connect(str(routes.TKT_DB_PATH))
    conn.row_factory = sqlite3.Row
    try:
        epic_id = _insert_task(conn, title="Epic with unblocked child", type="epic", priority="medium")
        _insert_task(conn, title="Free child", parent_id=epic_id, status="open")
        conn.commit()
    finally:
        conn.close()

    resp = client.get("/workflow/api/roadmap").json()
    epic = next(e for e in resp if e["id"] == epic_id)
    assert epic["blocked_count"] == 0


def test_roadmap_last_child_activity_ignores_epic_own_updated_at(client):
    """The epic row's own updated_at (a cosmetic title edit) must NOT count as
    child activity - only leaf-descendant updated_at should."""
    import apps.dev_workflow.routes as routes

    conn = sqlite3.connect(str(routes.TKT_DB_PATH))
    conn.row_factory = sqlite3.Row
    try:
        epic_id = _insert_task(
            conn,
            title="Recently title-edited epic",
            type="epic",
            priority="medium",
            updated_at="2026-09-20 12:00:00",  # newer than every child
        )
        _insert_task(
            conn,
            title="Old child",
            parent_id=epic_id,
            status="open",
            updated_at="2026-01-01 00:00:00",
        )
        conn.commit()
    finally:
        conn.close()

    resp = client.get("/workflow/api/roadmap").json()
    epic = next(e for e in resp if e["id"] == epic_id)
    assert epic["last_child_activity_at"] == "2026-01-01 00:00:00"


def test_roadmap_no_descendants_empty_next_tasks_and_null_activity(client):
    import apps.dev_workflow.routes as routes

    conn = sqlite3.connect(str(routes.TKT_DB_PATH))
    conn.row_factory = sqlite3.Row
    try:
        epic_id = _insert_task(conn, title="Childless epic", type="epic", priority="medium")
        conn.commit()
    finally:
        conn.close()

    resp = client.get("/workflow/api/roadmap").json()
    epic = next(e for e in resp if e["id"] == epic_id)
    assert epic["next_tasks"] == []
    assert epic["last_child_activity_at"] is None
    # Zero descendants means unplanned, not finished - must not read as
    # closeable just because open/in_progress both happen to be zero.
    assert epic["closeable"] is False


def test_roadmap_existing_fields_still_present(client):
    """No field removed/renamed - existing consumers keep working."""
    resp = client.get("/workflow/api/roadmap").json()
    assert len(resp) > 0
    for item in resp:
        for key in (
            "id", "project_id", "project_name", "title", "type", "priority",
            "status", "domain", "parent_id", "slug", "children_count", "progress",
            "next_tasks", "in_flight", "blocked_count", "last_child_activity_at", "closeable",
        ):
            assert key in item, f"roadmap item missing {key}"
