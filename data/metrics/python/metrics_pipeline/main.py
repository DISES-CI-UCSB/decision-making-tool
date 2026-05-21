"""Tier 1 metrics CLI — multi-geography cached output.

Usage:

    # One solution (smoke test)
    python data/metrics/python/metrics_pipeline/main.py --limit 1

    # All solutions
    python data/metrics/python/metrics_pipeline/main.py

    # Skip sub-national boundary calculation
    python data/metrics/python/metrics_pipeline/main.py --national-only

    # Validate manifest + boundary availability; do not compute
    python data/metrics/python/metrics_pipeline/main.py --validate-only

For each solution, this script:
1. Fetches the Vercel Blob manifest and (optionally) downloads boundary data from
   IGAC ArcGIS REST (departments + municipalities) and Vercel Blob (SIRAPs).
2. Computes Tier 1 metrics at:
   - national  : full solution raster vs. Colombia
   - departments: solution raster masked to each IGAC department
   - municipalities: solution raster masked to each IGAC municipality
   - siraps : solution raster masked to each SIRAP polygon
3. Writes one multi-geography JSON per solution to:
   data/metrics/generated/<output_dir>/cache/<solution_id>.metrics.json
4. Writes a publish-report.json listing what was generated and the expected
   Vercel Blob upload target (metrics/cache/<solution_id>.metrics.json).
"""

from __future__ import annotations

import argparse
import sys
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np

from blob_manifest import (
    DEFAULT_MANIFEST_URL,
    ManifestError,
    ResolvedManifest,
    fetch_manifest,
    resolve_layer_display_url,
    solution_blob_basename,
)
from boundaries.boundary_loader import BoundaryFeature, load_all_boundaries
from boundaries.boundary_mask import BoundaryMaskCache
from local_io import (
    DEFAULT_CACHE_DIR,
    DEFAULT_OUTPUT_DIR,
    cached_download,
    expected_cache_blob_path,
    expected_cache_public_url,
    write_publish_report,
    write_solution_cache,
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
    read_layer_mask,
    read_solution_raster,
)
from calculators import area as calc_area
from calculators import ecosystem_coverage as calc_ecosystem
from calculators import social_governance as calc_social

_OVERLAP_CALCULATORS = {
    "ecosistemas": calc_ecosystem.ecosystem_total_km2,
    "paramos":     calc_ecosystem.paramo_km2,
    "bosque_seco": calc_ecosystem.dry_forest_km2,
    "wetlands":    calc_ecosystem.wetlands_km2,
    "mangroves":   calc_ecosystem.mangroves_km2,
    "resguardos":  calc_social.indigenous_reservations_km2,
    "comunidades": calc_social.community_councils_km2,
}

# Metric kinds that are only meaningful at national scope (sourced from manifest metadata).
_NATIONAL_ONLY_KINDS = frozenset({"metadata_summary", "metadata_coverage"})


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ---------------------------------------------------------------------------
# In-memory layer mask cache
# ---------------------------------------------------------------------------

class _LayerMaskCache:
    """Caches layer TIF numpy masks in memory for the duration of one pipeline run.

    Layer TIFs are the same grid as all solution rasters, so we only need to read
    each one once. If the fingerprint changes between solutions, we clear and reload.
    """

    def __init__(self) -> None:
        self._masks: dict[str, np.ndarray] = {}
        self._last_fingerprint = None

    def get(
        self,
        layer_id: str,
        url: str,
        fingerprint,
        rendering: dict,
        cache_dir: Path,
        force: bool,
    ) -> np.ndarray:
        if self._last_fingerprint is not None and not self._last_fingerprint.matches(fingerprint):
            self._masks.clear()
        self._last_fingerprint = fingerprint

        if layer_id not in self._masks:
            dl = cached_download(url, cache_dir, force=force)
            self._masks[layer_id] = read_layer_mask(dl.path, fingerprint, rendering=rendering)
        return self._masks[layer_id]


# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------

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
        help=f"Local raster + boundary download cache (default: {DEFAULT_CACHE_DIR}).",
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
        help="Force re-download of rasters even if cached files are present.",
    )
    parser.add_argument(
        "--national-only",
        action="store_true",
        help="Skip sub-national boundary computation (national level only).",
    )
    parser.add_argument(
        "--validate-only",
        action="store_true",
        help="Fetch manifest + check required layers exist; do not compute or write.",
    )
    return parser.parse_args(argv)


# ---------------------------------------------------------------------------
# Solution selection
# ---------------------------------------------------------------------------

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
    missing: list[str] = []
    for layer_id in required_layer_ids():
        try:
            resolve_layer_display_url(manifest, layer_id)
        except ManifestError:
            missing.append(layer_id)
    return missing


# ---------------------------------------------------------------------------
# Metric value builders
# ---------------------------------------------------------------------------

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


def _not_applicable(definition: MetricDefinition) -> dict[str, Any]:
    return _metric_value(
        definition,
        value=None,
        status="not_applicable",
        notes="Metric is only available at national scope.",
        source="n/a",
    )


def _empty_boundary(definition: MetricDefinition) -> dict[str, Any]:
    """Used when the boundary mask has zero valid pixels (no raster overlap)."""
    return _metric_value(
        definition,
        value=0.0 if definition.unit in ("km2", "%") else None,
        status="empty",
        notes="Boundary does not intersect the solution raster extent.",
        source="raster:boundary_mask",
    )


# ---------------------------------------------------------------------------
# Individual metric computers (operate on a SolutionRaster, may be masked)
# ---------------------------------------------------------------------------

def _compute_metadata_summary(definition: MetricDefinition, solution: dict[str, Any]) -> dict[str, Any]:
    summary = solution.get("summaryMetrics") or {}
    pct = summary.get("pctTargetsMet")
    if isinstance(pct, (int, float)):
        return _metric_value(
            definition, value=float(pct), status="ready",
            notes="From manifest summaryMetrics.pctTargetsMet.",
            source="manifest:summaryMetrics",
        )
    return _metric_value(
        definition, value=None, status="derivation_needed",
        notes="summaryMetrics.pctTargetsMet missing; recompute upstream.",
        source="manifest:summaryMetrics",
    )


def _compute_metadata_coverage(definition: MetricDefinition, solution: dict[str, Any]) -> dict[str, Any]:
    coverage = solution.get("coverage")
    if not isinstance(coverage, list) or not coverage:
        return _metric_value(
            definition, value=None, status="derivation_needed",
            notes="No coverage rows in manifest; species-group definition needs review.",
            source="manifest:coverage",
        )
    met_count = sum(1 for row in coverage if isinstance(row, dict) and row.get("met") is True)
    return _metric_value(
        definition, value=met_count, status="ready",
        notes=f"Counted {met_count} of {len(coverage)} coverage rows with met == true.",
        source="manifest:coverage",
    )


def _compute_selected_area(definition: MetricDefinition, raster: SolutionRaster, subnational: bool = False) -> dict[str, Any]:
    value = calc_area.selected_area_km2(raster)
    context = "within boundary" if subnational else "national"
    return _metric_value(
        definition, value=value, status="ready",
        notes=(
            f"{raster.selected_cells:,} selected cells ({context}); "
            "area summed using per-row pixel area (km²/cell)."
        ),
        source="raster:solution",
    )


def _compute_national_percent(
    definition: MetricDefinition, raster: SolutionRaster, subnational: bool = False
) -> dict[str, Any]:
    pct = calc_area.national_contribution_pct(raster)
    if pct is None:
        return _metric_value(
            definition, value=None, status="blocked",
            notes="Raster has 0 valid area in this region.",
            source="raster:solution",
        )
    if subnational:
        return _metric_value(
            definition, value=pct, status="ready",
            notes="selectedArea / boundaryValidArea × 100 (boundary scope).",
            source="raster:solution",
        )
    return _metric_value(
        definition, value=pct, status="ready",
        notes="selectedArea / totalValidArea × 100 (national raster as denominator).",
        source="raster:solution",
    )


def _compute_overlap_from_mask(
    definition: MetricDefinition,
    raster: SolutionRaster,
    layer_mask: np.ndarray,
    layer_id: str,
    rendering: dict,
) -> dict[str, Any]:
    calc_fn = _OVERLAP_CALCULATORS.get(layer_id)
    if calc_fn is None:
        return _metric_value(
            definition, value=None, status="pending",
            notes=f"No calculator registered for layer '{layer_id}'.",
            source=f"raster:{layer_id}",
        )
    area = calc_fn(raster, layer_mask)
    value_type = str(rendering.get("valueType") or "unknown").lower()
    if value_type == "binary":
        present_rule = f"cells equal to selectedValue={rendering.get('selectedValue', 1)}"
    else:
        present_rule = "all valid (non-nodata) cells"
    return _metric_value(
        definition, value=area, status="ready",
        notes=f"Selected ∩ '{layer_id}' ({value_type}; presence = {present_rule}).",
        source=f"raster:{layer_id}",
    )


def _compute_overlap_download(
    definition: MetricDefinition,
    raster: SolutionRaster,
    manifest: ResolvedManifest,
    layer_cache: _LayerMaskCache,
    cache_dir: Path,
    force_download: bool,
) -> tuple[dict[str, Any], np.ndarray | None]:
    """Download (or retrieve cached) layer mask, compute overlap, return (metric, mask)."""
    layer_id = definition.layer_id or ""
    try:
        layer_url = resolve_layer_display_url(manifest, layer_id)
    except ManifestError as exc:
        return _metric_value(
            definition, value=None, status="blocked",
            notes=f"Layer '{layer_id}' unavailable in manifest: {exc}",
            source=f"raster:{layer_id}",
        ), None

    rendering = manifest.layers_by_id.get(layer_id, {}).get("rendering") or {}
    try:
        mask = layer_cache.get(layer_id, layer_url, raster.fingerprint, rendering, cache_dir, force_download)
    except (RasterError, OSError) as exc:
        return _metric_value(
            definition, value=None, status="blocked",
            notes=f"Could not read layer '{layer_id}': {exc}",
            source=f"raster:{layer_id}",
        ), None

    metric = _compute_overlap_from_mask(definition, raster, mask, layer_id, rendering)
    return metric, mask


# ---------------------------------------------------------------------------
# Build metrics list for a given raster scope
# ---------------------------------------------------------------------------

def _build_metrics(
    raster: SolutionRaster,
    solution: dict[str, Any],
    manifest: ResolvedManifest,
    layer_cache: _LayerMaskCache,
    cache_dir: Path,
    force_download: bool,
    *,
    subnational: bool = False,
    preloaded_layer_masks: dict[str, np.ndarray] | None = None,
) -> list[dict[str, Any]]:
    """Compute all computable Tier 1 metrics for one raster scope.

    - subnational=True: skip manifest-sourced metadata metrics (mark not_applicable).
    - preloaded_layer_masks: if provided, skip layer downloads and use these directly.
    """
    results: list[dict[str, Any]] = []

    if subnational and raster.valid_cells == 0:
        return [_empty_boundary(defn) for defn in computable_metrics()]

    for defn in computable_metrics():
        if defn.kind in _NATIONAL_ONLY_KINDS:
            if subnational:
                results.append(_not_applicable(defn))
            elif defn.kind == "metadata_summary":
                results.append(_compute_metadata_summary(defn, solution))
            else:
                results.append(_compute_metadata_coverage(defn, solution))

        elif defn.kind == "selected_area":
            results.append(_compute_selected_area(defn, raster, subnational=subnational))

        elif defn.kind == "national_percent":
            results.append(_compute_national_percent(defn, raster, subnational=subnational))

        elif defn.kind == "binary_overlap_area":
            layer_id = defn.layer_id or ""
            if preloaded_layer_masks and layer_id in preloaded_layer_masks:
                rendering = manifest.layers_by_id.get(layer_id, {}).get("rendering") or {}
                results.append(
                    _compute_overlap_from_mask(defn, raster, preloaded_layer_masks[layer_id], layer_id, rendering)
                )
            else:
                metric, _ = _compute_overlap_download(defn, raster, manifest, layer_cache, cache_dir, force_download)
                results.append(metric)

        else:
            results.append(
                _metric_value(defn, value=None, status="pending",
                              notes=f"Unhandled metric kind '{defn.kind}'.", source="script")
            )

    return results


def _status_counts(metric_values: list[dict[str, Any]]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for mv in metric_values:
        counts[mv["status"]] = counts.get(mv["status"], 0) + 1
    return counts


# ---------------------------------------------------------------------------
# Main solution processor
# ---------------------------------------------------------------------------

def _preload_layer_masks(
    raster: SolutionRaster,
    manifest: ResolvedManifest,
    layer_cache: _LayerMaskCache,
    cache_dir: Path,
    force_download: bool,
) -> dict[str, np.ndarray]:
    """Load all layer TIFs into the in-memory cache and return a dict of masks.

    These masks are then passed directly to sub-national metric computation,
    avoiding repeated disk reads for each of the 1000+ boundary features.
    """
    masks: dict[str, np.ndarray] = {}
    for layer_id in required_layer_ids():
        try:
            url = resolve_layer_display_url(manifest, layer_id)
            rendering = manifest.layers_by_id.get(layer_id, {}).get("rendering") or {}
            masks[layer_id] = layer_cache.get(layer_id, url, raster.fingerprint, rendering, cache_dir, force_download)
        except (ManifestError, RasterError, OSError) as exc:
            print(f"[tier1-metrics]   WARNING: could not preload layer '{layer_id}': {exc}", file=sys.stderr)
    return masks


def _process_solution(
    solution: dict[str, Any],
    manifest: ResolvedManifest,
    cache_dir: Path,
    output_dir: Path,
    force_download: bool,
    layer_cache: _LayerMaskCache,
    boundary_mask_cache: BoundaryMaskCache,
    boundaries_by_level: dict[str, list[BoundaryFeature]],
    national_only: bool = False,
) -> dict[str, Any]:
    basename = solution_blob_basename(solution)
    solution_id = str(solution.get("id"))
    started = time.time()

    download = cached_download(solution["displayUrl"], cache_dir, force=force_download)
    raster = read_solution_raster(download.path)

    # --- National level ---
    national_metrics = _build_metrics(
        raster, solution, manifest, layer_cache, cache_dir, force_download
    )

    geographies: dict[str, Any] = {
        "national": {
            "colombia": {
                "name": "Colombia",
                "metrics": national_metrics,
            }
        }
    }

    # --- Sub-national levels ---
    if not national_only and boundaries_by_level:
        # Preload all layer masks into memory once per solution.
        print(f"[tier1-metrics]   preloading {len(required_layer_ids())} layer mask(s)…")
        layer_masks = _preload_layer_masks(raster, manifest, layer_cache, cache_dir, force_download)

        # Rasterize all boundary polygons if not already cached (first solution).
        print(f"[tier1-metrics]   rasterizing boundaries…")
        boundary_mask_cache.precompute_all(boundaries_by_level, raster.fingerprint)

        for geo_level, features in boundaries_by_level.items():
            level_out: dict[str, Any] = {}
            for feat in features:
                px_mask = boundary_mask_cache.get(
                    feat.geo_level, feat.boundary_id, feat.geometry, raster.fingerprint
                )
                masked = raster.with_boundary_mask(px_mask)
                metrics = _build_metrics(
                    masked, solution, manifest, layer_cache, cache_dir, force_download,
                    subnational=True,
                    preloaded_layer_masks=layer_masks,
                )
                entry: dict[str, Any] = {"name": feat.name, "metrics": metrics}
                # Include sirap_kind if present.
                if "sirap_kind" in feat.properties:
                    entry["kind"] = feat.properties["sirap_kind"]
                level_out[feat.boundary_id] = entry
            geographies[geo_level] = level_out
            print(f"[tier1-metrics]   {geo_level}: {len(level_out)} features processed")

    generated_at = _utc_now_iso()
    doc = {"solutionId": solution_id, "generatedAt": generated_at, "geographies": geographies}
    cache_path = write_solution_cache(output_dir, solution_id, doc)
    print(f"[tier1-metrics]   cache → {cache_path}")

    return {
        "solutionId": solution_id,
        "solutionBasename": basename,
        "cachePath": str(cache_path),
        "expectedBlobPath": expected_cache_blob_path(solution_id),
        "expectedPublicUrl": expected_cache_public_url(manifest.public_blob_host, solution_id),
        "rasterCacheSha256": download.sha256,
        "selectedCells": raster.selected_cells,
        "validCells": raster.valid_cells,
        "selectedAreaKm2": raster.selected_area_km2,
        "validAreaKm2": raster.valid_area_km2,
        "geographyLevels": list(geographies.keys()),
        "nationalMetricStatusCounts": _status_counts(national_metrics),
        "elapsedSeconds": round(time.time() - started, 2),
    }


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    print(f"[tier1-metrics] manifest: {args.manifest_url}")

    try:
        manifest = fetch_manifest(args.manifest_url)
    except ManifestError as exc:
        print(f"[tier1-metrics] ERROR: {exc}", file=sys.stderr)
        return 2

    print(
        f"[tier1-metrics] loaded {len(manifest.layers_by_id)} layers, "
        f"{len(manifest.national_solutions)} nacional solutions"
    )

    missing_layers = _validate_required_layers(manifest)
    if missing_layers:
        print(
            f"[tier1-metrics] WARNING: missing displayUrl for layers: {missing_layers}. "
            "Affected metrics will be marked 'blocked'.",
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

    # --- Load boundary data ---
    boundaries_by_level: dict[str, list[BoundaryFeature]] = {}
    boundary_errors: dict[str, str] = {}
    if not args.national_only:
        boundaries_by_level, boundary_errors = load_all_boundaries(args.cache_dir)
        for level, feats in boundaries_by_level.items():
            print(f"[tier1-metrics] boundaries: {level} → {len(feats)} features")
        for level, err in boundary_errors.items():
            print(
                f"[tier1-metrics] WARNING: could not load '{level}' boundaries: {err}",
                file=sys.stderr,
            )
        if not boundaries_by_level:
            print("[tier1-metrics] WARNING: all boundary levels failed; national-only.", file=sys.stderr)

    args.output_dir.mkdir(parents=True, exist_ok=True)
    args.cache_dir.mkdir(parents=True, exist_ok=True)

    layer_cache = _LayerMaskCache()
    boundary_mask_cache = BoundaryMaskCache()

    deferred = sorted(deferred_metric_ids())
    entries: list[dict[str, Any]] = []
    failures: list[dict[str, Any]] = []

    for index, solution in enumerate(solutions, start=1):
        solution_id = str(solution.get("id"))
        print(f"[tier1-metrics] [{index}/{len(solutions)}] {solution_id}")
        try:
            entries.append(
                _process_solution(
                    solution=solution,
                    manifest=manifest,
                    cache_dir=args.cache_dir,
                    output_dir=args.output_dir,
                    force_download=args.no_cache,
                    layer_cache=layer_cache,
                    boundary_mask_cache=boundary_mask_cache,
                    boundaries_by_level=boundaries_by_level,
                    national_only=args.national_only,
                )
            )
        except Exception as exc:
            failures.append({
                "solutionId": solution_id,
                "error": str(exc),
                "traceback": traceback.format_exc(),
            })
            print(f"[tier1-metrics]   FAILED: {exc}", file=sys.stderr)

    geo_levels = sorted({lvl for e in entries for lvl in e.get("geographyLevels", [])})
    report = {
        "generatedAt": _utc_now_iso(),
        "manifestUrl": args.manifest_url,
        "manifestGeneratedAt": manifest.raw.get("generatedAt"),
        "publicBlobHost": manifest.public_blob_host,
        "outputDir": str(args.output_dir),
        "cacheDir": str(args.cache_dir),
        "geographyLevels": geo_levels,
        "boundaryErrors": boundary_errors if not args.national_only else {},
        "metricCatalog": [m.metric_id for m in METRIC_CATALOG],
        "deferredMetricIds": deferred,
        "missingRequiredLayers": missing_layers,
        "entries": entries,
        "failures": failures,
    }
    report_path = write_publish_report(args.output_dir, report)
    print(f"[tier1-metrics] wrote publish report → {report_path}")
    print(
        f"[tier1-metrics] done: {len(entries)} solution(s) written, "
        f"{len(failures)} failure(s)"
    )
    return 0 if not failures else 1


if __name__ == "__main__":
    raise SystemExit(main())
