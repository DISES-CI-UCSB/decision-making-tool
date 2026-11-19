"""Solution COG CLI entry point.

Usage example:

    python data/scripts/solutions-cog/main.py \
        --solution-id ecos17_estr30_runap_hf \
        --limit 1

Reads the public Vercel Blob layer manifest, batches nacional solution rasters,
converts them into Cloud-Optimized GeoTIFFs, and writes a publish-report.json
that maps each staged COG to its expected Blob path and public URL.

Projection smoke example:

    python data/scripts/solutions-cog/main.py \
        --target-epsg 9377 \
        --target-resolution 1000 \
        --target-aligned-pixels \
        --limit 1
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
    parser.add_argument(
        "--target-epsg",
        type=int,
        default=None,
        help="Reproject staged COGs to this EPSG code, e.g. 9377.",
    )
    parser.add_argument(
        "--target-resolution",
        type=float,
        nargs="+",
        default=None,
        metavar="METERS",
        help=(
            "Target output resolution. Pass one value for square pixels or two "
            "values for x/y resolution."
        ),
    )
    parser.add_argument(
        "--target-aligned-pixels",
        action="store_true",
        help="Align projected output bounds to the target resolution grid.",
    )
    args = parser.parse_args(argv)
    try:
        args.target_resolution = _normalize_target_resolution(args.target_resolution)
    except ValueError as exc:
        parser.error(str(exc))
    return args


def _normalize_target_resolution(values: list[float] | None) -> tuple[float, float] | None:
    if not values:
        return None
    if len(values) == 1:
        value = values[0]
        if value <= 0:
            raise ValueError("--target-resolution must be positive.")
        return (value, value)
    if len(values) == 2:
        x_value, y_value = values
        if x_value <= 0 or y_value <= 0:
            raise ValueError("--target-resolution values must be positive.")
        return (x_value, y_value)
    raise ValueError("--target-resolution accepts one or two values.")


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
    conversion: dict[str, Any],
    force_rebuild: bool,
) -> bool:
    if force_rebuild or not staged_path.exists() or not previous_entry:
        return False
    return (
        previous_entry.get("sourceSha256") == source_sha256
        and previous_entry.get("conversion") == conversion
        and (previous_entry.get("cogValidation") or {}).get("isValidCog") is True
    )


def _conversion_options(args: argparse.Namespace) -> dict[str, Any]:
    return {
        "targetEpsg": args.target_epsg,
        "targetResolution": list(args.target_resolution) if args.target_resolution else None,
        "targetAlignedPixels": bool(args.target_aligned_pixels),
        "resampling": "nearest",
        "warpPolicy": "only-if-source-does-not-match-target",
    }


def _output_basename(source_basename: str, target_epsg: int | None) -> str:
    if target_epsg:
        return f"{source_basename}.epsg{target_epsg}"
    return source_basename


def _requires_warp(
    source_metadata: dict[str, Any],
    *,
    target_epsg: int | None,
    target_resolution: tuple[float, float] | None,
    target_aligned_pixels: bool,
) -> bool:
    if target_epsg is None:
        return False
    if source_metadata.get("epsg") != target_epsg:
        return True
    if target_resolution and not _resolution_matches(
        source_metadata.get("resolution"),
        target_resolution,
    ):
        return True
    if target_resolution and target_aligned_pixels and not _grid_is_aligned(
        source_metadata.get("transform"),
        target_resolution,
    ):
        return True
    return False


def _resolution_matches(
    source_resolution: Any,
    target_resolution: tuple[float, float],
) -> bool:
    if not isinstance(source_resolution, list) or len(source_resolution) != 2:
        return False
    return all(
        abs(float(source_resolution[index]) - target_resolution[index]) <= 1e-6
        for index in range(2)
    )


def _grid_is_aligned(transform: Any, target_resolution: tuple[float, float]) -> bool:
    if not isinstance(transform, list) or len(transform) < 6:
        return False
    origin_x = float(transform[0])
    origin_y = float(transform[3])
    return _is_aligned(origin_x, target_resolution[0]) and _is_aligned(
        origin_y,
        target_resolution[1],
    )


def _is_aligned(value: float, resolution: float) -> bool:
    remainder = abs(value) % resolution
    return min(remainder, resolution - remainder) <= 1e-6


def _entry_metadata(
    solution: dict[str, Any],
    manifest: ResolvedManifest,
    basename: str,
    staged_path: Path,
    source_download: Any,
    *,
    conversion: dict[str, Any],
    source_metadata: dict[str, Any],
    warp_required: bool,
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
        "sourceRaster": source_metadata,
        "cogSha256": cog_sha256,
        "cogBytes": cog_bytes,
        "conversion": conversion,
        "warpRequired": warp_required,
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
    conversion: dict[str, Any],
    target_epsg: int | None,
    target_resolution: tuple[float, float] | None,
    target_aligned_pixels: bool,
    force_download: bool,
    force_rebuild: bool,
) -> dict[str, Any]:
    from cog_writer import read_raster_metadata, validate_cog, write_cog

    solution_id = str(solution.get("id"))
    basename = _output_basename(solution_blob_basename(solution), target_epsg)
    target_path = staged_cog_path(output_dir, basename)

    source_download = cached_download(
        str(solution["displayUrl"]),
        cache_dir,
        force=force_download,
    )
    previous_entry = previous_entries.get(solution_id)
    source_metadata = read_raster_metadata(source_download.path)
    warp_required = _requires_warp(
        source_metadata,
        target_epsg=target_epsg,
        target_resolution=target_resolution,
        target_aligned_pixels=target_aligned_pixels,
    )

    if _can_skip(
        source_sha256=source_download.sha256,
        staged_path=target_path,
        previous_entry=previous_entry,
        conversion=conversion,
        force_rebuild=force_rebuild,
    ):
        cog_validation = validate_cog(target_path)
        return _entry_metadata(
            solution,
            manifest,
            basename,
            target_path,
            source_download,
            conversion=conversion,
            source_metadata=source_metadata,
            warp_required=warp_required,
            status="skipped",
            conversion_seconds=0.0,
            cog_validation=cog_validation,
        )

    started = time.time()
    write_cog(
        source_download.path,
        target_path,
        target_crs=f"EPSG:{target_epsg}" if warp_required else None,
        target_resolution=target_resolution,
        target_aligned_pixels=target_aligned_pixels,
    )
    conversion_seconds = time.time() - started
    cog_validation = validate_cog(target_path)

    return _entry_metadata(
        solution,
        manifest,
        basename,
        target_path,
        source_download,
        conversion=conversion,
        source_metadata=source_metadata,
        warp_required=warp_required,
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

    conversion = _conversion_options(args)
    if args.target_epsg:
        print(
            "[solutions-cog] projection: "
            f"target=EPSG:{args.target_epsg} "
            f"resolution={conversion['targetResolution']} "
            f"aligned={conversion['targetAlignedPixels']}"
        )

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
                conversion=conversion,
                target_epsg=args.target_epsg,
                target_resolution=args.target_resolution,
                target_aligned_pixels=args.target_aligned_pixels,
                force_download=args.no_cache,
                force_rebuild=args.force_rebuild,
            )
            entries.append(entry)
            print(
                f"[solutions-cog]   {entry['status']}: {entry['stagedPath']} "
                f"(source=EPSG:{entry['sourceRaster'].get('epsg')}, "
                f"warpRequired={entry['warpRequired']})"
            )
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
        "conversion": conversion,
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
