from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from conservation_goals import (
    GOALS_FORMAT,
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


def test_expected_goals_blob_path_uses_safe_solution_id():
    assert (
        expected_goals_blob_path("demo solution/one")
        == "metrics/goals/demo_solution_one.goals.json"
    )
