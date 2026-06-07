"""tkt connector for SPlanner."""
from datetime import datetime
import logging
import os
from pathlib import Path
import re
import shutil
import sqlite3
import subprocess

from ..db import get_db
from . import ConnectorNotConfigured, RawSignal, register

logger = logging.getLogger(__name__)

TKT_BACKLOG_DB_PATH = Path.home() / ".backlog" / "backlog.db"
TKT_BIN = shutil.which("tkt") or str(Path.home() / ".nvm/versions/node/v22.16.0/bin/tkt")

STATUS_MAP = {
    "open": "todo",
    "backlog": "todo",
    "deferred": "todo",
    "in_progress": "doing",
    "done": "done",
    "cancelled": "todo",
}


class TktCreateError(Exception):
    """Raised when ticket creation fails."""


class TktConnector:
    name = "tkt"

    def is_configured(self) -> bool:
        return TKT_BACKLOG_DB_PATH.is_file()

    def _connect_backlog(self) -> sqlite3.Connection:
        if not self.is_configured():
            raise ConnectorNotConfigured
        connection = sqlite3.connect(f"file:{TKT_BACKLOG_DB_PATH}?mode=ro", uri=True)
        connection.row_factory = sqlite3.Row
        return connection

    def poll(self, since: datetime) -> list[RawSignal]:
        del since
        backlog = self._connect_backlog()
        db = get_db()
        try:
            item_rows = db.execute(
                """
                SELECT
                    items.id AS item_id,
                    items.name AS item_name,
                    items.status AS item_status,
                    items.tkt_ticket_id AS tkt_ticket_id
                FROM items
                JOIN objectives ON objectives.id = items.objective_id
                JOIN projects ON projects.id = objectives.project_id
                WHERE items.tkt_ticket_id IS NOT NULL
                ORDER BY items.id
                """
            ).fetchall()

            signals: list[RawSignal] = []
            for row in item_rows:
                ticket = backlog.execute(
                    "SELECT id, title, status, updated_at FROM tasks WHERE id = ?",
                    (row["tkt_ticket_id"],),
                ).fetchone()
                if ticket is None:
                    continue

                mapped_status = STATUS_MAP.get(ticket["status"])
                if mapped_status is None or mapped_status == row["item_status"]:
                    continue

                db.execute(
                    "UPDATE items SET status = ? WHERE id = ?",
                    (mapped_status, row["item_id"]),
                )
                signals.append(
                    RawSignal(
                        body=(
                            f"tkt #{ticket['id']} '{ticket['title']}' → {ticket['status']}; "
                            f"item '{row['item_name']}' {row['item_status']}→{mapped_status}"
                        ),
                        source_ref=f"{ticket['id']}:{mapped_status}:{ticket['updated_at']}",
                        occurred_at=ticket["updated_at"],
                        kind="win" if mapped_status == "done" else "note",
                        item_id=row["item_id"],
                    )
                )

            db.commit()
            return signals
        finally:
            backlog.close()
            db.close()


def _tkt_env() -> dict[str, str]:
    return {
        **os.environ,
        "PATH": str(Path(TKT_BIN).parent) + os.pathsep + os.environ.get("PATH", ""),
    }


def _run_tkt(args: list[str]) -> str:
    """Run tkt CLI, return stdout. Raises TktCreateError on failure."""
    try:
        result = subprocess.run(
            args,
            capture_output=True,
            text=True,
            timeout=30,
            env=_tkt_env(),
        )
    except (FileNotFoundError, OSError, subprocess.TimeoutExpired) as exc:
        raise TktCreateError from exc

    if result.returncode != 0:
        if result.stderr.strip():
            logger.warning("tkt command failed stderr: %s", result.stderr.strip())
        raise TktCreateError(result.stderr.strip() or result.stdout.strip())

    return result.stdout


def _parse_ticket_id(stdout: str) -> int:
    match = re.search(r"#(\d+)", stdout)
    if match is None:
        raise TktCreateError("unable to parse ticket id")
    return int(match.group(1))


def create_ticket(title: str, desc: str, tkt_project: str | None) -> int:
    args = [TKT_BIN, "add", title, "--description", desc]
    if tkt_project:
        args.extend(["--project", tkt_project])
    return _parse_ticket_id(_run_tkt(args))


def create_ticket_with_parent(
    title: str,
    desc: str,
    tkt_project: str,
    parent_id: int,
) -> int:
    args = [
        TKT_BIN, "add", title,
        "--description", desc,
        "--project", tkt_project,
        "--parent-id", str(parent_id),
    ]
    return _parse_ticket_id(_run_tkt(args))


def create_epic(title: str, desc: str, tkt_project: str) -> int:
    args = [
        TKT_BIN, "add", title,
        "--type", "epic",
        "--project", tkt_project,
        "--description", desc,
    ]
    return _parse_ticket_id(_run_tkt(args))


def adopt_ticket(ticket_id: int, epic_id: int) -> None:
    """Set parent of an existing ticket to the given epic."""
    _run_tkt([TKT_BIN, "edit", str(ticket_id), "--parent-id", str(epic_id)])


def get_epic_project(epic_id: int) -> str | None:
    """Return the tkt project_id for the given epic from backlog.db, or None."""
    if not TKT_BACKLOG_DB_PATH.is_file():
        return None
    conn = sqlite3.connect(f"file:{TKT_BACKLOG_DB_PATH}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    try:
        row = conn.execute(
            "SELECT project_id FROM tasks WHERE id = ?", (epic_id,)
        ).fetchone()
        return str(row["project_id"]) if row and row["project_id"] is not None else None
    finally:
        conn.close()


def list_tkt_projects() -> list[dict]:
    """Return non-archived tkt projects as list of {id, name} dicts."""
    if not TKT_BACKLOG_DB_PATH.is_file():
        return []
    conn = sqlite3.connect(f"file:{TKT_BACKLOG_DB_PATH}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute(
            "SELECT id, name FROM projects WHERE archived_at IS NULL ORDER BY name"
        ).fetchall()
        return [{"id": str(row["id"]), "name": row["name"]} for row in rows]
    finally:
        conn.close()


tkt_connector = TktConnector()
register(tkt_connector)
