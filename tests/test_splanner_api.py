"""Tests for SPlanner project API routes."""
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


def test_create_project_and_list_ranked(client: TestClient):
    low = client.post("/splanner/api/projects", json={"context": "work", "name": "Low", "priority": 1})
    high = client.post("/splanner/api/projects", json={"context": "work", "name": "High", "priority": 9})

    assert low.status_code == 201, low.text
    assert high.status_code == 201, high.text

    response = client.get("/splanner/api/projects")
    assert response.status_code == 200
    data = response.json()

    assert [project["name"] for project in data] == ["High", "Low"]
    assert [project["priority"] for project in data] == [9, 1]
    assert data[0]["health"] == {"on_track": 0, "at_risk": 0, "blocked": 0, "done": 0}
    assert data[0]["items_blocked"] == 0
    assert data[0]["latest_checkin"] is None
    assert data[0]["is_blocked"] is False


def test_context_filter(client: TestClient):
    client.post("/splanner/api/projects", json={"context": "work", "name": "Work"})
    client.post("/splanner/api/projects", json={"context": "family", "name": "Family"})

    response = client.get("/splanner/api/projects?context=family")

    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    assert data[0]["context"] == "family"
    assert data[0]["name"] == "Family"


def test_list_projects_includes_health_rollups_for_mixed_objective_statuses(client: TestClient):
    project = client.post("/splanner/api/projects", json={"context": "work", "name": "Ops"}).json()
    project_id = project["id"]

    objective_ids = []
    for name in ("Track", "Risk", "Block", "Done"):
        response = client.post(
            "/splanner/api/objectives",
            json={"project_id": project_id, "name": name},
        )
        assert response.status_code == 201, response.text
        objective_ids.append(response.json()["id"])

    assert client.patch(
        f"/splanner/api/objectives/{objective_ids[1]}",
        json={"status": "at_risk"},
    ).status_code == 200
    assert client.patch(
        f"/splanner/api/objectives/{objective_ids[2]}",
        json={"status": "blocked"},
    ).status_code == 200
    assert client.patch(
        f"/splanner/api/objectives/{objective_ids[3]}",
        json={"status": "done"},
    ).status_code == 200

    response = client.get("/splanner/api/projects")

    assert response.status_code == 200
    project_row = response.json()[0]
    assert project_row["health"] == {"on_track": 1, "at_risk": 1, "blocked": 1, "done": 1}
    assert project_row["items_blocked"] == 0
    assert project_row["is_blocked"] is True


def test_blocked_objective_auto_boosts_project_above_higher_priority_healthy_project(client: TestClient):
    client.post("/splanner/api/projects", json={"context": "work", "name": "Healthy", "priority": 9})
    blocked = client.post("/splanner/api/projects", json={"context": "work", "name": "Blocked", "priority": 1})

    blocked_objective = client.post(
        "/splanner/api/objectives",
        json={"project_id": blocked.json()["id"], "name": "Fix release"},
    )
    assert blocked_objective.status_code == 201, blocked_objective.text
    patched = client.patch(
        f"/splanner/api/objectives/{blocked_objective.json()['id']}",
        json={"status": "blocked"},
    )
    assert patched.status_code == 200, patched.text

    response = client.get("/splanner/api/projects")

    assert response.status_code == 200
    data = response.json()
    assert [project["name"] for project in data] == ["Blocked", "Healthy"]
    assert data[0]["is_blocked"] is True
    assert data[1]["is_blocked"] is False


def test_blocked_item_auto_boosts_even_when_objectives_are_on_track(client: TestClient):
    client.post("/splanner/api/projects", json={"context": "work", "name": "Healthy", "priority": 9})
    blocked = client.post("/splanner/api/projects", json={"context": "work", "name": "Item Blocked", "priority": 1})

    objective = client.post(
        "/splanner/api/objectives",
        json={"project_id": blocked.json()["id"], "name": "Ship update"},
    )
    item = client.post(
        "/splanner/api/items",
        json={"objective_id": objective.json()["id"], "name": "Wait for vendor"},
    )
    assert item.status_code == 201, item.text
    patched = client.patch(
        f"/splanner/api/items/{item.json()['id']}",
        json={"status": "blocked", "blockers": "vendor queue"},
    )
    assert patched.status_code == 200, patched.text

    response = client.get("/splanner/api/projects")

    assert response.status_code == 200
    data = response.json()
    assert [project["name"] for project in data] == ["Item Blocked", "Healthy"]
    assert data[0]["health"] == {"on_track": 1, "at_risk": 0, "blocked": 0, "done": 0}
    assert data[0]["items_blocked"] == 1
    assert data[0]["is_blocked"] is True


def test_list_projects_returns_latest_checkin_body_kind_and_created_at(client: TestClient):
    from server import config as server_config

    project = client.post("/splanner/api/projects", json={"context": "work", "name": "Ops"})
    project_id = project.json()["id"]

    older = client.post(
        "/splanner/api/checkins",
        json={"project_id": project_id, "body": "Older note", "kind": "note"},
    )
    newer = client.post(
        "/splanner/api/checkins",
        json={"project_id": project_id, "body": "Newest risk", "kind": "risk"},
    )
    assert older.status_code == 201, older.text
    assert newer.status_code == 201, newer.text

    with sqlite3.connect(server_config.DATA_DIR / "splanner.db") as conn:
        conn.execute(
            "UPDATE checkins SET created_at = ? WHERE id = ?",
            ("2026-06-01T10:00:00.000Z", older.json()["id"]),
        )
        conn.execute(
            "UPDATE checkins SET created_at = ? WHERE id = ?",
            ("2026-06-01T10:05:00.000Z", newer.json()["id"]),
        )
        conn.commit()

    response = client.get("/splanner/api/projects")

    assert response.status_code == 200
    latest_checkin = response.json()[0]["latest_checkin"]
    assert latest_checkin == {
        "body": "Newest risk",
        "kind": "risk",
        "created_at": "2026-06-01T10:05:00.000Z",
    }


def test_rename_and_rerank(client: TestClient):
    created = client.post("/splanner/api/projects", json={"context": "personal", "name": "Old", "priority": 2})
    project_id = created.json()["id"]

    response = client.patch(f"/splanner/api/projects/{project_id}", json={"name": "New", "priority": 7})

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["name"] == "New"
    assert body["priority"] == 7

    detail = client.get(f"/splanner/api/projects/{project_id}")
    assert detail.status_code == 200
    assert detail.json()["project"]["name"] == "New"


def test_archive_hidden_by_default_and_visible_with_flag(client: TestClient):
    created = client.post("/splanner/api/projects", json={"context": "work", "name": "Archive Me"})
    project_id = created.json()["id"]

    archived = client.patch(f"/splanner/api/projects/{project_id}", json={"archived": True})
    assert archived.status_code == 200
    assert archived.json()["archived"] is True

    default_list = client.get("/splanner/api/projects")
    assert default_list.status_code == 200
    assert default_list.json() == []

    archived_list = client.get("/splanner/api/projects?include_archived=1")
    assert archived_list.status_code == 200
    assert len(archived_list.json()) == 1
    assert archived_list.json()[0]["id"] == project_id


def test_invalid_context_returns_4xx(client: TestClient):
    response = client.post("/splanner/api/projects", json={"context": "invalid", "name": "Bad"})
    assert 400 <= response.status_code < 500


def test_detail_returns_empty_objectives_list(client: TestClient):
    created = client.post("/splanner/api/projects", json={"context": "family", "name": "Trip"})
    project_id = created.json()["id"]

    response = client.get(f"/splanner/api/projects/{project_id}")

    assert response.status_code == 200
    body = response.json()
    assert body["project"]["id"] == project_id
    assert body["objectives"] == []
    assert body["checkins"] == []


def test_detail_missing_project_returns_404(client: TestClient):
    response = client.get("/splanner/api/projects/99999")
    assert response.status_code == 404


def test_create_objective_under_project_appears_in_detail_tree(client: TestClient):
    project = client.post("/splanner/api/projects", json={"context": "work", "name": "Ops"})
    project_id = project.json()["id"]

    response = client.post(
        "/splanner/api/objectives",
        json={
            "project_id": project_id,
            "name": "Stabilize CI",
            "metric": "pass rate",
            "target": "99",
            "unit": "%",
            "deadline": "2026-06-30",
        },
    )

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["project_id"] == project_id
    assert body["name"] == "Stabilize CI"
    assert body["status"] == "on_track"

    detail = client.get(f"/splanner/api/projects/{project_id}")
    assert detail.status_code == 200
    objectives = detail.json()["objectives"]
    assert len(objectives) == 1
    assert objectives[0]["id"] == body["id"]
    assert objectives[0]["items"] == []


def test_create_objective_missing_project_returns_404(client: TestClient):
    response = client.post("/splanner/api/objectives", json={"project_id": 99999, "name": "Missing"})
    assert response.status_code == 404


def test_patch_objective_current_and_status(client: TestClient):
    project = client.post("/splanner/api/projects", json={"context": "work", "name": "Ops"})
    objective = client.post(
        "/splanner/api/objectives",
        json={"project_id": project.json()["id"], "name": "Improve uptime"},
    )
    objective_id = objective.json()["id"]

    response = client.patch(
        f"/splanner/api/objectives/{objective_id}",
        json={"current": "97", "status": "at_risk"},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["current"] == "97"
    assert body["status"] == "at_risk"


def test_invalid_objective_status_returns_422(client: TestClient):
    project = client.post("/splanner/api/projects", json={"context": "work", "name": "Ops"})
    objective = client.post(
        "/splanner/api/objectives",
        json={"project_id": project.json()["id"], "name": "Improve uptime"},
    )

    response = client.patch(
        f"/splanner/api/objectives/{objective.json()['id']}",
        json={"status": "bad"},
    )

    assert response.status_code == 422


def test_create_item_under_objective_appears_nested_in_detail(client: TestClient):
    project = client.post("/splanner/api/projects", json={"context": "work", "name": "Ops"})
    project_id = project.json()["id"]
    objective = client.post(
        "/splanner/api/objectives",
        json={"project_id": project_id, "name": "Reduce incidents"},
    )
    objective_id = objective.json()["id"]

    response = client.post(
        "/splanner/api/items",
        json={
            "objective_id": objective_id,
            "name": "Close flaky tests",
            "eta": "2026-06-20",
            "tkt_ticket_id": 1751,
        },
    )

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["objective_id"] == objective_id
    assert body["status"] == "todo"

    detail = client.get(f"/splanner/api/projects/{project_id}")
    assert detail.status_code == 200
    items = detail.json()["objectives"][0]["items"]
    assert len(items) == 1
    assert items[0]["id"] == body["id"]
    assert items[0]["tkt_ticket_id"] == 1751


def test_create_item_missing_objective_returns_404(client: TestClient):
    response = client.post("/splanner/api/items", json={"objective_id": 99999, "name": "Missing"})
    assert response.status_code == 404


def test_patch_item_status_and_blockers(client: TestClient):
    project = client.post("/splanner/api/projects", json={"context": "work", "name": "Ops"})
    objective = client.post(
        "/splanner/api/objectives",
        json={"project_id": project.json()["id"], "name": "Reduce incidents"},
    )
    item = client.post(
        "/splanner/api/items",
        json={"objective_id": objective.json()["id"], "name": "Close flaky tests"},
    )
    item_id = item.json()["id"]

    response = client.patch(
        f"/splanner/api/items/{item_id}",
        json={"status": "blocked", "blockers": "waiting on owner"},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "blocked"
    assert body["blockers"] == "waiting on owner"


def test_invalid_item_status_returns_422(client: TestClient):
    project = client.post("/splanner/api/projects", json={"context": "work", "name": "Ops"})
    objective = client.post(
        "/splanner/api/objectives",
        json={"project_id": project.json()["id"], "name": "Reduce incidents"},
    )
    item = client.post(
        "/splanner/api/items",
        json={"objective_id": objective.json()["id"], "name": "Close flaky tests"},
    )

    response = client.patch(
        f"/splanner/api/items/{item.json()['id']}",
        json={"status": "bad"},
    )

    assert response.status_code == 422


def test_create_project_scoped_checkin_appears_in_project_filtered_stream(client: TestClient):
    project = client.post("/splanner/api/projects", json={"context": "work", "name": "Ops"})
    project_id = project.json()["id"]

    created = client.post(
        "/splanner/api/checkins",
        json={
            "project_id": project_id,
            "body": "Closed the paging gap",
            "kind": "win",
        },
    )

    assert created.status_code == 201, created.text
    body = created.json()
    assert body["project_id"] == project_id
    assert body["objective_id"] is None
    assert body["item_id"] is None
    assert body["source"] == "manual"
    assert body["ai_classified"] is False

    response = client.get(f"/splanner/api/checkins?project_id={project_id}")

    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    assert data[0]["id"] == body["id"]
    assert data[0]["kind"] == "win"


def test_create_objective_scoped_checkin_derives_project_id(client: TestClient):
    project = client.post("/splanner/api/projects", json={"context": "work", "name": "Ops"})
    project_id = project.json()["id"]
    objective = client.post(
        "/splanner/api/objectives",
        json={"project_id": project_id, "name": "Reduce incidents"},
    )

    created = client.post(
        "/splanner/api/checkins",
        json={
            "objective_id": objective.json()["id"],
            "body": "Risk review slipped",
            "kind": "risk",
        },
    )

    assert created.status_code == 201, created.text
    body = created.json()
    assert body["project_id"] == project_id
    assert body["objective_id"] == objective.json()["id"]

    response = client.get(f"/splanner/api/checkins?project_id={project_id}")

    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    assert data[0]["id"] == body["id"]


def test_create_checkin_with_two_link_ids_returns_400(client: TestClient):
    project = client.post("/splanner/api/projects", json={"context": "work", "name": "Ops"})
    objective = client.post(
        "/splanner/api/objectives",
        json={"project_id": project.json()["id"], "name": "Reduce incidents"},
    )

    response = client.post(
        "/splanner/api/checkins",
        json={
            "project_id": project.json()["id"],
            "objective_id": objective.json()["id"],
            "body": "Too many links",
            "kind": "note",
        },
    )

    assert response.status_code == 400


def test_create_checkin_missing_target_returns_404(client: TestClient):
    response = client.post(
        "/splanner/api/checkins",
        json={"objective_id": 99999, "body": "Missing objective", "kind": "blocked"},
    )

    assert response.status_code == 404


def test_create_checkin_invalid_kind_returns_422(client: TestClient):
    response = client.post(
        "/splanner/api/checkins",
        json={"body": "Bad kind", "kind": "unknown"},
    )

    assert response.status_code == 422


def test_list_checkins_filters_by_kind(client: TestClient):
    project = client.post("/splanner/api/projects", json={"context": "work", "name": "Ops"})
    project_id = project.json()["id"]
    client.post(
        "/splanner/api/checkins",
        json={"project_id": project_id, "body": "Closed gap", "kind": "win"},
    )
    client.post(
        "/splanner/api/checkins",
        json={"project_id": project_id, "body": "Need more staffing", "kind": "risk"},
    )

    response = client.get("/splanner/api/checkins?kind=risk")

    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    assert data[0]["kind"] == "risk"
    assert data[0]["body"] == "Need more staffing"


def test_list_checkins_filters_by_source(client: TestClient):
    project = client.post("/splanner/api/projects", json={"context": "work", "name": "Ops"})
    project_id = project.json()["id"]
    client.post(
        "/splanner/api/checkins",
        json={"project_id": project_id, "body": "Manual update", "kind": "note"},
    )

    response = client.get("/splanner/api/checkins?source=manual")

    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    assert data[0]["source"] == "manual"
