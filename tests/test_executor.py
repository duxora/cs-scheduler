"""tests/test_executor.py"""
import unittest
import tempfile
from pathlib import Path
from unittest.mock import patch, MagicMock
from claude_scheduler.core import executor as executor_mod
from claude_scheduler.core.executor import execute_task, build_claude_command
from claude_scheduler.core.parser import parse_task

FIXTURES = Path(__file__).parent / "fixtures"

class TestBuildCommand(unittest.TestCase):
    def test_builds_basic_command(self):
        task = parse_task(FIXTURES / "valid.task")
        cmd = build_claude_command(task)
        self.assertEqual(Path(cmd[0]).name, "claude")
        self.assertIn("-p", cmd)
        self.assertIn("--allowedTools", cmd)
        self.assertIn("Read,Grep", cmd)
        self.assertIn("--max-turns", cmd)
        self.assertIn("3", cmd)
        self.assertIn("--output-format", cmd)
        self.assertIn("json", cmd)

    def test_uses_defaults_for_minimal(self):
        task = parse_task(FIXTURES / "minimal.task")
        cmd = build_claude_command(task)
        self.assertIn("Read,Grep,Glob", cmd)
        self.assertIn("10", cmd)  # default max_turns

class TestExecuteTask(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        lock_dir = Path(self.tmp.name) / "locks"
        profile_lock_dir = Path(self.tmp.name) / "profile-locks"
        self.p1 = patch.object(executor_mod, "LOCK_DIR", lock_dir)
        self.p2 = patch.object(executor_mod, "PROFILE_LOCK_DIR", profile_lock_dir)
        self.p1.start()
        self.p2.start()
        self.addCleanup(self.p1.stop)
        self.addCleanup(self.p2.stop)

    @patch("claude_scheduler.core.executor.subprocess.run")
    def test_successful_execution(self, mock_run):
        mock_run.return_value = MagicMock(
            returncode=0, stdout=b'{"result":"ok"}', stderr=b"")
        task = parse_task(FIXTURES / "valid.task")
        with tempfile.TemporaryDirectory() as tmp:
            result = execute_task(task, logs_dir=Path(tmp))
        self.assertEqual(result["status"], "success")
        self.assertEqual(result["exit_code"], 0)

    @patch("claude_scheduler.core.executor.subprocess.run")
    def test_failed_execution(self, mock_run):
        mock_run.return_value = MagicMock(
            returncode=1, stdout=b"", stderr=b"error occurred")
        task = parse_task(FIXTURES / "valid.task")
        with tempfile.TemporaryDirectory() as tmp:
            result = execute_task(task, logs_dir=Path(tmp))
        self.assertEqual(result["status"], "failed")
        self.assertIn("error occurred", result["stderr"])

    @patch("claude_scheduler.core.executor.subprocess.run")
    def test_timeout_execution(self, mock_run):
        import subprocess
        mock_run.side_effect = subprocess.TimeoutExpired(cmd="claude", timeout=120)
        task = parse_task(FIXTURES / "valid.task")
        with tempfile.TemporaryDirectory() as tmp:
            result = execute_task(task, logs_dir=Path(tmp))
        self.assertEqual(result["status"], "timeout")

if __name__ == "__main__":
    unittest.main()
