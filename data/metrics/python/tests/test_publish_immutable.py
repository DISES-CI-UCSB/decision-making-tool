from __future__ import annotations

import hashlib
import io
import json
import urllib.error
from argparse import Namespace

import publish
import pytest


class _Response:
    def __init__(self, content: bytes):
        self._content = io.BytesIO(content)

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self, size: int) -> bytes:
        return self._content.read(size)


def test_remote_checksum_distinguishes_absent_and_existing_content(monkeypatch):
    content = b"immutable"
    monkeypatch.setattr(
        publish.urllib.request,
        "urlopen",
        lambda *_args, **_kwargs: _Response(content),
    )
    assert publish._remote_sha256("https://example.test/artifact") == hashlib.sha256(
        content
    ).hexdigest()

    def missing(*_args, **_kwargs):
        raise urllib.error.HTTPError(
            "https://example.test/missing",
            404,
            "not found",
            {},
            None,
        )

    monkeypatch.setattr(publish.urllib.request, "urlopen", missing)
    assert publish._remote_sha256("https://example.test/missing") is None


def test_blob_put_never_uses_force(monkeypatch, tmp_path):
    observed = {}

    def run(command, **_kwargs):
        observed["command"] = command
        return type(
            "Completed",
            (),
            {
                "returncode": 0,
                "stdout": "https://example.test/artifact\n",
                "stderr": "",
            },
        )()

    monkeypatch.setattr(publish.subprocess, "run", run)
    artifact = tmp_path / "artifact.json"
    artifact.write_text("{}", encoding="utf-8")

    publish._put_blob("secret-token", artifact, "releases/test/artifact.json")

    assert "--force" not in observed["command"]


def test_publish_rejects_legacy_goals_path_entries(tmp_path):
    report_path = tmp_path / "goals-publish-report.json"
    report_path.write_text(
        json.dumps(
            {
                "entries": [
                    {
                        "solutionId": "demo",
                        "goalsPath": "cache/demo.goals.json",
                        "expectedBlobPath": "metrics/goals/demo.goals.json",
                    }
                ]
            }
        ),
        encoding="utf-8",
    )

    with pytest.raises(RuntimeError, match="canonical cachePath"):
        publish._load_report_entries(report_path)


def _dry_run_report(tmp_path, *, declared_sha256: str):
    artifact = tmp_path / "artifact.json"
    artifact.write_bytes(b"local-content")
    report = {
        "format": "solution-release-publish-report-v1",
        "complete": True,
        "artifactCount": 1,
        "failures": [],
        "entries": [
            {
                "solutionId": "demo",
                "cachePath": str(artifact),
                "expectedBlobPath": "releases/test/artifact.json",
                "expectedPublicUrl": "https://example.test/artifact.json",
                "artifactSha256": declared_sha256,
            }
        ],
    }
    (tmp_path / "publish-report.json").write_text(
        json.dumps(report),
        encoding="utf-8",
    )
    return artifact


def _patch_dry_run(monkeypatch, tmp_path):
    monkeypatch.setattr(
        publish,
        "_parse_args",
        lambda _argv: Namespace(
            output_dir=tmp_path,
            solution_id=None,
            dry_run=True,
            skip_inspect=False,
        ),
    )
    monkeypatch.setattr(publish, "find_repo_root", lambda: tmp_path)


def test_dry_run_rejects_declared_local_checksum_mismatch(monkeypatch, tmp_path):
    _dry_run_report(tmp_path, declared_sha256="0" * 64)
    _patch_dry_run(monkeypatch, tmp_path)
    remote_calls = []
    monkeypatch.setattr(
        publish,
        "_remote_sha256",
        lambda url: remote_calls.append(url),
    )

    assert publish.main([]) == 1
    assert remote_calls == []


def test_dry_run_rejects_remote_conflict_without_put(monkeypatch, tmp_path):
    artifact = _dry_run_report(
        tmp_path,
        declared_sha256=hashlib.sha256(b"local-content").hexdigest(),
    )
    _patch_dry_run(monkeypatch, tmp_path)
    monkeypatch.setattr(publish, "_remote_sha256", lambda _url: "f" * 64)
    put_calls = []
    monkeypatch.setattr(
        publish,
        "_put_blob",
        lambda *_args: put_calls.append(artifact),
    )

    assert publish.main([]) == 1
    assert put_calls == []


def test_dry_run_validates_absent_remote_without_put(monkeypatch, tmp_path):
    artifact = _dry_run_report(
        tmp_path,
        declared_sha256=hashlib.sha256(b"local-content").hexdigest(),
    )
    _patch_dry_run(monkeypatch, tmp_path)
    monkeypatch.setattr(publish, "_remote_sha256", lambda _url: None)
    put_calls = []
    monkeypatch.setattr(
        publish,
        "_put_blob",
        lambda *_args: put_calls.append(artifact),
    )

    assert publish.main([]) == 0
    assert put_calls == []
