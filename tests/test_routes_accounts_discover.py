"""Tests for account discovery."""
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


def _patch_home(monkeypatch, routes, home: Path):
    monkeypatch.setattr(routes.Path, "home", lambda: home)


def _candidates(resp):
    assert resp.status_code == 200
    body = resp.json()
    return {item["config_dir"]: item for item in body["candidates"]}


def test_accounts_discover_profiles_dir_absent(client, tmp_path, monkeypatch):
    import apps.scheduler.routes as routes

    home = tmp_path / "home"
    home.mkdir()
    _patch_home(monkeypatch, routes, home)
    monkeypatch.setattr(routes, "_has_claude_credentials", lambda _path: False)

    rows = _candidates(client.get("/scheduler/api/accounts/discover"))
    assert rows[str((home / ".claude").resolve())]["dir_exists"] is False
    assert rows[str((home / ".claude").resolve())]["has_credentials"] is False
    assert rows[str((home / ".claude-fleet").resolve())]["dir_exists"] is False


def test_accounts_discover_profile_child_present_and_creds(client, tmp_path, monkeypatch):
    import apps.scheduler.routes as routes

    home = tmp_path / "home"
    profile = home / ".claude-profiles" / "work"
    profile.mkdir(parents=True)
    _patch_home(monkeypatch, routes, home)
    monkeypatch.setattr(routes, "_has_claude_credentials", lambda _path: True)

    rows = _candidates(client.get("/scheduler/api/accounts/discover"))
    item = rows[str(profile.resolve())]
    assert item["name_suggestion"] == "work"
    assert item["dir_exists"] is True
    assert item["has_credentials"] is True


def test_accounts_discover_already_registered_marks_account(client, tmp_path, monkeypatch):
    import apps.scheduler.routes as routes

    home = tmp_path / "home"
    profile = home / ".claude"
    profile.mkdir(parents=True)
    _patch_home(monkeypatch, routes, home)
    monkeypatch.setattr(routes, "_has_claude_credentials", lambda _path: True)

    db = _db(tmp_path)
    try:
        account = db.create_account(name="main", kind="config_dir", config_dir=str(profile.resolve()))
    finally:
        db.close()

    rows = _candidates(client.get("/scheduler/api/accounts/discover"))
    item = rows[str(profile.resolve())]
    assert item["already_registered"] is True
    assert item["registered_account_id"] == account.id


def test_accounts_discover_missing_candidate_dir_reported(client, tmp_path, monkeypatch):
    import apps.scheduler.routes as routes

    home = tmp_path / "home"
    profile = home / ".claude"
    profile.mkdir(parents=True)
    _patch_home(monkeypatch, routes, home)
    monkeypatch.setattr(routes, "_has_claude_credentials", lambda _path: True)

    rows = _candidates(client.get("/scheduler/api/accounts/discover"))
    fleet = rows[str((home / ".claude-fleet").resolve())]
    assert fleet["dir_exists"] is False
    assert fleet["has_credentials"] is False
