"""Weekly digest helpers for SPlanner."""
from datetime import date, timedelta
import json
import logging
import subprocess

from .classify import CLAUDE_BIN, _extract_json_object
from .db import get_db

logger = logging.getLogger(__name__)

VALID_RISK_SEVERITIES = {"high", "medium", "low"}
VALID_NUDGE_TYPES = {"stale_objective", "pace", "missing_win"}


def compute_kpi_deltas(db, week_start: str) -> list[dict]:
    prior_row = db.execute(
        "SELECT kpi_deltas FROM digests WHERE week_start < ? ORDER BY week_start DESC LIMIT 1",
        (week_start,),
    ).fetchone()
    prior_by_objective_id: dict[int, object] = {}
    if prior_row is not None:
        try:
            prior_kpi_deltas = json.loads(prior_row["kpi_deltas"])
        except json.JSONDecodeError:
            prior_kpi_deltas = []
        if isinstance(prior_kpi_deltas, list):
            for entry in prior_kpi_deltas:
                if (
                    isinstance(entry, dict)
                    and isinstance(entry.get("objective_id"), int)
                    and "current" in entry
                ):
                    prior_by_objective_id[entry["objective_id"]] = entry.get("current")

    rows = db.execute(
        """
        SELECT
            objectives.id AS objective_id,
            objectives.project_id AS project_id,
            objectives.name AS objective_name,
            projects.name AS project_name,
            objectives.metric AS metric,
            objectives.unit AS unit,
            objectives.target AS target,
            objectives.current AS current
        FROM objectives
        JOIN projects ON projects.id = objectives.project_id
        WHERE projects.archived = 0 AND objectives.current IS NOT NULL
        ORDER BY projects.priority DESC, projects.id DESC, objectives.id DESC
        """
    ).fetchall()

    return [
        {
            "objective_id": row["objective_id"],
            "project_id": row["project_id"],
            "objective_name": row["objective_name"],
            "project_name": row["project_name"],
            "metric": row["metric"],
            "unit": row["unit"],
            "target": row["target"],
            "current": row["current"],
            "prev_current": prior_by_objective_id.get(row["objective_id"]),
        }
        for row in rows
    ]


def _validate_risks(value: object) -> list[dict] | None:
    if not isinstance(value, list):
        return None

    risks: list[dict] = []
    for entry in value:
        if not isinstance(entry, dict):
            continue
        title = entry.get("title")
        severity = entry.get("severity")
        evidence_count = entry.get("evidence_count")
        if (
            isinstance(title, str)
            and severity in VALID_RISK_SEVERITIES
            and isinstance(evidence_count, int)
        ):
            risks.append(
                {
                    "title": title,
                    "severity": severity,
                    "evidence_count": evidence_count,
                }
            )
    return risks


def _validate_nudges(value: object) -> list[dict] | None:
    if not isinstance(value, list):
        return None

    nudges: list[dict] = []
    for entry in value:
        if not isinstance(entry, dict):
            continue
        nudge_type = entry.get("type")
        message = entry.get("message")
        project_id = entry.get("project_id")
        if (
            nudge_type in VALID_NUDGE_TYPES
            and isinstance(message, str)
            and (project_id is None or isinstance(project_id, int))
        ):
            nudges.append(
                {
                    "type": nudge_type,
                    "message": message,
                    "project_id": project_id,
                }
            )
    return nudges


def _validate_focus(value: object) -> list[dict] | None:
    if not isinstance(value, list):
        return None

    focus: list[dict] = []
    for entry in value:
        if isinstance(entry, dict) and isinstance(entry.get("text"), str):
            focus.append({"text": entry["text"], "accepted": False})
    return focus


def draft_digest(week_start: str) -> dict | None:
    db = get_db()
    try:
        week_start_date = date.fromisoformat(week_start)
        week_end = (week_start_date + timedelta(days=7)).isoformat()
        kpi_deltas = compute_kpi_deltas(db, week_start)
        checkins = db.execute(
            """
            SELECT
                checkins.body AS body,
                checkins.kind AS kind,
                projects.name AS project_name,
                objectives.name AS objective_name,
                items.name AS item_name
            FROM checkins
            LEFT JOIN projects ON projects.id = checkins.project_id
            LEFT JOIN objectives ON objectives.id = checkins.objective_id
            LEFT JOIN items ON items.id = checkins.item_id
            WHERE checkins.created_at >= ? AND checkins.created_at < ?
            ORDER BY checkins.created_at DESC, checkins.id DESC
            """,
            (f"{week_start}T00:00:00.000Z", f"{week_end}T00:00:00.000Z"),
        ).fetchall()

        checkin_lines = [
            json.dumps(
                {
                    "kind": row["kind"],
                    "body": row["body"],
                    "project_name": row["project_name"],
                    "objective_name": row["objective_name"],
                    "item_name": row["item_name"],
                },
                ensure_ascii=True,
            )
            for row in checkins
        ]
        prompt = (
            "Draft the weekly SPlanner digest. Return STRICT JSON only with this shape: "
            '{"narrative_md":"...","risks":[{"title":"...","severity":"high|medium|low","evidence_count":1}],'
            '"nudges":[{"type":"stale_objective|pace|missing_win","message":"...","project_id":1|null}],'
            '"focus":[{"text":"..."}]}.\n'
            "Do not echo raw KPI numbers in the output; use them only as input context.\n"
            f"week_start: {week_start}\n"
            f"kpi_deltas:\n{json.dumps(kpi_deltas, ensure_ascii=True)}\n"
            f"checkins:\n{chr(10).join(checkin_lines) or '(none)'}"
        )

        result = subprocess.run(
            [CLAUDE_BIN, "-p", prompt, "--output-format", "text"],
            capture_output=True,
            text=True,
            timeout=120,
        )
        if result.returncode != 0:
            logger.warning("digest draft failed for %s: rc=%s", week_start, result.returncode)
            return None

        payload = _extract_json_object(result.stdout)
        if payload is None:
            logger.warning("digest draft returned malformed JSON for %s", week_start)
            return None

        narrative_md = payload.get("narrative_md")
        risks = _validate_risks(payload.get("risks"))
        nudges = _validate_nudges(payload.get("nudges"))
        focus = _validate_focus(payload.get("focus"))
        if not isinstance(narrative_md, str) or risks is None or nudges is None or focus is None:
            logger.warning("digest draft returned invalid shape for %s", week_start)
            return None

        return {
            "narrative_md": narrative_md,
            "risks": risks,
            "nudges": nudges,
            "focus": focus,
        }
    except (FileNotFoundError, OSError, ValueError, subprocess.TimeoutExpired) as exc:
        logger.warning("digest draft failed for %s: %s", week_start, exc)
        return None
    finally:
        db.close()


def _digest_row_to_dict(row) -> dict:
    return {
        "id": row["id"],
        "week_start": row["week_start"],
        "state": row["state"],
        "narrative_md": row["narrative_md"],
        "kpi_deltas": json.loads(row["kpi_deltas"]),
        "risks": json.loads(row["risks"]),
        "nudges": json.loads(row["nudges"]),
        "focus": json.loads(row["focus"]),
        "created_at": row["created_at"],
    }


def draft_and_store(
    week_start: str,
    *,
    kpi_func=compute_kpi_deltas,
    draft_func=draft_digest,
) -> dict | None:
    db = get_db()
    try:
        kpi_deltas = kpi_func(db, week_start)
        draft = draft_func(week_start)
        if draft is None:
            return None

        payload = (
            week_start,
            "drafted",
            draft["narrative_md"],
            json.dumps(kpi_deltas),
            json.dumps(draft["risks"]),
            json.dumps(draft["nudges"]),
            json.dumps(draft["focus"]),
        )
        existing = db.execute(
            "SELECT id FROM digests WHERE week_start = ?",
            (week_start,),
        ).fetchone()
        if existing is None:
            cursor = db.execute(
                "INSERT INTO digests (week_start, state, narrative_md, kpi_deltas, risks, nudges, focus) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                payload,
            )
            digest_id = cursor.lastrowid
        else:
            digest_id = existing["id"]
            db.execute(
                "UPDATE digests SET state = ?, narrative_md = ?, kpi_deltas = ?, risks = ?, nudges = ?, focus = ? "
                "WHERE id = ?",
                (
                    "drafted",
                    draft["narrative_md"],
                    json.dumps(kpi_deltas),
                    json.dumps(draft["risks"]),
                    json.dumps(draft["nudges"]),
                    json.dumps(draft["focus"]),
                    digest_id,
                ),
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
