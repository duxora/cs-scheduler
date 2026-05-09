"""End-to-end HTTP tests for the dev_workflow app.

Regression fence around the endpoints that power `/workflow/*` in the SPA
(Projects, Epics, Tasks, Pipelines, Sessions, Insights tabs). Any schema or
route signature change the frontend depends on should break a test here.

Uses a disposable sqlite db seeded per session so tests don't touch the
developer's live ~/.backlog/backlog.db.
"""
from __future__ import annotations

import sqlite3
import json
from uuid import uuid4
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


# ── Minimal tkt schema — only what routes.py reads ─────────────────────────

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
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT,
  due_date TEXT
);

CREATE TABLE task_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL,
  content TEXT NOT NULL,
  added_by TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE task_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL,
  field TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  changed_by TEXT,
  changed_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE domain_project_map (
  domain TEXT NOT NULL,
  project_id TEXT NOT NULL,
  pattern TEXT,
  PRIMARY KEY (domain, project_id)
);

CREATE TABLE workflow_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
  session_id TEXT, run_id TEXT, task_id INTEGER, project_id TEXT,
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE claims (
  task_id INTEGER PRIMARY KEY,
  agent TEXT NOT NULL,
  session_id TEXT,
  claimed_at TEXT DEFAULT (datetime('now')),
  heartbeat_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE pipeline_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL,
  session_id TEXT NOT NULL,
  pipeline TEXT NOT NULL,
  size TEXT NOT NULL,
  domain TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  duration_s INTEGER NOT NULL,
  steps TEXT NOT NULL,
  tokens_at_claim INTEGER,
  tokens_consumed INTEGER,
  dismissed INTEGER NOT NULL DEFAULT 0
);
"""


def _seed(conn: sqlite3.Connection) -> None:
    """Seed with three projects covering all life-area contexts and a
    parent/child task hierarchy for tree + roadmap coverage."""
    conn.executescript(SCHEMA_SQL)

    conn.executemany(
        "INSERT INTO projects (id, name, repo_path, context) VALUES (?, ?, ?, ?)",
        [
            ("dev-flow", "dev-flow", "/tmp/dev-flow", "personal"),
            ("work-x", "Work X", "/tmp/work-x", "work"),
            ("fam-y", "Fam Y", "/tmp/fam-y", "family"),
        ],
    )

    # dev-flow: one epic + two leaf children (1 open, 1 done) + one solo open.
    # Mix priorities so top_priority/critical_count logic gets coverage.
    conn.executemany(
        """INSERT INTO tasks
           (id, project_id, title, type, priority, status, slug, parent_id,
            created_at, updated_at, completed_at, due_date, context)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        [
            (100, "dev-flow", "Ship dev-flow v2", "epic", "high", "open",
             "ship-dev-flow-v2", None,
             "2026-04-01 10:00:00", "2026-04-10 10:00:00", None, None, None),
            (101, "dev-flow", "Add slug URLs", "task", "high", "done",
             "add-slug-urls", 100,
             "2026-04-02 09:00:00", "2026-04-15 09:00:00", "2026-04-15 09:00:00", None, None),
            (102, "dev-flow", "Wire list mode", "task", "medium", "open",
             "wire-list-mode", 100,
             "2026-04-03 09:00:00", "2026-04-18 09:00:00", None, None, None),
            (103, "dev-flow", "Investigate insights gap", "task", "critical", "in_progress",
             "investigate-insights-gap", None,
             "2026-04-04 09:00:00", "2026-04-18 09:00:00", None, "2026-06-30", None),
            # Stale open task (created > 14 days ago; updated_at trails too)
            (104, "dev-flow", "Dusty backlog item", "task", "low", "open",
             "dusty-backlog-item", None,
             "2026-01-01 09:00:00", "2026-01-02 09:00:00", None, None, None),
            # Overdue
            (105, "dev-flow", "Past-due cleanup", "task", "medium", "open",
             "past-due-cleanup", None,
             "2026-04-05 09:00:00", "2026-04-06 09:00:00", None, "2026-04-10", None),
        ],
    )

    # work-x: one in-progress task so dashboard has non-zero wip there
    conn.execute(
        """INSERT INTO tasks
           (id, project_id, title, type, priority, status, slug)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (200, "work-x", "Work in flight", "task", "high", "in_progress", "work-in-flight"),
    )

    conn.commit()


# ── Fixtures ───────────────────────────────────────────────────────────────

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

    # Monkey-patch the module-level DB path before the app imports it.
    import apps.dev_workflow.routes as routes
    original = routes.TKT_DB_PATH
    routes.TKT_DB_PATH = db_path

    from server.main import app
    try:
        with TestClient(app) as c:
            yield c
    finally:
        routes.TKT_DB_PATH = original


# ── Tasks ──────────────────────────────────────────────────────────────────

def test_tasks_returns_slug_and_context(client):
    resp = client.get("/workflow/api/tasks")
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    assert len(data) > 0
    first = data[0]
    # Contract the frontend depends on — drop any of these and pages break.
    for key in ("id", "title", "status", "priority", "project_id",
                "project_name", "slug", "context", "project_context",
                "parent_id", "created_at", "updated_at"):
        assert key in first, f"Task missing required field {key}"


def test_tasks_filter_by_project(client):
    resp = client.get("/workflow/api/tasks", params={"project": "dev-flow"})
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) > 0
    assert {t["project_id"] for t in data} == {"dev-flow"}


def test_tasks_filter_by_status(client):
    resp = client.get("/workflow/api/tasks", params={"status": "in_progress"})
    assert resp.status_code == 200
    data = resp.json()
    assert {t["status"] for t in data} == {"in_progress"}


def test_parent_tasks_include_progress(client):
    """Initiative/epic rows carry progress + children_count rollups."""
    resp = client.get("/workflow/api/tasks", params={"project": "dev-flow"})
    epics = [t for t in resp.json() if t["type"] == "epic"]
    assert len(epics) == 1
    epic = epics[0]
    assert "progress" in epic and "children_count" in epic
    # epic has 2 direct children (task 101 done, task 102 open)
    assert epic["children_count"] == 2
    assert epic["progress"]["total"] == 2
    assert epic["progress"]["done"] == 1
    assert epic["progress"]["open"] == 1
    assert epic["progress"]["percent"] == 50


# ── Dashboard & Projects Insights ──────────────────────────────────────────

def test_dashboard_has_context(client):
    resp = client.get("/workflow/api/dashboard")
    assert resp.status_code == 200
    data = resp.json()
    by_id = {p["project_id"]: p for p in data}
    assert by_id["dev-flow"]["context"] == "personal"
    assert by_id["work-x"]["context"] == "work"
    assert by_id["fam-y"]["context"] == "family"


def test_projects_insights_shape(client):
    resp = client.get("/workflow/api/projects-insights")
    assert resp.status_code == 200
    data = resp.json()
    by_id = {p["project_id"]: p for p in data}
    dev = by_id["dev-flow"]
    # Full shape the ProjectsPage consumes — break here means list view breaks.
    for key in ("project_id", "project_name", "context",
                "open_count", "in_progress_count", "backlog_count", "done_count",
                "active_epic_count", "stale_count", "done_14d",
                "overdue_count", "critical_count", "high_count", "top_priority",
                "last_activity"):
        assert key in dev, f"Projects-insights missing {key}"


def test_projects_insights_priority_rollup(client):
    resp = client.get("/workflow/api/projects-insights").json()
    by_id = {p["project_id"]: p for p in resp}
    dev = by_id["dev-flow"]
    # dev-flow has: 1 critical (in_progress), 1 high (epic, open),
    # 2 medium open, 1 low open
    assert dev["top_priority"] == "critical"
    assert dev["critical_count"] == 1
    assert dev["high_count"] == 1
    assert dev["in_progress_count"] == 1
    # One overdue (105) and one stale (104, created in Jan 2026 → >14d old)
    assert dev["overdue_count"] == 1
    assert dev["stale_count"] >= 1
    # One active epic (#100)
    assert dev["active_epic_count"] == 1


def test_projects_insights_excludes_archived(client):
    """Soft-delete semantics: archived_at IS NULL filter must be honored."""
    import apps.dev_workflow.routes as routes
    conn = sqlite3.connect(str(routes.TKT_DB_PATH))
    try:
        conn.execute(
            "INSERT INTO projects (id, name, archived_at, context) VALUES (?, ?, ?, ?)",
            ("archived-p", "Archived", "2026-01-01", "work"),
        )
        conn.commit()
    finally:
        conn.close()

    resp = client.get("/workflow/api/projects-insights").json()
    assert "archived-p" not in {p["project_id"] for p in resp}


# ── Roadmap ────────────────────────────────────────────────────────────────

def test_roadmap_includes_slug_and_contexts(client):
    resp = client.get("/workflow/api/roadmap")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1  # only the dev-flow epic (status open)
    e = data[0]
    assert e["id"] == 100
    assert e["slug"] == "ship-dev-flow-v2"
    assert e["context"] is None            # task's own context
    assert e["project_context"] == "personal"  # inherited from project
    assert e["progress"]["percent"] == 50


def test_roadmap_default_excludes_done(client):
    """Default call must NOT return done/cancelled/deferred parents."""
    import apps.dev_workflow.routes as routes
    conn = sqlite3.connect(str(routes.TKT_DB_PATH))
    try:
        conn.execute(
            """INSERT INTO tasks (id, project_id, title, type, priority, status, slug)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (900, "dev-flow", "Shipped epic", "epic", "medium", "done", "shipped-epic"),
        )
        conn.commit()
    finally:
        conn.close()

    default = client.get("/workflow/api/roadmap").json()
    assert 900 not in {e["id"] for e in default}
    full = client.get("/workflow/api/roadmap", params={"include_done": "true"}).json()
    assert 900 in {e["id"] for e in full}


def test_roadmap_filter_by_project(client):
    resp = client.get("/workflow/api/roadmap", params={"project": "work-x"})
    assert resp.status_code == 200
    assert resp.json() == []  # no epics in work-x


# ── Tree (id + slug resolution) ────────────────────────────────────────────

def test_tree_by_numeric_id(client):
    resp = client.get("/workflow/api/tree/100")
    assert resp.status_code == 200
    d = resp.json()
    assert d["tree"]["id"] == 100
    assert d["tree"]["slug"] == "ship-dev-flow-v2"
    assert len(d["tree"]["children"]) == 2
    assert "ancestors" in d


def test_tree_by_id_slug_combo(client):
    resp = client.get("/workflow/api/tree/100-ship-dev-flow-v2")
    assert resp.status_code == 200
    assert resp.json()["tree"]["id"] == 100


def test_tree_by_slug_only(client):
    resp = client.get("/workflow/api/tree/ship-dev-flow-v2")
    assert resp.status_code == 200
    assert resp.json()["tree"]["id"] == 100


def test_tree_unknown_returns_404(client):
    resp = client.get("/workflow/api/tree/no-such-slug-anywhere")
    assert resp.status_code == 404


def test_tree_id_slug_mismatch_honors_id(client):
    """When id + slug disagree, id wins (it's the authoritative prefix)."""
    resp = client.get("/workflow/api/tree/100-totally-wrong-slug")
    assert resp.status_code == 200
    assert resp.json()["tree"]["id"] == 100


# ── Task detail ────────────────────────────────────────────────────────────

def test_task_detail_returns_drawer_shape(client):
    resp = client.get("/workflow/api/tasks/100/detail")
    assert resp.status_code == 200
    d = resp.json()
    for key in ("task", "ancestors", "children", "siblings"):
        assert key in d, f"Detail response missing {key}"
    assert d["task"]["id"] == 100
    # Drawer reads slug for its "Open full tree" link
    assert d["task"].get("slug") == "ship-dev-flow-v2"


def test_task_detail_children_include_slug(client):
    """TaskDetailDrawer builds child links with treePath(id, slug) — without
    slug the links silently degrade to bare-id URLs."""
    resp = client.get("/workflow/api/tasks/100/detail")
    children = resp.json()["children"]
    assert len(children) == 2
    slugs = {c.get("slug") for c in children}
    assert "add-slug-urls" in slugs
    assert "wire-list-mode" in slugs


def test_task_detail_ancestors_include_slug(client):
    """ParentBreadcrumb uses ancestor.slug for deep links."""
    resp = client.get("/workflow/api/tasks/101/detail")
    ancestors = resp.json()["ancestors"]
    assert len(ancestors) >= 1
    assert ancestors[0]["id"] == 100
    assert ancestors[0].get("slug") == "ship-dev-flow-v2"


# ── Empty-state contracts (tickets #787/#788/#789 baselines) ───────────────

def test_pipeline_state_shape(client, monkeypatch):
    """Empty DB → {pipelines: []} — frontend must not crash on empty."""
    import apps.dev_workflow.routes as routes

    monkeypatch.setattr(routes.globmod, "glob", lambda pattern: [])
    resp = client.get("/workflow/api/pipeline-state")
    assert resp.status_code == 200
    assert resp.json() == {"pipelines": []}


def test_pipeline_state_reconciles_done_sessions(client, monkeypatch):
    import apps.dev_workflow.routes as routes

    done_session = f"done-{uuid4().hex}"
    live_session = f"live-{uuid4().hex}"
    done_path = Path(f"/tmp/claude-workflow-{done_session}.json")
    live_path = Path(f"/tmp/claude-workflow-{live_session}.json")

    done_state = {
        "session_id": done_session,
        "claimed_tkt": 101,
        "ticket_title": "Add slug URLs",
        "ticket_type": "task",
        "ticket_domain": "workflow",
        "pipeline": "code",
        "size": "medium",
        "started_at": "2026-05-08T10:00:00Z",
        "tokens_at_claim": 100,
        "steps": {
            "kb_lookup": {"status": "done", "tokens_at_completion": 140},
            "implement": {"status": "done", "tokens_at_completion": 160},
        },
    }
    live_state = {
        "session_id": live_session,
        "claimed_tkt": 103,
        "ticket_title": "Investigate insights gap",
        "ticket_type": "task",
        "ticket_domain": "workflow",
        "pipeline": "code",
        "size": "large",
        "started_at": "2026-05-08T11:00:00Z",
        "tokens_at_claim": 250,
        "steps": {
            "kb_lookup": {"status": "done", "tokens_at_completion": 275},
            "implement": {"status": "pending", "tokens_at_completion": 300},
        },
    }

    done_path.write_text(json.dumps(done_state), encoding="utf-8")
    live_path.write_text(json.dumps(live_state), encoding="utf-8")

    conn = sqlite3.connect(str(routes.TKT_DB_PATH))
    try:
        conn.executemany(
            "INSERT INTO claims (task_id, agent, session_id, heartbeat_at) VALUES (?, ?, ?, ?)",
            [
                (101, "cli", done_session, "2026-05-09 00:00:00"),
                (103, "cli", live_session, "2026-05-09 00:00:00"),
            ],
        )
        conn.commit()
    finally:
        conn.close()

    original_glob = routes.globmod.glob
    monkeypatch.setattr(
        routes.globmod,
        "glob",
        lambda pattern: [str(done_path), str(live_path)] if pattern == "/tmp/claude-workflow-*.json" else original_glob(pattern),
    )

    try:
        resp = client.get("/workflow/api/pipeline-state")
        assert resp.status_code == 200
        pipelines = resp.json()["pipelines"]
        assert [p["task_id"] for p in pipelines] == [103]

        conn = sqlite3.connect(str(routes.TKT_DB_PATH))
        try:
            pipeline_runs = conn.execute(
                "SELECT session_id, task_id, dismissed FROM pipeline_runs WHERE session_id = ?",
                (done_session,),
            ).fetchone()
            assert pipeline_runs is not None
            assert pipeline_runs[0] == done_session
            assert pipeline_runs[1] == 101
            assert pipeline_runs[2] == 0

            claim = conn.execute(
                "SELECT 1 FROM claims WHERE session_id = ?",
                (done_session,),
            ).fetchone()
            assert claim is None

            conn.execute("DELETE FROM pipeline_runs WHERE session_id = ?", (done_session,))
            conn.commit()
        finally:
            conn.close()

        assert not done_path.exists()
        assert live_path.exists()
    finally:
        done_path.unlink(missing_ok=True)
        live_path.unlink(missing_ok=True)


def test_insights_empty_shape(client):
    """No workflow_events → zero runs, empty arrays — frontend empty state."""
    resp = client.get("/workflow/api/insights")
    assert resp.status_code == 200
    d = resp.json()
    assert d["total_runs"] == 0
    assert d["flow_efficiency"] == []
    assert d["steps"] == []
    assert d["alerts"] == []
