from __future__ import annotations

import json
import hashlib
from pathlib import Path

import pytest

from prepare_solution_release import (
    ReleasePreparationError,
    _metric_urls,
    build_release,
    canonical_id,
    discover_sources,
    structured_finder_inputs,
)

MARINE_HABITATS = (
    "Cuenca en Talúd Baudó",
    "Banco en Talúd Baudó",
    "Fondos móviles de grano fino no carbonatados en Sanquianga",
    "Manglares en Tumaco",
    "Manglares en Magdalena",
)


def test_land_metric_urls_include_release_wide_strategic_outcomes():
    urls = _metric_urls(
        "eco17_runap_iheh2022",
        "solutions-v0-2-0-20260805",
        "land",
    )

    assert urls["strategicOutcomes"].endswith(
        "/releases/solutions-v0-2-0-20260805/regular/compact/"
        "strategic-ecosystem-outcomes.json"
    )
    assert "strategicOutcomes" not in _metric_urls(
        "marine_ecos30_mang30_runap_hhm",
        "solutions-v0-2-0-20260805",
        "marine",
    )


def _write_summary(path: Path, scenario: str) -> None:
    path.write_text(
        "feature,met,relative_target,relative_held,relative_shortfall,"
        "feature_type,class,scenario,evaluated\n"
        f"Ecosistemas,TRUE,0.3,0.4,0,ecosystem,NA,{scenario},prioritizr_model\n",
        encoding="utf-8",
    )


def _write_marine_summary(path: Path, scenario: str, target: float = 0.3) -> None:
    """Mirror a delivered marine summary CSV, which has no ``feature_type`` column."""
    header = (
        "feature,met,total_amount,absolute_target,absolute_held,absolute_shortfall,"
        "relative_target,relative_held,relative_shortfall,scenario,evaluated"
    )
    rows = [
        f"{feature},TRUE,100,30,40,0,{target},0.4,0,{scenario},prioritizr_model"
        for feature in (*MARINE_HABITATS, "Manglares")
    ]
    rows.append(f"Arrecifes,TRUE,100,30,40,0,{target},0.4,0,{scenario},post-hoc")
    path.write_text("\n".join([header, *rows]) + "\n", encoding="utf-8")


def _write_marine_sidecar(
    directory: Path,
    solution_id: str,
    *,
    target_percent: int = 30,
    **overrides: object,
) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"{solution_id}.json"
    document: dict[str, object] = {
        "id": solution_id,
        "domain": "marine",
        "scope": "marine",
        "target_feature_set": "marine_ecosystems_and_mangroves",
        "target_percent": target_percent,
        "input_layer_ids": {
            "features": ["FEAT_MARINE_ECOSYSTEMS", "FEAT_MANGROVES"],
            "cost": "COST_HHM",
            "includes": ["INCL_RUNAP"],
            "excludes": [],
        },
    }
    document.update(overrides)
    path.write_text(json.dumps(document), encoding="utf-8")
    return path


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
    _write_marine_summary(
        marine / "Ecos30+Mang30+RUNAP_HHM_summary.csv",
        marine_raster.stem,
    )
    marine_metadata = tmp_path / "marine-metadata"
    _write_marine_sidecar(marine_metadata, "marine_ecos30_mang30_runap_hhm")
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
        marine_metadata_directory=marine_metadata,
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


def _marine_finder_inputs(
    tmp_path: Path,
    *,
    target: float = 0.3,
    sidecar: bool = True,
    **sidecar_overrides: object,
) -> dict:
    solution_id = "marine_ecos30_mang30_runap_hhm"
    summary = tmp_path / "Ecos30+Mang30+RUNAP_HHM_summary.csv"
    _write_marine_summary(summary, "Ecos30+Mang30+RUNAP_HHM", target=target)
    metadata = tmp_path / "marine-metadata"
    metadata.mkdir(parents=True, exist_ok=True)
    if sidecar:
        _write_marine_sidecar(metadata, solution_id, **sidecar_overrides)
    finder_inputs, _, _, _ = structured_finder_inputs(
        summary,
        solution_id=solution_id,
        domain="marine",
        marine_metadata_directory=metadata,
    )
    return finder_inputs


def test_marine_finder_contract_comes_from_the_sidecar_without_feature_type(
    tmp_path: Path,
):
    finder_inputs = _marine_finder_inputs(tmp_path)

    assert finder_inputs["targetFeatureSet"] == "marine_ecosystems_and_mangroves"
    assert finder_inputs["targetPercent"] == 30
    assert finder_inputs["targetFeatureIds"] == ["marine_ecosystems", "mangroves"]


def test_marine_summary_rows_without_feature_type_stay_in_structured_targets(
    tmp_path: Path,
):
    targets = _marine_finder_inputs(tmp_path)["structuredTargets"]

    # Every prioritizr habitat is kept; only the exact "Manglares" row is strategic.
    assert [item["featureId"] for item in targets["strategicEcosystems"]] == [
        "manglares"
    ]
    assert len(targets["ecosystems"]) == len(MARINE_HABITATS)
    assert "manglares_en_tumaco" in {
        item["featureId"] for item in targets["ecosystems"]
    }
    assert all(item["targetPercent"] == 30 for item in targets["ecosystems"])


@pytest.mark.parametrize(
    ("kwargs", "match"),
    [
        ({"sidecar": False}, "missing marine solution sidecar"),
        ({"target_feature_set": "strategic_ecosystems"}, "target_feature_set"),
        ({"target_percent": 40}, "target_percent must be one of"),
        ({"input_layer_ids": {"features": []}}, "features must be"),
        (
            {"input_layer_ids": {"features": ["FEAT_PARAMOS"]}},
            "unmapped feature layers",
        ),
    ],
)
def test_marine_finder_contract_fails_loudly_on_bad_sidecars(
    tmp_path: Path,
    kwargs: dict,
    match: str,
):
    with pytest.raises(ReleasePreparationError, match=match):
        _marine_finder_inputs(tmp_path, **kwargs)


def test_marine_finder_contract_fails_loudly_on_unexpected_target_percent(
    tmp_path: Path,
):
    with pytest.raises(ReleasePreparationError, match="do not match the sidecar"):
        _marine_finder_inputs(tmp_path, target=0.45)


def test_land_summaries_still_drop_rows_the_classifier_cannot_place(tmp_path: Path):
    summary = tmp_path / "Eco30+RUNAP_IHEH2030_summary.csv"
    summary.write_text(
        "feature,met,relative_target,relative_held,relative_shortfall,"
        "feature_type,class,scenario,evaluated\n"
        "Ecosistemas,TRUE,0.3,0.4,0,ecosystem,NA,Eco30,prioritizr_model\n"
        "Unlabelled feature,TRUE,0.3,0.4,0,,NA,Eco30,prioritizr_model\n",
        encoding="utf-8",
    )

    finder_inputs, input_layer_ids, _, _ = structured_finder_inputs(
        summary,
        solution_id="eco30_runap_iheh2030",
        domain="land",
    )

    assert finder_inputs["targetFeatureSet"] == "ecosystems"
    assert finder_inputs["targetPercent"] == 30
    assert input_layer_ids["features"] == ["ecosystems"]
    assert [
        item["featureId"]
        for item in finder_inputs["structuredTargets"]["ecosystems"]
    ] == ["ecosistemas"]
    assert (
        finder_inputs["structuredTargets"]["sourceEvaluation"]
        == "final_summary_csv"
    )


def test_land_structured_targets_include_post_hoc_zero_and_unknown_rows(
    tmp_path: Path,
):
    summary = tmp_path / "EspRep17+RUNAP_summary.csv"
    summary.write_text(
        "feature,met,relative_target,relative_held,relative_shortfall,"
        "feature_type,class,scenario,evaluated\n"
        "Solver species,TRUE,0.17,0.2,0,species,Aves,EspRep,prioritizr_model\n"
        "Precovered species,TRUE,0.17,0.5,0,species,Aves,EspRep,post-hoc\n"
        "Zero range species,NA,0,NA,NA,species,Aves,EspRep,post-hoc\n",
        encoding="utf-8",
    )

    finder_inputs, _, coverage, _ = structured_finder_inputs(
        summary,
        solution_id="esprep17_runap",
        domain="land",
    )

    assert finder_inputs["structuredTargets"]["speciesRepresentation"] == [
        {"featureId": "precovered_species", "targetPercent": 17.0},
        {"featureId": "solver_species", "targetPercent": 17.0},
        {"featureId": "zero_range_species", "targetPercent": 0.0},
    ]
    assert coverage[-1]["met"] is None


@pytest.mark.parametrize(
    ("second_target", "message"),
    [(0.17, "duplicate normalized"), (0.3, "conflicting targets")],
)
def test_land_structured_targets_reject_normalized_duplicates(
    tmp_path: Path,
    second_target: float,
    message: str,
):
    summary = tmp_path / "duplicate_summary.csv"
    summary.write_text(
        "feature,met,relative_target,relative_held,relative_shortfall,"
        "feature_type,class,scenario,evaluated\n"
        "Ara macao,TRUE,0.17,0.2,0,species,Aves,EspRep,prioritizr_model\n"
        f"Ara-macao,TRUE,{second_target},0.3,0,species,Aves,EspRep,post-hoc\n",
        encoding="utf-8",
    )

    with pytest.raises(ReleasePreparationError, match=message):
        structured_finder_inputs(
            summary,
            solution_id="esprep17_runap",
            domain="land",
        )
