import json
from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest
import rasterio
from rasterio.transform import from_origin

import mec_compact
from blob_manifest import ManifestError, ResolvedManifest
from boundaries.boundary_loader import BoundaryFeature, BoundarySourceMetadata
from boundaries.boundary_mask import BoundaryMaskCache
from mec_compact import (
    BIOME_FAMILY_PREFIXES,
    COMPOSITE_PROVENANCE_FORMAT,
    MEC_COMPACT_FORMAT,
    MEC_RASTER_NODATA,
    OTHER_BIOME_FAMILY,
    SOURCE_MODE_COMPOSITE,
    SOURCE_MODE_IAVH,
    UI_VIEW_IDS,
    MecTaxonomyError,
    _artifact_is_resumable,
    _boundary_collection_metadata,
    _manifest_solution_catalog,
    _parse_args,
    _portable_source_reference,
    _resolve_source_path,
    _run_geography_levels,
    _scopes_for_level,
    _write_minified_json,
    build_mec_document,
    build_generation_signature,
    build_composite_taxonomy,
    build_mec_taxonomy,
    biome_family_for_label,
    compute_inventory_rows,
    compute_scope_rows,
    compute_scope_stats,
    expected_mec_blob_path,
    expected_mec_public_url,
    ecosystem_denominator_signature,
    load_composite_crosswalk,
    load_iavh_crosswalk,
    mec_output_path,
    read_mec_raster_values,
    resolve_source_metadata,
    resolve_national_target,
    validate_taxonomy_partition,
    validate_observed_raster_values,
    validate_mec_raster_source,
    validate_composite_provenance,
)
from raster_metrics import (
    RasterError,
    RasterFingerprint,
    SolutionRaster,
)


def _crosswalk():
    return {
        1: "Orobioma Test Region",
        2: "Zonobioma Test Region",
    }


def _summary():
    return {
        "version": "test-v1",
        "classifications": [
            {
                "view": "biomeRegion",
                "label": "IAvH Biome-Region Class",
                "valueCount": 2,
                "values": [
                    {"label": "Zonobioma Test Region"},
                    {"label": "Orobioma Test Region"},
                ],
            }
        ],
    }


def _composite_content():
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
    return build_composite_taxonomy(
        load_composite_crosswalk(_composite_content())
    )


def _composite_provenance(
    *,
    raster_sha256="a" * 64,
    crosswalk_sha256="b" * 64,
    row_count=3,
):
    return {
        "format": COMPOSITE_PROVENANCE_FORMAT,
        "generatedAt": "2026-07-23T00:00:00Z",
        "source": {"publisher": "IDEAM"},
        "catalog": {
            "rowCount": row_count,
            "crosswalkSha256": crosswalk_sha256,
            "crosswalkSignature": "catalog-signature",
            "tupleFields": [
                "tipo_ecos",
                "gran_bioma",
                "bioma_iavh",
                "ecos_sintesis",
                "ecos_general",
            ],
        },
        "grid": {"fingerprintSha256": "grid-signature"},
        "rasterization": {"dtype": "uint16", "nodata": 0},
        "outputs": {
            "compositeRaster": {"sha256": raster_sha256},
            "crosswalk": {"sha256": crosswalk_sha256},
        },
    }


def _taxonomy():
    return build_mec_taxonomy(_crosswalk(), summary=_summary())


def _signature(
    *,
    taxonomy=None,
    solution_url="https://example.test/solution.tif",
    mec_raster_url="https://example.test/ecosistemas_IAVH_2024.tif",
    crosswalk_content=(
        "biome,biome_id\n"
        "Orobioma Test Region,1\n"
        "Zonobioma Test Region,2\n"
    ),
    solution_raster_sha256="c" * 64,
    boundary_fingerprint="boundary-test",
):
    summary = _summary()
    return build_generation_signature(
        taxonomy=taxonomy or _taxonomy(),
        crosswalk_content=crosswalk_content,
        crosswalk_source="https://example.test/crosswalk.csv",
        classification_summary=summary,
        classification_summary_source="https://example.test/summary.json",
        provenance_source=None,
        provenance_sha256=None,
        manifest_url="https://example.test/manifest.json",
        mec_raster_url=mec_raster_url,
        mec_raster_sha256="a" * 64,
        solution_url=solution_url,
        solution_raster_sha256=solution_raster_sha256,
        solution_grid=RasterFingerprint(
            width=3,
            height=2,
            transform=(1.0, 0.0, 0.0, 0.0, -1.0, 2.0),
            crs="EPSG:32618",
        ),
        boundary_provenance={
            "departments": {"sourceFingerprint": boundary_fingerprint}
        },
        national_target={
            "applicability": "national-only",
            "targetPercent": 17,
        },
        aligned_mec_identity={
            "cacheKey": "1" * 64,
            "sourceSha256": "a" * 64,
            "alignedSha256": "2" * 64,
            "targetGridSha256": "3" * 64,
            "policySha256": "4" * 64,
        },
    )


def _composite_signature():
    return build_generation_signature(
        taxonomy=_composite_taxonomy(),
        crosswalk_content=_composite_content(),
        crosswalk_source="composite.csv",
        classification_summary=None,
        classification_summary_source=None,
        provenance_source="provenance.json",
        provenance_sha256="d" * 64,
        manifest_url="manifest.json",
        mec_raster_url="composite.tif",
        mec_raster_sha256="a" * 64,
        solution_url="solution.tif",
        solution_raster_sha256="c" * 64,
        solution_grid=RasterFingerprint(
            width=3,
            height=2,
            transform=(1.0, 0.0, 0.0, 0.0, -1.0, 2.0),
            crs="EPSG:32618",
        ),
        boundary_provenance={
            "departments": {"sourceFingerprint": "boundary-test"}
        },
        national_target={
            "applicability": "national-only",
            "targetPercent": 17,
        },
        aligned_mec_identity={
            "cacheKey": "1" * 64,
            "sourceSha256": "a" * 64,
            "alignedSha256": "2" * 64,
            "targetGridSha256": "3" * 64,
            "policySha256": "4" * 64,
        },
    )


def _raster(selected, *, pre_existing=None, new_prioritizr=None, valid=None):
    selected = np.asarray(selected, dtype=bool)
    height, width = selected.shape
    valid = np.ones_like(selected) if valid is None else np.asarray(valid, dtype=bool)
    if pre_existing is None and new_prioritizr is None:
        pre_existing = np.zeros_like(selected)
        new_prioritizr = selected
    return SolutionRaster(
        path=Path("synthetic.tif"),
        selected_mask=selected,
        valid_mask=valid,
        pixel_area_km2_per_row=np.array([1.0, 2.0]),
        fingerprint=RasterFingerprint(
            width=width,
            height=height,
            transform=(1.0, 0.0, 0.0, 0.0, -1.0, float(height)),
            crs="EPSG:32618",
        ),
        selected_cells=int(selected.sum()),
        valid_cells=int(valid.sum()),
        pre_existing_mask=np.asarray(pre_existing, dtype=bool),
        new_prioritizr_mask=np.asarray(new_prioritizr, dtype=bool),
    )


def test_formulas_use_solution_values_two_and_one():
    ecosystem_values = np.array(
        [[1.0, 1.0, 2.0], [2.0, np.nan, 1.0]]
    )
    pre_existing = np.array(
        [[True, False, False], [True, False, False]]
    )
    new_prioritizr = np.array(
        [[False, True, True], [False, True, False]]
    )
    selected = pre_existing | new_prioritizr

    taxonomy = _taxonomy()
    rows = compute_scope_rows(
        scope_index=0,
        scope_mask=np.ones_like(selected),
        pre_existing_mask=pre_existing,
        new_prioritizr_mask=new_prioritizr,
        selected_mask=selected,
        ecosystem_values=ecosystem_values,
        pixel_area_km2_per_row=np.array([1.0, 2.0]),
        taxonomy=taxonomy,
    )

    by_class_id = {
        taxonomy.classes[class_index].class_id: (
            ecosystem_area,
            pre_existing_area,
            new_prioritizr_area,
        )
        for (
            _,
            class_index,
            ecosystem_area,
            pre_existing_area,
            new_prioritizr_area,
        ) in rows
    }
    assert by_class_id["biomeFamily:orobioma"] == (4.0, 1.0, 1.0)
    assert by_class_id["biomeFamily:zonobioma"] == (3.0, 2.0, 1.0)
    assert by_class_id["biomeRegion:1"] == (4.0, 1.0, 1.0)
    assert by_class_id["biomeRegion:2"] == (3.0, 2.0, 1.0)
    for _, _, ecosystem_area, pre_existing_area, new_prioritizr_area in rows:
        assert pre_existing_area + new_prioritizr_area <= ecosystem_area


def test_sparse_rows_omit_classes_unavailable_in_scope():
    ecosystem_values = np.array(
        [[1.0, 1.0, 2.0], [2.0, np.nan, 1.0]]
    )
    only_class_a = np.array(
        [[True, True, False], [False, False, False]]
    )

    taxonomy = _taxonomy()
    rows = compute_scope_rows(
        scope_index=1,
        scope_mask=only_class_a,
        pre_existing_mask=np.zeros((2, 3), dtype=bool),
        new_prioritizr_mask=np.ones((2, 3), dtype=bool),
        selected_mask=np.ones((2, 3), dtype=bool),
        ecosystem_values=ecosystem_values,
        pixel_area_km2_per_row=np.array([1.0, 2.0]),
        taxonomy=taxonomy,
    )

    assert [
        taxonomy.classes[class_index].class_id
        for _, class_index, *_ in rows
    ] == ["biomeFamily:orobioma", "biomeRegion:1"]


def test_document_uses_shared_catalogs_for_two_scopes_and_classes():
    raster = _raster(
        [[True, True, True], [True, False, False]]
    )
    ecosystem_values = np.array(
        [[1.0, 1.0, 2.0], [2.0, np.nan, 1.0]]
    )
    scopes = [
        ("all", "All cells", np.ones((2, 3), dtype=bool)),
        (
            "top",
            "Top row",
            np.array([[True, True, True], [False, False, False]]),
        ),
    ]

    document = build_mec_document(
        solution_id="solution-one",
        geography_level="departments",
        scopes=scopes,
        raster=raster,
        ecosystem_values=ecosystem_values,
        taxonomy=_taxonomy(),
        mec_raster_source="mec.tif",
        mec_raster_sha256="a" * 64,
        crosswalk_source="crosswalk.csv",
        crosswalk_sha256="b" * 64,
        classification_summary_source="summary.json",
        provenance_source=None,
        provenance_sha256=None,
        solution_raster_source="solution.tif",
        solution_raster_sha256="c" * 64,
        observed_biome_ids={1, 2},
        boundary_provenance={
            "departments": {"sourceFingerprint": "boundary-test"}
        },
        national_target=resolve_national_target(
            {
                "id": "solution one",
                "finderInputs": {
                    "targetPercent": 17,
                    "targetFeatureSet": "strategic_ecosystems",
                    "targetFeatureIds": ["strategic_ecosystems"],
                },
            }
        ),
        generation_signature=_signature(),
        aligned_mec_identity={
            "cacheKey": "1" * 64,
            "sourceSha256": "a" * 64,
            "alignedSha256": "2" * 64,
            "targetGridSha256": "3" * 64,
            "policySha256": "4" * 64,
        },
        generated_at="2026-07-23T00:00:00Z",
    )

    assert document["format"] == MEC_COMPACT_FORMAT
    assert document["generationSignature"] == _signature()
    assert document["rowLayout"] == [
        "scopeIndex",
        "classIndex",
        "ecosystemAreaKm2",
        "preExistingCoverageKm2",
        "newPrioritizrCoverageKm2",
    ]
    assert document["scopeCatalog"] == [
        ["all", "All cells"],
        ["top", "Top row"],
    ]
    assert document["viewCatalog"] == [
        ["biomeFamily", "Biome Family"],
        ["biomeRegion", "IAvH Biome-Region Class"],
    ]
    assert len(document["classCatalog"]) == 10
    assert len(document["rows"]) == 8
    assert [item["view"] for item in document["viewSupport"]["supported"]] == [
        "biomeFamily",
        "biomeRegion",
    ]
    assert [item["view"] for item in document["viewSupport"]["unsupported"]] == [
        "broadBiomeContext",
        "broadEcosystem",
        "detailedEcosystem",
    ]
    assert document["sourceCoverage"] == {
        "mappedClassIdCount": 2,
        "observedClassIdCount": 2,
        "absentMappedClassIdCount": 0,
        "mappedBiomeIdCount": 2,
        "observedBiomeIdCount": 2,
        "absentMappedBiomeIdCount": 0,
    }
    assert "solution raster value 2" in document["semantics"]["preExistingCoverageKm2"]
    assert "nationalCoverageBenchmark" not in document
    assert document["scopeStats"]["0"] == {
        "scopeAreaKm2": 9.0,
        "classifiedKm2": 7.0,
        "unclassifiedKm2": 2.0,
        "boundaryProvenanceRef": "departments",
    }
    assert "Orobioma Test Region" not in str(document["rows"])


def test_ecosystem_denominator_is_solution_independent_and_ignores_valid_mask():
    ecosystem_values = np.array([[1.0, 2.0], [1.0, np.nan]])
    scope = np.ones((2, 2), dtype=bool)
    pixel_areas = np.array([1.0, 2.0])
    taxonomy = _taxonomy()

    empty_rows = compute_scope_rows(
        scope_index=0,
        scope_mask=scope,
        pre_existing_mask=np.zeros_like(scope),
        new_prioritizr_mask=np.zeros_like(scope),
        selected_mask=np.zeros_like(scope),
        ecosystem_values=ecosystem_values,
        pixel_area_km2_per_row=pixel_areas,
        taxonomy=taxonomy,
    )
    selected = np.array([[True, False], [True, False]])
    selected_rows = compute_scope_rows(
        scope_index=0,
        scope_mask=scope,
        pre_existing_mask=selected,
        new_prioritizr_mask=np.zeros_like(scope),
        selected_mask=selected,
        ecosystem_values=ecosystem_values,
        pixel_area_km2_per_row=pixel_areas,
        taxonomy=taxonomy,
    )

    assert [row[2] for row in empty_rows] == [row[2] for row in selected_rows]
    raster = _raster(
        selected,
        pre_existing=selected,
        new_prioritizr=np.zeros_like(scope),
        valid=np.array([[True, False], [True, False]]),
    )
    assert raster.valid_mask.sum() == 2
    assert compute_scope_stats(
        scope_mask=scope,
        ecosystem_values=ecosystem_values,
        pixel_area_km2_per_row=pixel_areas,
        boundary_provenance_ref="synthetic",
    ) == {
        "scopeAreaKm2": 6.0,
        "classifiedKm2": 4.0,
        "unclassifiedKm2": 2.0,
        "boundaryProvenanceRef": "synthetic",
    }
    first = {
        "geographyLevel": "departments",
        "scopeCatalog": [["one", "One"]],
        "scopeStats": {"0": {"classifiedKm2": 4.0}},
        "rows": empty_rows,
    }
    second = {
        **first,
        "rows": selected_rows,
    }
    assert ecosystem_denominator_signature(first) == ecosystem_denominator_signature(
        second
    )


def test_class_shares_sum_to_classified_over_scope_share():
    ecosystem_values = np.array([[1.0, 2.0], [1.0, np.nan]])
    scope = np.ones((2, 2), dtype=bool)
    pixel_areas = np.array([1.0, 2.0])
    rows = compute_scope_rows(
        scope_index=0,
        scope_mask=scope,
        pre_existing_mask=np.zeros_like(scope),
        new_prioritizr_mask=np.zeros_like(scope),
        selected_mask=np.zeros_like(scope),
        ecosystem_values=ecosystem_values,
        pixel_area_km2_per_row=pixel_areas,
        taxonomy=_taxonomy(),
    )
    stats = compute_scope_stats(
        scope_mask=scope,
        ecosystem_values=ecosystem_values,
        pixel_area_km2_per_row=pixel_areas,
        boundary_provenance_ref="synthetic",
    )
    first_view_area = sum(row[2] for row in rows if row[1] < 8)

    assert first_view_area / stats["scopeAreaKm2"] == pytest.approx(
        stats["classifiedKm2"] / stats["scopeAreaKm2"]
    )
    assert stats["classifiedKm2"] / stats["scopeAreaKm2"] < 1


def test_custom_area_inventory_rows_are_present_only_across_five_views():
    taxonomy = _composite_taxonomy()
    ecosystem_values = np.array([[1.0, 2.0], [1.0, np.nan]])
    scope = np.array([[True, False], [True, False]])

    rows = compute_inventory_rows(
        scope_mask=scope,
        ecosystem_values=ecosystem_values,
        pixel_area_km2_per_row=np.array([1.0, 2.0]),
        taxonomy=taxonomy,
    )

    assert len(rows) == len(UI_VIEW_IDS)
    assert {taxonomy.classes[row[1]].view_index for row in rows} == set(range(5))
    assert all(row[2] == pytest.approx(3.0) for row in rows)
    assert all(row[3:] == [0.0, 0.0] for row in rows)


def test_invalid_taxonomy_partition_and_solution_mask_invariants_fail():
    taxonomy = replace(
        _taxonomy(),
        classes=(
            *_taxonomy().classes,
            replace(_taxonomy().classes[0], class_id="duplicate"),
        ),
    )
    with pytest.raises(MecTaxonomyError, match="exactly one class per view"):
        validate_taxonomy_partition(taxonomy, {1})

    mask = np.array([[True]])
    with pytest.raises(AssertionError, match="overlap"):
        compute_scope_rows(
            scope_index=0,
            scope_mask=mask,
            pre_existing_mask=mask,
            new_prioritizr_mask=mask,
            selected_mask=mask,
            ecosystem_values=np.array([[1.0]]),
            pixel_area_km2_per_row=np.array([1.0]),
            taxonomy=_taxonomy(),
        )


def test_national_target_requires_authoritative_17_or_30_finder_metadata():
    solution = {
        "id": "target-30",
        "finderInputs": {
            "targetPercent": 30,
            "targetFeatureSet": "species_richness",
            "targetFeatureIds": ["species_richness"],
        },
    }
    benchmark = resolve_national_target(solution)

    assert benchmark["targetPercent"] == 30
    assert benchmark["applicability"] == "national-only"
    assert "not-solver-constraint" in benchmark["interpretation"]
    with pytest.raises(ManifestError, match="expected 17 or 30"):
        resolve_national_target(
            {"id": "bad", "finderInputs": {"targetPercent": 25}}
        )


def test_composite_taxonomy_emits_all_views_and_preserves_unicode_and_tipo():
    taxonomy = _composite_taxonomy()

    assert taxonomy.source_mode == SOURCE_MODE_COMPOSITE
    assert tuple(view.view_id for view in taxonomy.views) == UI_VIEW_IDS
    assert "Bosque húmedo" in taxonomy.tipo_ecosistema_catalog
    assert "Contexto Ándino" in {
        item.label for item in taxonomy.classes
    }
    shared_region = next(
        item
        for item in taxonomy.classes
        if item.view_index == 2 and item.label == "Orobioma Región Única"
    )
    assert shared_region.raster_values == (1, 2)
    assert len(taxonomy.source_tuple_catalog) == 3


def test_composite_document_marks_five_views_supported_and_retains_source_catalog():
    taxonomy = _composite_taxonomy()
    raster = _raster([[True, True, True], [False, False, False]])
    document = build_mec_document(
        solution_id="composite",
        geography_level="national",
        scopes=[("colombia", "Colombia", np.ones((2, 3), dtype=bool))],
        raster=raster,
        ecosystem_values=np.array([[1.0, 2.0, np.nan], [np.nan, np.nan, np.nan]]),
        taxonomy=taxonomy,
        mec_raster_source="composite.tif",
        mec_raster_sha256="a" * 64,
        crosswalk_source="composite.csv",
        crosswalk_sha256="b" * 64,
        classification_summary_source=None,
        provenance_source="provenance.json",
        provenance_sha256="d" * 64,
        solution_raster_source="solution.tif",
        solution_raster_sha256="c" * 64,
        observed_biome_ids={1, 2},
        boundary_provenance={
            "national": {"sourceFingerprint": "boundary-test"}
        },
        national_target=resolve_national_target(
            {
                "id": "composite",
                "finderInputs": {
                    "targetPercent": 30,
                    "targetFeatureSet": "strategic_ecosystems",
                    "targetFeatureIds": ["strategic_ecosystems"],
                },
            }
        ),
        generation_signature=_composite_signature(),
        aligned_mec_identity={
            "cacheKey": "1" * 64,
            "sourceSha256": "a" * 64,
            "alignedSha256": "2" * 64,
            "targetGridSha256": "3" * 64,
            "policySha256": "4" * 64,
        },
        generated_at="2026-07-23T00:00:00Z",
    )

    assert document["sourceMode"] == SOURCE_MODE_COMPOSITE
    assert [item["view"] for item in document["viewSupport"]["supported"]] == list(
        UI_VIEW_IDS
    )
    assert document["viewSupport"]["unsupported"] == []
    assert "Bosque húmedo" in document["tipoEcosistemaCatalog"]
    assert len(document["sourceTupleCatalog"]) == 3
    assert len(document["rows"]) == len(taxonomy.classes)
    assert any(row[2:] == [0.0, 0.0, 0.0] for row in document["rows"])
    assert document["nationalCoverageBenchmark"]["targetPercent"] == 30
    assert (
        document["nationalCoverageBenchmark"]["zeroAreaStatus"]
        == "not-applicable"
    )


def test_iavh_mode_remains_explicit_two_view_fallback():
    taxonomy = _taxonomy()

    assert taxonomy.source_mode == SOURCE_MODE_IAVH
    support = mec_compact.view_support_for_mode(taxonomy.source_mode)
    assert [item["view"] for item in support["supported"]] == [
        "biomeFamily",
        "biomeRegion",
    ]
    assert len(support["unsupported"]) == 3


def test_composite_is_default_and_iavh_requires_explicit_mode():
    assert _parse_args([]).source_mode == SOURCE_MODE_COMPOSITE
    assert _parse_args(["--source-mode", "iavh"]).source_mode == SOURCE_MODE_IAVH


def test_release_manifest_catalog_is_lexically_sorted_and_order_independent():
    manifest = ResolvedManifest(
        url="https://example.test/manifest.json",
        raw={},
        public_blob_host="https://example.test",
        layers_by_id={},
        national_solutions=[
            {"id": "land-z", "domain": "land"},
            {"id": "marine-a", "domain": "marine"},
            {"id": "land-a", "domain": "land"},
            {"id": "land-m", "domain": "land"},
        ],
    )

    land_solutions, known_ids, land_ids = _manifest_solution_catalog(manifest)

    assert land_ids == ["land-a", "land-m", "land-z"]
    assert [solution["id"] for solution in land_solutions] == land_ids
    assert known_ids == ["land-a", "land-m", "land-z", "marine-a"]


def test_composite_defaults_are_public_authoritative_bundle_urls():
    sources = resolve_source_metadata(SOURCE_MODE_COMPOSITE)

    assert sources == mec_compact.MecSourceMetadata(
        mec_raster=(
            "https://aagibolq28slyfof.public.blob.vercel-storage.com/"
            "inputs/features/ecosystems/ecosistemas_IDEAM_MEC_2024.tif"
        ),
        crosswalk=(
            "https://aagibolq28slyfof.public.blob.vercel-storage.com/"
            "inputs/features/ecosystems/ecosistemas_IDs_IDEAM_MEC_2024.csv"
        ),
        provenance=(
            "https://aagibolq28slyfof.public.blob.vercel-storage.com/"
            "inputs/features/ecosystems/"
            "ecosistemas_IDEAM_MEC_2024.provenance.json"
        ),
        classification_summary=None,
    )


def test_source_resolution_downloads_urls_and_preserves_explicit_local_paths(
    tmp_path, monkeypatch
):
    cached_path = tmp_path / "cache" / "downloaded.csv"
    calls = []

    def fake_cached_download(url, cache_dir, *, force):
        calls.append((url, cache_dir, force))
        return SimpleNamespace(path=cached_path)

    monkeypatch.setattr(mec_compact, "cached_download", fake_cached_download)
    cache_dir = tmp_path / "cache"
    url = "https://example.test/authoritative.csv"

    assert _resolve_source_path(url, cache_dir, force_download=True) == cached_path
    assert calls == [(url, cache_dir, True)]

    local_path = tmp_path / "offline" / "authoritative.csv"
    assert (
        _resolve_source_path(str(local_path), cache_dir, force_download=False)
        == local_path
    )
    assert calls == [(url, cache_dir, True)]


def test_source_metadata_preserves_explicit_offline_files():
    sources = resolve_source_metadata(
        SOURCE_MODE_COMPOSITE,
        mec_raster="offline/mec.tif",
        crosswalk="offline/mec.csv",
        provenance="offline/mec.provenance.json",
    )

    assert sources.mec_raster == "offline/mec.tif"
    assert sources.crosswalk == "offline/mec.csv"
    assert sources.provenance == "offline/mec.provenance.json"


def test_output_source_references_never_expose_absolute_local_paths(tmp_path):
    absolute = tmp_path / "private" / "mec.tif"

    assert _portable_source_reference(str(absolute)) == "mec.tif"
    assert (
        _portable_source_reference("offline/mec.tif")
        == "offline/mec.tif"
    )
    assert (
        _portable_source_reference(
            "https://example.test/mec.tif?token=private#fragment"
        )
        == "https://example.test/mec.tif"
    )


def test_boundary_provenance_exposes_validated_source_and_geometry_hashes():
    metadata = BoundarySourceMetadata(
        url="https://example.test/departments.geojson?token=private",
        sha256="a" * 64,
        crs="EPSG:4326",
        feature_count=1,
        id_field="boundary_id",
        name_field="boundary_name",
        catalog_sha256="b" * 64,
        geometry_collection_sha256="c" * 64,
        feature_behavior="matching_frontend_identify_feature",
    )
    feature = BoundaryFeature(
        boundary_id="05",
        name="Antioquia",
        geo_level="departments",
        geometry={
            "type": "Polygon",
            "coordinates": [[[0, 0], [0, 1], [1, 1], [0, 0]]],
        },
        properties={},
        source_metadata=metadata,
        geometry_sha256="d" * 64,
    )

    provenance = _boundary_collection_metadata("departments", [feature])

    assert provenance["sourceSha256"] == metadata.sha256
    assert provenance["catalogSha256"] == metadata.catalog_sha256
    assert (
        provenance["geometryCollectionSha256"]
        == metadata.geometry_collection_sha256
    )
    assert provenance["source"]["url"] == "https://example.test/departments.geojson"
    assert "private" not in json.dumps(provenance)


def test_generation_signature_covers_solution_and_boundary_fingerprints():
    baseline = _signature()

    assert baseline != _signature(solution_raster_sha256="d" * 64)
    assert baseline != _signature(boundary_fingerprint="replacement-boundary")


def test_generation_signature_invalidates_between_source_modes(tmp_path):
    path = tmp_path / "national.mec.compact.json"
    fallback_signature = _signature()
    path.write_text(
        json.dumps(
            {
                "format": MEC_COMPACT_FORMAT,
                "solutionId": "solution",
                "geographyLevel": "national",
                "generationSignature": fallback_signature,
                "rows": [],
            }
        ),
        encoding="utf-8",
    )

    assert fallback_signature != _composite_signature()
    assert not _artifact_is_resumable(
        path,
        solution_id="solution",
        geography_level="national",
        generation_signature=_composite_signature(),
    )


def test_path_contract_partitions_by_safe_solution_and_exact_geography():
    output_dir = Path("generated")

    assert mec_output_path(
        output_dir, "demo-solution-one", "omecs"
    ) == output_dir / "cache" / "demo-solution-one" / "omecs.mec.compact.json"
    assert expected_mec_blob_path(
        "demo-solution-one",
        "omecs",
        blob_directory="/custom/mec/",
    ) == "custom/mec/demo-solution-one/omecs.mec.compact.json"
    assert expected_mec_public_url(
        "https://example.test/",
        "demo-solution-one",
        "omecs",
    ) == (
        "https://example.test/metrics/mec-cache/"
        "demo-solution-one/omecs.mec.compact.json"
    )


def test_artifact_writer_uses_minified_json(tmp_path):
    path = tmp_path / "national.mec.compact.json"

    _write_minified_json(path, {"format": MEC_COMPACT_FORMAT, "rows": [[0, 0, 1, 0, 1]]})

    encoded = path.read_text(encoding="utf-8")
    assert encoded.endswith("\n")
    assert "\n" not in encoded.rstrip("\n")
    assert ": " not in encoded


def test_resume_requires_matching_versioned_taxonomy_config_and_sources(
    tmp_path, monkeypatch
):
    artifact_path = tmp_path / "national.mec.compact.json"
    signature = _signature()
    artifact = {
        "format": MEC_COMPACT_FORMAT,
        "solutionId": "solution",
        "geographyLevel": "national",
        "generationSignature": signature,
        "rowLayout": mec_compact.ROW_LAYOUT,
        "scopeStatsFields": list(mec_compact.SCOPE_STATS_FIELDS),
        "scopeCatalog": [["colombia", "Colombia"]],
        "scopeStats": {
            "0": {
                field: None
                for field in mec_compact.SCOPE_STATS_FIELDS
            }
        },
        "viewCatalog": [["broad", "Broad"]],
        "classCatalog": [[0, "class", "Class"]],
        "rows": [],
    }
    artifact_path.write_text(json.dumps(artifact), encoding="utf-8")

    assert _artifact_is_resumable(
        artifact_path,
        solution_id="solution",
        geography_level="national",
        generation_signature=signature,
    )
    full_binding = {
        "format": "solution-catalog-binding-v1",
        "releaseId": "species-release",
        "catalogVersion": "0.2.0",
        "catalogSha256": "a" * 64,
        "speciesException": {
            "format": "release-species-exception-binding-v1",
            "policyFormat": "release-species-exception-v1",
            "policyId": "species-release-policy",
            "policySha256": "b" * 64,
            "catalogTotal": 8300,
            "availableExpected": 8298,
            "excluded": 2,
        },
    }
    artifact["solutionCatalogBinding"] = full_binding
    artifact_path.write_text(json.dumps(artifact), encoding="utf-8")
    assert _artifact_is_resumable(
        artifact_path,
        solution_id="solution",
        geography_level="national",
        generation_signature=signature,
        expected_catalog_binding=full_binding,
    )
    artifact["solutionCatalogBinding"] = {
        key: value
        for key, value in full_binding.items()
        if key != "speciesException"
    }
    artifact_path.write_text(json.dumps(artifact), encoding="utf-8")
    assert not _artifact_is_resumable(
        artifact_path,
        solution_id="solution",
        geography_level="national",
        generation_signature=signature,
        expected_catalog_binding=full_binding,
    )
    artifact["solutionCatalogBinding"] = full_binding
    incomplete = dict(artifact)
    incomplete["scopeStats"] = {}
    artifact_path.write_text(json.dumps(incomplete), encoding="utf-8")
    assert not _artifact_is_resumable(
        artifact_path,
        solution_id="solution",
        geography_level="national",
        generation_signature=signature,
    )
    artifact_path.write_text(json.dumps(artifact), encoding="utf-8")
    assert not _artifact_is_resumable(
        artifact_path,
        solution_id="solution",
        geography_level="national",
        generation_signature=_signature(
            solution_url="https://example.test/replaced-solution.tif"
        ),
    )
    assert not _artifact_is_resumable(
        artifact_path,
        solution_id="solution",
        geography_level="national",
        generation_signature=_signature(
            mec_raster_url="https://example.test/replaced-IAVH.tif"
        ),
    )
    assert not _artifact_is_resumable(
        artifact_path,
        solution_id="solution",
        geography_level="national",
        generation_signature=_signature(
            crosswalk_content=(
                "biome,biome_id\n"
                "Orobioma Updated Region,1\n"
                "Zonobioma Test Region,2\n"
            )
        ),
    )

    changed_taxonomy = build_mec_taxonomy(
        {
            1: "Orobioma Test Region",
            7: "Zonobioma Test Region",
        }
    )
    assert not _artifact_is_resumable(
        artifact_path,
        solution_id="solution",
        geography_level="national",
        generation_signature=_signature(taxonomy=changed_taxonomy),
    )

    changed_views = replace(
        _taxonomy(),
        views=tuple(reversed(_taxonomy().views)),
    )
    assert not _artifact_is_resumable(
        artifact_path,
        solution_id="solution",
        geography_level="national",
        generation_signature=_signature(taxonomy=changed_views),
    )

    monkeypatch.setattr(
        mec_compact, "MEC_GENERATOR_CONFIG_VERSION", "mec-generator-config-v7"
    )
    assert not _artifact_is_resumable(
        artifact_path,
        solution_id="solution",
        geography_level="national",
        generation_signature=_signature(),
    )

    del artifact["generationSignature"]
    artifact_path.write_text(json.dumps(artifact), encoding="utf-8")
    assert not _artifact_is_resumable(
        artifact_path,
        solution_id="solution",
        geography_level="national",
        generation_signature=signature,
    )


def test_scopes_helper_honors_projected_boundary_source_crs():
    raster = _raster([[True, True], [True, True]])
    geometry = {
        "type": "Polygon",
        "coordinates": [
            [[0, 0], [0, 2], [2, 2], [2, 0], [0, 0]]
        ],
    }
    feature = BoundaryFeature(
        boundary_id="projected",
        name="Projected boundary",
        geo_level="departments",
        geometry=geometry,
        properties={},
        source_crs="EPSG:32618",
    )

    scopes = _scopes_for_level(
        "departments",
        raster=raster,
        boundaries_by_level={"departments": [feature]},
        boundary_masks=BoundaryMaskCache(),
    )

    assert scopes[0][0:2] == ("projected", "Projected boundary")
    assert scopes[0][2].tolist() == [[True, True], [True, True]]
    assert scopes[0][3] == "departments"


def test_scopes_helper_forwards_boundary_source_and_geometry_fingerprints():
    raster = _raster([[True, True], [True, True]])
    geometry = {
        "type": "Polygon",
        "coordinates": [[[0, 0], [0, 2], [2, 2], [2, 0], [0, 0]]],
    }
    metadata = BoundarySourceMetadata(
        url="https://example.test/departments.geojson",
        sha256="a" * 64,
        crs="EPSG:32618",
        feature_count=1,
        id_field="boundary_id",
        name_field="boundary_name",
        catalog_sha256="b" * 64,
        geometry_collection_sha256="c" * 64,
        feature_behavior="matching_frontend_identify_feature",
    )
    feature = BoundaryFeature(
        boundary_id="05",
        name="Antioquia",
        geo_level="departments",
        geometry=geometry,
        properties={},
        source_crs="EPSG:32618",
        source_metadata=metadata,
        geometry_sha256="d" * 64,
    )

    class RecordingMaskCache:
        def __init__(self):
            self.kwargs = None

        def get(self, *args, **kwargs):
            self.kwargs = kwargs
            return np.ones((2, 2), dtype=bool)

    cache = RecordingMaskCache()
    _scopes_for_level(
        "departments",
        raster=raster,
        boundaries_by_level={"departments": [feature]},
        boundary_masks=cache,
    )

    assert cache.kwargs == {
        "source_crs": "EPSG:32618",
        "source_sha256": "a" * 64,
        "geometry_sha256": "d" * 64,
    }


def test_geography_failures_are_isolated_and_later_levels_continue():
    attempted = []

    def generate(level):
        attempted.append(level)
        if level == "departments":
            raise RuntimeError("projected boundary failed")
        return {"solutionId": "solution", "geographyLevel": level}

    entries, failures = _run_geography_levels(
        solution_id="solution",
        levels=["national", "departments", "municipalities"],
        generate_level=generate,
    )

    assert attempted == ["national", "departments", "municipalities"]
    assert [entry["geographyLevel"] for entry in entries] == [
        "national",
        "municipalities",
    ]
    assert len(failures) == 1
    assert failures[0]["geographyLevel"] == "departments"


@pytest.mark.parametrize("family", BIOME_FAMILY_PREFIXES)
def test_biome_family_rollup_covers_every_established_prefix(family):
    assert biome_family_for_label(f"{family} Example") == family


@pytest.mark.parametrize("label", ["N.A.", " N.A. ", "\tN.A.\n"])
def test_biome_family_rollup_accepts_only_trimmed_exact_na(label):
    assert biome_family_for_label(label) == OTHER_BIOME_FAMILY


@pytest.mark.parametrize(
    "label",
    ["Unrecognized biome", "", "N.A. extra", " Orobioma Example"],
)
def test_biome_family_rollup_rejects_unknown_or_broadened_labels(label):
    with pytest.raises(MecTaxonomyError, match="Unknown biome-family prefix"):
        biome_family_for_label(label)


def test_composite_crosswalk_accepts_na_only_with_canonical_other_family():
    content = (
        "rasterValue,tipoEcosistema,biomeFamily,broadBiomeContext,"
        "biomeRegion,broadEcosystem,detailedEcosystem\n"
        "516,Sin información,Other/N.A.,N.A., N.A. ,N.A.,N.A.\n"
    )

    rows = load_composite_crosswalk(content)

    assert rows[0].labels[0] == OTHER_BIOME_FAMILY
    assert rows[0].labels[2] == " N.A. "


def test_composite_crosswalk_canonicalizes_known_label_variants():
    content = (
        "rasterValue,tipoEcosistema,biomeFamily,broadBiomeContext,"
        "biomeRegion,broadEcosystem,detailedEcosystem\n"
        "1,Bosque,Zonobioma,Contexto,"
        "Zonobioma Alternohigrico Tropical  Cordillera Oriental Magdalena Medio,"
        "Vegetacion Secundaria,Detalle A\n"
        "2,Bosque,Zonobioma,Contexto,"
        "Zonobioma Alternohigrico Tropical Cordillera Oriental Magdalena Medio,"
        "Vegetación Secundaria,Detalle B\n"
    )

    rows = load_composite_crosswalk(content)
    taxonomy = build_composite_taxonomy(rows)

    assert rows[0].labels[2] == rows[1].labels[2]
    assert rows[0].labels[3] == rows[1].labels[3] == "Vegetación Secundaria"
    broad_ecosystem_index = 3
    broad_classes = [
        item for item in taxonomy.classes if item.view_index == broad_ecosystem_index
    ]
    assert len(broad_classes) == 1
    assert broad_classes[0].raster_values == (1, 2)


@pytest.mark.parametrize("family", ["Orobioma", " Other/N.A. "])
def test_composite_crosswalk_rejects_na_family_mismatch(family):
    content = (
        "rasterValue,tipoEcosistema,biomeFamily,broadBiomeContext,"
        "biomeRegion,broadEcosystem,detailedEcosystem\n"
        f"516,Sin información,{family},N.A.,N.A.,N.A.,N.A.\n"
    )

    with pytest.raises(MecTaxonomyError, match="inconsistent"):
        load_composite_crosswalk(content)


def test_composite_crosswalk_rejects_unknown_non_na_region():
    content = (
        "rasterValue,tipoEcosistema,biomeFamily,broadBiomeContext,"
        "biomeRegion,broadEcosystem,detailedEcosystem\n"
        "517,Desconocido,Other/N.A.,Otro,Unknown Region,Otro,Otro\n"
    )

    with pytest.raises(MecTaxonomyError, match="Unknown biome-family prefix"):
        load_composite_crosswalk(content)


def test_authoritative_crosswalk_requires_all_430_ids():
    content = "biome,biome_id\n" + "\n".join(
        f"Orobioma Region {biome_id},{biome_id}"
        for biome_id in range(1, 431)
    )

    mapping = load_iavh_crosswalk(content)

    assert len(mapping) == 430
    assert mapping[1] == "Orobioma Region 1"
    assert mapping[430] == "Orobioma Region 430"


def test_crosswalk_labels_match_summary_independent_of_row_order():
    taxonomy = build_mec_taxonomy(_crosswalk(), summary=_summary())

    assert [view.view_id for view in taxonomy.views] == [
        "biomeFamily",
        "biomeRegion",
    ]
    assert taxonomy.classes[-2].raster_values == (1,)
    assert taxonomy.classes[-1].raster_values == (2,)


def test_crosswalk_summary_label_mismatch_is_fatal():
    summary = _summary()
    summary["classifications"][0]["values"][0]["label"] = "Different label"

    with pytest.raises(MecTaxonomyError, match="do not match"):
        build_mec_taxonomy(_crosswalk(), summary=summary)


def test_authoritative_mapping_hard_stop_and_richness_source_rejection():
    with pytest.raises(MecTaxonomyError, match="crosswalk is required"):
        build_mec_taxonomy({})
    with pytest.raises(MecTaxonomyError, match="species-richness"):
        validate_mec_raster_source(
            "https://example.test/inputs/features/ecosystems/ecosistemas.tif"
        )


@pytest.mark.parametrize(
    ("content", "message"),
    [
        (
            _composite_content().replace(
                "2,Sabana",
                "1,Sabana",
            ),
            "repeats rasterValue",
        ),
        (
            _composite_content().replace(
                "2,Sabana,Orobioma,Contexto de sabana,Orobioma Región Única,"
                "Sabana,Sabana estacional",
                "2,Bosque húmedo,Orobioma,Contexto Ándino,Orobioma Región Única,"
                "Bosque,Bosque húmedo montano",
            ),
            "repeats a category tuple",
        ),
        (
            _composite_content().replace("1,Bosque húmedo,", "1,,"),
            "empty required label",
        ),
    ],
)
def test_composite_crosswalk_rejects_duplicate_or_missing_contract_data(
    content, message
):
    with pytest.raises(MecTaxonomyError, match=message):
        load_composite_crosswalk(content)


def test_composite_provenance_rejects_malformed_contract_and_checksums():
    provenance = _composite_provenance()
    validate_composite_provenance(
        provenance,
        raster_sha256="a" * 64,
        crosswalk_sha256="b" * 64,
        crosswalk_row_count=3,
    )

    malformed = _composite_provenance()
    malformed["outputs"]["compositeRaster"]["sha256"] = "wrong"
    with pytest.raises(MecTaxonomyError, match="compositeRaster"):
        validate_composite_provenance(
            malformed,
            raster_sha256="a" * 64,
            crosswalk_sha256="b" * 64,
            crosswalk_row_count=3,
        )

    malformed = _composite_provenance()
    malformed["catalog"]["tupleFields"] = ["wrong"]
    with pytest.raises(MecTaxonomyError, match="tupleFields"):
        validate_composite_provenance(
            malformed,
            raster_sha256="a" * 64,
            crosswalk_sha256="b" * 64,
            crosswalk_row_count=3,
        )


def test_observed_nodata_and_absent_mapped_ids_are_allowed():
    observed = validate_observed_raster_values(
        np.array([[1.0, np.nan]]),
        {1: "One", 2: "Two"},
    )

    assert observed == {1}


def test_unknown_or_out_of_range_observed_ids_are_fatal():
    with pytest.raises(MecTaxonomyError, match="absent from"):
        validate_observed_raster_values(
            np.array([[1.0, 2.0]]),
            {1: "One"},
        )
    with pytest.raises(MecTaxonomyError, match="outside 1–430"):
        validate_observed_raster_values(
            np.array([[431.0]]),
            {431: "Invalid"},
        )


def test_raster_grid_mismatch_fails_without_resampling(tmp_path):
    layer_path = tmp_path / "ecosistemas_IAVH_2024.tif"
    data = np.array([[1, 2]], dtype=np.uint32)
    with rasterio.open(
        layer_path,
        "w",
        driver="GTiff",
        height=1,
        width=2,
        count=1,
        dtype=data.dtype,
        crs="EPSG:32618",
        transform=from_origin(0, 1, 1, 1),
        nodata=MEC_RASTER_NODATA,
    ) as dataset:
        dataset.write(data, 1)

    wrong_grid = RasterFingerprint(
        width=3,
        height=1,
        transform=(1.0, 0.0, 0.0, 0.0, -1.0, 1.0),
        crs="EPSG:32618",
    )
    with pytest.raises(RasterError, match="does not align"):
        read_mec_raster_values(layer_path, wrong_grid, _taxonomy())


def test_raster_requires_authoritative_nodata(tmp_path):
    layer_path = tmp_path / "wrong-nodata.tif"
    data = np.array([[1]], dtype=np.uint32)
    with rasterio.open(
        layer_path,
        "w",
        driver="GTiff",
        height=1,
        width=1,
        count=1,
        dtype=data.dtype,
        crs="EPSG:32618",
        transform=from_origin(0, 1, 1, 1),
        nodata=999,
    ) as dataset:
        dataset.write(data, 1)

    fingerprint = RasterFingerprint(
        width=1,
        height=1,
        transform=(1.0, 0.0, 0.0, 0.0, -1.0, 1.0),
        crs="EPSG:32618",
    )
    with pytest.raises(RasterError, match="must declare nodata"):
        read_mec_raster_values(layer_path, fingerprint, _taxonomy())


def test_raster_requires_uint32_biome_ids(tmp_path):
    layer_path = tmp_path / "wrong-dtype.tif"
    data = np.array([[1]], dtype=np.uint16)
    with rasterio.open(
        layer_path,
        "w",
        driver="GTiff",
        height=1,
        width=1,
        count=1,
        dtype=data.dtype,
        crs="EPSG:32618",
        transform=from_origin(0, 1, 1, 1),
        nodata=65535,
    ) as dataset:
        dataset.write(data, 1)

    fingerprint = RasterFingerprint(
        width=1,
        height=1,
        transform=(1.0, 0.0, 0.0, 0.0, -1.0, 1.0),
        crs="EPSG:32618",
    )
    with pytest.raises(RasterError, match="must use uint32"):
        read_mec_raster_values(layer_path, fingerprint, _taxonomy())


def test_composite_raster_requires_uint16_nodata_zero_and_known_ids(tmp_path):
    layer_path = tmp_path / "ecosistemas_IDEAM_MEC_2024.tif"
    data = np.array([[1, 2, 0]], dtype=np.uint16)
    with rasterio.open(
        layer_path,
        "w",
        driver="GTiff",
        height=1,
        width=3,
        count=1,
        dtype=data.dtype,
        crs="EPSG:32618",
        transform=from_origin(0, 1, 1, 1),
        nodata=0,
    ) as dataset:
        dataset.write(data, 1)
    fingerprint = RasterFingerprint(
        width=3,
        height=1,
        transform=(1.0, 0.0, 0.0, 0.0, -1.0, 1.0),
        crs="EPSG:32618",
    )

    values, observed = read_mec_raster_values(
        layer_path,
        fingerprint,
        _composite_taxonomy(),
    )

    assert observed == {1, 2}
    assert np.isnan(values[0, 2])

    with rasterio.open(layer_path, "r+") as dataset:
        dataset.write(np.array([[1, 4, 0]], dtype=np.uint16), 1)
    with pytest.raises(MecTaxonomyError, match="absent from"):
        read_mec_raster_values(
            layer_path,
            fingerprint,
            _composite_taxonomy(),
        )
