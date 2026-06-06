"""SPlanner API routes."""
import sqlite3
from typing import Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from .db import get_db

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
    kind: CheckinKind
    project_id: int | None = None
    objective_id: int | None = None
    item_id: int | None = None


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
        "created_at": row["created_at"],
    }


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
        sql = (
            "SELECT id, context, name, priority, status, archived, created_at "
            "FROM projects WHERE (? IS NULL OR context = ?)"
        )
        params: list[object] = [context, context]
        if not include_archived:
            sql += " AND archived = 0"
        sql += " ORDER BY priority DESC, id DESC"
        rows = db.execute(sql, tuple(params)).fetchall()
        return [_project_row_to_dict(row) for row in rows]
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
            "SELECT id, project_id, name, metric, target, current, unit, deadline, status, created_at "
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
            "SELECT id, project_id, objective_id, item_id, body, kind, source, source_ref, ai_classified, created_at "
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
            "SELECT id, project_id, name, metric, target, current, unit, deadline, status, created_at "
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
            "SELECT id, project_id, name, metric, target, current, unit, deadline, status, created_at "
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
            "SELECT id, project_id, objective_id, item_id, body, kind, source, source_ref, ai_classified, created_at "
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
async def create_checkin(payload: CheckinCreate):
    db = get_db()
    try:
        resolved_project_id, resolved_objective_id, resolved_item_id = _resolve_checkin_links(
            db,
            project_id=payload.project_id,
            objective_id=payload.objective_id,
            item_id=payload.item_id,
        )
        cursor = db.execute(
            "INSERT INTO checkins (project_id, objective_id, item_id, body, kind, source, ai_classified) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                resolved_project_id,
                resolved_objective_id,
                resolved_item_id,
                payload.body.strip(),
                payload.kind,
                "manual",
                0,
            ),
        )
        db.commit()
        row = db.execute(
            "SELECT id, project_id, objective_id, item_id, body, kind, source, source_ref, ai_classified, created_at "
            "FROM checkins WHERE id = ?",
            (cursor.lastrowid,),
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
