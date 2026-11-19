"""Tier 1 metrics CLI entry point.

Usage example:

    python data/scripts/tier1-metrics/main.py \
        --output-dir data/metrics/generated/tier1 \
        --cache-dir data/metrics/cache/tier1 \
        --limit 1

Reads the public Vercel Blob layer manifest, batches every nacional
solution, computes the single-solution Tier 1 metrics, and writes one
SolutionMetricsResponse-shaped JSON sidecar per solution to a local staged
path that mirrors the Blob layout. Also writes a publish-report.json that
maps each staged file to the Blob path/URL it should be uploaded to.
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
    resolve_layer_display_url,
    solution_blob_basename,
)
from local_io import (
    DEFAULT_CACHE_DIR,
    DEFAULT_OUTPUT_DIR,
    cached_download,
    expected_blob_path,
    expected_public_url,
    write_publish_report,
    write_solution_sidecar,
)
from metric_definitions import (
    METRIC_CATALOG,
    MetricDefinition,
    computable_metrics,
    deferred_metric_ids,
    required_layer_ids,
)
from raster_metrics import (
    RasterError,
    SolutionRaster,
    overlap_km2,
    read_layer_mask,
    read_solution_raster,
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
        "--validate-only",
        action="store_true",
        help="Fetch manifest + check required layers exist; do not compute or write.",
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


def _validate_required_layers(manifest: ResolvedManifest) -> list[str]:
    """Return the list of layer ids missing displayUrl in the manifest."""

    missing: list[str] = []
    for layer_id in required_layer_ids():
        try:
            resolve_layer_display_url(manifest, layer_id)
        except ManifestError:
            missing.append(layer_id)
    return missing


def _metric_value(
    definition: MetricDefinition,
    *,
    value: float | int | None,
    status: str,
    notes: str | None,
    source: str,
) -> dict[str, Any]:
    return {
        "metricId": definition.metric_id,
        "value": value,
        "unit": definition.unit,
        "status": status,
        "source": source,
        "notes": notes,
        "labelKey": definition.label_key,
        "formatHint": definition.format_hint,
    }


def _compute_metadata_summary(
    definition: MetricDefinition, solution: dict[str, Any]
) -> dict[str, Any]:
    summary = solution.get("summaryMetrics") or {}
    pct = summary.get("pctTargetsMet")
    if isinstance(pct, (int, float)):
        return _metric_value(
            definition,
            value=float(pct),
            status="ready",
            notes="From manifest summaryMetrics.pctTargetsMet.",
            source="manifest:summaryMetrics",
        )
    return _metric_value(
        definition,
        value=None,
        status="derivation_needed",
        notes="summaryMetrics.pctTargetsMet missing; recompute upstream.",
        source="manifest:summaryMetrics",
    )


def _compute_metadata_coverage(
    definition: MetricDefinition, solution: dict[str, Any]
) -> dict[str, Any]:
    coverage = solution.get("coverage")
    if not isinstance(coverage, list) or not coverage:
        return _metric_value(
            definition,
            value=None,
            status="derivation_needed",
            notes="No coverage rows in manifest; species-group definition needs review.",
            source="manifest:coverage",
        )
    met_count = sum(1 for row in coverage if isinstance(row, dict) and row.get("met") is True)
    return _metric_value(
        definition,
        value=met_count,
        status="ready",
        notes=f"Counted {met_count} of {len(coverage)} coverage rows with met == true.",
        source="manifest:coverage",
    )


def _compute_selected_area(
    definition: MetricDefinition, raster: SolutionRaster
) -> dict[str, Any]:
    return _metric_value(
        definition,
        value=raster.selected_area_km2,
        status="ready",
        notes=(
            f"{raster.selected_cells:,} selected cells; total area summed using "
            "per-row pixel area (km^2/cell)."
        ),
        source="raster:solution",
    )


def _compute_national_percent(
    definition: MetricDefinition, raster: SolutionRaster
) -> dict[str, Any]:
    if raster.valid_area_km2 == 0:
        return _metric_value(
            definition,
            value=None,
            status="blocked",
            notes="Solution raster has 0 valid area.",
            source="raster:solution",
        )
    pct = (raster.selected_area_km2 / raster.valid_area_km2) * 100.0
    return _metric_value(
        definition,
        value=pct,
        status="ready",
        notes="selectedArea / totalValidArea × 100 (national raster as denominator).",
        source="raster:solution",
    )


def _compute_overlap(
    definition: MetricDefinition,
    raster: SolutionRaster,
    manifest: ResolvedManifest,
    cache_dir: Path,
    force_download: bool,
) -> dict[str, Any]:
    layer_id = definition.layer_id or ""
    try:
        layer_url = resolve_layer_display_url(manifest, layer_id)
    except ManifestError as exc:
        return _metric_value(
            definition,
            value=None,
            status="blocked",
            notes=f"Layer '{layer_id}' unavailable in manifest: {exc}",
            source=f"raster:{layer_id}",
        )

    rendering = manifest.layers_by_id.get(layer_id, {}).get("rendering") or {}
    try:
        download = cached_download(layer_url, cache_dir, force=force_download)
        layer_mask = read_layer_mask(download.path, raster.fingerprint, rendering=rendering)
    except (RasterError, OSError) as exc:
        return _metric_value(
            definition,
            value=None,
            status="blocked",
            notes=f"Could not read layer '{layer_id}': {exc}",
            source=f"raster:{layer_id}",
        )

    area = overlap_km2(raster.selected_mask, layer_mask, raster.pixel_area_km2_per_row)
    value_type = str(rendering.get("valueType") or "unknown").lower()
    if value_type == "binary":
        present_rule = f"cells equal to selectedValue={rendering.get('selectedValue', 1)}"
    else:
        present_rule = "all valid (non-nodata) cells"
    return _metric_value(
        definition,
        value=area,
        status="ready",
        notes=f"Selected ∩ '{layer_id}' ({value_type}; presence = {present_rule}).",
        source=f"raster:{layer_id}",
    )


def _process_solution(
    solution: dict[str, Any],
    manifest: ResolvedManifest,
    cache_dir: Path,
    output_dir: Path,
    force_download: bool,
) -> dict[str, Any]:
    basename = solution_blob_basename(solution)
    solution_id = str(solution.get("id"))
    started = time.time()

    solution_url = solution["displayUrl"]
    download = cached_download(solution_url, cache_dir, force=force_download)
    raster = read_solution_raster(download.path)

    metric_values: list[dict[str, Any]] = []
    for definition in computable_metrics():
        if definition.kind == "metadata_summary":
            metric_values.append(_compute_metadata_summary(definition, solution))
        elif definition.kind == "metadata_coverage":
            metric_values.append(_compute_metadata_coverage(definition, solution))
        elif definition.kind == "selected_area":
            metric_values.append(_compute_selected_area(definition, raster))
        elif definition.kind == "national_percent":
            metric_values.append(_compute_national_percent(definition, raster))
        elif definition.kind == "binary_overlap_area":
            metric_values.append(
                _compute_overlap(definition, raster, manifest, cache_dir, force_download)
            )
        else:
            metric_values.append(
                _metric_value(
                    definition,
                    value=None,
                    status="pending",
                    notes=f"Unhandled metric kind '{definition.kind}'.",
                    source="script",
                )
            )

    response = {
        "solutionId": solution_id,
        "generatedAt": _utc_now_iso(),
        "metrics": metric_values,
    }
    sidecar_path = write_solution_sidecar(output_dir, basename, response)

    return {
        "solutionId": solution_id,
        "solutionBasename": basename,
        "stagedPath": str(sidecar_path),
        "expectedBlobPath": expected_blob_path(basename),
        "expectedPublicUrl": expected_public_url(manifest.public_blob_host, basename),
        "rasterCacheSha256": download.sha256,
        "selectedCells": raster.selected_cells,
        "validCells": raster.valid_cells,
        "selectedAreaKm2": raster.selected_area_km2,
        "validAreaKm2": raster.valid_area_km2,
        "metricStatusCounts": _status_counts(metric_values),
        "elapsedSeconds": round(time.time() - started, 2),
    }


def _status_counts(metric_values: list[dict[str, Any]]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for mv in metric_values:
        counts[mv["status"]] = counts.get(mv["status"], 0) + 1
    return counts


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    print(f"[tier1-metrics] manifest: {args.manifest_url}")

    try:
        manifest = fetch_manifest(args.manifest_url)
    except ManifestError as exc:
        print(f"[tier1-metrics] ERROR: {exc}", file=sys.stderr)
        return 2

    print(
        f"[tier1-metrics] loaded {len(manifest.layers_by_id)} layers and "
        f"{len(manifest.national_solutions)} nacional solutions"
    )

    missing_layers = _validate_required_layers(manifest)
    if missing_layers:
        print(
            "[tier1-metrics] WARNING: missing displayUrl for layers required by "
            f"some metrics: {missing_layers}. Those metrics will be marked 'blocked'.",
            file=sys.stderr,
        )

    if args.validate_only:
        print("[tier1-metrics] validate-only: catalog OK, exiting before computation.")
        return 0

    try:
        solutions = _select_solutions(manifest, args.solution_id, args.limit)
    except ManifestError as exc:
        print(f"[tier1-metrics] ERROR: {exc}", file=sys.stderr)
        return 2

    print(f"[tier1-metrics] processing {len(solutions)} solution(s)")

    args.output_dir.mkdir(parents=True, exist_ok=True)
    args.cache_dir.mkdir(parents=True, exist_ok=True)

    deferred = sorted(deferred_metric_ids())
    entries: list[dict[str, Any]] = []
    failures: list[dict[str, Any]] = []

    for index, solution in enumerate(solutions, start=1):
        solution_id = str(solution.get("id"))
        print(f"[tier1-metrics] [{index}/{len(solutions)}] {solution_id}")
        try:
            entries.append(
                _process_solution(
                    solution,
                    manifest,
                    args.cache_dir,
                    args.output_dir,
                    force_download=args.no_cache,
                )
            )
        except Exception as exc:  # surface and continue so smoke runs aren't all-or-nothing
            failures.append(
                {
                    "solutionId": solution_id,
                    "error": str(exc),
                    "traceback": traceback.format_exc(),
                }
            )
            print(f"[tier1-metrics]   FAILED: {exc}", file=sys.stderr)

    report = {
        "generatedAt": _utc_now_iso(),
        "manifestUrl": args.manifest_url,
        "manifestGeneratedAt": manifest.raw.get("generatedAt"),
        "publicBlobHost": manifest.public_blob_host,
        "outputDir": str(args.output_dir),
        "cacheDir": str(args.cache_dir),
        "metricCatalog": [m.metric_id for m in METRIC_CATALOG],
        "deferredMetricIds": deferred,
        "missingRequiredLayers": missing_layers,
        "entries": entries,
        "failures": failures,
    }
    report_path = write_publish_report(args.output_dir, report)
    print(f"[tier1-metrics] wrote publish report -> {report_path}")
    print(
        f"[tier1-metrics] done: {len(entries)} sidecar(s) written, "
        f"{len(failures)} failure(s)"
    )
    return 0 if not failures else 1


if __name__ == "__main__":
    raise SystemExit(main())
