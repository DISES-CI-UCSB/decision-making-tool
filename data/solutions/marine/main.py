"""Validate delivered marine outputs and build runtime solution metadata."""

from __future__ import annotations

import argparse
import csv
import json
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Scenario:
    source_stem: str
    solution_id: str
    target_percent: int
    includes_omec: bool

    @property
    def display_name(self) -> str:
        settings = "RUNAP · OMEC · HHM" if self.includes_omec else "RUNAP · HHM"
        return f"Marine {self.target_percent}% · {settings}"


SCENARIOS = (
    Scenario("Ecos30+Mang30+RUNAP_HHM", "marine_ecos30_mang30_runap_hhm", 30, False),
    Scenario(
        "Ecos30+Mang30+RUNAP+OMEC_HHM",
        "marine_ecos30_mang30_runap_omec_hhm",
        30,
        True,
    ),
    Scenario("Ecos50+Mang50+RUNAP_HHM", "marine_ecos50_mang50_runap_hhm", 50, False),
    Scenario(
        "Ecos50+Mang50+RUNAP+OMEC_HHM",
        "marine_ecos50_mang50_runap_omec_hhm",
        50,
        True,
    ),
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source_dir", type=Path, help="Directory containing the delivered TIFF and CSV files")
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path(__file__).parent,
        help="Metadata output directory",
    )
    return parser.parse_args()


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def number(value: str) -> int | float:
    parsed = float(value)
    return int(parsed) if parsed.is_integer() else parsed


def build_metadata(
    scenario: Scenario,
    source_dir: Path,
    evaluation_by_scenario: dict[str, dict[str, str]],
) -> dict[str, object]:
    raster_path = source_dir / f"{scenario.source_stem}.tif"
    summary_path = source_dir / f"{scenario.source_stem}_summary.csv"
    if not raster_path.is_file() or not summary_path.is_file():
        raise FileNotFoundError(f"Missing raster or summary for {scenario.source_stem}")

    coverage = read_csv(summary_path)
    if len(coverage) != 146:
        raise ValueError(f"{summary_path.name} has {len(coverage)} rows; expected 146")
    if {row["scenario"] for row in coverage} != {scenario.source_stem}:
        raise ValueError(f"{summary_path.name} contains an unexpected scenario label")

    target_values = {round(float(row["relative_target"]) * 100) for row in coverage}
    if target_values != {scenario.target_percent}:
        raise ValueError(f"{summary_path.name} target values do not match its scenario name")

    evaluation = evaluation_by_scenario[scenario.source_stem]
    include_ids = ["INCL_RUNAP", *(["INCL_OMEC"] if scenario.includes_omec else [])]
    evaluation_counts = {
        evaluation_type: sum(row["evaluated"] == evaluation_type for row in coverage)
        for evaluation_type in ("prioritizr_model", "post-hoc")
    }
    return {
        "id": scenario.solution_id,
        "run_name": scenario.display_name,
        "description": (
            f"Marine ecosystems and mangroves at a {scenario.target_percent}% target, "
            f"with {'RUNAP and OMEC' if scenario.includes_omec else 'RUNAP'} locked in "
            "and HHM used as the cost layer."
        ),
        "domain": "marine",
        "scope": "marine",
        "target_feature_set": "marine_ecosystems_and_mangroves",
        "target_percent": scenario.target_percent,
        "raster_file": raster_path.name,
        "input_layer_ids": {
            "features": ["FEAT_MARINE_ECOSYSTEMS", "FEAT_MANGROVES"],
            "cost": "COST_HHM",
            "includes": include_ids,
            "excludes": [],
        },
        "evaluation": {
            "n_selected": number(evaluation["n_total"]),
            "n_new_protection": number(evaluation["n_new_protection"]),
            "n_locked_in": number(evaluation["n_locked_in"]),
            "cost": number(evaluation["cost"]),
            "pct_targets_met": number(evaluation["pct_targets_met"]),
        },
        "coverage": [],
        "coverage_summary": {
            "row_count": len(coverage),
            "met_count": sum(row["met"].strip().lower() == "true" for row in coverage),
            "evaluation_counts": evaluation_counts,
            "summary_file": summary_path.name,
        },
        "source_files": [raster_path.name, summary_path.name],
        "model_package_status": "outputs_only_source_inputs_pending",
    }


def main() -> None:
    args = parse_args()
    master_rows = read_csv(args.source_dir / "master_eval_summary.csv")
    evaluation_by_scenario = {row["scenario"]: row for row in master_rows}
    expected_scenarios = {scenario.source_stem for scenario in SCENARIOS}
    if set(evaluation_by_scenario) != expected_scenarios:
        raise ValueError("master_eval_summary.csv does not contain exactly the four expected scenarios")

    args.output_dir.mkdir(parents=True, exist_ok=True)
    for scenario in SCENARIOS:
        metadata = build_metadata(scenario, args.source_dir, evaluation_by_scenario)
        output_path = args.output_dir / f"{scenario.solution_id}.json"
        output_path.write_text(
            json.dumps(metadata, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        print(output_path)


if __name__ == "__main__":
    main()
