from __future__ import annotations

import json
from pathlib import Path

import main as pipeline
import numpy as np
import pytest
from backfill_land_use_of_aoi import (
    CLC_ENCODING_CLASSIC_IDEAM,
    CLC_ENCODING_NATIONAL_REMAPPED,
    LAND_USE_OF_AOI_METRIC_IDS,
    LAND_USE_SELECTED_PCT_METRIC_IDS,
    PACKET_ALIGNMENT_FORMAT,
    SourcePinError,
    append_land_use_of_aoi_rows,
    assert_boundary_specs_unmoved,
    assert_file_sha256,
    assert_source_pins_match,
    backfill_verbose_document,
    clc_layer_renderings,
    compute_land_use_of_aoi_percents,
    discover_metric_paths,
    expected_backfill_metric_ids,
    extract_source_pins,
    restamp_catalog_signature,
    run_backfill,
    upsert_land_use_rows,
)
from blob_manifest import ResolvedManifest, _validate_and_index
from boundaries.boundary_loader import BOUNDARY_SOURCE_SPECS
from calculators.land_cover import corine_level_1_pct, corine_level_1_pct_of_aoi
from compact_metrics import to_compact_document, to_verbose_document
from metric_definitions import METRIC_CATALOG, computable_metrics, deferred_metric_ids
from metrics_contract import PROVENANCE_KEY, catalog_signature
from raster_metrics import RasterFingerprint, SolutionRaster


def _raster(*, selected: np.ndarray, valid: np.ndarray) -> SolutionRaster:
    height, width = selected.shape
    return SolutionRaster(
        path=Path("fixture.tif"),
        selected_mask=selected,
        valid_mask=valid,
        pixel_area_km2_per_row=np.ones(height, dtype=np.float64),
        fingerprint=RasterFingerprint(
            width=width,
            height=height,
            transform=(1.0, 0.0, 0.0, 0.0, -1.0, 0.0),
            crs="EPSG:9377",
        ),
        selected_cells=int(selected.sum()),
        valid_cells=int(valid.sum()),
    )


def _masks(*, agri: np.ndarray) -> dict[str, np.ndarray]:
    empty = np.zeros_like(agri, dtype=bool)
    return {
        "coberturas_artificial_surfaces": empty,
        "coberturas_agricultural_areas": agri,
        "coberturas_forests_and_semi_natural_areas": empty,
        "coberturas_wetlands": empty,
        "coberturas_water_bodies": empty,
    }


def _coberturas_entry(sha256: str = "c" * 64) -> dict:
    return {
        "inputId": "layer:coberturas_agricultural_areas",
        "sourceUrl": "https://example.test/boundaries/coberturas.tif",
        "sourceSha256": sha256,
        "alignedSha256": "d" * 64,
        "cacheKey": "e" * 64,
    }


def _document(
    *,
    solution_id: str = "demo",
    agri_pct: float = 12.1,
    empty_department: bool = False,
    coberturas_sha: str = "c" * 64,
    extra_metrics: list[dict] | None = None,
    domain: str = "land",
) -> dict:
    old_rows = [
        {
            "metricId": "land_use_agricultural_areas_pct",
            "value": agri_pct,
            "unit": "%",
            "status": "ready",
            "source": "raster:coberturas_agricultural_areas",
            "notes": "selected %",
            "labelKey": "metrics.tier1.land_use_agricultural_areas_pct",
            "formatHint": "percent",
        }
    ]
    if extra_metrics:
        old_rows.extend(extra_metrics)
    department_metrics = [dict(row) for row in old_rows]
    return {
        "solutionId": solution_id,
        "generatedAt": "2026-09-03T00:00:00Z",
        PROVENANCE_KEY: {
            "schemaVersion": 4,
            "solutionDomain": domain,
            "generationConfig": {
                "nationalOnly": False,
                "regionalPacket": False,
                "boundaryFanout": {
                    "requestedMode": "legacy",
                    "effectiveMode": "legacy",
                    "algorithmVersion": "boundary-fanout-dense-mask-v1",
                },
                "weightedBoundaryExecution": {
                    "requestedMode": "scalar",
                    "effectiveMode": "scalar",
                    "algorithmVersion": "scalar-weighted-boundary-v1",
                    "preparationAlgorithmVersion": None,
                    "registryPolicyVersion": "weighted-additive-registry-v1",
                    "allowlistSha256": "f" * 64,
                },
            },
            "catalogSignature": "metrics-catalog-v4:" + "a" * 64,
            "boundaryProvenance": {
                "format": "boundary-provenance-v1",
                "sources": {
                    "municipalities": {
                        "sha256": BOUNDARY_SOURCE_SPECS["municipalities"].expected_sha256,
                    }
                },
            },
            "inputAlignment": {
                "format": "metrics-domain-alignment-inventory-v1",
                "domain": domain,
                "targetGridSha256": "b" * 64,
                "entries": [_coberturas_entry(coberturas_sha)],
            },
        },
        "geographies": {
            "national": {
                "colombia": {
                    "name": "Colombia",
                    "scopeState": {
                        "classification": "supported",
                        "solutionValidCellCount": 4,
                    },
                    "metrics": old_rows,
                }
            },
            "departments": {
                "05": {
                    "name": "Antioquia",
                    "scopeState": {
                        "classification": "empty" if empty_department else "supported",
                        "solutionValidCellCount": 0 if empty_department else 2,
                    },
                    "metrics": department_metrics,
                }
            },
        },
    }


def _manifest(solution: dict) -> ResolvedManifest:
    return _validate_and_index(
        "https://example.test/manifest.json",
        {
            "publicBlobHost": "https://example.test",
            "layers": [
                {
                    "id": "dummy",
                    "displayUrl": "https://example.test/dummy.tif",
                }
            ],
            "solutions": [solution],
        },
    )


def _aoi_values(agricultural: float = 10.0) -> dict[str, float]:
    return {
        metric_id: agricultural if "agricultural" in metric_id else 0.0
        for metric_id in LAND_USE_OF_AOI_METRIC_IDS
    }


def _selected_values(forest: float = 80.0) -> dict[str, float]:
    return {
        metric_id: forest if "forests" in metric_id else 0.0
        for metric_id in LAND_USE_SELECTED_PCT_METRIC_IDS
    }


def test_computable_catalog_appends_five_of_aoi_ids_before_deferred():
    ids = [definition.metric_id for definition in computable_metrics()]
    catalog_ids = [definition.metric_id for definition in METRIC_CATALOG]

    assert list(LAND_USE_OF_AOI_METRIC_IDS) == [
        "land_use_artificial_surfaces_pct_of_aoi",
        "land_use_agricultural_areas_pct_of_aoi",
        "land_use_forests_and_semi_natural_areas_pct_of_aoi",
        "land_use_wetlands_pct_of_aoi",
        "land_use_water_bodies_pct_of_aoi",
    ]
    assert ids[-5:] == list(LAND_USE_OF_AOI_METRIC_IDS)
    assert expected_backfill_metric_ids()[-5:] == list(LAND_USE_OF_AOI_METRIC_IDS)
    for old_id in (
        "land_use_artificial_surfaces_pct",
        "land_use_agricultural_areas_pct",
        "land_use_forests_and_semi_natural_areas_pct",
        "land_use_wetlands_pct",
        "land_use_water_bodies_pct",
    ):
        assert old_id in ids
        assert ids.index(old_id) < ids.index(f"{old_id}_of_aoi")
    assert catalog_ids.index("land_use_water_bodies_pct_of_aoi") < catalog_ids.index(
        "agreement_area"
    )
    assert "agreement_area" in deferred_metric_ids()


def test_of_aoi_is_not_grouped_fanout():
    assert "binary_overlap_percent_of_aoi" not in pipeline._GROUPED_METRIC_KINDS


def test_of_aoi_uses_valid_mask_not_selected_mask():
    selected = np.array([[True, False], [False, False]])
    valid = np.array([[True, True], [True, False]])
    class_mask = np.array([[True, True], [False, False]])
    raster = _raster(selected=selected, valid=valid)

    assert corine_level_1_pct(raster, class_mask) == 100.0
    assert corine_level_1_pct_of_aoi(raster, class_mask) == (2.0 / 3.0) * 100.0


def test_backfill_and_replay_share_calculator_values():
    selected = np.array([[True, False], [False, False]])
    valid = np.array([[True, True], [True, True]])
    agri = np.array([[True, True], [False, False]])
    raster = _raster(selected=selected, valid=valid)
    masks = _masks(agri=agri)

    backfill = compute_land_use_of_aoi_percents(raster, masks)
    replay = {
        metric_id: corine_level_1_pct_of_aoi(raster, masks[layer])
        for metric_id, layer in {
            "land_use_artificial_surfaces_pct_of_aoi": "coberturas_artificial_surfaces",
            "land_use_agricultural_areas_pct_of_aoi": "coberturas_agricultural_areas",
            "land_use_forests_and_semi_natural_areas_pct_of_aoi": "coberturas_forests_and_semi_natural_areas",
            "land_use_wetlands_pct_of_aoi": "coberturas_wetlands",
            "land_use_water_bodies_pct_of_aoi": "coberturas_water_bodies",
        }.items()
    }

    assert backfill == replay
    assert backfill["land_use_agricultural_areas_pct_of_aoi"] == 50.0


def test_backfill_matches_pipeline_overlap_from_mask():
    selected = np.array([[True, False], [False, False]])
    valid = np.array([[True, True], [True, True]])
    agri = np.array([[True, True], [False, False]])
    raster = _raster(selected=selected, valid=valid)
    masks = _masks(agri=agri)
    definition = next(
        item
        for item in computable_metrics()
        if item.metric_id == "land_use_agricultural_areas_pct_of_aoi"
    )

    backfill = compute_land_use_of_aoi_percents(raster, masks)
    pipeline_row = pipeline._compute_overlap_from_mask(
        definition,
        raster,
        agri,
        "coberturas_agricultural_areas",
        {"valueType": "binary", "selectedValue": 2},
    )

    assert pipeline_row["value"] == backfill["land_use_agricultural_areas_pct_of_aoi"]
    assert pipeline_row["value"] == 50.0
    assert pipeline_row["status"] == "ready"
    assert pipeline_row["notes"] == (
        "(AOI ∩ 'coberturas_agricultural_areas') / aoi_area × 100."
    )


def test_build_metrics_of_aoi_uses_valid_mask_not_selected(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    selected = np.array([[True, False], [False, False]])
    valid = np.array([[True, True], [True, True]])
    agri = np.array([[True, True], [False, False]])
    raster = _raster(selected=selected, valid=valid)
    masks = _masks(agri=agri)
    of_aoi = tuple(
        item
        for item in computable_metrics()
        if item.kind == "binary_overlap_percent_of_aoi"
    )
    selected_pct = next(
        item
        for item in computable_metrics()
        if item.metric_id == "land_use_agricultural_areas_pct"
    )
    monkeypatch.setattr(pipeline, "computable_metrics", lambda: of_aoi + (selected_pct,))
    solution = {
        "id": "land",
        "scope": "nacional",
        "domain": "land",
        "displayUrl": "https://example.test/land.tif",
        "blobPath": "solutions/land.tif",
    }

    metrics = pipeline._build_metrics(
        raster,
        solution,
        _manifest(solution),
        pipeline._LayerMaskCache(),
        pipeline._LayerValueCache(),
        tmp_path,
        False,
        preloaded_layer_masks=masks,
    )
    by_id = {row["metricId"]: row for row in metrics}

    assert by_id["land_use_agricultural_areas_pct"]["value"] == 100.0
    assert by_id["land_use_agricultural_areas_pct_of_aoi"]["value"] == 50.0
    assert by_id["land_use_artificial_surfaces_pct_of_aoi"]["value"] == 0.0


def test_append_keeps_old_rows_and_adds_catalog_tail():
    old_rows = [
        {
            "metricId": "land_use_agricultural_areas_pct",
            "value": 12.1,
            "status": "ready",
        }
    ]
    values = _aoi_values(10.0)
    merged = append_land_use_of_aoi_rows(old_rows, values)

    assert merged[0]["metricId"] == "land_use_agricultural_areas_pct"
    assert merged[0]["value"] == 12.1
    assert [row["metricId"] for row in merged[1:]] == list(LAND_USE_OF_AOI_METRIC_IDS)
    assert expected_backfill_metric_ids()[-5:] == list(LAND_USE_OF_AOI_METRIC_IDS)
    assert computable_metrics()[-1].metric_id == "land_use_water_bodies_pct_of_aoi"


def test_append_empty_scope_uses_empty_status():
    merged = append_land_use_of_aoi_rows(
        [{"metricId": "land_use_agricultural_areas_pct", "value": None}],
        {},
        empty_scope=True,
    )

    assert merged[0]["metricId"] == "land_use_agricultural_areas_pct"
    assert [row["status"] for row in merged[1:]] == ["empty"] * 5
    assert all(row["value"] is None for row in merged[1:])


def test_restamp_catalog_signature_uses_existing_generation_config():
    document = _document()
    config = document[PROVENANCE_KEY]["generationConfig"]
    expected = catalog_signature("land", config)

    stamped = restamp_catalog_signature(document)

    assert stamped[PROVENANCE_KEY]["catalogSignature"] == expected
    assert stamped[PROVENANCE_KEY]["generationConfig"] == config
    assert document[PROVENANCE_KEY]["catalogSignature"] != expected


def test_backfill_document_keeps_old_pct_and_stamps_same_aoi_values():
    values = {
        ("national", "colombia"): _aoi_values(33.0),
        ("departments", "05"): _aoi_values(33.0),
    }
    first = backfill_verbose_document(_document(solution_id="a", agri_pct=12.1), values)
    second = backfill_verbose_document(_document(solution_id="b", agri_pct=99.9), values)

    first_national = first["geographies"]["national"]["colombia"]["metrics"]
    second_national = second["geographies"]["national"]["colombia"]["metrics"]
    assert first_national[0]["value"] == 12.1
    assert second_national[0]["value"] == 99.9
    assert first_national[1:] == second_national[1:]
    assert first_national[1]["metricId"] == "land_use_artificial_surfaces_pct_of_aoi"
    assert first_national[2]["value"] == 33.0
    assert first[PROVENANCE_KEY]["catalogSignature"] == catalog_signature(
        "land",
        first[PROVENANCE_KEY]["generationConfig"],
    )


def test_backfill_replaces_selected_pct_when_provided():
    of_aoi = {
        ("national", "colombia"): _aoi_values(33.0),
        ("departments", "05"): _aoi_values(33.0),
    }
    selected = {
        ("national", "colombia"): _selected_values(80.0),
        ("departments", "05"): _selected_values(10.0),
    }
    document = _document(agri_pct=12.1)
    document["geographies"]["national"]["colombia"]["metrics"].insert(
        0,
        {
            "metricId": "land_use_artificial_surfaces_pct",
            "value": 99.0,
            "unit": "%",
            "status": "ready",
        },
    )

    updated = backfill_verbose_document(document, of_aoi, selected)
    national = {
        row["metricId"]: row["value"]
        for row in updated["geographies"]["national"]["colombia"]["metrics"]
    }

    assert national["land_use_agricultural_areas_pct"] == 0.0
    assert national["land_use_artificial_surfaces_pct"] == 0.0
    assert national["land_use_forests_and_semi_natural_areas_pct"] == 80.0
    assert national["land_use_forests_and_semi_natural_areas_pct_of_aoi"] == 0.0
    assert national["land_use_agricultural_areas_pct_of_aoi"] == 33.0


def test_upsert_replaces_existing_of_aoi_rows():
    rows = append_land_use_of_aoi_rows(
        [{"metricId": "land_use_agricultural_areas_pct", "value": 12.1}],
        _aoi_values(1.0),
    )
    replaced = upsert_land_use_rows(
        rows,
        _aoi_values(9.0),
        LAND_USE_OF_AOI_METRIC_IDS,
        source="raster:coberturas+boundary",
        notes="(AOI ∩ '{layer_id}') / aoi_area × 100.",
    )
    by_id = {row["metricId"]: row["value"] for row in replaced}
    assert by_id["land_use_agricultural_areas_pct"] == 12.1
    assert by_id["land_use_agricultural_areas_pct_of_aoi"] == 9.0


def test_backfill_document_marks_empty_scopes_empty():
    values = {("national", "colombia"): _aoi_values(8.0)}
    document = backfill_verbose_document(
        _document(empty_department=True),
        values,
    )
    department = document["geographies"]["departments"]["05"]["metrics"]

    assert department[0]["value"] == 12.1
    assert [row["status"] for row in department[1:]] == ["empty"] * 5


def test_compact_roundtrip_restamps_provenance_sha():
    verbose = backfill_verbose_document(
        _document(),
        {
            ("national", "colombia"): _aoi_values(4.0),
            ("departments", "05"): _aoi_values(4.0),
        },
    )
    compact = to_compact_document(verbose)
    expanded = to_verbose_document(compact)

    assert compact["metricsProvenanceSha256"]
    assert compact["metricsProvenance"]["catalogSignature"] == verbose[
        PROVENANCE_KEY
    ]["catalogSignature"]
    assert [row["metricId"] for row in expanded["geographies"]["national"]["colombia"]["metrics"]][
        -5:
    ] == list(LAND_USE_OF_AOI_METRIC_IDS)


def test_pin_mismatch_and_moved_boundary_sha_fail(tmp_path: Path):
    document = _document()
    pins = extract_source_pins(document)
    other = extract_source_pins(_document(coberturas_sha="1" * 64))
    moved_pins = extract_source_pins(document)

    with pytest.raises(SourcePinError, match="Coberturas source SHA differs"):
        assert_source_pins_match(pins, other)

    drifted = {
        **moved_pins.__dict__,
        "boundary_sha256_by_level": {"municipalities": "0" * 64},
    }
    from backfill_land_use_of_aoi import SourcePins

    drifted_pins = SourcePins(**drifted)
    with pytest.raises(SourcePinError, match="Boundary municipalities SHA moved"):
        assert_boundary_specs_unmoved(drifted_pins)

    payload = tmp_path / "layer.bin"
    payload.write_bytes(b"coberturas")
    with pytest.raises(SourcePinError, match="refusing to backfill with new bytes"):
        assert_file_sha256(payload, "c" * 64, label="coberturas.tif")


def test_cli_writes_new_dir_preserves_source_and_honors_limit(tmp_path: Path):
    source = tmp_path / "source" / "cache"
    source.mkdir(parents=True)
    output = tmp_path / "output"
    values = {
        ("national", "colombia"): _aoi_values(7.0),
        ("departments", "05"): _aoi_values(7.0),
    }

    for solution_id in ("sol_a", "sol_b", "sol_c"):
        verbose = _document(solution_id=solution_id, agri_pct=1.5)
        compact = to_compact_document(verbose)
        (source / f"{solution_id}.metrics.json").write_text(
            json.dumps(verbose),
            encoding="utf-8",
        )
        (source / f"{solution_id}.metrics.compact.json").write_text(
            json.dumps(compact),
            encoding="utf-8",
        )

    def compute(_pins, _cache_dir, _planning):
        return values

    report = run_backfill(
        input_dir=source,
        output_dir=output,
        cache_dir=tmp_path / "downloads",
        limit=1,
        dry_run=True,
        compute_scope_values=compute,
    )
    assert report["uniqueSolutions"] == 1
    assert report["solutionFiles"] == 2
    assert not (output / "cache").exists()
    assert discover_metric_paths(source)

    report = run_backfill(
        input_dir=source,
        output_dir=output,
        cache_dir=tmp_path / "downloads",
        limit=2,
        compute_scope_values=compute,
    )
    written = list((output).rglob("*.json"))
    assert report["uniqueSolutions"] == 2
    assert len(written) == 4
    assert not (output / "sol_c.metrics.json").exists()

    source_a = json.loads((source / "sol_a.metrics.json").read_text(encoding="utf-8"))
    out_a = json.loads((output / "sol_a.metrics.json").read_text(encoding="utf-8"))
    out_b = json.loads((output / "sol_b.metrics.json").read_text(encoding="utf-8"))
    compact_a = to_verbose_document(
        json.loads((output / "sol_a.metrics.compact.json").read_text(encoding="utf-8"))
    )

    assert [row["metricId"] for row in source_a["geographies"]["national"]["colombia"]["metrics"]] == [
        "land_use_agricultural_areas_pct"
    ]
    assert out_a["geographies"]["national"]["colombia"]["metrics"][0]["value"] == 1.5
    assert (
        out_a["geographies"]["national"]["colombia"]["metrics"][2]["value"]
        == out_b["geographies"]["national"]["colombia"]["metrics"][2]["value"]
        == 7.0
    )
    assert compact_a["geographies"]["national"]["colombia"]["metrics"][2]["value"] == 7.0
    assert out_a[PROVENANCE_KEY]["catalogSignature"] == catalog_signature(
        "land",
        out_a[PROVENANCE_KEY]["generationConfig"],
    )
    assert "metricsProvenanceSha256" in json.loads(
        (output / "sol_a.metrics.compact.json").read_text(encoding="utf-8")
    )


def test_cli_refuses_overwrite_without_in_place(tmp_path: Path):
    source = tmp_path / "cache"
    source.mkdir()
    (source / "solo.metrics.json").write_text(
        json.dumps(_document()),
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match="Refusing to overwrite"):
        run_backfill(
            input_dir=source,
            output_dir=source,
            cache_dir=tmp_path / "downloads",
            compute_scope_values=lambda *_: {},
        )


def _packet_document(
    *,
    solution_id: str = "sirap-orinoquia-demo",
    region_id: str = "orinoquia",
    packet_sha: str = "p" * 64,
    grid_sha: str = "g" * 64,
    agri_pct: float = 6.7,
    forest_pct: float = 91.9,
) -> dict:
    document = _document(solution_id=solution_id, agri_pct=agri_pct)
    document["geographies"] = {
        "sirap": {
            region_id: {
                "name": region_id,
                "scopeState": {
                    "classification": "supported",
                    "solutionValidCellCount": 4,
                },
                "metrics": [
                    {
                        "metricId": "land_use_agricultural_areas_pct",
                        "value": agri_pct,
                        "unit": "%",
                        "status": "ready",
                        "source": "raster:coberturas_agricultural_areas",
                        "notes": "selected %",
                        "labelKey": "metrics.tier1.land_use_agricultural_areas_pct",
                        "formatHint": "percent",
                    },
                    {
                        "metricId": "land_use_forests_and_semi_natural_areas_pct",
                        "value": forest_pct,
                        "unit": "%",
                        "status": "ready",
                        "source": "raster:coberturas_forests_and_semi_natural_areas",
                        "notes": "selected %",
                        "labelKey": "metrics.tier1.land_use_forests_and_semi_natural_areas_pct",
                        "formatHint": "percent",
                    },
                ],
            }
        },
        "departments": {
            "50": {
                "name": "Meta",
                "scopeState": {
                    "classification": "supported",
                    "solutionValidCellCount": 2,
                },
                "metrics": [
                    {
                        "metricId": "land_use_agricultural_areas_pct",
                        "value": agri_pct,
                        "unit": "%",
                        "status": "ready",
                    }
                ],
            }
        },
    }
    document[PROVENANCE_KEY]["inputAlignment"] = {
        "format": PACKET_ALIGNMENT_FORMAT,
        "domain": "land",
        "regionId": region_id,
        "targetGridSha256": grid_sha,
        "packetSha256": packet_sha,
        "sha256": "s" * 64,
    }
    document[PROVENANCE_KEY]["generationConfig"]["regionalPacket"] = True
    return document


def test_clc_renderings_do_not_mix_national_and_classic_ids():
    national = clc_layer_renderings(CLC_ENCODING_NATIONAL_REMAPPED)
    classic = clc_layer_renderings(CLC_ENCODING_CLASSIC_IDEAM)

    assert national["coberturas_forests_and_semi_natural_areas"]["selectedValue"] == 1
    assert national["coberturas_artificial_surfaces"]["selectedValue"] == 5
    assert classic["coberturas_forests_and_semi_natural_areas"]["selectedValue"] == 3
    assert classic["coberturas_artificial_surfaces"]["selectedValue"] == 1
    assert classic["coberturas_agricultural_areas"]["selectedValue"] == 2


def test_packet_pins_fail_closed_on_national_path():
    document = _packet_document()
    with pytest.raises(SourcePinError, match="packet-shaped"):
        extract_source_pins(document)
    pins = extract_source_pins(document, clc_encoding=CLC_ENCODING_CLASSIC_IDEAM)
    assert pins.coberturas is None
    assert pins.region_id == "orinoquia"
    assert pins.packet_sha256 == "p" * 64
    assert pins.clc_encoding == CLC_ENCODING_CLASSIC_IDEAM


def test_classic_ideam_refuses_in_place_and_solutions_dir(tmp_path: Path):
    source = tmp_path / "cache"
    source.mkdir()
    (source / "solo.metrics.compact.json").write_text(
        json.dumps(to_compact_document(_packet_document())),
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match="Refusing --in-place"):
        run_backfill(
            input_dir=source,
            output_dir=tmp_path / "out",
            cache_dir=tmp_path / "downloads",
            in_place=True,
            clc_encoding=CLC_ENCODING_CLASSIC_IDEAM,
            compute_scope_values=lambda *_: {},
        )
    with pytest.raises(ValueError, match="Refusing --solutions-dir"):
        run_backfill(
            input_dir=source,
            output_dir=tmp_path / "out",
            cache_dir=tmp_path / "downloads",
            clc_encoding=CLC_ENCODING_CLASSIC_IDEAM,
            solutions_dir=tmp_path / "solutions",
            compute_scope_values=lambda *_: {},
        )


def test_classic_ideam_groups_regions_and_keeps_selected_pct(tmp_path: Path):
    source = tmp_path / "source"
    source.mkdir()
    output = tmp_path / "output"
    orinoquia = _packet_document(solution_id="orinoquia-a", region_id="orinoquia")
    orinoquia_b = _packet_document(
        solution_id="orinoquia-b",
        region_id="orinoquia",
        packet_sha="r" * 64,
        agri_pct=6.8,
        forest_pct=90.0,
    )
    eje = _packet_document(
        solution_id="eje-a",
        region_id="eje-cafetero",
        packet_sha="q" * 64,
        grid_sha="h" * 64,
        agri_pct=47.0,
        forest_pct=51.0,
    )
    (source / "orinoquia-a.metrics.compact.json").write_text(
        json.dumps(to_compact_document(orinoquia)),
        encoding="utf-8",
    )
    (source / "orinoquia-b.metrics.compact.json").write_text(
        json.dumps(to_compact_document(orinoquia_b)),
        encoding="utf-8",
    )
    (source / "eje-a.metrics.compact.json").write_text(
        json.dumps(to_compact_document(eje)),
        encoding="utf-8",
    )

    seen_regions: list[str | None] = []

    def compute(pins, _cache_dir, _planning):
        seen_regions.append(pins.region_id)
        forest = 71.87 if pins.region_id == "orinoquia" else 50.48
        agri = 26.01 if pins.region_id == "orinoquia" else 46.50
        values = {
            metric_id: (
                forest
                if "forests" in metric_id
                else agri
                if "agricultural" in metric_id
                else 0.4
            )
            for metric_id in LAND_USE_OF_AOI_METRIC_IDS
        }
        return {
            ("sirap", pins.region_id or ""): values,
            ("departments", "50"): values,
        }

    report = run_backfill(
        input_dir=source,
        output_dir=output,
        cache_dir=tmp_path / "downloads",
        clc_encoding=CLC_ENCODING_CLASSIC_IDEAM,
        compute_scope_values=compute,
    )
    assert report["uniqueSolutions"] == 3
    assert report["recomputedSelectedPct"] is False
    assert seen_regions.count("orinoquia") == 1
    assert set(seen_regions) == {"orinoquia", "eje-cafetero"}

    out_orinoquia = to_verbose_document(
        json.loads((output / "orinoquia-a.metrics.compact.json").read_text(encoding="utf-8"))
    )
    out_eje = to_verbose_document(
        json.loads((output / "eje-a.metrics.compact.json").read_text(encoding="utf-8"))
    )
    orinoquia_by_id = {
        row["metricId"]: row["value"]
        for row in out_orinoquia["geographies"]["sirap"]["orinoquia"]["metrics"]
    }
    eje_by_id = {
        row["metricId"]: row["value"]
        for row in out_eje["geographies"]["sirap"]["eje-cafetero"]["metrics"]
    }
    assert orinoquia_by_id["land_use_agricultural_areas_pct"] == 6.7
    assert orinoquia_by_id["land_use_forests_and_semi_natural_areas_pct"] == 91.9
    assert orinoquia_by_id["land_use_forests_and_semi_natural_areas_pct_of_aoi"] == 71.87
    assert eje_by_id["land_use_agricultural_areas_pct"] == 47.0
    assert eje_by_id["land_use_forests_and_semi_natural_areas_pct_of_aoi"] == 50.48
    assert "land_use_artificial_surfaces_pct_of_aoi" in {
        row["metricId"]
        for row in out_orinoquia["geographies"]["departments"]["50"]["metrics"]
    }
