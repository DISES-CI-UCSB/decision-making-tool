import hashlib
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace

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
    assert runtime["capabilities"] == {"aoiCoverageMetrics": "v2"}
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


def _minimal_verbose_metrics(solution_id: str) -> dict:
    scope = {
        "name": "test",
        "scopeState": {},
        "metrics": [],
    }
    return {
        "solutionId": solution_id,
        "generatedAt": "2026-09-01T00:00:00Z",
        "geographies": {
            "national": {"colombia": scope},
            "departments": {"dept-1": dict(scope)},
            "municipalities": {"mun-1": dict(scope)},
        },
        "primaryGeography": {"level": "national", "scopeId": "colombia"},
        "metricsProvenance": {},
        "solutionRaster": {"sha256": "a" * 64},
        "solutionInputSignature": {"sha256": "b" * 64},
        "solutionCatalogBinding": {},
    }


def _minimal_goal_summary(solution: dict) -> dict:
    return {
        "solutionName": solution.get("name", solution["id"]),
        "targetContext": {
            "targetFeatureSet": f"sirap:{solution['sirapId']}:step-1",
            "targetFeatureIds": ["strategic-ecosystems"],
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
            {"id": "strategic-ecosystems", "features": [{}]},
        ],
        "summary": {"pctMet": 50},
    }


def _write_minimal_sirap_release_inputs(
    tmp_path: Path,
    *,
    release_id: str,
    include_species_goals: bool = False,
) -> SimpleNamespace:
    sidecar_root = tmp_path / "sidecars"
    packet_manifest = tmp_path / "packets.json"
    mec_root = tmp_path / "mec-root"
    output_root = tmp_path / "output"
    solutions = []

    for index in range(56):
        solution_id = f"sirap-test-{index:02d}"
        sirap_id = f"region-{index:02d}"
        raster_path = tmp_path / "rasters" / f"{solution_id}.tif"
        raster_path.parent.mkdir(parents=True, exist_ok=True)
        raster_path.write_bytes(b"raster")

        summary_path = tmp_path / "summaries" / f"{solution_id}.csv"
        summary_path.parent.mkdir(parents=True, exist_ok=True)
        summary_path.write_text("feature,met\nparamos,TRUE\n", encoding="utf-8")

        metrics_path = sidecar_root / sirap_id / "cache" / f"{solution_id}.metrics.json"
        metrics_path.parent.mkdir(parents=True, exist_ok=True)
        metrics_path.write_text(
            json.dumps(_minimal_verbose_metrics(solution_id)),
            encoding="utf-8",
        )

        for level in (
            "national",
            "departments",
            "municipalities",
            "siraps",
            "runaps",
            "omecs",
        ):
            mec_path = (
                mec_root
                / "cache"
                / solution_id
                / f"{level}.mec.compact.json"
            )
            mec_path.parent.mkdir(parents=True, exist_ok=True)
            mec_path.write_text("{}", encoding="utf-8")

        solutions.append(
            {
                "id": solution_id,
                "name": f"Scenario-{index}",
                "sirapId": sirap_id,
                "rasterFile": raster_path.name,
                "generatedAt": "2026-09-01T00:00:00Z",
                "displayUrl": raster_path.as_uri(),
                "regionalInputPacket": {
                    "grid": {"sha256": "c" * 64},
                    "authoritativeSummary": {
                        "url": summary_path.as_uri(),
                        "sha256": hashlib.sha256(summary_path.read_bytes()).hexdigest(),
                        "schema": "prioritizr-summary-v1",
                    },
                },
            }
        )

    packet_manifest.write_text(
        json.dumps({"solutions": solutions}),
        encoding="utf-8",
    )

    denominator_path = tmp_path / "national-denominator.mec.json"
    denominator_path.write_text(
        json.dumps(
            {
                "format": "mec-national-denominator-v1",
                "releaseId": release_id,
            }
        ),
        encoding="utf-8",
    )

    species_goals_roots = []
    if include_species_goals:
        species_root = tmp_path / "species-goals-root"
        catalog_path = species_root / "species-goals/catalog/v1/catalog.json"
        catalog_path.parent.mkdir(parents=True, exist_ok=True)
        catalog = {
            "format": "species-goals-catalog-v1",
            "releaseId": release_id,
            "catalogSha256": "d" * 64,
        }
        catalog_path.write_text(json.dumps(catalog), encoding="utf-8")
        catalog_path.with_name(f"{catalog_path.name}.complete.json").write_text(
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
        for solution in solutions:
            for level in sirap_release.SIRAP_SPECIES_GEOGRAPHY_LEVELS:
                compact_path = (
                    species_root
                    / "species-goals/compact/v1"
                    / solution["id"]
                    / f"{level}.species-goals.compact.json"
                )
                compact_path.parent.mkdir(parents=True, exist_ok=True)
                compact_document = {
                    "solutionId": solution["id"],
                    "geographyLevel": level,
                    "completion": {
                        "format": "species-goals-completion-v1",
                        "status": "complete",
                        "rowCount": 0,
                        "payloadSha256": "e" * 64,
                    },
                    "provenance": {"releaseId": release_id},
                }
                compact_path.write_text(
                    json.dumps(compact_document),
                    encoding="utf-8",
                )
                compact_path.with_name(f"{compact_path.name}.complete.json").write_text(
                    json.dumps(
                        {
                            **compact_document["completion"],
                            "artifactSha256": sirap_release.sha256_file(compact_path),
                            "solutionId": solution["id"],
                            "geographyLevel": level,
                            "catalogSha256": catalog["catalogSha256"],
                            "provenance": compact_document["provenance"],
                        }
                    ),
                    encoding="utf-8",
                )
        species_goals_roots = [species_root]

    return SimpleNamespace(
        output_root=output_root,
        release_id=release_id,
        catalog_version="1.0.0",
        generated_at="2026-09-01T00:00:00Z",
        sidecar_root=sidecar_root,
        packet_manifest=[packet_manifest],
        species_goals_root=species_goals_roots or None,
        mec_root=[mec_root],
        mec_national_denominator=denominator_path,
    )


def test_mec_national_denominator_block_does_not_reference_species_catalog():
    source = MODULE_PATH.read_text(encoding="utf-8")
    species_block_start = source.index("if species_goals_roots:")
    mec_block_start = source.index("if mec_national_denominator is not None:")
    by_id_start = source.index("by_id = {entry[\"solutionId\"]: entry for entry in catalog_entries}")

    species_section = source[species_block_start:mec_block_start]
    mec_section = source[mec_block_start:by_id_start]

    assert "speciesGoalsCompletion" in species_section
    assert "catalogs[0]" in species_section
    assert "speciesGoalsCompletion" not in mec_section
    assert "catalogs[0]" not in mec_section


@pytest.mark.parametrize("include_species_goals", [False, True])
def test_build_accepts_mec_national_denominator_without_species_goals_regression(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    include_species_goals: bool,
):
    release_id = "sirap-2026-09-01-v6"
    args = _write_minimal_sirap_release_inputs(
        tmp_path,
        release_id=release_id,
        include_species_goals=include_species_goals,
    )
    monkeypatch.setattr(
        sirap_release,
        "build_goal_summary",
        lambda solution, *_args, **_kwargs: _minimal_goal_summary(solution),
    )
    if include_species_goals:
        monkeypatch.setattr(
            sirap_release,
            "validate_catalog",
            lambda document: document,
        )
        monkeypatch.setattr(
            sirap_release,
            "validate_compact",
            lambda document, **_kwargs: document,
        )

    result = sirap_release.build(args)

    release_root = args.output_root / release_id
    inventory = json.loads(
        (release_root / "release-artifact-inventory.json").read_text(encoding="utf-8")
    )
    manifest = json.loads((release_root / "manifest.json").read_text(encoding="utf-8"))
    denominator_items = [
        item
        for item in inventory["artifacts"]
        if item["component"] == "mecNationalDenominator"
    ]
    species_completion_items = [
        item
        for item in inventory["artifacts"]
        if item["component"] == "speciesGoalsCompletion"
    ]

    assert result["releaseId"] == release_id
    assert len(denominator_items) == 1
    assert denominator_items[0]["path"] == "mec/v2/national-denominator.mec.json"
    assert manifest["expectedMecNationalDenominatorArtifactCount"] == 1
    assert manifest["expectedSpeciesGoalsCompletionArtifactCount"] == (
        1 + 56 * len(sirap_release.SIRAP_SPECIES_GEOGRAPHY_LEVELS)
        if include_species_goals
        else 0
    )
    assert len(species_completion_items) == manifest[
        "expectedSpeciesGoalsCompletionArtifactCount"
    ]
    assert all(
        solution["precomputedMetricUrls"].get("mecNationalDenominator", "").endswith(
            "/releases/sirap-2026-09-01-v6/mec/v2/national-denominator.mec.json"
        )
        for solution in manifest["solutions"]
    )


def test_build_rejects_mec_national_denominator_without_mec_root(tmp_path: Path):
    release_id = "sirap-2026-09-01-v6"
    args = _write_minimal_sirap_release_inputs(tmp_path, release_id=release_id)
    args.mec_root = []

    with pytest.raises(ValueError, match="--mec-national-denominator requires --mec-root"):
        sirap_release.build(args)


def test_goal_summary_uses_a_dedicated_release_path():
    assert (
        sirap_release.artifact_path("goalSummary", "sirap-orinoquia-test").as_posix()
        == "goals/cache/sirap-orinoquia-test.goals.json"
    )
    assert (
        sirap_release.artifact_path("sourceSummary", "sirap-orinoquia-test").as_posix()
        == "source-summaries/sirap-orinoquia-test.summary.csv"
    )
