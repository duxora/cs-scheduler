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
