from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.metric_adapters import (
    AREA_METRIC_IDS,
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
