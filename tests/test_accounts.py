"""Tests for claude_accounts table + secret-ref validation + HTTP API."""
import tempfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from claude_scheduler.core.db import Database
from claude_scheduler.core.secrets import (
    validate_secret_ref, resolve_secret_ref, SecretResolutionError,
)


@pytest.fixture
def db():
    tmp = tempfile.mkdtemp()
    d = Database(Path(tmp) / "t.db")
    yield d
    d.close()


# ----- DB layer ----------------------------------------------------------

def test_create_config_dir_account(db):
    a = db.create_account(name="pers-pro", kind="config_dir",
                          config_dir="/tmp/x", plan_tier="pro")
    assert a.id and a.name == "pers-pro" and a.kind == "config_dir"
    assert a.config_dir == "/tmp/x" and a.api_key_ref == ""
    assert a.is_default is False


def test_create_api_key_account(db):
    a = db.create_account(name="api", kind="api_key",
                          api_key_ref="keychain:claude-scheduler-api",
                          plan_tier="api")
    assert a.kind == "api_key" and a.api_key_ref.startswith("keychain:")
    assert a.config_dir == ""


def test_kind_check_constraint_blocks_mismatch(db):
    import sqlite3
    with pytest.raises(sqlite3.IntegrityError):
        db.create_account(name="bad", kind="config_dir",
                          api_key_ref="keychain:nope")


def test_unique_name(db):
    import sqlite3
    db.create_account(name="dup", kind="config_dir", config_dir="/a")
    with pytest.raises(sqlite3.IntegrityError):
        db.create_account(name="dup", kind="config_dir", config_dir="/b")


def test_default_uniqueness(db):
    db.create_account(name="a", kind="config_dir", config_dir="/a", is_default=True)
    db.create_account(name="b", kind="config_dir", config_dir="/b", is_default=True)
    accs = {x.name: x for x in db.list_accounts()}
    assert accs["a"].is_default is False
    assert accs["b"].is_default is True
    assert db.get_default_account().name == "b"


def test_set_default_clears_others(db):
    db.create_account(name="a", kind="config_dir", config_dir="/a", is_default=True)
    b = db.create_account(name="b", kind="config_dir", config_dir="/b")
    db.set_default_account(b.id)
    assert db.get_default_account().name == "b"


def test_update_account(db):
    a = db.create_account(name="x", kind="config_dir", config_dir="/old")
    db.update_account(a.id, config_dir="/new", plan_tier="max")
    refreshed = db.get_account(a.id)
    assert refreshed.config_dir == "/new" and refreshed.plan_tier == "max"


def test_update_rejects_kind_change(db):
    a = db.create_account(name="x", kind="config_dir", config_dir="/old")
    with pytest.raises(ValueError):
        db.update_account(a.id, kind="api_key")


def test_delete_account(db):
    a = db.create_account(name="x", kind="config_dir", config_dir="/x")
    assert db.delete_account(a.id) is True
    assert db.get_account(a.id) is None
    assert db.delete_account(a.id) is False


def test_touch_last_used(db):
    a = db.create_account(name="x", kind="config_dir", config_dir="/x")
    db.touch_account_last_used(a.id)
    refreshed = db.get_account(a.id)
    assert refreshed.last_used_at


# ----- secret resolver ---------------------------------------------------

def test_validate_keychain_ref():
    validate_secret_ref("keychain:my-service")
    with pytest.raises(ValueError):
        validate_secret_ref("keychain:")


def test_validate_op_ref():
    validate_secret_ref("op://Personal/claude/credential")
    with pytest.raises(ValueError):
        validate_secret_ref("op://Personal/claude")
    with pytest.raises(ValueError):
        validate_secret_ref("op://Personal//credential")


def test_validate_unknown_scheme():
    with pytest.raises(ValueError):
        validate_secret_ref("env:FOO")
    with pytest.raises(ValueError):
        validate_secret_ref("")


def test_resolve_keychain_success(monkeypatch):
    class FakeRun:
        stdout = "the-secret\n"
        stderr = ""
        returncode = 0

    import claude_scheduler.core.secrets as s
    monkeypatch.setattr(s.shutil, "which", lambda _x: "/usr/bin/security")
    monkeypatch.setattr(s.subprocess, "run", lambda *a, **kw: FakeRun())
    assert resolve_secret_ref("keychain:foo") == "the-secret"


def test_resolve_keychain_missing_cli(monkeypatch):
    import claude_scheduler.core.secrets as s
    monkeypatch.setattr(s.shutil, "which", lambda _x: None)
    with pytest.raises(SecretResolutionError):
        resolve_secret_ref("keychain:foo")


# ----- HTTP layer --------------------------------------------------------

@pytest.fixture
def client(tmp_path, monkeypatch):
    # Point DATA_DIR at a tmp dir so a fresh DB is created per test.
    from server import config as server_config
    monkeypatch.setattr(server_config, "DATA_DIR", tmp_path)
    # Some routes import DATA_DIR by name; patch the local copy too.
    import apps.scheduler.routes as r
    monkeypatch.setattr(r, "DATA_DIR", tmp_path)
    from server.main import app
    return TestClient(app)


def test_http_create_and_list(client):
    r = client.post("/scheduler/api/accounts", json={
        "name": "personal-pro", "kind": "config_dir",
        "config_dir": "/tmp/profiles/personal", "plan_tier": "pro",
    })
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["name"] == "personal-pro" and body["api_key_ref"] is None

    r = client.get("/scheduler/api/accounts")
    assert r.status_code == 200
    assert any(x["name"] == "personal-pro" for x in r.json())


def test_http_create_validates_kind_fields(client):
    r = client.post("/scheduler/api/accounts", json={
        "name": "bad", "kind": "config_dir", "api_key_ref": "keychain:x",
    })
    assert r.status_code == 400


def test_http_create_validates_secret_ref(client):
    r = client.post("/scheduler/api/accounts", json={
        "name": "bad", "kind": "api_key", "api_key_ref": "env:FOO",
    })
    assert r.status_code == 400


def test_http_set_default(client):
    a = client.post("/scheduler/api/accounts", json={
        "name": "a", "kind": "config_dir", "config_dir": "/a",
    }).json()
    b = client.post("/scheduler/api/accounts", json={
        "name": "b", "kind": "config_dir", "config_dir": "/b",
    }).json()
    r = client.post(f"/scheduler/api/accounts/{b['id']}/default")
    assert r.status_code == 200 and r.json()["is_default"] is True
    listing = {x["name"]: x for x in client.get("/scheduler/api/accounts").json()}
    assert listing["a"]["is_default"] is False
    assert listing["b"]["is_default"] is True


def test_http_delete(client):
    a = client.post("/scheduler/api/accounts", json={
        "name": "rm", "kind": "config_dir", "config_dir": "/rm",
    }).json()
    r = client.delete(f"/scheduler/api/accounts/{a['id']}")
    assert r.status_code == 204
    r = client.get(f"/scheduler/api/accounts/{a['id']}")
    assert r.status_code == 404


def test_http_response_never_includes_plaintext_secret(client):
    r = client.post("/scheduler/api/accounts", json={
        "name": "k", "kind": "api_key",
        "api_key_ref": "keychain:claude-scheduler-test",
    })
    assert r.status_code == 201
    body = r.json()
    assert body["api_key_ref"] == "keychain:claude-scheduler-test"
