from __future__ import annotations

import json
from pathlib import Path

import pytest
from shapely.geometry import shape

from helpers.geometry import PolygonNormalizationError, normalize_geojson_geometry
from helpers.validate import (
    AMAZONIA_ID,
    EXPECTED_SIRAP_CATALOG,
    validate_repaired_collection,
    validate_release_metadata,
)
from main import build_release_metadata

REPO_ROOT = Path(__file__).resolve().parents[4]
REPAIRED_PATH = (
    REPO_ROOT / "data/boundaries/sirap/siraps_merged_polygon_v2.geojson"
)
PROVENANCE_PATH = (
    REPO_ROOT
    / "data/boundaries/sirap/siraps_merged_polygon_v2.provenance.json"
)


def test_versioned_metadata_binds_exact_polygon_release_provenance():
    provenance = json.loads(PROVENANCE_PATH.read_text(encoding="utf-8"))
    metadata = build_release_metadata(provenance)

    validate_release_metadata(metadata, provenance)
    assert metadata["geometryContract"] == "polygon-only"
    assert metadata["featureCount"] == 10
    assert metadata["stableIdField"] == "sirap_id"
    assert metadata["sha256"] == provenance["output"]["sha256"]


def polygon(x_offset: float = 0) -> dict:
    return {
        "type": "Polygon",
        "coordinates": [
            [
                [x_offset, 0],
                [x_offset + 4, 0],
                [x_offset + 4, 4],
                [x_offset, 4],
                [x_offset, 0],
            ]
        ],
    }


def test_geometry_collection_recursively_drops_non_polygon_members():
    source = {
        "type": "GeometryCollection",
        "geometries": [
            polygon(),
            {
                "type": "GeometryCollection",
                "geometries": [
                    {"type": "LineString", "coordinates": [[20, 20], [30, 30]]},
                    {"type": "Point", "coordinates": [25, 25]},
                ],
            },
        ],
    }

    repaired = normalize_geojson_geometry(source)

    assert repaired["type"] == "Polygon"
    assert shape(repaired).equals(shape(polygon()))


def test_polygon_holes_are_preserved():
    source = polygon()
    source["coordinates"].append(
        [[1, 1], [1, 3], [3, 3], [3, 1], [1, 1]]
    )

    repaired = normalize_geojson_geometry(source)

    assert repaired["type"] == "Polygon"
    assert len(repaired["coordinates"]) == 2
    assert shape(repaired).area == pytest.approx(12)


def test_multipolygon_parts_are_retained():
    source = {
        "type": "MultiPolygon",
        "coordinates": [polygon(0)["coordinates"], polygon(10)["coordinates"]],
    }

    repaired = normalize_geojson_geometry(source)

    assert repaired["type"] == "MultiPolygon"
    assert len(repaired["coordinates"]) == 2
    assert shape(repaired).area == pytest.approx(32)


def test_geometry_without_polygon_fails_closed():
    with pytest.raises(PolygonNormalizationError, match="no polygonal area"):
        normalize_geojson_geometry(
            {
                "type": "GeometryCollection",
                "geometries": [
                    {"type": "LineString", "coordinates": [[0, 0], [1, 1]]}
                ],
            }
        )


def test_released_catalog_is_exact_and_arcgis_compatible():
    repaired = json.loads(REPAIRED_PATH.read_text(encoding="utf-8"))
    provenance = json.loads(PROVENANCE_PATH.read_text(encoding="utf-8"))
    features = repaired["features"]
    catalog = [
        (feature["properties"]["sirap_id"], feature["properties"]["sirap_name"])
        for feature in features
    ]

    assert repaired["type"] == "FeatureCollection"
    assert len(features) == 10
    assert sorted(catalog) == sorted(EXPECTED_SIRAP_CATALOG)
    assert len({sirap_id for sirap_id, _ in catalog}) == 10
    assert all(
        feature["geometry"]["type"] in {"Polygon", "MultiPolygon"}
        and shape(feature["geometry"]).is_valid
        and not shape(feature["geometry"]).is_empty
        for feature in features
    )

    amazon = next(
        feature for feature in features if feature["properties"]["sirap_id"] == AMAZONIA_ID
    )
    assert amazon["geometry"]["type"] in {"Polygon", "MultiPolygon"}
    assert provenance["validation"]["amazonia"]["arcgis_compatible"] is True
    assert provenance["validation"]["amazonia"]["after_geometry_type"] in {
        "Polygon",
        "MultiPolygon",
    }


def test_validation_rejects_catalog_changes():
    repaired = json.loads(REPAIRED_PATH.read_text(encoding="utf-8"))
    provenance = json.loads(PROVENANCE_PATH.read_text(encoding="utf-8"))
    source = json.loads(REPAIRED_PATH.read_text(encoding="utf-8"))
    amazon = next(
        feature
        for feature in source["features"]
        if feature["properties"]["sirap_id"] == AMAZONIA_ID
    )
    amazon["geometry"] = {
        "type": "GeometryCollection",
        "geometries": [
            amazon["geometry"],
            {"type": "LineString", "coordinates": [[0, 0], [1, 1]]},
        ],
    }
    repaired["features"][0]["properties"]["sirap_name"] = "Changed"

    assert provenance["validation"]["feature_count"] == 10
    with pytest.raises(ValueError, match="names or IDs changed"):
        validate_repaired_collection(source, repaired)
