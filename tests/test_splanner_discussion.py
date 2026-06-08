"""Tests for SPlanner discussion routes."""
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


def _create_project(client: TestClient, *, context: str = "work", name: str = "Ops") -> int:
    response = client.post("/splanner/api/projects", json={"context": context, "name": name})
    assert response.status_code == 201, response.text
    return response.json()["id"]


def _db_path():
    from server import config as server_config

    return server_config.DATA_DIR / "splanner.db"


def test_post_message_persists_assistant_reply_and_get_lists_thread(client: TestClient, monkeypatch):
    project_id = _create_project(client)

    async def fake_ask(prompt: str, timeout: int = 180) -> str | None:
        assert "Need a plan" in prompt
        return "Here is the next step."

    monkeypatch.setattr("apps.splanner.discussion._ask_claude", fake_ask)

    response = client.post(
        f"/splanner/api/projects/{project_id}/discussion/messages",
        json={"text": "Need a plan"},
    )

    assert response.status_code == 200, response.text
    assistant = response.json()
    assert assistant["role"] == "assistant"
    assert assistant["content"] == "Here is the next step."

    thread = client.get(f"/splanner/api/projects/{project_id}/discussion")
    assert thread.status_code == 200, thread.text
    assert thread.json() == {
        "messages": [
            {
                "id": 1,
                "role": "user",
                "content": "Need a plan",
                "created_at": thread.json()["messages"][0]["created_at"],
            },
            {
                "id": 2,
                "role": "assistant",
                "content": "Here is the next step.",
                "created_at": thread.json()["messages"][1]["created_at"],
            },
        ]
    }


def test_discussion_rejects_empty_text_and_unknown_project(client: TestClient):
    project_id = _create_project(client)

    empty = client.post(
        f"/splanner/api/projects/{project_id}/discussion/messages",
        json={"text": "   "},
    )
    assert empty.status_code == 400
    assert empty.json()["detail"] == "text must not be empty"

    missing = client.get("/splanner/api/projects/99999/discussion")
    assert missing.status_code == 404
    assert missing.json()["detail"] == "not found"


def test_convert_injects_make_defaults_and_returns_empty_dropped(client: TestClient, monkeypatch):
    project_id = _create_project(client)

    async def fake_ask(prompt: str, timeout: int = 180) -> str | None:
        assert "STRICT JSON" in prompt
        return """
        {
          "ops": [
            {"type": "objective", "name": "Ship", "metric": "coverage", "target": "90", "unit": "%"},
            {"type": "item", "objective_id": 1, "new_objective_name": null, "name": "Write tests"},
            {"type": "checkin", "level": "project", "target_id": 1, "kind": "win", "body": "Started work"}
          ]
        }
        """

    monkeypatch.setattr("apps.splanner.discussion._ask_claude", fake_ask)

    response = client.post(f"/splanner/api/projects/{project_id}/discussion/convert")

    assert response.status_code == 200, response.text
    assert response.json() == {
        "ops": [
            {
                "type": "objective",
                "name": "Ship",
                "metric": "coverage",
                "target": "90",
                "unit": "%",
                "make_epic": False,
            },
            {
                "type": "item",
                "objective_id": 1,
                "new_objective_name": None,
                "name": "Write tests",
                "make_ticket": False,
            },
            {
                "type": "checkin",
                "level": "project",
                "target_id": 1,
                "kind": "win",
                "body": "Started work",
            },
        ],
        "dropped": [],
    }


def test_convert_drops_invalid_ops_but_keeps_valid_ones(client: TestClient, monkeypatch):
    project_id = _create_project(client)

    async def fake_ask(prompt: str, timeout: int = 180) -> str | None:
        return """
        {
          "ops": [
            {"type": "objective", "name": "Ship", "metric": null, "target": null, "unit": null},
            {"type": "item", "objective_id": 1, "new_objective_name": "Ship", "name": "Bad ref"},
            {"type": "checkin", "level": "workspace", "target_id": 1, "kind": "note", "body": "Bad enum"}
          ]
        }
        """

    monkeypatch.setattr("apps.splanner.discussion._ask_claude", fake_ask)

    response = client.post(f"/splanner/api/projects/{project_id}/discussion/convert")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["ops"] == [
        {
            "type": "objective",
            "name": "Ship",
            "metric": None,
            "target": None,
            "unit": None,
            "make_epic": False,
        }
    ]
    assert len(body["dropped"]) == 2
    assert "exactly one" in body["dropped"][0]["reason"]
    assert "invalid checkin level" in body["dropped"][1]["reason"]


def test_apply_creates_rows_atomically_and_appends_system_message(client: TestClient, monkeypatch):
    project_id = _create_project(client)

    async def fail_epic(*args, **kwargs):
        raise AssertionError("create_epic_for_objective should not be called")

    async def fail_ticket(*args, **kwargs):
        raise AssertionError("create_ticket_for_item should not be called")

    monkeypatch.setattr("apps.splanner.routes.create_epic_for_objective", fail_epic)
    monkeypatch.setattr("apps.splanner.routes.create_ticket_for_item", fail_ticket)

    response = client.post(
        f"/splanner/api/projects/{project_id}/discussion/apply",
        json={
            "ops": [
                {
                    "type": "objective",
                    "name": "Reduce incidents",
                    "metric": "incidents",
                    "target": "0",
                    "unit": "",
                    "make_epic": False,
                },
                {
                    "type": "item",
                    "objective_id": None,
                    "new_objective_name": "Reduce incidents",
                    "name": "Audit alert noise",
                    "make_ticket": False,
                },
                {
                    "type": "checkin",
                    "level": "project",
                    "target_id": project_id,
                    "kind": "note",
                    "body": "Kickoff captured",
                },
            ]
        },
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert len(body["created"]["objectives"]) == 1
    assert len(body["created"]["items"]) == 1
    assert len(body["created"]["checkins"]) == 1
    assert body["tkt_errors"] == []

    with sqlite3.connect(_db_path()) as conn:
        conn.row_factory = sqlite3.Row
        objective = conn.execute(
            "SELECT id, project_id, name FROM objectives WHERE id = ?",
            (body["created"]["objectives"][0],),
        ).fetchone()
        item = conn.execute(
            "SELECT id, objective_id, name FROM items WHERE id = ?",
            (body["created"]["items"][0],),
        ).fetchone()
        checkin = conn.execute(
            "SELECT project_id, objective_id, item_id, kind, source, body FROM checkins WHERE id = ?",
            (body["created"]["checkins"][0],),
        ).fetchone()
        messages = conn.execute(
            "SELECT role, content FROM discussion_messages WHERE project_id = ? ORDER BY id",
            (project_id,),
        ).fetchall()

    assert objective is not None
    assert objective["project_id"] == project_id
    assert item is not None
    assert item["objective_id"] == objective["id"]
    assert checkin is not None
    assert checkin["project_id"] == project_id
    assert checkin["objective_id"] is None
    assert checkin["item_id"] is None
    assert checkin["kind"] == "note"
    assert checkin["source"] == "manual"
    assert checkin["body"] == "Kickoff captured"
    assert messages[-1]["role"] == "system"
    assert messages[-1]["content"] == "Applied: 1 objective, 1 item, 1 check-in"


def test_apply_rolls_back_entire_batch_when_later_op_is_invalid(client: TestClient):
    project_id = _create_project(client)

    response = client.post(
        f"/splanner/api/projects/{project_id}/discussion/apply",
        json={
            "ops": [
                {
                    "type": "objective",
                    "name": "Reduce incidents",
                    "metric": None,
                    "target": None,
                    "unit": None,
                    "make_epic": False,
                },
                {
                    "type": "item",
                    "objective_id": 99999,
                    "new_objective_name": None,
                    "name": "Broken ref",
                    "make_ticket": False,
                },
            ]
        },
    )

    assert response.status_code == 400, response.text
    assert response.json()["detail"]["failed_op"]["name"] == "Broken ref"

    with sqlite3.connect(_db_path()) as conn:
        counts = {
            "objectives": conn.execute("SELECT COUNT(*) FROM objectives").fetchone()[0],
            "items": conn.execute("SELECT COUNT(*) FROM items").fetchone()[0],
            "checkins": conn.execute("SELECT COUNT(*) FROM checkins").fetchone()[0],
        }

    assert counts == {"objectives": 0, "items": 0, "checkins": 0}
