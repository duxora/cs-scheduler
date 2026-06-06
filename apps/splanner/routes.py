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
