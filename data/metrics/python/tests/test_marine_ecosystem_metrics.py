import csv
from pathlib import Path

import numpy as np
import pytest

from calculator_registry import categorical_area_calculator
from calculators.marine_ecosystems import (
    CORAL_REEF_CLASS_IDS,
    MARINE_MANGROVE_CLASS_IDS,
    SEAGRASS_CLASS_IDS,
    coral_reef_coverage_km2,
    marine_mangrove_coverage_km2,
    seagrass_coverage_km2,
)
from helpers import raster_from_fixture
from metric_definitions import computable_metrics

MARINE_CATEGORIES_CSV = (
    Path(__file__).parents[3]
    / "inputs/features/marine/marine_ecosystem_categories.csv"
)
MARINE_ECOSYSTEMS_URL = (
    "https://aagibolq28slyfof.public.blob.vercel-storage.com/"
    "inputs/features/marine/marine_ecosystems.tif"
)


@pytest.fixture
def raster():
    return raster_from_fixture({
        "shape": [2, 4],
        "pixel_area_km2": 2,
        "selected": [
            [True, True, True, False],
            [True, True, False, True],
        ],
        "valid": [
            [True, True, True, True],
            [True, True, True, True],
        ],
    })


def _csv_ids_with_label(label: str) -> frozenset[int]:
    with MARINE_CATEGORIES_CSV.open(encoding="utf-8", newline="") as source:
        return frozenset(
            int(row["biome_id"])
            for row in csv.DictReader(source)
            if row["biome"].startswith(label)
        )


def test_class_ids_match_registered_category_labels():
    assert CORAL_REEF_CLASS_IDS == _csv_ids_with_label("Formaciones coralinas")
    assert SEAGRASS_CLASS_IDS == _csv_ids_with_label("Pastos marinos")
    assert MARINE_MANGROVE_CLASS_IDS == _csv_ids_with_label("Manglares")


def test_coral_coverage_excludes_nodata_nonmembers_and_unselected_cells(raster):
    values = np.array([
        [23, np.nan, 91, 23],
        [140, 55, 32, 86],
    ])

    assert coral_reef_coverage_km2(raster, values) == pytest.approx(4.0)


def test_categorical_coverage_returns_zero_without_selected_overlap(raster):
    values = np.array([
        [1, 1, 1, 23],
        [1, 1, 32, 1],
    ])

    assert coral_reef_coverage_km2(raster, values) == pytest.approx(0.0)


@pytest.mark.parametrize(
    ("calculator", "class_id"),
    [
        (coral_reef_coverage_km2, 23),
        (marine_mangrove_coverage_km2, 55),
        (seagrass_coverage_km2, 86),
    ],
)
def test_named_calculators_use_their_category_membership(raster, calculator, class_id):
    values = np.full((2, 4), np.nan)
    values[0, 0] = class_id

    assert calculator(raster, values) == pytest.approx(2.0)


def test_marine_metric_catalog_and_registry_wiring():
    definitions = {metric.metric_id: metric for metric in computable_metrics()}
    expected_numbers = {
        "coral_reef_coverage": 35,
        "marine_mangrove_coverage": 36,
        "seagrass_coverage": 37,
    }

    for metric_id, metric_number in expected_numbers.items():
        definition = definitions[metric_id]
        assert definition.metric_number == metric_number
        assert definition.kind == "categorical_overlap_area"
        assert definition.layer_id == "marine_ecosystems"
        assert definition.unit == "km2"
        assert definition.off_manifest_url == MARINE_ECOSYSTEMS_URL
        assert categorical_area_calculator(metric_id) is not None

    existing_mangrove = definitions["mangrove_coverage"]
    assert existing_mangrove.kind == "binary_overlap_area"
    assert existing_mangrove.layer_id == "mangroves"
    assert "marine_protected_area_overlap" not in definitions
    assert "percent_in_eez" not in definitions
