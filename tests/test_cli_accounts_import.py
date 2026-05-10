"""Tests for cs accounts import CLI command."""
import argparse
import tempfile
from pathlib import Path

import pytest

from claude_scheduler import cli
from claude_scheduler.core.db import Database


@pytest.fixture
def db_path():
    tmp = tempfile.mkdtemp()
    yield Path(tmp) / "t.db"


def _db(path):
    return Database(path)


def _args(**kwargs):
    return argparse.Namespace(**kwargs)


def test_accounts_import_happy_path(db_path, monkeypatch, tmp_path, capsys):
    monkeypatch.setattr(cli, "get_db", lambda: _db(db_path))
    monkeypatch.setattr(cli, "_has_claude_credentials", lambda _path: True)

    config_dir = tmp_path / "profile"
    config_dir.mkdir()

    cli.cmd_accounts_import(_args(
        name="foo",
        config_dir=str(config_dir),
        plan_tier="max",
        default=True,
        skip_credentials_check=False,
    ))

    out = capsys.readouterr().out
    assert "id=" in out
    assert "name=foo" in out

    db = _db(db_path)
    acct = db.get_account_by_name("foo")
    db.close()
    assert acct is not None
    assert acct.kind == "config_dir"
    assert acct.config_dir == str(config_dir.resolve())
    assert acct.plan_tier == "max"
    assert acct.is_default is True


def test_accounts_import_missing_dir_exits(db_path, monkeypatch):
    monkeypatch.setattr(cli, "get_db", lambda: _db(db_path))
    monkeypatch.setattr(cli, "_has_claude_credentials", lambda _path: True)

    with pytest.raises(SystemExit) as exc:
        cli.cmd_accounts_import(_args(
            name="foo",
            config_dir="/does/not/exist",
            plan_tier=None,
            default=False,
            skip_credentials_check=False,
        ))

    assert exc.value.code == 1
    db = _db(db_path)
    assert db.get_account_by_name("foo") is None
    db.close()


def test_accounts_import_no_credentials_check_bypass_writes_row(db_path, monkeypatch, tmp_path):
    monkeypatch.setattr(cli, "get_db", lambda: _db(db_path))
    monkeypatch.setattr(cli, "_has_claude_credentials", lambda _path: False)

    config_dir = tmp_path / "profile"
    config_dir.mkdir()

    cli.cmd_accounts_import(_args(
        name="foo",
        config_dir=str(config_dir),
        plan_tier=None,
        default=False,
        skip_credentials_check=True,
    ))

    db = _db(db_path)
    acct = db.get_account_by_name("foo")
    db.close()
    assert acct is not None
    assert acct.config_dir == str(config_dir.resolve())
