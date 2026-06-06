"""Contract tests for SPlanner async check-in classification."""
import sqlite3
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


def _seed_tree(db) -> tuple[int, int, int]:
    project_id = db.execute(
        "INSERT INTO projects (context, name, priority) VALUES (?, ?, ?)",
        ("work", "Ops", 0),
    ).lastrowid
    objective_id = db.execute(
        "INSERT INTO objectives (project_id, name) VALUES (?, ?)",
        (project_id, "Reduce incidents"),
    ).lastrowid
    item_id = db.execute(
        "INSERT INTO items (objective_id, name) VALUES (?, ?)",
        (objective_id, "Close flaky tests"),
    ).lastrowid
    db.commit()
    return project_id, objective_id, item_id


def _insert_checkin(db, body: str = "Need staffing") -> int:
    checkin_id = db.execute(
        "INSERT INTO checkins (body, kind, source, ai_classified) VALUES (?, ?, ?, ?)",
        (body, "note", "manual", 0),
    ).lastrowid
    db.commit()
    return checkin_id


def _fetch_checkin_row(db, checkin_id: int) -> sqlite3.Row:
    row = db.execute(
        "SELECT kind, ai_classified, suggested_level, suggested_id FROM checkins WHERE id = ?",
        (checkin_id,),
    ).fetchone()
    assert row is not None
    return row


def test_classify_updates_row_with_valid_json(monkeypatch, splanner_db):
    from apps.splanner.classify import classify_checkin

    _, _, item_id = _seed_tree(splanner_db)
    checkin_id = _insert_checkin(splanner_db)

    def fake_run(*args, **kwargs):
        return subprocess.CompletedProcess(
            args=args[0],
            returncode=0,
            stdout=(
                '{"kind":"risk","suggested_link":{"level":"item","id":'
                f"{item_id}"
                '},"confidence":"high"}'
            ),
            stderr="",
        )

    monkeypatch.setattr("apps.splanner.classify.subprocess.run", fake_run)

    classify_checkin(checkin_id)

    row = _fetch_checkin_row(splanner_db, checkin_id)
    assert row["kind"] == "risk"
    assert row["ai_classified"] == 1
    assert row["suggested_level"] == "item"
    assert row["suggested_id"] == item_id


def test_classify_parses_fenced_json(monkeypatch, splanner_db):
    from apps.splanner.classify import classify_checkin

    project_id, _, _ = _seed_tree(splanner_db)
    checkin_id = _insert_checkin(splanner_db)

    def fake_run(*args, **kwargs):
        return subprocess.CompletedProcess(
            args=args[0],
            returncode=0,
            stdout=(
                "```json\n"
                '{"kind":"win","suggested_link":{"level":"project","id":'
                f"{project_id}"
                '},"confidence":"medium"}\n'
                "```"
            ),
            stderr="",
        )

    monkeypatch.setattr("apps.splanner.classify.subprocess.run", fake_run)

    classify_checkin(checkin_id)

    row = _fetch_checkin_row(splanner_db, checkin_id)
    assert row["kind"] == "win"
    assert row["ai_classified"] == 1
    assert row["suggested_level"] == "project"
    assert row["suggested_id"] == project_id


@pytest.mark.parametrize(
    "run_side_effect",
    [
        lambda: subprocess.CompletedProcess(args=["claude"], returncode=1, stdout="", stderr="failed"),
        lambda: subprocess.CompletedProcess(args=["claude"], returncode=0, stdout="not json", stderr=""),
        lambda: subprocess.TimeoutExpired(cmd=["claude"], timeout=60),
    ],
)
def test_classify_failures_leave_row_untouched(monkeypatch, splanner_db, run_side_effect):
    from apps.splanner.classify import classify_checkin

    _seed_tree(splanner_db)
    checkin_id = _insert_checkin(splanner_db)

    def fake_run(*args, **kwargs):
        outcome = run_side_effect()
        if isinstance(outcome, Exception):
            raise outcome
        return outcome

    monkeypatch.setattr("apps.splanner.classify.subprocess.run", fake_run)

    classify_checkin(checkin_id)

    row = _fetch_checkin_row(splanner_db, checkin_id)
    assert row["kind"] == "note"
    assert row["ai_classified"] == 0
    assert row["suggested_level"] is None
    assert row["suggested_id"] is None


def test_classify_low_confidence_forces_note_without_suggestion(monkeypatch, splanner_db):
    from apps.splanner.classify import classify_checkin

    _, objective_id, _ = _seed_tree(splanner_db)
    checkin_id = _insert_checkin(splanner_db)

    def fake_run(*args, **kwargs):
        return subprocess.CompletedProcess(
            args=args[0],
            returncode=0,
            stdout=(
                '{"kind":"risk","suggested_link":{"level":"objective","id":'
                f"{objective_id}"
                '},"confidence":"low"}'
            ),
            stderr="",
        )

    monkeypatch.setattr("apps.splanner.classify.subprocess.run", fake_run)

    classify_checkin(checkin_id)

    row = _fetch_checkin_row(splanner_db, checkin_id)
    assert row["kind"] == "note"
    assert row["ai_classified"] == 1
    assert row["suggested_level"] is None
    assert row["suggested_id"] is None


def test_classify_drops_dangling_suggestion_but_keeps_kind(monkeypatch, splanner_db):
    from apps.splanner.classify import classify_checkin

    _seed_tree(splanner_db)
    checkin_id = _insert_checkin(splanner_db)

    def fake_run(*args, **kwargs):
        return subprocess.CompletedProcess(
            args=args[0],
            returncode=0,
            stdout='{"kind":"blocked","suggested_link":{"level":"item","id":99999},"confidence":"high"}',
            stderr="",
        )

    monkeypatch.setattr("apps.splanner.classify.subprocess.run", fake_run)

    classify_checkin(checkin_id)

    row = _fetch_checkin_row(splanner_db, checkin_id)
    assert row["kind"] == "blocked"
    assert row["ai_classified"] == 1
    assert row["suggested_level"] is None
    assert row["suggested_id"] is None
