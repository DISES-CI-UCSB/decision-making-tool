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

    # Split a full batch across two workers (zero-based chunk indexes)
    python data/metrics/python/metrics_pipeline/main.py --chunk-count 2 --chunk-index 0
    python data/metrics/python/metrics_pipeline/main.py --chunk-count 2 --chunk-index 1

For each solution, this script:
1. Fetches the Vercel Blob manifest and validates version-pinned AOI snapshots
   matching the frontend's IGAC, SIRAP, RUNAP, and OMEC identify sources.
2. Computes Tier 1 metrics at:
   - national  : full solution raster vs. Colombia
   - departments: solution raster masked to each IGAC department
   - municipalities: solution raster masked to each IGAC municipality
   - siraps : solution raster masked to each SIRAP polygon
3. Writes one multi-geography JSON per solution to:
   data/metrics/generated/<output_dir>/cache/<solution_id>.metrics.json
4. Writes a publish-report.json listing what was generated and the expected
   Vercel Blob upload target (metrics/cache/<solution_id>.metrics.json by default).

After generation, inspect then publish (from repo root):

    python data/metrics/python/metrics_pipeline/inspect_metrics.py
    python data/metrics/python/metrics_pipeline/publish.py
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

import numpy as np

from blob_manifest import (
    DEFAULT_MANIFEST_URL,
    ManifestError,
    ResolvedManifest,
    fetch_manifest,
    resolve_layer_display_url,
    solution_blob_basename,
)
from boundaries.boundary_id_grid import BoundaryIdGrid, BoundaryIdGridCache
from boundaries.boundary_loader import BoundaryFeature, load_all_boundaries
from boundaries.boundary_mask import BoundaryMaskCache
from calculator_registry import (
    categorical_area_calculator,
    overlap_area_calculator,
    overlap_percent_calculator,
    weighted_percent_calculator,
    weighted_sum_calculator,
)
from local_io import (
    CACHE_BLOB_DIRECTORY,
    DEFAULT_CACHE_DIR,
    DEFAULT_OUTPUT_DIR,
    cache_solution_path,
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
    is_species_metric_kind,
    off_manifest_layer_renderings,
    off_manifest_layer_urls,
    required_layer_ids,
    species_metric_ids,
)
from metric_output import (
    blocked_no_data as _blocked_no_data,
    empty_boundary as _empty_boundary,
    metric_value as _metric_value,
    not_applicable as _not_applicable,
    status_counts as _status_counts,
)
from metrics_contract import (
    METRICS_SCHEMA_VERSION,
    PROVENANCE_KEY,
    build_metrics_provenance,
    generation_config,
    provenance_issues,
)
from release_config import load_release_config
from raster_metrics import (
    RasterError,
    SolutionRaster,
    read_layer_mask,
    read_layer_values,
    read_solution_raster,
    weighted_percent_of_valid,
    weighted_sum_km2,
)
from species_data import (
    SPECIES_CSV_URL,
    SpeciesPoolSizes,
    SpeciesRecord,
    compute_pool_sizes,
    load_species_records,
    parse_solution_target_percent,
    read_species_mask,
)
from solution_domain import SolutionDomain, solution_domain
from summary_species_coverage import compute_species_group_coverage_details
from summary_metadata import resolve_summary_csv_url
from calculators import area as calc_area
from calculators.species import (
    SpeciesAccumulator,
    SpeciesScopeCounts,
    SpeciesScopeMetrics,
)

# Metric kinds that are only meaningful at national scope (sourced from manifest metadata).
_NATIONAL_ONLY_KINDS = frozenset({"metadata_summary", "metadata_coverage"})

# Off-manifest layer URLs and renderings, computed once at import time.
_OFF_MANIFEST_URLS: dict[str, str] = off_manifest_layer_urls()
_OFF_MANIFEST_RENDERINGS: dict[str, dict] = off_manifest_layer_renderings()

# How frequently to print species progress (every Nth species).
_SPECIES_PROGRESS_INTERVAL = 1000


def _resolve_layer_url(manifest: ResolvedManifest, layer_id: str) -> str:
    """Return the display URL for a layer, falling back to off-manifest blob URL."""
    try:
        return resolve_layer_display_url(manifest, layer_id)
    except ManifestError:
        if layer_id in _OFF_MANIFEST_URLS:
            return _OFF_MANIFEST_URLS[layer_id]
        raise


def _layer_rendering(manifest: ResolvedManifest, layer_id: str) -> dict:
    """Return the rendering dict for a layer (manifest preferred; off-manifest fallback)."""
    rendering = manifest.layers_by_id.get(layer_id, {}).get("rendering")
    if rendering:
        return rendering
    return _OFF_MANIFEST_RENDERINGS.get(layer_id, {})


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


class _LayerValueCache:
    """Caches numeric-layer float arrays for weighted and categorical metrics.

    Analogous to _LayerMaskCache but stores float64 arrays via read_layer_values
    instead of boolean masks.  Cleared automatically when the raster fingerprint
    changes (i.e. across solution grids — though in practice the grid is constant).
    """

    def __init__(self) -> None:
        self._arrays: dict[str, np.ndarray] = {}
        self._last_fingerprint = None

    def get(
        self,
        layer_id: str,
        url: str,
        fingerprint,
        cache_dir: Path,
        force: bool,
    ) -> np.ndarray:
        if self._last_fingerprint is not None and not self._last_fingerprint.matches(fingerprint):
            self._arrays.clear()
        self._last_fingerprint = fingerprint

        if layer_id not in self._arrays:
            dl = cached_download(url, cache_dir, force=force)
            self._arrays[layer_id] = read_layer_values(dl.path, fingerprint)
        return self._arrays[layer_id]


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
        "--cache-blob-directory",
        default=CACHE_BLOB_DIRECTORY,
        help=(
            "Vercel Blob prefix recorded in publish-report.json for generated metric caches "
            f"(default: {CACHE_BLOB_DIRECTORY})."
        ),
    )
    parser.add_argument(
        "--release-id",
        default=None,
        help="Use the immutable regular verbose prefix for this explicit release id.",
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
        "--force",
        action="store_true",
        help="Recompute solution metrics even when output cache files already exist.",
    )
    parser.add_argument(
        "--chunk-index",
        type=int,
        default=0,
        help="Zero-based chunk index to process when splitting selected solutions across workers.",
    )
    parser.add_argument(
        "--chunk-count",
        type=int,
        default=1,
        help="Total number of chunks when splitting selected solutions across workers.",
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
    parser.add_argument(
        "--skip-species",
        action="store_true",
        help="Skip the species pass (#3, #21–#26, #28). Useful for fast smoke tests.",
    )
    parser.add_argument(
        "--skip-species-boundary-level",
        action="append",
        choices=("departments", "municipalities", "siraps", "runaps", "omecs"),
        default=[],
        help=(
            "Skip species fan-out for a boundary level while keeping non-species metrics "
            "for that level. Repeatable, e.g. runaps + omecs for faster large batches."
        ),
    )
    parser.add_argument(
        "--species-csv-url",
        default=SPECIES_CSV_URL,
        help=f"Override the species CSV URL (default: {SPECIES_CSV_URL}).",
    )
    args = parser.parse_args(argv)
    if args.chunk_count < 1:
        parser.error("--chunk-count must be at least 1")
    if args.chunk_index < 0 or args.chunk_index >= args.chunk_count:
        parser.error("--chunk-index must be between 0 and --chunk-count - 1")
    return args


# ---------------------------------------------------------------------------
# Solution selection
# ---------------------------------------------------------------------------

def _select_solutions(
    manifest: ResolvedManifest,
    only_ids: list[str] | None,
    limit: int | None,
) -> list[dict[str, Any]]:
    solutions = manifest.batch_solutions
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


def _chunk_solutions(
    solutions: list[dict[str, Any]],
    *,
    chunk_index: int,
    chunk_count: int,
) -> list[dict[str, Any]]:
    if chunk_count == 1:
        return solutions
    return [
        solution for index, solution in enumerate(solutions)
        if index % chunk_count == chunk_index
    ]


def _resume_entry_for_existing_cache(
    solution: dict[str, Any],
    manifest: ResolvedManifest,
    output_dir: Path,
    cache_blob_directory: str,
    *,
    national_only: bool = False,
    skip_species: bool = False,
    skip_species_boundary_levels: set[str] | None = None,
    species_csv_url: str = SPECIES_CSV_URL,
    release_id: str | None = None,
) -> dict[str, Any] | None:
    """Return a publish-report entry for an existing valid cache file, if present."""
    solution_id = str(solution.get("id"))
    domain = solution_domain(solution)
    cache_path = cache_solution_path(output_dir, solution_id)
    if not cache_path.exists():
        return None

    try:
        doc = json.loads(cache_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None

    geographies = doc.get("geographies")
    if doc.get("solutionId") != solution_id or not isinstance(geographies, dict):
        return None

    expected_config = generation_config(
        domain,
        national_only=national_only,
        skip_species=skip_species,
        skip_species_boundary_levels=skip_species_boundary_levels or set(),
        species_csv_url=species_csv_url,
    )
    contract_issues = provenance_issues(
        doc,
        expected_domain=domain,
        expected_config=expected_config,
        expected_release_id=release_id,
    )
    if contract_issues:
        print(
            f"[tier1-metrics]   stale cache '{cache_path}' will be recomputed: "
            f"{contract_issues[0]}",
            file=sys.stderr,
        )
        return None

    national_metrics = (
        geographies.get("national", {})
        .get("colombia", {})
        .get("metrics", [])
    )
    return {
        "solutionId": solution_id,
        "solutionBasename": solution_blob_basename(solution),
        "cachePath": str(cache_path),
        "expectedBlobPath": expected_cache_blob_path(
            solution_id,
            cache_blob_directory=cache_blob_directory,
        ),
        "expectedPublicUrl": expected_cache_public_url(
            manifest.public_blob_host,
            solution_id,
            cache_blob_directory=cache_blob_directory,
        ),
        "geographyLevels": list(geographies.keys()),
        "nationalMetricStatusCounts": (
            _status_counts(national_metrics)
            if isinstance(national_metrics, list)
            else {}
        ),
        "solutionDomain": domain,
        "catalogSignature": doc[PROVENANCE_KEY]["catalogSignature"],
        "resumeSkipped": True,
        "elapsedSeconds": 0.0,
    }


def _validate_required_layers(manifest: ResolvedManifest) -> list[str]:
    missing: list[str] = []
    for layer_id in required_layer_ids():
        try:
            _resolve_layer_url(manifest, layer_id)
        except ManifestError:
            missing.append(layer_id)
    return missing


def _compute_aoi_percent(
    definition: MetricDefinition, raster: SolutionRaster, subnational: bool
) -> dict[str, Any]:
    """#19 — selected / valid × 100 within the current scope.

    At national scope this duplicates #17, so we mark it not_applicable there.
    At boundary scope it answers "what % of this region is selected?".
    """
    if not subnational:
        return _metric_value(
            definition, value=None, status="not_applicable",
            notes="Same as national_contribution (#17) at national scope; reported there.",
            source="n/a",
        )
    if raster.valid_cells == 0:
        return _metric_value(
            definition, value=None, status="blocked",
            notes="Boundary has no valid cells.",
            source="raster:solution",
        )
    pct = calc_area.national_contribution_pct(raster)
    if pct is None:
        return _metric_value(
            definition, value=None, status="blocked",
            notes="Raster has 0 valid area in this region.",
            source="raster:solution",
        )
    return _metric_value(
        definition, value=pct, status="ready",
        notes="selectedArea / boundaryValidArea × 100.",
        source="raster:solution",
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


def _compute_metadata_coverage(
    definition: MetricDefinition,
    solution: dict[str, Any],
    cache_dir: Path,
    force_download: bool,
    species_records: list[SpeciesRecord] | None,
) -> dict[str, Any]:
    summary_metric = _compute_metadata_summary_csv_coverage(
        definition,
        solution,
        cache_dir,
        force_download,
        species_records,
    )
    if summary_metric is not None:
        return summary_metric

    coverage = solution.get("coverage")
    if not isinstance(coverage, list) or not coverage:
        return _metric_value(
            definition, value=None, status="derivation_needed",
            notes="No usable summary CSV species coverage or manifest coverage rows.",
            source="manifest:coverage",
        )
    met_count = sum(1 for row in coverage if isinstance(row, dict) and row.get("met") is True)
    return _metric_value(
        definition, value=met_count, status="ready",
        notes=f"Counted {met_count} of {len(coverage)} coverage rows with met == true.",
        source="manifest:coverage",
    )


def _compute_metadata_summary_csv_coverage(
    definition: MetricDefinition,
    solution: dict[str, Any],
    cache_dir: Path,
    force_download: bool,
    species_records: list[SpeciesRecord] | None,
) -> dict[str, Any] | None:
    if definition.metric_id != "species_groups_protected" or not species_records:
        return None

    metadata_url = solution.get("metadataUrl")
    if not isinstance(metadata_url, str) or not metadata_url:
        return None

    summary_url = resolve_summary_csv_url(metadata_url)
    try:
        summary_download = cached_download(summary_url, cache_dir, force=force_download)
        details = compute_species_group_coverage_details(summary_download.path, species_records)
    except Exception as exc:
        print(
            f"[tier1-metrics]   WARNING: could not compute species group coverage from summary CSV: {exc}",
            file=sys.stderr,
        )
        return None

    if details is None:
        return None

    summary = details["summary"]
    met_species_count = int(summary["metSpeciesCount"])
    total_species_count = int(summary["totalSpeciesCount"])
    group_count = len(details["groups"])
    return _metric_value(
        definition,
        value=met_species_count,
        status="ready",
        notes=(
            f"{met_species_count:,} of {total_species_count:,} species rows met targets "
            f"across {group_count} taxonomic group(s). See details.groups for per-group ratios."
        ),
        source="solution:metadataUrl:summary_csv+csv:biomod_spp_ranges_updatedIUCN",
        details=details,
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
    if definition.kind == "binary_overlap_percent_of_selected":
        calc_fn = overlap_percent_calculator(layer_id)
        if calc_fn is None:
            return _metric_value(
                definition, value=None, status="pending",
                notes=f"No percent calculator registered for layer '{layer_id}'.",
                source=f"raster:{layer_id}",
            )
        pct = calc_fn(raster, layer_mask)
        if pct is None:
            return _metric_value(
                definition, value=None, status="blocked",
                notes="Selected area is zero; cannot compute percent.",
                source=f"raster:{layer_id}",
            )
        return _metric_value(
            definition, value=pct, status="ready",
            notes=f"(Selected ∩ '{layer_id}') / selected_area × 100.",
            source=f"raster:{layer_id}",
        )

    # binary_overlap_area
    calc_fn = overlap_area_calculator(layer_id)
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
        layer_url = _resolve_layer_url(manifest, layer_id)
    except ManifestError as exc:
        return _metric_value(
            definition, value=None, status="blocked",
            notes=f"Layer '{layer_id}' unavailable: {exc}",
            source=f"raster:{layer_id}",
        ), None

    rendering = _layer_rendering(manifest, layer_id)
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


def _compute_categorical_from_values(
    definition: MetricDefinition,
    raster: SolutionRaster,
    layer_values: np.ndarray,
    layer_id: str,
) -> dict[str, Any]:
    calc_fn = categorical_area_calculator(definition.metric_id)
    if calc_fn is None:
        return _metric_value(
            definition, value=None, status="pending",
            notes=f"No categorical calculator registered for '{definition.metric_id}'.",
            source=f"raster:{layer_id}",
        )
    area = calc_fn(raster, layer_values)
    return _metric_value(
        definition, value=area, status="ready",
        notes=(
            f"Selected ∩ configured categorical classes in '{layer_id}'; "
            "nodata and non-selected cells excluded."
        ),
        source=f"raster:{layer_id}",
    )


def _compute_categorical_download(
    definition: MetricDefinition,
    raster: SolutionRaster,
    manifest: ResolvedManifest,
    value_cache: _LayerValueCache,
    cache_dir: Path,
    force_download: bool,
) -> tuple[dict[str, Any], np.ndarray | None]:
    """Load a categorical layer once and compute one class-overlap metric."""
    layer_id = definition.layer_id or ""
    try:
        layer_url = _resolve_layer_url(manifest, layer_id)
    except ManifestError as exc:
        return _metric_value(
            definition, value=None, status="blocked",
            notes=f"Layer '{layer_id}' unavailable: {exc}",
            source=f"raster:{layer_id}",
        ), None

    try:
        values = value_cache.get(
            layer_id,
            layer_url,
            raster.fingerprint,
            cache_dir,
            force_download,
        )
    except (RasterError, OSError) as exc:
        return _metric_value(
            definition, value=None, status="blocked",
            notes=f"Could not read layer '{layer_id}': {exc}",
            source=f"raster:{layer_id}",
        ), None

    return _compute_categorical_from_values(
        definition,
        raster,
        values,
        layer_id,
    ), values


def _compute_weighted_download(
    definition: MetricDefinition,
    raster: SolutionRaster,
    manifest: ResolvedManifest,
    value_cache: _LayerValueCache,
    cache_dir: Path,
    force_download: bool,
) -> tuple[dict[str, Any], np.ndarray | None]:
    """Download (or retrieve cached) continuous layer values and compute weighted metric."""
    layer_id = definition.layer_id or ""
    try:
        layer_url = _resolve_layer_url(manifest, layer_id)
    except ManifestError as exc:
        return _metric_value(
            definition, value=None, status="blocked",
            notes=f"Layer '{layer_id}' unavailable: {exc}",
            source=f"raster:{layer_id}",
        ), None

    try:
        values = value_cache.get(layer_id, layer_url, raster.fingerprint, cache_dir, force_download)
    except (RasterError, OSError) as exc:
        return _metric_value(
            definition, value=None, status="blocked",
            notes=f"Could not read layer '{layer_id}': {exc}",
            source=f"raster:{layer_id}",
        ), None

    if definition.kind == "weighted_percent_of_national":
        calc_fn = weighted_percent_calculator(layer_id)
        if calc_fn is None:
            return _metric_value(
                definition, value=None, status="pending",
                notes=f"No weighted-percent calculator for layer '{layer_id}'.",
                source=f"raster:{layer_id}",
            ), values
        result = calc_fn(raster, values)
        if result is None:
            return _metric_value(
                definition, value=None, status="blocked",
                notes="National weighted total is zero; cannot compute percent.",
                source=f"raster:{layer_id}",
            ), values
        return _metric_value(
            definition, value=result, status="ready",
            notes=f"selectedWeightedSum('{layer_id}') / nationalWeightedSum × 100.",
            source=f"raster:{layer_id}",
        ), values

    # weighted_sum
    calc_fn = weighted_sum_calculator(definition)
    if calc_fn is None:
        return _metric_value(
            definition, value=None, status="pending",
            notes=f"No weighted-sum calculator for layer '{layer_id}'.",
            source=f"raster:{layer_id}",
        ), values
    result = calc_fn(raster, values)
    return _metric_value(
        definition, value=result, status="ready",
        notes=f"sum(pixel_value × pixel_area_km²) for selected ∩ finite cells of '{layer_id}'.",
        source=f"raster:{layer_id}",
    ), values


# ---------------------------------------------------------------------------
# Species metric value extraction
# ---------------------------------------------------------------------------

# species_richness uses metric.species_bucket to pick a SpeciesScopeMetrics field.
_SPECIES_BUCKET_TO_FIELD: dict[str, str] = {
    "mammals":    "mammals_present",
    "birds":      "birds_present",
    "amphibians": "amphibians_present",
    "reptiles":   "reptiles_present",
    "plants":     "plants_present",
}


def _compute_species_metric(
    definition: MetricDefinition,
    species_metrics: SpeciesScopeMetrics | None,
    target_pct: float | None,
) -> dict[str, Any]:
    """Pull the right field out of a precomputed SpeciesScopeMetrics bundle."""
    if species_metrics is None:
        return _metric_value(
            definition, value=None, status="derivation_needed",
            notes="Species accumulator unavailable; CSV or species TIFs missing.",
            source="csv:biomod_spp_ranges_updatedIUCN",
        )

    if definition.kind == "species_group_coverage":
        if target_pct is None:
            return _metric_value(
                definition, value=None, status="derivation_needed",
                notes=(
                    "Could not derive solution target percent from solution name "
                    "(no ESTR<NN> or Ecos<NN> token found); species group coverage cannot be computed."
                ),
                source="csv:biomod_spp_ranges_updatedIUCN+raster:species_ranges",
            )
        details = species_metrics.species_group_coverage
        summary = details.get("summary") if isinstance(details, dict) else None
        met_species_count = (
            int(summary.get("metSpeciesCount", 0))
            if isinstance(summary, dict)
            else 0
        )
        total_species_count = (
            int(summary.get("totalSpeciesCount", 0))
            if isinstance(summary, dict)
            else 0
        )
        return _metric_value(
            definition,
            value=met_species_count,
            status="ready",
            notes=(
                f"{met_species_count:,} of {total_species_count:,} modeled species with usable "
                f"range rasters meet the {target_pct:g}% solution target. "
                "See details.groups for taxonomic and IUCN breakdowns."
            ),
            source="csv:biomod_spp_ranges_updatedIUCN+raster:species_ranges",
            details=details,
        )

    if definition.kind == "species_richness":
        bucket = definition.species_bucket
        field_name = _SPECIES_BUCKET_TO_FIELD.get(bucket or "")
        if not field_name:
            return _metric_value(
                definition, value=None, status="pending",
                notes=f"Unknown species_bucket '{bucket}' for {definition.metric_id}.",
                source="csv:biomod_spp_ranges_updatedIUCN",
            )
        value = int(getattr(species_metrics, field_name))
        return _metric_value(
            definition, value=value, status="ready",
            notes=f"Species count where (range ∩ priority area) > 0 in this scope (bucket: {bucket}).",
            source="csv:biomod_spp_ranges_updatedIUCN+raster:species_ranges",
        )

    if definition.kind == "species_threatened_count":
        return _metric_value(
            definition, value=int(species_metrics.threatened_present), status="ready",
            notes="CR/EN/VU non-fish species with any range pixel in the priority area.",
            source="csv:biomod_spp_ranges_updatedIUCN+raster:species_ranges",
        )

    if definition.kind == "species_threatened_secured":
        if target_pct is None:
            return _metric_value(
                definition, value=None, status="derivation_needed",
                notes=(
                    "Could not derive solution target percent from solution name "
                    "(no ESTR<NN> or Ecos<NN> token found); secured count cannot be computed."
                ),
                source="csv:biomod_spp_ranges_updatedIUCN+raster:species_ranges",
            )
        return _metric_value(
            definition, value=int(species_metrics.threatened_secured), status="ready",
            notes=(
                f"CR/EN/VU non-fish species where (range ∩ priority area within scope) "
                f"/ (range within scope) ≥ {target_pct:g}%."
            ),
            source="csv:biomod_spp_ranges_updatedIUCN+raster:species_ranges",
        )

    if definition.kind == "species_pct_of_national":
        return _metric_value(
            definition, value=float(species_metrics.pct_of_national), status="ready",
            notes="(non-fish species present in scope) / (8,300 non-fish pool) × 100.",
            source="csv:biomod_spp_ranges_updatedIUCN+raster:species_ranges",
        )

    return _metric_value(
        definition, value=None, status="pending",
        notes=f"Unhandled species kind '{definition.kind}'.",
        source="script",
    )


# ---------------------------------------------------------------------------
# Species accumulator pass (computes #3, #21–#26, #28 across all scopes)
# ---------------------------------------------------------------------------

def _process_species_for_solution(
    raster: SolutionRaster,
    solution: dict[str, Any],
    species_records: list[SpeciesRecord],
    pool_sizes: SpeciesPoolSizes,
    boundary_grids: dict[str, BoundaryIdGrid],
    cache_dir: Path,
    force_download: bool,
) -> SpeciesAccumulator:
    """Read every species range raster once and accumulate counts across scopes.

    For each species:

    - Download (cached) the species TIF, place it into a solution-grid-shaped
      bool mask, and convert to flat range pixel indices.
    - Index into the solution's selected mask at those indices to get the
      cells that are both in-range and in the priority area.
    - National counters are updated directly from those cells.
    - Sub-national counters are updated by indexing each level's
      ``BoundaryIdGrid`` at the same range indices and using ``np.bincount``
      to fan out per-boundary totals in one call.

    The caller is responsible for passing the parsed solution target percent;
    when None, the secured-count metric (#3) is reported as 'derivation_needed'.
    """
    target_pct = parse_solution_target_percent(solution.get("name") or solution.get("id") or "")

    sub_sizes = {level: g.num_boundaries for level, g in boundary_grids.items()}
    accumulator = SpeciesAccumulator(target_pct=target_pct, pool_sizes=pool_sizes)
    accumulator.init_sub(sub_sizes)

    selected_flat = raster.selected_mask.ravel()

    # Cache flat boundary-id arrays for direct dict access in the inner loop.
    bid_flats = {level: g.flat for level, g in boundary_grids.items()}

    started = time.time()
    for idx, sp in enumerate(species_records, start=1):
        if idx % _SPECIES_PROGRESS_INTERVAL == 0:
            elapsed = time.time() - started
            print(
                f"[tier1-metrics]   species: {idx}/{len(species_records)} "
                f"({elapsed:.1f}s, present_nat={accumulator.national.all_present})"
            )

        accumulator.species_processed += 1

        try:
            url = sp.blob_url
            dl = cached_download(url, cache_dir, force=force_download)
        except Exception as exc:
            accumulator.species_missing_tif += 1
            if accumulator.species_missing_tif <= 5:
                print(
                    f"[tier1-metrics]   WARN: failed to fetch species TIF '{sp.blob_filename}': {exc}",
                    file=sys.stderr,
                )
            continue

        try:
            mask = read_species_mask(dl.path, raster.fingerprint)
        except (RasterError, OSError) as exc:
            accumulator.species_missing_tif += 1
            if accumulator.species_missing_tif <= 5:
                print(
                    f"[tier1-metrics]   WARN: failed to read species TIF '{sp.blob_filename}': {exc}",
                    file=sys.stderr,
                )
            continue

        range_indices = np.flatnonzero(mask.ravel())
        total_range = int(range_indices.size)
        if total_range == 0:
            continue

        accumulator.species_with_range += 1

        selected_at_range = selected_flat[range_indices]
        n_selected_in_range = int(selected_at_range.sum())

        accumulator.record_species_national(sp, n_selected_in_range, total_range)

        if n_selected_in_range == 0:
            continue

        selected_range_indices = range_indices[selected_at_range]

        for level, bid_arr in bid_flats.items():
            bids_at_range = bid_arr[range_indices]
            bids_at_selected = bid_arr[selected_range_indices]

            n_levels = boundary_grids[level].num_boundaries
            mask_total = bids_at_range >= 0
            mask_sel = bids_at_selected >= 0
            if not mask_sel.any():
                continue

            total_per = np.bincount(
                bids_at_range[mask_total] if mask_total.any() else np.empty(0, dtype=np.int32),
                minlength=n_levels,
            )
            sel_per = np.bincount(bids_at_selected[mask_sel], minlength=n_levels)
            accumulator.record_species_sub_level(sp, level, sel_per, total_per)

    elapsed = time.time() - started
    print(
        f"[tier1-metrics]   species: done in {elapsed:.1f}s "
        f"(processed={accumulator.species_processed}, with_range={accumulator.species_with_range}, "
        f"missing={accumulator.species_missing_tif}, target_pct={target_pct})"
    )
    return accumulator


# ---------------------------------------------------------------------------
# Build metrics list for a given raster scope
# ---------------------------------------------------------------------------

def _metrics_for_domain(domain: SolutionDomain) -> tuple[MetricDefinition, ...]:
    return tuple(
        definition
        for definition in computable_metrics()
        if domain in definition.applicable_domains
    )


def _wrong_domain_metric(
    definition: MetricDefinition,
    domain: SolutionDomain,
) -> dict[str, Any]:
    supported = ", ".join(sorted(definition.applicable_domains))
    return _not_applicable(
        definition,
        notes=(
            f"Metric does not apply to the '{domain}' solution domain "
            f"(supported: {supported})."
        ),
    )


def _build_metrics(
    raster: SolutionRaster,
    solution: dict[str, Any],
    manifest: ResolvedManifest,
    layer_cache: _LayerMaskCache,
    value_cache: _LayerValueCache,
    cache_dir: Path,
    force_download: bool,
    *,
    subnational: bool = False,
    preloaded_layer_masks: dict[str, np.ndarray] | None = None,
    preloaded_layer_values: dict[str, np.ndarray] | None = None,
    species_metrics: SpeciesScopeMetrics | None = None,
    species_target_pct: float | None = None,
    species_records: list[SpeciesRecord] | None = None,
) -> list[dict[str, Any]]:
    """Compute all computable Tier 1 metrics for one raster scope.

    - subnational=True: skip manifest-sourced metadata metrics (mark not_applicable).
    - preloaded_layer_masks: if provided, skip mask layer downloads and use these directly.
    - preloaded_layer_values: if provided, skip numeric layer downloads and use these directly.
    - species_metrics: precomputed species values for this scope (None means species
      metrics will be marked 'derivation_needed').
    - species_target_pct: parsed solution target (17.0 / 30.0). None means
      'threatened_secured' is reported as 'derivation_needed'.
    - species_records: loaded species lookup records, used by metadata summary CSV coverage.
    """
    results: list[dict[str, Any]] = []
    domain = solution_domain(solution)

    if subnational and raster.valid_cells == 0:
        return [
            _empty_boundary(defn)
            if domain in defn.applicable_domains
            else _wrong_domain_metric(defn, domain)
            for defn in computable_metrics()
        ]

    for defn in computable_metrics():
        if domain not in defn.applicable_domains:
            results.append(_wrong_domain_metric(defn, domain))
            continue

        if is_species_metric_kind(defn.kind):
            results.append(_compute_species_metric(defn, species_metrics, species_target_pct))
            continue

        if defn.kind in _NATIONAL_ONLY_KINDS:
            if subnational:
                results.append(_not_applicable(defn))
            elif defn.kind == "metadata_summary":
                results.append(_compute_metadata_summary(defn, solution))
            else:
                results.append(_compute_metadata_coverage(
                    defn,
                    solution,
                    cache_dir,
                    force_download,
                    species_records,
                ))

        elif defn.kind == "selected_area":
            results.append(_compute_selected_area(defn, raster, subnational=subnational))

        elif defn.kind == "national_percent":
            results.append(_compute_national_percent(defn, raster, subnational=subnational))

        elif defn.kind == "aoi_percent":
            results.append(_compute_aoi_percent(defn, raster, subnational))

        elif defn.kind == "blocked_no_data":
            results.append(_blocked_no_data(defn))

        elif defn.kind in ("binary_overlap_area", "binary_overlap_percent_of_selected"):
            layer_id = defn.layer_id or ""
            if preloaded_layer_masks and layer_id in preloaded_layer_masks:
                rendering = _layer_rendering(manifest, layer_id)
                results.append(
                    _compute_overlap_from_mask(defn, raster, preloaded_layer_masks[layer_id], layer_id, rendering)
                )
            else:
                metric, _ = _compute_overlap_download(defn, raster, manifest, layer_cache, cache_dir, force_download)
                results.append(metric)

        elif defn.kind == "categorical_overlap_area":
            layer_id = defn.layer_id or ""
            if preloaded_layer_values and layer_id in preloaded_layer_values:
                results.append(
                    _compute_categorical_from_values(
                        defn,
                        raster,
                        preloaded_layer_values[layer_id],
                        layer_id,
                    )
                )
            else:
                metric, _ = _compute_categorical_download(
                    defn,
                    raster,
                    manifest,
                    value_cache,
                    cache_dir,
                    force_download,
                )
                results.append(metric)

        elif defn.kind in ("weighted_sum", "weighted_percent_of_national"):
            layer_id = defn.layer_id or ""
            if preloaded_layer_values and layer_id in preloaded_layer_values:
                values = preloaded_layer_values[layer_id]
                if defn.kind == "weighted_percent_of_national":
                    calc_fn = weighted_percent_calculator(layer_id)
                    if calc_fn is None:
                        results.append(_metric_value(
                            defn, value=None, status="pending",
                            notes=f"No weighted-percent calculator for '{layer_id}'.",
                            source=f"raster:{layer_id}",
                        ))
                        continue
                    result = calc_fn(raster, values)
                    if result is None:
                        results.append(_metric_value(
                            defn, value=None, status="blocked",
                            notes="National weighted total is zero.",
                            source=f"raster:{layer_id}",
                        ))
                    else:
                        results.append(_metric_value(
                            defn, value=result, status="ready",
                            notes=f"selectedWeightedSum / nationalWeightedSum × 100 ('{layer_id}').",
                            source=f"raster:{layer_id}",
                        ))
                else:
                    calc_fn = weighted_sum_calculator(defn)
                    if calc_fn is None:
                        results.append(_metric_value(
                            defn, value=None, status="pending",
                            notes=f"No weighted-sum calculator for '{layer_id}'.",
                            source=f"raster:{layer_id}",
                        ))
                        continue
                    result = calc_fn(raster, values)
                    results.append(_metric_value(
                        defn, value=result, status="ready",
                        notes=f"sum(pixel_value × pixel_area_km²) over selected finite cells of '{layer_id}'.",
                        source=f"raster:{layer_id}",
                    ))
            else:
                metric, _ = _compute_weighted_download(defn, raster, manifest, value_cache, cache_dir, force_download)
                results.append(metric)

        else:
            results.append(
                _metric_value(defn, value=None, status="pending",
                              notes=f"Unhandled metric kind '{defn.kind}'.", source="script")
            )

    return results


# ---------------------------------------------------------------------------
# Main solution processor
# ---------------------------------------------------------------------------

def _preload_layer_masks(
    raster: SolutionRaster,
    manifest: ResolvedManifest,
    layer_cache: _LayerMaskCache,
    cache_dir: Path,
    force_download: bool,
    domain: SolutionDomain,
) -> dict[str, np.ndarray]:
    """Load all mask-based layer TIFs into the in-memory cache and return a dict.

    These masks are then passed directly to sub-national metric computation,
    avoiding repeated disk reads for each of the 1000+ boundary features.
    """
    # Determine which layer_ids are used by mask-based metric kinds.
    mask_kinds = frozenset({"binary_overlap_area", "binary_overlap_percent_of_selected"})
    mask_layer_ids = {
        m.layer_id for m in _metrics_for_domain(domain)
        if m.layer_id and m.kind in mask_kinds
    }

    masks: dict[str, np.ndarray] = {}
    for layer_id in mask_layer_ids:
        try:
            url = _resolve_layer_url(manifest, layer_id)
            rendering = _layer_rendering(manifest, layer_id)
            masks[layer_id] = layer_cache.get(layer_id, url, raster.fingerprint, rendering, cache_dir, force_download)
        except (ManifestError, RasterError, OSError) as exc:
            print(f"[tier1-metrics]   WARNING: could not preload mask layer '{layer_id}': {exc}", file=sys.stderr)
    return masks


def _preload_layer_values(
    raster: SolutionRaster,
    manifest: ResolvedManifest,
    value_cache: _LayerValueCache,
    cache_dir: Path,
    force_download: bool,
    domain: SolutionDomain,
) -> dict[str, np.ndarray]:
    """Load all numeric layer TIFs and return a dict of float arrays."""
    value_kinds = frozenset({
        "categorical_overlap_area",
        "weighted_sum",
        "weighted_percent_of_national",
    })
    value_layer_ids = {
        m.layer_id for m in _metrics_for_domain(domain)
        if m.layer_id and m.kind in value_kinds
    }

    arrays: dict[str, np.ndarray] = {}
    for layer_id in value_layer_ids:
        try:
            url = _resolve_layer_url(manifest, layer_id)
            arrays[layer_id] = value_cache.get(layer_id, url, raster.fingerprint, cache_dir, force_download)
        except (ManifestError, RasterError, OSError) as exc:
            print(f"[tier1-metrics]   WARNING: could not preload value layer '{layer_id}': {exc}", file=sys.stderr)
    return arrays


def _process_solution(
    solution: dict[str, Any],
    manifest: ResolvedManifest,
    cache_dir: Path,
    output_dir: Path,
    force_download: bool,
    layer_cache: _LayerMaskCache,
    value_cache: _LayerValueCache,
    boundary_mask_cache: BoundaryMaskCache,
    boundaries_by_level: dict[str, list[BoundaryFeature]],
    national_only: bool = False,
    species_records: list[SpeciesRecord] | None = None,
    species_pool_sizes: SpeciesPoolSizes | None = None,
    boundary_grid_cache: BoundaryIdGridCache | None = None,
    skip_species: bool = False,
    skip_species_boundary_levels: set[str] | None = None,
    species_csv_url: str = SPECIES_CSV_URL,
    cache_blob_directory: str = CACHE_BLOB_DIRECTORY,
    release_id: str | None = None,
) -> dict[str, Any]:
    basename = solution_blob_basename(solution)
    solution_id = str(solution.get("id"))
    domain = solution_domain(solution)
    started = time.time()

    download = cached_download(solution["displayUrl"], cache_dir, force=force_download)
    raster = read_solution_raster(download.path)

    # --- Sub-national setup (rasterize boundaries + build boundary_id grids if needed) ---
    boundary_grids: dict[str, BoundaryIdGrid] = {}
    if not national_only and boundaries_by_level:
        print(f"[tier1-metrics]   rasterizing boundaries…")
        boundary_mask_cache.precompute_all(boundaries_by_level, raster.fingerprint)
        # Reuse boundary-id grids only among solutions with the same reference grid.
        if boundary_grid_cache is not None:
            boundary_grids = boundary_grid_cache.get(
                boundaries_by_level,
                raster.fingerprint,
                boundary_mask_cache,
            )

    # --- Species pass: compute counters across all scopes for this solution ---
    species_accumulator: SpeciesAccumulator | None = None
    if domain == "land" and not skip_species and species_records and species_pool_sizes:
        print(
            f"[tier1-metrics]   running species pass over {len(species_records):,} records…"
        )
        skipped_levels = skip_species_boundary_levels or set()
        species_boundary_grids = {
            level: grid for level, grid in (boundary_grids or {}).items()
            if level not in skipped_levels
        }
        if skipped_levels:
            active_levels = sorted(species_boundary_grids)
            print(
                f"[tier1-metrics]   species fan-out levels: {active_levels or ['national only']} "
                f"(skipped: {sorted(skipped_levels)})"
            )
        species_accumulator = _process_species_for_solution(
            raster=raster,
            solution=solution,
            species_records=species_records,
            pool_sizes=species_pool_sizes,
            boundary_grids=species_boundary_grids if not national_only else {},
            cache_dir=cache_dir,
            force_download=force_download,
        )

    # --- National level ---
    national_species = (
        SpeciesScopeMetrics.from_counts(species_accumulator.national, species_pool_sizes)
        if species_accumulator and species_pool_sizes
        else None
    )
    species_target = species_accumulator.target_pct if species_accumulator else None
    national_metrics = _build_metrics(
        raster, solution, manifest, layer_cache, value_cache, cache_dir, force_download,
        species_metrics=national_species,
        species_target_pct=species_target,
        species_records=species_records,
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
        # Preload all layer TIFs into memory once per solution.
        mask_count = sum(
            1 for m in _metrics_for_domain(domain)
            if m.layer_id and m.kind in ("binary_overlap_area", "binary_overlap_percent_of_selected")
        )
        value_count = sum(
            1 for m in _metrics_for_domain(domain)
            if m.layer_id and m.kind in (
                "categorical_overlap_area",
                "weighted_sum",
                "weighted_percent_of_national",
            )
        )
        print(f"[tier1-metrics]   preloading {mask_count} mask layer(s) + {value_count} value layer(s)…")
        layer_masks = _preload_layer_masks(
            raster,
            manifest,
            layer_cache,
            cache_dir,
            force_download,
            domain,
        )
        layer_values = _preload_layer_values(
            raster,
            manifest,
            value_cache,
            cache_dir,
            force_download,
            domain,
        )

        for geo_level, features in boundaries_by_level.items():
            level_out: dict[str, Any] = {}
            grid = boundary_grids.get(geo_level) if boundary_grids else None
            counts_list = (
                species_accumulator.sub.get(geo_level)
                if species_accumulator else None
            )
            for feat in features:
                px_mask = boundary_mask_cache.get(
                    feat.geo_level,
                    feat.boundary_id,
                    feat.geometry,
                    raster.fingerprint,
                    source_crs=feat.source_crs,
                    source_sha256=feat.source_sha256,
                    geometry_sha256=feat.geometry_sha256,
                )
                masked = raster.with_boundary_mask(px_mask)
                # Look up the precomputed species counts for this boundary, if any.
                feat_species: SpeciesScopeMetrics | None = None
                if grid is not None and counts_list is not None and species_pool_sizes:
                    try:
                        bidx = grid.boundary_ids.index(feat.boundary_id)
                        feat_species = SpeciesScopeMetrics.from_counts(
                            counts_list[bidx], species_pool_sizes
                        )
                    except ValueError:
                        feat_species = None
                metrics = _build_metrics(
                    masked, solution, manifest, layer_cache, value_cache, cache_dir, force_download,
                    subnational=True,
                    preloaded_layer_masks=layer_masks,
                    preloaded_layer_values=layer_values,
                    species_metrics=feat_species,
                    species_target_pct=species_target,
                    species_records=species_records,
                )
                entry: dict[str, Any] = {"name": feat.name, "metrics": metrics}
                # Include sirap_kind if present (legacy SIRAP entry shape).
                if "sirap_kind" in feat.properties:
                    entry["kind"] = feat.properties["sirap_kind"]
                # Surface the RUNAP management category and OMEC designation
                # so the AOI panel kicker can read them without re-fetching
                # the source GeoJSON. We keep them under a generic "subtype"
                # key alongside the existing "kind" used for SIRAPs.
                if "runap_category" in feat.properties:
                    entry["subtype"] = feat.properties["runap_category"]
                elif "DESIG" in feat.properties:
                    entry["subtype"] = feat.properties["DESIG"]
                level_out[feat.boundary_id] = entry
            geographies[geo_level] = level_out
            print(f"[tier1-metrics]   {geo_level}: {len(level_out)} features processed")

    generated_at = _utc_now_iso()
    provenance = build_metrics_provenance(
        domain,
        national_only=national_only,
        skip_species=skip_species,
        skip_species_boundary_levels=skip_species_boundary_levels or set(),
        species_csv_url=species_csv_url,
        release_id=release_id,
    )
    doc = {
        "solutionId": solution_id,
        "generatedAt": generated_at,
        PROVENANCE_KEY: provenance,
        "geographies": geographies,
    }
    cache_path = write_solution_cache(output_dir, solution_id, doc)
    print(f"[tier1-metrics]   cache → {cache_path}")

    return {
        "solutionId": solution_id,
        "solutionBasename": basename,
        "cachePath": str(cache_path),
        "expectedBlobPath": expected_cache_blob_path(
            solution_id,
            cache_blob_directory=cache_blob_directory,
        ),
        "expectedPublicUrl": expected_cache_public_url(
            manifest.public_blob_host,
            solution_id,
            cache_blob_directory=cache_blob_directory,
        ),
        "rasterCacheSha256": download.sha256,
        "selectedCells": raster.selected_cells,
        "validCells": raster.valid_cells,
        "selectedAreaKm2": raster.selected_area_km2,
        "validAreaKm2": raster.valid_area_km2,
        "geographyLevels": list(geographies.keys()),
        "nationalMetricStatusCounts": _status_counts(national_metrics),
        "solutionDomain": domain,
        "catalogSignature": provenance["catalogSignature"],
        "speciesTargetPct": species_target,
        "speciesProcessed": species_accumulator.species_processed if species_accumulator else 0,
        "speciesWithRange": species_accumulator.species_with_range if species_accumulator else 0,
        "speciesMissingTif": species_accumulator.species_missing_tif if species_accumulator else 0,
        "elapsedSeconds": round(time.time() - started, 2),
    }


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    if args.release_id:
        args.cache_blob_directory = load_release_config(
            args.release_id
        ).regular_verbose_directory
    print(f"[tier1-metrics] manifest: {args.manifest_url}")

    try:
        manifest = fetch_manifest(args.manifest_url)
    except ManifestError as exc:
        print(f"[tier1-metrics] ERROR: {exc}", file=sys.stderr)
        return 2

    domain_counts = {
        domain: sum(
            solution_domain(solution) == domain
            for solution in manifest.batch_solutions
        )
        for domain in ("land", "marine")
    }
    print(
        f"[tier1-metrics] loaded {len(manifest.layers_by_id)} layers, "
        f"{len(manifest.batch_solutions)} batch solutions "
        f"({domain_counts['land']} land, {domain_counts['marine']} marine)"
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
        selected_solutions = _select_solutions(manifest, args.solution_id, args.limit)
    except ManifestError as exc:
        print(f"[tier1-metrics] ERROR: {exc}", file=sys.stderr)
        return 2
    if args.release_id and len(selected_solutions) != 108:
        print(
            "[tier1-metrics] ERROR: atomic release generation requires exactly "
            f"108 solutions; got {len(selected_solutions)}",
            file=sys.stderr,
        )
        return 2

    solutions = _chunk_solutions(
        selected_solutions,
        chunk_index=args.chunk_index,
        chunk_count=args.chunk_count,
    )
    if args.chunk_count > 1:
        print(
            f"[tier1-metrics] chunk {args.chunk_index}/{args.chunk_count}: "
            f"{len(solutions)} of {len(selected_solutions)} selected solution(s)"
        )
    print(f"[tier1-metrics] processing {len(solutions)} solution(s)")

    args.output_dir.mkdir(parents=True, exist_ok=True)
    args.cache_dir.mkdir(parents=True, exist_ok=True)

    resume_entries_by_id: dict[str, dict[str, Any]] = {}
    pending_solutions: list[dict[str, Any]] = []
    if args.force:
        pending_solutions = solutions
    else:
        for solution in solutions:
            resume_entry = _resume_entry_for_existing_cache(
                solution,
                manifest,
                args.output_dir,
                args.cache_blob_directory,
                national_only=args.national_only,
                skip_species=args.skip_species,
                skip_species_boundary_levels=set(args.skip_species_boundary_level),
                species_csv_url=args.species_csv_url,
                release_id=args.release_id,
            )
            if resume_entry is None:
                pending_solutions.append(solution)
            else:
                resume_entries_by_id[str(solution.get("id"))] = resume_entry
        if resume_entries_by_id:
            print(
                f"[tier1-metrics] resume: {len(resume_entries_by_id)} existing cache file(s) "
                f"will be skipped; pass --force to recompute"
            )

    # --- Load boundary data ---
    boundaries_by_level: dict[str, list[BoundaryFeature]] = {}
    boundary_errors: dict[str, str] = {}
    if pending_solutions and not args.national_only:
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
        if args.release_id and boundary_errors:
            print(
                "[tier1-metrics] ERROR: release generation requires every pinned "
                f"boundary source; failures={sorted(boundary_errors)}",
                file=sys.stderr,
            )
            return 2

    layer_cache = _LayerMaskCache()
    value_cache = _LayerValueCache()
    boundary_mask_cache = BoundaryMaskCache()
    boundary_grid_cache = BoundaryIdGridCache()

    # --- Species data loaded once, only when this chunk contains land work ---
    species_records: list[SpeciesRecord] | None = None
    species_pool_sizes: SpeciesPoolSizes | None = None
    species_load_error: str | None = None
    has_pending_land = any(
        solution_domain(solution) == "land"
        for solution in pending_solutions
    )
    if has_pending_land and not args.skip_species:
        try:
            print(f"[tier1-metrics] fetching species CSV: {args.species_csv_url}")
            csv_dl = cached_download(args.species_csv_url, args.cache_dir, force=args.no_cache)
            species_records = load_species_records(csv_dl.path)
            species_pool_sizes = compute_pool_sizes(species_records)
            print(
                f"[tier1-metrics] species CSV: {len(species_records):,} non-fish records "
                f"(pool: {species_pool_sizes.by_bucket})"
            )
        except Exception as exc:
            species_load_error = str(exc)
            print(
                f"[tier1-metrics] WARNING: could not load species CSV ({exc}); "
                "species metrics will be marked 'derivation_needed'.",
                file=sys.stderr,
            )

    deferred = sorted(deferred_metric_ids())
    entries: list[dict[str, Any]] = []
    failures: list[dict[str, Any]] = []

    for index, solution in enumerate(solutions, start=1):
        solution_id = str(solution.get("id"))
        print(f"[tier1-metrics] [{index}/{len(solutions)}] {solution_id}")
        if solution_id in resume_entries_by_id:
            resume_entry = resume_entries_by_id[solution_id]
            print(f"[tier1-metrics]   skipped existing cache ({resume_entry['cachePath']})")
            entries.append(resume_entry)
            continue
        try:
            entries.append(
                _process_solution(
                    solution=solution,
                    manifest=manifest,
                    cache_dir=args.cache_dir,
                    output_dir=args.output_dir,
                    force_download=args.no_cache,
                    layer_cache=layer_cache,
                    value_cache=value_cache,
                    boundary_mask_cache=boundary_mask_cache,
                    boundaries_by_level=boundaries_by_level,
                    national_only=args.national_only,
                    species_records=species_records,
                    species_pool_sizes=species_pool_sizes,
                    boundary_grid_cache=boundary_grid_cache,
                    skip_species=args.skip_species,
                    skip_species_boundary_levels=set(args.skip_species_boundary_level),
                    species_csv_url=args.species_csv_url,
                    cache_blob_directory=args.cache_blob_directory,
                    release_id=args.release_id,
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
        "cacheBlobDirectory": args.cache_blob_directory,
        "geographyLevels": geo_levels,
        "boundaryErrors": boundary_errors if not args.national_only else {},
        "metricsSchemaVersion": METRICS_SCHEMA_VERSION,
        "metricCatalog": [m.metric_id for m in METRIC_CATALOG],
        "deferredMetricIds": deferred,
        "missingRequiredLayers": missing_layers,
        "speciesMetricIds": list(species_metric_ids()),
        "speciesPoolSizes": (
            {
                "totalNonFish": species_pool_sizes.total_non_fish,
                "threatenedTotal": species_pool_sizes.threatened_total,
                "byBucket": dict(species_pool_sizes.by_bucket),
            }
            if species_pool_sizes else None
        ),
        "speciesLoadError": species_load_error,
        "speciesSkipped": bool(args.skip_species),
        "speciesBoundaryLevelsSkipped": sorted(set(args.skip_species_boundary_level)),
        "chunk": {
            "index": args.chunk_index,
            "count": args.chunk_count,
            "selectedBeforeChunk": len(selected_solutions),
            "selectedForChunk": len(solutions),
        },
        "resumeEnabled": not args.force,
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
