from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from types import SimpleNamespace

import pytest

import conservation_goals
from conservation_goals import (
    DEFAULT_LOCAL_MANIFEST,
    DEFAULT_MANIFEST_URL,
    GOALS_FORMAT,
    GoalsSchemaError,
    _goals_is_resumable,
    _goals_provenance,
    _load_manifest_payload,
    _parse_args,
    build_goals_document,
    expected_goals_blob_path,
)
from release_config import load_release_config
from solution_catalog import load_solution_catalog
from species_taxonomy import class_bucket


@dataclass(frozen=True)
class _SpeciesRecord:
    scientific_name: str
    csv_class: str
    taxon_group: str | None
    iucn_status: str
    range_km2: float | None
    threatened: bool


def _record(name: str, cls: str, iucn: str, threatened: bool = False) -> _SpeciesRecord:
    return _SpeciesRecord(
        scientific_name=name,
        csv_class=cls,
        taxon_group=class_bucket(cls),
        iucn_status=iucn,
        range_km2=123.4,
        threatened=threatened,
    )


def _write_manifest(path: Path, source: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"source": source}), encoding="utf-8")


def test_explicit_manifest_url_wins_over_local_staging(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    _write_manifest(tmp_path / DEFAULT_LOCAL_MANIFEST, "local-staging")
    explicit_url = "https://example.com/public-manifest.json"
    monkeypatch.setattr(
        conservation_goals,
        "fetch_manifest",
        lambda url: SimpleNamespace(raw={"source": url}),
    )

    payload, source = _load_manifest_payload(
        _parse_args(["--manifest-url", explicit_url]),
        tmp_path,
    )

    assert payload == {"source": explicit_url}
    assert source == explicit_url


def test_explicit_manifest_file_wins_over_local_staging(tmp_path: Path):
    explicit_path = tmp_path / "explicit-manifest.json"
    _write_manifest(explicit_path, "explicit-file")
    _write_manifest(tmp_path / DEFAULT_LOCAL_MANIFEST, "local-staging")

    payload, source = _load_manifest_payload(
        _parse_args(["--manifest-file", str(explicit_path)]),
        tmp_path,
    )

    assert payload == {"source": "explicit-file"}
    assert source == str(explicit_path)


def test_manifest_file_and_url_are_mutually_exclusive():
    with pytest.raises(SystemExit):
        _parse_args([
            "--manifest-file",
            "manifest.json",
            "--manifest-url",
            "https://example.com/manifest.json",
        ])


def test_no_manifest_flag_prefers_local_staging(tmp_path: Path):
    local_path = tmp_path / DEFAULT_LOCAL_MANIFEST
    _write_manifest(local_path, "local-staging")

    payload, source = _load_manifest_payload(_parse_args([]), tmp_path)

    assert payload == {"source": "local-staging"}
    assert source == str(local_path)


def test_no_manifest_flag_falls_back_to_default_url(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setattr(
        conservation_goals,
        "fetch_manifest",
        lambda url: SimpleNamespace(raw={"source": url}),
    )

    payload, source = _load_manifest_payload(_parse_args([]), tmp_path)

    assert payload == {"source": DEFAULT_MANIFEST_URL}
    assert source == DEFAULT_MANIFEST_URL


def test_build_goals_document_groups_species_and_ecosystems(tmp_path: Path):
    summary_csv = tmp_path / "solution_summary.csv"
    summary_csv.write_text(
        "\n".join([
            "feature,met,total_amount,absolute_target,absolute_held,absolute_shortfall,"
            "relative_target,relative_held,relative_shortfall,scenario,type,class",
            "paramos,true,100,17,33,0,0.17,0.33,0,demo,NA,NA",
            "bosque_seco,false,100,17,12,5,0.17,0.12,0.05,demo,NA,NA",
            "Ecosystem A,true,200,34,40,0,0.17,0.20,0,demo,ecosystem,Ecosystem",
            "Panthera onca,true,10,1.7,3,0,0.17,0.3,0,demo,species,Mammalia",
            "Ara macao,false,20,3.4,2,1.4,17,10,7,demo,species,Aves",
            "Unknown frog,true,20,3.4,5,0,0.17,0.25,0,demo,species,Amphibia",
        ])
        + "\n",
        encoding="utf-8",
    )

    doc = build_goals_document(
        solution={
            "id": "demo_solution",
            "name": "Demo Solution",
            "metadataUrl": "https://example.com/demo_summary.csv",
            "finderInputs": {
                "targetPercent": 17,
                "targetFeatureSet": "strategic_ecosystems+species_richness",
                "targetFeatureIds": ["strategic_ecosystems", "species_richness"],
            },
        },
        summary_csv_path=summary_csv,
        species_records=[
            _record("Panthera onca", "Mammalia", "VU", threatened=True),
            _record("Ara macao", "Aves", "LC"),
        ],
        generated_at="2026-06-19T00:00:00Z",
    )

    assert doc["format"] == GOALS_FORMAT
    assert doc["summary"]["metCount"] == 4
    assert doc["summary"]["totalCount"] == 6
    assert doc["summary"]["byType"]["species"]["metSpeciesCount"] == 2
    assert doc["summary"]["byType"]["species"]["totalSpeciesCount"] == 3
    assert doc["summary"]["byType"]["strategicEcosystems"]["metCount"] == 1
    assert doc["summary"]["byType"]["ecosystems"]["metCount"] == 1
    assert doc["rollups"]["species"]["byTaxa"]["mammals"]["metSpeciesCount"] == 1
    assert doc["rollups"]["species"]["byTaxa"]["birds"]["totalSpeciesCount"] == 1
    assert doc["rollups"]["species"]["byIucnStatus"]["unknown"]["metSpeciesCount"] == 1
    assert doc["rollups"]["species"]["unmatchedSpeciesCount"] == 1
    assert doc["features"]["species"][0]["iucnStatus"] == "VU"
    assert doc["features"]["species"][0]["relativeHeld"] == 0.3
    assert doc["features"]["species"][1]["relativeTarget"] == 0.17
    assert doc["features"]["species"][1]["relativeHeld"] == 0.1
    assert doc["features"]["species"][1]["absoluteHeld"] == 2
    assert doc["features"]["strategicEcosystems"][0]["featureId"] == "paramos"
    assert doc["targetContext"]["relativeTargetsByType"]["species"] == [0.17]
    assert doc["source"]["summaryCsvUrl"] == "https://example.com/demo_summary.csv"
    assert doc["source"]["solutionDomain"] == "land"


LEGACY_SUMMARY_HEADER = (
    "feature,met,total_amount,absolute_target,absolute_held,absolute_shortfall,"
    "relative_target,relative_held,relative_shortfall,scenario,type,class"
)

RELEASE_SUMMARY_HEADER = (
    "feature,met,total_amount,absolute_target,absolute_held,absolute_shortfall,"
    "relative_target,relative_held,relative_shortfall,feature_type,class,"
    "scenario,evaluated"
)


def _land_goals_document(tmp_path: Path, header: str, rows: list[str]) -> dict:
    summary_csv = tmp_path / "summary.csv"
    summary_csv.write_text("\n".join([header, *rows]) + "\n", encoding="utf-8")
    return build_goals_document(
        solution={"id": "demo_solution", "name": "Demo Solution"},
        summary_csv_path=summary_csv,
        species_records=[_record("Panthera onca", "Mammalia", "VU", threatened=True)],
        summary_csv_url="https://example.com/demo_summary.csv",
        generated_at="2026-08-07T00:00:00Z",
    )


def test_legacy_type_column_still_classifies_and_is_reported(tmp_path: Path):
    doc = _land_goals_document(
        tmp_path,
        LEGACY_SUMMARY_HEADER,
        [
            "paramos,true,100,17,33,0,0.17,0.33,0,demo,NA,NA",
            "Ecosystem A,true,200,34,40,0,0.17,0.20,0,demo,ecosystem,Ecosystem",
            "Panthera onca,true,10,1.7,3,0,0.17,0.3,0,demo,species,Mammalia",
        ],
    )

    assert doc["diagnostics"]["rowCounts"] == {
        "species": 1,
        "strategicEcosystems": 1,
        "ecosystems": 1,
        "other": 0,
    }
    assert doc["diagnostics"]["rawTypeCounts"] == {
        "NA": 1,
        "ecosystem": 1,
        "species": 1,
    }


def test_renamed_feature_type_column_classifies_release_schema(tmp_path: Path):
    doc = _land_goals_document(
        tmp_path,
        RELEASE_SUMMARY_HEADER,
        [
            "Hidrobioma Alto Caquetá,TRUE,143,24.3,60,0,0.17,0.41,0,ecosystem,NA,"
            "demo,prioritizr_model",
            "paramos,TRUE,100,17,33,0,0.17,0.33,0,strategic ecosystem,NA,"
            "demo,prioritizr_model",
            "humedales,TRUE,100,17,33,0,0.17,0.33,0,STRATEGIC_ECOSYSTEM,NA,"
            "demo,prioritizr_model",
            "Panthera onca,TRUE,10,1.7,3,0,0.17,0.3,0,species,Mammalia,"
            "demo,prioritizr_model",
            "carbono,TRUE,100,17,42,0,0.17,0.42,0,ecosystem service,NA,"
            "demo,prioritizr_model",
        ],
    )

    assert doc["diagnostics"]["rowCounts"] == {
        "species": 1,
        "strategicEcosystems": 2,
        "ecosystems": 1,
        "other": 1,
    }
    assert doc["diagnostics"]["rawTypeCounts"] == {
        "STRATEGIC_ECOSYSTEM": 1,
        "ecosystem": 1,
        "ecosystem service": 1,
        "species": 1,
        "strategic ecosystem": 1,
    }
    assert doc["features"]["other"][0]["featureName"] == "carbono"
    assert doc["rollups"]["species"]["byTaxa"]["mammals"]["totalSpeciesCount"] == 1
    assert doc["rollups"]["species"]["byIucnStatus"]["VU"]["metSpeciesCount"] == 1


def test_all_supported_land_rows_join_the_final_goal_universe(tmp_path: Path):
    doc = _land_goals_document(
        tmp_path,
        RELEASE_SUMMARY_HEADER,
        [
            "Ecosystem solver,TRUE,100,17,20,0,0.17,0.20,0,ecosystem,NA,"
            "demo,prioritizr_model",
            "Ecosystem pre-existing,TRUE,100,17,35,0,0.17,0.35,0,ecosystem,NA,"
            "demo,post-hoc",
            "Ecosystem unknown,NA,100,17,NA,NA,0.17,NA,NA,ecosystem,NA,"
            "demo,post-hoc",
            "Panthera onca,TRUE,10,0,3,0,0,0.3,0,species,Mammalia,"
            "demo,post-hoc",
            "Ara macao,NA,10,1.7,NA,NA,0.17,NA,NA,species,Aves,"
            "demo,post-hoc",
        ],
    )

    ecosystems = doc["features"]["ecosystems"]
    assert [feature["featureName"] for feature in ecosystems] == [
        "Ecosystem solver",
        "Ecosystem pre-existing",
        "Ecosystem unknown",
    ]
    assert [feature["evaluationSource"] for feature in ecosystems] == [
        "prioritizr_model",
        "post-hoc",
        "post-hoc",
    ]
    assert doc["summary"]["byType"]["ecosystems"] == {
        "metCount": 2,
        "totalCount": 3,
        "pctMet": 66.6667,
    }
    assert doc["summary"]["byType"]["species"] == {
        "metSpeciesCount": 1,
        "totalSpeciesCount": 2,
        "pctMet": 50.0,
    }
    assert doc["features"]["species"][0]["relativeTarget"] == 0
    assert doc["features"]["species"][1]["met"] is None
    assert doc["rollups"]["species"]["byTaxa"]["birds"]["totalSpeciesCount"] == 1
    assert doc["rollups"]["species"]["byIucnStatus"]["unknown"]["totalSpeciesCount"] == 1
    assert doc["features"]["ecosystems"][2]["met"] is None
    assert doc["source"]["summaryCsvRows"] == 5
    assert doc["diagnostics"]["sourceRowCount"] == 5
    assert doc["diagnostics"]["evaluationSourceCounts"] == {
        "post-hoc": 4,
        "prioritizr_model": 1,
    }
    assert doc["diagnostics"]["excludedEvaluationSourceCounts"] == {}


def test_land_summary_rejects_unsupported_evaluation_provenance(tmp_path: Path):
    with pytest.raises(GoalsSchemaError, match=r"unsupported.*NA \(1\).*manual \(1\)"):
        _land_goals_document(
            tmp_path,
            RELEASE_SUMMARY_HEADER,
            [
                "Panthera onca,TRUE,10,1.7,3,0,0.17,0.3,0,species,Mammalia,"
                "demo,prioritizr_model",
                "Species manual,TRUE,10,1.7,3,0,0.17,0.3,0,species,Aves,demo,manual",
                "Species blank,NA,10,1.7,NA,NA,0.17,NA,NA,species,Aves,demo,NA",
            ],
        )


def test_declared_ecosystem_outranks_strategic_name_lookup(tmp_path: Path):
    doc = _land_goals_document(
        tmp_path,
        RELEASE_SUMMARY_HEADER,
        [
            "paramos,TRUE,100,17,33,0,0.17,0.33,0,ecosystem,NA,demo,prioritizr_model",
        ],
    )

    assert doc["features"]["ecosystems"][0]["featureId"] == "paramos"
    assert doc["features"]["strategicEcosystems"] == []


def test_missing_declared_type_falls_back_to_strategic_name_lookup(tmp_path: Path):
    doc = _land_goals_document(
        tmp_path,
        RELEASE_SUMMARY_HEADER,
        [
            "bosque_seco,TRUE,100,17,33,0,0.17,0.33,0,NA,NA,demo,prioritizr_model",
            "Crocodylia,TRUE,60,10.2,11,0,0.17,0.18,0,NA,NA,demo,prioritizr_model",
        ],
    )

    assert doc["features"]["strategicEcosystems"][0]["label"] == "Dry Forest"
    assert doc["features"]["other"][0]["featureName"] == "Crocodylia"
    assert doc["diagnostics"]["rawTypeCounts"] == {"NA": 2}


def test_land_summary_without_any_feature_type_column_fails_closed(tmp_path: Path):
    summary_csv = tmp_path / "typeless_summary.csv"
    summary_csv.write_text(
        "feature,met,relative_target,scenario\nparamos,TRUE,0.17,demo\n",
        encoding="utf-8",
    )

    with pytest.raises(GoalsSchemaError, match="no feature type column"):
        build_goals_document(
            solution={"id": "demo_solution", "name": "Demo Solution"},
            summary_csv_path=summary_csv,
            species_records=[],
            summary_csv_url="https://example.com/demo_summary.csv",
            generated_at="2026-08-07T00:00:00Z",
        )


def test_build_goals_document_classifies_marine_rows_without_type_column(
    tmp_path: Path,
):
    summary_csv = tmp_path / "marine_summary.csv"
    header = (
        "feature,met,total_amount,absolute_target,absolute_held,"
        "absolute_shortfall,relative_target,relative_held,"
        "relative_shortfall,scenario,evaluated"
    )
    ecosystem_rows = [
        f"Marine ecosystem {index},true,100,30,30,0,0.3,0.3,0,marine,prioritizr_model"
        for index in range(1, 142)
    ]
    mangrove_rows = [
        f"Manglar {index},true,100,30,30,0,0.3,0.3,0,marine,post-hoc"
        for index in range(1, 6)
    ]
    summary_csv.write_text(
        "\n".join([header, *ecosystem_rows, *mangrove_rows]) + "\n",
        encoding="utf-8",
    )
    summary_url = (
        "https://example.com/solutions/marine/"
        "Ecos30+Mang30+RUNAP_HHM_summary.csv"
    )

    doc = build_goals_document(
        solution={
            "id": "marine_demo",
            "name": "Marine Demo",
            "domain": "marine",
            "scope": "marine",
            "metadataUrl": "https://example.com/solutions/marine/marine_demo.json",
        },
        summary_csv_path=summary_csv,
        summary_csv_url=summary_url,
        species_records=[],
        generated_at="2026-07-23T00:00:00Z",
    )

    assert doc["source"]["summaryCsvUrl"] == summary_url
    assert doc["source"]["solutionDomain"] == "marine"
    assert doc["diagnostics"]["rowCounts"] == {
        "species": 0,
        "strategicEcosystems": 0,
        "ecosystems": 141,
        "other": 0,
    }
    assert doc["summary"]["byType"]["species"]["totalSpeciesCount"] == 0
    assert doc["summary"]["byType"]["ecosystems"]["totalCount"] == 141
    assert doc["summary"]["byType"]["strategicEcosystems"]["totalCount"] == 0
    assert all(
        feature["featureType"] == "ecosystems"
        for feature in doc["features"]["ecosystems"]
    )
    assert all(
        feature["featureType"] == "strategicEcosystems"
        for feature in doc["features"]["strategicEcosystems"]
    )
    assert doc["features"]["ecosystems"][0]["evaluationSource"] == "prioritizr_model"
    assert doc["features"]["strategicEcosystems"] == []


def _species_rows(*pairs: tuple[str, str]) -> list[str]:
    return [
        f"{name},TRUE,10,1.7,3,0,0.17,0.3,0,species,{cls},demo,prioritizr_model"
        for name, cls in pairs
    ]


def test_batched_plant_classes_resolve_to_the_plants_group(tmp_path: Path):
    summary_csv = tmp_path / "summary.csv"
    summary_csv.write_text(
        "\n".join([
            RELEASE_SUMMARY_HEADER,
            *_species_rows(
                ("Abarema adenophora", "Magnoliopsida_1"),
                ("Hyptis dilatata", "Magnoliopsida_2"),
                ("Espeletia grandiflora", "Magnoliopsida"),
            ),
        ])
        + "\n",
        encoding="utf-8",
    )

    doc = build_goals_document(
        solution={"id": "demo_solution", "name": "Demo Solution"},
        summary_csv_path=summary_csv,
        species_records=[
            _record("Abarema adenophora", "Magnoliopsida", "LC"),
            _record("Hyptis dilatata", "Magnoliopsida", "LC"),
            _record("Espeletia grandiflora", "Magnoliopsida", "VU"),
        ],
        summary_csv_url="https://example.com/demo_summary.csv",
        generated_at="2026-08-07T00:00:00Z",
    )

    assert doc["rollups"]["species"]["byTaxa"]["plants"]["totalSpeciesCount"] == 3
    assert doc["rollups"]["species"]["ignoredSpeciesRowCount"] == 0
    assert [feature["taxonGroup"] for feature in doc["features"]["species"]] == ["plants"] * 3
    assert doc["diagnostics"]["rawTaxonClassCounts"] == {
        "Magnoliopsida": 1,
        "Magnoliopsida_1": 1,
        "Magnoliopsida_2": 1,
    }


def test_authoritative_record_outranks_a_drifted_csv_class(tmp_path: Path):
    summary_csv = tmp_path / "summary.csv"
    summary_csv.write_text(
        "\n".join([
            RELEASE_SUMMARY_HEADER,
            *_species_rows(("Panthera onca", "Magnoliopsida_2")),
        ])
        + "\n",
        encoding="utf-8",
    )

    doc = build_goals_document(
        solution={"id": "demo_solution", "name": "Demo Solution"},
        summary_csv_path=summary_csv,
        species_records=[_record("Panthera onca", "Mammalia", "VU", threatened=True)],
        summary_csv_url="https://example.com/demo_summary.csv",
        generated_at="2026-08-07T00:00:00Z",
    )

    feature = doc["features"]["species"][0]
    assert feature["taxonGroup"] == "mammals"
    assert feature["taxonClass"] == "Mammalia"
    assert "plants" not in doc["rollups"]["species"]["byTaxa"]
    assert doc["diagnostics"]["rawTaxonClassCounts"] == {"Magnoliopsida_2": 1}


def test_unmatched_species_falls_back_to_the_normalized_csv_class(tmp_path: Path):
    summary_csv = tmp_path / "summary.csv"
    summary_csv.write_text(
        "\n".join([
            RELEASE_SUMMARY_HEADER,
            *_species_rows(("Uncatalogued planta", "Magnoliopsida_1")),
        ])
        + "\n",
        encoding="utf-8",
    )

    doc = build_goals_document(
        solution={"id": "demo_solution", "name": "Demo Solution"},
        summary_csv_path=summary_csv,
        species_records=[],
        summary_csv_url="https://example.com/demo_summary.csv",
        generated_at="2026-08-07T00:00:00Z",
    )

    feature = doc["features"]["species"][0]
    assert feature["taxonGroup"] == "plants"
    assert feature["taxonClass"] == "Magnoliopsida"
    assert doc["rollups"]["species"]["unmatchedSpeciesCount"] == 1
    assert doc["rollups"]["species"]["ignoredSpeciesRowCount"] == 0


def test_unknown_taxon_class_stays_unresolved_below_the_tolerance(tmp_path: Path):
    known = [(f"Known plant {index}", "Magnoliopsida") for index in range(1, 100)]
    summary_csv = tmp_path / "summary.csv"
    summary_csv.write_text(
        "\n".join([
            RELEASE_SUMMARY_HEADER,
            *_species_rows(*known, ("Mystery organism", "Xenarthra")),
        ])
        + "\n",
        encoding="utf-8",
    )

    doc = build_goals_document(
        solution={"id": "demo_solution", "name": "Demo Solution"},
        summary_csv_path=summary_csv,
        species_records=[_record(name, cls, "LC") for name, cls in known],
        summary_csv_url="https://example.com/demo_summary.csv",
        generated_at="2026-08-07T00:00:00Z",
    )

    unresolved = doc["features"]["species"][-1]
    assert unresolved["taxonGroup"] is None
    assert unresolved["taxonClass"] == "Xenarthra"
    assert doc["rollups"]["species"]["ignoredSpeciesRowCount"] == 1
    assert doc["rollups"]["species"]["byTaxa"]["plants"]["totalSpeciesCount"] == 99


def test_widespread_unresolved_taxon_groups_fail_closed(tmp_path: Path):
    summary_csv = tmp_path / "summary.csv"
    summary_csv.write_text(
        "\n".join([
            RELEASE_SUMMARY_HEADER,
            *_species_rows(
                ("Panthera onca", "Mammalia"),
                ("Mystery one", "Chunkedae_1"),
                ("Mystery two", "Chunkedae_2"),
            ),
        ])
        + "\n",
        encoding="utf-8",
    )

    with pytest.raises(GoalsSchemaError, match="without a taxon group"):
        build_goals_document(
            solution={"id": "demo_solution", "name": "Demo Solution"},
            summary_csv_path=summary_csv,
            species_records=[_record("Panthera onca", "Mammalia", "VU")],
            summary_csv_url="https://example.com/demo_summary.csv",
            generated_at="2026-08-07T00:00:00Z",
        )


def test_marine_summary_is_unaffected_by_the_taxon_guard(tmp_path: Path):
    summary_csv = tmp_path / "marine_summary.csv"
    summary_csv.write_text(
        "feature,met,relative_target,scenario,evaluated\n"
        "Marine ecosystem 1,true,0.3,marine,prioritizr_model\n",
        encoding="utf-8",
    )

    doc = build_goals_document(
        solution={"id": "marine_demo", "name": "Marine Demo", "domain": "marine"},
        summary_csv_path=summary_csv,
        species_records=[],
        summary_csv_url="https://example.com/marine_summary.csv",
        generated_at="2026-08-07T00:00:00Z",
    )

    assert doc["diagnostics"]["rowCounts"]["ecosystems"] == 1
    assert doc["diagnostics"]["rawTaxonClassCounts"] == {}
    assert doc["rollups"]["species"]["ignoredSpeciesRowCount"] == 0


def test_expected_goals_blob_path_uses_safe_solution_id():
    assert (
        expected_goals_blob_path("demo-solution-one")
        == "metrics/goals/demo-solution-one.goals.json"
    )


def test_release_goals_resume_requires_exact_provenance(tmp_path: Path):
    catalog_path = tmp_path / "catalog.json"
    catalog_path.write_text(
        json.dumps(
            {
                "format": "solution-catalog-v1",
                "catalogVersion": "0.1.0",
                "releaseId": "goals-release",
                "expectedSolutionCount": 1,
                "expectedLandSolutionCount": 1,
                "expectedMarineSolutionCount": 0,
                "speciesException": {
                    "format": "release-species-exception-binding-v1",
                    "policyFormat": "release-species-exception-v1",
                    "policyId": "goals-release-policy",
                    "policySha256": "d" * 64,
                    "catalogTotal": 8300,
                    "availableExpected": 8298,
                    "excluded": 2,
                },
                "solutions": [
                    {
                        "solutionId": "demo",
                        "solutionBasename": "demo.tif",
                        "domain": "land",
                        "rasterSha256": "a" * 64,
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    catalog = load_solution_catalog(catalog_path)
    solution = {
        "id": "demo",
        "name": "Ecos17",
        "metadataUrl": "https://example.test/demo.csv",
    }
    provenance = _goals_provenance(
        solution=solution,
        catalog=catalog,
        summary_csv_url=solution["metadataUrl"],
        summary_csv_sha256="b" * 64,
        species_csv_sha256="c" * 64,
    )
    path = tmp_path / "demo.goals.json"
    summary_path = tmp_path / "summary.csv"
    summary_path.write_text("feature,type,met\n", encoding="utf-8")
    document = build_goals_document(
        solution=solution,
        summary_csv_path=summary_path,
        species_records=[],
        summary_csv_url=solution["metadataUrl"],
        generated_at="2026-01-01T00:00:00Z",
    )
    document["goalsProvenance"] = provenance
    path.write_text(
        json.dumps(document),
        encoding="utf-8",
    )

    assert _goals_is_resumable(
        path,
        solution_id="demo",
        expected_provenance=provenance,
    )
    assert provenance["catalogBinding"]["speciesException"]["excluded"] == 2
    stale_document = json.loads(path.read_text(encoding="utf-8"))
    stale_document["goalsProvenance"]["catalogBinding"].pop("speciesException")
    path.write_text(json.dumps(stale_document), encoding="utf-8")
    assert not _goals_is_resumable(
        path,
        solution_id="demo",
        expected_provenance=provenance,
    )
    document["goalsProvenance"] = provenance
    path.write_text(json.dumps(document), encoding="utf-8")
    assert not _goals_is_resumable(
        path,
        solution_id="demo",
        expected_provenance={**provenance, "summaryCsvSha256": "d" * 64},
    )
    release_config = load_release_config("goals-release")
    assert expected_goals_blob_path(
        "demo",
        goals_blob_directory=release_config.goals_directory,
    ) == "releases/goals-release/goals/demo.goals.json"
    assert expected_goals_blob_path(
        "demo",
        goals_blob_directory=release_config.goals_current_directory,
    ) == "releases/goals-release/goals/v4/demo.goals.json"
