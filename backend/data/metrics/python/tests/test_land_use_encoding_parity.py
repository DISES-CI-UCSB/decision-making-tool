"""Guard both AOI land-use charts against mixed CLC class encodings."""

from __future__ import annotations

from pathlib import Path

import numpy as np
from backfill_land_use_of_aoi import (
    LAND_USE_OF_AOI_METRIC_IDS,
    backfill_verbose_document,
    compute_land_use_of_aoi_percents,
    compute_land_use_selected_percents,
)
from calculators.land_cover import (
    land_use_encoding_inversion_smell,
    land_use_mixes_from_metrics,
)
from metric_definitions import METRIC_CATALOG
from raster_metrics import RasterFingerprint, SolutionRaster
from test_land_use_of_aoi_backfill import _aoi_values, _document, _selected_values


# Live catalog-v3-6-0 Territorial Orinoquia on gold national compact.
# of-AOI is remapped (forest 78%); scenario is leftover classic IDs.
COWORKER_ORINOQUIA_SELECTED = {
    "land_use_artificial_surfaces_pct": 90.26053767009627,
    "land_use_agricultural_areas_pct": 8.22768005310322,
    "land_use_forests_and_semi_natural_areas_pct": 0.45801526717557256,
    "land_use_wetlands_pct": 1.027215399933621,
    "land_use_water_bodies_pct": 0.009956853634251578,
}
COWORKER_ORINOQUIA_OF_AOI = {
    "land_use_artificial_surfaces_pct_of_aoi": 0.15525022565439772,
    "land_use_agricultural_areas_pct_of_aoi": 19.69391234580283,
    "land_use_forests_and_semi_natural_areas_pct_of_aoi": 78.09808444489019,
    "land_use_wetlands_pct_of_aoi": 0.7786581085146926,
    "land_use_water_bodies_pct_of_aoi": 1.2664727710360044,
}


def _raster(*, selected: np.ndarray, valid: np.ndarray) -> SolutionRaster:
    height, width = selected.shape
    return SolutionRaster(
        path=Path("fixture.tif"),
        selected_mask=selected,
        valid_mask=valid,
        pixel_area_km2_per_row=np.ones(height, dtype=np.float64),
        fingerprint=RasterFingerprint(
            width=width,
            height=height,
            transform=(1.0, 0.0, 0.0, 0.0, -1.0, 0.0),
            crs="EPSG:9377",
        ),
        selected_cells=int(selected.sum()),
        valid_cells=int(valid.sum()),
    )


def _masks_from_clc(grid: np.ndarray, *, encoding: str) -> dict[str, np.ndarray]:
    if encoding == "national-remapped":
        class_ids = {
            "forests_and_semi_natural_areas": 1,
            "agricultural_areas": 2,
            "wetlands": 3,
            "water_bodies": 4,
            "artificial_surfaces": 5,
        }
    elif encoding == "classic-ideam":
        class_ids = {
            "artificial_surfaces": 1,
            "agricultural_areas": 2,
            "forests_and_semi_natural_areas": 3,
            "wetlands": 4,
            "water_bodies": 5,
        }
    else:
        raise ValueError(encoding)
    return {
        f"coberturas_{class_id}": grid == value for class_id, value in class_ids.items()
    }


def test_selected_and_of_aoi_catalog_rows_share_class_ids():
    selected_values: dict[str, int] = {}
    of_aoi_values: dict[str, int] = {}
    for definition in METRIC_CATALOG:
        rendering = definition.off_manifest_rendering or {}
        layer_id = definition.layer_id or ""
        if not layer_id.startswith("coberturas_") or "selectedValue" not in rendering:
            continue
        if definition.metric_id.endswith("_of_aoi"):
            of_aoi_values[layer_id] = rendering["selectedValue"]
        elif definition.metric_id.startswith("land_use_"):
            selected_values[layer_id] = rendering["selectedValue"]

    assert selected_values
    assert selected_values == of_aoi_values
    assert selected_values["coberturas_forests_and_semi_natural_areas"] == 1
    assert selected_values["coberturas_artificial_surfaces"] == 5


def test_coworker_orinoquia_pair_is_the_encoding_inversion_smell():
    assert land_use_encoding_inversion_smell(
        COWORKER_ORINOQUIA_SELECTED,
        COWORKER_ORINOQUIA_OF_AOI,
    )


def test_healthy_forest_majority_pair_is_not_an_encoding_inversion():
    assert not land_use_encoding_inversion_smell(
        {
            "artificial_surfaces": 0.6,
            "agricultural_areas": 47.0,
            "forests_and_semi_natural_areas": 51.1,
            "wetlands": 0.1,
            "water_bodies": 1.2,
        },
        {
            "artificial_surfaces": 0.6,
            "agricultural_areas": 47.0,
            "forests_and_semi_natural_areas": 51.1,
            "wetlands": 0.1,
            "water_bodies": 1.2,
        },
    )


def test_remapped_masks_keep_both_families_forest_majority():
    # Remapped CLC: 1=forest, 2=agri, 5=artificial. Solution picks forest cells.
    grid = np.array([[1, 1, 1, 1], [1, 1, 1, 2]], dtype=np.uint8)
    selected = grid == 1
    raster = _raster(selected=selected, valid=np.ones_like(grid, dtype=bool))
    masks = _masks_from_clc(grid, encoding="national-remapped")

    selected_pct = compute_land_use_selected_percents(raster, masks)
    of_aoi_pct = compute_land_use_of_aoi_percents(raster, masks)

    assert selected_pct["land_use_forests_and_semi_natural_areas_pct"] == 100.0
    assert selected_pct["land_use_artificial_surfaces_pct"] == 0.0
    assert of_aoi_pct["land_use_forests_and_semi_natural_areas_pct_of_aoi"] == 87.5
    assert of_aoi_pct["land_use_artificial_surfaces_pct_of_aoi"] == 0.0
    assert not land_use_encoding_inversion_smell(selected_pct, of_aoi_pct)


def test_classic_ids_on_remapped_raster_invert_only_the_scenario_family():
    grid = np.array([[1, 1, 1, 1], [1, 1, 1, 2]], dtype=np.uint8)
    selected = grid == 1
    raster = _raster(selected=selected, valid=np.ones_like(grid, dtype=bool))
    remapped = _masks_from_clc(grid, encoding="national-remapped")
    classic = _masks_from_clc(grid, encoding="classic-ideam")

    selected_pct = compute_land_use_selected_percents(raster, classic)
    of_aoi_pct = compute_land_use_of_aoi_percents(raster, remapped)

    assert selected_pct["land_use_artificial_surfaces_pct"] == 100.0
    assert of_aoi_pct["land_use_forests_and_semi_natural_areas_pct_of_aoi"] == 87.5
    assert land_use_encoding_inversion_smell(selected_pct, of_aoi_pct)


def test_of_aoi_only_backfill_keeps_stale_inverted_scenario_mix():
    document = _document(agri_pct=8.2)
    document["geographies"]["national"]["colombia"]["metrics"] = [
        {
            "metricId": metric_id,
            "value": value,
            "unit": "%",
            "status": "ready",
        }
        for metric_id, value in COWORKER_ORINOQUIA_SELECTED.items()
    ]
    of_aoi = {
        ("national", "colombia"): {
            metric_id: COWORKER_ORINOQUIA_OF_AOI[metric_id]
            for metric_id in LAND_USE_OF_AOI_METRIC_IDS
        },
        ("departments", "05"): _aoi_values(19.7),
    }

    updated = backfill_verbose_document(document, of_aoi)
    selected, of_aoi_mix = land_use_mixes_from_metrics(
        updated["geographies"]["national"]["colombia"]["metrics"]
    )

    assert land_use_encoding_inversion_smell(selected, of_aoi_mix)


def test_selected_backfill_clears_the_encoding_inversion():
    document = _document(agri_pct=8.2)
    document["geographies"]["national"]["colombia"]["metrics"] = [
        {
            "metricId": metric_id,
            "value": value,
            "unit": "%",
            "status": "ready",
        }
        for metric_id, value in COWORKER_ORINOQUIA_SELECTED.items()
    ]
    of_aoi = {
        ("national", "colombia"): {
            metric_id: COWORKER_ORINOQUIA_OF_AOI[metric_id]
            for metric_id in LAND_USE_OF_AOI_METRIC_IDS
        },
        ("departments", "05"): _aoi_values(19.7),
    }
    selected = {
        ("national", "colombia"): _selected_values(88.0),
        ("departments", "05"): _selected_values(80.0),
    }

    updated = backfill_verbose_document(document, of_aoi, selected)
    selected_mix, of_aoi_mix = land_use_mixes_from_metrics(
        updated["geographies"]["national"]["colombia"]["metrics"]
    )

    assert selected_mix["forests_and_semi_natural_areas"] == 88.0
    assert selected_mix["artificial_surfaces"] == 0.0
    assert of_aoi_mix["forests_and_semi_natural_areas"] == 78.09808444489019
    assert not land_use_encoding_inversion_smell(selected_mix, of_aoi_mix)
