from __future__ import annotations

import json
from pathlib import Path

from backfill_endemic_species_count import (
    ENDEMIC_METRIC_ID,
    MISSING_GOALS_NOTES,
    SpeciesGoalsIndex,
    backfill_verbose_document,
    count_endemic_species_by_scope,
    count_endemic_species_present,
    endemic_row_for_scope,
    run_backfill,
    upsert_metric_in_catalog_order,
)
from backfill_land_use_of_aoi import load_metric_document
from compact_metrics import to_compact_document
from metric_definitions import computable_metrics
from metrics_contract import PROVENANCE_KEY, catalog_signature
from species_data import SpeciesRecord, load_endemic_flags, load_species_records
from species_goals import CATALOG_ROW_LAYOUT, COMPACT_ROW_LAYOUT


def _endemic_csv(path: Path) -> Path:
    path.write_text(
        "scientific_name,endemic,conservation_type\n"
        "Alpha beta,1,RUNAP\n"
        "Alpha beta,1,OMEC\n"
        "Gamma delta,0,RUNAP\n"
        "Gamma delta,0,OMEC\n"
        "Only once,1,RUNAP\n"
        "Only once,0,OMEC\n",
        encoding="utf-8",
    )
    return path


def _species_csv(path: Path) -> Path:
    path.write_text(
        "scientific_name,class,iucn_status,range_km2\n"
        "Alpha beta,Aves,LC,10\n"
        "Missing name,Aves,LC,5\n",
        encoding="utf-8",
    )
    return path


def _document(
    *,
    solution_id: str = "demo",
    domain: str = "land",
    empty_department: bool = False,
    extra_metrics: list[dict] | None = None,
) -> dict:
    rows = [
        {
            "metricId": "threatened_species_count",
            "value": 3,
            "unit": "count",
            "status": "ready",
            "source": "test",
            "notes": "threatened",
            "labelKey": "metrics.tier1.threatened_species_count",
            "formatHint": "number",
        },
        {
            "metricId": "species_pct_of_national",
            "value": 1.4,
            "unit": "%",
            "status": "ready",
            "source": "test",
            "notes": "share",
            "labelKey": "metrics.tier1.species_pct_of_national",
            "formatHint": "percent",
        },
    ]
    if extra_metrics:
        rows.extend(extra_metrics)
    department_metrics = [dict(row) for row in rows]
    return {
        "solutionId": solution_id,
        "generatedAt": "2026-09-12T00:00:00Z",
        PROVENANCE_KEY: {
            "schemaVersion": 4,
            "solutionDomain": domain,
            "generationConfig": {
                "nationalOnly": False,
                "regionalPacket": False,
            },
            "catalogSignature": "metrics-catalog-v4:" + "a" * 64,
        },
        "geographies": {
            "national": {
                "colombia": {
                    "name": "Colombia",
                    "scopeState": {
                        "classification": "supported",
                        "solutionValidCellCount": 4,
                    },
                    "metrics": rows,
                }
            },
            "departments": {
                "05": {
                    "name": "Antioquia",
                    "scopeState": {
                        "classification": "empty" if empty_department else "supported",
                        "solutionValidCellCount": 0 if empty_department else 2,
                    },
                    "metrics": department_metrics,
                }
            },
        },
    }


def _write_species_goals(
    root: Path,
    *,
    solution_id: str = "demo",
    include_departments: bool = True,
) -> Path:
    catalog_dir = root / "species-goals" / "catalog" / "v1"
    catalog_dir.mkdir(parents=True)
    catalog = {
        "format": "species-goals-catalog-v1",
        "rowLayout": list(CATALOG_ROW_LAYOUT),
        "rows": [
            ["alpha_beta", "Alpha beta", "birds", "LC", 10.0, "available"],
            ["gamma_delta", "Gamma delta", "birds", "LC", 8.0, "available"],
            ["missing_name", "Missing name", "birds", "LC", 5.0, "available"],
        ],
    }
    (catalog_dir / "catalog.json").write_text(
        json.dumps(catalog),
        encoding="utf-8",
    )

    compact_root = root / "species-goals" / "compact" / "v1" / solution_id
    compact_root.mkdir(parents=True)
    national = {
        "format": "species-goals-compact-v1",
        "solutionId": solution_id,
        "geographyLevel": "national",
        "rowLayout": list(COMPACT_ROW_LAYOUT),
        "scopeCatalog": [["colombia", "Colombia"]],
        "rows": [
            [0, 0, 10.0, 2.5, 0.0, 2.5, 17.0, 0],
            [0, 1, 8.0, 1.0, 0.0, 1.0, 17.0, 0],
            [0, 2, 5.0, 4.0, 0.0, 4.0, 17.0, 0],
        ],
    }
    (compact_root / "national.species-goals.compact.json").write_text(
        json.dumps(national),
        encoding="utf-8",
    )
    if include_departments:
        departments = {
            "format": "species-goals-compact-v1",
            "solutionId": solution_id,
            "geographyLevel": "departments",
            "rowLayout": list(COMPACT_ROW_LAYOUT),
            "scopeCatalog": [["05", "Antioquia"]],
            "rows": [
                [0, 0, 3.0, 1.2, 0.0, 1.2, 17.0, 0],
            ],
        }
        (compact_root / "departments.species-goals.compact.json").write_text(
            json.dumps(departments),
            encoding="utf-8",
        )
    return root


def test_count_helper_requires_positive_covered_area_and_endemic_flag():
    names = {0: "Alpha beta", 1: "Gamma delta", 2: "Missing name"}
    endemic = {"Alpha beta": True, "Gamma delta": False}
    rows = [
        [0, 0, 10.0, 2.5, 0.0, 2.5, 17.0, 0],
        [0, 1, 8.0, 3.0, 0.0, 3.0, 17.0, 0],
        [0, 2, 5.0, 4.0, 0.0, 4.0, 17.0, 0],
        [0, 0, 10.0, 0.0, 0.0, 0.0, 17.0, 0],
        [1, 0, 4.0, 1.0, 0.0, 1.0, 17.0, 0],
    ]

    assert (
        count_endemic_species_present(
            rows,
            scientific_name_by_index=names,
            endemic_by_name=endemic,
            scope_index=0,
        )
        == 1
    )
    assert (
        count_endemic_species_present(
            rows,
            scientific_name_by_index=names,
            endemic_by_name=endemic,
            scope_index=1,
        )
        == 1
    )
    assert count_endemic_species_by_scope(
        rows,
        scientific_name_by_index=names,
        endemic_by_name=endemic,
    ) == {0: 1, 1: 1}


def test_load_endemic_flags_and_absent_join(tmp_path: Path):
    flags = load_endemic_flags(_endemic_csv(tmp_path / "endemic.csv"))
    assert flags == {
        "Alpha beta": True,
        "Gamma delta": False,
        "Only once": True,
    }

    records = load_species_records(_species_csv(tmp_path / "species.csv"))
    assert records == [
        SpeciesRecord("Alpha beta", "Aves", "LC", 10.0, "birds", False, False),
        SpeciesRecord("Missing name", "Aves", "LC", 5.0, "birds", False, False),
    ]

    joined = load_species_records(
        tmp_path / "species.csv",
        endemic_csv_path=tmp_path / "endemic.csv",
    )
    assert joined[0].endemic is True
    assert joined[1].endemic is False


def test_upsert_places_endemic_between_threatened_and_national_share():
    definition = next(
        item for item in computable_metrics() if item.metric_id == ENDEMIC_METRIC_ID
    )
    metrics = [
        {"metricId": "threatened_species_count", "value": 3},
        {"metricId": "species_pct_of_national", "value": 1.4},
    ]
    updated = upsert_metric_in_catalog_order(
        metrics,
        {
            "metricId": definition.metric_id,
            "value": 12,
            "status": "ready",
        },
    )
    assert [row["metricId"] for row in updated] == [
        "threatened_species_count",
        "endemic_species_count",
        "species_pct_of_national",
    ]


def test_marine_scope_is_not_applicable(tmp_path: Path):
    goals = SpeciesGoalsIndex(_write_species_goals(tmp_path))
    row = endemic_row_for_scope(
        domain="marine",
        empty_scope=False,
        solution_id="demo",
        level="national",
        scope_id="colombia",
        goals=goals,
        endemic_by_name={"Alpha beta": True},
    )
    assert row["metricId"] == ENDEMIC_METRIC_ID
    assert row["status"] == "not_applicable"
    assert row["value"] is None


def test_missing_species_goals_fail_closed(tmp_path: Path):
    empty_root = tmp_path / "empty-goals"
    empty_root.mkdir()
    goals = SpeciesGoalsIndex(empty_root)
    row = endemic_row_for_scope(
        domain="land",
        empty_scope=False,
        solution_id="demo",
        level="national",
        scope_id="colombia",
        goals=goals,
        endemic_by_name={"Alpha beta": True},
    )
    assert row["status"] == "blocked"
    assert row["value"] is None
    assert row["notes"] == MISSING_GOALS_NOTES


def test_empty_land_scope_uses_empty_boundary(tmp_path: Path):
    goals = SpeciesGoalsIndex(_write_species_goals(tmp_path))
    row = endemic_row_for_scope(
        domain="land",
        empty_scope=True,
        solution_id="demo",
        level="departments",
        scope_id="05",
        goals=goals,
        endemic_by_name={"Alpha beta": True},
    )
    assert row["status"] == "empty"
    assert row["value"] is None


def test_backfill_counts_national_and_blocks_missing_department(tmp_path: Path):
    endemic = {"Alpha beta": True, "Gamma delta": False}
    goals = SpeciesGoalsIndex(
        _write_species_goals(tmp_path, include_departments=False)
    )
    updated = backfill_verbose_document(
        _document(),
        endemic_by_name=endemic,
        goals=goals,
    )
    national = updated["geographies"]["national"]["colombia"]["metrics"]
    department = updated["geographies"]["departments"]["05"]["metrics"]
    endemic_national = next(
        row for row in national if row["metricId"] == ENDEMIC_METRIC_ID
    )
    endemic_department = next(
        row for row in department if row["metricId"] == ENDEMIC_METRIC_ID
    )
    assert [row["metricId"] for row in national].index(ENDEMIC_METRIC_ID) == (
        [row["metricId"] for row in national].index("threatened_species_count") + 1
    )
    assert endemic_national["status"] == "ready"
    assert endemic_national["value"] == 1
    assert endemic_department["status"] == "blocked"
    assert updated[PROVENANCE_KEY]["catalogSignature"] == catalog_signature(
        "land",
        updated[PROVENANCE_KEY]["generationConfig"],
    )


def test_run_backfill_writes_compact_and_skips_marine(tmp_path: Path):
    endemic_csv = _endemic_csv(tmp_path / "endemic.csv")
    goals_root = _write_species_goals(tmp_path / "goals", solution_id="demo")
    input_dir = tmp_path / "input"
    input_dir.mkdir()
    land = _document()
    marine = _document(solution_id="marine-demo", domain="marine")
    (input_dir / "demo.metrics.compact.json").write_text(
        json.dumps(to_compact_document(land), separators=(",", ":")),
        encoding="utf-8",
    )
    (input_dir / "marine-demo.metrics.compact.json").write_text(
        json.dumps(to_compact_document(marine), separators=(",", ":")),
        encoding="utf-8",
    )
    output_dir = tmp_path / "out"
    report = run_backfill(
        input_dir=input_dir,
        output_dir=output_dir,
        species_goals_root=goals_root,
        endemic_csv=endemic_csv,
    )
    assert report["uniqueSolutions"] == 2
    land_out, compact = load_metric_document(output_dir / "demo.metrics.compact.json")
    assert compact is True
    national = next(
        row
        for row in land_out["geographies"]["national"]["colombia"]["metrics"]
        if row["metricId"] == ENDEMIC_METRIC_ID
    )
    assert national["value"] == 1
    marine_out, _ = load_metric_document(
        output_dir / "marine-demo.metrics.compact.json"
    )
    marine_row = next(
        row
        for row in marine_out["geographies"]["national"]["colombia"]["metrics"]
        if row["metricId"] == ENDEMIC_METRIC_ID
    )
    assert marine_row["status"] == "not_applicable"
    assert marine_row["value"] is None
