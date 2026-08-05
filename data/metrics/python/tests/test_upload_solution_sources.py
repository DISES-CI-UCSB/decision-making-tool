from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest

from upload_solution_sources import (
    REPORT_FORMAT,
    SourceUploadError,
    TransientUploadError,
    run_upload,
)


def _plan(tmp_path: Path, contents: tuple[bytes, ...] = (b"one",)) -> Path:
    entries = []
    for index, content in enumerate(contents):
        source = tmp_path / f"source-{index}.tif"
        source.write_bytes(content)
        blob_path = (
            "releases/solutions-v0-2-0-20260805/solutions/"
            f"land/source-{index}.tif"
        )
        entries.append(
            {
                "solutionId": f"solution-{index}",
                "artifactType": "raster",
                "sourcePath": str(source),
                "expectedBlobPath": blob_path,
                "expectedPublicUrl": f"https://example.test/{blob_path}",
                "artifactSha256": hashlib.sha256(content).hexdigest(),
                "bytes": len(content),
                "status": "upload-required",
            }
        )
    plan = {
        "format": "solution-source-upload-plan-v1",
        "releaseId": "solutions-v0-2-0-20260805",
        "prefix": "releases/solutions-v0-2-0-20260805/solutions/",
        "artifactCount": len(entries),
        "counts": {"alreadyPresent": 0, "uploadRequired": len(entries)},
        "entries": entries,
    }
    path = tmp_path / "upload-plan.json"
    path.write_text(json.dumps(plan), encoding="utf-8")
    return path


def _remote_store(plan_path: Path) -> tuple[dict[str, str], callable, callable]:
    plan = json.loads(plan_path.read_text(encoding="utf-8"))
    entries_by_path = {
        entry["expectedBlobPath"]: entry for entry in plan["entries"]
    }
    store: dict[str, str] = {}

    def fetch(url: str) -> str | None:
        return store.get(url)

    def upload(_token: str, _source: Path, blob_path: str) -> str:
        entry = entries_by_path[blob_path]
        store[entry["expectedPublicUrl"]] = entry["artifactSha256"]
        return entry["expectedPublicUrl"]

    return store, fetch, upload


def test_dry_run_checks_remote_without_upload_or_token(tmp_path: Path):
    plan = _plan(tmp_path)
    report_path = tmp_path / "dry-run.json"
    uploads = []

    report = run_upload(
        plan,
        report_path=report_path,
        dry_run=True,
        token=None,
        fetch_remote_sha256=lambda _url: None,
        upload_blob=lambda *_args: uploads.append(_args),
    )

    assert report["complete"] is True
    assert report["counts"]["would-upload"] == 1
    assert uploads == []


def test_fresh_upload_verifies_remote_bytes(tmp_path: Path):
    plan = _plan(tmp_path)
    store, fetch, upload = _remote_store(plan)

    report = run_upload(
        plan,
        report_path=tmp_path / "report.json",
        dry_run=False,
        token="secret",
        fetch_remote_sha256=fetch,
        upload_blob=upload,
    )

    assert report["counts"]["uploaded"] == 1
    assert len(store) == 1


def test_exact_remote_match_resumes_as_complete_without_put(tmp_path: Path):
    plan = _plan(tmp_path)
    raw = json.loads(plan.read_text(encoding="utf-8"))
    entry = raw["entries"][0]
    uploads = []

    report = run_upload(
        plan,
        report_path=tmp_path / "report.json",
        dry_run=False,
        token="secret",
        fetch_remote_sha256=lambda _url: entry["artifactSha256"],
        upload_blob=lambda *_args: uploads.append(_args),
    )

    assert report["counts"]["already-complete"] == 1
    assert uploads == []


def test_differing_remote_bytes_are_rejected_without_overwrite(tmp_path: Path):
    plan = _plan(tmp_path)
    report_path = tmp_path / "report.json"
    uploads = []

    with pytest.raises(SourceUploadError, match="differing bytes"):
        run_upload(
            plan,
            report_path=report_path,
            dry_run=False,
            token="secret",
            fetch_remote_sha256=lambda _url: "f" * 64,
            upload_blob=lambda *_args: uploads.append(_args),
        )

    report = json.loads(report_path.read_text(encoding="utf-8"))
    assert report["entries"][0]["status"] == "failed"
    assert uploads == []


def test_interrupted_upload_resumes_from_remote_truth(tmp_path: Path):
    plan = _plan(tmp_path, (b"one", b"two"))
    report_path = tmp_path / "report.json"
    store, fetch, upload = _remote_store(plan)
    calls = 0

    def interrupt_second(token: str, source: Path, blob_path: str) -> str:
        nonlocal calls
        calls += 1
        if calls == 2:
            raise SourceUploadError("interrupted")
        return upload(token, source, blob_path)

    with pytest.raises(SourceUploadError, match="interrupted"):
        run_upload(
            plan,
            report_path=report_path,
            dry_run=False,
            token="secret",
            fetch_remote_sha256=fetch,
            upload_blob=interrupt_second,
        )
    interrupted = json.loads(report_path.read_text(encoding="utf-8"))
    assert [entry["status"] for entry in interrupted["entries"]] == [
        "uploaded",
        "failed",
    ]

    resumed = run_upload(
        plan,
        report_path=report_path,
        dry_run=False,
        token="secret",
        fetch_remote_sha256=fetch,
        upload_blob=upload,
    )
    assert resumed["complete"] is True
    assert [entry["status"] for entry in resumed["entries"]] == [
        "already-complete",
        "uploaded",
    ]


def test_transient_failures_use_bounded_retry(tmp_path: Path):
    plan = _plan(tmp_path)
    store, fetch, upload = _remote_store(plan)
    attempts = 0
    sleeps = []

    def flaky_fetch(url: str) -> str | None:
        nonlocal attempts
        attempts += 1
        if attempts < 3:
            raise TransientUploadError("temporary")
        return fetch(url)

    report = run_upload(
        plan,
        report_path=tmp_path / "report.json",
        dry_run=False,
        token="secret",
        max_attempts=3,
        initial_backoff=0.25,
        max_backoff=1,
        fetch_remote_sha256=flaky_fetch,
        upload_blob=upload,
        sleep=sleeps.append,
    )

    assert report["entries"][0]["attempts"] == 3
    assert sleeps == [0.25, 0.5]


def test_upload_mode_requires_token_before_remote_or_upload(tmp_path: Path):
    plan = _plan(tmp_path)
    remote_calls = []

    with pytest.raises(SourceUploadError, match="BLOB_READ_WRITE_TOKEN"):
        run_upload(
            plan,
            report_path=tmp_path / "report.json",
            dry_run=False,
            token=None,
            fetch_remote_sha256=lambda url: remote_calls.append(url),
        )

    assert remote_calls == []


def test_report_integrity_is_bound_to_exact_plan(tmp_path: Path):
    plan = _plan(tmp_path)
    report_path = tmp_path / "report.json"
    run_upload(
        plan,
        report_path=report_path,
        dry_run=True,
        token=None,
        fetch_remote_sha256=lambda _url: None,
    )
    report = json.loads(report_path.read_text(encoding="utf-8"))
    assert report["format"] == REPORT_FORMAT
    assert len(report["planSha256"]) == 64
    assert report["artifactCount"] == len(report["entries"]) == 1

    raw = json.loads(plan.read_text(encoding="utf-8"))
    raw["entries"][0]["artifactSha256"] = "a" * 64
    plan.write_text(json.dumps(raw), encoding="utf-8")
    with pytest.raises(SourceUploadError, match="local source SHA-256"):
        run_upload(
            plan,
            report_path=report_path,
            dry_run=True,
            token=None,
            fetch_remote_sha256=lambda _url: None,
        )
