"""Pytest fixtures shared across all test modules.

Helper logic lives in helpers.py so test modules can import it directly
(conftest.py is pytest-magic and not directly importable as a module).
"""

from __future__ import annotations

import json

import pytest

from helpers import (
    EXAMPLE_FILE,
    load_fixture,
    raster_from_fixture,
)


@pytest.fixture(scope="session")
def uniform_fixture():
    return load_fixture("uniform_grid.json")


@pytest.fixture(scope="session")
def uniform_raster(uniform_fixture):
    return raster_from_fixture(uniform_fixture)


@pytest.fixture(scope="session")
def nodata_fixture():
    return load_fixture("nodata_grid.json")


@pytest.fixture(scope="session")
def nodata_raster(nodata_fixture):
    return raster_from_fixture(nodata_fixture)


@pytest.fixture(scope="session")
def example_output():
    return json.loads(EXAMPLE_FILE.read_text())


@pytest.fixture(scope="session")
def national_metrics(example_output):
    return example_output["geographies"]["national"]["colombia"]["metrics"]
