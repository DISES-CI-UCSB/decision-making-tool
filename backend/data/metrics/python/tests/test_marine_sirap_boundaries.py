from __future__ import annotations

from pathlib import Path

from boundaries.boundary_loader import (
    BOUNDARY_SOURCE_SPECS,
    EXPECTED_MARINE_SIRAP_CATALOG,
    MARINE_SIRAP_LOCAL_PATH,
    MARINE_SIRAP_SOURCE_SPEC,
    BoundaryFeature,
    augment_boundaries_for_domain,
    load_marine_sirap_boundaries,
)
from metrics_contract import (
    MARINE_SIRAP_PROVENANCE_KEY,
    build_metrics_provenance,
    expected_scope_boundary_source_sha256,
    provenance_issues,
)


def test_local_marine_sirap_artifact_matches_pinned_contract(tmp_path: Path) -> None:
    assert MARINE_SIRAP_LOCAL_PATH.exists()
    features = load_marine_sirap_boundaries(tmp_path)

    assert [(feature.boundary_id, feature.name) for feature in features] == list(
        EXPECTED_MARINE_SIRAP_CATALOG
    )
    assert all(feature.properties.get("sirap_kind") == "marine" for feature in features)
    assert all(feature.source_crs == MARINE_SIRAP_SOURCE_SPEC.expected_crs for feature in features)
    metadata = features[0].source_metadata
    assert metadata is not None
    assert metadata.sha256 == MARINE_SIRAP_SOURCE_SPEC.expected_sha256
    assert metadata.catalog_sha256 == MARINE_SIRAP_SOURCE_SPEC.expected_catalog_sha256
    assert (
        metadata.geometry_collection_sha256
        == MARINE_SIRAP_SOURCE_SPEC.expected_geometry_collection_sha256
    )


def test_marine_siraps_append_only_for_marine_domain() -> None:
    land = BoundaryFeature(
        boundary_id="territorial_territorial_caribe_6",
        name="Territorial Caribe",
        geo_level="siraps",
        geometry={"type": "Polygon", "coordinates": []},
        properties={},
    )
    marine = BoundaryFeature(
        boundary_id="territorial_marine_caribe",
        name="Caribe marino",
        geo_level="siraps",
        geometry={"type": "Polygon", "coordinates": []},
        properties={"sirap_kind": "marine"},
    )
    base = {"siraps": [land], "departments": []}

    land_out = augment_boundaries_for_domain(base, "land", [marine])
    assert [feature.boundary_id for feature in land_out["siraps"]] == [
        "territorial_territorial_caribe_6"
    ]

    marine_out = augment_boundaries_for_domain(base, "marine", [marine])
    assert [feature.boundary_id for feature in marine_out["siraps"]] == [
        "territorial_territorial_caribe_6",
        "territorial_marine_caribe",
    ]
    assert base["siraps"] == [land]


def test_marine_provenance_pins_separate_sirap_source() -> None:
    land = build_metrics_provenance("land")
    marine = build_metrics_provenance("marine")

    assert MARINE_SIRAP_PROVENANCE_KEY not in land["boundaryProvenance"]["sources"]
    marine_source = marine["boundaryProvenance"]["sources"][MARINE_SIRAP_PROVENANCE_KEY]
    assert marine_source["sha256"] == MARINE_SIRAP_SOURCE_SPEC.expected_sha256
    assert marine_source["featureCount"] == 2
    assert provenance_issues({"metricsProvenance": land}, expected_domain="land") == []
    assert provenance_issues({"metricsProvenance": marine}, expected_domain="marine") == []

    sources = marine["boundaryProvenance"]["sources"]
    assert (
        expected_scope_boundary_source_sha256(
            "siraps",
            "territorial_marine_caribe",
            sources,
        )
        == MARINE_SIRAP_SOURCE_SPEC.expected_sha256
    )
    assert (
        expected_scope_boundary_source_sha256(
            "siraps",
            "territorial_territorial_caribe_6",
            sources,
        )
        == BOUNDARY_SOURCE_SPECS["siraps"].expected_sha256
    )
