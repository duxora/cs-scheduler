"""Shared connector ingestion and daemon helpers for SPlanner."""
import asyncio
from collections.abc import Callable
from datetime import date, datetime, time, timedelta, timezone
import json
import logging
from pathlib import Path

from .classify import classify_checkin
from .connectors import ConnectorNotConfigured, Connector, list_connectors
from .db import get_db
from .digest import draft_and_store
from server.config import DATA_DIR

logger = logging.getLogger(__name__)

DAEMON_STATE_PATH = DATA_DIR / "splanner-daemon-state.json"
CAPTURE_CUTOFF = time(hour=8, minute=0)
DIGEST_CUTOFF = time(hour=8, minute=30)


def _default_since() -> datetime:
    return datetime.now(timezone.utc) - timedelta(days=7)


def _parse_state_datetime(value: object) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    # State written without an offset parses as naive, while `since` is always UTC-aware
    # (_default_since, and the Z-replacing branch at the call site). Comparing the two raises
    # TypeError and aborts the entire capture pass for that connector - which is how the
    # calendar connector silently stopped ingesting.
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def _resolve_item_hierarchy(db, item_id: int) -> tuple[int, int, int] | tuple[None, None, None]:
    item = db.execute(
        "SELECT items.id AS item_id, items.objective_id AS objective_id, objectives.project_id AS project_id "
        "FROM items JOIN objectives ON objectives.id = items.objective_id WHERE items.id = ?",
        (item_id,),
    ).fetchone()
    if item is None:
        return None, None, None
    return item["project_id"], item["objective_id"], item["item_id"]


def ingest_connector(
    connector: Connector,
    schedule_classify: Callable[[int], None],
    since_floor: datetime | None = None,
) -> dict:
    db = get_db()
    try:
        last_seen = db.execute(
            "SELECT MAX(created_at) AS created_at FROM checkins WHERE source = ?",
            (connector.name,),
        ).fetchone()
        if last_seen is not None and isinstance(last_seen["created_at"], str):
            try:
                since = datetime.fromisoformat(last_seen["created_at"].replace("Z", "+00:00"))
            except ValueError:
                since = _default_since()
        else:
            since = _default_since()
        if since_floor is not None and since_floor > since:
            since = since_floor

        signals = connector.poll(since)

        checkin_ids: list[int] = []
        for signal in signals:
            existing = db.execute(
                "SELECT id FROM checkins WHERE source = ? AND source_ref = ?",
                (connector.name, signal.source_ref),
            ).fetchone()
            if existing is not None:
                continue

            resolved_project_id = None
            resolved_objective_id = None
            resolved_item_id = None
            if signal.item_id is not None:
                resolved_project_id, resolved_objective_id, resolved_item_id = _resolve_item_hierarchy(db, signal.item_id)

            kind = signal.kind or "note"
            should_classify = signal.kind is None
            if signal.occurred_at is not None:
                cursor = db.execute(
                    "INSERT INTO checkins (project_id, objective_id, item_id, body, kind, source, source_ref, ai_classified, created_at) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (
                        resolved_project_id,
                        resolved_objective_id,
                        resolved_item_id,
                        signal.body,
                        kind,
                        connector.name,
                        signal.source_ref,
                        0,
                        signal.occurred_at,
                    ),
                )
            else:
                cursor = db.execute(
                    "INSERT INTO checkins (project_id, objective_id, item_id, body, kind, source, source_ref, ai_classified) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    (
                        resolved_project_id,
                        resolved_objective_id,
                        resolved_item_id,
                        signal.body,
                        kind,
                        connector.name,
                        signal.source_ref,
                        0,
                    ),
                )
            checkin_ids.append(cursor.lastrowid)
            if should_classify:
                schedule_classify(cursor.lastrowid)

        db.commit()
        return {
            "polled": len(signals),
            "inserted": len(checkin_ids),
            "checkin_ids": checkin_ids,
        }
    finally:
        db.close()


def load_daemon_state(path: Path = DAEMON_STATE_PATH) -> dict:
    try:
        return json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return {
            "last_capture_date": None,
            "last_digest_week": None,
            "connectors": {},
        }


def save_daemon_state(state: dict, path: Path = DAEMON_STATE_PATH) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(state, ensure_ascii=True, sort_keys=True))


def should_draft_digest(now: datetime, state: dict, db) -> bool:
    week_start = (now.date() - timedelta(days=now.weekday())).isoformat()
    if now.weekday() != 0 or now.time() < DIGEST_CUTOFF:
        return False
    if state.get("last_digest_week") == week_start:
        return False
    approved = db.execute(
        "SELECT 1 FROM digests WHERE week_start = ? AND state = 'approved' LIMIT 1",
        (week_start,),
    ).fetchone()
    return approved is None


async def run_capture_pass(now: datetime | None = None, state_path: Path = DAEMON_STATE_PATH) -> dict:
    current = now or datetime.now().astimezone()
    state = load_daemon_state(state_path)
    scheduled_tasks: list[asyncio.Task] = []
    connectors_state = state.setdefault("connectors", {})

    def schedule_classify(checkin_id: int) -> None:
        scheduled_tasks.append(asyncio.create_task(asyncio.to_thread(classify_checkin, checkin_id)))

    for connector in list_connectors():
        try:
            ingest_connector(
                connector,
                schedule_classify,
                since_floor=_parse_state_datetime(connectors_state.get(connector.name)),
            )
        except ConnectorNotConfigured:
            logger.debug("connector %s not configured", connector.name)
            continue
        except Exception:
            logger.warning("capture failed for connector %s", connector.name, exc_info=True)
            continue
        connectors_state[connector.name] = current.isoformat()

    if scheduled_tasks:
        await asyncio.gather(*scheduled_tasks)

    state["last_capture_date"] = current.date().isoformat()
    save_daemon_state(state, state_path)
    return state


async def capture_daemon_loop() -> None:
    while True:
        try:
            now = datetime.now().astimezone()
            state = load_daemon_state()
            if now.time() >= CAPTURE_CUTOFF and state.get("last_capture_date") != now.date().isoformat():
                state = await run_capture_pass(now=now)

            db = get_db()
            try:
                if should_draft_digest(now, state, db):
                    week_start = (now.date() - timedelta(days=now.weekday())).isoformat()
                    draft = await asyncio.to_thread(draft_and_store, week_start)
                    if draft is not None:
                        state["last_digest_week"] = week_start
                        save_daemon_state(state)
            finally:
                db.close()
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.warning("splanner capture daemon iteration failed", exc_info=True)

        await asyncio.sleep(60)
