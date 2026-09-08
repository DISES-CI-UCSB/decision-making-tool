from __future__ import annotations

import pytest

from scripts.hydration_package import HydrationPackageError, load_hydration_package


def test_load_hydration_package_reads_land_solution_recipe() -> None:
    package = load_hydration_package(
        {
            "publicBlobHost": "https://blob.example",
            "hydrationPackage": {
                "format": "dmt-hydration-package/v1",
                "defaultReferenceGrid": "land-solution",
                "referenceGrids": {
                    "land-solution": {
                        "crs": "EPSG:9377",
                        "speciesBitsetKitId": "national-land-solution",
                        "referenceRaster": {
                            "pathname": "inputs/features/ecosystems/land-solution-9377/pin.tif"
                        },
                        "ecosystemInventory": {
                            "raster": "inputs/features/ecosystems/land-solution-9377/pin.tif"
                        },
                        "speciesMatrices": {
                            "birds": "inputs/features/species-sparse/land-solution-9377/species_birds.smtx.gz"
                        },
                    }
                },
                "metricLayers": {
                    "biomasa": {"pathname": "inputs/features/biomass/biomasa.tif"}
                },
                "sirap": {"releaseId": "sirap-2026-09-02-v6"},
            },
        }
    )

    assert package is not None
    assert package.default_reference_grid == "land-solution"
    assert package.species_bitset_kit_id("land-solution") == "national-land-solution"
    assert package.reference_raster_url("land-solution").endswith(
        "/inputs/features/ecosystems/land-solution-9377/pin.tif"
    )
    assert package.metric_layer_url("biomasa").endswith("/inputs/features/biomass/biomasa.tif")
    assert package.sirap_release_id() == "sirap-2026-09-02-v6"


def test_load_hydration_package_is_optional_when_absent() -> None:
    assert load_hydration_package({"layers": []}) is None


def test_load_hydration_package_rejects_legacy_default_grid() -> None:
    with pytest.raises(HydrationPackageError, match="land-solution"):
        load_hydration_package(
            {
                "hydrationPackage": {
                    "format": "dmt-hydration-package/v1",
                    "defaultReferenceGrid": "ecosistemas",
                    "referenceGrids": {"land-solution": {"crs": "EPSG:9377"}},
                }
            }
        )
