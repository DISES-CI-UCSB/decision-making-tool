"""Unit tests for regional SIRAP custom AOI area profiles."""

from __future__ import annotations

import hashlib
import json
from dataclasses import replace
from pathlib import Path

import numpy as np
import pytest
import rasterio
from rasterio.transform import from_origin

from app.area_profile import calculate_custom_area_profile
from app.ecosystem_inventory import RuntimeEcosystemInventory
from app.sirap_coverage import (
    RuntimeSirapCoverage,
    calculate_sirap_ecosystem_aoi_coverage,
    load_runtime_sirap_coverage,
)
from app.solution_coverage import CoverageTarget
from mec_compact import build_composite_taxonomy, load_composite_crosswalk
from raster_metrics import read_solution_raster
from scripts.build_sirap_runtime_artifact import parse_sirap_summary_targets
from tests.test_raster_polygon_metrics import POLYGON_LEFT_COLUMN, raster_artifact, write_tif

SOLUTION_ID = "eje-cafetero-fixture"
SUMMARY_HEADER = (
    "feature,met,total_amount,absolute_target,absolute_held,absolute_shortfall,"
    "relative_target,relative_held,relative_shortfall,scenario,evaluated,"
    "total_amount_km2,absolute_held_km2,feature_type,class"
)


def _write_mec_bundle(tmp_path: Path) -> tuple[Path, RuntimeEcosystemInventory]:
    crosswalk_text = (
        "rasterValue,tipoEcosistema,biomeFamily,broadBiomeContext,"
        "biomeRegion,broadEcosystem,detailedEcosystem\n"
        "10,Bosque,Orobioma,Contexto bosque,Orobioma Región,Forest,Forest detail\n"
        "11,Sabana,Orobioma,Contexto sabana,Orobioma Región,Wetland,Wetland detail\n"
    )
    crosswalk_path = tmp_path / "crosswalk.csv"
    crosswalk_path.write_text(crosswalk_text, encoding="utf-8")
    crosswalk_sha256 = hashlib.sha256(crosswalk_path.read_bytes()).hexdigest()
    mec_path = write_tif(
        tmp_path / "mec.tif",
        np.array([[10, 11], [10, 0]], dtype=np.uint16),
        nodata=0,
    )
    raster_sha256 = hashlib.sha256(mec_path.read_bytes()).hexdigest()
    provenance_path = tmp_path / "provenance.json"
    provenance_path.write_text(
        json.dumps(
            {
                "format": "mec-2024-provenance-v1",
                "generatedAt": "2026-09-02T00:00:00Z",
                "source": {"publisher": "IDEAM"},
                "catalog": {
                    "rowCount": 2,
                    "crosswalkSha256": crosswalk_sha256,
                    "crosswalkSignature": "fixture",
                    "tupleFields": [
                        "tipo_ecos",
                        "gran_bioma",
                        "bioma_iavh",
                        "ecos_sintesis",
                        "ecos_general",
                    ],
                },
                "outputs": {
                    "compositeRaster": {"sha256": raster_sha256},
                    "crosswalk": {"sha256": crosswalk_sha256},
                },
                "rasterization": {"dtype": "uint16", "nodata": 0},
                "grid": {"fingerprintSha256": "fixture"},
            }
        ),
        encoding="utf-8",
    )
    taxonomy = build_composite_taxonomy(load_composite_crosswalk(crosswalk_text))
    inventory = RuntimeEcosystemInventory(
        raster_path=mec_path,
        crosswalk_path=crosswalk_path,
        provenance_path=provenance_path,
        taxonomy=taxonomy,
        provenance={},
    )
    return mec_path, inventory


def _write_sirap_coverage(tmp_path: Path, mec_path: Path) -> RuntimeSirapCoverage:
    catalog_path = tmp_path / "catalog.csv"
    catalog_path.write_text(
        "biome,biome_id\nForest,10\nWetland,11\n",
        encoding="utf-8",
    )
    targets_path = tmp_path / "targets.json"
    targets_path.write_text(
        json.dumps(
            {
                "format": "sirap-solution-targets-v1",
                "solution_id": SOLUTION_ID,
                "targets": [
                    {
                        "feature": "Forest",
                        "feature_type": "ecosystem",
                        "class": None,
                        "relative_target": 0.3,
                        "evaluated": "prioritizr_model",
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    return load_runtime_sirap_coverage(
        mec_path,
        catalog_path,
        {SOLUTION_ID: targets_path},
    )


def _sirap_artifact(tmp_path: Path):
    base = raster_artifact(tmp_path)
    mec_path, inventory = _write_mec_bundle(tmp_path)
    coverage = _write_sirap_coverage(tmp_path, mec_path)
    return replace(
        base,
        manifest={
            "artifact_version": "sirap-fixture-v1",
            "artifact_kind": "sirap-raster-custom-aoi/v1",
            "species_matrices": {"status": "stubbed"},
        },
        ecosystem_inventory=inventory,
        sirap_coverage=coverage,
    )


def test_parse_sirap_summary_targets_filters_evaluated_rows(tmp_path: Path) -> None:
    scenario = "Estr17+Bs100"
    summary = tmp_path / "summary.csv"
    summary.write_text(
        "\n".join(
            [
                SUMMARY_HEADER,
                f"Forest,TRUE,100,30,30,0,0.3,0.3,0,{scenario},prioritizr_model,9,2.7,ecosystem,NA",
                f"Species one,TRUE,100,30,30,0,0.3,0.3,0,{scenario},prioritizr_model,9,2.7,species,Aves",
                f"paramos,TRUE,100,30,30,0,0.3,0.3,0,{scenario},prioritizr_model,9,2.7,strategic ecosystem,NA",
                f"Other,TRUE,100,30,30,0,0.3,0.3,0,other-scenario,prioritizr_model,9,2.7,ecosystem,NA",
                f"Post hoc,NA,100,NA,30,NA,NA,0.3,NA,{scenario},post-hoc,9,2.7,ecosystem,NA",
            ]
        )
        + "\n",
        encoding="utf-8",
    )

    targets = parse_sirap_summary_targets(summary, scenario_name=scenario)

    assert [row["feature"] for row in targets] == ["Forest", "Species one"]
    assert all(row["evaluated"] == "prioritizr_model" for row in targets)


def test_calculate_sirap_ecosystem_aoi_coverage_without_row_count_gate(
    tmp_path: Path,
) -> None:
    mec_path, _ = _write_mec_bundle(tmp_path)
    coverage = RuntimeSirapCoverage(
        ecosystem_raster_path=mec_path,
        ecosystem_catalog_path=tmp_path / "catalog.csv",
        targets_by_solution={
            SOLUTION_ID: (
                CoverageTarget(
                    feature="Forest",
                    feature_type="ecosystem",
                    feature_class=None,
                    relative_target=0.3,
                    evaluated="prioritizr_model",
                ),
            )
        },
    )
    (tmp_path / "catalog.csv").write_text("biome,biome_id\nForest,10\n", encoding="utf-8")
    solution_path = write_tif(
        tmp_path / "solution.tif",
        np.array([[2, 0], [1, 0]], dtype=np.uint8),
        nodata=255,
    )
    from app.metric_adapters import build_custom_aoi_raster

    base = raster_artifact(tmp_path)
    aoi = build_custom_aoi_raster(base.reference_raster_path, POLYGON_LEFT_COLUMN)
    solution = read_solution_raster(solution_path)

    rows = calculate_sirap_ecosystem_aoi_coverage(
        coverage,
        SOLUTION_ID,
        aoi,
        solution,
    )

    assert len(rows) == 1
    assert rows["forest"].feature == "Forest"
    assert rows["forest"].absolute_held_aoi == pytest.approx(2.0)


def test_sirap_area_profile_accepts_uint32_regional_mec_raster(
    tmp_path: Path,
) -> None:
    """Regional SIRAP MEC rasters are packaged as uint32 while using composite crosswalk."""
    base = raster_artifact(tmp_path)
    crosswalk_text = (
        "rasterValue,tipoEcosistema,biomeFamily,broadBiomeContext,"
        "biomeRegion,broadEcosystem,detailedEcosystem\n"
        "10,Bosque,Orobioma,Contexto bosque,Orobioma Región,Forest,Forest detail\n"
        "11,Sabana,Orobioma,Contexto sabana,Orobioma Región,Wetland,Wetland detail\n"
    )
    crosswalk_path = tmp_path / "crosswalk.csv"
    crosswalk_path.write_text(crosswalk_text, encoding="utf-8")
    crosswalk_sha256 = hashlib.sha256(crosswalk_path.read_bytes()).hexdigest()
    mec_path = write_tif(
        tmp_path / "mec_uint32.tif",
        np.array([[10, 11], [10, np.uint32(4294967295)]], dtype=np.uint32),
        nodata=4294967295,
    )
    raster_sha256 = hashlib.sha256(mec_path.read_bytes()).hexdigest()
    provenance_path = tmp_path / "provenance.json"
    provenance_path.write_text(
        json.dumps(
            {
                "format": "mec-2024-provenance-v1",
                "generatedAt": "2026-09-02T00:00:00Z",
                "source": {"publisher": "IDEAM"},
                "catalog": {
                    "rowCount": 2,
                    "crosswalkSha256": crosswalk_sha256,
                    "crosswalkSignature": "fixture",
                    "tupleFields": [
                        "tipo_ecos",
                        "gran_bioma",
                        "bioma_iavh",
                        "ecos_sintesis",
                        "ecos_general",
                    ],
                },
                "outputs": {
                    "compositeRaster": {"sha256": raster_sha256},
                    "crosswalk": {"sha256": crosswalk_sha256},
                },
                "rasterization": {"dtype": "uint16", "nodata": 0},
                "grid": {"fingerprintSha256": "fixture"},
            }
        ),
        encoding="utf-8",
    )
    taxonomy = build_composite_taxonomy(load_composite_crosswalk(crosswalk_text))
    inventory = RuntimeEcosystemInventory(
        raster_path=mec_path,
        crosswalk_path=crosswalk_path,
        provenance_path=provenance_path,
        taxonomy=taxonomy,
        provenance={},
    )
    coverage = _write_sirap_coverage(tmp_path, mec_path)
    artifact = replace(
        base,
        manifest={
            "artifact_version": "sirap-fixture-v1",
            "artifact_kind": "sirap-raster-custom-aoi/v1",
            "species_matrices": {"status": "stubbed"},
        },
        ecosystem_inventory=inventory,
        sirap_coverage=coverage,
    )
    solution_path = write_tif(
        tmp_path / "solution.tif",
        np.array([[2, 1], [0, 0]], dtype=np.uint8),
        nodata=255,
    )
    sections, selection, status = calculate_custom_area_profile(
        artifact,
        POLYGON_LEFT_COLUMN,
        ["ecosystems"],
        read_solution_raster(solution_path),
        SOLUTION_ID,
    )

    assert selection["status"] == "selected"
    assert status == "complete"
    assert sections["ecosystems"]["status"] == "complete"
    assert len(sections["ecosystems"]["solution_coverage"]) == 1


def test_sirap_area_profile_returns_ecosystems_and_stubbed_species(
    tmp_path: Path,
) -> None:
    artifact = _sirap_artifact(tmp_path)
    solution_path = write_tif(
        tmp_path / "solution.tif",
        np.array([[2, 1], [0, 0]], dtype=np.uint8),
        nodata=255,
    )
    sections, selection, status = calculate_custom_area_profile(
        artifact,
        POLYGON_LEFT_COLUMN,
        ["ecosystems", "species"],
        read_solution_raster(solution_path),
        SOLUTION_ID,
    )

    assert selection["status"] == "selected"
    assert status == "partial"
    assert sections["ecosystems"]["status"] == "complete"
    assert sections["ecosystems"]["solution_coverage"][0]["feature"] == "Forest"
    assert sections["species"]["status"] == "unavailable"
    assert sections["species"]["reason"] == "species_matrices_stubbed"
