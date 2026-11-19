import json
from pathlib import Path

from species_data import SpeciesRecord
from species_goals import build_catalog
from species_target_overlays import (
    build_species_target_overlays,
    validate_species_target_overlays,
)

SHA = "a" * 64


def test_overlay_is_deterministic_and_deduplicates_exactly_six_maps(tmp_path: Path):
    records = [
        SpeciesRecord(f"Species {index}", "Aves", "LC", 1.0, "birds", True)
        for index in range(8)
    ]
    records.append(
        SpeciesRecord("Unavailable", "Aves", "LC", None, "birds", False)
    )
    catalog = build_catalog(
        records,
        unavailable_species_ids={"unavailable"},
        provenance={
            "releaseId": "fixture-release",
            "speciesCsvSha256": SHA,
            "exceptionSourceSha256": SHA,
            "exceptionPolicySha256": SHA,
            "exceptionBindingSha256": SHA,
            "inventory": {"catalogTotal": 9, "unavailable": 1, "zeroRange": 0},
        },
    )
    catalog_path = tmp_path / "catalog.json"
    catalog_path.write_text(json.dumps(catalog), encoding="utf-8")

    summaries = tmp_path / "summaries"
    summaries.mkdir()
    solutions = []
    target_maps = [
        [0, 1],
        [0, 1, 2],
        [0, 1, 2, 3],
        [0, 1, 2, 3, 4],
        [0, 1, 2, 3, 4, 5],
        [0, 1, 2, 3, 4, 5, 6],
    ]
    for index in range(168):
        solution_id = f"solution_{index:03d}"
        basename = f"Solution{index:03d}.tif"
        solutions.append(
            {
                "domain": "land",
                "solutionId": solution_id,
                "solutionBasename": basename,
            }
        )
        targets = target_maps[index % 6] if index < 144 else []
        _write_summary(
            summaries / f"{Path(basename).stem}_summary.csv",
            Path(basename).stem,
            records,
            targets,
        )
    solution_catalog = {
        "format": "solution-catalog-v1",
        "releaseId": "fixture-release",
        "expectedLandSolutionCount": 168,
        "solutions": solutions,
    }
    solution_catalog_path = tmp_path / "solutions.json"
    solution_catalog_path.write_text(json.dumps(solution_catalog), encoding="utf-8")
    report_path = tmp_path / "report.json"
    report_path.write_text(
        json.dumps(
            {
                "releaseId": "fixture-release",
                "catalog": {"catalogSha256": catalog["catalogSha256"]},
            }
        ),
        encoding="utf-8",
    )

    first = build_species_target_overlays(
        catalog_path=catalog_path,
        solution_catalog_path=solution_catalog_path,
        summaries_dir=summaries,
        full_build_report_path=report_path,
    )
    second = build_species_target_overlays(
        catalog_path=catalog_path,
        solution_catalog_path=solution_catalog_path,
        summaries_dir=summaries,
        full_build_report_path=report_path,
    )

    assert first == second
    assert first["inventory"]["targetMapCount"] == 6
    assert first["inventory"]["targetedSolutionCount"] == 144
    assert first["inventory"]["untargetedSolutionCount"] == 24
    assert first["inventory"]["explicitZeroTargetSpeciesIds"] == ["species_0"]
    validate_species_target_overlays(first, catalog=catalog)


def _write_summary(
    path: Path,
    scenario: str,
    records: list[SpeciesRecord],
    target_indexes: list[int],
) -> None:
    rows = [
        "feature,feature_type,relative_target,relative_held,met,evaluated,scenario"
    ]
    for index in target_indexes:
        target = 0 if index == 0 else 0.17
        rows.append(
            f"{records[index].filename_stem},species,{target},0.2,TRUE,"
            f"post-hoc,{scenario}"
        )
    path.write_text("\n".join(rows) + "\n", encoding="utf-8")
