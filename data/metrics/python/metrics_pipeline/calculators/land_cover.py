"""Land-cover metric calculators (#9, #51, #52/#53, #54).

Source layer: coberturas.tif (CORINE Land Cover Level 1, 5 classes).

Confirmed class-ID mapping (TIF values 1-5 vs CSV legend — classes 1 and 3
were swapped in the original CSV):
    1 = Bosques y Áreas Seminaturales  (forest / semi-natural)
    2 = Territorios Agrícolas           (agriculture)
    3 = Territorios Artificializados    (urban / artificial)
    4 = Áreas Húmedas                   (wetlands)
    5 = Superficies de Agua             (water)
"""

from __future__ import annotations

import numpy as np

from raster_metrics import SolutionRaster, overlap_km2


def _pct_of_selected(raster: SolutionRaster, layer_mask: np.ndarray) -> float | None:
    sel = raster.selected_area_km2
    if sel == 0.0:
        return None
    return overlap_km2(raster.selected_mask, layer_mask, raster.pixel_area_km2_per_row) / sel * 100.0


# --- #9 — Affected Agricultural Area (km²) ---

def agricultural_area_km2(raster: SolutionRaster, layer_mask: np.ndarray) -> float:
    """km² of selected area classified as Territorios Agrícolas (class 2)."""
    return overlap_km2(raster.selected_mask, layer_mask, raster.pixel_area_km2_per_row)


# --- #51 — Land Use: Natural Forest (% of selected) ---

def forest_pct(raster: SolutionRaster, layer_mask: np.ndarray) -> float | None:
    """% of selected area classified as Bosques y Áreas Seminaturales (class 1)."""
    return _pct_of_selected(raster, layer_mask)


# --- #52/#53 — Land Use: Agriculture combined (% of selected) ---

def agriculture_pct(raster: SolutionRaster, layer_mask: np.ndarray) -> float | None:
    """% of selected area classified as Territorios Agrícolas (class 2)."""
    return _pct_of_selected(raster, layer_mask)


# --- #54 — Land Use: Other (% of selected) ---

def other_land_use_pct(raster: SolutionRaster, layer_mask: np.ndarray) -> float | None:
    """% of selected area classified as Artificializados, Húmedas, or Agua (classes 3+4+5)."""
    return _pct_of_selected(raster, layer_mask)
