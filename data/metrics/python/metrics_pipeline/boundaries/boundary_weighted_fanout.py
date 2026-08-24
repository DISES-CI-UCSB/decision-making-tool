"""Guarded grouped fan-out for additive non-species weighted metrics.

``main.py`` integrates this path only for the explicit ``grouped-weighted-v1``
opt-in, with grouped boundary fan-out also required. Scalar weighted execution
remains the default. The grouped path reuses immutable, identity-bound weighted
layers and accumulates selected values through every owner in the approved
overlap-safe boundary topology.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from types import MappingProxyType
from typing import Any, Literal, TypeAlias

import numpy as np

from boundaries.boundary_topology import (
    AnyBoundaryIndex,
    BoundaryTopologyError,
    ExclusiveBoundaryIndex,
    OverlapBoundaryIndex,
)

WeightedMetricKind: TypeAlias = Literal[
    "weighted_sum",
    "weighted_percent_of_national",
]
WeightedExecutionMode: TypeAlias = Literal["scalar", "grouped-weighted-v1"]
CancelCheck: TypeAlias = Callable[[], bool]

SCALAR_WEIGHTED_ALGORITHM_VERSION = "scalar-weighted-boundary-v1"
WEIGHTED_LAYER_PREPARATION_ALGORITHM_VERSION = "weighted-layer-area-normalized-v2"
WEIGHTED_BOUNDARY_FANOUT_ALGORITHM_VERSION = "grouped-weighted-boundary-fanout-v2"
WEIGHTED_METRIC_REGISTRY_POLICY_VERSION = "weighted-additive-registry-v1"
NODATA_NORMALIZATION_POLICY = "declared-sentinel-and-nonfinite-to-invalid-v1"
_REDUCTION_CHUNK_CELLS = 262_144

# This is deliberately narrower than the metric catalog. Both the metric ID and
# its exact layer/kind/unit tuple must match before prototype output is assembled.
APPROVED_WEIGHTED_METRICS: Mapping[str, tuple[str, WeightedMetricKind, str]] = (
    MappingProxyType(
        {
            "carbon_storage_biomass": ("biomasa", "weighted_sum", "Mg·km²"),
            "carbon_biomass_total": ("biomasa", "weighted_sum", "Mg·km²"),
            "soil_organic_carbon": (
                "carbono_organico",
                "weighted_sum",
                "Mg·km²",
            ),
            "carbon_pct_of_national": (
                "biomasa",
                "weighted_percent_of_national",
                "%",
            ),
        }
    )
)


def weighted_execution_identity(mode: str) -> dict[str, Any]:
    """Return the fail-closed execution identity persisted in every artifact."""

    if mode not in {"scalar", "grouped-weighted-v1"}:
        raise WeightedFanoutError(f"Unsupported weighted execution mode: {mode!r}.")
    algorithm = (
        WEIGHTED_BOUNDARY_FANOUT_ALGORITHM_VERSION
        if mode == "grouped-weighted-v1"
        else SCALAR_WEIGHTED_ALGORITHM_VERSION
    )
    allowlist = [
        {
            "metricId": metric_id,
            "layerId": layer_id,
            "kind": kind,
            "unit": unit,
        }
        for metric_id, (layer_id, kind, unit) in sorted(
            APPROVED_WEIGHTED_METRICS.items()
        )
    ]
    return {
        "requestedMode": mode,
        "effectiveMode": mode,
        "algorithmVersion": algorithm,
        "preparationAlgorithmVersion": (
            WEIGHTED_LAYER_PREPARATION_ALGORITHM_VERSION
            if mode == "grouped-weighted-v1"
            else None
        ),
        "registryPolicyVersion": WEIGHTED_METRIC_REGISTRY_POLICY_VERSION,
        "allowlistSha256": _canonical_sha256(allowlist),
    }


def approved_weighted_specs(
    definitions: tuple[Any, ...],
) -> tuple[WeightedMetricSpec, ...]:
    """Validate the complete runtime weighted registry before grouped routing."""

    weighted = tuple(
        definition
        for definition in definitions
        if definition.kind in {"weighted_sum", "weighted_percent_of_national"}
    )
    metric_ids = tuple(definition.metric_id for definition in weighted)
    metric_layer_pairs = tuple(
        (definition.metric_id, definition.layer_id) for definition in weighted
    )
    if (
        len(weighted) != len(APPROVED_WEIGHTED_METRICS)
        or len(set(metric_ids)) != len(metric_ids)
        or len(set(metric_layer_pairs)) != len(metric_layer_pairs)
    ):
        raise WeightedFanoutError(
            "Runtime weighted metric registry cardinality is invalid; duplicate "
            "metric IDs or metric/layer tuples fail closed before allowlist mapping."
        )
    observed = {
        definition.metric_id: (
            definition.layer_id,
            definition.kind,
            definition.unit,
        )
        for definition in weighted
    }
    expected = dict(APPROVED_WEIGHTED_METRICS)
    if observed != expected:
        raise WeightedFanoutError(
            "Runtime weighted metric registry does not exactly match the approved "
            f"{WEIGHTED_METRIC_REGISTRY_POLICY_VERSION} allowlist."
        )
    return tuple(
        WeightedMetricSpec(
            metric_id=definition.metric_id,
            layer_id=definition.layer_id,
            kind=definition.kind,
            unit=definition.unit,
        )
        for definition in weighted
    )


class WeightedFanoutError(BoundaryTopologyError):
    """Raised when weighted fan-out inputs fail closed."""


class WeightedFanoutCancelled(WeightedFanoutError):
    """Raised before publishing a partial cancelled result."""


@dataclass(frozen=True)
class WeightedLayerIdentity:
    """Complete immutable identity for one aligned numeric layer."""

    layer_id: str
    source_url: str
    source_sha256: str
    source_provenance_sha256: str
    aligned_url: str
    aligned_sha256: str
    aligned_provenance_sha256: str
    target_grid_sha256: str
    target_fingerprint_sha256: str
    target_shape: tuple[int, int]
    alignment_policy_sha256: str
    nodata_value: str
    nodata_interpretation_policy: str
    normalization_policy: str
    pixel_area_rows_sha256: str
    preparation_algorithm_version: str
    weighted_fanout_algorithm_version: str
    aligned_dtype: str
    value_units: str
    metric_registry_policy_version: str

    def as_provenance(self) -> dict[str, Any]:
        """Return the complete future-integration signature in canonical fields."""

        return {
            "layerId": self.layer_id,
            "sourceUrl": self.source_url,
            "sourceSha256": self.source_sha256,
            "sourceProvenanceSha256": self.source_provenance_sha256,
            "alignedUrl": self.aligned_url,
            "alignedSha256": self.aligned_sha256,
            "alignedProvenanceSha256": self.aligned_provenance_sha256,
            "targetGridSha256": self.target_grid_sha256,
            "targetFingerprintSha256": self.target_fingerprint_sha256,
            "targetShape": list(self.target_shape),
            "alignmentPolicySha256": self.alignment_policy_sha256,
            "nodataValue": self.nodata_value,
            "nodataInterpretationPolicy": self.nodata_interpretation_policy,
            "normalizationPolicy": self.normalization_policy,
            "pixelAreaRowsSha256": self.pixel_area_rows_sha256,
            "preparationAlgorithmVersion": self.preparation_algorithm_version,
            "weightedFanoutAlgorithmVersion": self.weighted_fanout_algorithm_version,
            "alignedDtype": self.aligned_dtype,
            "valueUnits": self.value_units,
            "metricRegistryPolicyVersion": self.metric_registry_policy_version,
        }

    @property
    def signature_sha256(self) -> str:
        return _canonical_sha256(self.as_provenance())


@dataclass(frozen=True)
class PreparedWeightedLayer:
    """Finite, area-weighted values and a reusable national denominator."""

    identity: WeightedLayerIdentity
    weighted_values: np.ndarray
    finite_mask: np.ndarray
    national_denominator: float

    @property
    def num_pixels(self) -> int:
        return int(self.weighted_values.size)

    @property
    def estimated_bytes(self) -> int:
        return int(self.weighted_values.nbytes + self.finite_mask.nbytes)


@dataclass(frozen=True)
class WeightedMetricSpec:
    metric_id: str
    layer_id: str
    kind: WeightedMetricKind
    unit: str


@dataclass(frozen=True)
class WeightedMetricResult:
    value: float | None
    status: Literal["ready", "blocked"]


@dataclass(frozen=True)
class WeightedFanoutDiagnostics:
    selected_cell_count: int
    primary_claim_count_by_level: Mapping[str, int]
    extra_claim_count_by_level: Mapping[str, int]
    layer_count: int


@dataclass(frozen=True)
class WeightedFanoutResult:
    """Per-layer, per-level selected weighted sums in source boundary order."""

    sums: Mapping[str, Mapping[str, np.ndarray]]
    diagnostics: WeightedFanoutDiagnostics


class ImmutableWeightedLayerCache:
    """Reuse prepared arrays only when every alignment signature is identical."""

    def __init__(self) -> None:
        self._layers: dict[str, PreparedWeightedLayer] = {}
        self.hits = 0
        self.misses = 0

    @property
    def estimated_bytes(self) -> int:
        return sum(layer.estimated_bytes for layer in self._layers.values())

    @property
    def entry_count(self) -> int:
        return len(self._layers)

    def get_or_prepare(
        self,
        identity: WeightedLayerIdentity,
        *,
        shape: tuple[int, int],
        pixel_area_km2_per_row: np.ndarray,
        loader: Callable[[], np.ndarray],
        cancel_check: CancelCheck | None = None,
    ) -> tuple[PreparedWeightedLayer, bool]:
        """Load once, fail on logical-key drift, and never cache partial failures."""

        _validate_preparation_call(
            identity,
            shape=shape,
            pixel_area_km2_per_row=pixel_area_km2_per_row,
        )
        _check_cancel(cancel_check)
        key = identity.layer_id
        cached = self._layers.get(key)
        if cached is not None:
            if cached.identity != identity:
                raise WeightedFanoutError(
                    f"Weighted layer signature drift for {identity.layer_id!r} "
                    f"on grid {identity.target_grid_sha256}."
                )
            _check_cancel(cancel_check)
            self.hits += 1
            return cached, True

        loaded = np.asarray(loader())
        _check_cancel(cancel_check)
        if loaded.shape != shape:
            raise WeightedFanoutError(
                f"Weighted layer {identity.layer_id!r} has shape {loaded.shape}; "
                f"expected {shape}."
            )
        if loaded.dtype.name != identity.aligned_dtype:
            raise WeightedFanoutError(
                f"Weighted layer {identity.layer_id!r} dtype is {loaded.dtype.name!r}; "
                f"expected {identity.aligned_dtype!r}."
            )
        values = loaded.astype(np.float64, copy=False)
        row_areas = np.asarray(pixel_area_km2_per_row, dtype=np.float64)

        finite = _valid_value_mask(values, identity.nodata_value)
        weighted = np.zeros(shape, dtype=np.float64)
        flat_values = values.ravel()
        flat_finite = finite.ravel()
        flat_weighted = weighted.ravel()
        repeated_areas = np.broadcast_to(
            row_areas[:, np.newaxis], shape
        ).ravel()
        denominator = 0.0
        for start in range(0, flat_values.size, _REDUCTION_CHUNK_CELLS):
            _check_cancel(cancel_check)
            stop = min(start + _REDUCTION_CHUNK_CELLS, flat_values.size)
            chunk_valid = flat_finite[start:stop]
            np.multiply(
                flat_values[start:stop],
                repeated_areas[start:stop],
                out=flat_weighted[start:stop],
                where=chunk_valid,
            )
            with np.errstate(over="ignore", invalid="ignore"):
                denominator += float(
                    flat_weighted[start:stop][chunk_valid].sum(dtype=np.float64)
                )
            if not np.isfinite(denominator):
                raise WeightedFanoutError(
                    f"Weighted layer {identity.layer_id!r} has a non-finite "
                    "national denominator."
                )
        weighted.flags.writeable = False
        finite.flags.writeable = False
        prepared = PreparedWeightedLayer(
            identity=identity,
            weighted_values=weighted.ravel(),
            finite_mask=finite.ravel(),
            national_denominator=denominator,
        )
        _check_cancel(cancel_check)
        self._layers[key] = prepared
        self.misses += 1
        return prepared, False


def aggregate_selected_weighted_layers(
    indexes: Mapping[str, AnyBoundaryIndex],
    selected_mask: np.ndarray,
    layers: Mapping[str, PreparedWeightedLayer],
    *,
    cancel_check: CancelCheck | None = None,
) -> WeightedFanoutResult:
    """Aggregate each additive layer through primary and extra owners.

    Selected pixels are visited in ascending flat-index order.  CSR's first
    owner is accumulated as the primary claim; all remaining owners are then
    accumulated as full, non-normalized overlap corrections.
    """

    if not indexes:
        raise WeightedFanoutError("Weighted fan-out requires boundary indexes.")
    if not layers:
        raise WeightedFanoutError("Weighted fan-out requires weighted layers.")
    num_pixels = next(iter(indexes.values())).num_pixels
    if any(index.num_pixels != num_pixels for index in indexes.values()):
        raise WeightedFanoutError("Boundary topology levels use different grids.")
    selected = np.asarray(selected_mask, dtype=np.bool_).ravel()
    if selected.size != num_pixels:
        raise WeightedFanoutError(
            f"Selected mask has {selected.size} cells; expected {num_pixels}."
        )
    if any(layer.num_pixels != num_pixels for layer in layers.values()):
        raise WeightedFanoutError("Weighted layers do not match the topology grid.")

    pixels = np.flatnonzero(selected)
    primary_counts: dict[str, int] = {}
    extra_counts: dict[str, int] = {}
    output: dict[str, dict[str, np.ndarray]] = {layer_id: {} for layer_id in layers}
    try:
        for level, index in indexes.items():
            _check_cancel(cancel_check)
            primary_owners, primary_sources, extra_owners, extra_sources = (
                _selected_owner_claims(
                    index,
                    pixels,
                    cancel_check=cancel_check,
                )
            )
            primary_counts[level] = int(primary_sources.size)
            extra_counts[level] = int(extra_sources.size)
            for layer_id, layer in layers.items():
                sums = _accumulate_layer_claims(
                    index.num_boundaries,
                    layer,
                    pixels,
                    primary_owners,
                    primary_sources,
                    extra_owners,
                    extra_sources,
                    cancel_check=cancel_check,
                )
                sums.flags.writeable = False
                output[layer_id][level] = sums

        _check_cancel(cancel_check)
    except WeightedFanoutCancelled:
        for levels in output.values():
            levels.clear()
        output.clear()
        primary_counts.clear()
        extra_counts.clear()
        raise
    return WeightedFanoutResult(
        sums=MappingProxyType(
            {
                layer_id: MappingProxyType(dict(levels))
                for layer_id, levels in output.items()
            }
        ),
        diagnostics=WeightedFanoutDiagnostics(
            selected_cell_count=int(pixels.size),
            primary_claim_count_by_level=MappingProxyType(primary_counts),
            extra_claim_count_by_level=MappingProxyType(extra_counts),
            layer_count=len(layers),
        ),
    )


def assemble_weighted_metric_results(
    specs: tuple[WeightedMetricSpec, ...],
    *,
    level: str,
    boundary_index: int,
    fanout: WeightedFanoutResult,
    layers: Mapping[str, PreparedWeightedLayer],
    cancel_check: CancelCheck | None = None,
) -> dict[str, WeightedMetricResult]:
    """Apply unchanged weighted-sum and national-percent formulas."""

    results: dict[str, WeightedMetricResult] = {}
    for spec in specs:
        _check_cancel(cancel_check)
        _validate_metric_spec(spec, layers)
        try:
            selected_sum = float(fanout.sums[spec.layer_id][level][boundary_index])
            layer = layers[spec.layer_id]
        except (KeyError, IndexError) as exc:
            raise WeightedFanoutError(
                f"Missing weighted result for {spec.metric_id!r}."
            ) from exc
        if spec.kind == "weighted_sum":
            results[spec.metric_id] = WeightedMetricResult(selected_sum, "ready")
            continue
        if spec.kind != "weighted_percent_of_national":
            raise WeightedFanoutError(
                f"Unsupported weighted metric kind: {spec.kind!r}."
            )
        denominator = layer.national_denominator
        if not np.isfinite(denominator):
            raise WeightedFanoutError(
                f"National denominator for {spec.layer_id!r} is non-finite."
            )
        results[spec.metric_id] = (
            WeightedMetricResult(None, "blocked")
            if denominator == 0.0
            else WeightedMetricResult((selected_sum / denominator) * 100.0, "ready")
        )
    _check_cancel(cancel_check)
    return results


def _selected_owner_claims(
    index: AnyBoundaryIndex,
    pixels: np.ndarray,
    *,
    cancel_check: CancelCheck | None,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    if isinstance(index, ExclusiveBoundaryIndex):
        primary_count = 0
        for start in range(0, pixels.size, _REDUCTION_CHUNK_CELLS):
            _check_cancel(cancel_check)
            stop = min(start + _REDUCTION_CHUNK_CELLS, pixels.size)
            primary_count += int(np.count_nonzero(index.flat[pixels[start:stop]] >= 0))
        _check_cancel(cancel_check)
        primary_owners = np.empty(primary_count, dtype=np.int32)
        primary_sources = np.empty(primary_count, dtype=np.int64)
        write = 0
        for start in range(0, pixels.size, _REDUCTION_CHUNK_CELLS):
            _check_cancel(cancel_check)
            stop = min(start + _REDUCTION_CHUNK_CELLS, pixels.size)
            chunk_owners = index.flat[pixels[start:stop]]
            active = np.flatnonzero(chunk_owners >= 0)
            next_write = write + active.size
            primary_owners[write:next_write] = chunk_owners[active]
            primary_sources[write:next_write] = active + start
            write = next_write
        _check_cancel(cancel_check)
        return (
            primary_owners,
            primary_sources,
            np.empty(0, dtype=np.int32),
            np.empty(0, dtype=np.int64),
        )
    if not isinstance(index, OverlapBoundaryIndex):
        raise WeightedFanoutError(f"Unsupported topology index: {type(index)!r}")

    primary_count = 0
    for start in range(0, pixels.size, _REDUCTION_CHUNK_CELLS):
        _check_cancel(cancel_check)
        stop = min(start + _REDUCTION_CHUNK_CELLS, pixels.size)
        chunk_pixels = pixels[start:stop]
        multiplicities = (
            index.offsets[chunk_pixels + 1] - index.offsets[chunk_pixels]
        )
        primary_count += int(np.count_nonzero(multiplicities > 0))

    extra_count = 0
    for start in range(0, pixels.size, _REDUCTION_CHUNK_CELLS):
        _check_cancel(cancel_check)
        stop = min(start + _REDUCTION_CHUNK_CELLS, pixels.size)
        chunk_pixels = pixels[start:stop]
        multiplicities = (
            index.offsets[chunk_pixels + 1] - index.offsets[chunk_pixels]
        )
        extra_count += int(
            np.maximum(multiplicities - 1, 0).sum(dtype=np.int64)
        )

    _check_cancel(cancel_check)
    primary_owners = np.empty(primary_count, dtype=np.int32)
    primary_sources = np.empty(primary_count, dtype=np.int64)
    extra_owners = np.empty(extra_count, dtype=np.int32)
    extra_sources = np.empty(extra_count, dtype=np.int64)

    primary_write = 0
    for start in range(0, pixels.size, _REDUCTION_CHUNK_CELLS):
        _check_cancel(cancel_check)
        stop = min(start + _REDUCTION_CHUNK_CELLS, pixels.size)
        chunk_pixels = pixels[start:stop]
        claim_starts = index.offsets[chunk_pixels]
        multiplicities = index.offsets[chunk_pixels + 1] - claim_starts
        active = np.flatnonzero(multiplicities > 0)
        next_write = primary_write + active.size
        primary_sources[primary_write:next_write] = active + start
        primary_owners[primary_write:next_write] = index.boundary_indices[
            claim_starts[active]
        ]
        primary_write = next_write

    extra_write = 0
    for start in range(0, pixels.size, _REDUCTION_CHUNK_CELLS):
        _check_cancel(cancel_check)
        stop = min(start + _REDUCTION_CHUNK_CELLS, pixels.size)
        chunk_pixels = pixels[start:stop]
        claim_starts = index.offsets[chunk_pixels]
        claim_stops = index.offsets[chunk_pixels + 1]
        overlap_sources = np.flatnonzero(claim_stops - claim_starts > 1)
        for source in overlap_sources:
            claim_start = int(claim_starts[source]) + 1
            claim_stop = int(claim_stops[source])
            source_offset = int(source) + start
            while claim_start < claim_stop:
                _check_cancel(cancel_check)
                bounded_stop = min(
                    claim_start + _REDUCTION_CHUNK_CELLS,
                    claim_stop,
                )
                claim_count = bounded_stop - claim_start
                next_write = extra_write + claim_count
                extra_owners[extra_write:next_write] = index.boundary_indices[
                    claim_start:bounded_stop
                ]
                extra_sources[extra_write:next_write] = source_offset
                extra_write = next_write
                claim_start = bounded_stop

    _check_cancel(cancel_check)
    return primary_owners, primary_sources, extra_owners, extra_sources


def _accumulate_layer_claims(
    num_boundaries: int,
    layer: PreparedWeightedLayer,
    pixels: np.ndarray,
    primary_owners: np.ndarray,
    primary_sources: np.ndarray,
    extra_owners: np.ndarray,
    extra_sources: np.ndarray,
    *,
    cancel_check: CancelCheck | None,
) -> np.ndarray:
    result = np.zeros(num_boundaries, dtype=np.float64)
    selected_weights = layer.weighted_values[pixels]
    selected_finite = layer.finite_mask[pixels]
    _add_claims(
        result,
        primary_owners,
        primary_sources,
        selected_weights,
        selected_finite,
        num_boundaries,
        cancel_check=cancel_check,
    )
    _add_claims(
        result,
        extra_owners,
        extra_sources,
        selected_weights,
        selected_finite,
        num_boundaries,
        cancel_check=cancel_check,
    )
    return result


def _add_claims(
    result: np.ndarray,
    owners: np.ndarray,
    sources: np.ndarray,
    weights: np.ndarray,
    finite: np.ndarray,
    num_boundaries: int,
    *,
    cancel_check: CancelCheck | None,
) -> None:
    if not sources.size:
        return
    for start in range(0, sources.size, _REDUCTION_CHUNK_CELLS):
        _check_cancel(cancel_check)
        stop = min(start + _REDUCTION_CHUNK_CELLS, sources.size)
        chunk_sources = sources[start:stop]
        active = finite[chunk_sources]
        if active.any():
            result += np.bincount(
                owners[start:stop][active],
                weights=weights[chunk_sources[active]],
                minlength=num_boundaries,
            )


def pixel_area_rows_sha256(pixel_area_km2_per_row: np.ndarray) -> str:
    rows = np.ascontiguousarray(pixel_area_km2_per_row, dtype="<f8")
    digest = hashlib.sha256()
    digest.update(str(rows.shape).encode())
    digest.update(rows.tobytes())
    return digest.hexdigest()


def canonical_nodata_value(value: float | None) -> str:
    if value is None:
        return "none"
    numeric = float(value)
    if np.isnan(numeric):
        return "nan"
    if np.isposinf(numeric):
        return "+inf"
    if np.isneginf(numeric):
        return "-inf"
    return numeric.hex()


def _validate_preparation_call(
    identity: WeightedLayerIdentity,
    *,
    shape: tuple[int, int],
    pixel_area_km2_per_row: np.ndarray,
) -> None:
    if identity.preparation_algorithm_version != (
        WEIGHTED_LAYER_PREPARATION_ALGORITHM_VERSION
    ):
        raise WeightedFanoutError("Weighted preparation algorithm version drift.")
    if identity.weighted_fanout_algorithm_version != (
        WEIGHTED_BOUNDARY_FANOUT_ALGORITHM_VERSION
    ):
        raise WeightedFanoutError("Weighted fan-out algorithm version drift.")
    if identity.metric_registry_policy_version != WEIGHTED_METRIC_REGISTRY_POLICY_VERSION:
        raise WeightedFanoutError("Weighted metric registry policy drift.")
    if identity.normalization_policy != NODATA_NORMALIZATION_POLICY:
        raise WeightedFanoutError("Weighted nodata normalization policy drift.")
    if shape != identity.target_shape:
        raise WeightedFanoutError(
            f"Call shape {shape} does not match identity shape {identity.target_shape}."
        )
    rows = np.asarray(pixel_area_km2_per_row, dtype=np.float64)
    if (
        rows.shape != (shape[0],)
        or not np.isfinite(rows).all()
        or np.any(rows <= 0.0)
    ):
        raise WeightedFanoutError(
            "Pixel-area rows must be positive, finite, and match the target height."
        )
    if pixel_area_rows_sha256(rows) != identity.pixel_area_rows_sha256:
        raise WeightedFanoutError("Pixel-area row checksum drift.")
    if not identity.layer_id or not identity.source_url or not identity.aligned_url:
        raise WeightedFanoutError("Weighted identity URLs and layer ID are required.")
    for field_name in (
        "source_sha256",
        "source_provenance_sha256",
        "aligned_sha256",
        "aligned_provenance_sha256",
        "target_grid_sha256",
        "target_fingerprint_sha256",
        "alignment_policy_sha256",
        "pixel_area_rows_sha256",
    ):
        value = getattr(identity, field_name)
        if len(value) != 64 or any(char not in "0123456789abcdef" for char in value):
            raise WeightedFanoutError(f"Invalid SHA-256 identity field {field_name}.")


def _valid_value_mask(values: np.ndarray, nodata_value: str) -> np.ndarray:
    finite = np.isfinite(values)
    if nodata_value in {"none", "nan", "+inf", "-inf"}:
        return finite
    try:
        sentinel = float.fromhex(nodata_value)
    except ValueError as exc:
        raise WeightedFanoutError(
            f"Invalid canonical nodata value: {nodata_value!r}."
        ) from exc
    return finite & (values != sentinel)


def _validate_metric_spec(
    spec: WeightedMetricSpec,
    layers: Mapping[str, PreparedWeightedLayer],
) -> None:
    approved = APPROVED_WEIGHTED_METRICS.get(spec.metric_id)
    observed = (spec.layer_id, spec.kind, spec.unit)
    if approved is None or observed != approved:
        raise WeightedFanoutError(
            f"Weighted metric {spec.metric_id!r} is not approved for "
            f"{observed!r} under {WEIGHTED_METRIC_REGISTRY_POLICY_VERSION}."
        )
    layer = layers.get(spec.layer_id)
    if layer is None:
        raise WeightedFanoutError(f"Approved layer {spec.layer_id!r} is unavailable.")
    if (
        layer.identity.layer_id != spec.layer_id
        or (
            spec.kind == "weighted_sum"
            and layer.identity.value_units != spec.unit
        )
        or layer.identity.metric_registry_policy_version
        != WEIGHTED_METRIC_REGISTRY_POLICY_VERSION
    ):
        raise WeightedFanoutError(
            f"Weighted layer identity does not match approved metric {spec.metric_id!r}."
        )


def _canonical_sha256(value: Any) -> str:
    encoded = json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode()
    return hashlib.sha256(encoded).hexdigest()


def _check_cancel(cancel_check: CancelCheck | None) -> None:
    if cancel_check is not None and cancel_check():
        raise WeightedFanoutCancelled("Weighted fan-out was cancelled.")
