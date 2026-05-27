"""Solution COG CLI entry point.

Usage example:

    python data/scripts/solutions-cog/main.py \
        --solution-id ecos17_estr30_runap_hf \
        --limit 1

Reads the public Vercel Blob layer manifest, batches nacional solution rasters,
converts them into Cloud-Optimized GeoTIFFs, and writes a publish-report.json
that maps each staged COG to its expected Blob path and public URL.
"""

from __future__ import annotations

import argparse
import sys
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from blob_manifest import (
    DEFAULT_MANIFEST_URL,
    ManifestError,
    ResolvedManifest,
    fetch_manifest,
    solution_blob_basename,
)
from local_io import (
    DEFAULT_CACHE_DIR,
    DEFAULT_OUTPUT_DIR,
    cached_download,
    expected_blob_path,
    expected_public_url,
    load_latest_publish_report,
    previous_entry_by_solution_id,
    sha256_file,
    staged_cog_path,
    write_publish_report,
)


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--manifest-url",
        default=DEFAULT_MANIFEST_URL,
        help=f"Vercel Blob manifest.json URL (default: {DEFAULT_MANIFEST_URL}).",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=DEFAULT_OUTPUT_DIR,
        help=f"Local output directory (default: {DEFAULT_OUTPUT_DIR}).",
    )
    parser.add_argument(
        "--cache-dir",
        type=Path,
        default=DEFAULT_CACHE_DIR,
        help=f"Local raster download cache (default: {DEFAULT_CACHE_DIR}).",
    )
    parser.add_argument(
        "--solution-id",
        action="append",
        default=None,
        help="Restrict to one or more solution ids (repeatable).",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Cap the number of solutions processed (smoke test).",
    )
    parser.add_argument(
        "--no-cache",
        action="store_true",
        help="Force re-download even if cached files are present.",
    )
    parser.add_argument(
        "--force-rebuild",
        action="store_true",
        help="Rebuild staged COGs even when the source SHA-256 is unchanged.",
    )
    parser.add_argument(
        "--validate-only",
        action="store_true",
        help="Fetch manifest + select solutions; do not download, convert, or write.",
    )
    return parser.parse_args(argv)


def _select_solutions(
    manifest: ResolvedManifest,
    only_ids: list[str] | None,
    limit: int | None,
) -> list[dict[str, Any]]:
    solutions = manifest.national_solutions
    if only_ids:
        wanted = set(only_ids)
        solutions = [s for s in solutions if str(s.get("id")) in wanted]
        missing = wanted - {str(s.get("id")) for s in solutions}
        if missing:
            raise ManifestError(
                f"Requested solution ids not found in manifest: {sorted(missing)}"
            )
    if limit is not None:
        solutions = solutions[:limit]
    return solutions


def _can_skip(
    *,
    source_sha256: str,
    staged_path: Path,
    previous_entry: dict[str, Any] | None,
    force_rebuild: bool,
) -> bool:
    if force_rebuild or not staged_path.exists() or not previous_entry:
        return False
    return (
        previous_entry.get("sourceSha256") == source_sha256
        and (previous_entry.get("cogValidation") or {}).get("isValidCog") is True
    )


def _entry_metadata(
    solution: dict[str, Any],
    manifest: ResolvedManifest,
    basename: str,
    staged_path: Path,
    source_download: Any,
    *,
    status: str,
    conversion_seconds: float,
    cog_validation: dict[str, Any],
) -> dict[str, Any]:
    cog_sha256 = sha256_file(staged_path) if staged_path.exists() else None
    cog_bytes = staged_path.stat().st_size if staged_path.exists() else None
    return {
        "solutionId": str(solution.get("id")),
        "solutionName": solution.get("name"),
        "solutionBasename": basename,
        "status": status,
        "sourceUrl": source_download.url,
        "sourceBlobPath": solution.get("blobPath"),
        "stagedPath": str(staged_path),
        "expectedBlobPath": expected_blob_path(basename),
        "expectedPublicUrl": expected_public_url(manifest.public_blob_host, basename),
        "sourceSha256": source_download.sha256,
        "sourceBytes": source_download.bytes,
        "cogSha256": cog_sha256,
        "cogBytes": cog_bytes,
        "conversionSeconds": round(conversion_seconds, 2),
        "cogValidation": cog_validation,
    }


def _process_solution(
    solution: dict[str, Any],
    manifest: ResolvedManifest,
    cache_dir: Path,
    output_dir: Path,
    previous_entries: dict[str, dict[str, Any]],
    *,
    force_download: bool,
    force_rebuild: bool,
) -> dict[str, Any]:
    from cog_writer import validate_cog, write_cog

    solution_id = str(solution.get("id"))
    basename = solution_blob_basename(solution)
    target_path = staged_cog_path(output_dir, basename)

    source_download = cached_download(
        str(solution["displayUrl"]),
        cache_dir,
        force=force_download,
    )
    previous_entry = previous_entries.get(solution_id)

    if _can_skip(
        source_sha256=source_download.sha256,
        staged_path=target_path,
        previous_entry=previous_entry,
        force_rebuild=force_rebuild,
    ):
        cog_validation = validate_cog(target_path)
        return _entry_metadata(
            solution,
            manifest,
            basename,
            target_path,
            source_download,
            status="skipped",
            conversion_seconds=0.0,
            cog_validation=cog_validation,
        )

    started = time.time()
    write_cog(source_download.path, target_path)
    conversion_seconds = time.time() - started
    cog_validation = validate_cog(target_path)

    return _entry_metadata(
        solution,
        manifest,
        basename,
        target_path,
        source_download,
        status="converted",
        conversion_seconds=conversion_seconds,
        cog_validation=cog_validation,
    )


def _status_counts(entries: list[dict[str, Any]]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for entry in entries:
        status = str(entry.get("status", "unknown"))
        counts[status] = counts.get(status, 0) + 1
    return counts


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    print(f"[solutions-cog] manifest: {args.manifest_url}")

    try:
        manifest = fetch_manifest(args.manifest_url)
        solutions = _select_solutions(manifest, args.solution_id, args.limit)
    except ManifestError as exc:
        print(f"[solutions-cog] ERROR: {exc}", file=sys.stderr)
        return 2

    print(
        f"[solutions-cog] loaded {len(manifest.national_solutions)} nacional solution(s); "
        f"selected {len(solutions)}"
    )

    if args.validate_only:
        print("[solutions-cog] validate-only: manifest OK, exiting before downloads.")
        return 0

    args.output_dir.mkdir(parents=True, exist_ok=True)
    args.cache_dir.mkdir(parents=True, exist_ok=True)

    previous_report = load_latest_publish_report(args.output_dir)
    previous_entries = previous_entry_by_solution_id(previous_report)
    entries: list[dict[str, Any]] = []
    failures: list[dict[str, Any]] = []

    for index, solution in enumerate(solutions, start=1):
        solution_id = str(solution.get("id"))
        print(f"[solutions-cog] [{index}/{len(solutions)}] {solution_id}")
        try:
            entry = _process_solution(
                solution,
                manifest,
                args.cache_dir,
                args.output_dir,
                previous_entries,
                force_download=args.no_cache,
                force_rebuild=args.force_rebuild,
            )
            entries.append(entry)
            print(f"[solutions-cog]   {entry['status']}: {entry['stagedPath']}")
        except Exception as exc:  # keep batch reports useful when one raster fails
            failures.append(
                {
                    "solutionId": solution_id,
                    "error": str(exc),
                    "traceback": traceback.format_exc(),
                }
            )
            print(f"[solutions-cog]   FAILED: {exc}", file=sys.stderr)

    report = {
        "generatedAt": _utc_now_iso(),
        "manifestUrl": args.manifest_url,
        "manifestGeneratedAt": manifest.raw.get("generatedAt"),
        "publicBlobHost": manifest.public_blob_host,
        "outputDir": str(args.output_dir),
        "cacheDir": str(args.cache_dir),
        "statusCounts": _status_counts(entries),
        "entries": entries,
        "failures": failures,
    }
    report_path = write_publish_report(args.output_dir, report)
    print(f"[solutions-cog] wrote publish report -> {report_path}")
    print(
        f"[solutions-cog] done: {len(entries)} entry/entries, "
        f"{len(failures)} failure(s)"
    )
    return 0 if not failures else 1


if __name__ == "__main__":
    raise SystemExit(main())
