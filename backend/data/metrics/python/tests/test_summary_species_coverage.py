from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from summary_species_coverage import (
    compute_species_group_coverage_details,
    normalize_summary_class,
)


@dataclass(frozen=True)
class _Record:
    scientific_name: str
    iucn_status: str


def _record(name: str, csv_class: str, iucn_status: str) -> _Record:
    assert normalize_summary_class(csv_class) is not None
    return _Record(scientific_name=name, iucn_status=iucn_status)


def test_compute_species_group_coverage_details_counts_groups_and_iucn(tmp_path: Path):
    summary_csv = tmp_path / "solution_summary.csv"
    summary_csv.write_text(
        "\n".join([
            "feature,met,total_amount,absolute_target,absolute_held,absolute_shortfall,"
            "relative_target,relative_held,relative_shortfall,solution,type,class",
            "Panthera onca,true,1,1,1,0,30,30,0,demo,species,Mammalia",
            "Ara macao,false,1,1,0,1,30,10,20,demo,species,Aves",
            "Boa constrictor,true,1,1,1,0,30,30,0,demo,species,Squamata",
            "Crocodylus acutus,false,1,1,0,1,30,0,30,demo,species,Crocodylia",
            "Plantus example,true,1,1,1,0,30,30,0,demo,species,Magnoliospida",
            "Unknown species,true,1,1,1,0,30,30,0,demo,species,Mammalia",
            "Forest,false,1,1,0,1,30,0,30,demo,ecosystem,Ecosystem",
        ])
        + "\n",
        encoding="utf-8",
    )
    records = [
        _record("Panthera onca", "Mammalia", "NT"),
        _record("Ara macao", "Aves", "LC"),
        _record("Boa constrictor", "Squamata", "VU"),
        _record("Crocodylus acutus", "Crocodylia", "CR"),
        _record("Plantus example", "Magnoliopsida", "DD"),
    ]

    details = compute_species_group_coverage_details(summary_csv, records)

    assert details is not None
    assert details["summary"] == {"metSpeciesCount": 4, "totalSpeciesCount": 6}
    assert details["groups"]["mammals"]["metSpeciesCount"] == 2
    assert details["groups"]["mammals"]["totalSpeciesCount"] == 2
    assert details["groups"]["mammals"]["iucnStatusBreakdown"]["NT"] == {
        "metSpeciesCount": 1,
        "totalSpeciesCount": 1,
    }
    assert details["groups"]["mammals"]["iucnStatusBreakdown"]["unknown"] == {
        "metSpeciesCount": 1,
        "totalSpeciesCount": 1,
    }
    assert details["groups"]["reptiles"]["metSpeciesCount"] == 1
    assert details["groups"]["reptiles"]["totalSpeciesCount"] == 2
    assert details["groups"]["plants"]["metSpeciesCount"] == 1
    assert details["unmatchedSpeciesCount"] == 1
    assert details["ignoredSpeciesRowCount"] == 0


def test_compute_species_group_coverage_details_returns_none_without_species_rows(tmp_path: Path):
    summary_csv = tmp_path / "solution_summary.csv"
    summary_csv.write_text(
        "feature,met,solution,type,class\nForest,true,demo,ecosystem,Ecosystem\n",
        encoding="utf-8",
    )

    assert compute_species_group_coverage_details(summary_csv, []) is None
