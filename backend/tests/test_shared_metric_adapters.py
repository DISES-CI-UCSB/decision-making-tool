from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.metric_adapters import (
    AREA_METRIC_IDS,
    KNOWN_METRIC_IDS,
    METRIC_DEFINITIONS_BY_ID,
    _OVERLAP_PERCENT_CALCULATORS,
    area_metric_catalog,
    build_solution_raster_from_masks,
    calculate_area_metrics_from_masks,
)
from calculators.area import national_contribution_pct, selected_area_km2

FIXTURE_DIR = Path(__file__).resolve().parents[2] / "data" / "metrics" / "fixtures"


def load_fixture(name: str) -> dict:
    return json.loads((FIXTURE_DIR / name).read_text(encoding="utf-8"))


@pytest.mark.parametrize("fixture_name", ["uniform_grid.json", "nodata_grid.json"])
def test_backend_area_adapter_matches_shared_pipeline_area_calculators(fixture_name: str) -> None:
    fixture = load_fixture(fixture_name)
    raster = build_solution_raster_from_masks(
        fixture["selected"],
        fixture["valid"],
        pixel_area_km2=fixture["pixel_area_km2"],
    )

    backend_metrics = calculate_area_metrics_from_masks(
        fixture["selected"],
        fixture["valid"],
        pixel_area_km2=fixture["pixel_area_km2"],
    )

    assert backend_metrics["priority_area_in_region"] == pytest.approx(selected_area_km2(raster))
    assert backend_metrics["national_contribution"] == pytest.approx(
        national_contribution_pct(raster)
    )
    assert backend_metrics["priority_area_in_region"] == pytest.approx(
        fixture["expected"]["selected_area_km2"]
    )
    assert backend_metrics["national_contribution"] == pytest.approx(
        fixture["expected"]["national_contribution_pct"]
    )


def test_backend_area_adapter_uses_shared_metric_catalog_definitions() -> None:
    catalog_ids = {definition.metric_id for definition in area_metric_catalog()}

    assert catalog_ids == set(AREA_METRIC_IDS)


def test_backend_registers_each_authoritative_corine_level_1_percentage() -> None:
    expected = {
        "land_use_artificial_surfaces_pct": (
            "coberturas_artificial_surfaces",
            1,
            "Artificial Surfaces",
            "Territorios Artificializados",
        ),
        "land_use_agricultural_areas_pct": (
            "coberturas_agricultural_areas",
            2,
            "Agricultural Areas",
            "Territorios Agrícolas",
        ),
        "land_use_forests_and_semi_natural_areas_pct": (
            "coberturas_forests_and_semi_natural_areas",
            3,
            "Forests and Semi-natural Areas",
            "Bosques y Áreas Seminaturales",
        ),
        "land_use_wetlands_pct": ("coberturas_wetlands", 4, "Wetlands", "Áreas Húmedas"),
        "land_use_water_bodies_pct": (
            "coberturas_water_bodies",
            5,
            "Water Bodies",
            "Superficies de Agua",
        ),
    }

    assert "land_use_other_pct" not in KNOWN_METRIC_IDS
    for metric_id, (layer_id, value, english_label, spanish_label) in expected.items():
        definition = METRIC_DEFINITIONS_BY_ID[metric_id]
        assert definition.layer_id == layer_id
        assert definition.off_manifest_rendering == {"valueType": "binary", "selectedValue": value}
        assert definition.english_label == english_label
        assert definition.spanish_label == spanish_label
        assert layer_id in _OVERLAP_PERCENT_CALCULATORS
