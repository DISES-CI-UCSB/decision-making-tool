"""Publish locally generated cached metrics to Vercel Blob.

Workflow (from repo root):

    # 1. Generate local cache + publish-report.json
    python data/metrics/python/metrics_pipeline/main.py

    # 2. Inspect before upload
    python data/metrics/python/metrics_pipeline/inspect_metrics.py

    # 3. Publish (inspect runs first unless --skip-inspect)
    python data/metrics/python/metrics_pipeline/publish.py

Dry run:

    python data/metrics/python/metrics_pipeline/publish.py --dry-run

Requires BLOB_READ_WRITE_TOKEN in .env.local at the repo root and the Vercel CLI
on PATH. Uploads to metrics/cache/{solution_id}.metrics.json with --force overwrite.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from cli_utils import (
    BLOB_TOKEN_ENV_VAR,
    default_output_dir,
    default_report_path,
    extract_first_url,
    find_repo_root,
    load_env_value,
    print_inspect_summary,
    resolve_output_dir,
)
from validation.inspect_cache import inspect_publish_report


@dataclass
class UploadResult:
    solution_id: str
    blob_path: str
    local_path: Path
    bytes: int
    uploaded_url: str | None = None
    error: str | None = None

    @property
    def ok(self) -> bool:
        return self.error is None


@dataclass
class PublishRun:
    started_at: str
    report_path: Path
    dry_run: bool
    uploads: list[UploadResult] = field(default_factory=list)

    @property
    def ok_count(self) -> int:
        return sum(1 for item in self.uploads if item.ok)

    @property
    def fail_count(self) -> int:
        return sum(1 for item in self.uploads if not item.ok)


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=default_output_dir(),
        help="Directory containing publish-report.json and cache/ (default: data/metrics/generated/tier1).",
    )
    parser.add_argument(
        "--solution-id",
        action="append",
        default=None,
        help="Publish only the listed solution ids (repeatable).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Validate and print the upload plan without calling vercel blob put.",
    )
    parser.add_argument(
        "--skip-inspect",
        action="store_true",
        help="Upload even if local inspection fails (not recommended).",
    )
    return parser.parse_args(argv)


def _resolve_cache_path(repo_root: Path, raw_path: str) -> Path:
    path = Path(raw_path)
    if path.is_absolute():
        return path
    return repo_root / path


def _load_report_entries(report_path: Path) -> list[dict[str, Any]]:
    report = json.loads(report_path.read_text(encoding="utf-8"))
    entries = report.get("entries") or []
    failures = report.get("failures") or []
    if failures:
        ids = ", ".join(str(item.get("solutionId")) for item in failures)
        raise RuntimeError(f"publish report contains generation failures: {ids}")
    if not entries:
        raise RuntimeError("publish report has no entries to publish")
    return entries


def _put_blob(token: str, local_path: Path, blob_path: str) -> str | None:
    completed = subprocess.run(
        [
            "vercel",
            "blob",
            "put",
            str(local_path),
            "--pathname",
            blob_path,
            "--force",
            "--rw-token",
            token,
            "--no-color",
        ],
        check=False,
        capture_output=True,
        text=True,
    )
    output = f"{completed.stdout}\n{completed.stderr}"
    if completed.returncode != 0:
        raise RuntimeError(output.strip() or f"vercel blob put failed with code {completed.returncode}")
    return extract_first_url(output)


def _print_publish_report(run: PublishRun, *, elapsed_seconds: float) -> None:
    prefix = "[tier1-publish]"
    mode = "dry-run" if run.dry_run else "upload"
    print(f"{prefix} {mode} complete in {elapsed_seconds:.1f}s")
    print(f"{prefix} source report: {run.report_path}")
    print(f"{prefix} solutions: {run.ok_count} ok, {run.fail_count} failed, {len(run.uploads)} total")

    total_bytes = sum(item.bytes for item in run.uploads if item.ok)
    if total_bytes:
        print(f"{prefix} uploaded bytes: {total_bytes:,}")

    for item in run.uploads:
        if item.ok:
            url = item.uploaded_url or "(url not parsed)"
            if run.dry_run:
                print(
                    f"{prefix}   would upload {item.solution_id} "
                    f"({item.bytes:,} B) -> {item.blob_path}"
                )
            else:
                print(
                    f"{prefix}   uploaded {item.solution_id} "
                    f"({item.bytes:,} B) -> {item.blob_path}"
                )
                print(f"{prefix}     {url}")
        else:
            print(f"{prefix}   FAILED {item.solution_id}: {item.error}", file=sys.stderr)


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    repo_root = find_repo_root()
    report_path = default_report_path(repo_root, args.output_dir)
    solution_ids = set(args.solution_id) if args.solution_id else None
    started = time.time()

    if not args.skip_inspect:
        inspect_result = inspect_publish_report(
            report_path,
            repo_root=repo_root,
            solution_ids=solution_ids,
        )
        print_inspect_summary(inspect_result, prefix="[tier1-publish]")
        if not inspect_result.ok:
            print("[tier1-publish] aborting upload; fix issues or pass --skip-inspect", file=sys.stderr)
            return 1

    token = load_env_value(repo_root, BLOB_TOKEN_ENV_VAR)
    if not token and not args.dry_run:
        print(
            f"[tier1-publish] ERROR: {BLOB_TOKEN_ENV_VAR} is required in .env.local",
            file=sys.stderr,
        )
        return 2

    try:
        entries = _load_report_entries(report_path)
    except (OSError, json.JSONDecodeError, RuntimeError) as exc:
        print(f"[tier1-publish] ERROR: {exc}", file=sys.stderr)
        return 2

    run = PublishRun(started_at=_utc_now_iso(), report_path=report_path, dry_run=args.dry_run)

    for entry in entries:
        solution_id = str(entry.get("solutionId") or "")
        if solution_ids and solution_id not in solution_ids:
            continue

        cache_raw = entry.get("cachePath")
        blob_path = entry.get("expectedBlobPath")
        if not cache_raw or not blob_path:
            run.uploads.append(UploadResult(
                solution_id=solution_id,
                blob_path=str(blob_path or ""),
                local_path=Path(cache_raw or ""),
                bytes=0,
                error="entry missing cachePath or expectedBlobPath",
            ))
            continue

        local_path = _resolve_cache_path(repo_root, cache_raw)
        if not local_path.exists():
            run.uploads.append(UploadResult(
                solution_id=solution_id,
                blob_path=blob_path,
                local_path=local_path,
                bytes=0,
                error=f"cache file missing: {local_path}",
            ))
            continue

        file_bytes = local_path.stat().st_size
        if args.dry_run:
            run.uploads.append(UploadResult(
                solution_id=solution_id,
                blob_path=blob_path,
                local_path=local_path,
                bytes=file_bytes,
            ))
            continue

        try:
            uploaded_url = _put_blob(token, local_path, blob_path)
            run.uploads.append(UploadResult(
                solution_id=solution_id,
                blob_path=blob_path,
                local_path=local_path,
                bytes=file_bytes,
                uploaded_url=uploaded_url,
            ))
        except (OSError, RuntimeError) as exc:
            run.uploads.append(UploadResult(
                solution_id=solution_id,
                blob_path=blob_path,
                local_path=local_path,
                bytes=file_bytes,
                error=str(exc),
            ))

    _print_publish_report(run, elapsed_seconds=time.time() - started)
    return 0 if run.fail_count == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
