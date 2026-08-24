"""Tier 1 metrics CLI — multi-geography cached output.

Usage:

    # One solution (smoke test)
    python data/metrics/python/metrics_pipeline/main.py --limit 1

    # All solutions
    python data/metrics/python/metrics_pipeline/main.py

    # Skip sub-national boundary calculation
    python data/metrics/python/metrics_pipeline/main.py --national-only

    # Validate manifest + selected raster sources; do not compute
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
import hashlib
import json
import os
import resource
import subprocess
import sys
import time
import traceback
from collections import OrderedDict
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

import numpy as np
from blob_manifest import (
    DEFAULT_MANIFEST_URL,
    ManifestError,
    ResolvedManifest,
    fetch_manifest,
    resolve_layer_display_url,
    solution_blob_basename,
)
from boundaries.boundary_id_grid import (
    BoundaryIdGrid,
    BoundaryIdGridCache,
    boundary_collection_sha256,
)
from boundaries.boundary_loader import (
    BOUNDARY_SOURCE_SPECS,
    BoundaryFeature,
    load_all_boundaries,
)
from boundaries.boundary_mask import BoundaryMaskCache, rasterize_boundary
from boundaries.boundary_topology import (
    GROUPED_BOUNDARY_FANOUT_ALGORITHM_VERSION,
    AnyBoundaryIndex,
    BoundaryTopologyCache,
    aggregate_boundary_counts,
    aggregate_boundary_weighted_sums,
    aggregate_prepared_sparse_boundary_weighted_sums,
    boundary_cell_counts,
    boundary_fanout_identity,
    prepare_sparse_boundary_weighted_channels,
)
from boundaries.boundary_weighted_fanout import (
    NODATA_NORMALIZATION_POLICY,
    WEIGHTED_BOUNDARY_FANOUT_ALGORITHM_VERSION,
    WEIGHTED_LAYER_PREPARATION_ALGORITHM_VERSION,
    WEIGHTED_METRIC_REGISTRY_POLICY_VERSION,
    ImmutableWeightedLayerCache,
    PreparedWeightedLayer,
    WeightedFanoutResult,
    WeightedLayerIdentity,
    aggregate_selected_weighted_layers,
    approved_weighted_specs,
    assemble_weighted_metric_results,
    canonical_nodata_value,
    pixel_area_rows_sha256,
    weighted_execution_identity,
)
from calculator_registry import (
    categorical_area_calculator,
    overlap_area_calculator,
    overlap_percent_calculator,
    weighted_percent_calculator,
    weighted_sum_calculator,
)
from calculators import area as calc_area
from calculators import ecosystem_coverage as calc_ecosystem
from calculators import marine_ecosystems as calc_marine
from calculators.species import (
    SpeciesAccumulator,
    SpeciesDetailSink,
    SpeciesScopeMetrics,
)
from coverage_parity_contract import (
    CoverageParityContractError,
    load_coverage_parity_contract,
)
from local_io import (
    CACHE_BLOB_DIRECTORY,
    DEFAULT_CACHE_DIR,
    DEFAULT_OUTPUT_DIR,
    CachedDownload,
    DownloadError,
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
)
from metric_output import (
    empty_boundary as _empty_boundary,
)
from metric_output import (
    metric_value as _metric_value,
)
from metric_output import (
    not_applicable as _not_applicable,
)
from metric_output import (
    status_counts as _status_counts,
)
from metrics_candidate import (
    CandidateBinding,
    candidate_path,
    promote_metrics_candidate,
    read_verified_candidate,
    write_metrics_candidate,
)
from metrics_contract import (
    METRICS_SCHEMA_VERSION,
    PROVENANCE_KEY,
    build_metrics_provenance,
    build_scope_state,
    generation_config,
    provenance_issues,
    regular_artifact_completeness_issues,
)
from raster_align import (
    AlignmentError,
    AlignmentResult,
    RasterAlignmentCache,
    alignment_policy_manifest_sha256,
    exact_grid_matches,
    grid_sha256,
    layer_policy_registry,
    policy_for_layer,
)
from raster_align import (
    canonical_sha256 as alignment_manifest_sha256,
)
from raster_metrics import (
    RasterError,
    SolutionRaster,
    boolean_mask_sha256,
    read_layer_mask,
    read_layer_values,
    read_solution_raster,
)
from release_config import load_release_config
from solution_catalog import (
    SolutionCatalog,
    SolutionCatalogEntry,
    SolutionCatalogError,
    bind_release_output,
    catalog_binding,
    load_release_plan,
    load_solution_catalog,
    release_plan_cache_policy,
    validate_catalog_solution_ids,
)
from solution_domain import SolutionDomain, solution_domain
from solution_input_signature import build_solution_input_signature
from sparse.layer_source import (
    LAND_BINARY_LAYER_IDS,
    IndexedBinaryLayerSource,
    LayerSourceDiagnostic,
    SparseLayerBinding,
    SparseLayerIncompatibleError,
    SparseLayerUnavailableError,
    binary_selection_values,
    choose_binary_mask,
    layer_source_mode,
    parse_source_nodata_pin,
    validated_sparse_url,
)
from species_data import (
    SPECIES_CSV_URL,
    SpeciesPoolSizes,
    SpeciesRecord,
    compute_pool_sizes,
    load_species_records,
    resolve_solution_species_target_percent,
)
from species_exception import (
    SpeciesExceptionError,
    SpeciesExceptionPolicy,
    load_species_exception,
)
from species_goals import (
    GEOGRAPHY_LEVELS as SPECIES_GOALS_GEOGRAPHY_LEVELS,
)
from species_goals import (
    SpeciesGoalsPipeline,
)
from species_goals import (
    build_catalog as build_species_goals_catalog,
)
from species_goals import (
    canonical_sha256 as species_goals_sha256,
)
from species_goals import (
    catalog_path as species_goals_catalog_path,
)
from species_goals import (
    compact_partition_path as species_goals_partition_path,
)
from species_goals import (
    partition_is_resumable as species_goals_partition_is_resumable,
)
from species_goals import (
    species_id as species_goals_id,
)
from species_goals import (
    write_catalog as write_species_goals_catalog,
)
from species_goals import (
    write_release_inventory as write_species_goals_release_inventory,
)
from species_overlap import (
    SPECIES_OVERLAP_ALGORITHM_VERSION,
    SPECIES_POLICY,
    SpeciesOverlapResult,
    read_species_overlap,
)
from species_solution_batch import (
    ExactOverlapInput,
    SpeciesExecutionConfig,
    SpeciesSolutionBatchError,
    build_release_batch_binding,
    category_mask_sha256,
    discover_exact_overlap_inventory,
    load_category_matrix,
    process_exact_species_batch,
    resolve_species_execution,
)
from species_solution_buffered import process_exact_species_batch_buffered
from species_target_policy import (
    SpeciesTargetPolicy,
    SpeciesTargetPolicyError,
    resolve_species_target_policy,
)
from summary_metadata import resolve_summary_csv_url
from summary_species_coverage import compute_species_group_coverage_details

# Metric kinds that are only meaningful at national scope (sourced from manifest metadata).
_NATIONAL_ONLY_KINDS = frozenset({"metadata_summary", "metadata_coverage"})

# Off-manifest layer URLs and renderings, computed once at import time.
_OFF_MANIFEST_URLS: dict[str, str] = off_manifest_layer_urls()
_OFF_MANIFEST_RENDERINGS: dict[str, dict] = off_manifest_layer_renderings()

# How frequently to print species progress (every Nth species).
_SPECIES_PROGRESS_INTERVAL = 1000
_BOUNDARY_FANOUT_ENV = "METRICS_BOUNDARY_FANOUT"
_WEIGHTED_BOUNDARY_FANOUT_ENV = "METRICS_WEIGHTED_BOUNDARY_FANOUT"
_GROUPED_METRIC_KINDS = frozenset(
    {
        "selected_area",
        "national_percent",
        "aoi_percent",
        "binary_overlap_area",
        "binary_overlap_percent_of_selected",
        "categorical_overlap_area",
    }
)
_CATEGORICAL_CLASS_IDS = {
    "ecosystem_coverage": calc_ecosystem.IAVH_ECOSYSTEM_CLASS_IDS,
    "coral_reef_coverage": calc_marine.CORAL_REEF_CLASS_IDS,
    "marine_mangrove_coverage": calc_marine.MARINE_MANGROVE_CLASS_IDS,
    "seagrass_coverage": calc_marine.SEAGRASS_CLASS_IDS,
}


def _boundary_fanout_mode() -> str:
    mode = os.environ.get(_BOUNDARY_FANOUT_ENV, "legacy").strip().lower()
    try:
        boundary_fanout_identity(mode)
    except ValueError as exc:
        raise ValueError(
            f"{_BOUNDARY_FANOUT_ENV} must be 'legacy' or 'grouped'; got {mode!r}."
        ) from exc
    return mode


def _weighted_boundary_fanout_mode() -> str:
    mode = os.environ.get(_WEIGHTED_BOUNDARY_FANOUT_ENV, "scalar").strip().lower()
    try:
        weighted_execution_identity(mode)
    except ValueError as exc:
        raise ValueError(
            f"{_WEIGHTED_BOUNDARY_FANOUT_ENV} must be 'scalar' or "
            f"'grouped-weighted-v1'; got {mode!r}."
        ) from exc
    return mode


def _peak_rss_mib() -> float:
    peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    bytes_used = peak if sys.platform == "darwin" else peak * 1024
    return bytes_used / (1024 * 1024)


@dataclass(frozen=True)
class _GroupedBoundaryPrimitives:
    boundary_grid_cells: np.ndarray
    valid_cells: np.ndarray
    selected_cells: np.ndarray
    valid_area_km2: np.ndarray
    selected_area_km2: np.ndarray
    overlap_area_km2: dict[str, np.ndarray]
    categorical_area_km2: dict[str, np.ndarray]


@dataclass(frozen=True)
class _SpeciesMicrobatchPlan:
    ordinal: int
    solutions: tuple[dict[str, Any], ...]
    binding: dict[str, Any]
    execution_by_solution: dict[str, dict[str, Any]]


@dataclass(frozen=True)
class _PrecomputedSpeciesResult:
    accumulator: SpeciesAccumulator
    detail_sink: SpeciesDetailSink | None
    runtime: dict[str, Any]


def _close_species_goals_sink(
    sink: SpeciesDetailSink | None,
) -> Exception | None:
    """Finalize one owned sidecar sink once without disrupting siblings."""

    if getattr(sink, "closed", False) is True:
        return None
    close = getattr(sink, "close", None)
    if close is None:
        return None
    try:
        close()
    except Exception as exc:  # noqa: BLE001 - cleanup must preserve primary failures
        return exc
    return None


def _initialize_species_microbatch_members(
    *,
    ordered_ids: list[str],
    target_policies: dict[str, SpeciesTargetPolicy],
    pool_sizes: SpeciesPoolSizes,
    species_expected: int,
    sub_sizes: dict[str, int],
    sink_factory: Callable[[str, SpeciesTargetPolicy], SpeciesDetailSink | None],
) -> tuple[
    list[SpeciesDetailSink | None],
    list[SpeciesAccumulator | None],
    dict[str, tuple[str, str]],
]:
    """Initialize each member independently and retain ordered placeholders."""

    sinks: list[SpeciesDetailSink | None] = [None] * len(ordered_ids)
    accumulators: list[SpeciesAccumulator | None] = [None] * len(ordered_ids)
    failures: dict[str, tuple[str, str]] = {}
    for solution_index, solution_id in enumerate(ordered_ids):
        sink: SpeciesDetailSink | None = None
        try:
            target_policy = target_policies[solution_id]
            sink = sink_factory(solution_id, target_policy)
            sinks[solution_index] = sink
            accumulator = SpeciesAccumulator(
                target_pct=target_policy.scalar_target_pct,
                pool_sizes=pool_sizes,
                target_policy=target_policy,
                species_expected=species_expected,
                detail_sink=sink,
            )
            accumulator.init_sub(sub_sizes)
            accumulators[solution_index] = accumulator
        except Exception as exc:  # noqa: BLE001 - isolate one setup member
            setup_traceback = traceback.format_exc()
            close_error = _close_species_goals_sink(sink)
            sinks[solution_index] = None
            error = (
                "Solution-specific species setup failed: "
                f"{type(exc).__name__}: {exc}"
            )
            if close_error is not None:
                error += (
                    "; cleanup also failed: "
                    f"{type(close_error).__name__}: {close_error}"
                )
            failures[solution_id] = (error, setup_traceback)
    return sinks, accumulators, failures


def _species_records_component(
    catalog_records: list[SpeciesRecord],
    available_records: list[SpeciesRecord],
    pool_sizes: SpeciesPoolSizes,
) -> dict[str, Any]:
    available_names = {record.scientific_name for record in available_records}
    rows = [
        {
            "speciesId": species_goals_id(record),
            "scientificName": record.scientific_name,
            "csvClass": record.csv_class,
            "bucket": record.bucket,
            "threatened": record.threatened,
            "iucnStatus": record.iucn_status,
            "rangeKm2": record.range_km2,
            "sourceUrl": record.blob_url,
            "sourceFilename": record.blob_filename,
            "poolMembership": {
                "nonFish": True,
                "bucket": record.bucket,
                "threatened": record.threatened,
                "available": record.scientific_name in available_names,
            },
        }
        for record in catalog_records
    ]
    component = {
        "format": "species-output-records-component-v1",
        "catalogCount": len(catalog_records),
        "availableCount": len(available_records),
        "poolSizes": {
            "totalNonFish": pool_sizes.total_non_fish,
            "threatenedTotal": pool_sizes.threatened_total,
            "byBucket": dict(sorted(pool_sizes.by_bucket.items())),
        },
        "rowsSha256": species_goals_sha256(rows),
    }
    component["sha256"] = species_goals_sha256(component)
    return component


def _boundary_batch_component(
    boundaries_by_level: dict[str, list[BoundaryFeature]],
    indexes: dict[str, AnyBoundaryIndex],
) -> dict[str, Any]:
    levels = {}
    for level in sorted(indexes):
        features = boundaries_by_level[level]
        spec = BOUNDARY_SOURCE_SPECS[level]
        levels[level] = {
            "source": {
                "url": spec.url,
                "sha256": spec.expected_sha256,
                "catalogSha256": spec.expected_catalog_sha256,
                "geometryCollectionSha256": spec.expected_geometry_collection_sha256,
                "crs": spec.expected_crs,
            },
            "featureCount": len(features),
            "orderedGeometrySha256": species_goals_sha256(
                [
                    {
                        "boundaryId": feature.boundary_id,
                        "geometrySha256": feature.geometry_sha256,
                    }
                    for feature in features
                ]
            ),
            "topology": {
                "algorithmVersion": GROUPED_BOUNDARY_FANOUT_ALGORITHM_VERSION,
                "totalClaims": indexes[level].total_claims,
                "overlapPixels": indexes[level].overlap_pixels,
                "maxMultiplicity": indexes[level].max_multiplicity,
            },
        }
    component = {
        "format": "species-boundary-component-v1",
        "boundaryCollectionSha256": boundary_collection_sha256(boundaries_by_level),
        "topologyAlgorithmVersion": GROUPED_BOUNDARY_FANOUT_ALGORITHM_VERSION,
        "levels": levels,
    }
    component["sha256"] = species_goals_sha256(component)
    return component


def _independent_species_execution(
    config: SpeciesExecutionConfig,
) -> dict[str, Any]:
    return {
        **config.provenance(),
        "batchOrdinal": None,
        "orderedSolutionIds": None,
        "bindingSha256": None,
        "componentSha256s": None,
        "resumePolicy": "solution-cache-only",
    }


def _validate_species_execution_run(
    config: SpeciesExecutionConfig,
    *,
    cache_policy: str,
    boundary_fanout_mode: str,
) -> None:
    if not config.is_microbatch:
        return
    if cache_policy != "recompute-all":
        raise ValueError(
            f"{config.effective_mode} requires --cache-policy recompute-all; "
            "cache and candidate resume are disabled."
        )
    if boundary_fanout_mode != "grouped":
        raise ValueError(
            f"{config.effective_mode} requires {_BOUNDARY_FANOUT_ENV}=grouped."
        )


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


def _layer_sparse_binding(
    manifest: ResolvedManifest,
    layer_id: str,
    source_url: str,
) -> SparseLayerBinding:
    """Read optional trusted sparse pins without deriving or fabricating them."""

    layer = manifest.layers_by_id.get(layer_id, {})
    sparse_config = layer.get("sparseSource")
    if not isinstance(sparse_config, dict):
        sparse_config = {}
    binding_source_url = sparse_config.get("sourceUrl", source_url)
    source_sha256 = sparse_config.get("sourceSha256", layer.get("sourceSha256"))
    sparse_url = sparse_config.get("url", layer.get("sparseUrl"))
    sparse_sha256 = sparse_config.get("sha256", layer.get("sparseSha256"))
    has_source_nodata = "sourceNodata" in sparse_config
    return SparseLayerBinding(
        source_url=binding_source_url,
        source_sha256=source_sha256,
        sparse_url=sparse_url,
        sparse_sha256=sparse_sha256,
        expected_nodata=parse_source_nodata_pin(
            sparse_config.get("sourceNodata")
        ),
        has_source_nodata=has_source_nodata,
    )


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ---------------------------------------------------------------------------
# In-memory layer mask cache
# ---------------------------------------------------------------------------


class _LayerMaskCache:
    """Caches dense layer masks in memory for the duration of one pipeline run.

    Eligible binary layers may load from a validated sparse sidecar, but this packet
    still materializes the same dense numpy mask consumed by legacy calculators.
    If the solution grid fingerprint changes, masks are cleared and reloaded.
    """

    def __init__(self, alignment_cache: RasterAlignmentCache | None = None) -> None:
        self._masks: OrderedDict[str, np.ndarray] = OrderedDict()
        self._last_fingerprint = None
        self._alignment_cache = alignment_cache or RasterAlignmentCache(
            DEFAULT_CACHE_DIR
        )
        self._max_items = int(os.environ.get("METRICS_LAYER_LRU_MAX_ITEMS", "4"))
        self._source_mode = layer_source_mode()
        self._source_diagnostics: dict[str, LayerSourceDiagnostic] = {}

    @property
    def source_diagnostics(self) -> tuple[LayerSourceDiagnostic, ...]:
        return tuple(self._source_diagnostics.values())

    def get(
        self,
        layer_id: str,
        url: str,
        fingerprint,
        rendering: dict,
        cache_dir: Path,
        force: bool,
        *,
        allow_sparse: bool = False,
        sparse_binding: SparseLayerBinding | None = None,
    ) -> np.ndarray:
        if self._last_fingerprint is not None and not self._last_fingerprint.matches(
            fingerprint
        ):
            self._masks.clear()
            self._source_diagnostics.clear()
        self._last_fingerprint = fingerprint
        use_sparse = allow_sparse and layer_id in LAND_BINARY_LAYER_IDS
        cache_key = f"{layer_id}:{'sparse-enabled' if use_sparse else 'dense-only'}"

        if cache_key not in self._masks:
            def load_dense() -> np.ndarray:
                dl = cached_download(url, cache_dir, force=force)
                aligned = self._alignment_cache.align(
                    dl.path,
                    dl.sha256,
                    fingerprint,
                    policy_for_layer(layer_id),
                )
                return read_layer_mask(
                    aligned.path, fingerprint, rendering=rendering
                )

            def load_sparse() -> IndexedBinaryLayerSource:
                expected_selected_values = binary_selection_values(rendering)
                if sparse_binding is None:
                    raise SparseLayerIncompatibleError(
                        f"Layer {layer_id!r} lacks trusted sparse binding metadata."
                    )
                sparse_url = validated_sparse_url(sparse_binding)
                try:
                    sparse_download = cached_download(
                        sparse_url,
                        cache_dir,
                        force=force,
                    )
                except (DownloadError, OSError) as exc:
                    raise SparseLayerUnavailableError(
                        f"Sparse sidecar for {layer_id!r} is unavailable: {exc}"
                    ) from exc
                return IndexedBinaryLayerSource.from_path(
                    sparse_download.path,
                    layer_id=layer_id,
                    binding=sparse_binding,
                    expected_fingerprint=fingerprint,
                    expected_selected_values=expected_selected_values,
                )

            if use_sparse:
                self._masks[cache_key] = choose_binary_mask(
                    self._source_mode,
                    layer_id=layer_id,
                    sparse_loader=load_sparse,
                    dense_loader=load_dense,
                    record_diagnostic=lambda diagnostic: self._source_diagnostics.__setitem__(
                        cache_key,
                        diagnostic,
                    ),
                    warn_on_fallback=cache_key not in self._source_diagnostics,
                )
            else:
                self._masks[cache_key] = load_dense()
                self._source_diagnostics[cache_key] = LayerSourceDiagnostic(
                    layer_id=layer_id,
                    mode_requested=self._source_mode,
                    source_chosen="dense",
                    fallback_reason=(
                        "Layer is not eligible for sparse binary source loading."
                        if self._source_mode != "dense"
                        else None
                    ),
                )
            while len(self._masks) > self._max_items:
                self._masks.popitem(last=False)
        else:
            self._masks.move_to_end(cache_key)
        return self._masks[cache_key]


class _LayerValueCache:
    """Caches numeric-layer float arrays for weighted and categorical metrics.

    Analogous to _LayerMaskCache but stores float64 arrays via read_layer_values
    instead of boolean masks.  Cleared automatically when the raster fingerprint
    changes (i.e. across solution grids — though in practice the grid is constant).
    """

    def __init__(self, alignment_cache: RasterAlignmentCache | None = None) -> None:
        self._arrays: OrderedDict[str, np.ndarray] = OrderedDict()
        self._alignments: dict[str, AlignmentResult] = {}
        self._downloads: dict[str, CachedDownload] = {}
        self._urls: dict[str, str] = {}
        self._last_fingerprint = None
        self._alignment_cache = alignment_cache or RasterAlignmentCache(
            DEFAULT_CACHE_DIR
        )
        self._max_items = int(os.environ.get("METRICS_LAYER_LRU_MAX_ITEMS", "4"))

    def get(
        self,
        layer_id: str,
        url: str,
        fingerprint,
        cache_dir: Path,
        force: bool,
    ) -> np.ndarray:
        if self._last_fingerprint is not None and not self._last_fingerprint.matches(
            fingerprint
        ):
            self._arrays.clear()
            self._alignments.clear()
            self._downloads.clear()
            self._urls.clear()
        self._last_fingerprint = fingerprint

        if layer_id not in self._arrays:
            dl = cached_download(url, cache_dir, force=force)
            aligned = self._alignment_cache.align(
                dl.path,
                dl.sha256,
                fingerprint,
                policy_for_layer(layer_id),
                source_url=url,
            )
            values = read_layer_values(aligned.path, fingerprint)
            values.flags.writeable = False
            self._arrays[layer_id] = values
            self._alignments[layer_id] = aligned
            self._downloads[layer_id] = dl
            self._urls[layer_id] = url
            while len(self._arrays) > self._max_items:
                evicted, _ = self._arrays.popitem(last=False)
                self._alignments.pop(evicted, None)
                self._downloads.pop(evicted, None)
                self._urls.pop(evicted, None)
        else:
            if self._urls[layer_id] != url:
                raise AlignmentError(
                    f"Numeric layer {layer_id!r} source URL drifted within one run."
                )
            self._arrays.move_to_end(layer_id)
        return self._arrays[layer_id]

    def get_prepared_weighted(
        self,
        layer_id: str,
        url: str,
        raster: SolutionRaster,
        cache_dir: Path,
        force: bool,
        cache: ImmutableWeightedLayerCache,
        *,
        value_units: str,
    ) -> tuple[PreparedWeightedLayer, bool]:
        """Prepare one immutable identity-bound weighted layer."""

        values = self.get(layer_id, url, raster.fingerprint, cache_dir, force)
        aligned = self._alignments[layer_id]
        download = self._downloads[layer_id]
        identity = WeightedLayerIdentity(
            layer_id=layer_id,
            source_url=url,
            source_sha256=download.sha256,
            source_provenance_sha256=alignment_manifest_sha256(
                {"url": url, "sha256": download.sha256}
            ),
            aligned_url=aligned.path.resolve().as_uri(),
            aligned_sha256=aligned.aligned_sha256,
            aligned_provenance_sha256=alignment_manifest_sha256(aligned.manifest),
            target_grid_sha256=aligned.target_grid_sha256,
            target_fingerprint_sha256=alignment_manifest_sha256(
                asdict(raster.fingerprint)
            ),
            target_shape=raster.selected_mask.shape,
            alignment_policy_sha256=aligned.policy_sha256,
            nodata_value=canonical_nodata_value(np.nan),
            nodata_interpretation_policy=(
                "read-layer-values-declared-sentinel-to-nan-v1"
            ),
            normalization_policy=NODATA_NORMALIZATION_POLICY,
            pixel_area_rows_sha256=pixel_area_rows_sha256(
                raster.pixel_area_km2_per_row
            ),
            preparation_algorithm_version=(
                WEIGHTED_LAYER_PREPARATION_ALGORITHM_VERSION
            ),
            weighted_fanout_algorithm_version=(
                WEIGHTED_BOUNDARY_FANOUT_ALGORITHM_VERSION
            ),
            aligned_dtype="float64",
            value_units=value_units,
            metric_registry_policy_version=WEIGHTED_METRIC_REGISTRY_POLICY_VERSION,
        )
        return cache.get_or_prepare(
            identity,
            shape=raster.selected_mask.shape,
            pixel_area_km2_per_row=raster.pixel_area_km2_per_row,
            loader=lambda: values,
        )


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
        "--solution-catalog",
        type=Path,
        default=None,
        help="Versioned solution-catalog-v1 contract (required with --release-id).",
    )
    parser.add_argument(
        "--release-plan",
        type=Path,
        default=None,
        help="Process only entries marked recompute in a deterministic release plan.",
    )
    parser.add_argument(
        "--coverage-parity-contract",
        type=Path,
        default=None,
        help=(
            "Validate and bind a Mesa-compatible coverage-parity contract. "
            "The contract golden solution must be included in the selected batch."
        ),
    )
    parser.add_argument("--coverage-parity-summary", type=Path, default=None)
    parser.add_argument("--coverage-parity-template", type=Path, default=None)
    parser.add_argument("--coverage-parity-ecosystem-raster", type=Path, default=None)
    parser.add_argument("--coverage-parity-ecosystem-catalog", type=Path, default=None)
    parser.add_argument(
        "--coverage-parity-species-matrix",
        type=Path,
        action="append",
        default=[],
    )
    parser.add_argument(
        "--domain",
        choices=("land", "marine"),
        default=None,
        help=(
            "Process exactly one catalog domain after validating the complete release "
            "plan. Requires --solution-catalog and --release-plan."
        ),
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
        "--cache-policy",
        choices=("use-cache", "recompute-all"),
        default="use-cache",
        help=(
            "use-cache resumes only checksum/provenance-identical outputs (default); "
            "recompute-all ignores calculated outputs and rebuilds every selection."
        ),
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
        help=(
            "Validate the manifest plus selected raster reachability and catalog "
            "checksums; do not compute or write outputs."
        ),
    )
    parser.add_argument(
        "--write-input-signatures-only",
        action="store_true",
        help="Resolve and write deterministic solution input signatures, then exit.",
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
    parser.add_argument(
        "--species-exception-contract",
        type=Path,
        default=None,
        help=(
            "Apply one catalog-bound, versioned release species exception contract. "
            "Arbitrary species skipping is not supported."
        ),
    )
    parser.add_argument(
        "--species-goals-output-dir",
        type=Path,
        default=None,
        help=(
            "Write resumable species-goals-catalog-v1 and per-geography "
            "species-goals-compact-v1 artifacts locally."
        ),
    )
    args = parser.parse_args(argv)
    if args.chunk_count < 1:
        parser.error("--chunk-count must be at least 1")
    if args.chunk_index < 0 or args.chunk_index >= args.chunk_count:
        parser.error("--chunk-index must be between 0 and --chunk-count - 1")
    if args.release_id and args.solution_catalog is None:
        parser.error("--release-id requires --solution-catalog")
    if args.release_plan is not None and args.solution_catalog is None:
        parser.error("--release-plan requires --solution-catalog")
    if args.domain is not None and (
        args.solution_catalog is None or args.release_plan is None
    ):
        parser.error("--domain requires --solution-catalog and --release-plan")
    if args.domain is not None and (
        args.solution_id is not None or args.limit is not None
    ):
        parser.error("--domain cannot be combined with --solution-id or --limit")
    parity_inputs = (
        args.coverage_parity_summary,
        args.coverage_parity_template,
        args.coverage_parity_ecosystem_raster,
        args.coverage_parity_ecosystem_catalog,
    )
    if args.coverage_parity_contract is not None and (
        any(value is None for value in parity_inputs)
        or not args.coverage_parity_species_matrix
    ):
        parser.error(
            "--coverage-parity-contract requires summary, template, ecosystem "
            "raster/catalog, and at least one species matrix"
        )
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
        solution
        for index, solution in enumerate(solutions)
        if index % chunk_count == chunk_index
    ]


def _filter_release_plan_solutions(
    solutions: list[dict[str, Any]],
    *,
    catalog: SolutionCatalog,
    release_plan: Path,
    domain: SolutionDomain | None = None,
) -> list[dict[str, Any]]:
    recompute_ids = set(
        load_release_plan(
            release_plan,
            catalog=catalog,
            action="recompute",
        )
    )
    if domain is not None:
        catalog_ids = set(catalog.solution_ids)
        if recompute_ids != catalog_ids:
            missing = sorted(catalog_ids - recompute_ids)
            unexpected = sorted(recompute_ids - catalog_ids)
            raise SolutionCatalogError(
                "domain execution requires every catalog solution to be marked "
                f"recompute; missing={missing[:8]}, unexpected={unexpected[:8]}"
            )
        expected_domain_ids = {
            entry.solution_id for entry in catalog.solutions if entry.domain == domain
        }
        recompute_domain_ids = {
            solution_id
            for solution_id in recompute_ids
            if catalog.by_id[solution_id].domain == domain
        }
        if recompute_domain_ids != expected_domain_ids:
            missing = sorted(expected_domain_ids - recompute_domain_ids)
            unexpected = sorted(recompute_domain_ids - expected_domain_ids)
            raise SolutionCatalogError(
                f"release plan does not exactly select catalog domain={domain}; "
                f"missing={missing[:8]}, unexpected={unexpected[:8]}"
            )
        recompute_ids = recompute_domain_ids
    selected = [
        solution
        for solution in solutions
        if str(solution.get("id")) in recompute_ids
        and (domain is None or solution_domain(solution) == domain)
    ]
    selected_ids = {str(solution.get("id")) for solution in selected}
    if selected_ids != recompute_ids:
        missing = sorted(recompute_ids - selected_ids)
        unexpected = sorted(selected_ids - recompute_ids)
        raise SolutionCatalogError(
            "release plan recompute ids do not exactly match runtime selection; "
            f"missing={missing[:8]}, unexpected={unexpected[:8]}"
        )
    return selected


def _release_plan_binding(
    release_plan: Path,
    *,
    catalog: SolutionCatalog,
) -> dict[str, Any]:
    """Return a content-addressed binding after the plan has been validated."""

    recompute_ids = load_release_plan(
        release_plan,
        catalog=catalog,
        action="recompute",
    )
    return {
        "format": "solution-release-plan-binding-v1",
        "releaseId": catalog.release_id,
        "catalogSha256": catalog.sha256,
        "sha256": hashlib.sha256(release_plan.read_bytes()).hexdigest(),
        "recomputeCount": len(recompute_ids),
    }


def _solution_source_identity(
    solution: dict[str, Any],
    *,
    cache_dir: Path,
    force_download: bool,
    raster_sha256: str,
    species_csv_url: str,
    species_csv_sha256: str | None,
) -> dict[str, Any]:
    """Resolve checksums for external solution metadata consumed by metrics."""

    metadata_url = str(solution.get("metadataUrl") or "")
    metadata_download_url = str(solution.get("_localMetadataUrl") or metadata_url)
    metadata_sha256: str | None = None
    summary_csv_url: str | None = None
    summary_csv_download_url: str | None = None
    summary_csv_sha256: str | None = None
    if metadata_url and species_csv_sha256 is not None:
        try:
            metadata_document = None
            if urlsplit(metadata_download_url).path.lower().endswith(".json"):
                metadata_download = cached_download(
                    metadata_download_url,
                    cache_dir,
                    force=force_download,
                )
                metadata_sha256 = metadata_download.sha256
                metadata_document = json.loads(
                    metadata_download.path.read_text(encoding="utf-8")
                )
            summary_csv_url = resolve_summary_csv_url(
                metadata_url,
                metadata_document=metadata_document,
            )
            summary_csv_download_url = resolve_summary_csv_url(
                metadata_download_url,
                metadata_document=metadata_document,
            )
            summary_download = cached_download(
                summary_csv_download_url,
                cache_dir,
                force=force_download,
            )
            summary_csv_sha256 = summary_download.sha256
            solution["_resolvedSummaryCsvUrl"] = summary_csv_download_url
        except Exception:  # noqa: BLE001 - optional summary metadata must not abort preflight
            solution["_metricsSummaryUnavailable"] = True

    return {
        "solutionRaster": {
            "url": solution.get("displayUrl"),
            "sha256": raster_sha256,
        },
        "speciesCsv": {
            "url": species_csv_url if species_csv_sha256 is not None else None,
            "sha256": species_csv_sha256,
        },
        "solutionMetadata": {
            "url": metadata_url or None,
            "sha256": metadata_sha256,
            "summaryCsvUrl": summary_csv_url,
            "summaryCsvSha256": summary_csv_sha256,
        },
        "consumedManifestMetadata": {
            "summaryMetrics": solution.get("summaryMetrics"),
            "coverage": solution.get("coverage"),
            "targetPercent": resolve_solution_species_target_percent(solution),
        },
    }


def _apply_solution_catalog(
    manifest: ResolvedManifest,
    catalog: SolutionCatalog,
) -> list[dict[str, Any]]:
    """Validate the manifest against the release contract and apply raster sources."""

    validate_catalog_solution_ids(
        catalog,
        (str(solution.get("id")) for solution in manifest.batch_solutions),
    )
    manifest_by_id = {
        str(solution.get("id")): solution for solution in manifest.batch_solutions
    }
    resolved: list[dict[str, Any]] = []
    for entry in catalog.solutions:
        solution = dict(manifest_by_id[entry.solution_id])
        observed_basename = solution_blob_basename(solution)
        observed_domain = solution_domain(solution)
        if observed_basename != entry.solution_basename:
            raise SolutionCatalogError(
                f"solution {entry.solution_id!r} basename mismatch: "
                f"manifest={observed_basename!r}, catalog={entry.solution_basename!r}"
            )
        if observed_domain != entry.domain:
            raise SolutionCatalogError(
                f"solution {entry.solution_id!r} domain mismatch: "
                f"manifest={observed_domain!r}, catalog={entry.domain!r}"
            )
        resolved.append(solution)
    return resolved


def _has_complete_regular_output_shape(
    geographies: dict[str, Any],
    *,
    national_only: bool,
    domain: SolutionDomain = "land",
    skip_species: bool = False,
) -> bool:
    expected_levels = (
        {"national"}
        if national_only
        else {"national", "departments", "municipalities", "siraps", "runaps", "omecs"}
    )
    if set(geographies) != expected_levels:
        return False
    expected_metric_ids = [definition.metric_id for definition in computable_metrics()]
    for level, scopes in geographies.items():
        if not isinstance(scopes, dict) or not scopes:
            return False
        if level == "national" and set(scopes) != {"colombia"}:
            return False
        for scope in scopes.values():
            if not isinstance(scope, dict):
                return False
            metrics = scope.get("metrics")
            if not isinstance(metrics, list):
                return False
            if [
                metric.get("metricId") if isinstance(metric, dict) else None
                for metric in metrics
            ] != expected_metric_ids:
                return False
            if any(
                not isinstance(metric.get("status"), str)
                or not isinstance(metric.get("unit"), str)
                or not isinstance(metric.get("labelKey"), str)
                for metric in metrics
            ):
                return False
    return True


def _has_complete_required_input_metrics(
    geographies: dict[str, Any],
    *,
    domain: SolutionDomain,
    skip_species: bool,
    species_exception_binding: dict[str, Any] | None = None,
    species_target_policy_kind: str = "scalar",
) -> bool:
    """Require every applicable layer/species metric to be ready."""

    return not _required_input_metric_issues(
        geographies,
        domain=domain,
        skip_species=skip_species,
        species_exception_binding=species_exception_binding,
        species_target_policy_kind=species_target_policy_kind,
    )


def _required_input_metric_issues(
    geographies: dict[str, Any],
    *,
    domain: SolutionDomain,
    skip_species: bool,
    species_exception_binding: dict[str, Any] | None = None,
    species_target_policy_kind: str = "scalar",
) -> list[dict[str, str]]:
    """Describe every required layer/species metric with an invalid status."""

    issues: list[dict[str, str]] = []
    definitions = computable_metrics()
    for level, scopes in geographies.items():
        for scope_id, scope in scopes.items():
            metrics = scope.get("metrics", [])
            scope_state = scope.get("scopeState")
            scope_is_empty = (
                isinstance(scope_state, dict)
                and level != "national"
                and scope_state.get("classification") == "empty"
                and scope_state.get("solutionValidCellCount") == 0
            )
            for definition, metric in zip(definitions, metrics):
                requires_complete_input = definition.layer_id is not None or (
                    is_species_metric_kind(definition.kind) and not skip_species
                )
                expected_status = (
                    (
                        "empty"
                        if domain in definition.applicable_domains
                        else "not_applicable"
                    )
                    if scope_is_empty
                    else (
                        "partial"
                        if (
                            species_target_policy_kind == "dual_reference"
                            and definition.kind
                            in {
                                "species_group_coverage",
                                "species_threatened_secured",
                            }
                        )
                    else (
                        "partial"
                        if species_exception_binding is not None
                        and is_species_metric_kind(definition.kind)
                        else "ready"
                    )
                )
                )
                if (
                    requires_complete_input
                    and domain in definition.applicable_domains
                    and metric.get("status") != expected_status
                ):
                    issues.append(
                        {
                            "geography": f"{level}/{scope_id}",
                            "metricId": definition.metric_id,
                            "expectedStatus": expected_status,
                            "actualStatus": str(metric.get("status")),
                            "reason": str(metric.get("notes") or "No reason provided."),
                        }
                    )
    return issues


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
    expected_solution_basename: str | None = None,
    expected_raster_sha256: str | None = None,
    expected_input_signature: dict[str, str] | None = None,
    expected_catalog_binding: dict[str, Any] | None = None,
    species_exception_binding: dict[str, Any] | None = None,
    species_target_policy: SpeciesTargetPolicy | None = None,
    boundary_fanout_mode: str = "legacy",
    weighted_boundary_fanout_mode: str = "scalar",
    species_execution: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    """Return a publish-report entry for an existing valid cache file, if present."""
    solution_id = str(solution.get("id"))
    cache_path = cache_solution_path(output_dir, solution_id)
    if not cache_path.exists():
        return None

    try:
        doc = json.loads(cache_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None

    return _resume_entry_for_document(
        doc,
        solution,
        manifest,
        cache_path,
        cache_blob_directory,
        national_only=national_only,
        skip_species=skip_species,
        skip_species_boundary_levels=skip_species_boundary_levels,
        species_csv_url=species_csv_url,
        release_id=release_id,
        expected_solution_basename=expected_solution_basename,
        expected_raster_sha256=expected_raster_sha256,
        expected_input_signature=expected_input_signature,
        expected_catalog_binding=expected_catalog_binding,
        species_exception_binding=species_exception_binding,
        species_target_policy=species_target_policy,
        boundary_fanout_mode=boundary_fanout_mode,
        weighted_boundary_fanout_mode=weighted_boundary_fanout_mode,
        species_execution=species_execution,
        log_stale_cache=True,
    )


def _resume_entry_for_document(
    doc: dict[str, Any],
    solution: dict[str, Any],
    manifest: ResolvedManifest,
    cache_path: Path,
    cache_blob_directory: str,
    *,
    national_only: bool = False,
    skip_species: bool = False,
    skip_species_boundary_levels: set[str] | None = None,
    species_csv_url: str = SPECIES_CSV_URL,
    release_id: str | None = None,
    expected_solution_basename: str | None = None,
    expected_raster_sha256: str | None = None,
    expected_input_signature: dict[str, str] | None = None,
    expected_catalog_binding: dict[str, Any] | None = None,
    species_exception_binding: dict[str, Any] | None = None,
    species_target_policy: SpeciesTargetPolicy | None = None,
    boundary_fanout_mode: str = "legacy",
    weighted_boundary_fanout_mode: str = "scalar",
    species_execution: dict[str, Any] | None = None,
    log_stale_cache: bool = False,
) -> dict[str, Any] | None:
    """Validate a canonical cache document without reading or writing its path."""

    solution_id = str(solution.get("id"))
    domain = solution_domain(solution)
    geographies = doc.get("geographies")
    if doc.get("solutionId") != solution_id or not isinstance(geographies, dict):
        return None
    if not _has_complete_regular_output_shape(
        geographies,
        national_only=national_only,
        domain=domain,
        skip_species=skip_species,
    ):
        return None
    if not _has_complete_required_input_metrics(
        geographies,
        domain=domain,
        skip_species=skip_species,
        species_exception_binding=species_exception_binding,
        species_target_policy_kind=(
            species_target_policy.kind
            if species_target_policy is not None
            else "scalar"
        ),
    ):
        return None
    if regular_artifact_completeness_issues(
        doc,
        national_only=national_only,
        domain=domain,
        skip_species=skip_species,
    ):
        return None
    expected_config = generation_config(
        domain,
        national_only=national_only,
        skip_species=skip_species,
        skip_species_boundary_levels=skip_species_boundary_levels or set(),
        species_csv_url=species_csv_url,
        species_exception_binding=species_exception_binding,
        boundary_fanout_mode=boundary_fanout_mode,
        weighted_execution_mode=weighted_boundary_fanout_mode,
        species_execution=species_execution,
    )
    contract_issues = provenance_issues(
        doc,
        expected_domain=domain,
        expected_config=expected_config,
        expected_release_id=release_id,
        expected_species_target_policy=(
            species_target_policy.provenance
            if species_target_policy is not None
            else None
        ),
    )
    if contract_issues:
        if log_stale_cache:
            print(
                f"[tier1-metrics]   stale cache '{cache_path}' will be recomputed: "
                f"{contract_issues[0]}",
                file=sys.stderr,
            )
        return None

    raster_provenance = doc.get("solutionRaster")
    if (
        expected_solution_basename is not None or expected_raster_sha256 is not None
    ) and not isinstance(raster_provenance, dict):
        return None
    if (
        expected_solution_basename is not None
        and raster_provenance.get("solutionBasename") != expected_solution_basename
    ):
        return None
    if (
        expected_raster_sha256 is not None
        and raster_provenance.get("sha256") != expected_raster_sha256
    ):
        return None
    if (
        expected_input_signature is not None
        and doc.get("solutionInputSignature") != expected_input_signature
    ):
        return None
    if (
        expected_catalog_binding is not None
        and doc.get("solutionCatalogBinding") != expected_catalog_binding
    ):
        return None
    national_metrics = (
        geographies.get("national", {}).get("colombia", {}).get("metrics", [])
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
        "speciesTargetPolicyEvidence": doc[PROVENANCE_KEY].get("speciesTargetPolicy"),
        "boundaryFanout": doc[PROVENANCE_KEY]["generationConfig"].get(
            "boundaryFanout",
            boundary_fanout_identity("legacy"),
        ),
        "weightedBoundaryExecution": doc[PROVENANCE_KEY]["generationConfig"][
            "weightedBoundaryExecution"
        ],
        "speciesExecution": doc[PROVENANCE_KEY]["generationConfig"].get(
            "speciesExecution"
        ),
        "resumeSkipped": True,
        "elapsedSeconds": 0.0,
    }


class MetricsCandidateValidationError(RuntimeError):
    """Final validation failed after the assembled document was quarantined."""

    def __init__(self, path: Path, issues: list[str]):
        self.candidate_path = path
        self.validation_issues = list(issues)
        super().__init__(
            "Regular metrics artifact is incomplete; no metrics document was written. "
            f"Failure: {issues[0]}"
        )


def _candidate_binding(
    *,
    solution_id: str,
    domain: SolutionDomain,
    raster_basename: str,
    raster_sha256: str,
    release_id: str | None,
    catalog_binding: dict[str, Any] | None,
    solution_input_signature: dict[str, str] | None,
    metrics_provenance: dict[str, Any],
) -> CandidateBinding:
    return CandidateBinding(
        release_id=release_id,
        catalog_binding=catalog_binding,
        solution_id=solution_id,
        solution_domain=domain,
        raster_basename=raster_basename,
        raster_sha256=raster_sha256,
        solution_input_signature=solution_input_signature,
        metrics_schema_version=metrics_provenance["schemaVersion"],
        catalog_signature=metrics_provenance["catalogSignature"],
        species_target_policy=metrics_provenance.get("speciesTargetPolicy"),
        boundary_fanout=metrics_provenance["generationConfig"]["boundaryFanout"],
        weighted_boundary_execution=metrics_provenance["generationConfig"][
            "weightedBoundaryExecution"
        ],
        species_execution=metrics_provenance["generationConfig"].get(
            "speciesExecution"
        ),
    )


def _finalize_solution_document(
    *,
    output_dir: Path,
    solution_id: str,
    binding: CandidateBinding,
    document: dict[str, Any],
    national_only: bool,
    domain: SolutionDomain,
    skip_species: bool,
) -> Path:
    """Quarantine before validation, then atomically publish only valid output."""

    path = write_metrics_candidate(output_dir, binding, document)
    issues = regular_artifact_completeness_issues(
        document,
        national_only=national_only,
        domain=domain,
        skip_species=skip_species,
    )
    if issues:
        write_metrics_candidate(
            output_dir,
            binding,
            document,
            validation_state="failed",
            validation_issues=issues,
        )
        raise MetricsCandidateValidationError(path, issues)

    cache_path = write_solution_cache(output_dir, solution_id, document)
    promote_metrics_candidate(
        output_dir,
        binding,
        document,
        cache_path,
        final_already_written=True,
    )
    return cache_path


def _promote_resumable_candidate(
    *,
    solution: dict[str, Any],
    manifest: ResolvedManifest,
    output_dir: Path,
    cache_blob_directory: str,
    binding: CandidateBinding,
    national_only: bool,
    skip_species: bool,
    skip_species_boundary_levels: set[str],
    species_csv_url: str,
    species_exception_binding: dict[str, Any] | None,
    species_target_policy: SpeciesTargetPolicy | None,
    boundary_fanout_mode: str = "legacy",
    weighted_boundary_fanout_mode: str = "scalar",
    species_execution: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    """Revalidate a fully bound candidate and promote it without computation."""

    existing_entry = _resume_entry_for_existing_cache(
        solution,
        manifest,
        output_dir,
        cache_blob_directory,
        national_only=national_only,
        skip_species=skip_species,
        skip_species_boundary_levels=skip_species_boundary_levels,
        species_csv_url=species_csv_url,
        release_id=binding.release_id,
        expected_solution_basename=binding.raster_basename,
        expected_raster_sha256=binding.raster_sha256,
        expected_input_signature=binding.solution_input_signature,
        expected_catalog_binding=binding.catalog_binding,
        species_exception_binding=species_exception_binding,
        species_target_policy=species_target_policy,
        boundary_fanout_mode=boundary_fanout_mode,
        weighted_boundary_fanout_mode=weighted_boundary_fanout_mode,
        species_execution=species_execution,
    )
    if existing_entry is not None:
        return existing_entry

    verified, binding_issues = read_verified_candidate(output_dir, binding)
    if verified is None:
        if binding_issues:
            print(
                f"[tier1-metrics]   quarantined candidate for {binding.solution_id!r} "
                f"will not be reused: {binding_issues[0]}",
                file=sys.stderr,
            )
        return None

    validation_issues = regular_artifact_completeness_issues(
        verified.payload,
        national_only=national_only,
        domain=binding.solution_domain,
        skip_species=skip_species,
    )
    if validation_issues:
        write_metrics_candidate(
            output_dir,
            binding,
            verified.payload,
            validation_state="failed",
            validation_issues=validation_issues,
        )
        print(
            f"[tier1-metrics]   quarantined candidate for {binding.solution_id!r} "
            f"still fails validation: {validation_issues[0]}",
            file=sys.stderr,
        )
        return None

    cache_path = cache_solution_path(output_dir, binding.solution_id)
    entry = _resume_entry_for_document(
        verified.payload,
        solution,
        manifest,
        cache_path,
        cache_blob_directory,
        national_only=national_only,
        skip_species=skip_species,
        skip_species_boundary_levels=skip_species_boundary_levels,
        species_csv_url=species_csv_url,
        release_id=binding.release_id,
        expected_solution_basename=binding.raster_basename,
        expected_raster_sha256=binding.raster_sha256,
        expected_input_signature=binding.solution_input_signature,
        expected_catalog_binding=binding.catalog_binding,
        species_exception_binding=species_exception_binding,
        species_target_policy=species_target_policy,
        boundary_fanout_mode=boundary_fanout_mode,
        weighted_boundary_fanout_mode=weighted_boundary_fanout_mode,
        species_execution=species_execution,
    )
    if entry is None:
        canonical_issue = "candidate failed canonical in-memory resume validation"
        prior_issues = verified.envelope.get("validation", {}).get("issues", [])
        write_metrics_candidate(
            output_dir,
            binding,
            verified.payload,
            validation_state="failed",
            validation_issues=list(dict.fromkeys([*prior_issues, canonical_issue])),
        )
        print(
            f"[tier1-metrics]   quarantined candidate for {binding.solution_id!r} "
            f"{canonical_issue} and will be recomputed; "
            f"evidence remains at {candidate_path(output_dir, binding.solution_id)}.",
            file=sys.stderr,
        )
        return None
    promote_metrics_candidate(
        output_dir,
        binding,
        verified.payload,
        cache_path,
    )
    entry["candidatePromoted"] = True
    return entry


def _validate_required_layers(manifest: ResolvedManifest) -> list[str]:
    missing: list[str] = []
    for layer_id in required_layer_ids():
        try:
            _resolve_layer_url(manifest, layer_id)
        except ManifestError:
            missing.append(layer_id)
    return missing


def _solution_raster_source_url(solution: dict[str, Any]) -> str:
    """Return the exact raster source used by metrics processing."""

    url = solution.get("displayUrl")
    if not isinstance(url, str) or not url.strip():
        raise ValueError("displayUrl must be a non-empty URL")
    return url.strip()


def _safe_source_label(url: str) -> str:
    """Describe a source without exposing query parameters or credentials."""

    parsed = urlsplit(url)
    if parsed.scheme == "file":
        return f"file://{parsed.path}"
    host = parsed.hostname or ""
    return f"{parsed.scheme}://{host}{parsed.path}"


def _preflight_solution_rasters(
    solutions: list[dict[str, Any]],
    *,
    cache_dir: Path,
    catalog: SolutionCatalog | None,
) -> tuple[dict[str, CachedDownload], list[str]]:
    """Freshly fetch and checksum every selected raster, collecting all failures."""

    downloads: dict[str, CachedDownload] = {}
    failures: list[str] = []
    catalog_by_id = catalog.by_id if catalog is not None else {}
    for solution in solutions:
        solution_id = str(solution.get("id"))
        try:
            source_url = _solution_raster_source_url(solution)
            source_label = _safe_source_label(source_url)
        except ValueError as exc:
            failures.append(f"{solution_id}: invalid raster source ({exc})")
            continue

        try:
            download = cached_download(
                source_url,
                cache_dir,
                force=True,
            )
        except (OSError, DownloadError, ValueError) as exc:
            failures.append(
                f"{solution_id}: unreachable raster source {source_label} "
                f"({type(exc).__name__})"
            )
            continue

        catalog_entry = catalog_by_id.get(solution_id)
        if catalog_entry is not None and download.sha256 != catalog_entry.raster_sha256:
            failures.append(
                f"{solution_id}: raster SHA-256 mismatch for {source_label}; "
                f"expected {catalog_entry.raster_sha256}, observed {download.sha256}"
            )
            continue
        downloads[solution_id] = download
    return downloads, failures


def _preflight_aligned_inputs(
    solutions: list[dict[str, Any]],
    solution_downloads: dict[str, CachedDownload],
    manifest: ResolvedManifest,
    *,
    cache_dir: Path,
    force_download: bool,
    species_records: list[SpeciesRecord] | None,
    skip_species: bool,
    species_exception: SpeciesExceptionPolicy | None = None,
) -> tuple[RasterAlignmentCache | None, dict[str, Any] | None, list[str]]:
    """Validate one grid per domain and warm each domain's aligned inputs."""

    failures: list[str] = []
    if not solutions:
        return None, None, failures

    domain_references: dict[SolutionDomain, Any] = {}
    domain_reference_solutions: dict[SolutionDomain, str] = {}
    domain_solution_counts: dict[SolutionDomain, int] = {}
    for solution in solutions:
        solution_id = str(solution.get("id"))
        domain = solution_domain(solution)
        try:
            observed = read_solution_raster(
                solution_downloads[solution_id].path
            ).fingerprint
            reference = domain_references.get(domain)
            if reference is None:
                domain_references[domain] = observed
                domain_reference_solutions[domain] = solution_id
                domain_solution_counts[domain] = 1
            elif not exact_grid_matches(observed, reference):
                failures.append(
                    f"domain={domain} solution={solution_id!r} grid="
                    f"{grid_sha256(observed)} ({observed.width}x{observed.height}) "
                    f"differs from domain reference solution="
                    f"{domain_reference_solutions[domain]!r} grid="
                    f"{grid_sha256(reference)} "
                    f"({reference.width}x{reference.height})"
                )
            else:
                domain_solution_counts[domain] += 1
        except (OSError, RasterError) as exc:
            failures.append(
                f"domain={domain} solution={solution_id!r}: invalid solution raster ({exc})"
            )
    if failures:
        return None, None, failures

    try:
        policies = layer_policy_registry()
    except AlignmentError as exc:
        return None, None, [str(exc)]

    alignment_cache = RasterAlignmentCache(cache_dir)
    domain_inventories: dict[SolutionDomain, dict[str, Any]] = {}
    policy_manifest_sha256 = alignment_policy_manifest_sha256()
    for domain in sorted(domain_references):
        reference = domain_references[domain]
        aligned_entries: dict[str, dict[str, Any]] = {}
        required_layers = {
            definition.layer_id
            for definition in computable_metrics()
            if definition.layer_id and domain in definition.applicable_domains
        }
        print(
            f"[tier1-metrics] preflight: domain={domain} "
            f"solutions={domain_solution_counts[domain]} grid="
            f"{grid_sha256(reference)[:12]} "
            f"({reference.width}x{reference.height}) "
            f"layers={len(required_layers)}"
        )
        for layer_id in sorted(required_layers):
            try:
                url = _resolve_layer_url(manifest, layer_id)
                download = cached_download(url, cache_dir, force=force_download)
                aligned = alignment_cache.align(
                    download.path,
                    download.sha256,
                    reference,
                    policies[layer_id],
                    source_url=url,
                )
                aligned_entries[f"layer:{layer_id}"] = _alignment_identity(
                    aligned,
                    input_id=f"layer:{layer_id}",
                    source_url=url,
                )
            except (
                AlignmentError,
                DownloadError,
                ManifestError,
                OSError,
                ValueError,
            ) as exc:
                failures.append(
                    f"domain={domain} grid={grid_sha256(reference)} "
                    f"layer={layer_id!r}: {exc}"
                )

        if domain == "land" and not skip_species:
            if species_records is None:
                failures.append(
                    f"domain=land grid={grid_sha256(reference)}: species records "
                    "were not available for alignment preflight"
                )
            else:

                def align_species(species, reference=reference):
                    input_id = f"species:{species.blob_filename}"
                    try:
                        download = cached_download(
                            species.blob_url,
                            cache_dir,
                            force=force_download,
                        )
                        aligned = alignment_cache.species.align(
                            download.path,
                            download.sha256,
                            reference,
                            source_url=species.blob_url,
                            authoritative_area_km2=species.range_km2,
                        )
                        return input_id, _alignment_identity(
                            aligned, input_id=input_id, source_url=species.blob_url
                        )
                    except (
                        AlignmentError,
                        DownloadError,
                        OSError,
                        ValueError,
                    ) as exc:
                        return (
                            input_id,
                            (
                            f"domain=land grid={grid_sha256(reference)} "
                                f"species={species.blob_filename!r}: {exc}"
                            ),
                        )

                worker_count = max(
                    1,
                    int(os.environ.get("METRICS_ALIGNMENT_PREFLIGHT_WORKERS", "8")),
                )
                print(
                    f"[tier1-metrics] preflight: domain=land aligning "
                    f"{len(species_records):,} species with {worker_count} worker(s)"
                )
                with ThreadPoolExecutor(max_workers=worker_count) as executor:
                    futures = [
                        executor.submit(align_species, species)
                        for species in species_records
                    ]
                    for completed, future in enumerate(
                        as_completed(futures),
                        start=1,
                    ):
                        input_id, result = future.result()
                        if isinstance(result, str):
                            failures.append(result)
                        else:
                            aligned_entries[input_id] = result
                        if (
                            completed % _SPECIES_PROGRESS_INTERVAL == 0
                            or completed == len(futures)
                        ):
                            print(
                                "[tier1-metrics] preflight: domain=land species "
                                f"{completed:,}/{len(futures):,}"
                            )

        expected_aligned_inputs = len(required_layers)
        if domain == "land" and not skip_species:
            expected_aligned_inputs += len(species_records or [])
        domain_inventory = {
            "format": "metrics-domain-alignment-inventory-v1",
            "domain": domain,
            "solutionCount": domain_solution_counts[domain],
            "referenceSolutionId": domain_reference_solutions[domain],
            "targetGridSha256": grid_sha256(reference),
            "targetGrid": {
                "width": reference.width,
                "height": reference.height,
                "crs": reference.crs,
            },
            "policyManifestSha256": policy_manifest_sha256,
            "expectedAlignedInputs": expected_aligned_inputs,
            "alignedInputs": len(aligned_entries),
            "entries": [aligned_entries[key] for key in sorted(aligned_entries)],
            "entriesSha256": alignment_manifest_sha256(aligned_entries),
            "estimatedReleaseBytes": sum(
                entry["alignedBytes"] for entry in aligned_entries.values()
            ),
        }
        if domain == "land" and not skip_species:
            excluded = (
                len(species_exception.excluded_filenames)
                if species_exception is not None
                else 0
            )
            available_expected = len(species_records or [])
            species_aligned = sum(key.startswith("species:") for key in aligned_entries)
            species_failures = sum(
                failure.startswith("domain=land") and " species=" in failure
                for failure in failures
            )
            domain_inventory["speciesInventory"] = {
                "catalogTotal": available_expected + excluded,
                "availableExpected": available_expected,
                "excluded": excluded,
                "processed": species_aligned,
                "missingUnexpected": species_failures,
            }
            domain_inventory["speciesException"] = (
                species_exception.binding if species_exception is not None else None
            )
        domain_inventory["sha256"] = alignment_manifest_sha256(domain_inventory)
        domain_inventories[domain] = domain_inventory

    inventory = {
        "format": "metrics-alignment-inventory-v4",
        "domains": {
            domain: domain_inventories[domain] for domain in sorted(domain_inventories)
        },
        "cacheStorage": {
            "completePairBytes": (
                alignment_cache.cache_usage_bytes()
                + alignment_cache.species.cache_usage_bytes()
            ),
            "configuredMaxBytes": alignment_cache.max_cache_bytes,
            "estimatedReleaseBytes": sum(
                domain_inventory["estimatedReleaseBytes"]
                for domain_inventory in domain_inventories.values()
            ),
        },
    }
    inventory["sha256"] = alignment_manifest_sha256(inventory)
    return alignment_cache, inventory, failures


def _alignment_provenance_for_solution(
    alignment_inventory: dict[str, Any],
    solution: dict[str, Any],
) -> dict[str, Any]:
    """Return the fail-closed domain inventory bound to one solution."""

    domain = solution_domain(solution)
    domains = alignment_inventory.get("domains")
    domain_inventory = domains.get(domain) if isinstance(domains, dict) else None
    if (
        alignment_inventory.get("format") != "metrics-alignment-inventory-v4"
        or not isinstance(domain_inventory, dict)
        or domain_inventory.get("domain") != domain
        or not isinstance(domain_inventory.get("targetGridSha256"), str)
        or not isinstance(domain_inventory.get("sha256"), str)
    ):
        raise AlignmentError(
            f"No valid alignment inventory exists for domain={domain} "
            f"solution={str(solution.get('id'))!r}."
        )
    return domain_inventory


def _alignment_identity(
    result: AlignmentResult | SpeciesOverlapResult,
    *,
    input_id: str,
    source_url: str,
) -> dict[str, Any]:
    identity = {
        "inputId": input_id,
        "sourceUrl": source_url,
        "cacheKey": result.cache_key,
        "sourceSha256": result.source_sha256,
        "alignedSha256": result.aligned_sha256,
        "targetGridSha256": result.target_grid_sha256,
        "policySha256": result.policy_sha256,
        "alignedBytes": result.path.stat().st_size,
    }
    if isinstance(result, SpeciesOverlapResult):
        qa = result.manifest["qa"]
        identity.update(
            {
                "algorithmVersion": SPECIES_OVERLAP_ALGORITHM_VERSION,
                "sourceAreaKm2": qa["projectedSourceGeometryAreaKm2"],
                "intersectedAreaKm2": qa["intersectedAreaKm2"],
                "positiveTargetCellCount": qa["positiveTargetCellCount"],
                "conservationDeltaM2": qa["conservationDeltaM2"],
            }
        )
    return identity


def _compute_aoi_percent(
    definition: MetricDefinition, raster: SolutionRaster, subnational: bool
) -> dict[str, Any]:
    """#19 — selected / valid × 100 within the current scope.

    At national scope this duplicates #17, so we mark it not_applicable there.
    At boundary scope it answers "what % of this region is selected?".
    """
    if not subnational:
        return _metric_value(
            definition,
            value=None,
            status="not_applicable",
            notes="Same as national_contribution (#17) at national scope; reported there.",
            source="n/a",
        )
    if raster.valid_cells == 0:
        return _metric_value(
            definition,
            value=None,
            status="blocked",
            notes="Boundary has no valid cells.",
            source="raster:solution",
        )
    pct = calc_area.national_contribution_pct(raster)
    if pct is None:
        return _metric_value(
            definition,
            value=None,
            status="blocked",
            notes="Raster has 0 valid area in this region.",
            source="raster:solution",
        )
    return _metric_value(
        definition,
        value=pct,
        status="ready",
        notes="selectedArea / boundaryValidArea × 100.",
        source="raster:solution",
    )


# ---------------------------------------------------------------------------
# Individual metric computers (operate on a SolutionRaster, may be masked)
# ---------------------------------------------------------------------------


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
            definition,
            value=None,
            status="derivation_needed",
            notes="No usable summary CSV species coverage or manifest coverage rows.",
            source="manifest:coverage",
        )
    met_count = sum(
        1 for row in coverage if isinstance(row, dict) and row.get("met") is True
    )
    return _metric_value(
        definition,
        value=met_count,
        status="ready",
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
    if solution.get("_metricsSummaryUnavailable"):
        return None

    metadata_url = solution.get("_resolvedSummaryCsvUrl") or solution.get("metadataUrl")
    if not isinstance(metadata_url, str) or not metadata_url:
        return None

    summary_url = (
        metadata_url
        if solution.get("_resolvedSummaryCsvUrl")
        else resolve_summary_csv_url(metadata_url)
    )
    try:
        summary_download = cached_download(summary_url, cache_dir, force=force_download)
        details = compute_species_group_coverage_details(
            summary_download.path, species_records
        )
    except Exception as exc:  # noqa: BLE001 - summary metadata is best-effort
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


def _compute_selected_area(
    definition: MetricDefinition, raster: SolutionRaster, subnational: bool = False
) -> dict[str, Any]:
    value = calc_area.selected_area_km2(raster)
    context = "within boundary" if subnational else "national"
    return _metric_value(
        definition,
        value=value,
        status="ready",
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
            definition,
            value=None,
            status="blocked",
            notes="Raster has 0 valid area in this region.",
            source="raster:solution",
        )
    if subnational:
        return _metric_value(
            definition,
            value=pct,
            status="ready",
            notes="selectedArea / boundaryValidArea × 100 (boundary scope).",
            source="raster:solution",
        )
    return _metric_value(
        definition,
        value=pct,
        status="ready",
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
                definition,
                value=None,
                status="pending",
                notes=f"No percent calculator registered for layer '{layer_id}'.",
                source=f"raster:{layer_id}",
            )
        pct = calc_fn(raster, layer_mask)
        if pct is None:
            return _metric_value(
                definition,
                value=None,
                status="blocked",
                notes="Selected area is zero; cannot compute percent.",
                source=f"raster:{layer_id}",
            )
        return _metric_value(
            definition,
            value=pct,
            status="ready",
            notes=f"(Selected ∩ '{layer_id}') / selected_area × 100.",
            source=f"raster:{layer_id}",
        )

    # binary_overlap_area
    calc_fn = overlap_area_calculator(layer_id)
    if calc_fn is None:
        return _metric_value(
            definition,
            value=None,
            status="pending",
            notes=f"No calculator registered for layer '{layer_id}'.",
            source=f"raster:{layer_id}",
        )
    area = calc_fn(raster, layer_mask)
    value_type = str(rendering.get("valueType") or "unknown").lower()
    if value_type == "binary":
        present_rule = (
            f"cells equal to selectedValue={rendering.get('selectedValue', 1)}"
        )
    else:
        present_rule = "all valid (non-nodata) cells"
    return _metric_value(
        definition,
        value=area,
        status="ready",
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
    *,
    allow_sparse: bool = False,
) -> tuple[dict[str, Any], np.ndarray | None]:
    """Download (or retrieve cached) layer mask, compute overlap, return (metric, mask)."""
    layer_id = definition.layer_id or ""
    try:
        layer_url = _resolve_layer_url(manifest, layer_id)
    except ManifestError as exc:
        return _metric_value(
            definition,
            value=None,
            status="blocked",
            notes=f"Layer '{layer_id}' unavailable: {exc}",
            source=f"raster:{layer_id}",
        ), None

    rendering = _layer_rendering(manifest, layer_id)
    try:
        mask = layer_cache.get(
            layer_id,
            layer_url,
            raster.fingerprint,
            rendering,
            cache_dir,
            force_download,
            allow_sparse=allow_sparse,
            sparse_binding=_layer_sparse_binding(manifest, layer_id, layer_url),
        )
    except (RasterError, OSError) as exc:
        return _metric_value(
            definition,
            value=None,
            status="blocked",
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
            definition,
            value=None,
            status="pending",
            notes=f"No categorical calculator registered for '{definition.metric_id}'.",
            source=f"raster:{layer_id}",
        )
    area = calc_fn(raster, layer_values)
    return _metric_value(
        definition,
        value=area,
        status="ready",
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
            definition,
            value=None,
            status="blocked",
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
            definition,
            value=None,
            status="blocked",
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
            definition,
            value=None,
            status="blocked",
            notes=f"Layer '{layer_id}' unavailable: {exc}",
            source=f"raster:{layer_id}",
        ), None

    try:
        values = value_cache.get(
            layer_id, layer_url, raster.fingerprint, cache_dir, force_download
        )
    except (RasterError, OSError) as exc:
        return _metric_value(
            definition,
            value=None,
            status="blocked",
            notes=f"Could not read layer '{layer_id}': {exc}",
            source=f"raster:{layer_id}",
        ), None

    if definition.kind == "weighted_percent_of_national":
        calc_fn = weighted_percent_calculator(layer_id)
        if calc_fn is None:
            return _metric_value(
                definition,
                value=None,
                status="pending",
                notes=f"No weighted-percent calculator for layer '{layer_id}'.",
                source=f"raster:{layer_id}",
            ), values
        result = calc_fn(raster, values)
        if result is None:
            return _metric_value(
                definition,
                value=None,
                status="blocked",
                notes="National weighted total is zero; cannot compute percent.",
                source=f"raster:{layer_id}",
            ), values
        return _metric_value(
            definition,
            value=result,
            status="ready",
            notes=f"selectedWeightedSum('{layer_id}') / nationalWeightedSum × 100.",
            source=f"raster:{layer_id}",
        ), values

    # weighted_sum
    calc_fn = weighted_sum_calculator(definition)
    if calc_fn is None:
        return _metric_value(
            definition,
            value=None,
            status="pending",
            notes=f"No weighted-sum calculator for layer '{layer_id}'.",
            source=f"raster:{layer_id}",
        ), values
    result = calc_fn(raster, values)
    return _metric_value(
        definition,
        value=result,
        status="ready",
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
    target_policy: SpeciesTargetPolicy,
) -> dict[str, Any]:
    """Pull the right field out of a precomputed SpeciesScopeMetrics bundle."""
    if species_metrics is None:
        return _metric_value(
            definition,
            value=None,
            status="derivation_needed",
            notes="Species accumulator unavailable; CSV or species TIFs missing.",
            source="csv:biomod_spp_ranges_updatedIUCN",
        )

    if (
        definition.kind
        in {
            "species_group_coverage",
            "species_threatened_secured",
        }
        and target_policy.kind == "dual_reference"
    ):
        outcomes = (
            species_metrics.species_group_reference_outcomes
            if definition.kind == "species_group_coverage"
            else species_metrics.threatened_secured_reference_outcomes
        )
        return _metric_value(
            definition,
            value=None,
            status="partial",
            notes=(
                "No species optimization target was configured; reporting "
                "17% and 30% reference-threshold outcomes."
            ),
            source="manifest:finderInputs.structuredTargets",
            details={"thresholdOutcomes": outcomes},
        )

    if definition.kind == "species_group_coverage":
        if target_policy.kind == "scalar" and target_policy.scalar_target_pct is None:
            return _metric_value(
                definition,
                value=None,
                status="derivation_needed",
                notes=(
                    "Could not resolve an unambiguous species target percent from "
                    "manifest metadata or legacy solution tokens; species group "
                    "coverage cannot be computed."
                ),
                source="csv:biomod_spp_ranges_updatedIUCN+raster:species_ranges",
            )
        details = species_metrics.species_group_coverage
        summary = details.get("summary") if isinstance(details, dict) else None
        met_species_count = (
            int(summary.get("metSpeciesCount", 0)) if isinstance(summary, dict) else 0
        )
        total_species_count = (
            int(summary.get("totalSpeciesCount", 0)) if isinstance(summary, dict) else 0
        )
        if target_policy.kind == "per_species":
            notes = (
                f"{met_species_count:,} of {total_species_count:,} modeled target species "
                "with usable range rasters meet their own structured targetPercent. "
                "See details.groups for taxonomic and IUCN breakdowns."
            )
        else:
            target_pct = target_policy.scalar_target_pct
            assert target_pct is not None
            notes = (
                f"{met_species_count:,} of {total_species_count:,} modeled species with usable "
                f"range rasters meet the {target_pct:g}% solution target. "
                "See details.groups for taxonomic and IUCN breakdowns."
            )
        return _metric_value(
            definition,
            value=met_species_count,
            status="ready",
            notes=notes,
            source="csv:biomod_spp_ranges_updatedIUCN+raster:species_ranges",
            details=details,
        )

    if definition.kind == "species_richness":
        bucket = definition.species_bucket
        field_name = _SPECIES_BUCKET_TO_FIELD.get(bucket or "")
        if not field_name:
            return _metric_value(
                definition,
                value=None,
                status="pending",
                notes=f"Unknown species_bucket '{bucket}' for {definition.metric_id}.",
                source="csv:biomod_spp_ranges_updatedIUCN",
            )
        value = int(getattr(species_metrics, field_name))
        return _metric_value(
            definition,
            value=value,
            status="ready",
            notes=(
                "Species count where exact source-grid intersection area with "
                f"the priority area is positive in this scope (bucket: {bucket})."
            ),
            source="csv:biomod_spp_ranges_updatedIUCN+raster:species_ranges",
        )

    if definition.kind == "species_threatened_count":
        return _metric_value(
            definition,
            value=int(species_metrics.threatened_present),
            status="ready",
            notes=(
                "CR/EN/VU non-fish species with positive exact range-intersection "
                "area in the priority area."
            ),
            source="csv:biomod_spp_ranges_updatedIUCN+raster:species_ranges",
        )

    if definition.kind == "species_threatened_secured":
        if target_policy.kind == "scalar" and target_policy.scalar_target_pct is None:
            return _metric_value(
                definition,
                value=None,
                status="derivation_needed",
                notes=(
                    "Could not resolve an unambiguous species target percent from "
                    "manifest metadata or legacy solution tokens; secured count "
                    "cannot be computed."
                ),
                source="csv:biomod_spp_ranges_updatedIUCN+raster:species_ranges",
            )
        if target_policy.kind == "per_species":
            notes = (
                "CR/EN/VU non-fish target species where (range ∩ priority area within scope) "
                "/ (range within scope) × 100 meets that species' structured targetPercent."
            )
        else:
            target_pct = target_policy.scalar_target_pct
            assert target_pct is not None
            notes = (
                f"CR/EN/VU non-fish species where (range ∩ priority area within scope) "
                f"/ (range within scope) ≥ {target_pct:g}%."
            )
        return _metric_value(
            definition,
            value=int(species_metrics.threatened_secured),
            status="ready",
            notes=notes,
            source="csv:biomod_spp_ranges_updatedIUCN+raster:species_ranges",
        )

    if definition.kind == "species_pct_of_national":
        return _metric_value(
            definition,
            value=float(species_metrics.pct_of_national),
            status="ready",
            notes="(non-fish species present in scope) / (8,300 non-fish pool) × 100.",
            source="csv:biomod_spp_ranges_updatedIUCN+raster:species_ranges",
        )

    return _metric_value(
        definition,
        value=None,
        status="pending",
        notes=f"Unhandled species kind '{definition.kind}'.",
        source="script",
    )


# ---------------------------------------------------------------------------
# Species accumulator pass (computes #3, #21–#26, #28 across all scopes)
# ---------------------------------------------------------------------------


def _species_goals_provenance(
    *,
    release_id: str,
    species_csv_sha256: str,
    species_exception_source_sha256: str | None,
    species_exception_binding: dict[str, Any] | None,
    alignment_provenance: dict[str, Any],
    solution_raster_sha256: str,
    target_policy: SpeciesTargetPolicy,
    boundary_provenance_sha256: str,
    catalog_sha256: str,
) -> dict[str, Any]:
    return {
        "releaseId": release_id,
        "speciesCsvSha256": species_csv_sha256,
        "exceptionSourceSha256": species_exception_source_sha256,
        "exceptionPolicySha256": (
            species_exception_binding.get("policySha256")
            if species_exception_binding is not None
            else None
        ),
        "exceptionBindingSha256": (
            species_goals_sha256(species_exception_binding)
            if species_exception_binding is not None
            else None
        ),
        "exactOverlapAlgorithmVersion": SPECIES_OVERLAP_ALGORITHM_VERSION,
        "exactOverlapPolicySha256": species_goals_sha256(SPECIES_POLICY.__dict__),
        "targetGridSha256": alignment_provenance["targetGridSha256"],
        "speciesAlignmentInventorySha256": alignment_provenance["sha256"],
        "solutionRasterSha256": solution_raster_sha256,
        "targetPolicySha256": species_goals_sha256(
            {
                "kind": target_policy.kind,
                "scalarTargetPercent": target_policy.scalar_target_pct,
                "targetsBySpecies": target_policy.targets_by_species,
                "provenance": target_policy.provenance,
            }
        ),
        "boundaryProvenanceSha256": boundary_provenance_sha256,
        "catalogSha256": catalog_sha256,
    }


def _species_exception_source_sha256(
    species_exception: SpeciesExceptionPolicy | None,
) -> str | None:
    if species_exception is None:
        return None
    return hashlib.sha256(species_exception.source_path.read_bytes()).hexdigest()


def _process_species_for_solution(
    raster: SolutionRaster,
    solution: dict[str, Any],
    species_records: list[SpeciesRecord],
    pool_sizes: SpeciesPoolSizes,
    boundary_grids: dict[str, BoundaryIdGrid | AnyBoundaryIndex],
    cache_dir: Path,
    force_download: bool,
    alignment_cache: RasterAlignmentCache,
    target_policy: SpeciesTargetPolicy,
    detail_sink: SpeciesDetailSink | None = None,
    runtime_stats: dict[str, Any] | None = None,
) -> SpeciesAccumulator:
    """Read every species range raster once and accumulate counts across scopes.

    For each species:

    - Download (cached) the species TIF and load its deterministic sparse exact
      overlap indexes and area weights.
    - Index into the solution's selected mask and sum exact source-grid
      intersection area in selected target cells.
    - National counters are updated from positive area and weighted coverage.
    - Sub-national counters use either the legacy first-owner grid or the
      grouped exclusive/CSR topology. The grouped path indexes sparse range
      cells directly and duplicates full weights to every overlapping owner.

    The target percent is resolved from structured manifest metadata with a
    legacy solution-token fallback. When None, target-dependent species metrics
    are reported as 'derivation_needed'.
    """
    sub_sizes = {level: g.num_boundaries for level, g in boundary_grids.items()}
    accumulator = SpeciesAccumulator(
        target_pct=target_policy.scalar_target_pct,
        pool_sizes=pool_sizes,
        target_policy=target_policy,
        species_expected=len(species_records),
        detail_sink=detail_sink,
    )
    accumulator.init_sub(sub_sizes)

    selected_flat = raster.selected_mask.ravel()
    pre_existing_flat = raster.pre_existing_mask.ravel()
    new_prioritizr_flat = raster.new_prioritizr_mask.ravel()
    has_grouped_levels = any(
        not isinstance(boundary_index, BoundaryIdGrid)
        for boundary_index in boundary_grids.values()
    )
    has_legacy_levels = any(
        isinstance(boundary_index, BoundaryIdGrid)
        for boundary_index in boundary_grids.values()
    )

    started = time.time()
    exact_read_seconds = 0.0
    evaluation_seconds = 0.0
    accumulator_seconds = 0.0
    npz_bytes = 0
    npz_opens = 0
    for idx, sp in enumerate(species_records, start=1):
        if idx % _SPECIES_PROGRESS_INTERVAL == 0:
            elapsed = time.time() - started
            print(
                f"[tier1-metrics]   species: {idx}/{len(species_records)} "
                f"({elapsed:.1f}s, present_nat={accumulator.national.all_present})"
            )

        try:
            url = sp.blob_url
            dl = cached_download(url, cache_dir, force=force_download)
            aligned = alignment_cache.species.align(
                dl.path,
                dl.sha256,
                raster.fingerprint,
                source_url=url,
                authoritative_area_km2=sp.range_km2,
            )
            exact_read_started = time.perf_counter()
            overlap = read_species_overlap(aligned.path, raster.fingerprint)
            exact_read_seconds += time.perf_counter() - exact_read_started
            npz_bytes += aligned.path.stat().st_size
            npz_opens += 1
            accumulator.species_aligned += 1
            accumulator.species_processed += 1
        except (AlignmentError, DownloadError, RasterError, OSError, ValueError) as exc:
            accumulator.species_missing_tif += 1
            raise AlignmentError(
                f"Species input {sp.blob_filename!r} failed; no metrics will be "
                f"accepted for this solution: {exc}"
            ) from exc

        evaluation_started = time.perf_counter()
        accumulator_before = accumulator_seconds
        range_indices = overlap.flat_indices
        range_areas_m2 = overlap.areas_m2
        total_range_area_m2 = float(range_areas_m2.sum(dtype=np.float64))
        if range_indices.size == 0:
            accumulation_started = time.perf_counter()
            accumulator.record_species_national(sp, 0.0, 0.0)
            accumulator_seconds += time.perf_counter() - accumulation_started
            evaluation_seconds += (
                time.perf_counter()
                - evaluation_started
                - (accumulator_seconds - accumulator_before)
            )
            continue

        accumulator.species_with_range += 1

        selected_at_range = selected_flat[range_indices]
        pre_existing_at_range = pre_existing_flat[range_indices]
        new_prioritizr_at_range = new_prioritizr_flat[range_indices]
        selected_range_area_m2 = float(
            range_areas_m2[selected_at_range].sum(dtype=np.float64)
        )
        pre_existing_range_area_m2 = float(
            range_areas_m2[pre_existing_at_range].sum(dtype=np.float64)
        )
        new_prioritizr_range_area_m2 = float(
            range_areas_m2[new_prioritizr_at_range].sum(dtype=np.float64)
        )

        accumulation_started = time.perf_counter()
        accumulator.record_species_national(
            sp,
            selected_range_area_m2,
            total_range_area_m2,
            pre_existing_range_area_m2=pre_existing_range_area_m2,
            new_prioritizr_range_area_m2=new_prioritizr_range_area_m2,
        )
        accumulator_seconds += time.perf_counter() - accumulation_started

        if (
            selected_range_area_m2 <= 0
            and detail_sink is None
            and target_policy.kind == "per_species"
            and target_policy.target_for(sp.scientific_name) is None
        ):
            evaluation_seconds += (
                time.perf_counter()
                - evaluation_started
                - (accumulator_seconds - accumulator_before)
            )
            continue

        prepared_grouped_channels = (
            prepare_sparse_boundary_weighted_channels(
                range_indices,
                range_areas_m2,
                selected=selected_at_range,
                pre_existing=pre_existing_at_range,
                new_prioritizr=new_prioritizr_at_range,
                num_pixels=selected_flat.size,
            )
            if has_grouped_levels
            else None
        )
        if has_legacy_levels:
            selected_range_indices = range_indices[selected_at_range]
            selected_range_areas_m2 = range_areas_m2[selected_at_range]
            pre_existing_range_indices = range_indices[pre_existing_at_range]
            pre_existing_range_areas_m2 = range_areas_m2[pre_existing_at_range]
            new_prioritizr_range_indices = range_indices[new_prioritizr_at_range]
            new_prioritizr_range_areas_m2 = range_areas_m2[new_prioritizr_at_range]

        for level, boundary_index in boundary_grids.items():
            if not isinstance(boundary_index, BoundaryIdGrid):
                assert prepared_grouped_channels is not None
                grouped_areas = aggregate_prepared_sparse_boundary_weighted_sums(
                    boundary_index,
                    prepared_grouped_channels,
                )
                accumulation_started = time.perf_counter()
                accumulator.record_species_sub_level(
                    sp,
                    level,
                    grouped_areas.selected,
                    grouped_areas.total,
                    pre_existing_per_boundary=grouped_areas.pre_existing,
                    new_prioritizr_per_boundary=grouped_areas.new_prioritizr,
                )
                accumulator_seconds += time.perf_counter() - accumulation_started
                continue

            bid_arr = boundary_index.flat
            bids_at_range = bid_arr[range_indices]
            bids_at_selected = bid_arr[selected_range_indices]
            bids_at_pre_existing = bid_arr[pre_existing_range_indices]
            bids_at_new_prioritizr = bid_arr[new_prioritizr_range_indices]

            n_levels = boundary_index.num_boundaries
            mask_total = bids_at_range >= 0
            mask_sel = bids_at_selected >= 0
            mask_pre_existing = bids_at_pre_existing >= 0
            mask_new_prioritizr = bids_at_new_prioritizr >= 0
            total_per = np.bincount(
                bids_at_range[mask_total]
                if mask_total.any()
                else np.empty(0, dtype=np.int32),
                weights=(
                    range_areas_m2[mask_total]
                    if mask_total.any()
                    else np.empty(0, dtype=np.float64)
                ),
                minlength=n_levels,
            )
            sel_per = (
                np.bincount(
                bids_at_selected[mask_sel],
                weights=selected_range_areas_m2[mask_sel],
                minlength=n_levels,
            )
                if mask_sel.any()
                else np.zeros(n_levels, dtype=np.float64)
            )
            pre_existing_per = (
                np.bincount(
                    bids_at_pre_existing[mask_pre_existing],
                    weights=pre_existing_range_areas_m2[mask_pre_existing],
                    minlength=n_levels,
                )
                if mask_pre_existing.any()
                else np.zeros(n_levels, dtype=np.float64)
            )
            new_prioritizr_per = (
                np.bincount(
                    bids_at_new_prioritizr[mask_new_prioritizr],
                    weights=new_prioritizr_range_areas_m2[mask_new_prioritizr],
                    minlength=n_levels,
                )
                if mask_new_prioritizr.any()
                else np.zeros(n_levels, dtype=np.float64)
            )
            accumulation_started = time.perf_counter()
            accumulator.record_species_sub_level(
                sp,
                level,
                sel_per,
                total_per,
                pre_existing_per_boundary=pre_existing_per,
                new_prioritizr_per_boundary=new_prioritizr_per,
            )
            accumulator_seconds += time.perf_counter() - accumulation_started
        evaluation_seconds += (
            time.perf_counter()
            - evaluation_started
            - (accumulator_seconds - accumulator_before)
        )

    elapsed = time.time() - started
    print(
        f"[tier1-metrics]   species: done in {elapsed:.1f}s "
        f"(processed={accumulator.species_processed}, with_range={accumulator.species_with_range}, "
        f"missing={accumulator.species_missing_tif}, target_policy={target_policy.kind})"
    )
    if not (
        accumulator.species_expected
        == accumulator.species_aligned
        == accumulator.species_processed
        and accumulator.species_missing_tif == 0
    ):
        raise AlignmentError(
            "Species completeness failed: "
            f"expected={accumulator.species_expected}, "
            f"aligned={accumulator.species_aligned}, "
            f"processed={accumulator.species_processed}, "
            f"missing={accumulator.species_missing_tif}."
        )
    if runtime_stats is not None:
        runtime_stats.update(
            {
                "npzOpens": npz_opens,
                "npzBytes": npz_bytes,
                "phaseSeconds": {
                    "exactRead": exact_read_seconds,
                    "evaluation": evaluation_seconds,
                    "accumulator": accumulator_seconds,
                },
            }
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


def _build_grouped_boundary_primitives(
    raster: SolutionRaster,
    indexes: dict[str, AnyBoundaryIndex],
    definitions: tuple[MetricDefinition, ...],
    layer_masks: dict[str, np.ndarray],
    layer_values: dict[str, np.ndarray],
) -> dict[str, _GroupedBoundaryPrimitives]:
    """Aggregate migrated raster primitives once per level and layer."""

    shape = raster.selected_mask.shape
    area_weights = np.broadcast_to(
        raster.pixel_area_km2_per_row[:, np.newaxis],
        shape,
    )
    binary_layer_ids = {
        definition.layer_id
        for definition in definitions
        if definition.layer_id
        and definition.kind
        in {"binary_overlap_area", "binary_overlap_percent_of_selected"}
    }
    categorical_definitions = tuple(
        definition
        for definition in definitions
        if definition.kind == "categorical_overlap_area"
    )
    empty = np.zeros(shape, dtype=np.bool_)
    grouped: dict[str, _GroupedBoundaryPrimitives] = {}

    for level, index in indexes.items():
        counts = aggregate_boundary_counts(
            index,
            total=raster.valid_mask,
            selected=raster.selected_mask,
            pre_existing=raster.pre_existing_mask,
            new_prioritizr=raster.new_prioritizr_mask,
        )
        areas = aggregate_boundary_weighted_sums(
            index,
            area_weights,
            total=raster.valid_mask,
            selected=raster.selected_mask,
            pre_existing=raster.pre_existing_mask,
            new_prioritizr=raster.new_prioritizr_mask,
        )

        overlap_areas: dict[str, np.ndarray] = {}
        for layer_id in binary_layer_ids:
            active = raster.selected_mask & layer_masks[layer_id]
            overlap_areas[layer_id] = aggregate_boundary_weighted_sums(
                index,
                area_weights,
                total=active,
                selected=empty,
                pre_existing=empty,
                new_prioritizr=empty,
            ).total

        categorical_areas: dict[str, np.ndarray] = {}
        for definition in categorical_definitions:
            class_ids = _CATEGORICAL_CLASS_IDS.get(definition.metric_id)
            if class_ids is None:
                continue
            values = layer_values[definition.layer_id or ""]
            active = (
                raster.selected_mask
                & np.isfinite(values)
                & np.isin(values, tuple(class_ids))
            )
            categorical_areas[definition.metric_id] = (
                aggregate_boundary_weighted_sums(
                    index,
                    area_weights,
                    total=active,
                    selected=empty,
                    pre_existing=empty,
                    new_prioritizr=empty,
                ).total
            )

        grouped[level] = _GroupedBoundaryPrimitives(
            boundary_grid_cells=boundary_cell_counts(index),
            valid_cells=counts.total,
            selected_cells=counts.selected,
            valid_area_km2=areas.total,
            selected_area_km2=areas.selected,
            overlap_area_km2=overlap_areas,
            categorical_area_km2=categorical_areas,
        )
    return grouped


def _grouped_metric_overrides(
    definitions: tuple[MetricDefinition, ...],
    primitives: _GroupedBoundaryPrimitives,
    boundary_index: int,
    manifest: ResolvedManifest,
) -> dict[str, dict[str, Any]]:
    """Assemble existing metric payloads from grouped scalar primitives."""

    selected_cells = int(primitives.selected_cells[boundary_index])
    selected_area = float(primitives.selected_area_km2[boundary_index])
    valid_area = float(primitives.valid_area_km2[boundary_index])
    overrides: dict[str, dict[str, Any]] = {}

    for definition in definitions:
        if definition.kind not in _GROUPED_METRIC_KINDS:
            continue
        if definition.kind == "selected_area":
            metric = _metric_value(
                definition,
                value=selected_area,
                status="ready",
                notes=(
                    f"{selected_cells:,} selected cells (within boundary); "
                    "area summed using per-row pixel area (km²/cell)."
                ),
                source="raster:solution",
            )
        elif definition.kind in {"national_percent", "aoi_percent"}:
            if valid_area == 0.0:
                metric = _metric_value(
                    definition,
                    value=None,
                    status="blocked",
                    notes="Raster has 0 valid area in this region.",
                    source="raster:solution",
                )
            else:
                metric = _metric_value(
                    definition,
                    value=(selected_area / valid_area) * 100.0,
                    status="ready",
                    notes=(
                        "selectedArea / boundaryValidArea × 100 (boundary scope)."
                        if definition.kind == "national_percent"
                        else "selectedArea / boundaryValidArea × 100."
                    ),
                    source="raster:solution",
                )
        elif definition.kind in {
            "binary_overlap_area",
            "binary_overlap_percent_of_selected",
        }:
            layer_id = definition.layer_id or ""
            area = float(primitives.overlap_area_km2[layer_id][boundary_index])
            if definition.kind == "binary_overlap_percent_of_selected":
                if overlap_percent_calculator(layer_id) is None:
                    metric = _metric_value(
                        definition,
                        value=None,
                        status="pending",
                        notes=f"No percent calculator registered for layer '{layer_id}'.",
                        source=f"raster:{layer_id}",
                    )
                elif selected_area == 0.0:
                    metric = _metric_value(
                        definition,
                        value=None,
                        status="blocked",
                        notes="Selected area is zero; cannot compute percent.",
                        source=f"raster:{layer_id}",
                    )
                else:
                    metric = _metric_value(
                        definition,
                        value=(area / selected_area) * 100.0,
                        status="ready",
                        notes=f"(Selected ∩ '{layer_id}') / selected_area × 100.",
                        source=f"raster:{layer_id}",
                    )
            elif overlap_area_calculator(layer_id) is None:
                metric = _metric_value(
                    definition,
                    value=None,
                    status="pending",
                    notes=f"No calculator registered for layer '{layer_id}'.",
                    source=f"raster:{layer_id}",
                )
            else:
                rendering = _layer_rendering(manifest, layer_id)
                value_type = str(rendering.get("valueType") or "unknown").lower()
                present_rule = (
                    f"cells equal to selectedValue={rendering.get('selectedValue', 1)}"
                    if value_type == "binary"
                    else "all valid (non-nodata) cells"
                )
                metric = _metric_value(
                    definition,
                    value=area,
                    status="ready",
                    notes=(
                        f"Selected ∩ '{layer_id}' ({value_type}; "
                        f"presence = {present_rule})."
                    ),
                    source=f"raster:{layer_id}",
                )
        else:
            layer_id = definition.layer_id or ""
            value = primitives.categorical_area_km2.get(definition.metric_id)
            if categorical_area_calculator(definition.metric_id) is None or value is None:
                metric = _metric_value(
                    definition,
                    value=None,
                    status="pending",
                    notes=f"No categorical calculator registered for '{definition.metric_id}'.",
                    source=f"raster:{layer_id}",
                )
            else:
                metric = _metric_value(
                    definition,
                    value=float(value[boundary_index]),
                    status="ready",
                    notes=(
                        f"Selected ∩ configured categorical classes in '{layer_id}'; "
                        "nodata and non-selected cells excluded."
                    ),
                    source=f"raster:{layer_id}",
                )
        overrides[definition.metric_id] = metric
    return overrides


def _weighted_metric_overrides(
    definitions: tuple[MetricDefinition, ...],
    *,
    level: str,
    boundary_index: int,
    fanout: WeightedFanoutResult,
    layers: dict[str, PreparedWeightedLayer],
) -> dict[str, dict[str, Any]]:
    """Assemble the existing payload contract from approved grouped sums."""

    specs = approved_weighted_specs(definitions)
    results = assemble_weighted_metric_results(
        specs,
        level=level,
        boundary_index=boundary_index,
        fanout=fanout,
        layers=layers,
    )
    by_id = {definition.metric_id: definition for definition in definitions}
    overrides: dict[str, dict[str, Any]] = {}
    for spec in specs:
        definition = by_id[spec.metric_id]
        result = results[spec.metric_id]
        notes = (
            f"sum(pixel_value × pixel_area_km²) over selected finite cells of "
            f"'{spec.layer_id}'."
            if spec.kind == "weighted_sum"
            else f"selectedWeightedSum / nationalWeightedSum × 100 ('{spec.layer_id}')."
        )
        if result.status == "blocked":
            notes = "National weighted total is zero."
        overrides[spec.metric_id] = _metric_value(
            definition,
            value=result.value,
            status=result.status,
            notes=notes,
            source=f"raster:{spec.layer_id}",
        )
    return overrides


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
    species_target_policy: SpeciesTargetPolicy | None = None,
    species_records: list[SpeciesRecord] | None = None,
    species_exception_binding: dict[str, Any] | None = None,
    grouped_metric_overrides: dict[str, dict[str, Any]] | None = None,
    scope_valid_cells: int | None = None,
) -> list[dict[str, Any]]:
    """Compute all computable Tier 1 metrics for one raster scope.

    - subnational=True: skip manifest-sourced metadata metrics (mark not_applicable).
    - preloaded_layer_masks: if provided, skip mask layer downloads and use these directly.
    - preloaded_layer_values: if provided, skip numeric layer downloads and use these directly.
    - species_metrics: precomputed species values for this scope (None means species
      metrics will be marked 'derivation_needed').
    - species_target_policy: scalar, per-species, or dual-reference target semantics.
    - species_records: loaded species lookup records, used by metadata summary CSV coverage.
    """
    results: list[dict[str, Any]] = []
    domain = solution_domain(solution)

    effective_valid_cells = (
        raster.valid_cells if scope_valid_cells is None else scope_valid_cells
    )
    if subnational and effective_valid_cells == 0:
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

        if grouped_metric_overrides and defn.metric_id in grouped_metric_overrides:
            results.append(grouped_metric_overrides[defn.metric_id])
            continue

        if is_species_metric_kind(defn.kind):
            policy = species_target_policy or SpeciesTargetPolicy(
                "scalar", None, {}, None
            )
            metric = _compute_species_metric(defn, species_metrics, policy)
            if species_exception_binding is not None and (
                (
                    metric.get("status") == "ready"
                and isinstance(metric.get("value"), (int, float))
                )
                or (
                    policy.kind == "dual_reference"
                    and defn.kind
                    in {
                        "species_group_coverage",
                        "species_threatened_secured",
                    }
                    and metric.get("status") == "partial"
                    and metric.get("value") is None
                )
            ):
                metric["status"] = "partial"
                metric["notes"] = (
                    f"{metric.get('notes') or ''} Partial: "
                    f"{species_exception_binding['excluded']} approved unavailable "
                    "species sources were excluded."
                ).strip()
                metric["details"] = {
                    **(metric.get("details") or {}),
                    "speciesException": species_exception_binding,
                }
            results.append(metric)
            continue

        if defn.kind in _NATIONAL_ONLY_KINDS:
            if subnational:
                results.append(_not_applicable(defn))
            elif defn.kind == "metadata_summary":
                results.append(_compute_metadata_summary(defn, solution))
            else:
                results.append(
                    _compute_metadata_coverage(
                    defn,
                    solution,
                    cache_dir,
                    force_download,
                    species_records,
                    )
                )

        elif defn.kind == "selected_area":
            results.append(
                _compute_selected_area(defn, raster, subnational=subnational)
            )

        elif defn.kind == "national_percent":
            results.append(
                _compute_national_percent(defn, raster, subnational=subnational)
            )

        elif defn.kind == "aoi_percent":
            results.append(_compute_aoi_percent(defn, raster, subnational))

        elif defn.kind == "blocked_no_data":
            results.append(_blocked_no_data(defn))

        elif defn.kind in ("binary_overlap_area", "binary_overlap_percent_of_selected"):
            layer_id = defn.layer_id or ""
            if preloaded_layer_masks and layer_id in preloaded_layer_masks:
                rendering = _layer_rendering(manifest, layer_id)
                results.append(
                    _compute_overlap_from_mask(
                        defn,
                        raster,
                        preloaded_layer_masks[layer_id],
                        layer_id,
                        rendering,
                    )
                )
            else:
                metric, _ = _compute_overlap_download(
                    defn,
                    raster,
                    manifest,
                    layer_cache,
                    cache_dir,
                    force_download,
                    allow_sparse=domain == "land",
                )
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
                        results.append(
                            _metric_value(
                                defn,
                                value=None,
                                status="pending",
                            notes=f"No weighted-percent calculator for '{layer_id}'.",
                            source=f"raster:{layer_id}",
                            )
                        )
                        continue
                    result = calc_fn(raster, values)
                    if result is None:
                        results.append(
                            _metric_value(
                                defn,
                                value=None,
                                status="blocked",
                            notes="National weighted total is zero.",
                            source=f"raster:{layer_id}",
                            )
                        )
                    else:
                        results.append(
                            _metric_value(
                                defn,
                                value=result,
                                status="ready",
                            notes=f"selectedWeightedSum / nationalWeightedSum × 100 ('{layer_id}').",
                            source=f"raster:{layer_id}",
                            )
                        )
                else:
                    calc_fn = weighted_sum_calculator(defn)
                    if calc_fn is None:
                        results.append(
                            _metric_value(
                                defn,
                                value=None,
                                status="pending",
                            notes=f"No weighted-sum calculator for '{layer_id}'.",
                            source=f"raster:{layer_id}",
                            )
                        )
                        continue
                    result = calc_fn(raster, values)
                    results.append(
                        _metric_value(
                            defn,
                            value=result,
                            status="ready",
                        notes=f"sum(pixel_value × pixel_area_km²) over selected finite cells of '{layer_id}'.",
                        source=f"raster:{layer_id}",
                        )
                    )
            else:
                metric, _ = _compute_weighted_download(
                    defn, raster, manifest, value_cache, cache_dir, force_download
                )
                results.append(metric)

        else:
            results.append(
                _metric_value(
                    defn,
                    value=None,
                    status="pending",
                    notes=f"Unhandled metric kind '{defn.kind}'.",
                    source="script",
                )
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
    """Load all mask-based layers into the in-memory dense-mask cache.

    These masks are then passed directly to sub-national metric computation,
    avoiding repeated disk reads for each of the 1000+ boundary features.
    Sparse grouped-boundary calculation is intentionally not implemented here.
    """
    # Determine which layer_ids are used by mask-based metric kinds.
    mask_kinds = frozenset(
        {"binary_overlap_area", "binary_overlap_percent_of_selected"}
    )
    mask_layer_ids = {
        m.layer_id
        for m in _metrics_for_domain(domain)
        if m.layer_id and m.kind in mask_kinds
    }

    masks: dict[str, np.ndarray] = {}
    for layer_id in mask_layer_ids:
        try:
            url = _resolve_layer_url(manifest, layer_id)
            rendering = _layer_rendering(manifest, layer_id)
            masks[layer_id] = layer_cache.get(
                layer_id,
                url,
                raster.fingerprint,
                rendering,
                cache_dir,
                force_download,
                allow_sparse=domain == "land",
                sparse_binding=_layer_sparse_binding(manifest, layer_id, url),
            )
        except (AlignmentError, ManifestError, RasterError, OSError) as exc:
            raise AlignmentError(
                f"Required mask layer {layer_id!r} could not be loaded: {exc}"
            ) from exc
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
    value_kinds = frozenset(
        {
        "categorical_overlap_area",
        "weighted_sum",
        "weighted_percent_of_national",
        }
    )
    value_layer_ids = {
        m.layer_id
        for m in _metrics_for_domain(domain)
        if m.layer_id and m.kind in value_kinds
    }

    arrays: dict[str, np.ndarray] = {}
    for layer_id in value_layer_ids:
        try:
            url = _resolve_layer_url(manifest, layer_id)
            arrays[layer_id] = value_cache.get(
                layer_id, url, raster.fingerprint, cache_dir, force_download
            )
        except (AlignmentError, ManifestError, RasterError, OSError) as exc:
            raise AlignmentError(
                f"Required value layer {layer_id!r} could not be loaded: {exc}"
            ) from exc
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
    species_csv_sha256: str | None = None,
    cache_blob_directory: str = CACHE_BLOB_DIRECTORY,
    release_id: str | None = None,
    solution_input_signature: dict[str, str] | None = None,
    solution_catalog_binding: dict[str, Any] | None = None,
    raster_download: CachedDownload | None = None,
    alignment_cache: RasterAlignmentCache | None = None,
    alignment_provenance: dict[str, Any] | None = None,
    species_exception_binding: dict[str, Any] | None = None,
    species_exception_source_sha256: str | None = None,
    species_target_policy: SpeciesTargetPolicy | None = None,
    species_detail_sink: SpeciesDetailSink | None = None,
    species_goals_catalog: dict[str, Any] | None = None,
    species_goals_output_dir: Path | None = None,
    boundary_topology_cache: BoundaryTopologyCache | None = None,
    boundary_fanout_mode: str | None = None,
    weighted_boundary_fanout_mode: str | None = None,
    weighted_layer_cache: ImmutableWeightedLayerCache | None = None,
    species_execution: dict[str, Any] | None = None,
    precomputed_species_accumulator: SpeciesAccumulator | None = None,
    species_execution_runtime: dict[str, Any] | None = None,
) -> dict[str, Any]:
    basename = solution_blob_basename(solution)
    solution_id = str(solution.get("id"))
    domain = solution_domain(solution)
    started = time.time()
    usage_started = resource.getrusage(resource.RUSAGE_SELF)
    phase_seconds: dict[str, float] = {}
    fanout_mode = boundary_fanout_mode or _boundary_fanout_mode()
    fanout_identity = boundary_fanout_identity(fanout_mode)
    weighted_mode = (
        weighted_boundary_fanout_mode or _weighted_boundary_fanout_mode()
    )
    weighted_identity = weighted_execution_identity(weighted_mode)
    if weighted_mode == "grouped-weighted-v1" and fanout_mode != "grouped":
        raise ValueError(
            f"{_WEIGHTED_BOUNDARY_FANOUT_ENV}=grouped-weighted-v1 requires "
            f"{_BOUNDARY_FANOUT_ENV}=grouped."
        )

    download = raster_download or cached_download(
        _solution_raster_source_url(solution),
        cache_dir,
        force=force_download,
    )
    raster = read_solution_raster(download.path)
    if raster.valid_cells == 0:
        raise RasterError(
            f"Solution {solution_id!r} has zero valid cells at national scope."
        )
    target_grid_sha256 = grid_sha256(raster.fingerprint)
    validity_mask_sha256 = boolean_mask_sha256(raster.solution_data_valid_mask)
    if alignment_provenance is not None:
        expected_grid_sha256 = alignment_provenance.get("targetGridSha256")
        observed_grid_sha256 = grid_sha256(raster.fingerprint)
        if (
            alignment_provenance.get("domain") != domain
            or expected_grid_sha256 != observed_grid_sha256
        ):
            raise AlignmentError(
                f"domain={domain} solution={solution_id!r} grid="
                f"{observed_grid_sha256} does not match bound alignment inventory "
                f"domain={alignment_provenance.get('domain')!r} "
                f"grid={expected_grid_sha256!r}."
            )
    if alignment_cache is None:
        alignment_cache = RasterAlignmentCache(cache_dir)

    # --- Sub-national setup ---
    boundary_grids: dict[str, BoundaryIdGrid] = {}
    boundary_indexes: dict[str, AnyBoundaryIndex] = {}
    topology_cache_hit = False
    setup_started = time.time()
    if not national_only and boundaries_by_level:
        if fanout_mode == "grouped":
            topology_cache = boundary_topology_cache or BoundaryTopologyCache()
            boundary_indexes, topology_cache_hit = topology_cache.get(
                boundaries_by_level,
                raster.fingerprint,
            )
            topology_bytes = sum(
                index.estimated_bytes for index in boundary_indexes.values()
            )
            retained_bytes = 0
            topology_peak = 0
            for index in boundary_indexes.values():
                topology_peak = max(
                    topology_peak,
                    retained_bytes + index.estimated_peak_build_bytes,
                )
                retained_bytes += index.estimated_bytes
            auto_fallbacks = sorted(
                level
                for level, index in boundary_indexes.items()
                if level not in {"siraps", "runaps", "omecs"}
                and index.overlap_pixels > 0
            )
            print(
                "[tier1-metrics]   boundary fan-out: grouped "
                f"(cache={'hit' if topology_cache_hit else 'miss'}, "
                f"index={topology_bytes / (1024 * 1024):.1f} MiB, "
                f"estimated-build-peak={topology_peak / (1024 * 1024):.1f} MiB, "
                f"auto-overlap-fallbacks={auto_fallbacks or 'none'})"
            )
        else:
            print("[tier1-metrics]   rasterizing boundaries…")
            boundary_mask_cache.precompute_all(boundaries_by_level, raster.fingerprint)
            # Reuse boundary-id grids only among solutions with the same reference grid.
            if boundary_grid_cache is not None:
                boundary_grids = boundary_grid_cache.get(
                    boundaries_by_level,
                    raster.fingerprint,
                    boundary_mask_cache,
                )
    phase_seconds["boundarySetup"] = time.time() - setup_started

    provenance = build_metrics_provenance(
        domain,
        national_only=national_only,
        skip_species=skip_species,
        skip_species_boundary_levels=skip_species_boundary_levels or set(),
        species_csv_url=species_csv_url,
        release_id=release_id,
        alignment_provenance=alignment_provenance,
        species_exception_binding=species_exception_binding,
        species_target_policy=(
            species_target_policy.provenance
            if species_target_policy is not None
            else None
        ),
        boundary_fanout_mode=fanout_mode,
        weighted_execution_mode=weighted_mode,
        species_execution=species_execution,
    )

    # --- Species pass: compute counters across all scopes for this solution ---
    species_accumulator: SpeciesAccumulator | None = precomputed_species_accumulator
    effective_species_runtime = (
        {
            **species_execution_runtime,
            "phaseSeconds": dict(
                species_execution_runtime.get("phaseSeconds", {})
            ),
        }
        if species_execution_runtime is not None
        else None
    )
    if (
        species_accumulator is None
        and domain == "land"
        and not skip_species
        and species_records
        and species_pool_sizes
    ):
        if species_target_policy is None:
            raise SpeciesTargetPolicyError(
                f"solution {solution_id!r} has no resolved species target policy."
            )
        print(
            f"[tier1-metrics]   running species pass over {len(species_records):,} records…"
        )
        skipped_levels = skip_species_boundary_levels or set()
        active_boundary_fanouts: dict[str, BoundaryIdGrid | AnyBoundaryIndex] = (
            boundary_indexes if fanout_mode == "grouped" else boundary_grids
        )
        species_boundary_grids = {
            level: grid
            for level, grid in active_boundary_fanouts.items()
            if level not in skipped_levels
        }
        if skipped_levels:
            active_levels = sorted(species_boundary_grids)
            print(
                f"[tier1-metrics]   species fan-out levels: {active_levels or ['national only']} "
                f"(skipped: {sorted(skipped_levels)})"
            )
        if species_goals_catalog is not None and species_goals_output_dir is not None:
            if species_detail_sink is not None:
                raise ValueError(
                    "species_detail_sink and species goals output cannot both be configured"
                )
            if (
                release_id is None
                or species_csv_sha256 is None
                or alignment_provenance is None
            ):
                raise ValueError(
                    "species goals require release, CSV, and alignment provenance"
                )
            species_goals_provenance = _species_goals_provenance(
                release_id=release_id,
                species_csv_sha256=species_csv_sha256,
                species_exception_source_sha256=species_exception_source_sha256,
                species_exception_binding=species_exception_binding,
                alignment_provenance=alignment_provenance,
                solution_raster_sha256=download.sha256,
                target_policy=species_target_policy,
                boundary_provenance_sha256=provenance["boundaryProvenance"]["sha256"],
                catalog_sha256=species_goals_catalog["catalogSha256"],
            )
            expected_levels = {
                "national",
                *species_boundary_grids.keys(),
            }
            active_levels = {
                level
                for level in expected_levels
                if not species_goals_partition_is_resumable(
                    species_goals_partition_path(
                        species_goals_output_dir, solution_id, level
                    ),
                    catalog=species_goals_catalog,
                    expected_solution_id=solution_id,
                    expected_level=level,
                    expected_catalog_sha256=species_goals_catalog["catalogSha256"],
                    expected_provenance=species_goals_provenance,
                )
            }
            species_detail_sink = SpeciesGoalsPipeline(
                species_goals_catalog,
                solution_id=solution_id,
                target_policy=species_target_policy,
                provenance=species_goals_provenance,
                spool_dir=species_goals_output_dir / ".spool",
                active_levels=active_levels,
            )
        species_started = time.time()
        usage_before = resource.getrusage(resource.RUSAGE_SELF)
        effective_species_runtime = {}
        species_accumulator = _process_species_for_solution(
            raster=raster,
            solution=solution,
            species_records=species_records,
            pool_sizes=species_pool_sizes,
            boundary_grids=species_boundary_grids if not national_only else {},
            cache_dir=cache_dir,
            force_download=force_download,
            alignment_cache=alignment_cache,
            target_policy=species_target_policy,
            detail_sink=species_detail_sink,
            runtime_stats=effective_species_runtime,
        )
        phase_seconds["species"] = time.time() - species_started
        usage_after = resource.getrusage(resource.RUSAGE_SELF)
        effective_species_runtime.update(
            {
                "wallSeconds": phase_seconds["species"],
                "userSeconds": usage_after.ru_utime - usage_before.ru_utime,
                "systemSeconds": usage_after.ru_stime - usage_before.ru_stime,
                "peakRssMiB": _peak_rss_mib(),
                "solutionEquivalentSeconds": phase_seconds["species"],
            }
        )
    elif species_accumulator is not None:
        phase_seconds["species"] = float(
            (effective_species_runtime or {}).get("solutionEquivalentSeconds", 0.0)
        )

    # --- National level ---
    national_species = (
        SpeciesScopeMetrics.from_counts(
            species_accumulator.national, species_pool_sizes
        )
        if species_accumulator and species_pool_sizes
        else None
    )
    effective_target_policy = species_target_policy or SpeciesTargetPolicy(
        "scalar", None, {}, None
    )
    national_metrics = _build_metrics(
        raster,
        solution,
        manifest,
        layer_cache,
        value_cache,
        cache_dir,
        force_download,
        species_metrics=national_species,
        species_target_policy=effective_target_policy,
        species_records=species_records,
        species_exception_binding=species_exception_binding,
    )

    geographies: dict[str, Any] = {
        "national": {
            "colombia": {
                "name": "Colombia",
                "scopeState": build_scope_state(
                    geography_level="national",
                    scope_id="colombia",
                    solution_valid_cell_count=raster.valid_cells,
                    selected_cell_count=raster.selected_cells,
                    boundary_grid_cell_count=raster.fingerprint.width
                    * raster.fingerprint.height,
                    target_grid_sha256=target_grid_sha256,
                    solution_raster_sha256=download.sha256,
                    solution_validity_mask_sha256=validity_mask_sha256,
                ),
                "metrics": national_metrics,
            }
        }
    }

    # --- Sub-national levels ---
    if not national_only and boundaries_by_level:
        definitions = _metrics_for_domain(domain)
        # Preload dense masks once per solution. Eligible sparse sidecars only
        # optimize validated source loading before dense mask materialization.
        mask_count = sum(
            1
            for m in definitions
            if m.layer_id
            and m.kind in ("binary_overlap_area", "binary_overlap_percent_of_selected")
        )
        value_count = sum(
            1
            for m in definitions
            if m.layer_id
            and m.kind
            in (
                "categorical_overlap_area",
                "weighted_sum",
                "weighted_percent_of_national",
            )
        )
        print(
            f"[tier1-metrics]   preloading {mask_count} mask layer(s) + {value_count} value layer(s)…"
        )
        layer_preparation_started = time.perf_counter()
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
        phase_seconds["layerPreparation"] = (
            time.perf_counter() - layer_preparation_started
        )
        grouped_primitives: dict[str, _GroupedBoundaryPrimitives] = {}
        if fanout_mode == "grouped":
            grouped_started = time.time()
            grouped_primitives = _build_grouped_boundary_primitives(
                raster,
                boundary_indexes,
                definitions,
                layer_masks,
                layer_values,
            )
            phase_seconds["groupedAggregation"] = time.time() - grouped_started
        has_weighted_metrics = any(
            definition.kind in {"weighted_sum", "weighted_percent_of_national"}
            for definition in definitions
        )
        weighted_fanout: WeightedFanoutResult | None = None
        prepared_weighted_layers: dict[str, PreparedWeightedLayer] = {}
        if weighted_mode == "grouped-weighted-v1" and has_weighted_metrics:
            specs = approved_weighted_specs(definitions)
            active_weighted_cache = (
                weighted_layer_cache or ImmutableWeightedLayerCache()
            )
            weighted_prepare_started = time.perf_counter()
            for layer_id in sorted({spec.layer_id for spec in specs}):
                source_url = _resolve_layer_url(manifest, layer_id)
                units = next(
                    spec.unit
                    for spec in specs
                    if spec.layer_id == layer_id and spec.kind == "weighted_sum"
                )
                prepared, _ = value_cache.get_prepared_weighted(
                    layer_id,
                    source_url,
                    raster,
                    cache_dir,
                    force_download,
                    active_weighted_cache,
                    value_units=units,
                )
                prepared_weighted_layers[layer_id] = prepared
            phase_seconds["weightedLayerPreparation"] = (
                time.perf_counter() - weighted_prepare_started
            )
            weighted_started = time.perf_counter()
            weighted_fanout = aggregate_selected_weighted_layers(
                boundary_indexes,
                raster.selected_mask,
                prepared_weighted_layers,
            )
            phase_seconds["weightedAggregation"] = (
                time.perf_counter() - weighted_started
            )
        weighted_fallback = has_weighted_metrics and weighted_fanout is None
        boundary_output_started = time.time()

        for geo_level, features in boundaries_by_level.items():
            level_out: dict[str, Any] = {}
            fanout = (
                boundary_indexes.get(geo_level)
                if fanout_mode == "grouped"
                else boundary_grids.get(geo_level)
            )
            counts_list = (
                species_accumulator.sub.get(geo_level) if species_accumulator else None
            )
            for boundary_index, feat in enumerate(features):
                grouped_level = grouped_primitives.get(geo_level)
                grouped_overrides: dict[str, dict[str, Any]] | None = None
                if grouped_level is not None:
                    scope_valid_cells = int(grouped_level.valid_cells[boundary_index])
                    grouped_overrides = _grouped_metric_overrides(
                        definitions,
                        grouped_level,
                        boundary_index,
                        manifest,
                    )
                    if weighted_fanout is not None:
                        grouped_overrides.update(
                            _weighted_metric_overrides(
                                definitions,
                                level=geo_level,
                                boundary_index=boundary_index,
                                fanout=weighted_fanout,
                                layers=prepared_weighted_layers,
                            )
                        )
                    if weighted_fallback and scope_valid_cells > 0:
                        px_mask = rasterize_boundary(
                            feat.geometry,
                            raster.fingerprint,
                            source_crs=feat.source_crs,
                        )
                        scoped_raster = raster.with_boundary_mask(px_mask)
                    else:
                        scoped_raster = raster
                    boundary_grid_cells = int(
                        grouped_level.boundary_grid_cells[boundary_index]
                    )
                    selected_cells = int(grouped_level.selected_cells[boundary_index])
                else:
                    px_mask = boundary_mask_cache.get(
                        feat.geo_level,
                        feat.boundary_id,
                        feat.geometry,
                        raster.fingerprint,
                        source_crs=feat.source_crs,
                        source_sha256=feat.source_sha256,
                        geometry_sha256=feat.geometry_sha256,
                    )
                    scoped_raster = raster.with_boundary_mask(px_mask)
                    scope_valid_cells = scoped_raster.valid_cells
                    selected_cells = scoped_raster.selected_cells
                    boundary_grid_cells = boundary_mask_cache.cell_count(px_mask)
                # Look up the precomputed species counts for this boundary, if any.
                feat_species: SpeciesScopeMetrics | None = None
                if fanout is not None and counts_list is not None and species_pool_sizes:
                    try:
                        bidx = fanout.boundary_ids.index(feat.boundary_id)
                        feat_species = SpeciesScopeMetrics.from_counts(
                            counts_list[bidx], species_pool_sizes
                        )
                    except ValueError:
                        feat_species = None
                metrics = _build_metrics(
                    scoped_raster,
                    solution,
                    manifest,
                    layer_cache,
                    value_cache,
                    cache_dir,
                    force_download,
                    subnational=True,
                    preloaded_layer_masks=layer_masks,
                    preloaded_layer_values=layer_values,
                    species_metrics=feat_species,
                    species_target_policy=effective_target_policy,
                    species_records=species_records,
                    species_exception_binding=species_exception_binding,
                    grouped_metric_overrides=grouped_overrides,
                    scope_valid_cells=scope_valid_cells,
                )
                entry: dict[str, Any] = {
                    "name": feat.name,
                    "scopeState": build_scope_state(
                        geography_level=geo_level,
                        scope_id=feat.boundary_id,
                        solution_valid_cell_count=scope_valid_cells,
                        selected_cell_count=selected_cells,
                        boundary_grid_cell_count=boundary_grid_cells,
                        target_grid_sha256=target_grid_sha256,
                        solution_raster_sha256=download.sha256,
                        solution_validity_mask_sha256=validity_mask_sha256,
                        boundary_source_sha256=feat.source_sha256,
                        boundary_geometry_sha256=feat.geometry_sha256,
                    ),
                    "metrics": metrics,
                }
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
        phase_seconds["boundaryOutput"] = time.time() - boundary_output_started

    generated_at = _utc_now_iso()
    if isinstance(species_detail_sink, SpeciesGoalsPipeline):
        species_detail_sink.write_partition_streaming(
            species_goals_partition_path(
                species_goals_output_dir, solution_id, "national"
            ),
            geography_level="national",
            scope_catalog=[["colombia", "Colombia"]],
            generated_at=generated_at,
        )
        for level, features in boundaries_by_level.items():
            if level not in species_accumulator.sub:
                continue
            species_detail_sink.write_partition_streaming(
                species_goals_partition_path(
                    species_goals_output_dir, solution_id, level
                ),
                geography_level=level,
                scope_catalog=[
                    [feature.boundary_id, feature.name] for feature in features
                ],
                generated_at=generated_at,
            )
        species_detail_sink.close()
    species_completeness = {
        "catalogTotal": (
            species_exception_binding["catalogTotal"]
            if species_exception_binding is not None
            else (species_accumulator.species_expected if species_accumulator else 0)
        ),
        "availableExpected": (
            species_exception_binding["availableExpected"]
            if species_exception_binding is not None
            else (species_accumulator.species_expected if species_accumulator else 0)
        ),
        "excluded": (
            species_exception_binding["excluded"]
            if species_exception_binding is not None
            else 0
        ),
        "expected": (
            species_accumulator.species_expected if species_accumulator else 0
        ),
        "aligned": (species_accumulator.species_aligned if species_accumulator else 0),
        "processed": (
            species_accumulator.species_processed if species_accumulator else 0
        ),
        "missing": (
            species_accumulator.species_missing_tif if species_accumulator else 0
        ),
        "missingUnexpected": (
            species_accumulator.species_missing_tif if species_accumulator else 0
        ),
        "exception": species_exception_binding,
        "complete": (
            species_accumulator is None
            or (
                species_accumulator.species_expected
                == species_accumulator.species_aligned
                == species_accumulator.species_processed
                and species_accumulator.species_missing_tif == 0
                and (
                    species_exception_binding is None
                    or (
                        species_accumulator.species_expected
                        == species_exception_binding["availableExpected"]
                        and species_exception_binding["catalogTotal"]
                        == species_exception_binding["availableExpected"]
                        + species_exception_binding["excluded"]
                    )
                )
            )
        ),
    }
    provenance["speciesCompleteness"] = species_completeness
    doc = {
        "solutionId": solution_id,
        "generatedAt": generated_at,
        "solutionRaster": {
            "solutionBasename": basename,
            "sha256": download.sha256,
        },
        "solutionInputSignature": solution_input_signature,
        "solutionCatalogBinding": solution_catalog_binding,
        PROVENANCE_KEY: provenance,
        "speciesCompleteness": species_completeness,
        "geographies": geographies,
    }
    binding = _candidate_binding(
        solution_id=solution_id,
        domain=domain,
        raster_basename=basename,
        raster_sha256=download.sha256,
        release_id=release_id,
        catalog_binding=solution_catalog_binding,
        solution_input_signature=solution_input_signature,
        metrics_provenance=provenance,
    )
    output_started = time.time()
    cache_path = _finalize_solution_document(
        output_dir=output_dir,
        solution_id=solution_id,
        binding=binding,
        document=doc,
        national_only=national_only,
        domain=domain,
        skip_species=skip_species,
    )
    phase_seconds["output"] = time.time() - output_started
    if effective_species_runtime is not None:
        effective_species_runtime["phaseSeconds"]["output"] = phase_seconds["output"]
    print(f"[tier1-metrics]   cache → {cache_path}")

    elapsed_seconds = time.time() - started
    usage_finished = resource.getrusage(resource.RUSAGE_SELF)
    print(
        f"[tier1-metrics]   phases: {json.dumps({key: round(value, 2) for key, value in phase_seconds.items()}, sort_keys=True)}; "
        f"peak-rss={_peak_rss_mib():.1f} MiB"
    )
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
        "speciesTargetPolicyEvidence": (
            species_target_policy.provenance
            if species_target_policy is not None
            else None
        ),
        "speciesTargetPolicy": effective_target_policy.kind,
        "speciesTargetPct": effective_target_policy.scalar_target_pct,
        "speciesExpected": species_completeness["expected"],
        "speciesCatalogTotal": species_completeness["catalogTotal"],
        "speciesAvailableExpected": species_completeness["availableExpected"],
        "speciesExcluded": species_completeness["excluded"],
        "speciesAligned": species_completeness["aligned"],
        "speciesProcessed": species_accumulator.species_processed
        if species_accumulator
        else 0,
        "speciesMissingUnexpected": species_completeness["missingUnexpected"],
        "speciesWithRange": species_accumulator.species_with_range
        if species_accumulator
        else 0,
        "speciesMissingTif": species_accumulator.species_missing_tif
        if species_accumulator
        else 0,
        "elapsedSeconds": round(elapsed_seconds, 2),
        "userSeconds": round(
            usage_finished.ru_utime - usage_started.ru_utime,
            6,
        ),
        "systemSeconds": round(
            usage_finished.ru_stime - usage_started.ru_stime,
            6,
        ),
        "peakRssMiB": round(_peak_rss_mib(), 1),
        "boundaryFanout": {
            **fanout_identity,
            "topologyCacheHit": topology_cache_hit if fanout_mode == "grouped" else None,
            "weightedFallback": weighted_fallback
            if not national_only and boundaries_by_level
            else False,
            "phaseSeconds": {
                key: round(value, 2) for key, value in phase_seconds.items()
            },
            "peakRssMiB": round(_peak_rss_mib(), 1),
        },
        "weightedBoundaryExecution": {
            **weighted_identity,
            "layerCacheHits": (
                weighted_layer_cache.hits if weighted_layer_cache is not None else 0
            ),
            "layerCacheMisses": (
                weighted_layer_cache.misses if weighted_layer_cache is not None else 0
            ),
            "layerCacheEntries": (
                weighted_layer_cache.entry_count
                if weighted_layer_cache is not None
                else 0
            ),
        },
        "speciesExecution": {
            **(species_execution or {}),
            "runtime": effective_species_runtime,
        },
    }


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def _run_coverage_parity_gate(
    args: argparse.Namespace,
    *,
    solution_path: Path,
) -> None:
    if args.coverage_parity_contract is None:
        return
    script = Path(__file__).resolve().parents[1] / "mesa_parity" / "main.py"
    report = args.output_dir / "coverage-parity-report.json"
    command = [
        sys.executable,
        str(script),
        "--contract",
        str(args.coverage_parity_contract),
        "--summary",
        str(args.coverage_parity_summary),
        "--solution",
        str(solution_path),
        "--template",
        str(args.coverage_parity_template),
        "--ecosystem-raster",
        str(args.coverage_parity_ecosystem_raster),
        "--ecosystem-catalog",
        str(args.coverage_parity_ecosystem_catalog),
        "--report",
        str(report),
    ]
    for matrix in args.coverage_parity_species_matrix:
        command.extend(["--species-matrix", str(matrix)])
    completed = subprocess.run(
        command,
        cwd=Path(__file__).resolve().parents[4],
        check=False,
        text=True,
        capture_output=True,
    )
    if completed.stdout:
        print(f"[tier1-metrics] coverage parity: {completed.stdout.strip()}")
    if completed.returncode != 0:
        if completed.stderr:
            print(completed.stderr, file=sys.stderr)
        raise ValueError(
            f"coverage parity gate failed with exit code {completed.returncode}"
        )
    print(f"[tier1-metrics] coverage parity report -> {report}")


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    try:
        fanout_mode = _boundary_fanout_mode()
        weighted_fanout_mode = _weighted_boundary_fanout_mode()
        species_execution_config = resolve_species_execution()
    except ValueError as exc:
        print(f"[tier1-metrics] ERROR: {exc}", file=sys.stderr)
        return 2
    fanout_identity = boundary_fanout_identity(fanout_mode)
    weighted_fanout_identity = weighted_execution_identity(weighted_fanout_mode)
    if weighted_fanout_mode == "grouped-weighted-v1" and fanout_mode != "grouped":
        print(
            f"[tier1-metrics] ERROR: {_WEIGHTED_BOUNDARY_FANOUT_ENV}="
            f"grouped-weighted-v1 requires {_BOUNDARY_FANOUT_ENV}=grouped.",
            file=sys.stderr,
        )
        return 2
    catalog: SolutionCatalog | None = None
    species_exception: SpeciesExceptionPolicy | None = None
    release_plan_binding: dict[str, Any] | None = None
    if args.solution_catalog is not None:
        try:
            catalog = load_solution_catalog(args.solution_catalog)
        except SolutionCatalogError as exc:
            print(f"[tier1-metrics] ERROR: {exc}", file=sys.stderr)
            return 2
        if args.release_id is not None and catalog.release_id != args.release_id:
            print(
                "[tier1-metrics] ERROR: --release-id must exactly match "
                "solution catalog releaseId",
                file=sys.stderr,
            )
            return 2
        try:
            if catalog.species_exception_binding is not None:
                if args.species_exception_contract is None:
                    raise SpeciesExceptionError(
                        "catalog requires --species-exception-contract."
                    )
                species_exception = load_species_exception(
                    args.species_exception_contract,
                    release_id=catalog.release_id,
                    catalog_version=catalog.catalog_version,
                )
                if species_exception.binding != catalog.species_exception_binding:
                    raise SpeciesExceptionError(
                        "species exception contract does not match catalog binding."
                    )
            elif args.species_exception_contract is not None:
                raise SpeciesExceptionError(
                    "species exception contract is not authorized by the catalog."
                )
        except SpeciesExceptionError as exc:
            print(f"[tier1-metrics] ERROR: {exc}", file=sys.stderr)
            return 2
        if args.release_plan is not None:
            try:
                args.cache_policy = release_plan_cache_policy(
                    args.release_plan,
                    catalog=catalog,
                )
                release_plan_binding = _release_plan_binding(
                    args.release_plan,
                    catalog=catalog,
                )
            except (OSError, SolutionCatalogError) as exc:
                print(f"[tier1-metrics] ERROR: {exc}", file=sys.stderr)
                return 2
    try:
        _validate_species_execution_run(
            species_execution_config,
            cache_policy=args.cache_policy,
            boundary_fanout_mode=fanout_mode,
        )
    except ValueError as exc:
        print(f"[tier1-metrics] ERROR: {exc}", file=sys.stderr)
        return 2
    if args.release_id:
        args.cache_blob_directory = load_release_config(
            args.release_id
        ).regular_verbose_directory
        if args.output_dir == DEFAULT_OUTPUT_DIR:
            args.output_dir = (
                Path("data/metrics/generated/releases")
                / args.release_id
                / "regular/verbose"
            )
            if args.domain is not None:
                args.output_dir = (
                    args.output_dir
                    / "workers"
                    / (f"{args.domain}-chunk-{args.chunk_index}-of-{args.chunk_count}")
                )
    print(f"[tier1-metrics] manifest: {args.manifest_url}")

    try:
        manifest = fetch_manifest(args.manifest_url)
        catalog_solutions = (
            _apply_solution_catalog(manifest, catalog)
            if catalog is not None
            else manifest.batch_solutions
        )
    except ManifestError as exc:
        print(f"[tier1-metrics] ERROR: {exc}", file=sys.stderr)
        return 2
    except SolutionCatalogError as exc:
        print(f"[tier1-metrics] ERROR: {exc}", file=sys.stderr)
        return 2

    domain_counts = {
        domain: sum(
            solution_domain(solution) == domain for solution in catalog_solutions
        )
        for domain in ("land", "marine")
    }
    print(
        f"[tier1-metrics] loaded {len(manifest.layers_by_id)} layers, "
        f"{len(catalog_solutions)} batch solutions "
        f"({domain_counts['land']} land, {domain_counts['marine']} marine)"
    )

    missing_layers = _validate_required_layers(manifest)
    if missing_layers:
        print(
            f"[tier1-metrics] WARNING: missing displayUrl for layers: {missing_layers}. "
            "Affected metrics will be marked 'blocked'.",
            file=sys.stderr,
        )

    try:
        selection_manifest = ResolvedManifest(
            url=manifest.url,
            raw=manifest.raw,
            public_blob_host=manifest.public_blob_host,
            layers_by_id=manifest.layers_by_id,
            national_solutions=manifest.national_solutions,
            batch_solutions=catalog_solutions,
        )
        if catalog is not None and args.release_plan is not None and args.domain:
            selected_solutions = _filter_release_plan_solutions(
                catalog_solutions,
                catalog=catalog,
                release_plan=args.release_plan,
                domain=args.domain,
            )
        else:
            selected_solutions = _select_solutions(
                selection_manifest,
                args.solution_id,
                args.limit,
            )
        if (
            catalog is not None
            and args.release_plan is not None
            and args.domain is None
        ):
            selected_solutions = _filter_release_plan_solutions(
                selected_solutions,
                catalog=catalog,
                release_plan=args.release_plan,
            )
    except (ManifestError, SolutionCatalogError) as exc:
        print(f"[tier1-metrics] ERROR: {exc}", file=sys.stderr)
        return 2

    if args.coverage_parity_contract is not None:
        try:
            parity_contract = load_coverage_parity_contract(
                args.coverage_parity_contract
            )
        except CoverageParityContractError as exc:
            print(f"[tier1-metrics] ERROR: {exc}", file=sys.stderr)
            return 2
        selected_ids = {str(solution.get("id")) for solution in selected_solutions}
        if parity_contract.solution_id not in selected_ids:
            print(
                "[tier1-metrics] ERROR: coverage parity golden solution "
                f"{parity_contract.solution_id!r} is not selected",
                file=sys.stderr,
            )
            return 2
        print(
            "[tier1-metrics] coverage parity: "
            f"{parity_contract.release_id} golden={parity_contract.solution_id} "
            f"ecosystems={parity_contract.ecosystem_feature_count} "
            f"species={parity_contract.species_feature_count}"
        )

    print(
        f"[tier1-metrics] preflight: validating "
        f"{len(selected_solutions)} selected raster source(s)"
    )
    preflight_downloads, preflight_failures = _preflight_solution_rasters(
        selected_solutions,
        cache_dir=args.cache_dir,
        catalog=catalog,
    )
    if preflight_failures:
        print(
            f"[tier1-metrics] ERROR: raster preflight failed for "
            f"{len(preflight_failures)} of {len(selected_solutions)} source(s); "
            "no solutions were processed:",
            file=sys.stderr,
        )
        for failure in preflight_failures:
            print(f"[tier1-metrics]   - {failure}", file=sys.stderr)
        return 2
    print(
        f"[tier1-metrics] preflight: all {len(preflight_downloads)} "
        "selected raster source(s) passed"
    )

    species_csv_download: CachedDownload | None = None
    catalog_species_records: list[SpeciesRecord] | None = None
    species_records: list[SpeciesRecord] | None = None
    species_pool_sizes: SpeciesPoolSizes | None = None
    species_goals_catalog: dict[str, Any] | None = None
    if (
        any(solution_domain(solution) == "land" for solution in selected_solutions)
        and not args.skip_species
    ):
        try:
            species_csv_download = cached_download(
                args.species_csv_url,
                args.cache_dir,
                force=args.no_cache,
            )
            catalog_species_records = load_species_records(species_csv_download.path)
            species_pool_sizes = compute_pool_sizes(catalog_species_records)
            species_records = (
                species_exception.filter_available(catalog_species_records)
                if species_exception is not None
                else catalog_species_records
            )
        except Exception as exc:  # noqa: BLE001 - CLI preflight reports all source failures
            print(
                f"[tier1-metrics] ERROR: species preflight failed ({exc}); "
                "no solutions were processed.",
                file=sys.stderr,
            )
            return 2
    if args.species_goals_output_dir is not None:
        if (
            args.skip_species
            or catalog_species_records is None
            or species_csv_download is None
            or args.release_id is None
        ):
            print(
                "[tier1-metrics] ERROR: --species-goals-output-dir requires "
                "--release-id and the species pass.",
                file=sys.stderr,
            )
            return 2
        excluded_filenames = (
            set(species_exception.excluded_filenames)
            if species_exception is not None
            else set()
        )
        unavailable_ids = {
            species_goals_id(record)
            for record in catalog_species_records
            if record.blob_filename in excluded_filenames
        }
        species_goals_catalog = build_species_goals_catalog(
            catalog_species_records,
            unavailable_species_ids=unavailable_ids,
            provenance={
                "releaseId": args.release_id,
                "speciesCsvSha256": species_csv_download.sha256,
                "exceptionSourceSha256": (
                    _species_exception_source_sha256(species_exception)
                ),
                "exceptionPolicySha256": (
                    species_exception.binding.get("policySha256")
                    if species_exception is not None
                    else None
                ),
                "exceptionBindingSha256": (
                    species_goals_sha256(species_exception.binding)
                    if species_exception is not None
                    else None
                ),
                "inventory": {
                    "catalogTotal": len(catalog_species_records),
                    "unavailable": len(unavailable_ids),
                    "zeroRange": sum(
                        record.range_km2 == 0
                        and species_goals_id(record) not in unavailable_ids
                        for record in catalog_species_records
                    ),
                },
            },
        )
        try:
            _, resumed = write_species_goals_catalog(
                species_goals_catalog_path(args.species_goals_output_dir),
                species_goals_catalog,
            )
            print(
                "[tier1-metrics] species goals catalog: "
                f"{'resumed' if resumed else 'written'} "
                f"({len(catalog_species_records):,} species)"
            )
        except (OSError, ValueError) as exc:
            print(
                f"[tier1-metrics] ERROR: species goals catalog failed: {exc}",
                file=sys.stderr,
            )
            return 2

    species_target_policies: dict[str, SpeciesTargetPolicy] = {}
    if not args.skip_species:
        try:
            for solution in selected_solutions:
                if solution_domain(solution) != "land":
                    continue
                species_target_policies[str(solution.get("id"))] = (
                    resolve_species_target_policy(
                        solution,
                        catalog_records=catalog_species_records,
                        available_records=species_records,
                    )
                )
        except SpeciesTargetPolicyError as exc:
            print(
                f"[tier1-metrics] ERROR: species target policy preflight failed: {exc}",
                file=sys.stderr,
            )
            return 2

    print("[tier1-metrics] preflight: warming aligned input cache")
    alignment_cache, alignment_provenance, alignment_failures = (
        _preflight_aligned_inputs(
            selected_solutions,
            preflight_downloads,
            manifest,
            cache_dir=args.cache_dir,
            force_download=args.no_cache,
            species_records=species_records,
            skip_species=args.skip_species,
            species_exception=species_exception,
        )
    )
    if alignment_provenance is not None:
        for domain, domain_inventory in alignment_provenance["domains"].items():
            print(
                f"[tier1-metrics] preflight: domain={domain} aligned "
                f"{domain_inventory['alignedInputs']}/"
                f"{domain_inventory['expectedAlignedInputs']} required input(s) "
                f"to grid {domain_inventory['targetGridSha256'][:12]}"
            )
        cache_storage = alignment_provenance["cacheStorage"]
        print(
            "[tier1-metrics] preflight: aligned cache "
            f"{cache_storage['completePairBytes'] / 1024**3:.2f} GB used; "
            f"{cache_storage['estimatedReleaseBytes'] / 1024**3:.2f} GB pinned "
            f"for this run; "
            f"{cache_storage['configuredMaxBytes'] / 1024**3:.2f} GB limit"
        )
    if alignment_failures:
        print(
            f"[tier1-metrics] ERROR: input alignment preflight failed for "
            f"{len(alignment_failures)} required asset(s); no solutions were processed:",
            file=sys.stderr,
        )
        for failure in alignment_failures:
            print(f"[tier1-metrics]   - {failure}", file=sys.stderr)
        if not args.write_input_signatures_only:
            return 2
    if alignment_cache is None or alignment_provenance is None:
        print(
            "[tier1-metrics] ERROR: alignment preflight produced no shared grid.",
            file=sys.stderr,
        )
        return 2
    if args.validate_only:
        print(
            "[tier1-metrics] validate-only: sources and aligned inputs OK; "
            "exiting before computation."
        )
        return 0

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

    layer_cache = _LayerMaskCache(alignment_cache)
    value_cache = _LayerValueCache(alignment_cache)
    weighted_layer_cache = ImmutableWeightedLayerCache()
    boundary_mask_cache = BoundaryMaskCache()
    boundary_grid_cache = BoundaryIdGridCache()
    boundary_topology_cache = BoundaryTopologyCache()
    boundaries_by_level: dict[str, list[BoundaryFeature]] = {}
    boundary_errors: dict[str, str] = {}
    species_execution_by_id = {
        str(solution.get("id")): _independent_species_execution(
            species_execution_config
        )
        for solution in solutions
        if solution_domain(solution) == "land"
    }
    microbatch_plan_by_id: dict[str, _SpeciesMicrobatchPlan] = {}
    microbatch_overlap_paths: list[ExactOverlapInput] | None = None
    if (
        species_execution_config.is_microbatch
        and not args.skip_species
        and species_records
        and catalog_species_records
        and species_pool_sizes
    ):
        if not args.national_only:
            boundaries_by_level, boundary_errors = load_all_boundaries(args.cache_dir)
            if boundary_errors or set(boundaries_by_level) != {
                "departments",
                "municipalities",
                "siraps",
                "runaps",
                "omecs",
            }:
                print(
                    f"[tier1-metrics] ERROR: {species_execution_config.effective_mode} "
                    "requires every "
                    f"pinned boundary source; failures={sorted(boundary_errors)}",
                    file=sys.stderr,
                )
                return 2
        reference_solution = next(
            (
                solution
                for solution in solutions
                if solution_domain(solution) == "land"
            ),
            None,
        )
        if reference_solution is not None:
            reference_id = str(reference_solution.get("id"))
            reference_raster = read_solution_raster(
                preflight_downloads[reference_id].path
            )
            all_boundary_indexes = (
                boundary_topology_cache.get(
                    boundaries_by_level,
                    reference_raster.fingerprint,
                )[0]
                if boundaries_by_level
                else {}
            )
            boundary_indexes = {
                level: index
                for level, index in all_boundary_indexes.items()
                if level not in set(args.skip_species_boundary_level)
            }
            microbatch_overlap_paths, exact_component = (
                discover_exact_overlap_inventory(
                    args.cache_dir,
                    species_records,
                    target_grid_sha256=grid_sha256(reference_raster.fingerprint),
                )
            )
            records_component = _species_records_component(
                catalog_species_records,
                species_records,
                species_pool_sizes,
            )
            boundary_component = _boundary_batch_component(
                boundaries_by_level,
                boundary_indexes,
            )
            active_levels = ["national", *sorted(boundary_indexes)]
            land_solutions = [
                solution
                for solution in solutions
                if solution_domain(solution) == "land"
            ]
            for batch_start in range(
                0,
                len(land_solutions),
                species_execution_config.batch_size,
            ):
                batch_solutions = tuple(
                    land_solutions[
                        batch_start : batch_start
                        + species_execution_config.batch_size
                    ]
                )
                ordinal = batch_start // species_execution_config.batch_size
                ordered_ids = [
                    str(solution.get("id")) for solution in batch_solutions
                ]
                matrix = load_category_matrix(
                    [preflight_downloads[solution_id].path for solution_id in ordered_ids]
                )
                category_hashes = [
                    category_mask_sha256(matrix.values[:, index])
                    for index in range(matrix.num_solutions)
                ]
                target_policy_hashes = [
                    species_goals_sha256(
                        {
                            "kind": species_target_policies[solution_id].kind,
                            "scalarTargetPercent": species_target_policies[
                                solution_id
                            ].scalar_target_pct,
                            "targetsBySpecies": species_target_policies[
                                solution_id
                            ].targets_by_species,
                            "provenance": species_target_policies[
                                solution_id
                            ].provenance,
                        }
                    )
                    for solution_id in ordered_ids
                ]
                binding = build_release_batch_binding(
                    ordered_solution_ids=ordered_ids,
                    solution_raster_sha256s=[
                        preflight_downloads[solution_id].sha256
                        for solution_id in ordered_ids
                    ],
                    category_mask_sha256s=category_hashes,
                    exact_overlap_inventory=exact_component,
                    species_records_component=records_component,
                    target_policy_sha256s=target_policy_hashes,
                    boundary_component=boundary_component,
                    active_geography_levels=active_levels,
                    batch_ordinal=ordinal,
                    configured_batch_size=species_execution_config.batch_size,
                    algorithm_version=species_execution_config.algorithm_version,
                )
                execution_by_solution = {
                    solution_id: {
                        **species_execution_config.provenance(),
                        "batchOrdinal": ordinal,
                        "actualBatchSize": len(ordered_ids),
                        "orderedSolutionIds": ordered_ids,
                        "categoryMaskSha256": category_hash,
                        "bindingSha256": binding["sha256"],
                        "componentSha256s": binding["componentSha256s"],
                        "resumePolicy": "disabled-recompute-all",
                    }
                    for solution_id, category_hash in zip(
                        ordered_ids,
                        category_hashes,
                        strict=True,
                    )
                }
                plan = _SpeciesMicrobatchPlan(
                    ordinal=ordinal,
                    solutions=batch_solutions,
                    binding=binding,
                    execution_by_solution=execution_by_solution,
                )
                for solution_id in ordered_ids:
                    species_execution_by_id[solution_id] = execution_by_solution[
                        solution_id
                    ]
                    microbatch_plan_by_id[solution_id] = plan

    if catalog is not None and args.release_id is not None:
        try:
            worker_identity = (
                f"domain-{args.domain}-chunk-{args.chunk_index}-of-{args.chunk_count}"
                if args.domain is not None
                else (
                    f"global-chunk-{args.chunk_index}-of-{args.chunk_count}"
                    if args.chunk_count > 1
                    else None
                )
            )
            bind_release_output(
                args.output_dir,
                catalog=catalog,
                component=(
                    f"regular-verbose-{worker_identity}"
                    if worker_identity is not None
                    else "regular-verbose"
                ),
            )
        except SolutionCatalogError as exc:
            print(f"[tier1-metrics] ERROR: {exc}", file=sys.stderr)
            return 2
    args.output_dir.mkdir(parents=True, exist_ok=True)
    args.cache_dir.mkdir(parents=True, exist_ok=True)

    resume_entries_by_id: dict[str, dict[str, Any]] = {}
    pending_solutions: list[dict[str, Any]] = []
    solution_checksums = {
        str(solution.get("id")): preflight_downloads[str(solution.get("id"))].sha256
        for solution in solutions
    }
    solution_input_signatures: dict[str, dict[str, str]] = {}
    expected_provenance_by_id: dict[str, dict[str, Any]] = {}
    solution_catalog_binding = (
        catalog_binding(catalog)
        if catalog is not None
        else None
    )
    try:
        catalog_by_id = catalog.by_id if catalog is not None else {}
        for solution in solutions:
            solution_id = str(solution.get("id"))
            observed = solution_checksums[solution_id]
            solution_alignment_provenance = _alignment_provenance_for_solution(
                alignment_provenance,
                solution,
            )
            if catalog is not None:
                catalog_entry = catalog_by_id[solution_id]
            else:
                catalog_entry = SolutionCatalogEntry(
                    solution_id=solution_id,
                    solution_basename=solution_blob_basename(solution),
                    domain=solution_domain(solution),
                    raster_sha256=observed,
                )
            expected_provenance = build_metrics_provenance(
                solution_domain(solution),
                national_only=args.national_only,
                skip_species=args.skip_species,
                skip_species_boundary_levels=set(args.skip_species_boundary_level),
                species_csv_url=args.species_csv_url,
                release_id=args.release_id,
                alignment_provenance=solution_alignment_provenance,
                species_exception_binding=(
                    species_exception.binding
                    if species_exception is not None
                    and solution_domain(solution) == "land"
                    else None
                ),
                species_target_policy=(
                    species_target_policies[solution_id].provenance
                    if solution_id in species_target_policies
                    else None
                ),
                boundary_fanout_mode=fanout_mode,
                weighted_execution_mode=weighted_fanout_mode,
                species_execution=species_execution_by_id.get(
                    str(solution.get("id"))
                ),
            )
            expected_provenance_by_id[solution_id] = expected_provenance
            source_identity = _solution_source_identity(
                solution,
                cache_dir=args.cache_dir,
                force_download=args.no_cache,
                raster_sha256=observed,
                species_csv_url=args.species_csv_url,
                species_csv_sha256=(
                    species_csv_download.sha256
                    if (
                        species_csv_download is not None
                        and solution_domain(solution) == "land"
                    )
                    else None
                ),
            )
            source_identity["inputAlignment"] = solution_alignment_provenance
            solution_input_signatures[solution_id] = build_solution_input_signature(
                solution=solution,
                catalog_entry=catalog_entry,
                manifest=manifest,
                metrics_provenance=expected_provenance,
                source_identity=source_identity,
            )
    except (
        AlignmentError,
        OSError,
        DownloadError,
        SolutionCatalogError,
        SpeciesTargetPolicyError,
    ) as exc:
        print(f"[tier1-metrics] ERROR: {exc}", file=sys.stderr)
        return 2
    if args.write_input_signatures_only:
        if catalog is None:
            print(
                "[tier1-metrics] ERROR: input-signature inventory requires a solution catalog",
                file=sys.stderr,
            )
            return 2
        signature_path = args.output_dir / "solution-input-signatures.json"
        signature_path.write_text(
            json.dumps(
                {
                    "format": "solution-input-signatures-v1",
                    "releaseId": catalog.release_id,
                    "catalogSha256": catalog.sha256,
                    "signatures": {
                        solution_id: solution_input_signatures[solution_id]
                        for solution_id in sorted(solution_input_signatures)
                    },
                },
                indent=2,
                ensure_ascii=False,
                sort_keys=True,
            )
            + "\n",
            encoding="utf-8",
        )
        print(f"[tier1-metrics] input signatures -> {signature_path}")
        return 2 if alignment_failures else 0
    if args.cache_policy == "recompute-all":
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
                expected_solution_basename=(
                    catalog.by_id[str(solution.get("id"))].solution_basename
                    if catalog is not None
                    else None
                ),
                expected_raster_sha256=solution_checksums.get(str(solution.get("id"))),
                expected_input_signature=solution_input_signatures.get(
                    str(solution.get("id"))
                ),
                expected_catalog_binding=solution_catalog_binding,
                species_exception_binding=(
                    species_exception.binding
                    if species_exception is not None
                    and solution_domain(solution) == "land"
                    else None
                ),
                species_target_policy=species_target_policies.get(
                    str(solution.get("id"))
                ),
                boundary_fanout_mode=fanout_mode,
                weighted_boundary_fanout_mode=weighted_fanout_mode,
            )
            if (
                resume_entry is not None
                and args.species_goals_output_dir is not None
                and solution_domain(solution) == "land"
                and species_goals_catalog is not None
                and species_csv_download is not None
            ):
                solution_id = str(solution.get("id"))
                regular_provenance = expected_provenance_by_id[solution_id]
                target_policy = species_target_policies[solution_id]
                sidecar_provenance = _species_goals_provenance(
                    release_id=args.release_id,
                    species_csv_sha256=species_csv_download.sha256,
                    species_exception_source_sha256=(
                        _species_exception_source_sha256(species_exception)
                    ),
                    species_exception_binding=(
                        species_exception.binding
                        if species_exception is not None
                        else None
                    ),
                    alignment_provenance=regular_provenance["inputAlignment"],
                    solution_raster_sha256=solution_checksums[solution_id],
                    target_policy=target_policy,
                    boundary_provenance_sha256=regular_provenance[
                        "boundaryProvenance"
                    ]["sha256"],
                    catalog_sha256=species_goals_catalog["catalogSha256"],
                )
                expected_levels = (
                    {"national"}
                    if args.national_only
                    else set(SPECIES_GOALS_GEOGRAPHY_LEVELS)
                    - set(args.skip_species_boundary_level)
                )
                if not all(
                    species_goals_partition_is_resumable(
                        species_goals_partition_path(
                            args.species_goals_output_dir, solution_id, level
                        ),
                        catalog=species_goals_catalog,
                        expected_solution_id=solution_id,
                        expected_level=level,
                        expected_catalog_sha256=species_goals_catalog[
                            "catalogSha256"
                        ],
                        expected_provenance=sidecar_provenance,
                    )
                    for level in expected_levels
                ):
                    resume_entry = None
            if resume_entry is None and args.species_goals_output_dir is None:
                solution_id = str(solution.get("id"))
                domain = solution_domain(solution)
                species_exception_binding = (
                    species_exception.binding
                    if species_exception is not None and domain == "land"
                    else None
                )
                binding = _candidate_binding(
                    solution_id=solution_id,
                    domain=domain,
                    raster_basename=solution_blob_basename(solution),
                    raster_sha256=solution_checksums[solution_id],
                    release_id=args.release_id,
                    catalog_binding=solution_catalog_binding,
                    solution_input_signature=solution_input_signatures[solution_id],
                    metrics_provenance=expected_provenance_by_id[solution_id],
                )
                resume_entry = _promote_resumable_candidate(
                    solution=solution,
                    manifest=manifest,
                    output_dir=args.output_dir,
                    cache_blob_directory=args.cache_blob_directory,
                    binding=binding,
                    national_only=args.national_only,
                    skip_species=args.skip_species,
                    skip_species_boundary_levels=set(args.skip_species_boundary_level),
                    species_csv_url=args.species_csv_url,
                    species_exception_binding=species_exception_binding,
                    species_target_policy=species_target_policies.get(solution_id),
                    boundary_fanout_mode=fanout_mode,
                    weighted_boundary_fanout_mode=weighted_fanout_mode,
                    species_execution=species_execution_by_id.get(solution_id),
                )
            if resume_entry is None:
                pending_solutions.append(solution)
            else:
                resume_entries_by_id[str(solution.get("id"))] = resume_entry
        if resume_entries_by_id:
            print(
                f"[tier1-metrics] resume: {len(resume_entries_by_id)} existing cache file(s) "
                "will be skipped; use --cache-policy recompute-all to rebuild"
            )

    # --- Load boundary data ---
    if pending_solutions and not args.national_only and not boundaries_by_level:
        boundaries_by_level, boundary_errors = load_all_boundaries(args.cache_dir)
        for level, feats in boundaries_by_level.items():
            print(f"[tier1-metrics] boundaries: {level} → {len(feats)} features")
        for level, err in boundary_errors.items():
            print(
                f"[tier1-metrics] WARNING: could not load '{level}' boundaries: {err}",
                file=sys.stderr,
            )
        if not boundaries_by_level:
            print(
                "[tier1-metrics] WARNING: all boundary levels failed; national-only.",
                file=sys.stderr,
            )
        if args.release_id and boundary_errors:
            print(
                "[tier1-metrics] ERROR: release generation requires every pinned "
                f"boundary source; failures={sorted(boundary_errors)}",
                file=sys.stderr,
            )
            return 2

    species_load_error: str | None = None
    has_pending_land = any(
        solution_domain(solution) == "land" for solution in pending_solutions
    )
    if has_pending_land and not args.skip_species:
        if species_records is None or species_pool_sizes is None:
            print(
                "[tier1-metrics] ERROR: species preflight did not produce complete inputs.",
                file=sys.stderr,
            )
            return 2
        print(
            f"[tier1-metrics] species CSV: {len(species_records):,} non-fish records "
            f"(pool: {species_pool_sizes.by_bucket})"
        )

    deferred = sorted(deferred_metric_ids())
    entries: list[dict[str, Any]] = []
    failures: list[dict[str, Any]] = []
    prepared_species_by_id: dict[str, _PrecomputedSpeciesResult] = {}
    prepared_batch_ordinals: set[int] = set()
    failed_microbatch_ids: dict[str, tuple[str, str]] = {}

    def prepare_microbatch(plan: _SpeciesMicrobatchPlan) -> None:
        if plan.ordinal in prepared_batch_ordinals:
            return
        prepared_batch_ordinals.add(plan.ordinal)
        if (
            microbatch_overlap_paths is None
            or species_records is None
            or species_pool_sizes is None
        ):
            raise SpeciesSolutionBatchError(
                "Microbatch preflight did not preserve complete exact species inputs."
            )
        ordered_ids = [
            str(solution.get("id")) for solution in plan.solutions
        ]
        matrix = load_category_matrix(
            [preflight_downloads[solution_id].path for solution_id in ordered_ids]
        )
        indexes = (
            boundary_topology_cache.get(
                boundaries_by_level,
                matrix.fingerprint,
            )[0]
            if boundaries_by_level
            else {}
        )
        active_indexes = {
            level: index
            for level, index in indexes.items()
            if level not in set(args.skip_species_boundary_level)
        }
        def build_sink(
            solution_id: str,
            target_policy: SpeciesTargetPolicy,
        ) -> SpeciesDetailSink | None:
            if (
                species_goals_catalog is None
                or args.species_goals_output_dir is None
                or species_csv_download is None
            ):
                return None
            regular_provenance = expected_provenance_by_id[solution_id]
            return SpeciesGoalsPipeline(
                species_goals_catalog,
                solution_id=solution_id,
                target_policy=target_policy,
                provenance=_species_goals_provenance(
                    release_id=args.release_id,
                    species_csv_sha256=species_csv_download.sha256,
                    species_exception_source_sha256=(
                        _species_exception_source_sha256(species_exception)
                    ),
                    species_exception_binding=(
                        species_exception.binding
                        if species_exception is not None
                        else None
                    ),
                    alignment_provenance=regular_provenance["inputAlignment"],
                    solution_raster_sha256=solution_checksums[solution_id],
                    target_policy=target_policy,
                    boundary_provenance_sha256=regular_provenance[
                        "boundaryProvenance"
                    ]["sha256"],
                    catalog_sha256=species_goals_catalog["catalogSha256"],
                ),
                spool_dir=args.species_goals_output_dir / ".spool",
                active_levels={"national", *active_indexes},
            )

        sinks, accumulators, setup_failures = _initialize_species_microbatch_members(
            ordered_ids=ordered_ids,
            target_policies=species_target_policies,
            pool_sizes=species_pool_sizes,
            species_expected=len(species_records),
            sub_sizes={
                level: index.num_boundaries
                for level, index in active_indexes.items()
            },
            sink_factory=build_sink,
        )
        failed_microbatch_ids.update(setup_failures)

        started = time.perf_counter()
        usage_before = resource.getrusage(resource.RUSAGE_SELF)
        try:
            processor = (
                process_exact_species_batch_buffered
                if species_execution_config.is_buffered_microbatch
                else process_exact_species_batch
            )
            stats = processor(
                species_records=species_records,
                overlap_paths=microbatch_overlap_paths,
                categories=matrix.values,
                fingerprint=matrix.fingerprint,
                boundary_indexes=active_indexes,
                accumulators=accumulators,
                binding=plan.binding,
                checkpoint_interval=0,
                checkpoint=None,
            )
        except Exception as exc:
            for sink in sinks:
                close_error = _close_species_goals_sink(sink)
                if close_error is not None:
                    exc.add_note(
                        "Microbatch cleanup also failed: "
                        f"{type(close_error).__name__}: {close_error}"
                    )
            raise
        wall_seconds = time.perf_counter() - started
        usage_after = resource.getrusage(resource.RUSAGE_SELF)
        runtime = {
            "batchOrdinal": plan.ordinal,
            "wallSeconds": wall_seconds,
            "userSeconds": usage_after.ru_utime - usage_before.ru_utime,
            "systemSeconds": usage_after.ru_stime - usage_before.ru_stime,
            "peakRssMiB": _peak_rss_mib(),
            "npzOpens": stats.npz_opens,
            "npzBytes": stats.npz_bytes,
            "phaseSeconds": {
                "exactRead": stats.exact_read_seconds,
                "evaluation": stats.evaluation_seconds,
                "accumulator": stats.accumulator_seconds,
            },
            "solutionEquivalentSeconds": wall_seconds / len(ordered_ids),
            "solutionFailures": [
                {
                    "solutionId": ordered_ids[failure.solution_index],
                    "speciesIndex": failure.species_index,
                    "speciesName": failure.species_name,
                    "errorType": failure.error_type,
                    "error": failure.error,
                }
                for failure in stats.solution_failures
            ],
        }
        failures_by_index = {
            failure.solution_index: failure for failure in stats.solution_failures
        }
        for solution_index, (solution_id, accumulator, sink) in enumerate(
            zip(
            ordered_ids,
            accumulators,
            sinks,
            strict=True,
            )
        ):
            if accumulator is None:
                continue
            failure = failures_by_index.get(solution_index)
            if failure is not None:
                close_error = _close_species_goals_sink(sink)
                close_suffix = (
                    "; cleanup also failed: "
                    f"{type(close_error).__name__}: {close_error}"
                    if close_error is not None
                    else ""
                )
                failed_microbatch_ids[solution_id] = (
                    (
                        "Solution-specific species accumulator/detail sink failed at "
                        f"catalog index {failure.species_index} "
                        f"({failure.species_name!r}): {failure.error}{close_suffix}"
                    ),
                    "Isolated solution-microbatch-v1 member failure.",
                )
                continue
            prepared_species_by_id[solution_id] = _PrecomputedSpeciesResult(
                accumulator=accumulator,
                detail_sink=sink,
                runtime=runtime,
            )

    for index, solution in enumerate(solutions, start=1):
        solution_id = str(solution.get("id"))
        print(f"[tier1-metrics] [{index}/{len(solutions)}] {solution_id}")
        if solution_id in resume_entries_by_id:
            resume_entry = resume_entries_by_id[solution_id]
            print(
                f"[tier1-metrics]   skipped existing cache ({resume_entry['cachePath']})"
            )
            entries.append(resume_entry)
            continue
        plan = microbatch_plan_by_id.get(solution_id)
        if plan is not None and plan.ordinal not in prepared_batch_ordinals:
            try:
                prepare_microbatch(plan)
            except Exception as exc:  # noqa: BLE001 - bind one shared batch failure
                batch_traceback = traceback.format_exc()
                for member in plan.solutions:
                    failed_microbatch_ids[str(member.get("id"))] = (
                        str(exc),
                        batch_traceback,
                    )
        if solution_id in failed_microbatch_ids:
            error, batch_traceback = failed_microbatch_ids[solution_id]
            failures.append(
                {
                    "solutionId": solution_id,
                    "error": error,
                    "traceback": batch_traceback,
                    "speciesExecution": species_execution_by_id.get(solution_id),
                }
            )
            print(f"[tier1-metrics]   FAILED: {error}", file=sys.stderr)
            continue
        precomputed_species = prepared_species_by_id.get(solution_id)
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
                    boundary_topology_cache=boundary_topology_cache,
                    boundary_fanout_mode=fanout_mode,
                    weighted_boundary_fanout_mode=weighted_fanout_mode,
                    weighted_layer_cache=weighted_layer_cache,
                    skip_species=args.skip_species,
                    skip_species_boundary_levels=set(args.skip_species_boundary_level),
                    species_csv_url=args.species_csv_url,
                    species_csv_sha256=(
                        species_csv_download.sha256
                        if species_csv_download is not None
                        else None
                    ),
                    cache_blob_directory=args.cache_blob_directory,
                    release_id=args.release_id,
                    solution_input_signature=solution_input_signatures[solution_id],
                    solution_catalog_binding=solution_catalog_binding,
                    raster_download=preflight_downloads[solution_id],
                    alignment_cache=alignment_cache,
                    alignment_provenance=_alignment_provenance_for_solution(
                        alignment_provenance,
                        solution,
                    ),
                    species_exception_binding=(
                        species_exception.binding
                        if species_exception is not None
                        and solution_domain(solution) == "land"
                        else None
                    ),
                    species_exception_source_sha256=(
                        _species_exception_source_sha256(species_exception)
                        if solution_domain(solution) == "land"
                        else None
                    ),
                    species_target_policy=species_target_policies.get(solution_id),
                    species_goals_catalog=species_goals_catalog,
                    species_goals_output_dir=args.species_goals_output_dir,
                    species_detail_sink=(
                        precomputed_species.detail_sink
                        if precomputed_species is not None
                        else None
                    ),
                    species_execution=species_execution_by_id.get(solution_id),
                    precomputed_species_accumulator=(
                        precomputed_species.accumulator
                        if precomputed_species is not None
                        else None
                    ),
                    species_execution_runtime=(
                        precomputed_species.runtime
                        if precomputed_species is not None
                        else None
                    ),
                )
            )
        except Exception as exc:  # noqa: BLE001 - batch runner records per-solution failures
            cleanup_error = (
                _close_species_goals_sink(precomputed_species.detail_sink)
                if precomputed_species is not None
                else None
            )
            failure = {
                "solutionId": solution_id,
                "error": (
                    str(exc)
                    if cleanup_error is None
                    else (
                        f"{exc}; cleanup also failed: "
                        f"{type(cleanup_error).__name__}: {cleanup_error}"
                    )
                ),
                "traceback": traceback.format_exc(),
                "speciesExecution": species_execution_by_id.get(solution_id),
            }
            if isinstance(exc, MetricsCandidateValidationError):
                failure["candidatePath"] = str(exc.candidate_path)
                failure["validationIssues"] = exc.validation_issues
            failures.append(failure)
            print(f"[tier1-metrics]   FAILED: {exc}", file=sys.stderr)
        finally:
            prepared_species_by_id.pop(solution_id, None)

    if args.coverage_parity_contract is not None and not failures:
        try:
            parity_contract = load_coverage_parity_contract(
                args.coverage_parity_contract
            )
            _run_coverage_parity_gate(
                args,
                solution_path=preflight_downloads[parity_contract.solution_id].path,
            )
        except (CoverageParityContractError, OSError, ValueError) as exc:
            print(f"[tier1-metrics] ERROR: {exc}", file=sys.stderr)
            return 2

    geo_levels = sorted({lvl for e in entries for lvl in e.get("geographyLevels", [])})
    if (
        args.species_goals_output_dir is not None
        and species_goals_catalog is not None
        and species_csv_download is not None
        and args.release_id is not None
    ):
        expected_sidecar_provenance = {}
        for solution in solutions:
            solution_id = str(solution.get("id"))
            if solution_domain(solution) != "land":
                continue
            regular_provenance = expected_provenance_by_id[solution_id]
            expected_sidecar_provenance[solution_id] = _species_goals_provenance(
                release_id=args.release_id,
                species_csv_sha256=species_csv_download.sha256,
                species_exception_source_sha256=(
                    _species_exception_source_sha256(species_exception)
                ),
                species_exception_binding=(
                    species_exception.binding if species_exception is not None else None
                ),
                alignment_provenance=regular_provenance["inputAlignment"],
                solution_raster_sha256=solution_checksums[solution_id],
                target_policy=species_target_policies[solution_id],
                boundary_provenance_sha256=regular_provenance[
                    "boundaryProvenance"
                ]["sha256"],
                catalog_sha256=species_goals_catalog["catalogSha256"],
            )
        species_goals_inventory = write_species_goals_release_inventory(
            args.species_goals_output_dir,
            release_id=args.release_id,
            catalog=species_goals_catalog,
            expected_provenance_by_solution=expected_sidecar_provenance,
        )
        print(
            "[tier1-metrics] species goals release inventory: "
            f"{len(species_goals_inventory['solutions'])} fully validated solution(s)"
        )
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
            if species_pool_sizes
            else None
        ),
        "speciesLoadError": species_load_error,
        "speciesSkipped": bool(args.skip_species),
        "speciesBoundaryLevelsSkipped": sorted(set(args.skip_species_boundary_level)),
        "chunk": {
            "index": args.chunk_index,
            "count": args.chunk_count,
            "scope": "domain" if args.domain is not None else "global",
            "domain": args.domain,
            "selectedBeforeChunk": len(selected_solutions),
            "selectedForChunk": len(solutions),
        },
        "domainSelection": (
            {
                "domain": args.domain,
                "catalogDomainCount": catalog.count_for_domain(args.domain),
                "selectedRecomputeCount": len(selected_solutions),
            }
            if args.domain is not None and catalog is not None
            else None
        ),
        "cachePolicy": args.cache_policy,
        "boundaryFanout": fanout_identity,
        "weightedBoundaryExecution": {
            **weighted_fanout_identity,
            "layerCacheHits": weighted_layer_cache.hits,
            "layerCacheMisses": weighted_layer_cache.misses,
            "layerCacheEntries": weighted_layer_cache.entry_count,
            "layerCacheBytes": weighted_layer_cache.estimated_bytes,
        },
        "speciesExecution": {
            **species_execution_config.provenance(),
            "resumePolicy": (
                "disabled-recompute-all"
                if species_execution_config.is_microbatch
                else "solution-cache-only"
            ),
            "batches": [
                {
                    "batchOrdinal": plan.ordinal,
                    "orderedSolutionIds": [
                        str(solution.get("id")) for solution in plan.solutions
                    ],
                    "bindingSha256": plan.binding["sha256"],
                    "componentSha256s": plan.binding["componentSha256s"],
                }
                for plan in {
                    plan.ordinal: plan for plan in microbatch_plan_by_id.values()
                }.values()
            ],
        },
        "inputAlignment": alignment_provenance,
        "releasePlan": release_plan_binding,
        "solutionCatalog": (
            {
                "format": "solution-catalog-v1",
                "catalogVersion": catalog.catalog_version,
                "releaseId": catalog.release_id,
                "sha256": catalog.sha256,
                "expectedCounts": {
                    "total": catalog.expected_total_count,
                    "land": catalog.expected_land_count,
                    "marine": catalog.expected_marine_count,
                },
            }
            if catalog is not None
            else None
        ),
        "resumeEnabled": (
            args.cache_policy == "use-cache"
            and not species_execution_config.is_microbatch
        ),
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
