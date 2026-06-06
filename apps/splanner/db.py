"""SQLite storage for the SPlanner app."""
from pathlib import Path
import sqlite3

from server.config import DATA_DIR

SCHEMA = """
CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    context TEXT NOT NULL CHECK (context IN ('work', 'family', 'personal')),
    name TEXT NOT NULL,
    priority INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'on_track',
    archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS objectives (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    metric TEXT,
    target TEXT,
    current TEXT,
    unit TEXT,
    deadline TEXT,
    status TEXT NOT NULL DEFAULT 'on_track'
        CHECK (status IN ('on_track', 'at_risk', 'blocked', 'done')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    objective_id INTEGER NOT NULL REFERENCES objectives(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'todo'
        CHECK (status IN ('todo', 'doing', 'blocked', 'done')),
    eta TEXT,
    blockers TEXT,
    tkt_ticket_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS checkins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
    objective_id INTEGER REFERENCES objectives(id) ON DELETE CASCADE,
    item_id INTEGER REFERENCES items(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('win', 'risk', 'decision', 'blocked', 'note')),
    source TEXT NOT NULL CHECK (source IN ('manual', 'calendar', 'tkt', 'life-graph')),
    source_ref TEXT,
    ai_classified INTEGER NOT NULL DEFAULT 0 CHECK (ai_classified IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS digests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    week_start TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'drafted'
        CHECK (state IN ('drafted', 'needs_review', 'approved')),
    narrative_md TEXT NOT NULL DEFAULT '',
    kpi_deltas TEXT NOT NULL DEFAULT '[]',
    risks TEXT NOT NULL DEFAULT '[]',
    nudges TEXT NOT NULL DEFAULT '[]',
    focus TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_projects_context_priority
    ON projects(context, archived, priority DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_objectives_project_id
    ON objectives(project_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_items_objective_id
    ON items(objective_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_checkins_project_created_at
    ON checkins(project_id, created_at DESC, id DESC);
"""


class Database:
    """Thin sqlite wrapper for SPlanner."""

    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(str(path))
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA foreign_keys = ON")
        self.conn.executescript(SCHEMA)

    def execute(self, sql: str, params: tuple = ()) -> sqlite3.Cursor:
        return self.conn.execute(sql, params)

    def commit(self) -> None:
        self.conn.commit()

    def close(self) -> None:
        self.conn.close()


def get_db() -> Database:
    return Database(DATA_DIR / "splanner.db")
