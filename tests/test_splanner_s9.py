"""Tests for SPlanner S9 shared capture and life-graph adapter."""
from datetime import datetime
import sqlite3

from fastapi.testclient import TestClient
import pytest


@pytest.fixture
def client(tmp_path, monkeypatch):
    from server import config as server_config

    monkeypatch.setattr(server_config, "DATA_DIR", tmp_path)

    import apps.splanner.db as splanner_db

    monkeypatch.setattr(splanner_db, "DATA_DIR", tmp_path)

    from server.main import app

    return TestClient(app)


def datetime_from(value: str):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def create_life_graph_db(path, rows: list[tuple[int, str, str, str, str, str | None]]) -> None:
    with sqlite3.connect(path) as conn:
        conn.execute(
            "CREATE TABLE entities (id INTEGER PRIMARY KEY, entity_type TEXT NOT NULL, topic TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL, invalid_at TEXT)"
        )
        conn.executemany(
            "INSERT INTO entities (id, entity_type, topic, content, created_at, invalid_at) VALUES (?, ?, ?, ?, ?, ?)",
            rows,
        )
        conn.commit()


def seed_project(client: TestClient) -> tuple[int, int, int]:
    project = client.post("/splanner/api/projects", json={"context": "work", "name": "Ops"})
    objective = client.post(
        "/splanner/api/objectives",
        json={"project_id": project.json()["id"], "name": "Reduce incidents"},
    )
    item = client.post(
        "/splanner/api/items",
        json={"objective_id": objective.json()["id"], "name": "Ship fix"},
    )
    return project.json()["id"], objective.json()["id"], item.json()["id"]


def test_life_graph_adapter_filters_and_maps(tmp_path, monkeypatch):
    import apps.splanner.connectors.life_graph as life_graph_module

    db_path = tmp_path / "life-graph.db"
    create_life_graph_db(
        db_path,
        [
            (1, "decision", "Routing", "Use shared ingest", "2026-06-09 09:00:00", None),
            (2, "knowledge", "Noise", "Ignore me", "2026-06-09 09:05:00", None),
            (3, "goal", "Ship", "X" * 350, "2026-06-09 09:10:00", None),
            (4, "lesson", "Retro", "Learned thing", "2026-06-08 08:00:00", "2026-06-10 00:00:00"),
        ],
    )
    monkeypatch.setattr(life_graph_module, "LIFE_GRAPH_DB_PATH", db_path)

    connector = life_graph_module.LifeGraphConnector()
    signals = connector.poll(datetime_from("2026-06-09T08:30:00Z"))

    assert signals == [
        life_graph_module.RawSignal(
            body="[decision] Routing: Use shared ingest",
            source_ref="1",
            occurred_at="2026-06-09T09:00:00Z",
        ),
        life_graph_module.RawSignal(
            body=f"[goal] Ship: {'X' * 300}",
            source_ref="3",
            occurred_at="2026-06-09T09:10:00Z",
        ),
    ]


def test_life_graph_adapter_missing_db_raises(monkeypatch, tmp_path):
    import apps.splanner.connectors.life_graph as life_graph_module
    from apps.splanner.connectors import ConnectorNotConfigured

    monkeypatch.setattr(life_graph_module, "LIFE_GRAPH_DB_PATH", tmp_path / "missing.db")

    with pytest.raises(ConnectorNotConfigured):
        life_graph_module.LifeGraphConnector().poll(datetime_from("2026-06-09T08:30:00Z"))


def test_ingest_connector_dedups_and_schedules_only_classified(client: TestClient):
    from apps.splanner.capture import ingest_connector
    from apps.splanner.connectors import RawSignal

    scheduled: list[int] = []

    class FakeConnector:
        name = "life-graph"

        def poll(self, since):
            return [
                RawSignal(body="Calendar note", source_ref="evt-1", occurred_at="2026-06-10T09:00:00Z"),
                RawSignal(body="Tkt win", source_ref="evt-2", occurred_at="2026-06-10T09:05:00Z", kind="win"),
            ]

    first = ingest_connector(FakeConnector(), scheduled.append)
    second = ingest_connector(FakeConnector(), scheduled.append)

    assert first == {"polled": 2, "inserted": 2, "checkin_ids": [1, 2]}
    assert second == {"polled": 2, "inserted": 0, "checkin_ids": []}
    assert scheduled == [1]


def test_ingest_connector_uses_newer_since_floor_over_db_max(client: TestClient):
    from apps.splanner.capture import ingest_connector
    from apps.splanner.connectors import RawSignal

    seen_since: list[datetime] = []

    class FakeConnector:
        name = "life-graph"

        def poll(self, since):
            seen_since.append(since)
            return [RawSignal(body="note", source_ref="evt-1", occurred_at="2026-06-10T09:00:00Z")]

    first = ingest_connector(FakeConnector(), lambda checkin_id: None)
    assert first["inserted"] == 1

    newer_floor = datetime_from("2026-06-10T10:00:00Z")
    ingest_connector(FakeConnector(), lambda checkin_id: None, since_floor=newer_floor)

    assert seen_since[1] == newer_floor


def test_ingest_connector_prefers_db_since_when_floor_older_or_missing(client: TestClient):
    from apps.splanner.capture import ingest_connector
    from apps.splanner.connectors import RawSignal

    seen_since: list[datetime] = []
    db_derived_since = datetime_from("2026-06-10T09:00:00Z")

    class FakeConnector:
        name = "life-graph"

        def poll(self, since):
            seen_since.append(since)
            return [RawSignal(body="note", source_ref=f"evt-{len(seen_since)}", occurred_at="2026-06-10T09:00:00Z")]

    ingest_connector(FakeConnector(), lambda checkin_id: None)
    older_floor = datetime_from("2026-06-10T08:00:00Z")
    ingest_connector(FakeConnector(), lambda checkin_id: None, since_floor=older_floor)
    ingest_connector(FakeConnector(), lambda checkin_id: None, since_floor=None)

    assert seen_since[1] == db_derived_since
    assert seen_since[2] == db_derived_since


@pytest.mark.asyncio
async def test_run_capture_pass_continues_on_failures_and_updates_state(client: TestClient, tmp_path, monkeypatch):
    import apps.splanner.capture as capture_module
    from apps.splanner.connectors import ConnectorNotConfigured, RawSignal

    class OkConnector:
        name = "calendar"

        def poll(self, since):
            return [RawSignal(body="Calendar: Standup", source_ref="evt-1", occurred_at="2026-06-10T09:00:00Z")]

    class BrokenConnector:
        name = "tkt"

        def poll(self, since):
            raise RuntimeError("boom")

    class MissingConnector:
        name = "life-graph"

        def poll(self, since):
            raise ConnectorNotConfigured

    recorded_classify: list[int] = []
    state_path = tmp_path / "splanner-daemon-state.json"

    monkeypatch.setattr(capture_module, "DAEMON_STATE_PATH", state_path)
    monkeypatch.setattr(capture_module, "list_connectors", lambda: [OkConnector(), BrokenConnector(), MissingConnector()])
    monkeypatch.setattr(capture_module, "classify_checkin", recorded_classify.append)

    state = await capture_module.run_capture_pass(now=datetime_from("2026-06-10T08:05:00Z"), state_path=state_path)

    assert state["last_capture_date"] == "2026-06-10"
    assert state["connectors"]["calendar"] == "2026-06-10T08:05:00+00:00"
    assert "tkt" not in state["connectors"]
    assert "life-graph" not in state["connectors"]
    assert recorded_classify == [1]

    saved = capture_module.load_daemon_state(state_path)
    assert saved["last_capture_date"] == "2026-06-10"


@pytest.mark.asyncio
async def test_run_capture_pass_ignores_malformed_state_timestamp(client: TestClient, tmp_path, monkeypatch):
    import apps.splanner.capture as capture_module

    class CalendarConnector:
        name = "calendar"

    seen_floor: list[object] = []
    state_path = tmp_path / "splanner-daemon-state.json"
    capture_module.save_daemon_state(
        {
            "last_capture_date": None,
            "last_digest_week": None,
            "connectors": {"calendar": "not-a-timestamp"},
        },
        state_path,
    )

    def fake_ingest(connector, schedule_classify, since_floor=None):
        seen_floor.append(since_floor)
        return {"polled": 0, "inserted": 0, "checkin_ids": []}

    monkeypatch.setattr(capture_module, "DAEMON_STATE_PATH", state_path)
    monkeypatch.setattr(capture_module, "list_connectors", lambda: [CalendarConnector()])
    monkeypatch.setattr(capture_module, "ingest_connector", fake_ingest)

    await capture_module.run_capture_pass(now=datetime_from("2026-06-10T08:05:00Z"), state_path=state_path)

    assert seen_floor == [None]


def test_should_draft_digest_respects_monday_state_and_approved_digest(tmp_path, monkeypatch):
    from server import config as server_config

    monkeypatch.setattr(server_config, "DATA_DIR", tmp_path)

    import apps.splanner.db as splanner_db

    monkeypatch.setattr(splanner_db, "DATA_DIR", tmp_path)

    from apps.splanner.capture import should_draft_digest

    db = splanner_db.get_db()
    try:
        monday = datetime.fromisoformat("2026-06-08T08:45:00+00:00")
        state = {"last_digest_week": None}
        assert should_draft_digest(monday, state, db) is True
        assert should_draft_digest(datetime.fromisoformat("2026-06-09T08:45:00+00:00"), state, db) is False

        db.execute(
            "INSERT INTO digests (week_start, state, narrative_md, kpi_deltas, risks, nudges, focus) VALUES (?, ?, ?, ?, ?, ?, ?)",
            ("2026-06-08", "approved", "done", "[]", "[]", "[]", "[]"),
        )
        db.commit()
        assert should_draft_digest(monday, state, db) is False
    finally:
        db.close()


def test_poll_route_and_digest_route_reuse_shared_helpers(client: TestClient, monkeypatch):
    from apps.splanner.connectors import RawSignal, get_connector

    seed_project(client)

    calls: list[int] = []
    monkeypatch.setattr("apps.splanner.routes.classify_checkin", calls.append)

    connector = get_connector("calendar")
    assert connector is not None
    monkeypatch.setattr(
        connector,
        "poll",
        lambda since: [RawSignal(body="Calendar: Review", source_ref="evt-1", occurred_at="2026-06-10T09:00:00Z")],
    )

    poll_response = client.post("/splanner/api/connectors/calendar/poll")
    assert poll_response.status_code == 200
    assert poll_response.json() == {"polled": 1, "inserted": 1, "checkin_ids": [1]}
    assert calls == [1]

    def fake_draft_and_store(week_start: str, **kwargs):
        return {
            "id": 1,
            "week_start": week_start,
            "state": "drafted",
            "narrative_md": "Week summary",
            "kpi_deltas": [],
            "risks": [],
            "nudges": [],
            "focus": [],
            "created_at": "2026-06-08T08:45:00.000Z",
        }

    monkeypatch.setattr("apps.splanner.routes.draft_and_store", fake_draft_and_store)
    digest_response = client.post("/splanner/api/digest/draft?week_start=2026-06-08")
    assert digest_response.status_code == 200
    assert digest_response.json()["week_start"] == "2026-06-08"
