from __future__ import annotations

import os
import sys
from dataclasses import replace
from pathlib import Path
from typing import Any, Sequence

import numpy as np
from affine import Affine
from rasterio.features import geometry_mask

from .artifacts import RuntimeRasterLayer


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
    read_solution_raster,
)

AREA_METRIC_IDS = ("national_contribution", "priority_area_in_region")
AREA_ALIAS = "area"
_DUMMY_PATH = Path("/virtual/backend-shared-solution-raster")

METRIC_DEFINITIONS_BY_ID: dict[str, MetricDefinition] = {
    metric.metric_id: metric for metric in METRIC_CATALOG
}
KNOWN_METRIC_IDS = frozenset(METRIC_DEFINITIONS_BY_ID)

_OVERLAP_CALCULATORS = {
    "ecosistemas": calc_ecosystem.ecosystem_total_km2,
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

_OVERLAP_PERCENT_CALCULATORS = {
    "runap_parques": calc_protected.national_parks_percent_of_selected,
    "resguardos": calc_protected.indigenous_territory_percent_of_selected,
    "recarga_agua": calc_water.water_recharge_percent_of_selected,
    "coberturas_forest": calc_land_cover.forest_pct,
    "coberturas_agriculture": calc_land_cover.agriculture_pct,
    "coberturas_other": calc_land_cover.other_land_use_pct,
}

_WEIGHTED_SUM_BY_METRIC_ID = {
    "carbon_storage_biomass": calc_carbon.carbon_storage_biomass,
    "carbon_biomass_total": calc_carbon.carbon_biomass_total,
    "soil_organic_carbon": calc_carbon.soil_organic_carbon,
}

_WEIGHTED_PERCENT_CALCULATORS = {
    "biomasa": calc_carbon.national_carbon_percent,
}

IMPLEMENTED_RASTER_METRIC_IDS = tuple(
    metric.metric_id
    for metric in METRIC_CATALOG
    if metric.kind
    in {
        "selected_area",
        "national_percent",
        "aoi_percent",
        "binary_overlap_area",
        "binary_overlap_percent_of_selected",
        "weighted_sum",
        "weighted_percent_of_national",
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


def build_custom_aoi_raster(reference_raster_path: Path, geometry: dict[str, Any]) -> SolutionRaster:
    base = read_solution_raster(reference_raster_path)
    selected = geometry_mask(
        [geometry],
        out_shape=base.valid_mask.shape,
        transform=Affine(*base.fingerprint.transform),
        invert=True,
        all_touched=False,
    )
    selected &= base.valid_mask
    return replace(
        base,
        selected_mask=selected,
        selected_cells=int(selected.sum()),
    )


def calculate_raster_metrics_for_aoi(
    raster: SolutionRaster,
    layers: dict[str, RuntimeRasterLayer],
    metric_ids: list[str],
) -> tuple[dict[str, float | None], dict[str, Any]]:
    metrics: dict[str, float | None] = {}
    unavailable: list[dict[str, str]] = []
    mask_cache: dict[str, np.ndarray] = {}
    value_cache: dict[str, np.ndarray] = {}
    used_layers: set[str] = set()

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
            metrics[metric_id] = calc_area.national_contribution_pct(raster)
            continue
        if definition.kind in {"metadata_summary", "metadata_coverage"}:
            metrics[metric_id] = None
            unavailable.append({"metric_id": metric_id, "reason": "requires_solution_manifest_metadata"})
            continue
        if definition.kind.startswith("species_"):
            metrics[metric_id] = None
            unavailable.append({"metric_id": metric_id, "reason": "species_range_accumulator_not_in_live_artifact"})
            continue
        if definition.kind == "deferred_pairwise":
            metrics[metric_id] = None
            unavailable.append({"metric_id": metric_id, "reason": "requires_two_scenarios"})
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
