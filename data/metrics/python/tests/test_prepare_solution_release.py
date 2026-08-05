from __future__ import annotations

import json
import hashlib
from pathlib import Path

import pytest

from prepare_solution_release import (
    ReleasePreparationError,
    build_release,
    canonical_id,
    discover_sources,
)


def _write_summary(path: Path, scenario: str) -> None:
    path.write_text(
        "feature,met,relative_target,relative_held,relative_shortfall,"
        "feature_type,class,scenario,evaluated\n"
        f"Ecosistemas,TRUE,0.3,0.4,0,ecosystem,NA,{scenario},prioritizr_model\n",
        encoding="utf-8",
    )


def test_discovery_is_top_level_only_and_preserves_original_basename(tmp_path: Path):
    source = tmp_path / "land"
    source.mkdir()
    raster = source / "Eco30+RUNAP_IHEH2030.tif"
    raster.write_bytes(b"new")
    _write_summary(source / "Eco30+RUNAP_IHEH2030_summary.csv", raster.stem)
    excluded = source / "OLD_RUNS"
    excluded.mkdir()
    (excluded / "unexpected.tif").write_bytes(b"excluded")

    entries = discover_sources(source, "land", 1)

    assert entries[0]["solutionId"] == "eco30_runap_iheh2030"
    assert entries[0]["rasterPath"].name == raster.name
    assert canonical_id("Ecos30+Mang30+RUNAP_HHM.tif", "marine") == (
        "marine_ecos30_mang30_runap_hhm"
    )


def test_discovery_fails_closed_when_exact_summary_is_missing(tmp_path: Path):
    raster = tmp_path / "Demo.tif"
    raster.write_bytes(b"demo")

    with pytest.raises(ReleasePreparationError, match="summary CSV"):
        discover_sources(tmp_path, "land", 1)


def test_release_outputs_pin_checksums_diff_and_upload_destinations(tmp_path: Path):
    land = tmp_path / "land"
    marine = tmp_path / "marine"
    land.mkdir()
    marine.mkdir()
    land_raster = land / "Eco30+RUNAP_IHEH2030.tif"
    marine_raster = marine / "Ecos30+Mang30+RUNAP_HHM.tif"
    land_raster.write_bytes(b"new-land")
    marine_raster.write_bytes(b"same-marine")
    _write_summary(land / "Eco30+RUNAP_IHEH2030_summary.csv", land_raster.stem)
    _write_summary(
        marine / "Ecos30+Mang30+RUNAP_HHM_summary.csv",
        marine_raster.stem,
    )
    baseline = {
        "format": "solution-catalog-v1",
        "catalogVersion": "0.1.0",
        "releaseId": "baseline",
        "expectedSolutionCount": 1,
        "expectedLandSolutionCount": 0,
        "expectedMarineSolutionCount": 1,
        "solutions": [
            {
                "solutionId": "marine_ecos30_mang30_runap_hhm",
                "solutionBasename": marine_raster.name,
                "domain": "marine",
                "rasterSha256": hashlib.sha256(b"same-marine").hexdigest(),
            }
        ],
    }
    baseline_path = tmp_path / "baseline.json"
    baseline_path.write_text(json.dumps(baseline), encoding="utf-8")
    manifest_path = tmp_path / "manifest.json"
    manifest_path.write_text(
        json.dumps(
            {
                "version": "0.2.0",
                "layers": [],
                "categories": [],
                "solutions": [],
            }
        ),
        encoding="utf-8",
    )
    contract = (
        Path(__file__).parents[2]
        / "release-specs"
        / "solutions-v0-2-0-20260805"
        / "species-exception.json"
    )
    release_root = tmp_path / "release"

    result = build_release(
        land_directory=land,
        marine_directory=marine,
        baseline_catalog_path=baseline_path,
        baseline_manifest_path=manifest_path,
        species_exception_path=contract,
        release_root=release_root,
        release_id="solutions-v0-2-0-20260805",
        catalog_version="0.2.0",
        expected_land=1,
        expected_marine=1,
    )

    assert result["catalog"]["solutions"][0]["solutionBasename"] == land_raster.name
    assert result["diff"]["counts"] == {
        "addedLand": 1,
        "unchangedLand": 0,
        "unchangedMarine": 1,
        "checksumMatchedLand": 0,
        "checksumMatchedMarine": 1,
        "removed": 0,
    }
    assert result["uploadPlan"]["artifactCount"] == 4
    assert all(
        entry["expectedBlobPath"].startswith(
            "releases/solutions-v0-2-0-20260805/solutions/"
        )
        for entry in result["uploadPlan"]["entries"]
    )
    preflight = json.loads(
        (release_root / "preflight" / "manifest.json").read_text(encoding="utf-8")
    )
    assert preflight["solutions"][0]["finderInputs"]["structuredTargets"][
        "ecosystems"
    ]
