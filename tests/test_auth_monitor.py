"""Tests for auth-failure detection + alert in core/notify.py."""
from unittest.mock import patch

import pytest

from claude_scheduler.core.notify import (
    _AUTH_COOLDOWN_SECONDS,
    _auth_failure_pattern,
    notify_auth_failure,
)


class _Acct:
    def __init__(
        self,
        id="acc-1",
        name="personal-pro",
        kind="config_dir",
        config_dir="/tmp/profile-1",
    ):
        self.id = id
        self.name = name
        self.kind = kind
        self.config_dir = config_dir


@pytest.fixture
def isolate_cooldown(tmp_path, monkeypatch):
    monkeypatch.setattr(
        "claude_scheduler.core.notify._AUTH_COOLDOWN_DIR",
        tmp_path / "cooldown",
    )
    yield tmp_path / "cooldown"


@pytest.mark.parametrize("stderr", [
    "Authentication failed: please run /login",
    "Error: please run `claude /login` to authenticate",
    "OAuth token expired",
    "OAuth token invalid",
    "credentials expired",
    "credentials missing",
    "401 Unauthorized",
    "Unauthorized",
    "You are not logged in",
    "Authentication required",
])
def test_pattern_matches_known_auth_errors(stderr):
    assert _auth_failure_pattern(stderr) is True


@pytest.mark.parametrize("stderr", [
    "",
    "Network unreachable",
    "Rate limit exceeded",
    "Tool execution failed: Bash",
    "Connection refused",
    "Some random failure",
])
def test_pattern_ignores_non_auth_errors(stderr):
    assert _auth_failure_pattern(stderr) is False


def test_notify_emits_alert_for_config_dir(isolate_cooldown):
    acct = _Acct()
    with patch("claude_scheduler.core.notify._send_desktop") as desktop, \
         patch("claude_scheduler.core.notify._send_telegram") as tg, \
         patch("claude_scheduler.core.notify._log_notification") as log:
        emitted = notify_auth_failure(acct, db=None)
    assert emitted is True
    desktop.assert_called_once()
    tg.assert_called_once()
    args, _ = tg.call_args
    assert "CLAUDE_CONFIG_DIR=/tmp/profile-1 claude /login" in args[0]
    log.assert_called_once()


def test_notify_dedupes_within_cooldown(isolate_cooldown):
    acct = _Acct()
    with patch("claude_scheduler.core.notify._send_telegram") as tg:
        assert notify_auth_failure(acct, db=None) is True
        assert notify_auth_failure(acct, db=None) is False
    tg.assert_called_once()
    sentinel = isolate_cooldown / acct.id
    assert sentinel.exists()
    assert (_AUTH_COOLDOWN_SECONDS > 0)


def test_notify_skipped_for_non_config_dir(isolate_cooldown):
    acct = _Acct(kind="api_key", config_dir="")
    with patch("claude_scheduler.core.notify._send_telegram") as tg:
        emitted = notify_auth_failure(acct, db=None)
    assert emitted is False
    tg.assert_not_called()

