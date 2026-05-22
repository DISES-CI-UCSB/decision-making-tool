"""Protected-area overlap metrics.

Metrics implemented here
------------------------
  #63 — Total Protected Area in AOI (RUNAP, all categories combined)
  #64 — % Overlap with National Parks (Parque Nacional Natural, RUNAP id=3)
  #66 — % Overlap with Indigenous Territories (resguardos indígenas)

For #63, the 'runap' manifest layer is a binary mask covering all 15 RUNAP
categories.  For #64, the off-manifest 'runap_protected_areas.tif' categorical
raster is pre-filtered to category id=3 (Parque Nacional Natural) before being
passed here as a binary layer_mask.  See inputs/includes/runap_categories.csv
for the full RUNAP category legend.
"""

from __future__ import annotations

import numpy as np

from raster_metrics import SolutionRaster, overlap_km2


def runap_overlap_km2(raster: SolutionRaster, layer_mask: np.ndarray) -> float:
    """#63 — km² of selected area overlapping any RUNAP protected area."""
    return overlap_km2(raster.selected_mask, layer_mask, raster.pixel_area_km2_per_row)


def national_parks_percent_of_selected(
    raster: SolutionRaster, layer_mask: np.ndarray
) -> float | None:
    """#64 — % of selected area overlapping Parque Nacional Natural (RUNAP id=3).

    The layer_mask must already be filtered to category id=3; main.py handles
    this by passing rendering={"valueType":"binary","selectedValue":3} when
    reading the runap_protected_areas.tif raster.
    Returns None when the selected area is zero.
    """
    selected_area = raster.selected_area_km2
    if selected_area == 0.0:
        return None
    overlap = overlap_km2(raster.selected_mask, layer_mask, raster.pixel_area_km2_per_row)
    return (overlap / selected_area) * 100.0


def indigenous_territory_percent_of_selected(
    raster: SolutionRaster, layer_mask: np.ndarray
) -> float | None:
    """#66 — % of selected area overlapping indigenous reservations.

    Uses the same 'resguardos' binary layer as the area metric #59, but
    expresses the result as a fraction of the selected area.
    Returns None when the selected area is zero.
    """
    selected_area = raster.selected_area_km2
    if selected_area == 0.0:
        return None
    overlap = overlap_km2(raster.selected_mask, layer_mask, raster.pixel_area_km2_per_row)
    return (overlap / selected_area) * 100.0
