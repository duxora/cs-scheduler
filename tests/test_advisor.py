import json
import tempfile
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from claude_scheduler.core.db import Database
from claude_scheduler.core.executor import execute_task
from claude_scheduler.core.models import Task
from claude_scheduler.core.orchestrator import Orchestrator


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
    file_path = kw.pop("file_path", Path("/tmp/advisor.task"))
    return Task(
        name="advisor task",
        schedule="daily 09:00",
        prompt="How should we handle this?",
        file_path=file_path,
        kind="advisor",
        **kw,
    )


def test_advisor_wraps_prompt_and_forces_opus_for_default_model(tmp_path, monkeypatch):
    captured = {}
    inner = json.dumps(
        {
            "summary": "summary",
            "options": [{"name": "a", "rationale": "r", "tradeoffs": "t"}],
            "recommendation": "a",
            "next_steps": ["one", "two", "three"],
        }
    )
    outer = json.dumps({"result": inner, "session_id": "s", "input_tokens": 1, "output_tokens": 2, "cost_usd": 0.5})

    def fake_run(cmd, **kwargs):
        captured["cmd"] = cmd
        return MagicMock(returncode=0, stdout=outer.encode(), stderr=b"")

    monkeypatch.setattr("claude_scheduler.core.executor.subprocess.run", fake_run)
    result = execute_task(_task(), tmp_path)

    cmd = captured["cmd"]
    assert cmd[cmd.index("-p") + 1].startswith("You are an advisor.")
    assert cmd[cmd.index("--model") + 1] == "opus"
    assert result["status"] == "success"
    assert json.loads(result["structured_output"])["summary"] == "summary"


def test_advisor_preserves_explicit_model(tmp_path, monkeypatch):
    captured = {}
    outer = json.dumps({"result": json.dumps({"summary": "s", "options": [], "recommendation": "r", "next_steps": []})})

    def fake_run(cmd, **kwargs):
        captured["cmd"] = cmd
        return MagicMock(returncode=0, stdout=outer.encode(), stderr=b"")

    monkeypatch.setattr("claude_scheduler.core.executor.subprocess.run", fake_run)
    result = execute_task(_task(model="gpt-4.1"), tmp_path)

    assert captured["cmd"][captured["cmd"].index("--model") + 1] == "gpt-4.1"
    assert result["status"] == "success"


def test_advisor_non_json_response_becomes_empty(tmp_path, monkeypatch):
    def fake_run(cmd, **kwargs):
        return MagicMock(returncode=0, stdout=json.dumps({"result": "not json"}).encode(), stderr=b"")

    monkeypatch.setattr("claude_scheduler.core.executor.subprocess.run", fake_run)
    result = execute_task(_task(), tmp_path)

    assert result["status"] == "success"
    assert result["structured_output"] == ""


def test_advisor_structured_output_is_persisted(db, tmp_path, monkeypatch):
    task = _task(file_path=tmp_path / "advisor.task")
    structured_output = json.dumps({"summary": "s", "options": [], "recommendation": "r", "next_steps": []})

    monkeypatch.setattr("claude_scheduler.core.orchestrator.run_with_retry", lambda *args, **kwargs: {
        "status": "success",
        "exit_code": 0,
        "attempt": 1,
        "log_file": "/tmp/log",
        "stderr": "",
        "stdout": "",
        "structured_output": structured_output,
    })
    monkeypatch.setattr("claude_scheduler.core.orchestrator.notify_error", lambda *a, **kw: None)
    monkeypatch.setattr("claude_scheduler.core.orchestrator.notify_success", lambda *a, **kw: None)

    orch = Orchestrator(tmp_path, tmp_path / "logs", db)
    orch.run_single(task)

    row = db.execute("SELECT structured_output FROM task_runs ORDER BY id DESC LIMIT 1").fetchone()
    assert row["structured_output"] == structured_output
