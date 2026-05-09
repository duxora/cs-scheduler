"""Tests for account health enrichment and the account probe endpoint."""
from datetime import datetime, timedelta, timezone
from pathlib import Path
import os
import subprocess

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


def _db(tmp_path):
    return Database(Path(tmp_path) / "scheduler.db")


def _recent_iso(hours=0, days=0):
    return (datetime.now(timezone.utc) - timedelta(hours=hours, days=days)).isoformat()


def _account_body(client, account_id):
    list_resp = client.get("/scheduler/api/accounts")
    assert list_resp.status_code == 200
    rows = list_resp.json()
    assert len(rows) == 1
    row = rows[0]
    assert row["id"] == account_id

    get_resp = client.get(f"/scheduler/api/accounts/{account_id}")
    assert get_resp.status_code == 200
    return row, get_resp.json()


def test_account_health_enrichment(client, tmp_path, monkeypatch):
    db = _db(tmp_path)
    try:
        account = db.create_account(name="fresh", kind="config_dir", config_dir="/tmp/profile")

        row, by_id = _account_body(client, account.id)
        for body in (row, by_id):
            assert body["runs_24h"] == 0
            assert body["failures_24h"] == 0
            assert body["cost_30d_usd"] == 0.0
            assert body["auth_failure_recent"] is False
            assert body["health"] == "untested"

        db.execute(
            "INSERT INTO task_runs (task_name, task_file, started_at, status, account_id, cost_usd)"
            " VALUES (?, ?, ?, ?, ?, ?)",
            ("task-a", "/tmp/task-a.task", _recent_iso(hours=1), "success", account.id, 0.42),
        )
        db.conn.commit()

        row, by_id = _account_body(client, account.id)
        for body in (row, by_id):
            assert body["runs_24h"] == 1
            assert body["failures_24h"] == 0
            assert body["cost_30d_usd"] == 0.42

        db.execute(
            "INSERT INTO task_runs (task_name, task_file, started_at, status, account_id, cost_usd)"
            " VALUES (?, ?, ?, ?, ?, ?)",
            ("task-b", "/tmp/task-b.task", _recent_iso(hours=2), "failed", account.id, 0.0),
        )
        db.conn.commit()

        row, by_id = _account_body(client, account.id)
        for body in (row, by_id):
            assert body["runs_24h"] == 2
            assert body["failures_24h"] == 1
            assert body["cost_30d_usd"] == 0.42

        import claude_scheduler.core.notify as notify
        cooldown_dir = tmp_path / "auth-alert-cooldown"
        monkeypatch.setattr(notify, "_AUTH_COOLDOWN_DIR", cooldown_dir)
        cooldown_dir.mkdir(parents=True, exist_ok=True)
        sentinel = cooldown_dir / account.id
        sentinel.touch()

        row, by_id = _account_body(client, account.id)
        for body in (row, by_id):
            assert body["auth_failure_recent"] is True
            assert body["health"] == "auth_failure"

        old = datetime.now(timezone.utc) - timedelta(hours=7)
        os.utime(sentinel, (old.timestamp(), old.timestamp()))

        row, by_id = _account_body(client, account.id)
        for body in (row, by_id):
            assert body["auth_failure_recent"] is False
            assert body["health"] == "untested"

        last_used = datetime.now(timezone.utc) - timedelta(days=35)
        db.execute(
            "UPDATE claude_accounts SET last_used_at=? WHERE id=?",
            (last_used.isoformat(), account.id),
        )
        db.conn.commit()

        row, by_id = _account_body(client, account.id)
        for body in (row, by_id):
            assert body["health"] == "idle"

        recent_used = datetime.now(timezone.utc) - timedelta(days=1)
        db.execute(
            "UPDATE claude_accounts SET last_used_at=? WHERE id=?",
            (recent_used.isoformat(), account.id),
        )
        db.conn.commit()

        row, by_id = _account_body(client, account.id)
        for body in (row, by_id):
            assert body["health"] == "active"
    finally:
        db.close()


def test_account_test_endpoint_success_and_failure(client, tmp_path, monkeypatch):
    db = _db(tmp_path)
    try:
        config_account = db.create_account(
            name="config", kind="config_dir", config_dir=str(tmp_path / "profile"),
        )
        api_account = db.create_account(
            name="api", kind="api_key", api_key_ref="keychain:test-service",
        )
    finally:
        db.close()

    import apps.scheduler.routes as routes
    import claude_scheduler.core.secrets as secrets

    monkeypatch.setattr(routes.shutil, "which", lambda _name: "/usr/bin/claude")

    def success_run(*args, **kwargs):
        return subprocess.CompletedProcess(
            args=args[0], returncode=0, stdout=b"{}", stderr=b"",
        )

    monkeypatch.setattr(routes.subprocess, "run", success_run)
    resp = client.post(f"/scheduler/api/accounts/{config_account.id}/test")
    assert resp.status_code == 200
    assert resp.json()["ok"] is True
    assert resp.json()["exit_code"] == 0

    def failure_run(*args, **kwargs):
        return subprocess.CompletedProcess(
            args=args[0], returncode=1, stdout=b"", stderr=b"401 Unauthorized",
        )

    monkeypatch.setattr(routes.subprocess, "run", failure_run)
    resp = client.post(f"/scheduler/api/accounts/{config_account.id}/test")
    body = resp.json()
    assert resp.status_code == 200
    assert body["ok"] is False
    assert body["exit_code"] == 1
    assert "Unauthorized" in body["stderr_tail"]

    monkeypatch.setattr(routes.shutil, "which", lambda _name: None)
    resp = client.post(f"/scheduler/api/accounts/{config_account.id}/test")
    assert resp.status_code == 200
    assert resp.json() == {
        "ok": False,
        "exit_code": None,
        "stderr_tail": "claude CLI not found in PATH",
        "took_ms": 0,
    }

    monkeypatch.setattr(routes.shutil, "which", lambda _name: "/usr/bin/claude")

    def raise_secret(_ref):
        raise secrets.SecretResolutionError("lookup failed")

    monkeypatch.setattr(secrets, "resolve_secret_ref", raise_secret)
    resp = client.post(f"/scheduler/api/accounts/{api_account.id}/test")
    body = resp.json()
    assert resp.status_code == 200
    assert body["ok"] is False
    assert body["exit_code"] is None
    assert body["stderr_tail"].startswith("secret resolution failed:")
