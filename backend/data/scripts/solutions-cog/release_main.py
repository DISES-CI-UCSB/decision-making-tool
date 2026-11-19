"""Stage release-scoped display COGs for solution rasters.

Usage example:

    data/metrics/python/.venv/bin/python data/scripts/solutions-cog/release_main.py \
        --release-dir data/metrics/generated/releases/solutions-v0-2-0-20260805 \
        --manifest frontend/public/data/layer-manifest/manifest.json \
        --domain land

Unlike ``main.py``, which pulls the live Blob manifest and its
``solutions/nacional/`` layout, this reads a release's own runtime manifest and
checksum-pinned source rasters, then writes COGs plus an upload plan that
``metrics_pipeline/upload_solution_sources.py`` can execute against immutable
release paths.

The conversion is a pure repackaging: these sources are already in the display
CRS, so nothing is reprojected and every pixel value is preserved. Overviews use
nearest-neighbour resampling because the rasters are categorical selection
classes, and each output is checked to prove no overview level invented a value.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from cog_writer import COG_CREATION_OPTIONS, read_raster_metadata, validate_cog, write_cog
from release_io import (
    BUILD_REPORT_FORMAT,
    ReleaseCogError,
    assert_categorical_overviews,
    assert_grid_preserved,
    assert_source_needs_no_warp,
    atomic_write_json,
    build_upload_plan,
    cog_basename,
    cog_blob_path,
    cog_public_url,
    load_previous_build_report,
    load_solutions,
    sha256_file,
    verify_local_source,
)

DEFAULT_PUBLIC_BLOB_HOST = "https://aagibolq28slyfof.public.blob.vercel-storage.com"
DISPLAY_CRS_EPSG = 9377


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--release-dir", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--domain", default="land", choices=["land", "marine"])
    parser.add_argument("--output-dir", type=Path, default=None)
    parser.add_argument("--public-blob-host", default=DEFAULT_PUBLIC_BLOB_HOST)
    parser.add_argument("--solution-id", action="append", default=None)
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--force-rebuild", action="store_true")
    return parser.parse_args(argv)


def _release_id(release_dir: Path) -> str:
    marker = release_dir / ".solution-release.json"
    if not marker.is_file():
        raise ReleaseCogError(f"release marker is missing: {marker}")
    release_id = json.loads(marker.read_text(encoding="utf-8")).get("releaseId")
    if not isinstance(release_id, str) or not release_id:
        raise ReleaseCogError(f"release marker has no releaseId: {marker}")
    return release_id


def _select(solutions: list[dict[str, Any]], only_ids: list[str] | None, limit: int | None):
    if only_ids:
        wanted = set(only_ids)
        solutions = [s for s in solutions if s["solutionId"] in wanted]
        missing = wanted - {s["solutionId"] for s in solutions}
        if missing:
            raise ReleaseCogError(f"requested solution ids not found: {sorted(missing)}")
    return solutions[:limit] if limit is not None else solutions


def _can_skip(staged_path: Path, previous: dict[str, Any] | None, source_sha256: str) -> bool:
    return bool(
        previous
        and staged_path.exists()
        and previous.get("sourceSha256") == source_sha256
        and previous.get("status") in {"converted", "skipped"}
        and (previous.get("cogValidation") or {}).get("isValidCog") is True
        and previous.get("cogSha256") == sha256_file(staged_path)
    )


def _process(
    source: dict[str, Any],
    *,
    release_id: str,
    staged_root: Path,
    public_blob_host: str,
    previous: dict[str, Any] | None,
    force_rebuild: bool,
) -> dict[str, Any]:
    source_bytes = verify_local_source(source)
    source_metadata = read_raster_metadata(source["sourcePath"])
    assert_source_needs_no_warp(
        source_metadata,
        epsg=DISPLAY_CRS_EPSG,
        source_path=source["sourcePath"],
    )

    blob_path = cog_blob_path(
        release_id, source["domain"], source["rasterFile"], DISPLAY_CRS_EPSG
    )
    staged_path = staged_root / cog_basename(source["rasterFile"], DISPLAY_CRS_EPSG)

    started = time.time()
    if not force_rebuild and _can_skip(staged_path, previous, source["sourceSha256"]):
        status, conversion_seconds = "skipped", 0.0
    else:
        write_cog(source["sourcePath"], staged_path, target_crs=None)
        status, conversion_seconds = "converted", time.time() - started

    cog_validation = validate_cog(staged_path)
    if not cog_validation.get("isValidCog"):
        raise ReleaseCogError(f"staged output is not a valid COG: {staged_path}")
    grid = assert_grid_preserved(source["sourcePath"], staged_path)
    categorical = assert_categorical_overviews(staged_path)

    return {
        "solutionId": source["solutionId"],
        "solutionName": source["solutionName"],
        "domain": source["domain"],
        "status": status,
        "rasterFile": source["rasterFile"],
        "sourceBlobPath": source["sourceBlobPath"],
        "sourcePath": str(source["sourcePath"]),
        "sourceSha256": source["sourceSha256"],
        "sourceBytes": source_bytes,
        "sourceRaster": source_metadata,
        "stagedPath": str(staged_path.resolve()),
        "expectedBlobPath": blob_path,
        "expectedPublicUrl": cog_public_url(public_blob_host, blob_path),
        "cogSha256": sha256_file(staged_path),
        "cogBytes": staged_path.stat().st_size,
        "warpRequired": False,
        "conversionSeconds": round(conversion_seconds, 2),
        "cogValidation": cog_validation,
        "gridPreserved": grid,
        "categoricalOverviewCheck": categorical,
    }


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    try:
        release_id = _release_id(args.release_dir)
        output_dir = args.output_dir or args.release_dir / "display-cogs"
        staged_root = output_dir / "blob-staged" / "releases" / release_id / "solutions" / args.domain
        sources = load_solutions(
            args.manifest,
            args.release_dir / "source-upload" / "upload-plan.json",
            args.domain,
        )
        sources = _select(sources, args.solution_id, args.limit)
    except (OSError, ReleaseCogError) as exc:
        print(f"[release-cog] ERROR: {exc}", file=sys.stderr)
        return 2

    print(f"[release-cog] release={release_id} domain={args.domain} solutions={len(sources)}")
    print(f"[release-cog] no reprojection: sources are already EPSG:{DISPLAY_CRS_EPSG}")

    build_report_path = output_dir / "cog-build-report.json"
    previous_entries = load_previous_build_report(build_report_path)
    entries: list[dict[str, Any]] = []
    failures: list[dict[str, Any]] = []

    for index, source in enumerate(sources, start=1):
        try:
            entry = _process(
                source,
                release_id=release_id,
                staged_root=staged_root,
                public_blob_host=args.public_blob_host,
                previous=previous_entries.get(source["solutionId"]),
                force_rebuild=args.force_rebuild,
            )
            entries.append(entry)
            print(
                f"[release-cog] [{index}/{len(sources)}] {entry['status']} "
                f"{entry['solutionId']} ({entry['cogBytes']} bytes, "
                f"overviews={[o['level'] for o in entry['categoricalOverviewCheck']['overviews']]})"
            )
        except Exception as exc:  # keep the batch report useful when one raster fails
            failures.append(
                {
                    "solutionId": source["solutionId"],
                    "error": str(exc),
                    "traceback": traceback.format_exc(),
                }
            )
            print(f"[release-cog] [{index}/{len(sources)}] FAILED {source['solutionId']}: {exc}", file=sys.stderr)

    statuses: dict[str, int] = {}
    for entry in entries:
        statuses[entry["status"]] = statuses.get(entry["status"], 0) + 1

    atomic_write_json(
        build_report_path,
        {
            "format": BUILD_REPORT_FORMAT,
            "generatedAt": _utc_now_iso(),
            "releaseId": release_id,
            "domain": args.domain,
            "manifestPath": str(args.manifest.resolve()),
            "creationOptions": COG_CREATION_OPTIONS,
            "reprojected": False,
            "displayCrsEpsg": DISPLAY_CRS_EPSG,
            "statusCounts": statuses,
            "totalCogBytes": sum(entry["cogBytes"] for entry in entries),
            "entries": entries,
            "failures": failures,
        },
    )
    print(f"[release-cog] wrote build report -> {build_report_path}")

    if failures:
        print(f"[release-cog] {len(failures)} failure(s); upload plan not written", file=sys.stderr)
        return 1

    plan_path = output_dir / "upload-plan.json"
    atomic_write_json(plan_path, build_upload_plan(release_id, entries))
    print(f"[release-cog] wrote upload plan -> {plan_path}")
    print(
        f"[release-cog] done: {len(entries)} COG(s), "
        f"{sum(entry['cogBytes'] for entry in entries)} total bytes, statuses={statuses}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
