import json
import tempfile
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from claude_scheduler.core.db import Database
from claude_scheduler.core.executor import execute_task
from claude_scheduler.core.models import Task


@pytest.fixture
def db():
    tmp = tempfile.mkdtemp()
    database = Database(Path(tmp) / "t.db")
    yield database
    database.close()


@pytest.fixture(autouse=True)
def lock_dirs(tmp_path, monkeypatch):
    monkeypatch.setattr("claude_scheduler.core.executor.LOCK_DIR", tmp_path / "locks")
    monkeypatch.setattr("claude_scheduler.core.executor.PROFILE_LOCK_DIR", tmp_path / "profile-locks")


def _task(**kw):
    return Task(
        name="fallback task",
        schedule="daily 09:00",
        prompt="Fallback please.",
        file_path=Path("/tmp/fallback.task"),
        **kw,
    )


def test_advisor_uses_default_account_when_present(tmp_path, db, monkeypatch):
    account = db.create_account(name="pers", kind="config_dir", config_dir="/tmp/profile", is_default=True)
    captured = {}
    outer = json.dumps({"result": json.dumps({"summary": "s", "options": [], "recommendation": "r", "next_steps": []})})

    def fake_run(cmd, **kwargs):
        captured["env"] = kwargs.get("env")
        return MagicMock(returncode=0, stdout=outer.encode(), stderr=b"")

    monkeypatch.setattr("claude_scheduler.core.executor.subprocess.run", fake_run)
    result = execute_task(_task(kind="advisor"), tmp_path, db=db)

    assert result["status"] == "success"
    assert result["account_id"] == account.id
    assert captured["env"]["CLAUDE_CONFIG_DIR"] == "/tmp/profile"


def test_default_kind_does_not_fallback(tmp_path, db, monkeypatch):
    db.create_account(name="pers", kind="config_dir", config_dir="/tmp/profile", is_default=True)
    captured = {}
    outer = json.dumps({"result": json.dumps({"summary": "s", "options": [], "recommendation": "r", "next_steps": []})})

    def fake_run(cmd, **kwargs):
        captured["env"] = kwargs.get("env")
        return MagicMock(returncode=0, stdout=outer.encode(), stderr=b"")

    monkeypatch.setattr("claude_scheduler.core.executor.subprocess.run", fake_run)
    result = execute_task(_task(), tmp_path, db=db)

    assert result["status"] == "success"
    assert "account_id" not in result
    assert captured["env"] is None or "CLAUDE_CONFIG_DIR" not in captured["env"]


def test_advisor_without_default_is_noop(tmp_path, db, monkeypatch):
    captured = {}
    outer = json.dumps({"result": json.dumps({"summary": "s", "options": [], "recommendation": "r", "next_steps": []})})

    def fake_run(cmd, **kwargs):
        captured["env"] = kwargs.get("env")
        return MagicMock(returncode=0, stdout=outer.encode(), stderr=b"")

    monkeypatch.setattr("claude_scheduler.core.executor.subprocess.run", fake_run)
    result = execute_task(_task(kind="advisor"), tmp_path, db=db)

    assert result["status"] == "success"
    assert "account_id" not in result
    assert captured["env"] is None or "CLAUDE_CONFIG_DIR" not in captured["env"]
