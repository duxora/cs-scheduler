"""Tests for cs accounts CLI commands."""
import argparse
import tempfile
from pathlib import Path
from types import SimpleNamespace

import pytest

from claude_scheduler import cli
from claude_scheduler.core.db import Database


@pytest.fixture
def db():
    tmp = tempfile.mkdtemp()
    d = Database(Path(tmp) / "t.db")
    yield d
    d.close()


def _args(**kwargs):
    return argparse.Namespace(**kwargs)


def test_accounts_list_empty_prints_hint(db, monkeypatch, capsys):
    monkeypatch.setattr(cli, "get_db", lambda: db)
    cli.cmd_accounts_list(_args())
    out = capsys.readouterr().out
    assert "No accounts configured. Try: cs accounts add <name>" in out


def test_accounts_add_config_dir_no_login(db, monkeypatch, tmp_path):
    monkeypatch.setattr(cli, "get_db", lambda: db)
    config_dir = tmp_path / "profile"

    cli.cmd_accounts_add(_args(
        name="foo",
        kind="config_dir",
        config_dir=str(config_dir),
        plan_tier="max",
        default=False,
        no_login=True,
        api_key_ref=None,
    ))

    acct = db.get_account_by_name("foo")
    assert acct is not None
    assert acct.kind == "config_dir"
    assert acct.config_dir == str(config_dir)
    assert acct.plan_tier == "max"
    assert acct.is_default is False


def test_accounts_add_config_dir_login_creates_account(db, monkeypatch, tmp_path):
    monkeypatch.setattr(cli, "get_db", lambda: db)
    config_dir = tmp_path / "profile"

    import subprocess

    def fake_run(cmd, env=None, check=False):
        cred = Path(env["CLAUDE_CONFIG_DIR"]) / ".credentials.json"
        cred.write_text("{}")
        return SimpleNamespace(returncode=0)

    monkeypatch.setattr(subprocess, "run", fake_run)

    cli.cmd_accounts_add(_args(
        name="foo",
        kind="config_dir",
        config_dir=str(config_dir),
        plan_tier="pro",
        default=False,
        no_login=False,
        api_key_ref=None,
    ))

    acct = db.get_account_by_name("foo")
    assert acct is not None
    assert acct.config_dir == str(config_dir)
    assert (config_dir / ".credentials.json").exists()


def test_accounts_add_config_dir_login_missing_credentials_exits(db, monkeypatch, tmp_path):
    monkeypatch.setattr(cli, "get_db", lambda: db)
    config_dir = tmp_path / "profile"

    import subprocess

    def fake_run(cmd, env=None, check=False):
        return SimpleNamespace(returncode=0)

    monkeypatch.setattr(subprocess, "run", fake_run)

    with pytest.raises(SystemExit) as exc:
        cli.cmd_accounts_add(_args(
            name="foo",
            kind="config_dir",
            config_dir=str(config_dir),
            plan_tier=None,
            default=False,
            no_login=False,
            api_key_ref=None,
        ))

    assert exc.value.code == 1
    assert db.get_account_by_name("foo") is None


def test_accounts_add_api_key_valid(db, monkeypatch):
    monkeypatch.setattr(cli, "get_db", lambda: db)

    cli.cmd_accounts_add(_args(
        name="foo",
        kind="api_key",
        config_dir=None,
        plan_tier=None,
        default=False,
        no_login=False,
        api_key_ref="keychain:foo",
    ))

    acct = db.get_account_by_name("foo")
    assert acct is not None
    assert acct.kind == "api_key"
    assert acct.api_key_ref == "keychain:foo"
    assert acct.plan_tier == "api"


def test_accounts_add_api_key_invalid_ref_exits(db, monkeypatch):
    monkeypatch.setattr(cli, "get_db", lambda: db)

    with pytest.raises(SystemExit) as exc:
        cli.cmd_accounts_add(_args(
            name="foo",
            kind="api_key",
            config_dir=None,
            plan_tier=None,
            default=False,
            no_login=False,
            api_key_ref="invalid_value",
        ))

    assert exc.value.code == 1
    assert db.get_account_by_name("foo") is None


def test_accounts_add_duplicate_name_exits(db, monkeypatch, tmp_path):
    monkeypatch.setattr(cli, "get_db", lambda: db)
    config_dir = tmp_path / "profile"

    cli.cmd_accounts_add(_args(
        name="foo",
        kind="config_dir",
        config_dir=str(config_dir),
        plan_tier=None,
        default=False,
        no_login=True,
        api_key_ref=None,
    ))

    with pytest.raises(SystemExit) as exc:
        cli.cmd_accounts_add(_args(
            name="foo",
            kind="config_dir",
            config_dir=str(config_dir),
            plan_tier=None,
            default=False,
            no_login=True,
            api_key_ref=None,
        ))

    assert exc.value.code == 1
    assert db.list_accounts()[0].name == "foo"


def test_accounts_remove_force_deletes_row(db, monkeypatch, tmp_path):
    monkeypatch.setattr(cli, "get_db", lambda: db)
    config_dir = tmp_path / "profile"
    db.create_account("foo", "config_dir", config_dir=str(config_dir))

    cli.cmd_accounts_remove(_args(name="foo", force=True))

    assert db.get_account_by_name("foo") is None


def test_accounts_set_default_flips_is_default(db, monkeypatch):
    monkeypatch.setattr(cli, "get_db", lambda: db)
    db.create_account("foo", "config_dir", config_dir="/tmp/foo")

    cli.cmd_accounts_set_default(_args(name="foo"))

    acct = db.get_account_by_name("foo")
    assert acct is not None
    assert acct.is_default is True
