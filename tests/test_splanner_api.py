"""Tests for SPlanner project API routes."""
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


def test_context_filter(client: TestClient):
    client.post("/splanner/api/projects", json={"context": "work", "name": "Work"})
    client.post("/splanner/api/projects", json={"context": "family", "name": "Family"})

    response = client.get("/splanner/api/projects?context=family")

    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    assert data[0]["context"] == "family"
    assert data[0]["name"] == "Family"


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
