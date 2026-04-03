#!/usr/bin/env python3
"""Generate per-solution JSON sidecars and a CSV manifest.

This script reads:
- data/solutions/nacional/*.tif
- data/solutions/nacional/master_eval_summary.csv (optional fields per run)
- data/solutions/nacional/master_target_coverage.csv (optional feature coverage per run)

And writes:
- data/solutions/nacional/<solution>.json for each TIFF
- data/solutions/nacional/solution_manifest.csv
"""

from __future__ import annotations

import csv
import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional


@dataclass
class EvalRow:
    n_selected: Optional[str]
    cost: Optional[str]
    pct_targets_met: Optional[str]


def normalize_run_name(name: str) -> str:
    """Normalize known run naming inconsistencies."""
    normalized = name.strip()
    # Current known inconsistency in master_eval_summary.csv
    normalized = normalized.replace("Ecos30_RUNAP_HF_comunidades", "Ecos30+RUNAP_HF_comunidades")
    return normalized


def infer_cost_layer(run_name: str) -> Optional[str]:
    if run_name.endswith("_HF") or "_HF_" in run_name:
        return "COST_HF_2030"
    if run_name.endswith("_CO") or "_CO_" in run_name:
        return "COST_NET_BENEFIT"
    if "CONFLICTO" in run_name:
        return "COST_CONFLICT"
    return None


def infer_includes(run_name: str) -> List[str]:
    includes: List[str] = []
    if "RUNAP" in run_name:
        includes.append("INCL_RUNAP")
    if "OMEC" in run_name:
        includes.append("INCL_OMECS")
    if "comunidades" in run_name.lower():
        includes.append("INCL_COMUNIDADES")
    return includes


def infer_feature_ids(run_name: str, covered_features: List[str]) -> List[str]:
    if run_name.startswith("ESTR30"):
        return ["FEAT_PARAMOS", "FEAT_MANGROVES", "FEAT_WETLANDS", "FEAT_DRY_FOREST"]
    if run_name.startswith("Ecos17") or run_name.startswith("Ecos30"):
        return ["FEAT_SPECIES_RICHNESS"]
    # Fallback from coverage file if naming conventions change
    lowered = {f.lower() for f in covered_features}
    out: List[str] = []
    if "ecosistemas" in lowered:
        out.append("FEAT_SPECIES_RICHNESS")
    if "paramos" in lowered:
        out.append("FEAT_PARAMOS")
    if "manglares invemar" in lowered:
        out.append("FEAT_MANGROVES")
    if "humedales" in lowered:
        out.append("FEAT_WETLANDS")
    if "bosque_seco" in lowered:
        out.append("FEAT_DRY_FOREST")
    return out


def load_eval_rows(path: Path) -> Dict[str, EvalRow]:
    rows: Dict[str, EvalRow] = {}
    if not path.exists():
        return rows
    with path.open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            run = normalize_run_name(row.get("run", ""))
            if not run:
                continue
            rows[run] = EvalRow(
                n_selected=row.get("n_selected") or None,
                cost=row.get("cost") or None,
                pct_targets_met=row.get("pct_targets_met") or None,
            )
    return rows


def load_coverage_rows(path: Path) -> Dict[str, List[dict]]:
    rows: Dict[str, List[dict]] = {}
    if not path.exists():
        return rows
    with path.open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            run = normalize_run_name(row.get("run", ""))
            if not run:
                continue
            rows.setdefault(run, []).append(
                {
                    "feature": row.get("feature"),
                    "met": row.get("met"),
                    "relative_target": row.get("relative_target"),
                    "relative_held": row.get("relative_held"),
                    "relative_shortfall": row.get("relative_shortfall"),
                }
            )
    return rows


def main() -> None:
    base_dir = Path(__file__).resolve().parent / "nacional"
    eval_csv = base_dir / "master_eval_summary.csv"
    coverage_csv = base_dir / "master_target_coverage.csv"
    manifest_csv = base_dir / "solution_manifest.csv"

    tif_files = sorted(base_dir.glob("*.tif"))
    eval_rows = load_eval_rows(eval_csv)
    coverage_rows = load_coverage_rows(coverage_csv)
    generated_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()

    manifest_rows: List[dict] = []
    missing_eval: List[str] = []

    for tif_path in tif_files:
        run_name = tif_path.stem
        normalized_run = normalize_run_name(run_name)
        eval_row = eval_rows.get(normalized_run)
        coverage = coverage_rows.get(normalized_run, [])

        if eval_row is None:
            missing_eval.append(run_name)

        feature_names = [row.get("feature", "") for row in coverage if row.get("feature")]
        feature_ids = infer_feature_ids(run_name, feature_names)
        include_ids = infer_includes(run_name)
        cost_id = infer_cost_layer(run_name)

        metadata = {
            "id": run_name.lower().replace("+", "_"),
            "run_name": run_name,
            "scope": "nacional",
            "raster_file": tif_path.name,
            "generated_at_utc": generated_at,
            "input_layer_ids": {
                "features": feature_ids,
                "cost": cost_id,
                "includes": include_ids,
                "excludes": [],
            },
            "evaluation": {
                "n_selected": eval_row.n_selected if eval_row else None,
                "cost": eval_row.cost if eval_row else None,
                "pct_targets_met": eval_row.pct_targets_met if eval_row else None,
            },
            "coverage": coverage,
        }

        json_path = tif_path.with_suffix(".json")
        json_path.write_text(json.dumps(metadata, indent=2, ensure_ascii=True) + "\n", encoding="utf-8")

        manifest_rows.append(
            {
                "id": metadata["id"],
                "run_name": run_name,
                "scope": "nacional",
                "tif_file": tif_path.name,
                "json_file": json_path.name,
                "cost_layer_id": cost_id or "",
                "feature_layer_ids": ";".join(feature_ids),
                "include_layer_ids": ";".join(include_ids),
                "exclude_layer_ids": "",
                "n_selected": metadata["evaluation"]["n_selected"] or "",
                "cost": metadata["evaluation"]["cost"] or "",
                "pct_targets_met": metadata["evaluation"]["pct_targets_met"] or "",
                "coverage_rows": str(len(coverage)),
            }
        )

    fieldnames = [
        "id",
        "run_name",
        "scope",
        "tif_file",
        "json_file",
        "cost_layer_id",
        "feature_layer_ids",
        "include_layer_ids",
        "exclude_layer_ids",
        "n_selected",
        "cost",
        "pct_targets_met",
        "coverage_rows",
    ]
    with manifest_csv.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(manifest_rows)

    print(f"Generated {len(tif_files)} JSON files and {manifest_csv.name}.")
    if missing_eval:
        print("Warning: missing eval rows for runs:")
        for run in missing_eval:
            print(f"- {run}")


if __name__ == "__main__":
    main()
