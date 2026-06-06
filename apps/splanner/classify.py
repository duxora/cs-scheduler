"""Async check-in classifier for SPlanner."""
import json
import logging
from pathlib import Path
import re
import shutil
import subprocess

from .db import get_db

logger = logging.getLogger(__name__)

VALID_KINDS = {"win", "risk", "decision", "blocked", "note"}
VALID_LEVELS = {"project", "objective", "item"}
VALID_CONFIDENCE = {"high", "medium", "low"}
CLAUDE_BIN = shutil.which("claude") or str(Path.home() / ".local/bin/claude")


def _render_tree(db) -> tuple[str, dict[str, set[int]]]:
    rows = db.execute(
        """
        SELECT
            projects.id AS project_id,
            projects.name AS project_name,
            objectives.id AS objective_id,
            objectives.name AS objective_name,
            items.id AS item_id,
            items.name AS item_name
        FROM projects
        LEFT JOIN objectives ON objectives.project_id = projects.id
        LEFT JOIN items ON items.objective_id = objectives.id
        WHERE projects.archived = 0
        ORDER BY projects.id, objectives.id, items.id
        """
    ).fetchall()

    valid_ids: dict[str, set[int]] = {
        "project": set(),
        "objective": set(),
        "item": set(),
    }
    lines: list[str] = []
    current_project_id: int | None = None
    current_objective_id: int | None = None

    for row in rows:
        project_id = row["project_id"]
        objective_id = row["objective_id"]
        item_id = row["item_id"]
        valid_ids["project"].add(project_id)

        if project_id != current_project_id:
            lines.append(f"project {project_id}: {row['project_name']}")
            current_project_id = project_id
            current_objective_id = None

        if objective_id is not None:
            valid_ids["objective"].add(objective_id)
            if objective_id != current_objective_id:
                lines.append(f"  objective {objective_id}: {row['objective_name']}")
                current_objective_id = objective_id

        if item_id is not None:
            valid_ids["item"].add(item_id)
            lines.append(f"    item {item_id}: {row['item_name']}")

    return "\n".join(lines), valid_ids


def _extract_json_object(raw: str) -> dict | None:
    match = re.search(r"\{.*\}", raw, re.DOTALL)
    if match is None:
        return None
    try:
        parsed = json.loads(match.group(0))
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


def classify_checkin(checkin_id: int) -> None:
    db = get_db()
    try:
        checkin = db.execute(
            "SELECT id, body FROM checkins WHERE id = ?",
            (checkin_id,),
        ).fetchone()
        if checkin is None:
            return

        tree_text, valid_ids = _render_tree(db)
        prompt = (
            "Classify this SPlanner check-in. Return STRICT JSON only with this shape: "
            '{"kind":"win|risk|decision|blocked|note","suggested_link":{"level":"project|objective|item","id":123}|null,'
            '"confidence":"high|medium|low"}.\n'
            "If confidence is low, use kind note and suggested_link null.\n"
            f"Check-in body:\n{checkin['body']}\n\n"
            "Available non-archived tree:\n"
            f"{tree_text or '(empty)'}"
        )

        result = subprocess.run(
            [CLAUDE_BIN, "-p", prompt, "--output-format", "text"],
            capture_output=True,
            text=True,
            timeout=60,
        )
        if result.returncode != 0:
            logger.warning("checkin classification failed for %s: rc=%s", checkin_id, result.returncode)
            return

        payload = _extract_json_object(result.stdout)
        if payload is None:
            logger.warning("checkin classification returned malformed JSON for %s", checkin_id)
            return

        kind = payload.get("kind")
        confidence = payload.get("confidence")
        if kind not in VALID_KINDS or confidence not in VALID_CONFIDENCE:
            logger.warning("checkin classification returned invalid enum for %s", checkin_id)
            return

        suggested_level: str | None = None
        suggested_id: int | None = None
        suggested_link = payload.get("suggested_link")
        if suggested_link is not None:
            if not isinstance(suggested_link, dict):
                logger.warning("checkin classification returned invalid suggestion payload for %s", checkin_id)
                return
            level = suggested_link.get("level")
            link_id = suggested_link.get("id")
            if level not in VALID_LEVELS or not isinstance(link_id, int):
                logger.warning("checkin classification returned invalid suggestion target for %s", checkin_id)
                return
            if link_id in valid_ids[level]:
                suggested_level = level
                suggested_id = link_id

        if confidence == "low":
            kind = "note"
            suggested_level = None
            suggested_id = None
        elif suggested_level is None:
            suggested_id = None

        db.execute(
            "UPDATE checkins SET kind = ?, ai_classified = 1, suggested_level = ?, suggested_id = ? "
            "WHERE id = ?",
            (kind, suggested_level, suggested_id, checkin_id),
        )
        db.commit()
    except (FileNotFoundError, OSError, subprocess.TimeoutExpired) as exc:
        logger.warning("checkin classification failed for %s: %s", checkin_id, exc)
    finally:
        db.close()
