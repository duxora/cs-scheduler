"""Tests for SPlanner tkt adapter and ticket creation flow."""
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


def create_tkt_db(path, rows: list[tuple[int, str, str, str]]) -> None:
    with sqlite3.connect(path) as conn:
        conn.execute(
            "CREATE TABLE tasks (id INTEGER PRIMARY KEY, title TEXT NOT NULL, status TEXT NOT NULL, updated_at TEXT NOT NULL)"
        )
        conn.executemany(
            "INSERT INTO tasks (id, title, status, updated_at) VALUES (?, ?, ?, ?)",
            rows,
        )
        conn.commit()


def seed_splanner_item(client: TestClient, *, context: str = "work", tkt_ticket_id: int | None = None) -> tuple[int, int, int]:
    project = client.post("/splanner/api/projects", json={"context": context, "name": f"{context} project"})
    objective = client.post(
        "/splanner/api/objectives",
        json={"project_id": project.json()["id"], "name": "Objective"},
    )
    item = client.post(
        "/splanner/api/items",
        json={"objective_id": objective.json()["id"], "name": "Item", "tkt_ticket_id": tkt_ticket_id},
    )
    return project.json()["id"], objective.json()["id"], item.json()["id"]


def test_tkt_poll_updates_item_and_emits_signal(client: TestClient, tmp_path, monkeypatch):
    import apps.splanner.connectors.tkt as tkt_module

    _, _, item_id = seed_splanner_item(client, tkt_ticket_id=101)
    tkt_db_path = tmp_path / "backlog.db"
    create_tkt_db(tkt_db_path, [(101, "Ship it", "done", "2026-06-12T10:00:00Z")])
    monkeypatch.setattr(tkt_module, "TKT_BACKLOG_DB_PATH", tkt_db_path)

    connector = tkt_module.TktConnector()
    signals = connector.poll(datetime_from("2026-06-01T00:00:00Z"))

    assert len(signals) == 1
    signal = signals[0]
    assert signal.kind == "win"
    assert signal.item_id == item_id
    assert signal.source_ref == "101:done:2026-06-12T10:00:00Z"

    detail = client.get(f"/splanner/api/projects/1")
    assert detail.status_code == 200
    assert detail.json()["objectives"][0]["items"][0]["status"] == "done"

    assert connector.poll(datetime_from("2026-06-01T00:00:00Z")) == []


def test_tkt_poll_skips_unchanged_missing_and_unmapped(client: TestClient, tmp_path, monkeypatch):
    import apps.splanner.connectors.tkt as tkt_module

    seed_splanner_item(client, tkt_ticket_id=201)
    _, _, second_item_id = seed_splanner_item(client, tkt_ticket_id=202)
    client.patch(f"/splanner/api/items/{second_item_id}", json={"status": "doing"})
    seed_splanner_item(client, tkt_ticket_id=999)

    tkt_db_path = tmp_path / "backlog.db"
    create_tkt_db(
        tkt_db_path,
        [
            (201, "Backlog task", "backlog", "2026-06-12T10:00:00Z"),
            (202, "Odd task", "mystery", "2026-06-12T11:00:00Z"),
        ],
    )
    monkeypatch.setattr(tkt_module, "TKT_BACKLOG_DB_PATH", tkt_db_path)

    connector = tkt_module.TktConnector()

    assert connector.poll(datetime_from("2026-06-01T00:00:00Z")) == []


def test_tkt_poll_route_inserts_linked_checkin_without_classify(client: TestClient, tmp_path, monkeypatch):
    import apps.splanner.connectors.tkt as tkt_module
    from apps.splanner.connectors import get_connector

    project_id, objective_id, item_id = seed_splanner_item(client, tkt_ticket_id=301)
    tkt_db_path = tmp_path / "backlog.db"
    create_tkt_db(tkt_db_path, [(301, "Ship it", "done", "2026-06-12T10:00:00Z")])
    monkeypatch.setattr(tkt_module, "TKT_BACKLOG_DB_PATH", tkt_db_path)
    import apps.splanner.connectors.tkt  # noqa: F401

    calls: list[int] = []
    monkeypatch.setattr("apps.splanner.routes.classify_checkin", lambda checkin_id: calls.append(checkin_id))

    connector = get_connector("tkt")
    assert connector is not None

    response = client.post("/splanner/api/connectors/tkt/poll")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["inserted"] == 1
    assert calls == []

    checkins = client.get("/splanner/api/checkins?source=tkt")
    assert checkins.status_code == 200
    checkin = checkins.json()[0]
    assert checkin["kind"] == "win"
    assert checkin["item_id"] == item_id
    assert checkin["objective_id"] == objective_id
    assert checkin["project_id"] == project_id


def test_create_ticket_success_and_errors(client: TestClient, monkeypatch):
    import apps.splanner.connectors.tkt as tkt_module

    _, _, item_id = seed_splanner_item(client)
    already_linked = seed_splanner_item(client, tkt_ticket_id=88)[2]
    personal_item = seed_splanner_item(client, context="personal")[2]

    def fake_run(*args, **kwargs):
        class Result:
            returncode = 0
            stdout = "Created task #123"
            stderr = ""

        return Result()

    monkeypatch.setattr(tkt_module.subprocess, "run", fake_run)

    success = client.post(f"/splanner/api/items/{item_id}/create-ticket", json={})
    assert success.status_code == 200, success.text
    assert success.json()["tkt_ticket_id"] == 123

    conflict = client.post(f"/splanner/api/items/{already_linked}/create-ticket", json={})
    assert conflict.status_code == 409

    bad_context = client.post(f"/splanner/api/items/{personal_item}/create-ticket", json={})
    assert bad_context.status_code == 400

    monkeypatch.setattr(
        tkt_module.subprocess,
        "run",
        lambda *args, **kwargs: type("Result", (), {"returncode": 1, "stdout": "", "stderr": "boom"})(),
    )
    failure = client.post(f"/splanner/api/items/{seed_splanner_item(client)[2]}/create-ticket", json={})
    assert failure.status_code == 502

    monkeypatch.setattr(
        tkt_module.subprocess,
        "run",
        lambda *args, **kwargs: type("Result", (), {"returncode": 0, "stdout": "no id", "stderr": ""})(),
    )
    unparseable = client.post(f"/splanner/api/items/{seed_splanner_item(client)[2]}/create-ticket", json={})
    assert unparseable.status_code == 502


def test_connectors_route_lists_calendar_tkt_and_life_graph(client: TestClient, tmp_path, monkeypatch):
    import apps.splanner.connectors.life_graph as life_graph_module
    import apps.splanner.connectors.tkt as tkt_module

    tkt_db_path = tmp_path / "backlog.db"
    create_tkt_db(tkt_db_path, [])
    life_graph_db_path = tmp_path / "life-graph.db"
    create_life_graph_db(life_graph_db_path, [])
    monkeypatch.setattr(tkt_module, "TKT_BACKLOG_DB_PATH", tkt_db_path)
    monkeypatch.setattr(life_graph_module, "LIFE_GRAPH_DB_PATH", life_graph_db_path)
    import apps.splanner.connectors.life_graph  # noqa: F401
    import apps.splanner.connectors.tkt  # noqa: F401

    response = client.get("/splanner/api/connectors")

    assert response.status_code == 200
    by_name = {entry["name"]: entry["configured"] for entry in response.json()}
    assert by_name["calendar"] is False
    assert by_name["tkt"] is True
    assert by_name["life-graph"] is True


def datetime_from(value: str):
    from datetime import datetime

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
