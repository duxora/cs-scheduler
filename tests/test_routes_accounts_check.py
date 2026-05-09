"""Tests for scheduler account setup-helper endpoints."""
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from claude_scheduler.core.db import Database


@pytest.fixture
def client(tmp_path, monkeypatch):
    from server import config as server_config
    monkeypatch.setattr(server_config, "DATA_DIR", tmp_path)
    import apps.scheduler.routes as routes
    monkeypatch.setattr(routes, "DATA_DIR", tmp_path)
    from server.main import app
    return TestClient(app)


def test_check_name_requires_name(client):
    resp = client.get("/scheduler/api/accounts/check-name?name=")
    assert resp.status_code == 200
    assert resp.json() == {"available": False, "reason": "name is required"}


def test_check_name_reports_fresh_name_available(client):
    resp = client.get("/scheduler/api/accounts/check-name?name=fresh-name")
    assert resp.status_code == 200
    assert resp.json() == {"available": True, "reason": None}


def test_check_name_reports_taken_name(client, tmp_path):
    db = Database(Path(tmp_path) / "scheduler.db")
    try:
        db.create_account(name="taken", kind="config_dir", config_dir="/tmp/taken")
    finally:
        db.close()

    resp = client.get("/scheduler/api/accounts/check-name?name=taken")
    assert resp.status_code == 200
    assert resp.json() == {"available": False, "reason": "already taken"}


def test_check_credentials_empty_path(client):
    resp = client.get("/scheduler/api/accounts/check?config_dir=")
    assert resp.status_code == 200
    assert resp.json() == {
        "dir_exists": False,
        "has_credentials": False,
        "expanded_path": "",
    }


def test_check_credentials_missing_dir(client):
    resp = client.get("/scheduler/api/accounts/check?config_dir=/nonexistent/path")
    assert resp.status_code == 200
    assert resp.json()["dir_exists"] is False
    assert resp.json()["has_credentials"] is False


def test_check_credentials_dir_without_credentials(client, tmp_path):
    config_dir = tmp_path / "profile"
    config_dir.mkdir()

    resp = client.get(f"/scheduler/api/accounts/check?config_dir={config_dir}")
    assert resp.status_code == 200
    assert resp.json() == {
        "dir_exists": True,
        "has_credentials": False,
        "expanded_path": str(config_dir),
    }


def test_check_credentials_dir_with_credentials(client, tmp_path):
    config_dir = tmp_path / "profile"
    config_dir.mkdir()
    (config_dir / ".credentials.json").write_text("{}")

    resp = client.get(f"/scheduler/api/accounts/check?config_dir={config_dir}")
    assert resp.status_code == 200
    assert resp.json() == {
        "dir_exists": True,
        "has_credentials": True,
        "expanded_path": str(config_dir),
    }


def test_check_credentials_expands_tilde(client, tmp_path, monkeypatch):
    home = tmp_path / "home"
    config_dir = home / ".config" / "claude-scheduler"
    config_dir.mkdir(parents=True)
    monkeypatch.setenv("HOME", str(home))

    resp = client.get("/scheduler/api/accounts/check?config_dir=~/.config/claude-scheduler")
    assert resp.status_code == 200
    assert resp.json() == {
        "dir_exists": True,
        "has_credentials": False,
        "expanded_path": str(config_dir),
    }
