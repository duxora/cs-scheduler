"""Tests for account import routes."""
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
    return TestClient(__import__("server.main", fromlist=["app"]).app)


def _db(tmp_path):
    return Database(Path(tmp_path) / "scheduler.db")


def test_accounts_import_happy_path(client, tmp_path, monkeypatch):
    import apps.scheduler.routes as routes

    config_dir = tmp_path / "profile"
    config_dir.mkdir()
    monkeypatch.setattr(routes, "_has_claude_credentials", lambda _path: True)

    resp = client.post("/scheduler/api/accounts/import", json={
        "name": "main",
        "config_dir": str(config_dir),
        "plan_tier": "max",
        "is_default": True,
        "skip_credentials_check": False,
    })
    assert resp.status_code == 201
    body = resp.json()
    assert body["name"] == "main"
    assert body["kind"] == "config_dir"
    assert body["config_dir"] == str(config_dir.resolve())
    assert body["plan_tier"] == "max"
    assert body["is_default"] is True

    db = _db(tmp_path)
    try:
        acct = db.get_account_by_name("main")
        assert acct is not None
        assert acct.config_dir == str(config_dir.resolve())
    finally:
        db.close()


def test_accounts_import_missing_dir_400(client):
    resp = client.post("/scheduler/api/accounts/import", json={
        "name": "main",
        "config_dir": "/does/not/exist",
        "plan_tier": None,
        "is_default": False,
        "skip_credentials_check": False,
    })
    assert resp.status_code == 400
    assert resp.json() == {"error": "config_dir does not exist"}


def test_accounts_import_no_credentials_without_skip_400(client, tmp_path, monkeypatch):
    import apps.scheduler.routes as routes

    config_dir = tmp_path / "profile"
    config_dir.mkdir()
    monkeypatch.setattr(routes, "_has_claude_credentials", lambda _path: False)

    resp = client.post("/scheduler/api/accounts/import", json={
        "name": "main",
        "config_dir": str(config_dir),
        "plan_tier": None,
        "is_default": False,
        "skip_credentials_check": False,
    })
    assert resp.status_code == 400
    assert resp.json() == {
        "error": "no Claude credentials found for this dir; run `claude /login` with CLAUDE_CONFIG_DIR=<dir> first, or pass skip_credentials_check=true",
    }


def test_accounts_import_no_credentials_with_skip_201(client, tmp_path, monkeypatch):
    import apps.scheduler.routes as routes

    config_dir = tmp_path / "profile"
    config_dir.mkdir()
    monkeypatch.setattr(routes, "_has_claude_credentials", lambda _path: False)

    resp = client.post("/scheduler/api/accounts/import", json={
        "name": "main",
        "config_dir": str(config_dir),
        "plan_tier": None,
        "is_default": False,
        "skip_credentials_check": True,
    })
    assert resp.status_code == 201
    assert resp.json()["name"] == "main"


def test_accounts_import_duplicate_dir_409(client, tmp_path, monkeypatch):
    import apps.scheduler.routes as routes

    config_dir = tmp_path / "profile"
    config_dir.mkdir()
    monkeypatch.setattr(routes, "_has_claude_credentials", lambda _path: True)

    db = _db(tmp_path)
    try:
        db.create_account(name="existing", kind="config_dir", config_dir=str(config_dir.resolve()))
    finally:
        db.close()

    resp = client.post("/scheduler/api/accounts/import", json={
        "name": "other",
        "config_dir": str(config_dir),
        "plan_tier": None,
        "is_default": False,
        "skip_credentials_check": False,
    })
    assert resp.status_code == 409
    assert resp.json() == {"error": "config_dir already registered as existing"}
