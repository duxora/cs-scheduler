"""Contract tests for SPlanner weekly digest helpers."""
import json
import subprocess

import pytest


@pytest.fixture
def splanner_db(tmp_path, monkeypatch):
    from server import config as server_config

    monkeypatch.setattr(server_config, "DATA_DIR", tmp_path)

    import apps.splanner.db as splanner_db_module

    monkeypatch.setattr(splanner_db_module, "DATA_DIR", tmp_path)
    db = splanner_db_module.get_db()
    try:
        yield db
    finally:
        db.close()


def _seed_objective(db, *, current: str = "12") -> tuple[int, int]:
    project_id = db.execute(
        "INSERT INTO projects (context, name, priority) VALUES (?, ?, ?)",
        ("work", "Ops", 5),
    ).lastrowid
    objective_id = db.execute(
        "INSERT INTO objectives (project_id, name, metric, target, current, unit) VALUES (?, ?, ?, ?, ?, ?)",
        (project_id, "Reduce incidents", "incidents", "10", current, "count"),
    ).lastrowid
    db.commit()
    return project_id, objective_id


def test_draft_digest_returns_validated_payload(monkeypatch, splanner_db):
    from apps.splanner.digest import draft_digest

    project_id, objective_id = _seed_objective(splanner_db)
    splanner_db.execute(
        "INSERT INTO checkins (project_id, objective_id, body, kind, source, ai_classified) VALUES (?, ?, ?, ?, ?, ?)",
        (project_id, objective_id, "Blocked on deploy", "blocked", "manual", 0),
    )
    splanner_db.commit()

    def fake_run(*args, **kwargs):
        return subprocess.CompletedProcess(
            args=args[0],
            returncode=0,
            stdout=(
                '{"narrative_md":"Week summary","risks":[{"title":"Deploy risk","severity":"high","evidence_count":2}],'
                '"nudges":[{"type":"pace","message":"Keep momentum","project_id":1}],"focus":[{"text":"Ship fixes"}]}'
            ),
            stderr="",
        )

    monkeypatch.setattr("apps.splanner.digest.subprocess.run", fake_run)

    digest = draft_digest("2026-06-01")

    assert digest == {
        "narrative_md": "Week summary",
        "risks": [{"title": "Deploy risk", "severity": "high", "evidence_count": 2}],
        "nudges": [{"type": "pace", "message": "Keep momentum", "project_id": 1}],
        "focus": [{"text": "Ship fixes", "accepted": False}],
    }


@pytest.mark.parametrize(
    "run_side_effect",
    [
        lambda: subprocess.CompletedProcess(args=["claude"], returncode=1, stdout="", stderr="failed"),
        lambda: subprocess.CompletedProcess(args=["claude"], returncode=0, stdout="not json", stderr=""),
        lambda: subprocess.TimeoutExpired(cmd=["claude"], timeout=120),
    ],
)
def test_draft_digest_failures_return_none(monkeypatch, splanner_db, run_side_effect):
    from apps.splanner.digest import draft_digest

    _seed_objective(splanner_db)

    def fake_run(*args, **kwargs):
        outcome = run_side_effect()
        if isinstance(outcome, Exception):
            raise outcome
        return outcome

    monkeypatch.setattr("apps.splanner.digest.subprocess.run", fake_run)

    assert draft_digest("2026-06-01") is None


def test_draft_digest_drops_invalid_risk_and_nudge_entries(monkeypatch, splanner_db):
    from apps.splanner.digest import draft_digest

    _seed_objective(splanner_db)

    def fake_run(*args, **kwargs):
        return subprocess.CompletedProcess(
            args=args[0],
            returncode=0,
            stdout=(
                '{"narrative_md":"Week summary","risks":[{"title":"Keep","severity":"medium","evidence_count":1},'
                '{"title":"Drop","severity":"urgent","evidence_count":3}],"nudges":['
                '{"type":"missing_win","message":"Log a win","project_id":null},'
                '{"type":"bad_type","message":"Ignore me","project_id":1}],"focus":[{"text":"Ship fixes"}]}'
            ),
            stderr="",
        )

    monkeypatch.setattr("apps.splanner.digest.subprocess.run", fake_run)

    digest = draft_digest("2026-06-01")

    assert digest is not None
    assert digest["risks"] == [{"title": "Keep", "severity": "medium", "evidence_count": 1}]
    assert digest["nudges"] == [{"type": "missing_win", "message": "Log a win", "project_id": None}]


def test_compute_kpi_deltas_uses_prior_digest_snapshot(splanner_db):
    from apps.splanner.digest import compute_kpi_deltas

    project_id, objective_id = _seed_objective(splanner_db, current="12")

    first_week = compute_kpi_deltas(splanner_db, "2026-06-02")
    assert first_week == [
        {
            "objective_id": objective_id,
            "project_id": project_id,
            "objective_name": "Reduce incidents",
            "project_name": "Ops",
            "metric": "incidents",
            "unit": "count",
            "target": "10",
            "current": "12",
            "prev_current": None,
        }
    ]

    splanner_db.execute(
        "INSERT INTO digests (week_start, state, narrative_md, kpi_deltas, risks, nudges, focus) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (
            "2026-06-02",
            "approved",
            "done",
            json.dumps(first_week),
            "[]",
            "[]",
            "[]",
        ),
    )
    splanner_db.execute(
        "UPDATE objectives SET current = ? WHERE id = ?",
        ("9", objective_id),
    )
    splanner_db.commit()

    second_week = compute_kpi_deltas(splanner_db, "2026-06-09")
    assert second_week[0]["current"] == "9"
    assert second_week[0]["prev_current"] == "12"
