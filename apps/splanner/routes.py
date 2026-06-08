"""SPlanner API routes."""
from datetime import date, datetime, timedelta, timezone
import json
import sqlite3
from typing import Literal

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query
from pydantic import BaseModel, Field

from .capture import _parse_state_datetime, ingest_connector, load_daemon_state
from .classify import classify_checkin
from .connectors import ConnectorNotConfigured, get_connector, list_connectors
from .db import get_db
from .digest import compute_kpi_deltas, draft_and_store, draft_digest

router = APIRouter()

Context = Literal["work", "family", "personal"]


class ProjectCreate(BaseModel):
    context: Context
    name: str = Field(min_length=1)
    priority: int = 0


class ProjectUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1)
    priority: int | None = None
    archived: bool | None = None


ObjectiveStatus = Literal["on_track", "at_risk", "blocked", "done"]
ItemStatus = Literal["todo", "doing", "blocked", "done"]
CheckinKind = Literal["win", "risk", "decision", "blocked", "note"]
CheckinSource = Literal["manual", "calendar", "tkt", "life-graph"]
DigestState = Literal["drafted", "needs_review", "approved"]
DigestRiskSeverity = Literal["high", "medium", "low"]
DigestNudgeType = Literal["stale_objective", "pace", "missing_win"]


class ObjectiveCreate(BaseModel):
    project_id: int
    name: str = Field(min_length=1)
    metric: str | None = None
    target: str | None = None
    unit: str | None = None
    deadline: str | None = None


class ObjectiveUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1)
    metric: str | None = None
    target: str | None = None
    current: str | None = None
    unit: str | None = None
    deadline: str | None = None
    status: ObjectiveStatus | None = None


class ItemCreate(BaseModel):
    objective_id: int
    name: str = Field(min_length=1)
    eta: str | None = None
    tkt_ticket_id: int | None = None


class ItemUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1)
    status: ItemStatus | None = None
    eta: str | None = None
    blockers: str | None = None
    tkt_ticket_id: int | None = None


class CheckinCreate(BaseModel):
    body: str = Field(min_length=1)
    kind: CheckinKind | None = None
    project_id: int | None = None
    objective_id: int | None = None
    item_id: int | None = None


class CheckinUpdate(BaseModel):
    kind: CheckinKind | None = None
    project_id: int | None = None
    objective_id: int | None = None
    item_id: int | None = None


class DigestRisk(BaseModel):
    title: str
    severity: DigestRiskSeverity
    evidence_count: int


class DigestNudge(BaseModel):
    type: DigestNudgeType
    message: str
    project_id: int | None = None


class FocusItem(BaseModel):
    text: str
    accepted: bool


class Digest(BaseModel):
    id: int
    week_start: str
    state: DigestState
    narrative_md: str
    kpi_deltas: list[dict]
    risks: list[DigestRisk]
    nudges: list[DigestNudge]
    focus: list[FocusItem]
    created_at: str


class DigestUpdate(BaseModel):
    narrative_md: str | None = None
    focus: list[FocusItem] | None = None


class ConnectorStatus(BaseModel):
    name: str
    configured: bool


class ConnectorPollResult(BaseModel):
    polled: int
    inserted: int
    checkin_ids: list[int]


class CreateTicketPayload(BaseModel):
    tkt_project: str | None = None


class CreateEpicPayload(BaseModel):
    tkt_project: str
    item_ids: list[int] | None = None
    adopt_item_ids: list[int] | None = None


def _project_row_to_dict(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "context": row["context"],
        "name": row["name"],
        "priority": row["priority"],
        "status": row["status"],
        "archived": bool(row["archived"]),
        "created_at": row["created_at"],
    }


def _project_list_row_to_dict(row: sqlite3.Row) -> dict:
    project = _project_row_to_dict(row)
    project["health"] = {
        "on_track": row["health_on_track"],
        "at_risk": row["health_at_risk"],
        "blocked": row["health_blocked"],
        "done": row["health_done"],
    }
    project["items_blocked"] = row["items_blocked"]
    project["latest_checkin"] = (
        {
            "body": row["latest_checkin_body"],
            "kind": row["latest_checkin_kind"],
            "created_at": row["latest_checkin_created_at"],
        }
        if row["latest_checkin_created_at"] is not None
        else None
    )
    project["is_blocked"] = bool(row["is_blocked"])
    return project


def _item_row_to_dict(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "objective_id": row["objective_id"],
        "name": row["name"],
        "status": row["status"],
        "eta": row["eta"],
        "blockers": row["blockers"],
        "tkt_ticket_id": row["tkt_ticket_id"],
        "created_at": row["created_at"],
    }


def _objective_row_to_dict(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "project_id": row["project_id"],
        "name": row["name"],
        "metric": row["metric"],
        "target": row["target"],
        "current": row["current"],
        "unit": row["unit"],
        "deadline": row["deadline"],
        "status": row["status"],
        "tkt_epic_id": row["tkt_epic_id"] if "tkt_epic_id" in row.keys() else None,
        "created_at": row["created_at"],
        "items": [],
    }


def _checkin_row_to_dict(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "project_id": row["project_id"],
        "objective_id": row["objective_id"],
        "item_id": row["item_id"],
        "body": row["body"],
        "kind": row["kind"],
        "source": row["source"],
        "source_ref": row["source_ref"],
        "ai_classified": bool(row["ai_classified"]),
        "suggested_level": row["suggested_level"],
        "suggested_id": row["suggested_id"],
        "created_at": row["created_at"],
    }


def _parse_json_column(value: str) -> list:
    parsed = json.loads(value)
    return parsed if isinstance(parsed, list) else []


def _digest_row_to_dict(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "week_start": row["week_start"],
        "state": row["state"],
        "narrative_md": row["narrative_md"],
        "kpi_deltas": _parse_json_column(row["kpi_deltas"]),
        "risks": _parse_json_column(row["risks"]),
        "nudges": _parse_json_column(row["nudges"]),
        "focus": _parse_json_column(row["focus"]),
        "created_at": row["created_at"],
    }


def _normalize_week_start(value: str | None) -> str:
    if value is None:
        day = date.today()
    else:
        try:
            day = date.fromisoformat(value)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="invalid week_start") from exc
    return (day - timedelta(days=day.weekday())).isoformat()


def _connector_is_configured(connector) -> bool:
    checker = getattr(connector, "is_configured", None)
    if callable(checker):
        return bool(checker())
    return True


def _resolve_item_hierarchy(db, item_id: int) -> tuple[int, int, int]:
    item = db.execute(
        "SELECT items.id AS item_id, items.objective_id AS objective_id, objectives.project_id AS project_id "
        "FROM items JOIN objectives ON objectives.id = items.objective_id WHERE items.id = ?",
        (item_id,),
    ).fetchone()
    if item is None:
        raise HTTPException(status_code=404, detail="not found")
    return item["project_id"], item["objective_id"], item["item_id"]


def _resolve_checkin_links(
    db,
    *,
    project_id: int | None,
    objective_id: int | None,
    item_id: int | None,
) -> tuple[int | None, int | None, int | None]:
    link_ids = [link_id for link_id in (project_id, objective_id, item_id) if link_id is not None]
    if len(link_ids) > 1:
        raise HTTPException(status_code=400, detail="at most one link id may be set")

    if project_id is not None:
        project = db.execute("SELECT id FROM projects WHERE id = ?", (project_id,)).fetchone()
        if project is None:
            raise HTTPException(status_code=404, detail="not found")
        return project_id, None, None

    if objective_id is not None:
        objective = db.execute(
            "SELECT id, project_id FROM objectives WHERE id = ?",
            (objective_id,),
        ).fetchone()
        if objective is None:
            raise HTTPException(status_code=404, detail="not found")
        return objective["project_id"], objective_id, None

    if item_id is not None:
        item = db.execute(
            "SELECT items.id, objectives.project_id "
            "FROM items JOIN objectives ON objectives.id = items.objective_id "
            "WHERE items.id = ?",
            (item_id,),
        ).fetchone()
        if item is None:
            raise HTTPException(status_code=404, detail="not found")
        return item["project_id"], None, item_id

    return None, None, None


@router.get("/api/projects")
async def list_projects(
    context: Context | None = Query(default=None),
    include_archived: bool = Query(default=False),
):
    db = get_db()
    try:
        sql = """
            WITH objective_rollups AS (
                SELECT
                    project_id,
                    SUM(CASE WHEN status = 'on_track' THEN 1 ELSE 0 END) AS health_on_track,
                    SUM(CASE WHEN status = 'at_risk' THEN 1 ELSE 0 END) AS health_at_risk,
                    SUM(CASE WHEN status = 'blocked' THEN 1 ELSE 0 END) AS health_blocked,
                    SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS health_done
                FROM objectives
                GROUP BY project_id
            ),
            item_rollups AS (
                SELECT
                    objectives.project_id AS project_id,
                    SUM(CASE WHEN items.status = 'blocked' THEN 1 ELSE 0 END) AS items_blocked
                FROM items
                JOIN objectives ON objectives.id = items.objective_id
                GROUP BY objectives.project_id
            ),
            latest_checkins AS (
                SELECT project_id, body, kind, created_at
                FROM (
                    SELECT
                        project_id,
                        body,
                        kind,
                        created_at,
                        ROW_NUMBER() OVER (
                            PARTITION BY project_id
                            ORDER BY created_at DESC, id DESC
                        ) AS row_num
                    FROM checkins
                    WHERE project_id IS NOT NULL
                )
                WHERE row_num = 1
            )
            SELECT
                projects.id,
                projects.context,
                projects.name,
                projects.priority,
                projects.status,
                projects.archived,
                projects.created_at,
                COALESCE(objective_rollups.health_on_track, 0) AS health_on_track,
                COALESCE(objective_rollups.health_at_risk, 0) AS health_at_risk,
                COALESCE(objective_rollups.health_blocked, 0) AS health_blocked,
                COALESCE(objective_rollups.health_done, 0) AS health_done,
                COALESCE(item_rollups.items_blocked, 0) AS items_blocked,
                latest_checkins.body AS latest_checkin_body,
                latest_checkins.kind AS latest_checkin_kind,
                latest_checkins.created_at AS latest_checkin_created_at,
                CASE
                    WHEN COALESCE(objective_rollups.health_blocked, 0) > 0
                        OR COALESCE(item_rollups.items_blocked, 0) > 0
                    THEN 1
                    ELSE 0
                END AS is_blocked
            FROM projects
            LEFT JOIN objective_rollups ON objective_rollups.project_id = projects.id
            LEFT JOIN item_rollups ON item_rollups.project_id = projects.id
            LEFT JOIN latest_checkins ON latest_checkins.project_id = projects.id
            WHERE (? IS NULL OR projects.context = ?)
        """
        params: list[object] = [context, context]
        if not include_archived:
            sql += " AND archived = 0"
        sql += " ORDER BY is_blocked DESC, priority DESC, id DESC"
        rows = db.execute(sql, tuple(params)).fetchall()
        return [_project_list_row_to_dict(row) for row in rows]
    finally:
        db.close()


@router.post("/api/projects", status_code=201)
async def create_project(payload: ProjectCreate):
    db = get_db()
    try:
        cursor = db.execute(
            "INSERT INTO projects (context, name, priority) VALUES (?, ?, ?)",
            (payload.context, payload.name.strip(), payload.priority),
        )
        db.commit()
        row = db.execute(
            "SELECT id, context, name, priority, status, archived, created_at "
            "FROM projects WHERE id = ?",
            (cursor.lastrowid,),
        ).fetchone()
        return _project_row_to_dict(row)
    finally:
        db.close()


@router.patch("/api/projects/{project_id}")
async def update_project(project_id: int, payload: ProjectUpdate):
    fields = payload.model_dump(exclude_unset=True)
    if not fields:
        raise HTTPException(status_code=400, detail="no fields to update")

    db = get_db()
    try:
        existing = db.execute(
            "SELECT id, context, name, priority, status, archived, created_at FROM projects WHERE id = ?",
            (project_id,),
        ).fetchone()
        if existing is None:
            raise HTTPException(status_code=404, detail="not found")

        assignments: list[str] = []
        params: list[object] = []
        if "name" in fields:
            assignments.append("name = ?")
            params.append(fields["name"].strip())
        if "priority" in fields:
            assignments.append("priority = ?")
            params.append(fields["priority"])
        if "archived" in fields:
            assignments.append("archived = ?")
            params.append(1 if fields["archived"] else 0)

        params.append(project_id)
        db.execute(f"UPDATE projects SET {', '.join(assignments)} WHERE id = ?", tuple(params))
        db.commit()
        row = db.execute(
            "SELECT id, context, name, priority, status, archived, created_at FROM projects WHERE id = ?",
            (project_id,),
        ).fetchone()
        return _project_row_to_dict(row)
    finally:
        db.close()


@router.get("/api/projects/{project_id}")
async def get_project_detail(project_id: int):
    db = get_db()
    try:
        project = db.execute(
            "SELECT id, context, name, priority, status, archived, created_at FROM projects WHERE id = ?",
            (project_id,),
        ).fetchone()
        if project is None:
            raise HTTPException(status_code=404, detail="not found")

        objective_rows = db.execute(
            "SELECT id, project_id, name, metric, target, current, unit, deadline, status, tkt_epic_id, created_at "
            "FROM objectives WHERE project_id = ? ORDER BY id DESC",
            (project_id,),
        ).fetchall()
        objectives = [_objective_row_to_dict(row) for row in objective_rows]
        objectives_by_id = {objective["id"]: objective for objective in objectives}

        if objectives_by_id:
            placeholders = ",".join("?" for _ in objectives_by_id)
            item_rows = db.execute(
                "SELECT id, objective_id, name, status, eta, blockers, tkt_ticket_id, created_at "
                f"FROM items WHERE objective_id IN ({placeholders}) ORDER BY id DESC",
                tuple(objectives_by_id),
            ).fetchall()
            for row in item_rows:
                objectives_by_id[row["objective_id"]]["items"].append(_item_row_to_dict(row))

        checkin_rows = db.execute(
            "SELECT id, project_id, objective_id, item_id, body, kind, source, source_ref, ai_classified, "
            "suggested_level, suggested_id, created_at "
            "FROM checkins WHERE project_id = ? ORDER BY created_at DESC, id DESC",
            (project_id,),
        ).fetchall()

        return {
            "project": _project_row_to_dict(project),
            "objectives": objectives,
            "checkins": [_checkin_row_to_dict(row) for row in checkin_rows],
        }
    finally:
        db.close()


@router.post("/api/objectives", status_code=201)
async def create_objective(payload: ObjectiveCreate):
    db = get_db()
    try:
        project = db.execute("SELECT id FROM projects WHERE id = ?", (payload.project_id,)).fetchone()
        if project is None:
            raise HTTPException(status_code=404, detail="not found")

        cursor = db.execute(
            "INSERT INTO objectives (project_id, name, metric, target, unit, deadline) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (
                payload.project_id,
                payload.name.strip(),
                payload.metric,
                payload.target,
                payload.unit,
                payload.deadline,
            ),
        )
        db.commit()
        row = db.execute(
            "SELECT id, project_id, name, metric, target, current, unit, deadline, status, tkt_epic_id, created_at "
            "FROM objectives WHERE id = ?",
            (cursor.lastrowid,),
        ).fetchone()
        return _objective_row_to_dict(row)
    finally:
        db.close()


@router.patch("/api/objectives/{objective_id}")
async def update_objective(objective_id: int, payload: ObjectiveUpdate):
    fields = payload.model_dump(exclude_unset=True)
    if not fields:
        raise HTTPException(status_code=400, detail="no fields to update")

    db = get_db()
    try:
        existing = db.execute(
            "SELECT id FROM objectives WHERE id = ?",
            (objective_id,),
        ).fetchone()
        if existing is None:
            raise HTTPException(status_code=404, detail="not found")

        assignments: list[str] = []
        params: list[object] = []
        for field in ("name", "metric", "target", "current", "unit", "deadline", "status"):
            if field in fields:
                assignments.append(f"{field} = ?")
                value = fields[field]
                if field == "name":
                    value = value.strip()
                params.append(value)

        params.append(objective_id)
        db.execute(f"UPDATE objectives SET {', '.join(assignments)} WHERE id = ?", tuple(params))
        db.commit()
        row = db.execute(
            "SELECT id, project_id, name, metric, target, current, unit, deadline, status, tkt_epic_id, created_at "
            "FROM objectives WHERE id = ?",
            (objective_id,),
        ).fetchone()
        return _objective_row_to_dict(row)
    finally:
        db.close()


@router.post("/api/items", status_code=201)
async def create_item(payload: ItemCreate):
    db = get_db()
    try:
        objective = db.execute("SELECT id FROM objectives WHERE id = ?", (payload.objective_id,)).fetchone()
        if objective is None:
            raise HTTPException(status_code=404, detail="not found")

        cursor = db.execute(
            "INSERT INTO items (objective_id, name, eta, tkt_ticket_id) VALUES (?, ?, ?, ?)",
            (
                payload.objective_id,
                payload.name.strip(),
                payload.eta,
                payload.tkt_ticket_id,
            ),
        )
        db.commit()
        row = db.execute(
            "SELECT id, objective_id, name, status, eta, blockers, tkt_ticket_id, created_at "
            "FROM items WHERE id = ?",
            (cursor.lastrowid,),
        ).fetchone()
        return _item_row_to_dict(row)
    finally:
        db.close()


@router.get("/api/checkins")
async def list_checkins(
    project_id: int | None = Query(default=None),
    kind: CheckinKind | None = Query(default=None),
    source: CheckinSource | None = Query(default=None),
):
    db = get_db()
    try:
        sql = (
            "SELECT id, project_id, objective_id, item_id, body, kind, source, source_ref, ai_classified, "
            "suggested_level, suggested_id, created_at "
            "FROM checkins WHERE (? IS NULL OR project_id = ?) "
            "AND (? IS NULL OR kind = ?) "
            "AND (? IS NULL OR source = ?) "
            "ORDER BY created_at DESC, id DESC LIMIT 200"
        )
        rows = db.execute(
            sql,
            (project_id, project_id, kind, kind, source, source),
        ).fetchall()
        return [_checkin_row_to_dict(row) for row in rows]
    finally:
        db.close()


@router.post("/api/checkins", status_code=201)
async def create_checkin(payload: CheckinCreate, background_tasks: BackgroundTasks):
    db = get_db()
    try:
        resolved_project_id, resolved_objective_id, resolved_item_id = _resolve_checkin_links(
            db,
            project_id=payload.project_id,
            objective_id=payload.objective_id,
            item_id=payload.item_id,
        )
        kind = payload.kind or "note"
        should_classify = payload.kind is None
        cursor = db.execute(
            "INSERT INTO checkins (project_id, objective_id, item_id, body, kind, source, ai_classified, "
            "suggested_level, suggested_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                resolved_project_id,
                resolved_objective_id,
                resolved_item_id,
                payload.body.strip(),
                kind,
                "manual",
                0,
                None,
                None,
            ),
        )
        db.commit()
        if should_classify:
            background_tasks.add_task(classify_checkin, cursor.lastrowid)
        row = db.execute(
            "SELECT id, project_id, objective_id, item_id, body, kind, source, source_ref, ai_classified, "
            "suggested_level, suggested_id, created_at "
            "FROM checkins WHERE id = ?",
            (cursor.lastrowid,),
        ).fetchone()
        return _checkin_row_to_dict(row)
    finally:
        db.close()


@router.get("/api/connectors", response_model=list[ConnectorStatus])
async def get_connectors():
    return [
        {"name": connector.name, "configured": _connector_is_configured(connector)}
        for connector in list_connectors()
    ]


@router.post("/api/connectors/{name}/poll", response_model=ConnectorPollResult)
async def poll_connector(name: str, background_tasks: BackgroundTasks):
    connector = get_connector(name)
    if connector is None:
        raise HTTPException(status_code=404, detail="not found")
    # Honor the daemon's watermark too — otherwise a manual sync after clearing
    # ingested check-ins would resurrect them (since is DB-derived).
    state = load_daemon_state()
    since_floor = _parse_state_datetime(state.get("connectors", {}).get(name))
    try:
        return ingest_connector(
            connector,
            lambda checkin_id: background_tasks.add_task(classify_checkin, checkin_id),
            since_floor=since_floor,
        )
    except ConnectorNotConfigured as exc:
        raise HTTPException(status_code=503, detail=f"{name} connector not configured") from exc


@router.post("/api/items/{item_id}/create-ticket")
async def create_ticket_for_item(item_id: int, payload: CreateTicketPayload):
    from .connectors.tkt import (
        TktCreateError,
        create_ticket,
        create_ticket_with_parent,
        get_epic_project,
    )

    db = get_db()
    try:
        row = db.execute(
            """
            SELECT
                items.id AS id,
                items.objective_id AS objective_id,
                items.name AS name,
                items.status AS status,
                items.eta AS eta,
                items.blockers AS blockers,
                items.tkt_ticket_id AS tkt_ticket_id,
                items.created_at AS created_at,
                objectives.name AS objective_name,
                objectives.tkt_epic_id AS tkt_epic_id,
                projects.name AS project_name,
                projects.context AS project_context
            FROM items
            JOIN objectives ON objectives.id = items.objective_id
            JOIN projects ON projects.id = objectives.project_id
            WHERE items.id = ?
            """,
            (item_id,),
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="not found")
        if row["tkt_ticket_id"] is not None:
            raise HTTPException(status_code=409, detail="item already linked")
        if row["project_context"] != "work":
            raise HTTPException(status_code=400, detail="tkt linking is work-context only")

        desc_lines = [
            f"Project: {row['project_name']}",
            f"Objective: {row['objective_name']}",
            f"Item: {row['name']}",
        ]
        if row["eta"]:
            desc_lines.append(f"ETA: {row['eta']}")
        if row["blockers"]:
            desc_lines.append(f"Blockers: {row['blockers']}")

        epic_id = row["tkt_epic_id"]
        try:
            if epic_id is not None:
                # Objective is linked to an epic — create as child ticket, ignore payload.tkt_project
                epic_project = get_epic_project(epic_id)
                if epic_project is None:
                    raise HTTPException(
                        status_code=502,
                        detail="could not resolve tkt project for epic",
                    )
                ticket_id = create_ticket_with_parent(
                    row["name"],
                    "\n".join(desc_lines),
                    epic_project,
                    epic_id,
                )
            else:
                ticket_id = create_ticket(row["name"], "\n".join(desc_lines), payload.tkt_project)
        except TktCreateError as exc:
            raise HTTPException(status_code=502, detail="tkt create failed") from exc

        db.execute(
            "UPDATE items SET tkt_ticket_id = ? WHERE id = ?",
            (ticket_id, item_id),
        )
        db.commit()
        updated = db.execute(
            "SELECT id, objective_id, name, status, eta, blockers, tkt_ticket_id, created_at FROM items WHERE id = ?",
            (item_id,),
        ).fetchone()
        return _item_row_to_dict(updated)
    finally:
        db.close()


@router.patch("/api/checkins/{checkin_id}")
async def update_checkin(checkin_id: int, payload: CheckinUpdate):
    fields = payload.model_dump(exclude_unset=True)
    if not fields:
        raise HTTPException(status_code=400, detail="no fields to update")

    db = get_db()
    try:
        existing = db.execute(
            "SELECT id, project_id, objective_id, item_id FROM checkins WHERE id = ?",
            (checkin_id,),
        ).fetchone()
        if existing is None:
            raise HTTPException(status_code=404, detail="not found")

        assignments: list[str] = []
        params: list[object] = []

        if "kind" in fields:
            assignments.append("kind = ?")
            params.append(fields["kind"])

        link_fields_present = any(field in fields for field in ("project_id", "objective_id", "item_id"))
        if link_fields_present:
            resolved_project_id, resolved_objective_id, resolved_item_id = _resolve_checkin_links(
                db,
                project_id=fields.get("project_id"),
                objective_id=fields.get("objective_id"),
                item_id=fields.get("item_id"),
            )
            assignments.extend([
                "project_id = ?",
                "objective_id = ?",
                "item_id = ?",
            ])
            params.extend([
                resolved_project_id,
                resolved_objective_id,
                resolved_item_id,
            ])

        assignments.extend([
            "suggested_level = ?",
            "suggested_id = ?",
        ])
        params.extend([None, None, checkin_id])

        db.execute(f"UPDATE checkins SET {', '.join(assignments)} WHERE id = ?", tuple(params))
        db.commit()
        row = db.execute(
            "SELECT id, project_id, objective_id, item_id, body, kind, source, source_ref, ai_classified, "
            "suggested_level, suggested_id, created_at FROM checkins WHERE id = ?",
            (checkin_id,),
        ).fetchone()
        return _checkin_row_to_dict(row)
    finally:
        db.close()


@router.patch("/api/items/{item_id}")
async def update_item(item_id: int, payload: ItemUpdate):
    fields = payload.model_dump(exclude_unset=True)
    if not fields:
        raise HTTPException(status_code=400, detail="no fields to update")

    db = get_db()
    try:
        existing = db.execute("SELECT id FROM items WHERE id = ?", (item_id,)).fetchone()
        if existing is None:
            raise HTTPException(status_code=404, detail="not found")

        assignments: list[str] = []
        params: list[object] = []
        for field in ("name", "status", "eta", "blockers", "tkt_ticket_id"):
            if field in fields:
                assignments.append(f"{field} = ?")
                value = fields[field]
                if field == "name":
                    value = value.strip()
                params.append(value)

        params.append(item_id)
        db.execute(f"UPDATE items SET {', '.join(assignments)} WHERE id = ?", tuple(params))
        db.commit()
        row = db.execute(
            "SELECT id, objective_id, name, status, eta, blockers, tkt_ticket_id, created_at "
            "FROM items WHERE id = ?",
            (item_id,),
        ).fetchone()
        return _item_row_to_dict(row)
    finally:
        db.close()


@router.post("/api/digest/draft", response_model=Digest)
async def create_digest_draft(week_start: str | None = Query(default=None)):
    normalized_week_start = _normalize_week_start(week_start)
    digest = draft_and_store(
        normalized_week_start,
        kpi_func=compute_kpi_deltas,
        draft_func=draft_digest,
    )
    if digest is None:
        raise HTTPException(status_code=502, detail="digest draft failed")
    return digest


@router.get("/api/digest/latest", response_model=Digest)
async def get_latest_digest():
    db = get_db()
    try:
        row = db.execute(
            "SELECT id, week_start, state, narrative_md, kpi_deltas, risks, nudges, focus, created_at "
            "FROM digests ORDER BY week_start DESC, id DESC LIMIT 1"
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="not found")
        return _digest_row_to_dict(row)
    finally:
        db.close()


@router.get("/api/digests", response_model=list[Digest])
async def list_digests():
    db = get_db()
    try:
        rows = db.execute(
            "SELECT id, week_start, state, narrative_md, kpi_deltas, risks, nudges, focus, created_at "
            "FROM digests ORDER BY week_start DESC, id DESC"
        ).fetchall()
        return [_digest_row_to_dict(row) for row in rows]
    finally:
        db.close()


@router.patch("/api/digest/{digest_id}", response_model=Digest)
async def update_digest(digest_id: int, payload: DigestUpdate):
    fields = payload.model_dump(exclude_unset=True)
    if not fields:
        raise HTTPException(status_code=400, detail="no fields to update")

    db = get_db()
    try:
        existing = db.execute(
            "SELECT id, state FROM digests WHERE id = ?",
            (digest_id,),
        ).fetchone()
        if existing is None:
            raise HTTPException(status_code=404, detail="not found")
        if existing["state"] == "approved":
            raise HTTPException(status_code=409, detail="approved digests are read-only")

        assignments: list[str] = ["state = ?"]
        params: list[object] = ["needs_review" if existing["state"] == "drafted" else existing["state"]]
        if "narrative_md" in fields:
            assignments.append("narrative_md = ?")
            params.append(fields["narrative_md"])
        if "focus" in fields:
            assignments.append("focus = ?")
            params.append(json.dumps([item.model_dump() for item in payload.focus or []]))

        params.append(digest_id)
        db.execute(f"UPDATE digests SET {', '.join(assignments)} WHERE id = ?", tuple(params))
        db.commit()
        row = db.execute(
            "SELECT id, week_start, state, narrative_md, kpi_deltas, risks, nudges, focus, created_at "
            "FROM digests WHERE id = ?",
            (digest_id,),
        ).fetchone()
        return _digest_row_to_dict(row)
    finally:
        db.close()


@router.post("/api/digest/{digest_id}/approve", response_model=Digest)
async def approve_digest(digest_id: int):
    db = get_db()
    try:
        existing = db.execute(
            "SELECT id FROM digests WHERE id = ?",
            (digest_id,),
        ).fetchone()
        if existing is None:
            raise HTTPException(status_code=404, detail="not found")
        db.execute(
            "UPDATE digests SET state = ? WHERE id = ?",
            ("approved", digest_id),
        )
        db.commit()
        row = db.execute(
            "SELECT id, week_start, state, narrative_md, kpi_deltas, risks, nudges, focus, created_at "
            "FROM digests WHERE id = ?",
            (digest_id,),
        ).fetchone()
        return _digest_row_to_dict(row)
    finally:
        db.close()


@router.get("/api/tkt/projects")
async def list_tkt_projects_route(suggest_for_objective: int | None = Query(default=None)):
    from .connectors.tkt import list_tkt_projects

    projects = list_tkt_projects()

    suggested: str | None = None
    if suggest_for_objective is not None:
        db = get_db()
        try:
            objective = db.execute(
                "SELECT objectives.id, objectives.name, projects.name AS project_name "
                "FROM objectives JOIN projects ON projects.id = objectives.project_id "
                "WHERE objectives.id = ?",
                (suggest_for_objective,),
            ).fetchone()
            if objective is not None:
                # (1) Most common tkt project among this objective's linked items' tickets
                item_rows = db.execute(
                    "SELECT items.tkt_ticket_id FROM items WHERE items.objective_id = ? "
                    "AND items.tkt_ticket_id IS NOT NULL",
                    (suggest_for_objective,),
                ).fetchall()
                ticket_ids = [r["tkt_ticket_id"] for r in item_rows]
                if ticket_ids:
                    from .connectors.tkt import TKT_BACKLOG_DB_PATH
                    import sqlite3 as _sqlite3
                    if TKT_BACKLOG_DB_PATH.is_file():
                        backlog = _sqlite3.connect(
                            f"file:{TKT_BACKLOG_DB_PATH}?mode=ro", uri=True
                        )
                        backlog.row_factory = _sqlite3.Row
                        try:
                            placeholders = ",".join("?" for _ in ticket_ids)
                            tkt_rows = backlog.execute(
                                f"SELECT project_id FROM tasks WHERE id IN ({placeholders})",
                                tuple(ticket_ids),
                            ).fetchall()
                        finally:
                            backlog.close()
                        if tkt_rows:
                            from collections import Counter
                            counts = Counter(
                                str(r["project_id"]) for r in tkt_rows if r["project_id"] is not None
                            )
                            if counts:
                                suggested = counts.most_common(1)[0][0]

                # (2) Case-insensitive name match against tkt project id or name
                if suggested is None and objective is not None:
                    splanner_name = objective["project_name"].lower()
                    for p in projects:
                        if p["id"].lower() == splanner_name or p["name"].lower() == splanner_name:
                            suggested = p["id"]
                            break
        finally:
            db.close()

    return {"projects": projects, "suggested": suggested}


def _objective_full_dict(db, objective_id: int) -> dict:
    """Return the full objective dict (same shape as project-detail) including items and tkt_epic_id."""
    row = db.execute(
        "SELECT id, project_id, name, metric, target, current, unit, deadline, status, tkt_epic_id, created_at "
        "FROM objectives WHERE id = ?",
        (objective_id,),
    ).fetchone()
    if row is None:
        return {}
    obj = _objective_row_to_dict(row)
    item_rows = db.execute(
        "SELECT id, objective_id, name, status, eta, blockers, tkt_ticket_id, created_at "
        "FROM items WHERE objective_id = ? ORDER BY id DESC",
        (objective_id,),
    ).fetchall()
    obj["items"] = [_item_row_to_dict(r) for r in item_rows]
    return obj


def _build_item_desc(project_name: str, objective_name: str, item: sqlite3.Row) -> str:
    lines = [
        f"Project: {project_name}",
        f"Objective: {objective_name}",
        f"Item: {item['name']}",
    ]
    if item["eta"]:
        lines.append(f"ETA: {item['eta']}")
    if item["blockers"]:
        lines.append(f"Blockers: {item['blockers']}")
    return "\n".join(lines)


@router.post("/api/objectives/{objective_id}/create-epic")
async def create_epic_for_objective(objective_id: int, payload: CreateEpicPayload):
    from .connectors.tkt import (
        TktCreateError,
        adopt_ticket,
        create_epic,
        create_ticket_with_parent,
    )

    db = get_db()
    try:
        row = db.execute(
            "SELECT objectives.id, objectives.name, objectives.metric, objectives.target, "
            "objectives.deadline, objectives.tkt_epic_id, "
            "projects.context AS project_context, projects.name AS project_name "
            "FROM objectives JOIN projects ON projects.id = objectives.project_id "
            "WHERE objectives.id = ?",
            (objective_id,),
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="not found")
        if row["project_context"] != "work":
            raise HTTPException(status_code=400, detail="tkt linking is work-context only")
        if row["tkt_epic_id"] is not None:
            raise HTTPException(status_code=409, detail="objective already has an epic")

        # Build epic description
        desc_lines = [
            f"Project: {row['project_name']}",
            f"Objective: {row['name']}",
        ]
        if row["metric"]:
            desc_lines.append(f"Metric: {row['metric']}")
        if row["target"]:
            desc_lines.append(f"Target: {row['target']}")
        if row["deadline"]:
            desc_lines.append(f"Deadline: {row['deadline']}")

        try:
            epic_id = create_epic(row["name"], "\n".join(desc_lines), payload.tkt_project)
        except TktCreateError as exc:
            raise HTTPException(status_code=502, detail=f"tkt epic create failed: {exc}") from exc

        # Persist epic id immediately — honest partial state from here on
        db.execute(
            "UPDATE objectives SET tkt_epic_id = ? WHERE id = ?",
            (epic_id, objective_id),
        )
        db.commit()

        # Resolve which items to create as children and which to adopt
        all_items = db.execute(
            "SELECT id, name, status, eta, blockers, tkt_ticket_id "
            "FROM items WHERE objective_id = ? ORDER BY id",
            (objective_id,),
        ).fetchall()

        unlinked = [i for i in all_items if i["tkt_ticket_id"] is None]
        linked = [i for i in all_items if i["tkt_ticket_id"] is not None]

        item_ids_to_create = (
            payload.item_ids
            if payload.item_ids is not None
            else [i["id"] for i in unlinked]
        )
        adopt_item_ids = (
            payload.adopt_item_ids
            if payload.adopt_item_ids is not None
            else [i["id"] for i in linked]
        )

        items_by_id = {i["id"]: i for i in all_items}

        errors: list[str] = []

        # Create child tickets for unlinked items
        for iid in item_ids_to_create:
            item = items_by_id.get(iid)
            if item is None:
                errors.append(f"item {iid}: not found")
                continue
            if item["tkt_ticket_id"] is not None:
                # Already linked — skip silently
                continue
            desc = _build_item_desc(row["project_name"], row["name"], item)
            try:
                ticket_id = create_ticket_with_parent(
                    item["name"], desc, payload.tkt_project, epic_id
                )
                db.execute("UPDATE items SET tkt_ticket_id = ? WHERE id = ?", (ticket_id, iid))
            except TktCreateError as exc:
                errors.append(f"item {iid} create: {exc}")

        # Adopt existing linked tickets into the epic
        for iid in adopt_item_ids:
            item = items_by_id.get(iid)
            if item is None:
                errors.append(f"adopt item {iid}: not found")
                continue
            if item["tkt_ticket_id"] is None:
                errors.append(f"adopt item {iid}: no ticket id")
                continue
            try:
                adopt_ticket(item["tkt_ticket_id"], epic_id)
            except TktCreateError as exc:
                errors.append(f"adopt item {iid} (ticket #{item['tkt_ticket_id']}): {exc}")

        db.commit()
        obj = _objective_full_dict(db, objective_id)

        if errors:
            raise HTTPException(
                status_code=502,
                detail={
                    "message": "epic created but some child operations failed",
                    "epic_id": epic_id,
                    "errors": errors,
                    "objective": obj,
                },
            )

        return obj
    finally:
        db.close()


from typing import Annotated

from .discussion import ApplyOpsError, apply_ops as apply_discussion_ops
from .discussion import build_proposal as build_discussion_proposal
from .discussion import chat_turn as run_discussion_chat_turn
from .discussion import list_messages as list_discussion_messages


class DiscussionMessageCreate(BaseModel):
    text: str


class DiscussionObjectiveOp(BaseModel):
    type: Literal["objective"]
    name: str = Field(min_length=1)
    metric: str | None = None
    target: str | None = None
    unit: str | None = None
    make_epic: bool = False


class DiscussionItemOp(BaseModel):
    type: Literal["item"]
    objective_id: int | None = None
    new_objective_name: str | None = None
    name: str = Field(min_length=1)
    make_ticket: bool = False


class DiscussionCheckinOp(BaseModel):
    type: Literal["checkin"]
    level: Literal["project", "objective", "item"]
    target_id: int | None = None
    kind: CheckinKind
    body: str = Field(min_length=1)


DiscussionOp = Annotated[
    DiscussionObjectiveOp | DiscussionItemOp | DiscussionCheckinOp,
    Field(discriminator="type"),
]


class DiscussionApplyPayload(BaseModel):
    ops: list[DiscussionOp]


def _require_project_exists(project_id: int) -> None:
    db = get_db()
    try:
        project = db.execute("SELECT id FROM projects WHERE id = ?", (project_id,)).fetchone()
        if project is None:
            raise HTTPException(status_code=404, detail="not found")
    finally:
        db.close()


@router.get("/api/projects/{project_id}/discussion")
async def get_discussion(project_id: int):
    _require_project_exists(project_id)
    db = get_db()
    try:
        return {"messages": list_discussion_messages(db, project_id)}
    finally:
        db.close()


@router.post("/api/projects/{project_id}/discussion/messages")
async def create_discussion_message(project_id: int, payload: DiscussionMessageCreate):
    _require_project_exists(project_id)
    text = payload.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="text must not be empty")

    db = get_db()
    try:
        try:
            return await run_discussion_chat_turn(db, project_id, text)
        except RuntimeError as exc:
            raise HTTPException(status_code=502, detail="claude discussion failed") from exc
    finally:
        db.close()


@router.post("/api/projects/{project_id}/discussion/convert")
async def convert_discussion(project_id: int):
    _require_project_exists(project_id)
    db = get_db()
    try:
        try:
            return await build_discussion_proposal(db, project_id)
        except RuntimeError as exc:
            raise HTTPException(status_code=502, detail="claude proposal failed") from exc
    finally:
        db.close()


@router.post("/api/projects/{project_id}/discussion/apply")
async def apply_discussion(project_id: int, payload: DiscussionApplyPayload):
    _require_project_exists(project_id)
    db = get_db()
    try:
        try:
            ops = [op.model_dump() for op in payload.ops]
            return await apply_discussion_ops(db, ops, project_id)
        except ApplyOpsError as exc:
            raise HTTPException(
                status_code=400,
                detail={"failed_op": exc.failed_op, "reason": exc.reason},
            ) from exc
    finally:
        db.close()
