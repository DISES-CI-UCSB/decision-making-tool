import importlib.util
import json
from pathlib import Path

import pytest

MODULE_PATH = Path(__file__).parents[1] / "sirap_release" / "main.py"
SPEC = importlib.util.spec_from_file_location("sirap_release_main", MODULE_PATH)
assert SPEC and SPEC.loader
sirap_release = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(sirap_release)


def test_runtime_solution_binds_only_explicit_sirap_goal_summary():
    solution = {
        "id": "eje-cafetero-test",
        "name": "Estr17+HuEC70+RUNAP_IHEH2022",
        "sirapId": "eje-cafetero",
        "rasterFile": "solution.tif",
        "regionalInputPacket": {"grid": {"sha256": "a" * 64}},
    }
    entry = {"rasterSha256": "b" * 64}
    goal_summary = {
        "solutionName": solution["name"],
        "targetContext": {
            "targetFeatureSet": "sirap:eje-cafetero:step-1",
            "targetFeatureIds": ["strategic-ecosystems", "dry-forest", "eje-wetlands"],
            "finderTargetPercent": None,
            "structuredTargets": {
                "format": "solution-target-metadata-v1",
                "sourceEvaluation": "final_summary_csv",
                "ecosystems": [],
                "strategicEcosystems": [],
                "ecosystemServices": [],
                "speciesRepresentation": [],
                "espRn": [],
            },
        },
        "regionalTargetGroups": [
            {"id": "strategic-ecosystems", "features": [{}, {}]},
            {"id": "dry-forest", "features": [{}]},
            {"id": "eje-wetlands", "features": [{}]},
        ],
        "summary": {"pctMet": 75},
    }

    runtime = sirap_release.runtime_solution(
        solution,
        entry,
        goal_summary,
        "sirap-test-release",
        include_species_goals=True,
        include_mec=True,
    )

    assert runtime["precomputedMetricUrls"]["goals"].endswith(
        "/releases/sirap-test-release/goals/cache/eje-cafetero-test.goals.json"
    )
    assert runtime["finderInputs"]["targetFeatureIds"] == [
        "strategic-ecosystems",
        "dry-forest",
        "eje-wetlands",
    ]
    assert runtime["summaryMetrics"] == {
        "nSelected": None,
        "totalCost": None,
        "pctTargetsMet": 75,
        "coverageRowCount": 4,
    }
    assert set(
        runtime["precomputedMetricUrls"]["speciesGoalsByGeography"]
    ) == {"siraps", "departments", "municipalities"}
    assert "national" not in runtime["precomputedMetricUrls"][
        "speciesGoalsByGeography"
    ]
    assert set(runtime["precomputedMetricUrls"]["mecV2ByGeography"]) == {
        "national",
        "departments",
        "municipalities",
        "siraps",
        "runaps",
        "omecs",
    }


def test_species_release_validation_rejects_stale_completion(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    release_id = "sirap-test-release"
    catalog_path = tmp_path / "catalog.json"
    compact_path = tmp_path / "siraps.json"
    catalog_path.write_text("{}", encoding="utf-8")
    compact_path.write_text("{}", encoding="utf-8")
    catalog = {"catalogSha256": "a" * 64}
    provenance = {"releaseId": release_id}
    document = {
        "solutionId": "solution-1",
        "geographyLevel": "siraps",
        "completion": {
            "format": "species-goals-completion-v1",
            "status": "complete",
            "rowCount": 1,
            "payloadSha256": "b" * 64,
        },
        "provenance": provenance,
    }
    monkeypatch.setattr(sirap_release, "validate_catalog", lambda _document: catalog)
    monkeypatch.setattr(
        sirap_release,
        "validate_compact",
        lambda _document, **_kwargs: document,
    )
    catalog_completion_path = tmp_path / "catalog.json.complete.json"
    compact_completion_path = tmp_path / "siraps.json.complete.json"
    catalog_completion_path.write_text(
        json.dumps(
            {
                "format": "species-goals-catalog-completion-v1",
                "status": "complete",
                "releaseId": release_id,
                "catalogSha256": catalog["catalogSha256"],
                "artifactSha256": sirap_release.sha256_file(catalog_path),
            }
        ),
        encoding="utf-8",
    )
    compact_completion = {
        **document["completion"],
        "artifactSha256": sirap_release.sha256_file(compact_path),
        "solutionId": document["solutionId"],
        "geographyLevel": document["geographyLevel"],
        "catalogSha256": catalog["catalogSha256"],
        "provenance": provenance,
    }
    compact_completion_path.write_text(
        json.dumps(compact_completion), encoding="utf-8"
    )
    species_artifacts = [
        {"component": "speciesGoalsCatalog", "path": catalog_path.name},
        {
            "component": "speciesGoals",
            "path": compact_path.name,
            "solutionId": "solution-1",
            "geographyLevel": "siraps",
        },
    ]
    completion_artifacts = [
        {
            "component": "speciesGoalsCompletion",
            "path": catalog_completion_path.name,
            "solutionId": None,
            "geographyLevel": None,
        },
        {
            "component": "speciesGoalsCompletion",
            "path": compact_completion_path.name,
            "solutionId": "solution-1",
            "geographyLevel": "siraps",
        },
    ]

    sirap_release.validate_species_goals_release_artifacts(
        tmp_path,
        release_id=release_id,
        species_artifacts=species_artifacts,
        completion_artifacts=completion_artifacts,
    )
    compact_completion["provenance"] = {"releaseId": "stale-release"}
    compact_completion_path.write_text(
        json.dumps(compact_completion), encoding="utf-8"
    )

    with pytest.raises(ValueError, match="invalid or stale"):
        sirap_release.validate_species_goals_release_artifacts(
            tmp_path,
            release_id=release_id,
            species_artifacts=species_artifacts,
            completion_artifacts=completion_artifacts,
        )


def test_goal_summary_uses_a_dedicated_release_path():
    assert (
        sirap_release.artifact_path("goalSummary", "sirap-orinoquia-test").as_posix()
        == "goals/cache/sirap-orinoquia-test.goals.json"
    )
    assert (
        sirap_release.artifact_path("sourceSummary", "sirap-orinoquia-test").as_posix()
        == "source-summaries/sirap-orinoquia-test.summary.csv"
    )
