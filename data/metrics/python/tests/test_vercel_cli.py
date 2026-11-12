from __future__ import annotations

import pytest

import vercel_cli
from vercel_cli import (
    VERCEL_CLI_MISSING_MESSAGE,
    VercelCliNotFoundError,
    require_vercel_cli,
    run_vercel,
)

RESOLVED_PATH = "/resolved/bin/vercel"


def _which_finding_vercel(name: str) -> str | None:
    return RESOLVED_PATH if name == "vercel" else None


def test_preflight_returns_the_resolved_vercel_path(monkeypatch):
    monkeypatch.setattr(vercel_cli.shutil, "which", _which_finding_vercel)

    assert require_vercel_cli() == RESOLVED_PATH


def test_preflight_explains_how_to_install_a_missing_vercel_cli(monkeypatch):
    monkeypatch.setattr(vercel_cli.shutil, "which", lambda _name: None)

    with pytest.raises(VercelCliNotFoundError) as raised:
        require_vercel_cli()

    assert str(raised.value) == VERCEL_CLI_MISSING_MESSAGE
    assert "npm i -g vercel" in str(raised.value)
    assert isinstance(raised.value, FileNotFoundError)


def test_run_launches_the_resolved_path_without_a_shell(monkeypatch):
    observed = {}

    def fake_run(command, **kwargs):
        observed["command"] = command
        observed["kwargs"] = kwargs
        return "completed"

    monkeypatch.setattr(vercel_cli.shutil, "which", _which_finding_vercel)
    monkeypatch.setattr(vercel_cli.subprocess, "run", fake_run)

    result = run_vercel(["blob", "put", "file.json"], check=False, text=True)

    assert result == "completed"
    assert observed["command"] == [RESOLVED_PATH, "blob", "put", "file.json"]
    assert observed["kwargs"] == {"check": False, "text": True}


def test_run_reports_a_missing_vercel_cli_with_the_install_hint(monkeypatch):
    def missing_program(command, **_kwargs):
        raise FileNotFoundError(2, "No such file or directory", command[0])

    monkeypatch.setattr(vercel_cli.shutil, "which", lambda _name: None)
    monkeypatch.setattr(vercel_cli.subprocess, "run", missing_program)

    with pytest.raises(VercelCliNotFoundError, match="npm i -g vercel"):
        run_vercel(["blob", "list"])
