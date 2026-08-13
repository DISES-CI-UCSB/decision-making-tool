from __future__ import annotations

import hashlib
import json
import os

import pytest

from boundaries.boundary_loader import (
    BOUNDARY_SOURCE_SPECS,
    EXPECTED_DEPARTMENT_CATALOG,
    EXPECTED_SIRAP_CATALOG,
    BoundaryLoadError,
    BoundarySourceSpec,
    _load_geojson_source,
    boundary_catalog_sha256,
    boundary_geometry_collection_sha256,
    canonical_geometry_sha256,
    load_all_boundaries,
)

SQUARE = {
    "type": "Polygon",
    "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
}


def _source_spec(
    raw: bytes,
    features: list[dict],
    *,
    behavior: str = "matching_frontend_identify_feature",
    required_fields: tuple[str, ...] = (),
) -> BoundarySourceSpec:
    catalog = [
        (
            str(feature["properties"]["boundary_id"]),
            feature["properties"]["boundary_name"],
        )
        for feature in features
        if feature["properties"].get("boundary_id") is not None
    ]
    geometry_catalog = [
        (
            str(feature["properties"]["boundary_id"]),
            canonical_geometry_sha256(feature["geometry"]),
        )
        for feature in features
        if feature["properties"].get("boundary_id") is not None
    ]
    return BoundarySourceSpec(
        geo_level="departments",
        url="https://example.test/departments.geojson",
        cache_filename="departments.geojson",
        expected_sha256=hashlib.sha256(raw).hexdigest(),
        expected_crs="EPSG:4326",
        id_field="boundary_id",
        name_field="boundary_name",
        expected_feature_count=len(features),
        expected_catalog_sha256=boundary_catalog_sha256(catalog),
        expected_geometry_collection_sha256=boundary_geometry_collection_sha256(
            geometry_catalog
        ),
        feature_behavior=behavior,
        required_fields=required_fields,
    )


def _raw(features: list[dict]) -> bytes:
    return json.dumps(
        {"type": "FeatureCollection", "features": features},
        separators=(",", ":"),
    ).encode()


def _feature(boundary_id: str | None = "05", name: str = "Antioquia") -> dict:
    return {
        "type": "Feature",
        "properties": {
            "boundary_id": boundary_id,
            "boundary_name": name,
        },
        "geometry": SQUARE,
    }


def test_pinned_igac_sources_match_exact_frontend_catalog_contract():
    departments = BOUNDARY_SOURCE_SPECS["departments"]
    municipalities = BOUNDARY_SOURCE_SPECS["municipalities"]

    assert departments.url.endswith("/boundaries/igac_departments_detailed.geojson")
    assert departments.id_field == "boundary_id"
    assert departments.name_field == "boundary_name"
    assert departments.expected_feature_count == len(EXPECTED_DEPARTMENT_CATALOG) == 33
    assert boundary_catalog_sha256(list(EXPECTED_DEPARTMENT_CATALOG)) == (
        departments.expected_catalog_sha256
    )
    assert ("00", "Area en Litigio Cauca - Huila") in EXPECTED_DEPARTMENT_CATALOG
    assert not any(
        boundary_id == "11" for boundary_id, _ in EXPECTED_DEPARTMENT_CATALOG
    )

    assert municipalities.url.endswith(
        "/boundaries/igac_municipalities_detailed.geojson"
    )
    assert municipalities.id_field == "boundary_id"
    assert municipalities.name_field == "boundary_name"
    assert municipalities.expected_feature_count == 1105
    assert municipalities.expected_catalog_sha256 == (
        "e175d902e48890e43299b7445c29af5eafbb0d4a5e5205a4ade0fd208ab91d3c"
    )


def test_pinned_sirap_source_is_authoritative_eight_scope_contract():
    siraps = BOUNDARY_SOURCE_SPECS["siraps"]

    assert siraps.url.endswith(
        "/inputs/boundaries/sirap/siraps_authoritative_combined_v3.geojson"
    )
    assert (
        siraps.cache_filename
        == "siraps_authoritative_combined_v3.1372ce88.geojson"
    )
    assert siraps.expected_sha256 == (
        "1372ce888f8c4c0f160da9c4ce553254542f160bb82bfd6a1da5730da4493e5c"
    )
    assert siraps.expected_feature_count == len(EXPECTED_SIRAP_CATALOG) == 8
    assert siraps.allowed_geometry_types == ("Polygon", "MultiPolygon")
    assert boundary_catalog_sha256(list(EXPECTED_SIRAP_CATALOG)) == (
        siraps.expected_catalog_sha256
    )
    assert not {
        "territorial_territorial_caribe_9",
        "territorial_territorial_pacifico_10",
    } & {sirap_id for sirap_id, _ in EXPECTED_SIRAP_CATALOG}
    assert dict(siraps.representative_geometry_sha256) == {
        "territorial_territorial_amazonia_3": (
            "11edc1b9ad65b870142f5dfd2c52694493007f973e8a8474aa58400c428919e8"
        ),
        "thematic_eje_cafetero_1": (
            "5288a528a2b7dcc67151180376b902c3d993aebfbcbae15a7bc34eb75822899b"
        ),
    }


def test_representative_geometry_fingerprints_are_pinned():
    assert dict(
        BOUNDARY_SOURCE_SPECS["departments"].representative_geometry_sha256
    ) == {
        "05": "3cdb74596ea0b15141e23eb2ad5e312470a28c76b858dd12d9db3d5a46e24a23",
        "50": "41d971bc07e52347ae5096d6436795c34bf97d5d112d42dae1d150f2d3948f76",
    }
    assert dict(BOUNDARY_SOURCE_SPECS["municipalities"].representative_geometry_sha256)[
        "50001"
    ] == ("ebde28fab4da4d580ce601adcfa89508b3bc902b2c59eae04b7fe5a35a233e1b")
    assert (
        dict(BOUNDARY_SOURCE_SPECS["runaps"].representative_geometry_sha256)["6"]
        == "0f8097533dfbb521046fcc1c12075db7f6430dafbe72a86124884fba99451223"
    )
    assert (
        dict(BOUNDARY_SOURCE_SPECS["omecs"].representative_geometry_sha256)["555744954"]
        == "06d67df89ffcfdcaa4969aaea45c077bc191a03e444cd67cebd54668c8dc4b44"
    )


def test_loader_exposes_validated_source_provenance(tmp_path):
    features = [_feature()]
    raw = _raw(features)
    spec = _source_spec(raw, features)
    cache_path = tmp_path / spec.cache_filename
    cache_path.write_bytes(raw)

    loaded = _load_geojson_source(cache_path, spec)

    assert loaded[0].boundary_id == "05"
    assert loaded[0].source_metadata is not None
    assert loaded[0].source_metadata.url == spec.url
    assert loaded[0].source_metadata.sha256 == spec.expected_sha256
    assert loaded[0].source_metadata.crs == "EPSG:4326"
    assert loaded[0].source_metadata.feature_count == 1
    assert loaded[0].source_metadata.id_field == "boundary_id"
    assert loaded[0].source_metadata.name_field == "boundary_name"
    assert loaded[0].geometry_sha256 == canonical_geometry_sha256(SQUARE)


def test_loader_does_not_name_fallback_when_authoritative_id_is_missing(tmp_path):
    feature = _feature(None)
    feature["properties"]["DeCodigo"] = "05"
    raw = _raw([feature])
    spec = _source_spec(raw, [feature])
    cache_path = tmp_path / spec.cache_filename
    cache_path.write_bytes(raw)

    with pytest.raises(BoundaryLoadError, match="required field 'boundary_id'"):
        _load_geojson_source(cache_path, spec)


def test_loader_rejects_duplicate_ids(tmp_path):
    features = [_feature(), _feature(name="Different name")]
    raw = _raw(features)
    spec = _source_spec(raw, features)
    cache_path = tmp_path / spec.cache_filename
    cache_path.write_bytes(raw)

    with pytest.raises(BoundaryLoadError, match="duplicate ID '05'"):
        _load_geojson_source(cache_path, spec)


def test_loader_rejects_unmatched_catalog(tmp_path):
    features = [_feature()]
    raw = _raw(features)
    spec = _source_spec(raw, features)
    spec = BoundarySourceSpec(
        **{
            **spec.__dict__,
            "expected_catalog_sha256": "0" * 64,
        }
    )
    cache_path = tmp_path / spec.cache_filename
    cache_path.write_bytes(raw)

    with pytest.raises(BoundaryLoadError, match="catalog mismatch"):
        _load_geojson_source(cache_path, spec)


def test_loader_rejects_partial_sirap_identity(tmp_path):
    feature = _feature("sirap-1", "SIRAP Example")
    feature["properties"].update(
        {"sirap_kind": "territorial", "source_file": "siraps_territorial.shp"}
    )
    raw = _raw([feature])
    spec = _source_spec(
        raw,
        [feature],
        behavior="whole_merged_feature_only",
        required_fields=("sirap_kind", "source_file"),
    )
    cache_path = tmp_path / spec.cache_filename
    cache_path.write_bytes(raw)

    with pytest.raises(BoundaryLoadError, match="non-merged or partial"):
        _load_geojson_source(cache_path, spec)


def test_loader_rejects_geometry_collection_when_polygon_only_is_required(tmp_path):
    feature = _feature("sirap-1", "SIRAP Example")
    feature["geometry"] = {
        "type": "GeometryCollection",
        "geometries": [
            SQUARE,
            {"type": "LineString", "coordinates": [[0, 0], [1, 1]]},
        ],
    }
    raw = _raw([feature])
    spec = _source_spec(raw, [feature])
    spec = BoundarySourceSpec(
        **{
            **spec.__dict__,
            "allowed_geometry_types": ("Polygon", "MultiPolygon"),
        }
    )
    cache_path = tmp_path / spec.cache_filename
    cache_path.write_bytes(raw)

    with pytest.raises(BoundaryLoadError, match="unsupported geometry type"):
        _load_geojson_source(cache_path, spec)


def test_loader_rejects_stale_cached_source_hash(tmp_path):
    features = [_feature()]
    raw = _raw(features)
    spec = _source_spec(raw, features)
    cache_path = tmp_path / spec.cache_filename
    cache_path.write_bytes(raw + b"\n")

    with pytest.raises(BoundaryLoadError, match="checksum mismatch"):
        _load_geojson_source(cache_path, spec)


@pytest.mark.skipif(
    os.environ.get("VALIDATE_BOUNDARY_SOURCES") != "1",
    reason="Set VALIDATE_BOUNDARY_SOURCES=1 for explicit public-source validation.",
)
def test_public_boundary_snapshots_match_every_pinned_contract(tmp_path):
    boundaries, errors = load_all_boundaries(tmp_path)

    assert errors == {}
    assert {level: len(features) for level, features in boundaries.items()} == {
        level: spec.expected_feature_count
        for level, spec in BOUNDARY_SOURCE_SPECS.items()
    }
