from __future__ import annotations

import numpy as np
import pytest

from mec_compact import (
    SOURCE_MODE_COMPOSITE,
    build_composite_taxonomy,
    compute_scope_rows,
    load_composite_crosswalk,
)
from mec_compact import build_mec_taxonomy
from mec_national_denominator import (
    FORMAT,
    ROW_LAYOUT,
    build_document,
)


def _composite_content() -> str:
    return (
        "rasterValue,tipoEcosistema,biomeFamily,broadBiomeContext,"
        "biomeRegion,broadEcosystem,detailedEcosystem\n"
        "1,Bosque húmedo,Orobioma,Contexto Ándino,Orobioma Región Única,"
        "Bosque,Bosque húmedo montano\n"
        "2,Sabana,Orobioma,Contexto de sabana,Orobioma Región Única,"
        "Sabana,Sabana estacional\n"
        "3,Selva,Zonobioma,Contexto Amazónico,Zonobioma Región Única,"
        "Bosque,Selva húmeda tropical\n"
    )


def _composite_taxonomy():
    return build_composite_taxonomy(load_composite_crosswalk(_composite_content()))


def _iavh_taxonomy():
    return build_mec_taxonomy(
        {
            1: "Orobioma Test Region",
            2: "Zonobioma Test Region",
        }
    )


def _synthetic_grid_payload() -> dict:
    return {
        "width": 3,
        "height": 2,
        "crs": "EPSG:32618",
        "transform": [1.0, 0.0, 0.0, 0.0, -1.0, 2.0],
    }


def _synthetic_sources() -> dict:
    return {
        "mecRaster": "synthetic://composite.tif",
        "mecRasterSha256": "a" * 64,
        "crosswalk": "synthetic://composite.csv",
        "crosswalkSha256": "b" * 64,
        "provenance": "synthetic://provenance.json",
        "provenanceSha256": "c" * 64,
    }


def _build_synthetic_document(
    *,
    release_id: str = "sirap-test-release",
    taxonomy=None,
    values=None,
    national_mask=None,
    pixel_area_km2_per_row=None,
):
    values = np.asarray(
        values
        if values is not None
        else [[1.0, 2.0, 3.0], [1.0, np.nan, 2.0]],
        dtype=float,
    )
    national_mask = (
        np.ones_like(values, dtype=bool)
        if national_mask is None
        else np.asarray(national_mask, dtype=bool)
    )
    pixel_area_km2_per_row = (
        np.array([1.0, 2.0])
        if pixel_area_km2_per_row is None
        else np.asarray(pixel_area_km2_per_row, dtype=float)
    )
    return build_document(
        release_id=release_id,
        taxonomy=taxonomy or _composite_taxonomy(),
        values=values,
        national_mask=national_mask,
        pixel_area_km2_per_row=pixel_area_km2_per_row,
        sources=_synthetic_sources(),
        grid=_synthetic_grid_payload(),
        boundary={"level": "national", "sourceFingerprint": "synthetic"},
    )


def test_build_document_emits_versioned_contract_fields():
    document = _build_synthetic_document(release_id="release-2026-09")

    assert document["format"] == FORMAT == "mec-national-denominator-v1"
    assert document["releaseId"] == "release-2026-09"
    assert document["rowLayout"] == ROW_LAYOUT == ["classIndex", "nationalMecAreaKm2"]
    assert document["units"] == "km2"
    assert document["sourceMode"] == SOURCE_MODE_COMPOSITE
    assert document["scope"] == {
        "id": "colombia",
        "name": "Colombia",
        "semantics": (
            "Authoritative Colombia boundary with pixel-center inclusion; "
            "finite mapped MEC cells only; never clipped to solution support."
        ),
    }
    assert document["viewCatalog"] == _composite_taxonomy().view_catalog
    assert document["classCatalog"] == _composite_taxonomy().class_catalog
    assert len(document["rows"]) == len(_composite_taxonomy().classes)
    assert all(len(row) == 2 for row in document["rows"])
    assert all(row[0] == index for index, row in enumerate(document["rows"]))
    assert all(isinstance(row[1], float) for row in document["rows"])


def test_build_document_rows_sum_raster_codes_within_national_mask():
    taxonomy = _composite_taxonomy()
    values = np.array([[1.0, 2.0, 3.0], [1.0, np.nan, 2.0]])
    national_mask = np.array(
        [[True, True, True], [True, False, True]], dtype=bool
    )
    pixel_areas = np.array([1.0, 2.0])

    document = build_document(
        release_id="release-area-test",
        taxonomy=taxonomy,
        values=values,
        national_mask=national_mask,
        pixel_area_km2_per_row=pixel_areas,
        sources=_synthetic_sources(),
        grid=_synthetic_grid_payload(),
        boundary={"level": "national"},
    )

    national_area_by_class_index = {
        class_index: area for class_index, area in document["rows"]
    }
    code_areas = {1: 3.0, 2: 3.0, 3: 1.0}
    for class_index, item in enumerate(taxonomy.classes):
        expected = sum(code_areas.get(code, 0.0) for code in item.raster_values)
        assert national_area_by_class_index[class_index] == pytest.approx(expected)

    support = document["validNationalSupport"]
    assert support["boundaryAreaKm2"] == pytest.approx(7.0)
    assert support["classifiedMecAreaKm2"] == pytest.approx(7.0)
    assert support["unclassifiedMecAreaKm2"] == pytest.approx(0.0)


def test_build_document_rejects_mask_shape_mismatch():
    taxonomy = _composite_taxonomy()
    values = np.array([[1.0, 2.0], [3.0, 4.0]])
    national_mask = np.ones((2, 3), dtype=bool)

    with pytest.raises(ValueError, match="National boundary mask must match"):
        build_document(
            release_id="release-shape-test",
            taxonomy=taxonomy,
            values=values,
            national_mask=national_mask,
            pixel_area_km2_per_row=np.array([1.0, 2.0]),
            sources=_synthetic_sources(),
            grid=_synthetic_grid_payload(),
            boundary={"level": "national"},
        )


def test_national_class_percent_is_scope_area_over_denominator():
    ecosystem_values = np.array([[1.0, 1.0, 2.0], [2.0, np.nan, 1.0]])
    scope_mask = np.array(
        [[True, True, True], [False, False, False]], dtype=bool
    )
    pixel_areas = np.array([1.0, 2.0])
    taxonomy = _iavh_taxonomy()

    denominator = build_document(
        release_id="release-percent-test",
        taxonomy=taxonomy,
        values=ecosystem_values,
        national_mask=np.ones_like(ecosystem_values, dtype=bool),
        pixel_area_km2_per_row=pixel_areas,
        sources=_synthetic_sources(),
        grid=_synthetic_grid_payload(),
        boundary={"level": "national"},
    )
    national_area_by_class_index = dict(denominator["rows"])

    scope_rows = compute_scope_rows(
        scope_index=0,
        scope_mask=scope_mask,
        pre_existing_mask=np.zeros_like(scope_mask),
        new_prioritizr_mask=np.zeros_like(scope_mask),
        selected_mask=np.zeros_like(scope_mask),
        ecosystem_values=ecosystem_values,
        pixel_area_km2_per_row=pixel_areas,
        taxonomy=taxonomy,
    )

    expected_percent_by_class_index = {
        0: 50.0,
        1: 100 / 3,
        8: 50.0,
        9: 100 / 3,
    }
    for _, class_index, ecosystem_area_km2, *_ in scope_rows:
        national_area_km2 = national_area_by_class_index[class_index]
        national_class_percent = (ecosystem_area_km2 / national_area_km2) * 100
        assert national_class_percent == pytest.approx(
            expected_percent_by_class_index[class_index]
        )
