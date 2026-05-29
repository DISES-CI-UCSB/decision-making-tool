"""Carbon and biomass weighted-sum metrics.

Each function accepts a SolutionRaster and a float64 layer-values array
(produced by raster_metrics.read_layer_values) and returns a raw scalar.

The unit of the returned value depends on the layer's native units:
    result = sum(pixel_value × pixel_area_km²) for included cells.

For the biomass layer (biomasa_areara+subterranea_1km.tif), if values are in
Mg/ha, multiply the result by 100 to convert to total Mg (since 1 km² = 100 ha).
The pipeline emits the raw result; unit interpretation is documented in the
metric catalog source_note.

Metrics implemented here
------------------------
  #5  — Carbon Storage Capacity  (above + below-ground biomass layer)
  #39 — Total Carbon Biomass     (same layer as #5; #41 tracked separately)
  #41 — Soil Organic Carbon      (carbono_organico.tif)
  #43 — % of National Carbon     (selected carbon / national carbon × 100)
"""

from __future__ import annotations

import numpy as np

from raster_metrics import SolutionRaster, weighted_percent_of_valid, weighted_sum_km2


def carbon_storage_biomass(raster: SolutionRaster, layer_values: np.ndarray) -> float:
    """#5 — Weighted sum of above+below-ground biomass for selected cells.

    The 'biomasa_areara+subterranea_1km.tif' layer represents combined
    above- and below-ground biomass carbon across Colombia at 1 km resolution.
    """
    return weighted_sum_km2(raster.selected_mask, layer_values, raster.pixel_area_km2_per_row)


def carbon_biomass_total(raster: SolutionRaster, layer_values: np.ndarray) -> float:
    """#39 — Same computation as #5; labeled 'Total Carbon Biomass' for reporting context.

    Ideally #39 would include soil organic carbon (#41) as well; that combination
    is not performed automatically here — consumers should sum #39 + #41 if
    a combined total is needed.
    """
    return weighted_sum_km2(raster.selected_mask, layer_values, raster.pixel_area_km2_per_row)


def soil_organic_carbon(raster: SolutionRaster, layer_values: np.ndarray) -> float:
    """#41 — Weighted sum of soil organic carbon for selected cells.

    Layer: carbono_organico.tif.  Unit = native raster units × km²/pixel.
    """
    return weighted_sum_km2(raster.selected_mask, layer_values, raster.pixel_area_km2_per_row)


def national_carbon_percent(raster: SolutionRaster, layer_values: np.ndarray) -> float | None:
    """#43 — Selected biomass carbon as a share of national carbon, in %.

    Denominator is the weighted sum over all finite biomass-layer cells
    (national total). Some solution rasters only mark selected cells as valid,
    so the denominator cannot come from the solution raster valid mask.
    Returns None when the national total is zero (degenerate raster).
    """
    return weighted_percent_of_valid(
        raster.selected_mask,
        np.isfinite(layer_values),
        layer_values,
        raster.pixel_area_km2_per_row,
    )
