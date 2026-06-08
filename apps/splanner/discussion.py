"""Async discussion helpers for SPlanner."""
import asyncio
import json
from pathlib import Path
import re
import shutil
import sqlite3

from fastapi import HTTPException

CLAUDE_BIN = shutil.which("claude") or str(Path.home() / ".local/bin/claude")
VALID_CHECKIN_KINDS = {"win", "risk", "decision", "blocked", "note"}
VALID_CHECKIN_LEVELS = {"project", "objective", "item"}


class ApplyOpsError(Exception):
    def __init__(self, failed_op: dict, reason: str):
        super().__init__(reason)
        self.failed_op = failed_op
        self.reason = reason


async def _ask_claude(prompt: str, timeout: int = 180) -> str | None:
    try:
        proc = await asyncio.create_subprocess_exec(
            CLAUDE_BIN,
            "-p",
            prompt,
            "--output-format",
            "text",
            "--tools",
            "",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    except (OSError, asyncio.TimeoutError):
        return None

    if proc.returncode != 0:
        return None
    return stdout.decode("utf-8", errors="replace").strip()


def _extract_json_object(raw: str) -> dict | None:
    match = re.search(r"\{.*\}", raw, re.DOTALL)
    if match is None:
        return None
    try:
        parsed = json.loads(match.group(0))
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


def list_messages(db, project_id: int) -> list[dict]:
    rows = db.execute(
        "SELECT id, role, content, created_at FROM discussion_messages "
        "WHERE project_id = ? ORDER BY created_at, id",
        (project_id,),
    ).fetchall()
    return [
        {
            "id": row["id"],
            "role": row["role"],
            "content": row["content"],
            "created_at": row["created_at"],
        }
        for row in rows
    ]


def build_grounding(db, project_id: int) -> str:
    project = db.execute(
        "SELECT id, context, name, priority, status FROM projects WHERE id = ?",
        (project_id,),
    ).fetchone()
    if project is None:
        return "(project not found)"

    lines = [
        f"Project #{project['id']}: {project['name']}",
        f"Context: {project['context']}",
        f"Priority: {project['priority']}",
        f"Status: {project['status']}",
        "Objectives:",
    ]

    objective_rows = db.execute(
        "SELECT id, name, metric, current, target, unit, status "
        "FROM objectives WHERE project_id = ? ORDER BY id",
        (project_id,),
    ).fetchall()
    if not objective_rows:
        lines.append("- (none)")
    for objective in objective_rows:
        metric_parts = [objective["metric"] or "metric n/a"]
        current = objective["current"] if objective["current"] is not None else "?"
        target = objective["target"] if objective["target"] is not None else "?"
        unit = objective["unit"] or ""
        metric_parts.append(f"{current}/{target}{unit}")
        lines.append(
            f"- objective {objective['id']}: {objective['name']} | "
            f"{' -> '.join(metric_parts)} | status={objective['status']}"
        )
        item_rows = db.execute(
            "SELECT id, name, status, eta, blockers FROM items WHERE objective_id = ? ORDER BY id",
            (objective["id"],),
        ).fetchall()
        if not item_rows:
            lines.append("  - items: (none)")
        for item in item_rows:
            extras: list[str] = [f"status={item['status']}"]
            if item["eta"]:
                extras.append(f"eta={item['eta']}")
            if item["blockers"]:
                extras.append(f"blockers={item['blockers']}")
            lines.append(f"  - item {item['id']}: {item['name']} | {' | '.join(extras)}")

    lines.append("Recent check-ins:")
    checkin_rows = db.execute(
        "SELECT kind, body FROM checkins WHERE project_id = ? ORDER BY created_at DESC, id DESC LIMIT 20",
        (project_id,),
    ).fetchall()
    if not checkin_rows:
        lines.append("- (none)")
    for checkin in checkin_rows:
        lines.append(f"- {checkin['kind']}: {checkin['body']}")

    digest = db.execute(
        "SELECT narrative_md FROM digests ORDER BY week_start DESC, id DESC LIMIT 1"
    ).fetchone()
    lines.append("Latest digest:")
    lines.append(digest["narrative_md"] if digest is not None and digest["narrative_md"] else "(none)")
    return "\n".join(lines)


def _render_history(messages: list[dict]) -> str:
    # Cap to last N turns when threads get long.
    return "\n".join(f"{message['role']}: {message['content']}" for message in messages) or "(empty)"


def _insert_message(db, project_id: int, role: str, content: str) -> dict:
    cursor = db.execute(
        "INSERT INTO discussion_messages (project_id, role, content) VALUES (?, ?, ?)",
        (project_id, role, content),
    )
    row = db.execute(
        "SELECT id, role, content, created_at FROM discussion_messages WHERE id = ?",
        (cursor.lastrowid,),
    ).fetchone()
    return {
        "id": row["id"],
        "role": row["role"],
        "content": row["content"],
        "created_at": row["created_at"],
    }


async def chat_turn(db, project_id: int, user_text: str) -> dict:
    user_message = _insert_message(db, project_id, "user", user_text.strip())
    db.commit()

    grounding = build_grounding(db, project_id)
    history = _render_history(list_messages(db, project_id))
    prompt = (
        "You are an SPlanner project discussion assistant. Give concise, actionable advice.\n\n"
        f"Grounding:\n{grounding}\n\n"
        f"Thread:\n{history}\n\n"
        f"Reply to the latest user message: {user_message['content']}"
    )

    response = await _ask_claude(prompt)
    if response is None:
        raise RuntimeError("claude discussion failed")

    assistant_message = _insert_message(db, project_id, "assistant", response)
    db.commit()
    return assistant_message


def _validate_objective_op(op: object) -> tuple[dict | None, str | None]:
    if not isinstance(op, dict):
        return None, "op must be an object"
    name = op.get("name")
    metric = op.get("metric")
    target = op.get("target")
    unit = op.get("unit")
    if not isinstance(name, str) or not name.strip():
        return None, "objective name is required"
    if metric is not None and not isinstance(metric, str):
        return None, "objective metric must be a string or null"
    if target is not None and not isinstance(target, str):
        return None, "objective target must be a string or null"
    if unit is not None and not isinstance(unit, str):
        return None, "objective unit must be a string or null"
    return {
        "type": "objective",
        "name": name.strip(),
        "metric": metric,
        "target": target,
        "unit": unit,
        "make_epic": False,
    }, None


def _validate_item_op(op: object) -> tuple[dict | None, str | None]:
    if not isinstance(op, dict):
        return None, "op must be an object"
    name = op.get("name")
    objective_id = op.get("objective_id")
    new_objective_name = op.get("new_objective_name")
    has_objective_id = isinstance(objective_id, int)
    has_new_name = isinstance(new_objective_name, str) and bool(new_objective_name.strip())
    if not isinstance(name, str) or not name.strip():
        return None, "item name is required"
    if has_objective_id == has_new_name:
        return None, "item must set exactly one of objective_id or new_objective_name"
    if objective_id is not None and not isinstance(objective_id, int):
        return None, "item objective_id must be an int or null"
    if new_objective_name is not None and not isinstance(new_objective_name, str):
        return None, "item new_objective_name must be a string or null"
    return {
        "type": "item",
        "objective_id": objective_id if has_objective_id else None,
        "new_objective_name": new_objective_name.strip() if has_new_name else None,
        "name": name.strip(),
        "make_ticket": False,
    }, None


def _validate_checkin_op(op: object) -> tuple[dict | None, str | None]:
    if not isinstance(op, dict):
        return None, "op must be an object"
    level = op.get("level")
    target_id = op.get("target_id")
    kind = op.get("kind")
    body = op.get("body")
    if level not in VALID_CHECKIN_LEVELS:
        return None, "invalid checkin level"
    if target_id is not None and not isinstance(target_id, int):
        return None, "checkin target_id must be an int or null"
    if kind not in VALID_CHECKIN_KINDS:
        return None, "invalid checkin kind"
    if not isinstance(body, str) or not body.strip():
        return None, "checkin body is required"
    return {
        "type": "checkin",
        "level": level,
        "target_id": target_id,
        "kind": kind,
        "body": body.strip(),
    }, None


def _validate_proposal_op(op: object) -> tuple[dict | None, str | None]:
    if not isinstance(op, dict):
        return None, "op must be an object"
    op_type = op.get("type")
    if op_type == "objective":
        return _validate_objective_op(op)
    if op_type == "item":
        return _validate_item_op(op)
    if op_type == "checkin":
        return _validate_checkin_op(op)
    return None, "invalid op type"


async def build_proposal(db, project_id: int) -> dict:
    grounding = build_grounding(db, project_id)
    history = _render_history(list_messages(db, project_id))
    prompt = (
        "Extract actionable SPlanner operations from this discussion. Return STRICT JSON only with this shape:\n"
        '{"ops":[{"type":"objective","name":"...","metric":"...","target":"...","unit":"..."},'
        '{"type":"item","objective_id":1,"new_objective_name":null,"name":"..."},'
        '{"type":"checkin","level":"project|objective|item","target_id":1,"kind":"win|risk|decision|blocked|note","body":"..."}]}\n'
        "For item ops, set exactly one of objective_id or new_objective_name.\n"
        "Do not include make_epic or make_ticket.\n\n"
        f"Grounding:\n{grounding}\n\n"
        f"Thread:\n{history}"
    )
    raw = await _ask_claude(prompt)
    if raw is None:
        raise RuntimeError("claude proposal failed")

    payload = _extract_json_object(raw)
    if payload is None:
        return {"ops": [], "dropped": [{"raw": raw, "reason": "malformed JSON"}]}

    raw_ops = payload.get("ops")
    if not isinstance(raw_ops, list):
        return {"ops": [], "dropped": [{"raw": payload, "reason": "ops must be a list"}]}

    ops: list[dict] = []
    dropped: list[dict] = []
    for raw_op in raw_ops:
        op, reason = _validate_proposal_op(raw_op)
        if op is None:
            dropped.append({"raw": raw_op, "reason": reason})
            continue
        ops.append(op)
    return {"ops": ops, "dropped": dropped}


def _validate_apply_objective(op: dict) -> None:
    if not isinstance(op.get("name"), str) or not op["name"].strip():
        raise ApplyOpsError(op, "objective name is required")
    for field in ("metric", "target", "unit"):
        value = op.get(field)
        if value is not None and not isinstance(value, str):
            raise ApplyOpsError(op, f"objective {field} must be a string or null")


def _resolve_item_objective_id(
    db,
    project_id: int,
    op: dict,
    created_objective_ids: dict[str, int],
) -> int:
    objective_id = op.get("objective_id")
    new_objective_name = op.get("new_objective_name")
    has_objective_id = isinstance(objective_id, int)
    has_new_name = isinstance(new_objective_name, str) and bool(new_objective_name.strip())
    if has_objective_id == has_new_name:
        raise ApplyOpsError(op, "item must set exactly one of objective_id or new_objective_name")
    if not isinstance(op.get("name"), str) or not op["name"].strip():
        raise ApplyOpsError(op, "item name is required")
    if not isinstance(op.get("make_ticket"), bool):
        raise ApplyOpsError(op, "item make_ticket must be a bool")
    if has_objective_id:
        row = db.execute(
            "SELECT objectives.id FROM objectives "
            "JOIN projects ON projects.id = objectives.project_id "
            "WHERE objectives.id = ? AND projects.id = ?",
            (objective_id, project_id),
        ).fetchone()
        if row is None:
            raise ApplyOpsError(op, "objective_id does not exist in this project")
        return objective_id
    resolved_id = created_objective_ids.get(new_objective_name.strip())
    if resolved_id is None:
        raise ApplyOpsError(op, "new_objective_name did not match an earlier objective op")
    return resolved_id


def _resolve_checkin_target(db, project_id: int, op: dict) -> tuple[int | None, int | None, int | None]:
    if op.get("level") not in VALID_CHECKIN_LEVELS:
        raise ApplyOpsError(op, "invalid checkin level")
    if op.get("kind") not in VALID_CHECKIN_KINDS:
        raise ApplyOpsError(op, "invalid checkin kind")
    if not isinstance(op.get("body"), str) or not op["body"].strip():
        raise ApplyOpsError(op, "checkin body is required")
    target_id = op.get("target_id")
    if not isinstance(target_id, int):
        raise ApplyOpsError(op, "checkin target_id must be an int")

    if op["level"] == "project":
        row = db.execute(
            "SELECT id FROM projects WHERE id = ? AND id = ?",
            (target_id, project_id),
        ).fetchone()
        if row is None:
            raise ApplyOpsError(op, "project checkin target was not found")
        return target_id, None, None
    if op["level"] == "objective":
        row = db.execute(
            "SELECT id FROM objectives WHERE id = ? AND project_id = ?",
            (target_id, project_id),
        ).fetchone()
        if row is None:
            raise ApplyOpsError(op, "objective checkin target was not found")
        return project_id, target_id, None
    row = db.execute(
        "SELECT items.id AS item_id, objectives.id AS objective_id "
        "FROM items JOIN objectives ON objectives.id = items.objective_id "
        "WHERE items.id = ? AND objectives.project_id = ?",
        (target_id, project_id),
    ).fetchone()
    if row is None:
        raise ApplyOpsError(op, "item checkin target was not found")
    return project_id, row["objective_id"], row["item_id"]


def _insert_system_summary(db, project_id: int, created: dict[str, list[int]]) -> None:
    objective_count = len(created["objectives"])
    item_count = len(created["items"])
    checkin_count = len(created["checkins"])
    objective_label = "objective" if objective_count == 1 else "objectives"
    item_label = "item" if item_count == 1 else "items"
    checkin_label = "check-in" if checkin_count == 1 else "check-ins"
    _insert_message(
        db,
        project_id,
        "system",
        f"Applied: {objective_count} {objective_label}, {item_count} {item_label}, {checkin_count} {checkin_label}",
    )


async def apply_ops(db, ops: list[dict], project_id: int) -> dict:
    project = db.execute("SELECT id, context, name FROM projects WHERE id = ?", (project_id,)).fetchone()
    if project is None:
        raise ApplyOpsError({}, "project not found")

    created = {"objectives": [], "items": [], "checkins": []}
    objective_name_to_id: dict[str, int] = {}
    objective_epic_flags: list[tuple[int, bool]] = []
    item_ticket_flags: list[tuple[int, bool]] = []

    try:
        db.execute("BEGIN")
        for op in ops:
            if not isinstance(op, dict):
                raise ApplyOpsError({"raw": op}, "op must be an object")
            op_type = op.get("type")
            if op_type == "objective":
                _validate_apply_objective(op)
                make_epic = op.get("make_epic", False)
                if not isinstance(make_epic, bool):
                    raise ApplyOpsError(op, "objective make_epic must be a bool")
                cursor = db.execute(
                    "INSERT INTO objectives (project_id, name, metric, target, unit) VALUES (?, ?, ?, ?, ?)",
                    (
                        project_id,
                        op["name"].strip(),
                        op.get("metric"),
                        op.get("target"),
                        op.get("unit"),
                    ),
                )
                objective_id = cursor.lastrowid
                objective_name_to_id[op["name"].strip()] = objective_id
                created["objectives"].append(objective_id)
                objective_epic_flags.append((objective_id, make_epic))
                continue
            if op_type == "item":
                objective_id = _resolve_item_objective_id(db, project_id, op, objective_name_to_id)
                cursor = db.execute(
                    "INSERT INTO items (objective_id, name, eta, tkt_ticket_id) VALUES (?, ?, ?, ?)",
                    (objective_id, op["name"].strip(), None, None),
                )
                item_id = cursor.lastrowid
                created["items"].append(item_id)
                item_ticket_flags.append((item_id, op["make_ticket"]))
                continue
            if op_type == "checkin":
                resolved_project_id, resolved_objective_id, resolved_item_id = _resolve_checkin_target(
                    db, project_id, op
                )
                cursor = db.execute(
                    "INSERT INTO checkins (project_id, objective_id, item_id, body, kind, source, ai_classified, "
                    "suggested_level, suggested_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (
                        resolved_project_id,
                        resolved_objective_id,
                        resolved_item_id,
                        op["body"].strip(),
                        op["kind"],
                        "manual",
                        0,
                        None,
                        None,
                    ),
                )
                created["checkins"].append(cursor.lastrowid)
                continue
            raise ApplyOpsError(op, "invalid op type")
        db.commit()
    except ApplyOpsError:
        db.conn.rollback()
        raise
    except Exception:
        db.conn.rollback()
        raise

    _insert_system_summary(db, project_id, created)
    db.commit()

    tkt_errors: list[dict] = []
    if project["context"] == "work":
        from . import routes as splanner_routes

        for objective_id, make_epic in objective_epic_flags:
            if not make_epic:
                continue
            try:
                await splanner_routes.create_epic_for_objective(
                    objective_id,
                    splanner_routes.CreateEpicPayload(tkt_project=project["name"]),
                )
            except HTTPException as exc:
                tkt_errors.append({"type": "objective", "id": objective_id, "detail": exc.detail})

        for item_id, make_ticket in item_ticket_flags:
            if not make_ticket:
                continue
            try:
                await splanner_routes.create_ticket_for_item(
                    item_id,
                    splanner_routes.CreateTicketPayload(tkt_project=project["name"]),
                )
            except HTTPException as exc:
                tkt_errors.append({"type": "item", "id": item_id, "detail": exc.detail})

    return {"created": created, "tkt_errors": tkt_errors}
