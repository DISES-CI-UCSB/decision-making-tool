"""Prove calculator A (mesa cell counts) matches the science-team summary CSV."""

from __future__ import annotations

import csv
import importlib.util
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest
from mesa_coverage import evaluate_categorical_coverage, mesa_coverage_row
from sparse.format import SparseMetadata, SpeciesMatrixEntry, encode_species_matrix
from species_goals import (
    FLAG_CONFIGURED_TARGET_MET,
    SPECIES_GOALS_COVERAGE_ALGORITHM_VERSION,
    SpeciesGoalsPipeline,
    build_catalog,
    record_species_goals_from_smsp,
    validate_compact,
)
from species_data import SpeciesRecord
from species_target_policy import SpeciesTargetPolicy

REPO_ROOT = Path(__file__).resolve().parents[4]
MESA_PARITY_MAIN = Path(__file__).resolve().parents[1] / "mesa_parity" / "main.py"
GOLD_DIR = Path.home() / "Downloads" / "solutions-latest-sept3rd-2026"
GOLD_SUMMARY = GOLD_DIR / "Eco17+Estr17+EspRep17+RUNAP_IHEH2022_summary.csv"
GOLD_SOLUTION = GOLD_DIR / "Eco17+Estr17+EspRep17+RUNAP_IHEH2022.tif"
CACHE = REPO_ROOT / "data" / "metrics" / "cache" / "mesa-v3"
TEMPLATE = CACHE / "parity-inputs" / "template_terrestre.tif"
ECOSYSTEM_RASTER = CACHE / "parity-inputs" / "ecosistemas_IAVH_2024.tif"
ECOSYSTEM_CATALOG = CACHE / "parity-inputs" / "ecosistemas_IDs_IAVH_2024.csv"
CONTRACT = (
    REPO_ROOT / "data" / "metrics" / "release-specs" / "solutions-v3-0-0"
    / "coverage-parity-contract.json"
)
AMPHIBIAN_MATRIX = (
    CACHE.parent / "amphibia-extract" / "amphibians_from_Amphibia.rds.smtx.gz"
)
NUMERIC_TOLERANCE = 1e-9
SHA = "a" * 64


def _mesa_parity():
    spec = importlib.util.spec_from_file_location("mesa_parity_main", MESA_PARITY_MAIN)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def _summary_rows(path: Path) -> list[dict[str, str]]:
    with path.open(newline="", encoding="utf-8-sig") as handle:
        return list(csv.DictReader(handle))


def test_mesa_kernel_matches_summary_csv_for_species_and_ecosystems(tmp_path: Path):
    summary = tmp_path / "summary.csv"
    summary.write_text(
        "feature,met,total_amount,absolute_target,absolute_held,absolute_shortfall,"
        "relative_target,relative_held,relative_shortfall,feature_type,class,"
        "scenario,evaluated\n"
        "Forest,TRUE,4,0.8,2,0,0.2,0.5,0,ecosystem,NA,fixture,prioritizr_model\n"
        "Wetland,FALSE,2,1.0,0,1,0.5,0.0,1,ecosystem,NA,fixture,prioritizr_model\n"
        "Fence species,TRUE,5,1.0,2,0,0.2,0.4,0,species,Aves,fixture,prioritizr_model\n"
        "Short species,FALSE,4,1.2,1,0.2,0.3,0.25,0.16666666666666666,species,Aves,fixture,prioritizr_model\n",
        encoding="utf-8",
    )
    rows = _summary_rows(summary)
    values = np.array([[1, 1, 2], [1, 1, 2]], dtype=np.float64)
    selected = np.array([[True, False, False], [True, False, False]])
    ecosystem_actual = evaluate_categorical_coverage(
        category_values=values,
        selected_mask=selected,
        feature_ids=[1, 2],
        feature_names=["Forest", "Wetland"],
        relative_targets=[0.2, 0.5],
        evaluated=["prioritizr_model", "prioritizr_model"],
        relative_shortfall_mode="target_fraction",
    )
    species_actual = [
        mesa_coverage_row(
            feature="Fence species",
            total_amount=5,
            absolute_held=2,
            relative_target=0.2,
            evaluated="prioritizr_model",
            relative_shortfall_mode="target_fraction",
        ),
        mesa_coverage_row(
            feature="Short species",
            total_amount=4,
            absolute_held=1,
            relative_target=0.3,
            evaluated="prioritizr_model",
            relative_shortfall_mode="target_fraction",
        ),
    ]
    parity = _mesa_parity()
    mismatches = parity._compare_rows(
        [row for row in rows if row["feature_type"] == "ecosystem"],
        ecosystem_actual,
        numeric_tolerance=NUMERIC_TOLERANCE,
    )
    mismatches.extend(
        parity._compare_rows(
            [row for row in rows if row["feature_type"] == "species"],
            species_actual,
            numeric_tolerance=NUMERIC_TOLERANCE,
        )
    )

    assert mismatches == []
    assert [row.met for row in ecosystem_actual] == [True, False]
    assert [row.met for row in species_actual] == [True, False]
    assert species_actual[0].relative_held == pytest.approx(0.4)


def test_species_goals_compact_met_matches_summary_csv_not_exactextract(
    tmp_path: Path,
):
    """Fence case: exactextract 10% would miss; mesa 40% matches CSV met."""

    record = SpeciesRecord("Fence species", "Aves", "EN", 25.0, "birds", True)
    catalog = build_catalog(
        [record],
        provenance={
            "releaseId": "fixture-release",
            "speciesCsvSha256": SHA,
            "exceptionSourceSha256": None,
            "exceptionPolicySha256": None,
            "exceptionBindingSha256": None,
            "inventory": {"catalogTotal": 1, "unavailable": 0, "zeroRange": 0},
        },
    )
    pipeline = SpeciesGoalsPipeline(
        catalog,
        solution_id="fixture-solution",
        target_policy=SpeciesTargetPolicy(
            "per_species", None, {"fence_species": 20.0}, {"source": "csv"}
        ),
        provenance={
            "releaseId": "fixture-release",
            "speciesCsvSha256": SHA,
            "exceptionSourceSha256": None,
            "exceptionPolicySha256": None,
            "exceptionBindingSha256": None,
            "exactOverlapAlgorithmVersion": SPECIES_GOALS_COVERAGE_ALGORITHM_VERSION,
            "exactOverlapPolicySha256": SHA,
            "targetGridSha256": SHA,
            "speciesAlignmentInventorySha256": SHA,
            "solutionRasterSha256": SHA,
            "targetPolicySha256": SHA,
            "boundaryProvenanceSha256": SHA,
            "catalogSha256": catalog["catalogSha256"],
        },
        spool_dir=tmp_path / "spool",
    )
    selected = np.array([True, True, False, False, False], dtype=bool)
    matrix = tmp_path / "birds.smtx.gz"
    matrix.write_bytes(
        encode_species_matrix(
            [
                SpeciesMatrixEntry(
                    name="Fence species",
                    iucn="EN",
                    csv_class="Aves",
                    cell_ids=np.array([0, 1, 2, 3, 4], dtype=np.uint32),
                    metadata=SparseMetadata(
                        width=5,
                        height=1,
                        x_origin=0,
                        y_origin=1,
                        x_scale=1,
                        y_scale=-1,
                        nodata=None,
                        crs="EPSG:9377",
                        count=5,
                    ),
                )
            ]
        )
    )
    record_species_goals_from_smsp(
        pipeline,
        records=[record],
        species_matrix_paths=[matrix],
        selected_mask=selected,
        scope_mask=np.ones(5, dtype=bool),
        pre_existing_mask=np.array([True, False, False, False, False]),
        new_prioritizr_mask=np.array([False, True, False, False, False]),
    )
    document = pipeline.build_partition(
        geography_level="national",
        scope_catalog=[["colombia", "Colombia"]],
    )
    mesa = mesa_coverage_row(
        feature="Fence species",
        total_amount=5,
        absolute_held=2,
        relative_target=0.2,
    )

    assert document["rows"][0][2:4] == [25.0, 10.0]
    assert bool(document["rows"][0][7] & FLAG_CONFIGURED_TARGET_MET) is mesa.met is True
    assert document["provenance"]["exactOverlapAlgorithmVersion"] == (
        SPECIES_GOALS_COVERAGE_ALGORITHM_VERSION
    )
    validate_compact(document, catalog=catalog)


def _gold_inputs_available() -> bool:
    return all(
        path.is_file()
        for path in (
            GOLD_SUMMARY,
            GOLD_SOLUTION,
            TEMPLATE,
            ECOSYSTEM_RASTER,
            ECOSYSTEM_CATALOG,
            CONTRACT,
        )
    )


@pytest.mark.skipif(
    not _gold_inputs_available(),
    reason=(
        "Gold mesa_parity inputs are missing. Expected "
        f"{GOLD_SUMMARY} plus {CACHE}/parity-inputs/ rasters."
    ),
)
def test_gold_solution_mesa_parity_matches_summary_csv(tmp_path: Path):
    parity = _mesa_parity()
    command = [
        sys.executable,
        str(MESA_PARITY_MAIN),
        "--contract",
        str(CONTRACT),
        "--summary",
        str(GOLD_SUMMARY),
        "--solution",
        str(GOLD_SOLUTION),
        "--template",
        str(TEMPLATE),
        "--ecosystem-raster",
        str(ECOSYSTEM_RASTER),
        "--ecosystem-catalog",
        str(ECOSYSTEM_CATALOG),
        "--numeric-tolerance",
        str(NUMERIC_TOLERANCE),
        "--allow-non-golden",
        "--report",
        str(tmp_path / "coverage-parity-report.json"),
    ]
    if AMPHIBIAN_MATRIX.is_file():
        command.extend(
            ["--species-matrix", str(AMPHIBIAN_MATRIX), "--species-class", "Amphibia"]
        )
    completed = subprocess.run(
        command,
        check=False,
        capture_output=True,
        text=True,
    )
    assert completed.returncode == 0, completed.stderr or completed.stdout
    payload = json.loads(completed.stdout.strip().splitlines()[-1])
    assert payload["passed"] is True
    assert payload["mismatchCount"] == 0
    assert payload["domainCounts"]["ecosystems"]["expected"] == 417
    if AMPHIBIAN_MATRIX.is_file():
        assert payload["domainCounts"]["species"]["expected"] == 158
