"""Phase 4 — runtime account injection tests."""
import os
import tempfile
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from claude_scheduler.core.db import Database
from claude_scheduler.core.executor import execute_task, _profile_lock_key
from claude_scheduler.core.models import Task
from claude_scheduler.core.parser import parse_task
from claude_scheduler.core.orchestrator import Orchestrator


@pytest.fixture
def db():
    tmp = tempfile.mkdtemp()
    d = Database(Path(tmp) / "t.db")
    yield d
    d.close()


@pytest.fixture(autouse=True)
def lock_dirs(tmp_path, monkeypatch):
    monkeypatch.setattr("claude_scheduler.core.executor.LOCK_DIR", tmp_path / "locks")
    monkeypatch.setattr("claude_scheduler.core.executor.PROFILE_LOCK_DIR", tmp_path / "profile-locks")


def _mk_task(**kw):
    return Task(name="t", schedule="daily 09:00", prompt="hi",
                file_path=Path("/tmp/x.task"), **kw)


def test_no_account_passes_through(tmp_path, db, monkeypatch):
    """When task.account is empty, executor doesn't touch env."""
    captured = {}

    def fake_run(cmd, **kwargs):
        captured["env"] = kwargs.get("env")
        return MagicMock(
            returncode=0,
            stdout=b'{"session_id":"s","input_tokens":1,"output_tokens":1,"cost_usd":0.0}',
            stderr=b"",
        )

    monkeypatch.setattr("claude_scheduler.core.executor.subprocess.run", fake_run)
    res = execute_task(_mk_task(), tmp_path, db=db)
    assert res["status"] == "success"
    assert captured["env"] is None or "CLAUDE_CONFIG_DIR" not in captured["env"] or os.environ.get("CLAUDE_CONFIG_DIR") == captured["env"].get("CLAUDE_CONFIG_DIR")


def test_parser_preserves_account_field(tmp_path):
    task_file = tmp_path / "with-account.task"
    task_file.write_text("# name: Account Task\n# schedule: daily 09:00\n# account: personal-pro\n---\nPrompt.\n")
    task = parse_task(task_file)
    assert task.account == "personal-pro"


def test_config_dir_account_sets_env(tmp_path, db, monkeypatch):
    a = db.create_account(name="pers", kind="config_dir", config_dir="/tmp/profile-pers")
    captured = {}

    def fake_run(cmd, **kwargs):
        captured["env"] = kwargs.get("env")
        return MagicMock(
            returncode=0,
            stdout=b'{"session_id":"s","input_tokens":0,"output_tokens":0,"cost_usd":0.0}',
            stderr=b"",
        )

    monkeypatch.setattr("claude_scheduler.core.executor.subprocess.run", fake_run)
    res = execute_task(_mk_task(account="pers"), tmp_path, db=db)
    assert res["status"] == "success"
    env = captured["env"]
    assert env is not None
    assert env["CLAUDE_CONFIG_DIR"] == "/tmp/profile-pers"
    assert "ANTHROPIC_API_KEY" not in env
    assert res.get("account_id") == a.id
    refreshed = db.get_account(a.id)
    assert refreshed.last_used_at


def test_api_key_account_sets_env(tmp_path, db, monkeypatch):
    db.create_account(name="api", kind="api_key", api_key_ref="keychain:test")
    captured = {}

    def fake_run(cmd, **kwargs):
        captured["env"] = kwargs.get("env")
        return MagicMock(
            returncode=0,
            stdout=b'{"session_id":"s","input_tokens":0,"output_tokens":0,"cost_usd":0.0}',
            stderr=b"",
        )

    monkeypatch.setattr("claude_scheduler.core.executor.subprocess.run", fake_run)
    monkeypatch.setattr("claude_scheduler.core.executor.resolve_secret_ref",
                        lambda ref: "sk-fake-key")
    res = execute_task(_mk_task(account="api"), tmp_path, db=db)
    assert res["status"] == "success"
    env = captured["env"]
    assert env["ANTHROPIC_API_KEY"] == "sk-fake-key"
    assert "CLAUDE_CONFIG_DIR" not in env


def test_unknown_account_fails(tmp_path, db, monkeypatch):
    monkeypatch.setattr("claude_scheduler.core.executor.subprocess.run",
                        lambda *a, **kw: pytest.fail("subprocess should not run"))
    res = execute_task(_mk_task(account="ghost"), tmp_path, db=db)
    assert res["status"] == "failed"
    assert "ghost" in (res.get("error_message") or "")


def test_secret_resolution_failure_fails(tmp_path, db, monkeypatch):
    db.create_account(name="api", kind="api_key", api_key_ref="keychain:missing")
    from claude_scheduler.core.secrets import SecretResolutionError

    def boom(_):
        raise SecretResolutionError("keychain miss")

    monkeypatch.setattr("claude_scheduler.core.executor.resolve_secret_ref", boom)
    monkeypatch.setattr("claude_scheduler.core.executor.subprocess.run",
                        lambda *a, **kw: pytest.fail("subprocess should not run"))
    res = execute_task(_mk_task(account="api"), tmp_path, db=db)
    assert res["status"] == "failed"
    assert "keychain miss" in (res.get("error_message") or "")


def test_profile_lock_key_only_for_config_dir(db):
    a1 = db.create_account(name="cd", kind="config_dir", config_dir="/tmp/p")
    a2 = db.create_account(name="ak", kind="api_key", api_key_ref="keychain:x")
    assert _profile_lock_key(a1) is not None
    assert _profile_lock_key(a2) is None


def test_run_record_has_account_id(tmp_path, db):
    """End-to-end via orchestrator-style flow — start_run writes account_id."""
    a = db.create_account(name="pers", kind="config_dir", config_dir="/tmp/x")
    run_id = db.start_run("t", "/tmp/x.task", "/tmp/x.log", account_id=a.id)
    row = db.execute("SELECT account_id FROM task_runs WHERE id=?", (run_id,)).fetchone()
    assert row["account_id"] == a.id


def test_orchestrator_persists_account_id(tmp_path, db, monkeypatch):
    a = db.create_account(name="pers", kind="config_dir", config_dir="/tmp/profile")
    task = _mk_task(account="pers")

    monkeypatch.setattr("claude_scheduler.core.orchestrator.run_with_retry", lambda *args, **kwargs: {
        "status": "success",
        "exit_code": 0,
        "attempt": 1,
        "log_file": "/tmp/log",
        "stderr": "",
        "stdout": "",
        "account_id": a.id,
    })
    monkeypatch.setattr("claude_scheduler.core.orchestrator.notify_error", lambda *a, **kw: None)
    monkeypatch.setattr("claude_scheduler.core.orchestrator.notify_success", lambda *a, **kw: None)

    orch = Orchestrator(tmp_path, tmp_path / "logs", db)
    orch.run_single(task)
    row = db.execute("SELECT account_id FROM task_runs ORDER BY id DESC LIMIT 1").fetchone()
    assert row["account_id"] == a.id
