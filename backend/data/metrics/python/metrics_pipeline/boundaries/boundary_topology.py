"""Overlap-safe, pixel-major indexes for independent boundary aggregation.

Unlike :mod:`boundaries.boundary_id_grid`, these indexes never resolve an
overlap by choosing one owner. Partition-like levels can use the compact
exclusive representation after proving exclusivity; overlapping levels use
CSR membership so every pixel-to-boundary claim remains available.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
import hashlib
from pathlib import Path
from typing import Callable, Literal, TypeAlias

import numpy as np

from boundaries.boundary_id_grid import boundary_collection_sha256
from boundaries.boundary_loader import (
    BOUNDARY_SOURCE_SPECS,
    BoundaryFeature,
    load_all_boundaries,
)
from boundaries.boundary_mask import ReferenceGridKey, rasterize_boundary, reference_grid_key
from raster_metrics import RasterFingerprint


BoundaryIndexMode: TypeAlias = Literal["auto", "exclusive", "overlap"]
BoundaryFanoutMode: TypeAlias = Literal["legacy", "grouped"]
BoundaryMaskProvider: TypeAlias = Callable[[BoundaryFeature], np.ndarray]

DEFAULT_OVERLAP_LEVELS = frozenset({"siraps", "runaps", "omecs"})
LEGACY_BOUNDARY_FANOUT_ALGORITHM_VERSION = "boundary-fanout-dense-mask-v1"
GROUPED_BOUNDARY_FANOUT_ALGORITHM_VERSION = (
    "boundary-fanout-primary-extra-four-channel-v2"
)
_AGGREGATION_CLAIM_CHUNK = 262_144


class BoundaryTopologyError(ValueError):
    """Raised when masks cannot produce the requested topology index."""


class BoundaryTopologyAuditUnavailable(BoundaryTopologyError):
    """Raised when an explicitly requested pinned-source audit cannot run."""


def boundary_fanout_identity(
    requested_mode: str,
    *,
    effective_mode: str | None = None,
) -> dict[str, str]:
    """Return the stable calculation identity persisted in metric artifacts."""

    if requested_mode not in {"legacy", "grouped"}:
        raise BoundaryTopologyError(
            f"Unsupported boundary fan-out mode: {requested_mode!r}."
        )
    effective = effective_mode or requested_mode
    if effective not in {"legacy", "grouped"}:
        raise BoundaryTopologyError(
            f"Unsupported effective boundary fan-out mode: {effective!r}."
        )
    algorithm_version = (
        GROUPED_BOUNDARY_FANOUT_ALGORITHM_VERSION
        if effective == "grouped"
        else LEGACY_BOUNDARY_FANOUT_ALGORITHM_VERSION
    )
    return {
        "requestedMode": requested_mode,
        "effectiveMode": effective,
        "algorithmVersion": algorithm_version,
    }


@dataclass(frozen=True)
class BoundaryProvenance:
    """Available source identity for one boundary in catalog order."""

    boundary_id: str
    source_crs: str
    source_sha256: str
    source_url: str
    geometry_sha256: str | None


@dataclass(frozen=True)
class BoundaryTopologyIndex:
    """Metadata shared by exclusive and overlap-safe boundary indexes.

    ``estimated_bytes`` covers final NumPy index buffers.
    ``estimated_peak_build_bytes`` additionally covers the largest bounded
    temporary buffers: one dense bool mask, worst-case per-mask indexing
    arrays, and any per-pixel construction cursor. Boundary strings and
    dataclass overhead are intentionally omitted from both estimates. Provider-
    internal allocations and copies caused by numeric-to-bool mask conversion
    are also excluded because their size depends on the provider's input dtype.

    This index is intended to replace dense per-boundary mask retention during
    integration. Keeping both representations would preserve the original
    memory bottleneck and defeat the topology-index design.
    """

    level: str
    boundary_ids: tuple[str, ...]
    boundary_names: tuple[str, ...]
    boundary_provenance: tuple[BoundaryProvenance, ...]
    total_claims: int
    claimed_pixels: int
    overlap_pixels: int
    max_multiplicity: int
    estimated_bytes: int
    estimated_peak_build_bytes: int

    @property
    def num_boundaries(self) -> int:
        return len(self.boundary_ids)


@dataclass(frozen=True)
class ExclusiveBoundaryIndex(BoundaryTopologyIndex):
    """One proven-exclusive int32 boundary ID per pixel, or ``-1``."""

    flat: np.ndarray

    @property
    def num_pixels(self) -> int:
        return int(self.flat.size)


@dataclass(frozen=True)
class OverlapBoundaryIndex(BoundaryTopologyIndex):
    """Pixel-major CSR membership preserving every boundary claim.

    Memberships for pixel ``p`` are
    ``boundary_indices[offsets[p]:offsets[p + 1]]``.
    """

    offsets: np.ndarray
    boundary_indices: np.ndarray

    @property
    def num_pixels(self) -> int:
        return int(self.offsets.size - 1)


AnyBoundaryIndex: TypeAlias = ExclusiveBoundaryIndex | OverlapBoundaryIndex


@dataclass(frozen=True)
class BoundaryChannelAggregates:
    """Per-boundary values for the four independent solution channels."""

    total: np.ndarray
    selected: np.ndarray
    pre_existing: np.ndarray
    new_prioritizr: np.ndarray


@dataclass(frozen=True)
class SparseBoundaryWeightedChannels:
    """Validated sparse source vectors reusable across boundary levels."""

    pixel_indices: np.ndarray
    weights: np.ndarray
    finite: np.ndarray
    all_finite: bool
    selected: np.ndarray
    pre_existing: np.ndarray
    new_prioritizr: np.ndarray


@dataclass(frozen=True)
class BoundaryTopologyCacheKey:
    """Identity for one grid-aligned, source-pinned boundary collection."""

    grid: ReferenceGridKey
    boundary_collection_sha256: str


class BoundaryTopologyCache:
    """Cache topology indexes without retaining their source dense masks."""

    def __init__(self) -> None:
        self._cache: dict[BoundaryTopologyCacheKey, dict[str, AnyBoundaryIndex]] = {}

    def get(
        self,
        boundaries_by_level: dict[str, list[BoundaryFeature]],
        fingerprint: RasterFingerprint,
    ) -> tuple[dict[str, AnyBoundaryIndex], bool]:
        key = BoundaryTopologyCacheKey(
            grid=reference_grid_key(fingerprint),
            boundary_collection_sha256=boundary_collection_sha256(
                boundaries_by_level
            ),
        )
        cache_hit = key in self._cache
        if not cache_hit:
            self._cache[key] = build_topology_indexes_for_levels(
                boundaries_by_level,
                fingerprint,
            )
        return self._cache[key], cache_hit


def _default_mask_provider(
    fingerprint: RasterFingerprint,
) -> BoundaryMaskProvider:
    def provide(feature: BoundaryFeature) -> np.ndarray:
        return rasterize_boundary(
            feature.geometry,
            fingerprint,
            source_crs=feature.source_crs,
        )

    return provide


def _validated_flat_mask(
    feature: BoundaryFeature,
    mask_provider: BoundaryMaskProvider,
    fingerprint: RasterFingerprint,
) -> np.ndarray:
    mask = np.asarray(mask_provider(feature), dtype=np.bool_)
    expected_shape = (fingerprint.height, fingerprint.width)
    if mask.shape != expected_shape:
        raise BoundaryTopologyError(
            f"Boundary {feature.geo_level}/{feature.boundary_id} mask has shape "
            f"{mask.shape}; expected {expected_shape}."
        )
    return mask.ravel()


def _ordered_catalog(
    features: list[BoundaryFeature],
) -> tuple[
    tuple[str, ...],
    tuple[str, ...],
    tuple[BoundaryProvenance, ...],
]:
    boundary_ids = tuple(feature.boundary_id for feature in features)
    id_counts = Counter(boundary_ids)
    if len(id_counts) != len(boundary_ids):
        duplicate_ids = sorted(
            boundary_id
            for boundary_id, count in id_counts.items()
            if count > 1
        )
        raise BoundaryTopologyError(
            "Boundary catalog contains duplicate ID(s): "
            + ", ".join(repr(boundary_id) for boundary_id in duplicate_ids)
            + "."
        )

    return (
        boundary_ids,
        tuple(feature.name for feature in features),
        tuple(
            BoundaryProvenance(
                boundary_id=feature.boundary_id,
                source_crs=feature.source_crs,
                source_sha256=feature.source_sha256,
                source_url=(
                    feature.source_metadata.url
                    if feature.source_metadata is not None
                    else ""
                ),
                geometry_sha256=feature.geometry_sha256,
            )
            for feature in features
        ),
    )


def _build_exclusive(
    level: str,
    features: list[BoundaryFeature],
    fingerprint: RasterFingerprint,
    mask_provider: BoundaryMaskProvider,
) -> ExclusiveBoundaryIndex | None:
    """Return an exclusive index, or ``None`` as soon as overlap is detected."""

    n_pixels = fingerprint.height * fingerprint.width
    flat = np.full(n_pixels, -1, dtype=np.int32)
    total_claims = 0

    for boundary_index, feature in enumerate(features):
        claimed = np.flatnonzero(
            _validated_flat_mask(feature, mask_provider, fingerprint)
        )
        total_claims += int(claimed.size)
        if np.any(flat[claimed] != -1):
            return None
        flat[claimed] = boundary_index

    boundary_ids, boundary_names, provenance = _ordered_catalog(features)
    temporary_bytes = n_pixels * (
        (2 * np.dtype(np.bool_).itemsize)
        + np.dtype(np.intp).itemsize
        + np.dtype(np.int32).itemsize
    )
    return ExclusiveBoundaryIndex(
        level=level,
        boundary_ids=boundary_ids,
        boundary_names=boundary_names,
        boundary_provenance=provenance,
        total_claims=total_claims,
        claimed_pixels=total_claims,
        overlap_pixels=0,
        max_multiplicity=1 if total_claims else 0,
        estimated_bytes=int(flat.nbytes),
        estimated_peak_build_bytes=int(flat.nbytes + temporary_bytes),
        flat=flat,
    )


def _build_overlap(
    level: str,
    features: list[BoundaryFeature],
    fingerprint: RasterFingerprint,
    mask_provider: BoundaryMaskProvider,
    *,
    prior_peak_bytes: int = 0,
) -> OverlapBoundaryIndex:
    """Build exact CSR in two bounded-memory streaming passes.

    The mask provider must return identical claims for each boundary in both
    passes. Claim digests and final segment cursors verify this requirement;
    any inconsistency fails closed before an index can be returned.
    """

    n_pixels = fingerprint.height * fingerprint.width
    offsets = np.zeros(n_pixels + 1, dtype=np.int64)
    first_pass_claim_digests: list[bytes] = []

    # Pass 1 records only per-pixel multiplicity. No per-boundary mask or
    # sparse claim chunk survives the current iteration.
    for feature in features:
        claimed = np.flatnonzero(
            _validated_flat_mask(feature, mask_provider, fingerprint)
        )
        first_pass_claim_digests.append(hashlib.sha256(claimed).digest())
        offsets[claimed + 1] += 1

    multiplicities = offsets[1:]
    total_claims = int(multiplicities.sum())
    claimed_pixels = int(np.count_nonzero(multiplicities))
    overlap_pixels = int(np.count_nonzero(multiplicities > 1))
    max_multiplicity = int(multiplicities.max(initial=0))
    np.cumsum(offsets, out=offsets)

    boundary_indices = np.empty(total_claims, dtype=np.int32)
    write_positions = offsets[:-1].copy()

    # Pass 2 fills each pixel's ownership slice in source boundary order.
    for boundary_index, feature in enumerate(features):
        claimed = np.flatnonzero(
            _validated_flat_mask(feature, mask_provider, fingerprint)
        )
        if hashlib.sha256(claimed).digest() != first_pass_claim_digests[boundary_index]:
            raise BoundaryTopologyError(
                f"Boundary {level}/{feature.boundary_id} mask changed between "
                "CSR passes; two-pass mask providers must be deterministic."
            )
        positions = write_positions[claimed]
        if np.any(positions >= offsets[claimed + 1]):
            raise BoundaryTopologyError(
                f"Boundary {level}/{feature.boundary_id} produced extra or "
                "inconsistent claims during CSR pass two."
            )
        boundary_indices[positions] = boundary_index
        write_positions[claimed] += 1

    if not np.array_equal(write_positions, offsets[1:]):
        incomplete_pixels = int(np.count_nonzero(write_positions != offsets[1:]))
        raise BoundaryTopologyError(
            f"Boundary level {level!r} CSR pass two did not exactly fill "
            f"{incomplete_pixels} pixel segment(s); mask providers must be "
            "deterministic across passes."
        )

    boundary_ids, boundary_names, provenance = _ordered_catalog(features)
    final_bytes = int(offsets.nbytes + boundary_indices.nbytes)
    bounded_temporaries = n_pixels * (
        np.dtype(np.bool_).itemsize + (3 * np.dtype(np.intp).itemsize)
    )
    overlap_peak_bytes = (
        final_bytes + write_positions.nbytes + bounded_temporaries
    )
    return OverlapBoundaryIndex(
        level=level,
        boundary_ids=boundary_ids,
        boundary_names=boundary_names,
        boundary_provenance=provenance,
        total_claims=total_claims,
        claimed_pixels=claimed_pixels,
        overlap_pixels=overlap_pixels,
        max_multiplicity=max_multiplicity,
        estimated_bytes=final_bytes,
        estimated_peak_build_bytes=max(prior_peak_bytes, overlap_peak_bytes),
        offsets=offsets,
        boundary_indices=boundary_indices,
    )


def build_boundary_topology_index(
    level: str,
    features: list[BoundaryFeature],
    fingerprint: RasterFingerprint,
    *,
    mode: BoundaryIndexMode = "auto",
    mask_provider: BoundaryMaskProvider | None = None,
) -> AnyBoundaryIndex:
    """Build an overlap-safe index without retaining dense masks.

    ``auto`` first attempts the smaller exclusive representation and rebuilds
    as CSR if any pixel has multiple claims. ``exclusive`` proves the same
    invariant but raises instead of falling back. ``overlap`` builds CSR
    directly, including when the current data happens to be disjoint.

    Integration must replace the corresponding dense boundary-mask cache with
    this index after construction. Supplementing retained masks with this index
    would increase memory instead of removing repeated full-grid scans.
    Future species fan-out must consume sparse range indices and areas directly
    through CSR memberships; it must not materialize dense species-by-boundary
    masks.

    Two-pass overlap construction requires deterministic ``mask_provider``
    results. Changed, missing, or extra claims fail closed.
    """

    if mode not in {"auto", "exclusive", "overlap"}:
        raise BoundaryTopologyError(f"Unsupported boundary index mode: {mode!r}.")

    # Validate source identity before doing any rasterization work.
    _ordered_catalog(features)
    provider = mask_provider or _default_mask_provider(fingerprint)
    if mode == "overlap":
        return _build_overlap(level, features, fingerprint, provider)

    exclusive = _build_exclusive(level, features, fingerprint, provider)
    if exclusive is not None:
        return exclusive
    if mode == "exclusive":
        raise BoundaryTopologyError(
            f"Boundary level {level!r} is not exclusive; at least one pixel "
            "has multiple boundary claims."
        )
    n_pixels = fingerprint.height * fingerprint.width
    failed_exclusive_peak = n_pixels * (
        np.dtype(np.int32).itemsize
        + (2 * np.dtype(np.bool_).itemsize)
        + np.dtype(np.intp).itemsize
        + np.dtype(np.int32).itemsize
    )
    return _build_overlap(
        level,
        features,
        fingerprint,
        provider,
        prior_peak_bytes=failed_exclusive_peak,
    )


def build_topology_indexes_for_levels(
    boundaries_by_level: dict[str, list[BoundaryFeature]],
    fingerprint: RasterFingerprint,
    *,
    modes: dict[str, BoundaryIndexMode] | None = None,
    mask_provider: BoundaryMaskProvider | None = None,
) -> dict[str, AnyBoundaryIndex]:
    """Build indexes in source level order with topology-aware defaults.

    SIRAP, RUNAP, and OMEC levels default to explicit overlap mode. Other
    levels detect exclusivity and automatically fall back to overlap.
    """

    requested_modes = modes or {}
    indexes: dict[str, AnyBoundaryIndex] = {}
    for level, features in boundaries_by_level.items():
        default_mode = _default_mode_for_level(level)
        indexes[level] = build_boundary_topology_index(
            level,
            features,
            fingerprint,
            mode=requested_modes.get(level, default_mode),
            mask_provider=mask_provider,
        )
    return indexes


def _default_mode_for_level(level: str) -> BoundaryIndexMode:
    return "overlap" if level in DEFAULT_OVERLAP_LEVELS else "auto"


def audit_cached_boundary_topology(
    cache_dir: Path,
    level: str,
    fingerprint: RasterFingerprint,
    *,
    mode: BoundaryIndexMode | None = None,
) -> AnyBoundaryIndex:
    """Run an explicitly requested audit using pinned local sources only.

    Every pinned source is checked before calling the existing loader, so this
    helper never turns an audit into a network download. Missing or invalid
    sources fail clearly rather than producing a skipped or partial audit.
    """

    if level not in BOUNDARY_SOURCE_SPECS:
        raise BoundaryTopologyAuditUnavailable(
            f"No pinned boundary source is configured for level {level!r}."
        )

    boundary_dir = cache_dir / "boundaries"
    missing = [
        boundary_dir / spec.cache_filename
        for spec in BOUNDARY_SOURCE_SPECS.values()
        if not (boundary_dir / spec.cache_filename).is_file()
    ]
    if missing:
        missing_names = ", ".join(path.name for path in missing)
        raise BoundaryTopologyAuditUnavailable(
            f"Pinned boundary topology audit cannot run from {cache_dir}: "
            f"missing {missing_names}."
        )

    boundaries_by_level, errors = load_all_boundaries(cache_dir)
    if errors:
        details = "; ".join(
            f"{failed_level}: {message}"
            for failed_level, message in sorted(errors.items())
        )
        raise BoundaryTopologyAuditUnavailable(
            f"Pinned boundary topology audit sources are invalid: {details}"
        )

    return build_boundary_topology_index(
        level,
        boundaries_by_level[level],
        fingerprint,
        mode=mode or _default_mode_for_level(level),
    )


def boundary_cell_counts(index: AnyBoundaryIndex) -> np.ndarray:
    """Return independent rasterized-cell counts in source boundary order."""

    if isinstance(index, ExclusiveBoundaryIndex):
        claimed = index.flat[index.flat >= 0]
    else:
        claimed = index.boundary_indices
    return np.bincount(claimed, minlength=index.num_boundaries).astype(
        np.int64,
        copy=False,
    )


def _flat_bool_values(
    values: np.ndarray,
    index: AnyBoundaryIndex,
    *,
    label: str,
) -> np.ndarray:
    flat = np.asarray(values, dtype=np.bool_).ravel()
    if flat.size != index.num_pixels:
        raise BoundaryTopologyError(
            f"{label} has {flat.size} cells; expected {index.num_pixels}."
        )
    return flat


def _flat_float64_values(
    values: np.ndarray,
    index: AnyBoundaryIndex,
    *,
    label: str,
) -> np.ndarray:
    flat = np.asarray(values, dtype=np.float64).ravel()
    if flat.size != index.num_pixels:
        raise BoundaryTopologyError(
            f"{label} has {flat.size} cells; expected {index.num_pixels}."
        )
    return flat


def _prepared_channels(
    index: AnyBoundaryIndex,
    *,
    total: np.ndarray,
    selected: np.ndarray,
    pre_existing: np.ndarray,
    new_prioritizr: np.ndarray,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    return (
        _flat_bool_values(total, index, label="total"),
        _flat_bool_values(selected, index, label="selected"),
        _flat_bool_values(pre_existing, index, label="pre_existing"),
        _flat_bool_values(new_prioritizr, index, label="new_prioritizr"),
    )


def _aggregate_boundary_channels(
    index: AnyBoundaryIndex,
    channels: tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray],
    valid: np.ndarray,
    weights: np.ndarray | None,
) -> BoundaryChannelAggregates:
    result_dtype = np.int64 if weights is None else np.float64
    results = [
        np.zeros(index.num_boundaries, dtype=result_dtype)
        for _ in channels
    ]

    if isinstance(index, ExclusiveBoundaryIndex):
        owners = index.flat
        claimed = owners >= 0
        for result, channel in zip(results, channels):
            active = claimed & valid & channel
            active_owners = owners[active]
            if weights is None:
                result += np.bincount(
                    active_owners,
                    minlength=index.num_boundaries,
                )
            else:
                result += np.bincount(
                    active_owners,
                    weights=weights[active],
                    minlength=index.num_boundaries,
                )
    else:
        for claim_start in range(0, index.total_claims, _AGGREGATION_CLAIM_CHUNK):
            claim_stop = min(
                claim_start + _AGGREGATION_CLAIM_CHUNK,
                index.total_claims,
            )
            claim_positions = np.arange(claim_start, claim_stop, dtype=np.int64)
            pixels = (
                np.searchsorted(index.offsets, claim_positions, side="right") - 1
            )
            owners = index.boundary_indices[claim_start:claim_stop]
            claim_valid = valid[pixels]
            for result, channel in zip(results, channels):
                active = claim_valid & channel[pixels]
                active_owners = owners[active]
                if weights is None:
                    result += np.bincount(
                        active_owners,
                        minlength=index.num_boundaries,
                    )
                else:
                    result += np.bincount(
                        active_owners,
                        weights=weights[pixels[active]],
                        minlength=index.num_boundaries,
                    )

    return BoundaryChannelAggregates(*results)


def aggregate_boundary_counts(
    index: AnyBoundaryIndex,
    *,
    total: np.ndarray,
    selected: np.ndarray,
    pre_existing: np.ndarray,
    new_prioritizr: np.ndarray,
    valid_mask: np.ndarray | None = None,
) -> BoundaryChannelAggregates:
    """Count each channel independently for every boundary owner.

    A cell with multiple owners contributes one whole integer count to each
    owner. No multiplicity normalization is applied. ``valid_mask`` can remove
    nodata cells consistently from all four channels.
    """

    channels = _prepared_channels(
        index,
        total=total,
        selected=selected,
        pre_existing=pre_existing,
        new_prioritizr=new_prioritizr,
    )
    valid = (
        np.ones(index.num_pixels, dtype=np.bool_)
        if valid_mask is None
        else _flat_bool_values(valid_mask, index, label="valid_mask")
    )
    return _aggregate_boundary_channels(index, channels, valid, None)


def aggregate_boundary_weighted_sums(
    index: AnyBoundaryIndex,
    weights: np.ndarray,
    *,
    total: np.ndarray,
    selected: np.ndarray,
    pre_existing: np.ndarray,
    new_prioritizr: np.ndarray,
    valid_mask: np.ndarray | None = None,
) -> BoundaryChannelAggregates:
    """Sum float64 weights independently for every boundary owner and channel.

    Non-finite weights and cells excluded by ``valid_mask`` contribute nothing.
    Overlapping cells contribute their full weight to every owner; there is no
    multiplicity normalization. Reduction follows deterministic CSR claim and
    boundary order for a fixed index. As with any floating-point reduction,
    results from a differently ordered scalar implementation may vary by a few
    least-significant bits and should be compared with a numeric tolerance.
    """

    flat_weights = _flat_float64_values(weights, index, label="weights")
    valid = np.isfinite(flat_weights)
    if valid_mask is not None:
        valid &= _flat_bool_values(valid_mask, index, label="valid_mask")
    channels = _prepared_channels(
        index,
        total=total,
        selected=selected,
        pre_existing=pre_existing,
        new_prioritizr=new_prioritizr,
    )
    return _aggregate_boundary_channels(
        index,
        channels,
        valid,
        flat_weights,
    )


def aggregate_sparse_boundary_weighted_sums(
    index: AnyBoundaryIndex,
    pixel_indices: np.ndarray,
    weights: np.ndarray,
    *,
    selected: np.ndarray,
    pre_existing: np.ndarray,
    new_prioritizr: np.ndarray,
) -> BoundaryChannelAggregates:
    """Validate sparse vectors, then fan them into every boundary owner."""

    prepared = prepare_sparse_boundary_weighted_channels(
        pixel_indices,
        weights,
        selected=selected,
        pre_existing=pre_existing,
        new_prioritizr=new_prioritizr,
        num_pixels=index.num_pixels,
    )
    return aggregate_prepared_sparse_boundary_weighted_sums(index, prepared)


def prepare_sparse_boundary_weighted_channels(
    pixel_indices: np.ndarray,
    weights: np.ndarray,
    *,
    selected: np.ndarray,
    pre_existing: np.ndarray,
    new_prioritizr: np.ndarray,
    num_pixels: int,
) -> SparseBoundaryWeightedChannels:
    """Normalize one species's sparse vectors once for all boundary levels."""

    pixels = np.asarray(pixel_indices, dtype=np.int64).ravel()
    sparse_weights = np.asarray(weights, dtype=np.float64).ravel()
    if pixels.size != sparse_weights.size:
        raise BoundaryTopologyError(
            "Sparse pixel_indices and weights must have the same length."
        )
    if np.any((pixels < 0) | (pixels >= num_pixels)):
        raise BoundaryTopologyError("Sparse pixel_indices contain an out-of-range cell.")

    selectors = tuple(
        np.asarray(selector, dtype=np.bool_).ravel()
        for selector in (selected, pre_existing, new_prioritizr)
    )
    if any(selector.size != pixels.size for selector in selectors):
        raise BoundaryTopologyError(
            "Sparse channel selectors must match pixel_indices length."
        )
    finite = np.isfinite(sparse_weights)
    return SparseBoundaryWeightedChannels(
        pixel_indices=pixels,
        weights=sparse_weights,
        finite=finite,
        all_finite=bool(finite.all()),
        selected=selectors[0],
        pre_existing=selectors[1],
        new_prioritizr=selectors[2],
    )


def aggregate_prepared_sparse_boundary_weighted_sums(
    index: AnyBoundaryIndex,
    prepared: SparseBoundaryWeightedChannels,
) -> BoundaryChannelAggregates:
    """Use one primary owner per sparse cell and expand overlap extras only.

    Exclusive indexes are a direct O(range-cells) lookup. For CSR indexes, the
    first owner in each claimed pixel segment is the primary path; only segment
    tails for multiplicity greater than one are expanded. This preserves every
    independent owner without repeating ordinary one-owner claims.
    """

    pixels = prepared.pixel_indices
    if pixels.size and int(pixels.max()) >= index.num_pixels:
        raise BoundaryTopologyError(
            "Prepared sparse pixel_indices do not match the boundary index grid."
        )
    results = [
        np.zeros(index.num_boundaries, dtype=np.float64)
        for _ in range(4)
    ]
    if isinstance(index, ExclusiveBoundaryIndex):
        owners = index.flat[pixels]
        source_positions = np.flatnonzero(owners >= 0)
        _accumulate_sparse_claims(
            results,
            owners[source_positions],
            source_positions,
            prepared,
            index.num_boundaries,
        )
    else:
        starts = index.offsets[pixels]
        stops = index.offsets[pixels + 1]
        multiplicities = stops - starts
        primary_positions = np.flatnonzero(multiplicities > 0)
        _accumulate_sparse_claims(
            results,
            index.boundary_indices[starts[primary_positions]],
            primary_positions,
            prepared,
            index.num_boundaries,
        )

        overlap_positions = np.flatnonzero(multiplicities > 1)
        if overlap_positions.size:
            extra_counts = multiplicities[overlap_positions] - 1
            extra_source_positions = np.repeat(overlap_positions, extra_counts)
            group_starts = (
                np.cumsum(extra_counts, dtype=np.int64) - extra_counts
            )
            extra_claim_positions = (
                np.repeat(starts[overlap_positions] + 1, extra_counts)
                + np.arange(extra_source_positions.size, dtype=np.int64)
                - np.repeat(group_starts, extra_counts)
            )
            _accumulate_sparse_claims(
                results,
                index.boundary_indices[extra_claim_positions],
                extra_source_positions,
                prepared,
                index.num_boundaries,
            )
    return BoundaryChannelAggregates(*results)


def _accumulate_sparse_claims(
    results: list[np.ndarray],
    owners: np.ndarray,
    source_positions: np.ndarray,
    prepared: SparseBoundaryWeightedChannels,
    num_boundaries: int,
) -> None:
    """Accumulate one compact claim vector into all four channels."""

    if source_positions.size == 0:
        return
    selectors = (
        None,
        prepared.selected,
        prepared.pre_existing,
        prepared.new_prioritizr,
    )
    for result, selector in zip(results, selectors):
        if selector is None and prepared.all_finite:
            result += np.bincount(
                owners,
                weights=prepared.weights[source_positions],
                minlength=num_boundaries,
            )
            continue
        active = (
            prepared.finite[source_positions]
            if selector is None
            else selector[source_positions]
        )
        if not prepared.all_finite:
            active &= prepared.finite[source_positions]
        if active.any():
            result += np.bincount(
                owners[active],
                weights=prepared.weights[source_positions[active]],
                minlength=num_boundaries,
            )


def boundary_indices_for_pixel(
    index: AnyBoundaryIndex,
    pixel_index: int,
) -> np.ndarray:
    """Return every boundary index claiming one flat pixel."""

    if pixel_index < 0 or pixel_index >= index.num_pixels:
        raise IndexError(f"Pixel index {pixel_index} is out of range.")
    if isinstance(index, ExclusiveBoundaryIndex):
        boundary_index = int(index.flat[pixel_index])
        if boundary_index < 0:
            return np.empty(0, dtype=np.int32)
        return np.asarray([boundary_index], dtype=np.int32)

    start = int(index.offsets[pixel_index])
    stop = int(index.offsets[pixel_index + 1])
    return index.boundary_indices[start:stop]
