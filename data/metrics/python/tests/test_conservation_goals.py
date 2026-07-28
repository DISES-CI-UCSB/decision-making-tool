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
    _load_manifest_payload,
    _parse_args,
    build_goals_document,
    expected_goals_blob_path,
)


@dataclass(frozen=True)
class _SpeciesRecord:
    scientific_name: str
    csv_class: str
    iucn_status: str
    range_km2: float | None
    bucket: str | None
    threatened: bool


def _record(name: str, cls: str, iucn: str, threatened: bool = False) -> _SpeciesRecord:
    return _SpeciesRecord(
        scientific_name=name,
        csv_class=cls,
        iucn_status=iucn,
        range_km2=123.4,
        bucket=None,
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
        "strategicEcosystems": 5,
        "ecosystems": 141,
        "other": 0,
    }
    assert doc["summary"]["byType"]["species"]["totalSpeciesCount"] == 0
    assert doc["summary"]["byType"]["ecosystems"]["totalCount"] == 141
    assert doc["summary"]["byType"]["strategicEcosystems"]["totalCount"] == 5
    assert all(
        feature["featureType"] == "ecosystems"
        for feature in doc["features"]["ecosystems"]
    )
    assert all(
        feature["featureType"] == "strategicEcosystems"
        for feature in doc["features"]["strategicEcosystems"]
    )
    assert doc["features"]["ecosystems"][0]["evaluationSource"] == "prioritizr_model"
    assert (
        doc["features"]["strategicEcosystems"][0]["evaluationSource"]
        == "post-hoc"
    )


def test_expected_goals_blob_path_uses_safe_solution_id():
    assert (
        expected_goals_blob_path("demo solution/one")
        == "metrics/goals/demo_solution_one.goals.json"
    )
