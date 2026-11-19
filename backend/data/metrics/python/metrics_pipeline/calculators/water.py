"""Water regulation overlap metrics.

Both metrics use the same binary groundwater-recharge layer
(recarga_agua_subterranea_moderado_alto.tif), which marks areas with moderate
to high groundwater recharge potential.  It is a binary presence/absence mask,
NOT a continuous volumetric index, so the results should be interpreted as
spatial coverage rather than recharge volume.

Metrics implemented here
------------------------
  #6  — Water Regulation Services Area (km² of selected area with recharge)
  #44 — Water Regulation Capacity (% of selected area with recharge)
"""

from __future__ import annotations

import numpy as np

from raster_metrics import SolutionRaster, overlap_km2


def water_recharge_overlap_km2(raster: SolutionRaster, layer_mask: np.ndarray) -> float:
    """#6 — km² of selected area overlapping the moderate-to-high recharge zone.

    The layer is a binary mask; this metric answers "how many km² of the
    prioritised area have significant groundwater recharge potential?"
    """
    return overlap_km2(raster.selected_mask, layer_mask, raster.pixel_area_km2_per_row)


def water_recharge_percent_of_selected(
    raster: SolutionRaster, layer_mask: np.ndarray
) -> float | None:
    """#44 — % of selected area with moderate-to-high groundwater recharge potential.

    Returns None when the selected area is zero (no planning units selected).
    """
    selected_area = raster.selected_area_km2
    if selected_area == 0.0:
        return None
    overlap = overlap_km2(raster.selected_mask, layer_mask, raster.pixel_area_km2_per_row)
    return (overlap / selected_area) * 100.0
