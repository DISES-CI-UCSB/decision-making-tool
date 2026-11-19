"""Isolated cross-solution exact-species microbatch kernels.

The prototype keeps solution categories cell-major so one sparse species
lookup yields all solution selectors. Exact overlap NPZ files remain the
authority and are opened once per species. Boundary totals are reduced once
and shared across solutions; selected channels retain the current source-order
``float64`` reductions and overlap-safe primary-plus-extra owner semantics.
"""

from __future__ import annotations

import hashlib
import io
import json
import os
import time
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import unquote, urlparse

import numpy as np
import rasterio
from boundaries.boundary_topology import (
    AnyBoundaryIndex,
    BoundaryTopologyError,
    ExclusiveBoundaryIndex,
)
from calculators.species import SpeciesAccumulator
from raster_metrics import RasterFingerprint
from species_data import SpeciesRecord
from species_overlap import SpeciesOverlap, read_species_overlap

BATCH_BINDING_FORMAT = "species-solution-microbatch-binding-v1"
BATCH_CHECKPOINT_FORMAT = "species-solution-microbatch-checkpoint-v1"
SPECIES_EXECUTION_ENV = "METRICS_SPECIES_EXECUTION"
SPECIES_BATCH_SIZE_ENV = "METRICS_SPECIES_BATCH_SIZE"
INDEPENDENT_EXECUTION = "independent"
MICROBATCH_EXECUTION = "solution-microbatch-v1"
BUFFERED_MICROBATCH_EXECUTION = "solution-microbatch-v2"
INDEPENDENT_ALGORITHM_VERSION = "solution-independent-exact-npz-v1"
MICROBATCH_ALGORITHM_VERSION = "solution-microbatch-exact-npz-v1"
BUFFERED_MICROBATCH_ALGORITHM_VERSION = "solution-microbatch-buffered-exact-npz-v2"
DEFAULT_MICROBATCH_SIZE = 8
AREA_ABSOLUTE_TOLERANCE_M2 = 1e-6
AREA_RELATIVE_TOLERANCE = 1e-12

CancelCheck = Callable[[], bool]
CheckpointCallback = Callable[[dict[str, object]], None]
OverlapLoader = Callable[[Path, RasterFingerprint], SpeciesOverlap]


class SpeciesSolutionBatchError(ValueError):
    """Raised when batch inputs or checkpoint metadata are inconsistent."""


class SpeciesSolutionBatchCancelled(RuntimeError):
    """Raised at a deterministic species boundary when cancellation is requested."""


@dataclass(frozen=True)
class SpeciesExecutionConfig:
    requested_mode: str
    effective_mode: str
    algorithm_version: str
    batch_size: int

    @property
    def is_microbatch(self) -> bool:
        return self.effective_mode in {
            MICROBATCH_EXECUTION,
            BUFFERED_MICROBATCH_EXECUTION,
        }

    @property
    def is_buffered_microbatch(self) -> bool:
        return self.effective_mode == BUFFERED_MICROBATCH_EXECUTION

    def provenance(self) -> dict[str, object]:
        return {
            "requestedMode": self.requested_mode,
            "effectiveMode": self.effective_mode,
            "algorithmVersion": self.algorithm_version,
            "batchSize": self.batch_size,
        }


@dataclass(frozen=True)
class CategoryMatrix:
    """Cell-major solution categories and their common reference grid."""

    values: np.ndarray
    fingerprint: RasterFingerprint

    @property
    def num_cells(self) -> int:
        return int(self.values.shape[0])

    @property
    def num_solutions(self) -> int:
        return int(self.values.shape[1])


@dataclass(frozen=True)
class BatchNationalAreas:
    """National areas; total is shared and other channels are solution-major."""

    total: float
    selected: np.ndarray
    pre_existing: np.ndarray
    new_prioritizr: np.ndarray


@dataclass(frozen=True)
class BatchBoundaryAreas:
    """Boundary areas with one shared denominator and solution-major channels."""

    total: np.ndarray
    selected: np.ndarray
    pre_existing: np.ndarray
    new_prioritizr: np.ndarray


@dataclass(frozen=True)
class BatchSpeciesAreas:
    national: BatchNationalAreas
    boundaries: dict[str, BatchBoundaryAreas]


@dataclass(frozen=True)
class ExactOverlapInput:
    """One discovered exact artifact pinned to its verified expected bytes."""

    path: Path
    expected_sha256: str
    expected_bytes: int


@dataclass(frozen=True)
class BatchRunStats:
    species_processed: int
    npz_opens: int
    npz_bytes: int
    exact_read_seconds: float
    evaluation_seconds: float
    accumulator_seconds: float
    solution_failures: tuple[BatchSolutionFailure, ...] = ()


@dataclass(frozen=True)
class BatchSolutionFailure:
    solution_index: int
    species_index: int
    species_name: str
    error_type: str
    error: str


def resolve_species_execution(
    mode: str | None = None,
    batch_size: str | int | None = None,
) -> SpeciesExecutionConfig:
    """Resolve the guarded execution mode; unknown values fail closed."""

    requested = (mode or os.environ.get(SPECIES_EXECUTION_ENV, INDEPENDENT_EXECUTION)).strip()
    if requested not in {
        INDEPENDENT_EXECUTION,
        MICROBATCH_EXECUTION,
        BUFFERED_MICROBATCH_EXECUTION,
    }:
        raise SpeciesSolutionBatchError(
            f"{SPECIES_EXECUTION_ENV} must be {INDEPENDENT_EXECUTION!r}, "
            f"{MICROBATCH_EXECUTION!r}, or {BUFFERED_MICROBATCH_EXECUTION!r}; "
            f"got {requested!r}."
        )
    if requested == INDEPENDENT_EXECUTION:
        return SpeciesExecutionConfig(
            requested_mode=requested,
            effective_mode=requested,
            algorithm_version=INDEPENDENT_ALGORITHM_VERSION,
            batch_size=1,
        )
    raw_size = (
        batch_size
        if batch_size is not None
        else os.environ.get(SPECIES_BATCH_SIZE_ENV, str(DEFAULT_MICROBATCH_SIZE))
    )
    try:
        resolved_size = int(raw_size)
    except (TypeError, ValueError) as exc:
        raise SpeciesSolutionBatchError(
            f"{SPECIES_BATCH_SIZE_ENV} must be a positive integer."
        ) from exc
    if isinstance(raw_size, bool) or resolved_size <= 0:
        raise SpeciesSolutionBatchError(
            f"{SPECIES_BATCH_SIZE_ENV} must be a positive integer."
        )
    return SpeciesExecutionConfig(
        requested_mode=requested,
        effective_mode=requested,
        algorithm_version=(
            BUFFERED_MICROBATCH_ALGORITHM_VERSION
            if requested == BUFFERED_MICROBATCH_EXECUTION
            else MICROBATCH_ALGORITHM_VERSION
        ),
        batch_size=resolved_size,
    )


def category_mask_sha256(categories: np.ndarray) -> str:
    """Hash one canonical uint8 category column with its cell count."""

    values = np.asarray(categories)
    if values.dtype != np.uint8 or values.ndim != 1 or np.any(values > 2):
        raise SpeciesSolutionBatchError(
            "Category-mask checksums require one uint8 vector containing 0, 1, or 2."
        )
    digest = hashlib.sha256()
    digest.update(b"solution-category-mask-c-order-uint8-v1")
    digest.update(int(values.size).to_bytes(8, "big"))
    digest.update(np.ascontiguousarray(values).tobytes())
    return digest.hexdigest()


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def discover_exact_overlap_inventory(
    cache_dir: Path,
    species_records: Sequence[SpeciesRecord],
    *,
    target_grid_sha256: str,
) -> tuple[list[ExactOverlapInput], dict[str, object]]:
    """Bind a complete catalog-ordered exact NPZ inventory without geometry work."""

    by_filename: dict[str, tuple[Path, dict[str, object]]] = {}
    for manifest_path in (cache_dir / "species-overlap").glob("*/*.json"):
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise SpeciesSolutionBatchError(
                f"Exact overlap manifest is unreadable: {manifest_path}"
            ) from exc
        if (
            not isinstance(manifest, dict)
            or manifest.get("targetGridSha256") != target_grid_sha256
        ):
            continue
        source_url = manifest.get("sourceUrl")
        artifact_path = manifest_path.with_suffix(".npz")
        if not isinstance(source_url, str) or not artifact_path.is_file():
            continue
        filename = unquote(Path(urlparse(source_url).path).name)
        if filename in by_filename:
            existing_path, existing_manifest = by_filename[filename]
            if not _equivalent_exact_overlap_aliases(existing_manifest, manifest):
                raise SpeciesSolutionBatchError(
                    f"Conflicting exact overlap artifacts for {filename!r}."
                )
            by_filename[filename] = min(
                ((existing_path, existing_manifest), (artifact_path, manifest)),
                key=lambda value: str(value[0]),
            )
            continue
        by_filename[filename] = (artifact_path, manifest)

    inputs: list[ExactOverlapInput] = []
    entries: list[dict[str, object]] = []
    common: dict[str, object] | None = None
    for catalog_index, record in enumerate(species_records):
        found = by_filename.get(record.blob_filename)
        if found is None:
            raise SpeciesSolutionBatchError(
                f"Exact overlap inventory is missing {record.blob_filename!r}."
            )
        path, manifest = found
        expected_overlap_sha256 = manifest.get("overlapSha256")
        if (
            not isinstance(expected_overlap_sha256, str)
            or len(expected_overlap_sha256) != 64
        ):
            raise SpeciesSolutionBatchError(
                f"Exact overlap manifest has no pinned checksum for {path.name!r}."
            )
        verified_overlap_sha256 = _sha256_file(path)
        if verified_overlap_sha256 != expected_overlap_sha256:
            raise SpeciesSolutionBatchError(
                f"Exact overlap checksum mismatch for {path.name!r}."
            )
        observed_common = {
            "format": manifest.get("format"),
            "algorithmVersion": manifest.get("qa", {}).get("algorithmVersion")
            if isinstance(manifest.get("qa"), dict)
            else None,
            "policy": manifest.get("policy"),
            "policySha256": manifest.get("policySha256"),
            "targetGridSha256": manifest.get("targetGridSha256"),
        }
        if common is None:
            common = observed_common
        elif common != observed_common:
            raise SpeciesSolutionBatchError(
                "Exact overlap inventory mixes algorithm, policy, format, or grid."
            )
        expected_bytes = path.stat().st_size
        inputs.append(
            ExactOverlapInput(
                path=path,
                expected_sha256=expected_overlap_sha256,
                expected_bytes=expected_bytes,
            )
        )
        entries.append(
            {
                "catalogIndex": catalog_index,
                "scientificName": record.scientific_name,
                "cacheKey": manifest.get("cacheKey"),
                "sourceSha256": manifest.get("sourceSha256"),
                "overlapSha256": expected_overlap_sha256,
                "bytes": expected_bytes,
            }
        )
    assert common is not None
    descriptor: dict[str, object] = {
        **common,
        "speciesCount": len(entries),
        "entriesSha256": _canonical_sha256(entries),
        "totalBytes": sum(int(entry["bytes"]) for entry in entries),
    }
    descriptor["inventorySha256"] = _canonical_sha256(descriptor)
    return inputs, descriptor


def build_release_batch_binding(
    *,
    ordered_solution_ids: Sequence[str],
    solution_raster_sha256s: Sequence[str],
    category_mask_sha256s: Sequence[str],
    exact_overlap_inventory: Mapping[str, object],
    species_records_component: Mapping[str, object],
    target_policy_sha256s: Sequence[str],
    boundary_component: Mapping[str, object],
    active_geography_levels: Sequence[str],
    batch_ordinal: int,
    configured_batch_size: int,
    algorithm_version: str = MICROBATCH_ALGORITHM_VERSION,
) -> dict[str, object]:
    """Build the complete output-affecting microbatch identity."""

    count = len(ordered_solution_ids)
    components = (
        solution_raster_sha256s,
        category_mask_sha256s,
        target_policy_sha256s,
    )
    if count == 0 or any(len(component) != count for component in components):
        raise SpeciesSolutionBatchError("Microbatch solution components do not align.")
    if len(set(ordered_solution_ids)) != count:
        raise SpeciesSolutionBatchError("Microbatch solution IDs must be unique.")
    if batch_ordinal < 0 or configured_batch_size <= 0 or count > configured_batch_size:
        raise SpeciesSolutionBatchError("Microbatch ordinal or size is invalid.")
    body: dict[str, object] = {
        "format": "species-solution-release-binding-v1",
        "algorithmVersion": algorithm_version,
        "batchOrdinal": batch_ordinal,
        "configuredBatchSize": configured_batch_size,
        "actualBatchSize": count,
        "orderedSolutions": [
            {
                "solutionId": solution_id,
                "rasterSha256": raster_sha256,
                "categoryMaskSha256": category_sha256,
                "targetPolicySha256": policy_sha256,
            }
            for solution_id, raster_sha256, category_sha256, policy_sha256 in zip(
                ordered_solution_ids,
                solution_raster_sha256s,
                category_mask_sha256s,
                target_policy_sha256s,
                strict=True,
            )
        ],
        "exactOverlapCache": dict(exact_overlap_inventory),
        "speciesRecords": dict(species_records_component),
        "boundaries": dict(boundary_component),
        "activeGeographyLevels": list(active_geography_levels),
    }
    body["componentSha256s"] = {
        "solutions": _canonical_sha256(body["orderedSolutions"]),
        "exactOverlapCache": _canonical_sha256(body["exactOverlapCache"]),
        "speciesRecords": _canonical_sha256(body["speciesRecords"]),
        "boundaries": _canonical_sha256(body["boundaries"]),
        "activeGeographyLevels": _canonical_sha256(body["activeGeographyLevels"]),
    }
    body["sha256"] = _canonical_sha256(body)
    return body


def load_category_matrix(paths: Sequence[Path]) -> CategoryMatrix:
    """Load solution rasters one at a time into ``uint8[cells, solutions]``."""

    if not paths:
        raise SpeciesSolutionBatchError("At least one solution raster is required.")
    values: np.ndarray | None = None
    expected: RasterFingerprint | None = None
    for solution_index, path in enumerate(paths):
        with rasterio.open(path) as dataset:
            observed = _fingerprint(dataset)
            if expected is None:
                expected = observed
                values = np.empty(
                    (observed.width * observed.height, len(paths)),
                    dtype=np.uint8,
                    order="C",
                )
            elif not expected.matches(observed):
                raise SpeciesSolutionBatchError(
                    f"Solution raster grid differs from the first input: {path}"
                )
            band = dataset.read(1, masked=False)
            valid = np.ones(band.shape, dtype=np.bool_)
            if dataset.nodata is not None:
                valid &= band != dataset.nodata
            if np.issubdtype(band.dtype, np.floating):
                valid &= np.isfinite(band)
            unexpected = valid & ~np.isin(band, (0, 1, 2))
            if unexpected.any():
                preview = np.unique(band[unexpected])[:8].tolist()
                raise SpeciesSolutionBatchError(
                    f"Solution raster {path} contains unsupported categories: {preview}"
                )
            assert values is not None
            column = values[:, solution_index]
            column.fill(0)
            flat = np.asarray(band).ravel()
            flat_valid = valid.ravel()
            column[flat_valid] = flat[flat_valid].astype(np.uint8, copy=False)
    assert expected is not None and values is not None
    return CategoryMatrix(values=values, fingerprint=expected)


def validate_category_matrix(
    categories: np.ndarray,
    *,
    num_cells: int | None = None,
) -> np.ndarray:
    """Return a C-contiguous validated cell-major category matrix."""

    values = np.asarray(categories)
    if values.ndim != 2 or values.shape[1] == 0:
        raise SpeciesSolutionBatchError(
            "Categories must have shape [cells, non-empty solutions]."
        )
    if values.dtype != np.uint8:
        raise SpeciesSolutionBatchError("Categories must use uint8 storage.")
    if num_cells is not None and values.shape[0] != num_cells:
        raise SpeciesSolutionBatchError(
            f"Categories contain {values.shape[0]} cells; expected {num_cells}."
        )
    if np.any(values > 2):
        raise SpeciesSolutionBatchError("Categories may contain only 0, 1, or 2.")
    return np.ascontiguousarray(values)


def evaluate_species_batch(
    overlap: SpeciesOverlap,
    categories: np.ndarray,
    boundary_indexes: Mapping[str, AnyBoundaryIndex],
) -> BatchSpeciesAreas:
    """Evaluate one exact overlap for every solution in a microbatch."""

    values = validate_category_matrix(categories)
    pixels = np.asarray(overlap.flat_indices, dtype=np.int64)
    weights = np.asarray(overlap.areas_m2, dtype=np.float64)
    if pixels.shape != weights.shape:
        raise SpeciesSolutionBatchError("Overlap indexes and areas differ in shape.")
    if pixels.size and (pixels[0] < 0 or pixels[-1] >= values.shape[0]):
        raise SpeciesSolutionBatchError("Overlap indexes exceed the category grid.")
    if np.any(~np.isfinite(weights)) or np.any(weights <= 0):
        raise SpeciesSolutionBatchError("Overlap areas must be finite and positive.")
    for level, index in boundary_indexes.items():
        if index.num_pixels != values.shape[0]:
            raise BoundaryTopologyError(
                f"Boundary level {level!r} does not match the category grid."
            )

    species_categories = values[pixels]
    solution_count = values.shape[1]
    selected = np.zeros(solution_count, dtype=np.float64)
    pre_existing = np.zeros(solution_count, dtype=np.float64)
    new_prioritizr = np.zeros(solution_count, dtype=np.float64)
    for solution_index in range(solution_count):
        column = species_categories[:, solution_index]
        # Boolean selection preserves the source order of the authoritative
        # sorted overlap vectors, matching the current grouped path.
        selected[solution_index] = weights[column != 0].sum(dtype=np.float64)
        pre_existing[solution_index] = weights[column == 2].sum(dtype=np.float64)
        new_prioritizr[solution_index] = weights[column == 1].sum(dtype=np.float64)

    boundaries = {
        level: _aggregate_boundary_batch(index, pixels, weights, species_categories)
        for level, index in boundary_indexes.items()
    }
    return BatchSpeciesAreas(
        national=BatchNationalAreas(
            total=float(weights.sum(dtype=np.float64)),
            selected=selected,
            pre_existing=pre_existing,
            new_prioritizr=new_prioritizr,
        ),
        boundaries=boundaries,
    )


def process_exact_species_batch(
    *,
    species_records: Sequence[SpeciesRecord],
    overlap_paths: Sequence[Path | ExactOverlapInput],
    categories: np.ndarray,
    fingerprint: RasterFingerprint,
    boundary_indexes: Mapping[str, AnyBoundaryIndex],
    accumulators: Sequence[SpeciesAccumulator | None] | None = None,
    overlap_loader: OverlapLoader = read_species_overlap,
    binding: Mapping[str, object] | None = None,
    checkpoint_interval: int = 0,
    checkpoint: CheckpointCallback | None = None,
    cancel_check: CancelCheck | None = None,
) -> BatchRunStats:
    """Process catalog-ordered NPZ artifacts once and optionally update sinks."""

    if len(species_records) != len(overlap_paths):
        raise SpeciesSolutionBatchError(
            "Species records and overlap paths must have equal catalog length."
        )
    values = validate_category_matrix(
        categories,
        num_cells=fingerprint.width * fingerprint.height,
    )
    if accumulators is not None and len(accumulators) != values.shape[1]:
        raise SpeciesSolutionBatchError(
            "Accumulator count must match the number of solutions."
        )
    if checkpoint_interval < 0:
        raise SpeciesSolutionBatchError("checkpoint_interval cannot be negative.")
    if checkpoint is not None and binding is None:
        raise SpeciesSolutionBatchError("Checkpoint output requires a batch binding.")

    npz_bytes = 0
    exact_read_seconds = 0.0
    evaluation_seconds = 0.0
    accumulator_seconds = 0.0
    active_solution_indexes = (
        {
            index
            for index, accumulator in enumerate(accumulators)
            if accumulator is not None
        }
        if accumulators is not None
        else set()
    )
    solution_failures: list[BatchSolutionFailure] = []
    for species_index, (record, overlap_input) in enumerate(
        zip(species_records, overlap_paths, strict=True)
    ):
        if cancel_check is not None and cancel_check():
            raise SpeciesSolutionBatchCancelled(
                f"Cancelled before catalog species index {species_index}."
            )
        phase_started = time.perf_counter()
        if isinstance(overlap_input, ExactOverlapInput):
            path = overlap_input.path
            consumed_bytes = path.read_bytes()
            consumed_sha256 = hashlib.sha256(consumed_bytes).hexdigest()
            if (
                len(consumed_bytes) != overlap_input.expected_bytes
                or consumed_sha256 != overlap_input.expected_sha256
            ):
                raise SpeciesSolutionBatchError(
                    f"Exact overlap changed after discovery for {path.name!r}."
                )
            overlap = overlap_loader(io.BytesIO(consumed_bytes), fingerprint)
            npz_bytes += len(consumed_bytes)
        else:
            path = overlap_input
            overlap = overlap_loader(path, fingerprint)
            npz_bytes += path.stat().st_size
        exact_read_seconds += time.perf_counter() - phase_started
        phase_started = time.perf_counter()
        areas = evaluate_species_batch(overlap, values, boundary_indexes)
        evaluation_seconds += time.perf_counter() - phase_started
        if accumulators is not None:
            phase_started = time.perf_counter()
            solution_failures.extend(
                _record_species(
                    record,
                    areas,
                    accumulators,
                    active_solution_indexes=active_solution_indexes,
                    species_index=species_index,
                )
            )
            accumulator_seconds += time.perf_counter() - phase_started
        completed = species_index + 1
        if (
            checkpoint is not None
            and checkpoint_interval > 0
            and completed % checkpoint_interval == 0
        ):
            checkpoint(
                build_checkpoint_metadata(
                    binding=binding,
                    completed_species_count=completed,
                    species_count=len(species_records),
                )
            )
    return BatchRunStats(
        species_processed=len(species_records),
        npz_opens=len(overlap_paths),
        npz_bytes=npz_bytes,
        exact_read_seconds=exact_read_seconds,
        evaluation_seconds=evaluation_seconds,
        accumulator_seconds=accumulator_seconds,
        solution_failures=tuple(solution_failures),
    )


def build_batch_binding(
    *,
    exact_cache_inventory_sha256: str,
    ordered_solution_ids: Sequence[str],
    solution_sha256s: Sequence[str],
    topology_provenance_sha256: str,
    target_policy_sha256s: Sequence[str],
    species_catalog_sha256: str,
) -> dict[str, object]:
    """Build deterministic metadata that prevents cross-input resume."""

    solution_count = len(ordered_solution_ids)
    if solution_count == 0 or any(
        len(values) != solution_count
        for values in (solution_sha256s, target_policy_sha256s)
    ):
        raise SpeciesSolutionBatchError(
            "Ordered solution IDs, checksums, and target policies must align."
        )
    if len(set(ordered_solution_ids)) != solution_count:
        raise SpeciesSolutionBatchError("Ordered solution IDs must be unique.")
    hashes = (
        exact_cache_inventory_sha256,
        topology_provenance_sha256,
        species_catalog_sha256,
        *solution_sha256s,
        *target_policy_sha256s,
    )
    if any(not _is_sha256(value) for value in hashes):
        raise SpeciesSolutionBatchError("Batch binding hashes must be SHA-256 values.")
    body: dict[str, object] = {
        "format": BATCH_BINDING_FORMAT,
        "exactCacheInventorySha256": exact_cache_inventory_sha256,
        "orderedSolutions": [
            {
                "solutionId": solution_id,
                "solutionSha256": solution_sha256,
                "targetPolicySha256": target_policy_sha256,
            }
            for solution_id, solution_sha256, target_policy_sha256 in zip(
                ordered_solution_ids,
                solution_sha256s,
                target_policy_sha256s,
                strict=True,
            )
        ],
        "topologyProvenanceSha256": topology_provenance_sha256,
        "speciesCatalogSha256": species_catalog_sha256,
    }
    body["sha256"] = _canonical_sha256(body)
    return body


def build_checkpoint_metadata(
    *,
    binding: Mapping[str, object],
    completed_species_count: int,
    species_count: int,
) -> dict[str, object]:
    """Describe a deterministic species-boundary checkpoint."""

    if binding.get("format") != BATCH_BINDING_FORMAT or not _is_sha256(
        binding.get("sha256")
    ):
        raise SpeciesSolutionBatchError("Checkpoint binding is invalid.")
    if not 0 <= completed_species_count <= species_count:
        raise SpeciesSolutionBatchError("Checkpoint species counts are invalid.")
    return {
        "format": BATCH_CHECKPOINT_FORMAT,
        "bindingSha256": binding["sha256"],
        "completedSpeciesCount": completed_species_count,
        "speciesCount": species_count,
    }


def checkpoint_is_resumable(
    checkpoint: Mapping[str, object],
    *,
    binding: Mapping[str, object],
    species_count: int,
) -> bool:
    """Return whether checkpoint metadata exactly matches current inputs."""

    return bool(
        checkpoint.get("format") == BATCH_CHECKPOINT_FORMAT
        and checkpoint.get("bindingSha256") == binding.get("sha256")
        and checkpoint.get("speciesCount") == species_count
        and isinstance(checkpoint.get("completedSpeciesCount"), int)
        and not isinstance(checkpoint.get("completedSpeciesCount"), bool)
        and 0
        <= int(checkpoint["completedSpeciesCount"])
        <= species_count
    )


def _aggregate_boundary_batch(
    index: AnyBoundaryIndex,
    pixels: np.ndarray,
    weights: np.ndarray,
    categories: np.ndarray,
) -> BatchBoundaryAreas:
    solution_count = categories.shape[1]
    total = np.zeros(index.num_boundaries, dtype=np.float64)
    selected = np.zeros((solution_count, index.num_boundaries), dtype=np.float64)
    pre_existing = np.zeros_like(selected)
    new_prioritizr = np.zeros_like(selected)

    if isinstance(index, ExclusiveBoundaryIndex):
        owners = index.flat[pixels]
        source_positions = np.flatnonzero(owners >= 0)
        _accumulate_claim_group(
            total,
            selected,
            pre_existing,
            new_prioritizr,
            owners[source_positions],
            source_positions,
            weights,
            categories,
            index.num_boundaries,
        )
    else:
        starts = index.offsets[pixels]
        stops = index.offsets[pixels + 1]
        multiplicities = stops - starts
        primary_positions = np.flatnonzero(multiplicities > 0)
        _accumulate_claim_group(
            total,
            selected,
            pre_existing,
            new_prioritizr,
            index.boundary_indices[starts[primary_positions]],
            primary_positions,
            weights,
            categories,
            index.num_boundaries,
        )
        overlap_positions = np.flatnonzero(multiplicities > 1)
        if overlap_positions.size:
            extra_counts = multiplicities[overlap_positions] - 1
            extra_source_positions = np.repeat(overlap_positions, extra_counts)
            group_starts = np.cumsum(extra_counts, dtype=np.int64) - extra_counts
            extra_claim_positions = (
                np.repeat(starts[overlap_positions] + 1, extra_counts)
                + np.arange(extra_source_positions.size, dtype=np.int64)
                - np.repeat(group_starts, extra_counts)
            )
            _accumulate_claim_group(
                total,
                selected,
                pre_existing,
                new_prioritizr,
                index.boundary_indices[extra_claim_positions],
                extra_source_positions,
                weights,
                categories,
                index.num_boundaries,
            )
    return BatchBoundaryAreas(
        total=total,
        selected=selected,
        pre_existing=pre_existing,
        new_prioritizr=new_prioritizr,
    )


def _accumulate_claim_group(
    total: np.ndarray,
    selected: np.ndarray,
    pre_existing: np.ndarray,
    new_prioritizr: np.ndarray,
    owners: np.ndarray,
    source_positions: np.ndarray,
    weights: np.ndarray,
    categories: np.ndarray,
    num_boundaries: int,
) -> None:
    if source_positions.size == 0:
        return
    claim_weights = weights[source_positions]
    total += np.bincount(
        owners,
        weights=claim_weights,
        minlength=num_boundaries,
    )
    claim_categories = categories[source_positions]
    for solution_index in range(categories.shape[1]):
        column = claim_categories[:, solution_index]
        for output, active in (
            (selected[solution_index], column != 0),
            (pre_existing[solution_index], column == 2),
            (new_prioritizr[solution_index], column == 1),
        ):
            if active.any():
                output += np.bincount(
                    owners[active],
                    weights=claim_weights[active],
                    minlength=num_boundaries,
                )


def _record_species(
    species: SpeciesRecord,
    areas: BatchSpeciesAreas,
    accumulators: Sequence[SpeciesAccumulator | None],
    *,
    active_solution_indexes: set[int],
    species_index: int,
) -> list[BatchSolutionFailure]:
    has_range = areas.national.total > 0
    failures: list[BatchSolutionFailure] = []
    for solution_index in sorted(active_solution_indexes):
        accumulator = accumulators[solution_index]
        assert accumulator is not None
        try:
            accumulator.species_aligned += 1
            accumulator.species_processed += 1
            accumulator.species_with_range += int(has_range)
            accumulator.record_species_national(
                species,
                float(areas.national.selected[solution_index]),
                areas.national.total,
                pre_existing_range_area_m2=float(
                    areas.national.pre_existing[solution_index]
                ),
                new_prioritizr_range_area_m2=float(
                    areas.national.new_prioritizr[solution_index]
                ),
            )
            for level, boundary in areas.boundaries.items():
                accumulator.record_species_sub_level(
                    species,
                    level,
                    boundary.selected[solution_index],
                    boundary.total,
                    pre_existing_per_boundary=boundary.pre_existing[solution_index],
                    new_prioritizr_per_boundary=boundary.new_prioritizr[solution_index],
                )
        except Exception as exc:  # noqa: BLE001 - isolate one solution member
            failures.append(
                BatchSolutionFailure(
                    solution_index=solution_index,
                    species_index=species_index,
                    species_name=species.scientific_name,
                    error_type=type(exc).__name__,
                    error=str(exc),
                )
            )
    active_solution_indexes.difference_update(
        failure.solution_index for failure in failures
    )
    return failures


def _fingerprint(dataset: rasterio.io.DatasetReader) -> RasterFingerprint:
    transform = dataset.transform
    return RasterFingerprint(
        width=dataset.width,
        height=dataset.height,
        transform=(
            transform.a,
            transform.b,
            transform.c,
            transform.d,
            transform.e,
            transform.f,
        ),
        crs=dataset.crs.to_string() if dataset.crs else None,
    )


def _canonical_sha256(value: object) -> str:
    return hashlib.sha256(
        json.dumps(
            value,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    ).hexdigest()


def _equivalent_exact_overlap_aliases(
    left: Mapping[str, object],
    right: Mapping[str, object],
) -> bool:
    """Allow cache-key/toolchain aliases only when consumed exact bytes agree."""

    keys = (
        "format",
        "sourceUrl",
        "sourceSha256",
        "overlapSha256",
        "policy",
        "policySha256",
        "targetGrid",
        "targetGridSha256",
        "authoritativeAreaKm2",
    )
    left_qa = left.get("qa")
    right_qa = right.get("qa")
    return bool(
        all(left.get(key) == right.get(key) for key in keys)
        and isinstance(left_qa, Mapping)
        and isinstance(right_qa, Mapping)
        and left_qa.get("algorithmVersion") == right_qa.get("algorithmVersion")
        and left_qa.get("positiveTargetCellCount")
        == right_qa.get("positiveTargetCellCount")
    )


def _is_sha256(value: object) -> bool:
    return (
        isinstance(value, str)
        and len(value) == 64
        and all(character in "0123456789abcdef" for character in value)
    )
