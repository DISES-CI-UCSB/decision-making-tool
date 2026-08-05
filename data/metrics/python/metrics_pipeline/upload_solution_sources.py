"""Safely upload checksum-pinned solution sources to immutable release paths."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Callable
from urllib.parse import unquote, urlsplit

from cli_utils import BLOB_TOKEN_ENV_VAR, extract_first_url, find_repo_root, load_env_value

PLAN_FORMAT = "solution-source-upload-plan-v1"
REPORT_FORMAT = "solution-source-upload-report-v1"
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
TRANSIENT_HTTP_CODES = {408, 425, 429, 500, 502, 503, 504}


class SourceUploadError(RuntimeError):
    """The source upload cannot proceed safely."""


class TransientUploadError(SourceUploadError):
    """A bounded retry may safely repeat the failed operation."""


def sha256_path(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _atomic_write_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    with temporary.open("w", encoding="utf-8") as target:
        json.dump(value, target, indent=2, ensure_ascii=False, sort_keys=True)
        target.write("\n")
        target.flush()
        os.fsync(target.fileno())
    temporary.replace(path)
    directory_fd = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(directory_fd)
    finally:
        os.close(directory_fd)


def _load_plan(path: Path) -> tuple[dict[str, Any], str]:
    content = path.read_bytes()
    try:
        plan = json.loads(content)
    except json.JSONDecodeError as exc:
        raise SourceUploadError(f"upload plan is not valid JSON: {path}") from exc
    if not isinstance(plan, dict) or plan.get("format") != PLAN_FORMAT:
        raise SourceUploadError(f"upload plan format must be {PLAN_FORMAT!r}.")
    release_id = plan.get("releaseId")
    prefix = plan.get("prefix")
    entries = plan.get("entries")
    if (
        not isinstance(release_id, str)
        or not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", release_id)
        or prefix != f"releases/{release_id}/solutions/"
        or not isinstance(entries, list)
        or plan.get("artifactCount") != len(entries)
    ):
        raise SourceUploadError("upload plan release binding or artifact count is invalid.")
    expected_counts = {
        "alreadyPresent": sum(
            entry.get("status") == "already-present"
            for entry in entries
            if isinstance(entry, dict)
        ),
        "uploadRequired": sum(
            entry.get("status") == "upload-required"
            for entry in entries
            if isinstance(entry, dict)
        ),
    }
    if plan.get("counts") != expected_counts:
        raise SourceUploadError("upload plan counts do not match its entries.")

    destinations: set[str] = set()
    for index, entry in enumerate(entries):
        if not isinstance(entry, dict):
            raise SourceUploadError(f"entries[{index}] must be an object.")
        blob_path = entry.get("expectedBlobPath")
        public_url = entry.get("expectedPublicUrl")
        source_path = entry.get("sourcePath")
        checksum = entry.get("artifactSha256")
        size = entry.get("bytes")
        if (
            entry.get("artifactType") not in {"raster", "summary"}
            or not isinstance(entry.get("solutionId"), str)
            or not isinstance(source_path, str)
            or not isinstance(blob_path, str)
            or not re.fullmatch(
                rf"releases/{re.escape(release_id)}/solutions/(land|marine)/[^/]+",
                blob_path,
            )
            or blob_path.startswith("solutions/nacional/")
            or blob_path in destinations
            or not isinstance(public_url, str)
            or unquote(urlsplit(public_url).path.lstrip("/")) != blob_path
            or not isinstance(checksum, str)
            or not SHA256_PATTERN.fullmatch(checksum)
            or isinstance(size, bool)
            or not isinstance(size, int)
            or size < 0
        ):
            raise SourceUploadError(f"entries[{index}] is invalid or not immutable.")
        destinations.add(blob_path)
    return plan, hashlib.sha256(content).hexdigest()


def _preflight_local_entries(plan: dict[str, Any]) -> list[dict[str, Any]]:
    verified: list[dict[str, Any]] = []
    for entry in plan["entries"]:
        path = Path(entry["sourcePath"])
        if not path.is_file():
            raise SourceUploadError(f"local source is missing: {path}")
        observed_size = path.stat().st_size
        if observed_size != entry["bytes"]:
            raise SourceUploadError(
                f"local source size differs from plan for {entry['expectedBlobPath']}."
            )
        observed_sha256 = sha256_path(path)
        if observed_sha256 != entry["artifactSha256"]:
            raise SourceUploadError(
                f"local source SHA-256 differs from plan for {entry['expectedBlobPath']}."
            )
        verified.append(entry)
    return verified


def remote_sha256(url: str) -> str | None:
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "dises-solution-source-uploader/1"},
    )
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            digest = hashlib.sha256()
            for chunk in iter(lambda: response.read(1024 * 1024), b""):
                digest.update(chunk)
            return digest.hexdigest()
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            return None
        if exc.code in TRANSIENT_HTTP_CODES:
            raise TransientUploadError(
                f"temporary HTTP {exc.code} while reading immutable destination"
            ) from exc
        raise SourceUploadError(
            f"HTTP {exc.code} while reading immutable destination"
        ) from exc
    except (TimeoutError, urllib.error.URLError) as exc:
        raise TransientUploadError(
            "temporary network failure while reading immutable destination"
        ) from exc


def put_blob(token: str, source_path: Path, blob_path: str) -> str | None:
    completed = subprocess.run(
        [
            "vercel",
            "blob",
            "put",
            str(source_path),
            "--pathname",
            blob_path,
            "--rw-token",
            token,
            "--no-color",
        ],
        check=False,
        capture_output=True,
        text=True,
    )
    output = f"{completed.stdout}\n{completed.stderr}".replace(token, "[redacted]")
    if completed.returncode != 0:
        raise TransientUploadError(
            output.strip() or f"vercel blob put failed with code {completed.returncode}"
        )
    return extract_first_url(output)


def _retry(
    operation: Callable[[], str],
    *,
    max_attempts: int,
    initial_backoff: float,
    max_backoff: float,
    sleep: Callable[[float], None],
) -> tuple[str, int]:
    delay = initial_backoff
    for attempt in range(1, max_attempts + 1):
        try:
            return operation(), attempt
        except TransientUploadError as exc:
            setattr(exc, "attempts", attempt)
            if attempt == max_attempts:
                raise
            sleep(delay)
            delay = min(max_backoff, delay * 2)
    raise AssertionError("retry loop exhausted unexpectedly")


def _new_report(
    plan: dict[str, Any],
    *,
    plan_path: Path,
    plan_sha256: str,
    dry_run: bool,
) -> dict[str, Any]:
    return {
        "format": REPORT_FORMAT,
        "releaseId": plan["releaseId"],
        "planPath": str(plan_path.resolve()),
        "planSha256": plan_sha256,
        "mode": "dry-run" if dry_run else "upload",
        "complete": False,
        "artifactCount": len(plan["entries"]),
        "counts": {},
        "entries": [
            {
                "solutionId": entry["solutionId"],
                "artifactType": entry["artifactType"],
                "expectedBlobPath": entry["expectedBlobPath"],
                "artifactSha256": entry["artifactSha256"],
                "bytes": entry["bytes"],
                "status": "pending",
                "attempts": 0,
                "error": None,
            }
            for entry in plan["entries"]
        ],
    }


def _update_counts(report: dict[str, Any]) -> None:
    statuses = [
        entry["status"]
        for entry in report["entries"]
    ]
    report["counts"] = {
        status: statuses.count(status)
        for status in (
            "pending",
            "would-upload",
            "uploaded",
            "already-complete",
            "failed",
        )
    }
    report["complete"] = not any(
        status in {"pending", "failed"} for status in statuses
    )


def _load_or_create_report(
    report_path: Path,
    *,
    plan: dict[str, Any],
    plan_path: Path,
    plan_sha256: str,
    dry_run: bool,
) -> dict[str, Any]:
    expected = _new_report(
        plan,
        plan_path=plan_path,
        plan_sha256=plan_sha256,
        dry_run=dry_run,
    )
    if not report_path.exists():
        _update_counts(expected)
        return expected
    try:
        observed = json.loads(report_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SourceUploadError(f"could not resume upload report: {report_path}") from exc
    immutable_fields = ("format", "releaseId", "planPath", "planSha256", "mode", "artifactCount")
    if any(observed.get(field) != expected[field] for field in immutable_fields):
        raise SourceUploadError("existing upload report does not match the exact plan and mode.")
    expected_entries = [
        {
            key: entry[key]
            for key in (
                "solutionId",
                "artifactType",
                "expectedBlobPath",
                "artifactSha256",
                "bytes",
            )
        }
        for entry in expected["entries"]
    ]
    observed_entries = observed.get("entries")
    if (
        not isinstance(observed_entries, list)
        or [
            {
                key: entry.get(key)
                for key in (
                    "solutionId",
                    "artifactType",
                    "expectedBlobPath",
                    "artifactSha256",
                    "bytes",
                )
            }
            for entry in observed_entries
            if isinstance(entry, dict)
        ]
        != expected_entries
        or len(observed_entries) != len(expected_entries)
    ):
        raise SourceUploadError("existing upload report entries do not match the plan.")
    return observed


def run_upload(
    plan_path: Path,
    *,
    report_path: Path,
    dry_run: bool,
    token: str | None,
    max_attempts: int = 4,
    initial_backoff: float = 1.0,
    max_backoff: float = 8.0,
    fetch_remote_sha256: Callable[[str], str | None] = remote_sha256,
    upload_blob: Callable[[str, Path, str], str | None] = put_blob,
    sleep: Callable[[float], None] = time.sleep,
) -> dict[str, Any]:
    if max_attempts < 1:
        raise SourceUploadError("max attempts must be at least one.")
    if not dry_run and not token:
        raise SourceUploadError(f"{BLOB_TOKEN_ENV_VAR} is required for upload mode.")
    plan, plan_sha256 = _load_plan(plan_path)
    verified_entries = _preflight_local_entries(plan)
    report = _load_or_create_report(
        report_path,
        plan=plan,
        plan_path=plan_path,
        plan_sha256=plan_sha256,
        dry_run=dry_run,
    )
    _update_counts(report)
    _atomic_write_json(report_path, report)

    for index, (entry, progress) in enumerate(zip(verified_entries, report["entries"])):
        def process() -> str:
            remote = fetch_remote_sha256(entry["expectedPublicUrl"])
            if remote is not None:
                if remote != entry["artifactSha256"]:
                    raise SourceUploadError(
                        "immutable destination contains differing bytes: "
                        f"{entry['expectedBlobPath']}"
                    )
                return "already-complete"
            if dry_run:
                return "would-upload"
            assert token is not None
            upload_blob(token, Path(entry["sourcePath"]), entry["expectedBlobPath"])
            verified_remote = fetch_remote_sha256(entry["expectedPublicUrl"])
            if verified_remote != entry["artifactSha256"]:
                raise TransientUploadError(
                    "uploaded object is not yet readable with the expected SHA-256"
                )
            return "uploaded"

        try:
            status, attempts = _retry(
                process,
                max_attempts=max_attempts,
                initial_backoff=initial_backoff,
                max_backoff=max_backoff,
                sleep=sleep,
            )
            progress.update(status=status, attempts=attempts, error=None)
        except (OSError, SourceUploadError) as exc:
            progress.update(
                status="failed",
                attempts=getattr(exc, "attempts", progress.get("attempts", 0) + 1),
                error=str(exc),
            )
            _update_counts(report)
            _atomic_write_json(report_path, report)
            raise
        _update_counts(report)
        _atomic_write_json(report_path, report)
        if index + 1 == len(verified_entries):
            break
    return report


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("plan", type=Path)
    parser.add_argument("--report", type=Path, default=None)
    parser.add_argument(
        "--execute",
        action="store_true",
        help="Perform uploads. Without this flag the command is a read-only dry run.",
    )
    parser.add_argument("--max-attempts", type=int, default=4)
    parser.add_argument("--initial-backoff", type=float, default=1.0)
    parser.add_argument("--max-backoff", type=float, default=8.0)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    dry_run = not args.execute
    report_path = args.report or args.plan.with_name(
        "upload-dry-run-report.json" if dry_run else "upload-report.json"
    )
    repo_root = find_repo_root()
    token = os.environ.get(BLOB_TOKEN_ENV_VAR) or load_env_value(
        repo_root,
        BLOB_TOKEN_ENV_VAR,
    )
    try:
        report = run_upload(
            args.plan,
            report_path=report_path,
            dry_run=dry_run,
            token=token,
            max_attempts=args.max_attempts,
            initial_backoff=args.initial_backoff,
            max_backoff=args.max_backoff,
        )
    except (OSError, SourceUploadError) as exc:
        print(f"[solution-source-upload] ERROR: {exc}", file=sys.stderr)
        return 1
    counts = report["counts"]
    print(
        f"[solution-source-upload] {'dry run' if dry_run else 'upload'} complete: "
        f"{counts['already-complete']} already complete, "
        f"{counts['would-upload']} would upload, {counts['uploaded']} uploaded"
    )
    print(f"[solution-source-upload] report: {report_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
