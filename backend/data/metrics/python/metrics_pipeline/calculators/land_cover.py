"""Land-cover metric calculators (#9 and CORINE Level 1 percentages).

Source layer: coberturas.tif (CORINE Land Cover Level 1, 5 classes).

Authoritative class-ID mapping for the current national coberturas.tif:
    1 = Bosques y Áreas Seminaturales  (forest / semi-natural)
    2 = Territorios Agrícolas           (agriculture)
    3 = Áreas Húmedas                   (wetlands)
    4 = Superficies de Agua             (water)
    5 = Territorios Artificializados    (urban / artificial)
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

import numpy as np

from raster_metrics import SolutionRaster, overlap_km2

LAND_USE_CLASS_IDS: tuple[str, ...] = (
    "artificial_surfaces",
    "agricultural_areas",
    "forests_and_semi_natural_areas",
    "wetlands",
    "water_bodies",
)
_INVERSION_MAJORITY_MIN = 40.0
_INVERSION_MINORITY_MAX = 10.0


def normalize_land_use_mix(
    mix: Mapping[str, float | None],
) -> dict[str, float | None]:
    """Accept short class keys or land_use_* metric ids."""

    values: dict[str, float | None] = {class_id: None for class_id in LAND_USE_CLASS_IDS}
    for key, value in mix.items():
        number = float(value) if isinstance(value, (int, float)) else None
        for class_id in LAND_USE_CLASS_IDS:
            if key in {
                class_id,
                f"land_use_{class_id}_pct",
                f"land_use_{class_id}_pct_of_aoi",
            }:
                values[class_id] = number
                break
    return values


def land_use_mixes_from_metrics(
    metrics: list[dict[str, Any]] | None,
) -> tuple[dict[str, float | None], dict[str, float | None]]:
    selected: dict[str, float | None] = {}
    of_aoi: dict[str, float | None] = {}
    for row in metrics or []:
        metric_id = str(row.get("metricId") or "")
        value = row.get("value")
        number = float(value) if isinstance(value, (int, float)) else None
        for class_id in LAND_USE_CLASS_IDS:
            if metric_id == f"land_use_{class_id}_pct":
                selected[class_id] = number
            elif metric_id == f"land_use_{class_id}_pct_of_aoi":
                of_aoi[class_id] = number
    return selected, of_aoi


def land_use_encoding_inversion_smell(
    selected_pct: Mapping[str, float | None],
    of_aoi_pct: Mapping[str, float | None],
    *,
    majority_min: float = _INVERSION_MAJORITY_MIN,
    minority_max: float = _INVERSION_MINORITY_MAX,
) -> bool:
    """True when the two land-use families disagree on CLC class IDs.

    Catalog 3.6.0 backfilled ``land_use_*_pct_of_aoi`` with remapped national
    IDs (1=forest, 5=artificial) but left ``land_use_*_pct`` on classic IDEAM
    IDs (1=artificial, 3=forest). The AOI card then shows a healthy forest
    mix next to a majority-artificial scenario mix.
    """

    selected = normalize_land_use_mix(selected_pct)
    of_aoi = normalize_land_use_mix(of_aoi_pct)
    selected_artificial = selected["artificial_surfaces"]
    selected_forest = selected["forests_and_semi_natural_areas"]
    of_aoi_artificial = of_aoi["artificial_surfaces"]
    of_aoi_forest = of_aoi["forests_and_semi_natural_areas"]
    if None in (
        selected_artificial,
        selected_forest,
        of_aoi_artificial,
        of_aoi_forest,
    ):
        return False
    classic_on_remapped = (
        selected_artificial >= majority_min
        and of_aoi_forest >= majority_min
        and selected_forest < minority_max
        and of_aoi_artificial < minority_max
    )
    remapped_on_classic = (
        selected_forest >= majority_min
        and of_aoi_artificial >= majority_min
        and selected_artificial < minority_max
        and of_aoi_forest < minority_max
    )
    return classic_on_remapped or remapped_on_classic


def _pct_of_selected(raster: SolutionRaster, layer_mask: np.ndarray) -> float | None:
    sel = raster.selected_area_km2
    if sel == 0.0:
        return None
    return overlap_km2(raster.selected_mask, layer_mask, raster.pixel_area_km2_per_row) / sel * 100.0


def _pct_of_aoi(raster: SolutionRaster, layer_mask: np.ndarray) -> float | None:
    """Percent of planning-valid AOI cells in one CORINE class.

    After ``with_boundary_mask``, ``valid_mask`` is the municipality / department
    / SIRAP (or custom polygon) support. Full replay and incremental backfill
    must both call this function.
    """
    aoi = raster.valid_area_km2
    if aoi == 0.0:
        return None
    return overlap_km2(raster.valid_mask, layer_mask, raster.pixel_area_km2_per_row) / aoi * 100.0


# --- #9 — Conservation Area on Agricultural Land (km²) ---

def agricultural_area_km2(raster: SolutionRaster, layer_mask: np.ndarray) -> float:
    """km² of selected area classified as Territorios Agrícolas (class 2)."""
    return overlap_km2(raster.selected_mask, layer_mask, raster.pixel_area_km2_per_row)


# --- CORINE Land Cover Level 1 (% of selected) ---

def corine_level_1_pct(raster: SolutionRaster, layer_mask: np.ndarray) -> float | None:
    """Return the selected-area percentage for one verified CORINE class mask."""
    return _pct_of_selected(raster, layer_mask)


def corine_level_1_pct_of_aoi(raster: SolutionRaster, layer_mask: np.ndarray) -> float | None:
    """Return the whole-AOI percentage for one verified CORINE class mask."""
    return _pct_of_aoi(raster, layer_mask)
