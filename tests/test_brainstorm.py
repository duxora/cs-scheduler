import json
import tempfile
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from claude_scheduler.core.executor import execute_task
from claude_scheduler.core.models import Task


@pytest.fixture(autouse=True)
def lock_dirs(tmp_path, monkeypatch):
    monkeypatch.setattr("claude_scheduler.core.executor.LOCK_DIR", tmp_path / "locks")
    monkeypatch.setattr("claude_scheduler.core.executor.PROFILE_LOCK_DIR", tmp_path / "profile-locks")


def _task(file_path, **kw):
    return Task(
        name="brainstorm task",
        schedule="daily 09:00",
        prompt="Ship the feature.",
        file_path=file_path,
        kind="brainstorm",
        **kw,
    )


def _run_success(monkeypatch, inner_payload):
    outer = json.dumps({"result": json.dumps(inner_payload), "session_id": "s"})

    def fake_run(cmd, **kwargs):
        return MagicMock(returncode=0, stdout=outer.encode(), stderr=b"")

    monkeypatch.setattr("claude_scheduler.core.executor.subprocess.run", fake_run)


def test_brainstorm_fans_out_three_children(tmp_path, monkeypatch):
    parent = tmp_path / "brainstorm.task"
    actions = [
        {"name": "discover", "prompt": "First prompt", "tools": "Read"},
        {"name": "design", "prompt": "Second prompt", "tools": "Read,Bash"},
        {"name": "ship", "prompt": "Third prompt", "tools": ""},
    ]
    _run_success(monkeypatch, {"summary": "plan", "actions": actions})

    result = execute_task(_task(parent), tmp_path)

    assert result["status"] == "success"
    assert "fanout_warning" not in result

    for idx, action in enumerate(actions, start=1):
        child = tmp_path / f"brainstorm-action-{idx}.task"
        assert child.exists()
        text = child.read_text()
        assert "# schedule: manual" in text
        assert "# kind: default" in text
        assert "# enabled: true" in text
        assert "# model: opus" in text
        assert f"# tools: {action['tools'] or 'Read,Grep,Glob'}" in text
        assert text.split("---", 1)[1].strip() == action["prompt"]


def test_brainstorm_idempotent_rerun_does_not_overwrite_existing_children(tmp_path, monkeypatch):
    parent = tmp_path / "brainstorm.task"
    actions = [
        {"name": "discover", "prompt": "First prompt", "tools": "Read"},
        {"name": "design", "prompt": "Second prompt", "tools": "Read,Bash"},
        {"name": "ship", "prompt": "Third prompt", "tools": "Read"},
    ]
    _run_success(monkeypatch, {"summary": "plan", "actions": actions})

    execute_task(_task(parent), tmp_path)
    child = tmp_path / "brainstorm-action-1.task"
    child.write_text("sentinel")

    execute_task(_task(parent), tmp_path)
    assert child.read_text() == "sentinel"


def test_brainstorm_malformed_actions_sets_warning(tmp_path, monkeypatch):
    parent = tmp_path / "brainstorm.task"
    _run_success(monkeypatch, {"summary": "plan", "actions": [{"name": "only-one", "prompt": "x"}]})

    result = execute_task(_task(parent), tmp_path)

    assert result["status"] == "success"
    assert result["fanout_warning"]
    assert not list(tmp_path.glob("brainstorm-action-*.task"))
