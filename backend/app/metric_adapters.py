from __future__ import annotations

import gzip
import json
import os
import struct
import sys
from dataclasses import replace
from pathlib import Path
from typing import Any, Sequence

import numpy as np

from .artifacts import RuntimeRasterLayer, RuntimeSpeciesMatrix


def _install_metrics_pipeline_path() -> Path:
    """Make the tracked metrics pipeline importable from backend code."""
    candidates: list[Path] = []
    configured_path = os.getenv("DMT_METRICS_PIPELINE_PATH")
    if configured_path:
        candidates.append(Path(configured_path))

    repo_root = Path(__file__).resolve().parents[2]
    candidates.append(repo_root / "data" / "metrics" / "python" / "metrics_pipeline")

    for candidate in candidates:
        if (candidate / "calculators" / "area.py").exists():
            candidate_text = str(candidate)
            if candidate_text not in sys.path:
                sys.path.insert(0, candidate_text)
            return candidate

    searched = ", ".join(str(path) for path in candidates)
    raise RuntimeError(f"Unable to locate metrics pipeline source. Searched: {searched}")


METRICS_PIPELINE_PATH = _install_metrics_pipeline_path()

from boundaries.boundary_mask import DEFAULT_BOUNDARY_CRS, rasterize_boundary  # noqa: E402
from calculators import area as calc_area  # noqa: E402
from calculators import carbon as calc_carbon  # noqa: E402
from calculators import ecosystem_coverage as calc_ecosystem  # noqa: E402
from calculators import land_cover as calc_land_cover  # noqa: E402
from calculators import protected_areas as calc_protected  # noqa: E402
from calculators import social_governance as calc_social  # noqa: E402
from calculators import water as calc_water  # noqa: E402
from metric_definitions import METRIC_CATALOG, MetricDefinition  # noqa: E402
from raster_metrics import (  # noqa: E402
    RasterError,
    RasterFingerprint,
    SolutionRaster,
    read_layer_mask,
    read_layer_values,
    read_reference_raster,
    read_solution_raster,
)
from sparse.format import SMSP_MAGIC, SparseFormatError, SparseMetadata  # noqa: E402
from species_data import CLASS_BUCKETS  # noqa: E402

from .species_index import (  # noqa: E402
    RuntimeSpeciesBitsetIndex,
    RuntimeSpeciesIndex,
    SpeciesIndexQueryError,
)

RuntimeSpeciesQueryIndex = RuntimeSpeciesIndex | RuntimeSpeciesBitsetIndex

AREA_METRIC_IDS = ("national_contribution", "priority_area_in_region")
AREA_ALIAS = "area"
_DUMMY_PATH = Path("/virtual/backend-shared-solution-raster")

METRIC_DEFINITIONS_BY_ID: dict[str, MetricDefinition] = {
    metric.metric_id: metric for metric in METRIC_CATALOG
}
KNOWN_METRIC_IDS = frozenset(METRIC_DEFINITIONS_BY_ID)

_OVERLAP_CALCULATORS = {
    "paramos": calc_ecosystem.paramo_km2,
    "bosque_seco": calc_ecosystem.dry_forest_km2,
    "wetlands": calc_ecosystem.wetlands_km2,
    "mangroves": calc_ecosystem.mangroves_km2,
    "resguardos": calc_social.indigenous_reservations_km2,
    "comunidades": calc_social.community_councils_km2,
    "runap_protegidas": calc_protected.runap_overlap_km2,
    "recarga_agua": calc_water.water_recharge_overlap_km2,
    "coberturas_agriculture": calc_land_cover.agricultural_area_km2,
}

# Marine categorical layers are deliberately absent: this artifact serves the
# Colombia land grid only.
_CATEGORICAL_OVERLAP_CALCULATORS = {
    "ecosistemas_IAVH_2024": calc_ecosystem.ecosystem_total_km2,
}

_OVERLAP_PERCENT_CALCULATORS = {
    "runap_parques": calc_protected.national_parks_percent_of_selected,
    "resguardos": calc_protected.indigenous_territory_percent_of_selected,
    "recarga_agua": calc_water.water_recharge_percent_of_selected,
    "coberturas_artificial_surfaces": calc_land_cover.corine_level_1_pct,
    "coberturas_agricultural_areas": calc_land_cover.corine_level_1_pct,
    "coberturas_forests_and_semi_natural_areas": calc_land_cover.corine_level_1_pct,
    "coberturas_wetlands": calc_land_cover.corine_level_1_pct,
    "coberturas_water_bodies": calc_land_cover.corine_level_1_pct,
}

_WEIGHTED_SUM_BY_METRIC_ID = {
    "carbon_storage_biomass": calc_carbon.carbon_storage_biomass,
    "carbon_biomass_total": calc_carbon.carbon_biomass_total,
    "soil_organic_carbon": calc_carbon.soil_organic_carbon,
}

_WEIGHTED_PERCENT_CALCULATORS = {
    "biomasa": calc_carbon.national_carbon_percent,
}

_SPECIES_RICHNESS_FIELDS = {
    "mammals": "species_richness_mammals",
    "birds": "species_richness_birds",
    "amphibians": "species_richness_amphibians",
    "reptiles": "species_richness_reptiles",
    "plants": "species_richness_plants",
}

_SPECIES_GROUP_METRIC_IDS = {
    **{metric_id: group for group, metric_id in _SPECIES_RICHNESS_FIELDS.items()},
    "threatened_species_count": "threatened",
}

_SPECIES_PCT_METRIC_ID = "species_pct_of_national"
_SPECIES_SECURED_METRIC_ID = "threatened_species_secured"

IMPLEMENTED_RASTER_METRIC_IDS = tuple(
    metric.metric_id
    for metric in METRIC_CATALOG
    if metric.kind in {
        "selected_area",
        "national_percent",
        "aoi_percent",
        "binary_overlap_area",
        "binary_overlap_percent_of_selected",
        "weighted_sum",
        "weighted_percent_of_national",
    }
    or (
        metric.kind == "categorical_overlap_area"
        and metric.layer_id in _CATEGORICAL_OVERLAP_CALCULATORS
    )
    or metric.metric_id in {
        *_SPECIES_GROUP_METRIC_IDS,
        _SPECIES_PCT_METRIC_ID,
    }
)


def area_metric_catalog() -> tuple[MetricDefinition, ...]:
    """Return shared catalog entries for area metrics used by the backend."""
    return tuple(
        metric for metric in METRIC_CATALOG if metric.metric_id in AREA_METRIC_IDS
    )


def build_solution_raster_from_masks(
    selected_mask: Sequence[Sequence[object]],
    valid_mask: Sequence[Sequence[object]],
    *,
    pixel_area_km2: float,
) -> SolutionRaster:
    """Build the pipeline's SolutionRaster from small in-memory masks."""
    selected = np.asarray(selected_mask, dtype=bool)
    valid = np.asarray(valid_mask, dtype=bool)

    if selected.ndim != 2 or valid.ndim != 2:
        raise ValueError("selected_mask and valid_mask must be 2D arrays.")
    if selected.shape != valid.shape:
        raise ValueError("selected_mask and valid_mask must have matching shapes.")
    if pixel_area_km2 <= 0:
        raise ValueError("pixel_area_km2 must be positive.")

    height, width = selected.shape
    selected &= valid
    pixel_area_per_row = np.full(height, float(pixel_area_km2), dtype=np.float64)
    pixel_width_km = float(pixel_area_km2) ** 0.5

    return SolutionRaster(
        path=_DUMMY_PATH,
        selected_mask=selected,
        valid_mask=valid,
        pixel_area_km2_per_row=pixel_area_per_row,
        fingerprint=RasterFingerprint(
            width=width,
            height=height,
            transform=(pixel_width_km, 0.0, 0.0, 0.0, -pixel_width_km, height * pixel_width_km),
            crs="EPSG:32618",
        ),
        selected_cells=int(selected.sum()),
        valid_cells=int(valid.sum()),
    )


def calculate_area_metrics_from_masks(
    selected_mask: Sequence[Sequence[object]],
    valid_mask: Sequence[Sequence[object]],
    *,
    pixel_area_km2: float,
) -> dict[str, float | None]:
    """Calculate backend area metrics through the shared pipeline functions."""
    raster = build_solution_raster_from_masks(
        selected_mask,
        valid_mask,
        pixel_area_km2=pixel_area_km2,
    )
    return calculate_area_metrics_from_raster(raster)


def calculate_area_metrics_from_raster(raster: SolutionRaster) -> dict[str, float | None]:
    return {
        "priority_area_in_region": calc_area.selected_area_km2(raster),
        "national_contribution": calc_area.national_contribution_pct(raster),
    }


def metric_ids_for_request(metrics: list[str] | None, *, raster_artifact: bool) -> list[str]:
    if not metrics:
        return list(IMPLEMENTED_RASTER_METRIC_IDS if raster_artifact else AREA_METRIC_IDS)

    expanded: list[str] = []
    for metric_id in metrics:
        if metric_id == AREA_ALIAS:
            expanded.extend(AREA_METRIC_IDS)
            continue
        if metric_id not in KNOWN_METRIC_IDS:
            raise ValueError(f"Unsupported metric ids: {metric_id}.")
        expanded.append(metric_id)

    deduped: list[str] = []
    for metric_id in expanded:
        if metric_id not in deduped:
            deduped.append(metric_id)
    return deduped


def build_custom_aoi_raster(
    reference_raster_path: Path,
    geometry: dict[str, Any],
    *,
    source_crs: Any = DEFAULT_BOUNDARY_CRS,
) -> SolutionRaster:
    """Rasterize a drawn AOI onto the reference grid, reprojecting when needed.

    Delegates to the metrics pipeline's boundary rasterizer so precomputed
    boundary metrics and live custom-AOI metrics discretize identically.
    """
    base = read_reference_raster(reference_raster_path)
    selected = rasterize_boundary(geometry, base.fingerprint, source_crs=source_crs)
    selected &= base.valid_mask
    return replace(
        base,
        selected_mask=selected,
        new_prioritizr_mask=selected.copy(),
        pre_existing_mask=np.zeros_like(selected),
        selected_cells=int(selected.sum()),
    )


def calculate_raster_metrics_for_aoi(
    raster: SolutionRaster,
    layers: dict[str, RuntimeRasterLayer],
    species_matrices: dict[str, RuntimeSpeciesMatrix],
    species_index: RuntimeSpeciesQueryIndex | None,
    species_pool_sizes: dict[str, Any],
    metric_ids: list[str],
) -> tuple[dict[str, float | None], dict[str, Any]]:
    metrics: dict[str, float | None] = {}
    unavailable: list[dict[str, str]] = []
    mask_cache: dict[str, np.ndarray] = {}
    value_cache: dict[str, np.ndarray] = {}
    species_counts: dict[str, int] = {}
    used_layers: set[str] = set()
    used_species_matrices: set[str] = set()

    for metric_id in metric_ids:
        definition = METRIC_DEFINITIONS_BY_ID.get(metric_id)
        if definition is None:
            unavailable.append({"metric_id": metric_id, "reason": "unknown_metric"})
            continue

        if definition.kind == "selected_area":
            metrics[metric_id] = calc_area.selected_area_km2(raster)
            continue
        if definition.kind == "national_percent":
            metrics[metric_id] = calc_area.national_contribution_pct(raster)
            continue
        if definition.kind == "aoi_percent":
            # The custom AOI is itself the selected area. Keep the raster's
            # national valid mask intact for national_contribution, but use the
            # AOI's valid in-domain selection as both numerator and denominator.
            if raster.selected_cells == 0:
                metrics[metric_id] = None
                unavailable.append(
                    {
                        "metric_id": metric_id,
                        "reason": "aoi_has_no_valid_cells",
                    }
                )
            else:
                metrics[metric_id] = 100.0
            continue
        if definition.kind in {"metadata_summary", "metadata_coverage"}:
            metrics[metric_id] = None
            unavailable.append({"metric_id": metric_id, "reason": "requires_solution_manifest_metadata"})
            continue
        if definition.kind.startswith("species_"):
            try:
                value, groups = _calculate_species_metric(
                    metric_id,
                    definition,
                    raster,
                    species_matrices,
                    species_index,
                    species_pool_sizes,
                    species_counts,
                )
            except SpeciesMetricUnavailable as exc:
                metrics[metric_id] = None
                unavailable.append({"metric_id": metric_id, "reason": exc.reason})
                continue
            metrics[metric_id] = value
            used_species_matrices.update(groups)
            continue
        if definition.kind == "deferred_pairwise":
            metrics[metric_id] = None
            unavailable.append({"metric_id": metric_id, "reason": "requires_two_solutions"})
            continue
        if definition.kind == "blocked_no_data":
            metrics[metric_id] = None
            unavailable.append({"metric_id": metric_id, "reason": "catalog_marks_metric_blocked_no_data"})
            continue

        layer_id = definition.layer_id or ""
        layer = layers.get(layer_id)
        if layer is None:
            metrics[metric_id] = None
            unavailable.append({"metric_id": metric_id, "reason": f"layer_not_in_artifact:{layer_id}"})
            continue

        try:
            if definition.kind in {"binary_overlap_area", "binary_overlap_percent_of_selected"}:
                mask = _layer_mask(layer, raster, mask_cache)
                used_layers.add(layer_id)
                metrics[metric_id] = _calculate_overlap_metric(definition, raster, mask)
                continue
            if definition.kind in {"weighted_sum", "weighted_percent_of_national"}:
                values = _layer_values(layer, raster, value_cache)
                used_layers.add(layer_id)
                metrics[metric_id] = _calculate_weighted_metric(definition, raster, values)
                continue
            if definition.kind == "categorical_overlap_area":
                values = _layer_values(layer, raster, value_cache)
                used_layers.add(layer_id)
                metrics[metric_id] = _calculate_categorical_overlap_metric(
                    definition,
                    raster,
                    values,
                )
                continue
        except (RasterError, OSError, ValueError) as exc:
            metrics[metric_id] = None
            unavailable.append({"metric_id": metric_id, "reason": f"calculation_failed:{exc}"})
            continue

        metrics[metric_id] = None
        unavailable.append({"metric_id": metric_id, "reason": f"unhandled_kind:{definition.kind}"})

    coverage = {
        "requested_metric_ids": metric_ids,
        "returned_metric_ids": list(metrics),
        "implemented_metric_ids": list(IMPLEMENTED_RASTER_METRIC_IDS),
        "unavailable": unavailable,
        "layer_ids_used": sorted(used_layers),
        "species_matrix_groups_used": sorted(used_species_matrices),
        "processed_cell_count": int(raster.valid_cells),
        "selected_cell_count": int(raster.selected_cells),
        "valid_cell_count": int(raster.valid_cells),
    }
    return metrics, coverage


def _layer_mask(
    layer: RuntimeRasterLayer,
    raster: SolutionRaster,
    cache: dict[str, np.ndarray],
) -> np.ndarray:
    key = f"{layer.path}:{layer.rendering}"
    if key not in cache:
        cache[key] = read_layer_mask(layer.path, raster.fingerprint, rendering=layer.rendering)
    return cache[key]


def _layer_values(
    layer: RuntimeRasterLayer,
    raster: SolutionRaster,
    cache: dict[str, np.ndarray],
) -> np.ndarray:
    key = str(layer.path)
    if key not in cache:
        cache[key] = read_layer_values(layer.path, raster.fingerprint)
    return cache[key]


def _calculate_overlap_metric(
    definition: MetricDefinition,
    raster: SolutionRaster,
    mask: np.ndarray,
) -> float | None:
    layer_id = definition.layer_id or ""
    if definition.kind == "binary_overlap_percent_of_selected":
        calc_fn = _OVERLAP_PERCENT_CALCULATORS.get(layer_id)
        if calc_fn is None:
            raise ValueError(f"No percent calculator registered for {layer_id}.")
        return calc_fn(raster, mask)

    calc_fn = _OVERLAP_CALCULATORS.get(layer_id)
    if calc_fn is None:
        raise ValueError(f"No overlap calculator registered for {layer_id}.")
    return calc_fn(raster, mask)


def _calculate_categorical_overlap_metric(
    definition: MetricDefinition,
    raster: SolutionRaster,
    values: np.ndarray,
) -> float | None:
    layer_id = definition.layer_id or ""
    calc_fn = _CATEGORICAL_OVERLAP_CALCULATORS.get(layer_id)
    if calc_fn is None:
        raise ValueError(f"No categorical overlap calculator registered for {layer_id}.")
    return calc_fn(raster, values)


def _calculate_weighted_metric(
    definition: MetricDefinition,
    raster: SolutionRaster,
    values: np.ndarray,
) -> float | None:
    layer_id = definition.layer_id or ""
    if definition.kind == "weighted_percent_of_national":
        calc_fn = _WEIGHTED_PERCENT_CALCULATORS.get(layer_id)
        if calc_fn is None:
            raise ValueError(f"No weighted-percent calculator registered for {layer_id}.")
        return calc_fn(raster, values)

    calc_fn = _WEIGHTED_SUM_BY_METRIC_ID.get(definition.metric_id)
    if calc_fn is None:
        raise ValueError(f"No weighted-sum calculator registered for {definition.metric_id}.")
    return calc_fn(raster, values)


class SpeciesMetricUnavailable(ValueError):
    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


def _calculate_species_metric(
    metric_id: str,
    definition: MetricDefinition,
    raster: SolutionRaster,
    matrices: dict[str, RuntimeSpeciesMatrix],
    species_index: RuntimeSpeciesQueryIndex | None,
    pool_sizes: dict[str, Any],
    counts_cache: dict[str, int],
) -> tuple[float | int, set[str]]:
    if definition.kind == "species_group_coverage":
        raise SpeciesMetricUnavailable("requires_species_target_percent")

    if metric_id == _SPECIES_SECURED_METRIC_ID:
        raise SpeciesMetricUnavailable("requires_species_target_percent")

    if definition.kind == "species_richness":
        group = definition.species_bucket
        if not group:
            raise SpeciesMetricUnavailable("species_metric_missing_bucket")
        return _species_group_count(group, raster, matrices, species_index, counts_cache), {group}

    if definition.kind == "species_threatened_count":
        return _species_group_count("threatened", raster, matrices, species_index, counts_cache), {"threatened"}

    if definition.kind == "species_pct_of_national":
        missing = [group for group in CLASS_BUCKETS if group not in matrices]
        if missing:
            raise SpeciesMetricUnavailable("species_matrix_group_missing:" + ",".join(missing))
        present = sum(
            _species_group_count(group, raster, matrices, species_index, counts_cache)
            for group in CLASS_BUCKETS
        )
        total = _species_total_non_fish(pool_sizes, matrices, species_index)
        if total <= 0:
            raise SpeciesMetricUnavailable("species_pool_size_unavailable")
        return (present / total) * 100.0, set(CLASS_BUCKETS)

    raise SpeciesMetricUnavailable(f"unhandled_species_kind:{definition.kind}")


def _species_group_count(
    group: str,
    raster: SolutionRaster,
    matrices: dict[str, RuntimeSpeciesMatrix],
    species_index: RuntimeSpeciesQueryIndex | None,
    counts_cache: dict[str, int],
) -> int:
    if group in counts_cache:
        return counts_cache[group]
    if species_index is not None:
        try:
            count = species_index.count_overlaps(group, raster)
            counts_cache[group] = count
            return count
        except SpeciesIndexQueryError as exc:
            if not str(exc).startswith("species_index_group_missing:"):
                raise SpeciesMetricUnavailable(str(exc)) from exc
    matrix_ref = matrices.get(group)
    if matrix_ref is None:
        raise SpeciesMetricUnavailable(f"species_matrix_group_missing:{group}")
    count = _count_species_matrix_overlaps(matrix_ref, raster)
    counts_cache[group] = count
    return count


def _count_species_matrix_overlaps(matrix: RuntimeSpeciesMatrix, raster: SolutionRaster) -> int:
    try:
        with gzip.open(matrix.path, "rb") as handle:
            header = handle.read(8)
            if len(header) < 8 or header[:4] != SMSP_MAGIC:
                raise SparseFormatError(f"bad species matrix magic for {matrix.group}")
            toc_length = struct.unpack_from("<I", header, 4)[0]
            toc = json.loads(handle.read(toc_length).decode("utf-8"))
            grid = _species_grid_from_toc(toc, matrix.group)
            selected_window = _selected_window_for_species_grid(raster, grid, matrix.group)

            present_count = 0
            cursor = 0
            for entry in toc.get("species") or []:
                offset = int(entry["offset"])
                cell_count = int(entry["count"])
                if offset != cursor:
                    raise SparseFormatError(
                        f"species matrix {matrix.group} has non-sequential body offset"
                    )
                chunk = handle.read(cell_count * 4)
                if len(chunk) != cell_count * 4:
                    raise SparseFormatError(
                        f"species matrix {matrix.group} body ended early"
                    )
                if _species_chunk_overlaps_selection(chunk, selected_window):
                    present_count += 1
                cursor += len(chunk)
            return present_count
    except (OSError, json.JSONDecodeError, KeyError, UnicodeDecodeError, SparseFormatError) as exc:
        raise SpeciesMetricUnavailable(f"species_matrix_load_failed:{matrix.group}") from exc


def _species_grid_from_toc(toc: dict[str, Any], group: str) -> SparseMetadata:
    grid_raw = toc.get("grid")
    if not isinstance(grid_raw, dict):
        raise SparseFormatError(f"species matrix {group} is missing grid metadata")
    grid_with_count = dict(grid_raw)
    grid_with_count.setdefault("count", 0)
    return SparseMetadata.from_json(grid_with_count)


def _selected_window_for_species_grid(
    raster: SolutionRaster,
    grid: SparseMetadata,
    group: str,
) -> np.ndarray:
    sol_a, sol_b, sol_c, sol_d, sol_e, sol_f = raster.fingerprint.transform
    if (
        abs(grid.x_scale - sol_a) > 1e-6
        or abs(grid.y_scale - sol_e) > 1e-6
        or abs(sol_b) > 1e-9
        or abs(sol_d) > 1e-9
    ):
        raise SpeciesMetricUnavailable(f"species_matrix_grid_mismatch:{group}")

    if grid.crs and raster.fingerprint.crs and str(grid.crs) != str(raster.fingerprint.crs):
        raise SpeciesMetricUnavailable(f"species_matrix_crs_mismatch:{group}")

    col_offset = round((grid.x_origin - sol_c) / sol_a)
    row_offset = round((grid.y_origin - sol_f) / sol_e)
    row_end = row_offset + grid.height
    col_end = col_offset + grid.width
    if (
        row_offset < 0
        or col_offset < 0
        or row_end > raster.selected_mask.shape[0]
        or col_end > raster.selected_mask.shape[1]
    ):
        raise SpeciesMetricUnavailable(f"species_matrix_outside_reference_grid:{group}")

    return raster.selected_mask[row_offset:row_end, col_offset:col_end].ravel()


def _species_chunk_overlaps_selection(chunk: bytes, selected_window: np.ndarray) -> bool:
    if not chunk:
        return False
    deltas = np.frombuffer(chunk, dtype=np.uint32)
    cell_ids = np.cumsum(deltas, dtype=np.uint32)
    return bool(selected_window[cell_ids].any())


def _species_total_non_fish(
    pool_sizes: dict[str, Any],
    matrices: dict[str, RuntimeSpeciesMatrix],
    species_index: RuntimeSpeciesQueryIndex | None,
) -> int:
    raw_total = pool_sizes.get("total_non_fish")
    if isinstance(raw_total, (int, float)) and raw_total > 0:
        return int(raw_total)

    total = 0
    for group in CLASS_BUCKETS:
        if species_index is not None:
            try:
                total += species_index.entry_count(group)
                continue
            except SpeciesIndexQueryError:
                pass
        matrix_ref = matrices.get(group)
        if matrix_ref is None:
            continue
        total += _species_matrix_entry_count(matrix_ref)
    return total


def _species_matrix_entry_count(matrix: RuntimeSpeciesMatrix) -> int:
    try:
        with gzip.open(matrix.path, "rb") as handle:
            header = handle.read(8)
            if len(header) < 8 or header[:4] != SMSP_MAGIC:
                raise SparseFormatError(f"bad species matrix magic for {matrix.group}")
            toc_length = struct.unpack_from("<I", header, 4)[0]
            toc = json.loads(handle.read(toc_length).decode("utf-8"))
    except (OSError, json.JSONDecodeError, UnicodeDecodeError, SparseFormatError) as exc:
        raise SpeciesMetricUnavailable(f"species_matrix_load_failed:{matrix.group}") from exc
    return len(toc.get("species") or [])
