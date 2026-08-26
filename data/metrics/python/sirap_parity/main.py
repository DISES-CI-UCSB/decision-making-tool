"""Validate SIRAP solution coverage against paired science-team summaries.

This evaluator reads existing SIRAP solution TIFFs and their grid-aligned,
prepared feature rasters. It intentionally evaluates coverage only; it does
not rerun Prioritizr or publish assets.
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from dataclasses import asdict
from pathlib import Path
from typing import Any

import numpy as np
import rasterio

PIPELINE_DIR = Path(__file__).resolve().parents[1] / "metrics_pipeline"
if str(PIPELINE_DIR) not in sys.path:
    sys.path.insert(0, str(PIPELINE_DIR))

from mesa_coverage import MesaCoverageRow, mesa_coverage_row  # noqa: E402
from raster_metrics import (  # noqa: E402
    RasterFingerprint,
    read_reference_raster,
    read_solution_raster,
)

NUMERIC_FIELDS = (
    "total_amount",
    "absolute_target",
    "absolute_held",
    "absolute_shortfall",
    "relative_target",
    "relative_held",
    "relative_shortfall",
)

REGION_FEATURE_FILES = {
    "eje_cafetero": {
        "paramos": "paramos_EC.tif",
        "humedales": "humedales_nacionales.tif",
        "bosque_seco": "bosque_seco_EC.tif",
        "bosque seco": "bosque_seco_EC.tif",
        "EC wetlands": "humedales_EC.tif",
    },
    "orinoquia": {
        "paramos": "paramos_orinoquia.tif",
        "bosque_seco": "bosque_seco_orinoquia.tif",
        "humedales": "humedales.tif",
        "congriales": "congriales.tif",
        "savannas": "sabana_orinoquia.tif",
    },
}
REGION_TEMPLATE_FILES = {
    "eje_cafetero": "template_eje_cafetero.tif",
    "orinoquia": "template_orinoquia.tif",
}


def _parse_float(value: Any) -> float | None:
    text = str(value or "").strip()
    return None if not text or text.upper() == "NA" else float(text)


def _parse_bool(value: Any) -> bool | None:
    text = str(value or "").strip().lower()
    if text in {"true", "1", "yes", "y"}:
        return True
    if text in {"false", "0", "no", "n"}:
        return False
    return None


def _read_summary(path: Path) -> list[dict[str, str]]:
    with path.open(newline="", encoding="utf-8-sig") as handle:
        rows = list(csv.DictReader(handle))
    if not rows:
        raise ValueError(f"Summary CSV has no rows: {path}")
    required = {"feature", "relative_target", "total_amount", "absolute_held"}
    missing = required - set(rows[0])
    if missing:
        raise ValueError(f"Summary CSV is missing columns: {sorted(missing)}")
    return rows


def _fingerprint(dataset: rasterio.io.DatasetReader) -> RasterFingerprint:
    transform = dataset.transform
    return RasterFingerprint(
        width=dataset.width,
        height=dataset.height,
        transform=(transform.a, transform.b, transform.c, transform.d, transform.e, transform.f),
        crs=str(dataset.crs) if dataset.crs else None,
    )


def _feature_amounts(
    *,
    path: Path,
    feature: str,
    solution_fingerprint: RasterFingerprint,
    planning_units: np.ndarray,
) -> tuple[float, float]:
    with rasterio.open(path) as dataset:
        fingerprint = _fingerprint(dataset)
        if not fingerprint.matches(solution_fingerprint):
            raise ValueError(f"Feature raster does not match solution grid: {path}")
        values = dataset.read(1, masked=False).astype(np.float64)
        nodata = dataset.nodata
        if nodata is not None:
            values[values == nodata] = np.nan

    values[~np.isfinite(values)] = 0
    if np.any(values < 0):
        raise ValueError(f"Feature raster contains negative amounts: {feature} ({path})")
    values[~planning_units] = 0
    return float(values.sum()), values


def _compare_rows(
    expected_rows: list[dict[str, str]],
    actual_rows: list[MesaCoverageRow],
    *,
    numeric_tolerance: float,
) -> list[dict[str, Any]]:
    actual_by_feature = {row.feature: row for row in actual_rows}
    mismatches: list[dict[str, Any]] = []
    for expected in expected_rows:
        feature = expected["feature"]
        actual = actual_by_feature.get(feature)
        if actual is None:
            mismatches.append({"feature": feature, "field": "feature", "expected": "present", "actual": None})
            continue
        if _parse_bool(expected.get("met")) != actual.met:
            mismatches.append(
                {
                    "feature": feature,
                    "field": "met",
                    "expected": _parse_bool(expected.get("met")),
                    "actual": actual.met,
                }
            )
        for field in NUMERIC_FIELDS:
            expected_value = _parse_float(expected.get(field))
            actual_value = getattr(actual, field)
            if expected_value is None or actual_value is None:
                matches = expected_value is None and actual_value is None
            else:
                matches = bool(
                    np.isclose(
                        expected_value,
                        actual_value,
                        atol=numeric_tolerance,
                        rtol=0,
                    )
                )
            if not matches:
                mismatches.append(
                    {
                        "feature": feature,
                        "field": field,
                        "expected": expected_value,
                        "actual": actual_value,
                    }
                )
        if (expected.get("evaluated") or None) != actual.evaluated:
            mismatches.append(
                {
                    "feature": feature,
                    "field": "evaluated",
                    "expected": expected.get("evaluated") or None,
                    "actual": actual.evaluated,
                }
            )
    return mismatches


def evaluate(
    *,
    region: str,
    solution_path: Path,
    summary_path: Path,
    prepared_inputs_root: Path,
    template_path: Path,
    numeric_tolerance: float = 1e-9,
) -> dict[str, Any]:
    feature_files = REGION_FEATURE_FILES[region]
    expected_rows = _read_summary(summary_path)
    duplicate_features = {
        row["feature"] for row in expected_rows if sum(item["feature"] == row["feature"] for item in expected_rows) > 1
    }
    if duplicate_features:
        raise ValueError(f"Summary contains duplicate features: {sorted(duplicate_features)}")
    unknown_features = sorted({row["feature"] for row in expected_rows} - set(feature_files))
    if unknown_features:
        raise ValueError(
            f"Summary contains unmapped {region} features: {unknown_features}. "
            "Add an explicit prepared-raster mapping before evaluating."
        )

    solution = read_solution_raster(solution_path)
    template = read_reference_raster(template_path)
    if not solution.fingerprint.matches(template.fingerprint):
        raise ValueError(f"Template does not match solution grid: {template_path}")
    prepared_inputs = prepared_inputs_root / region
    actual_rows: list[MesaCoverageRow] = []
    for expected in expected_rows:
        feature = expected["feature"]
        feature_path = prepared_inputs / feature_files[feature]
        if not feature_path.is_file():
            raise FileNotFoundError(f"Missing prepared raster for {feature}: {feature_path}")
        total, values = _feature_amounts(
            path=feature_path,
            feature=feature,
            solution_fingerprint=solution.fingerprint,
            planning_units=template.valid_mask,
        )
        held = float(values[solution.selected_mask].sum())
        actual_rows.append(
            mesa_coverage_row(
                feature=feature,
                total_amount=total,
                absolute_held=held,
                relative_target=float(expected["relative_target"]),
                evaluated=expected.get("evaluated") or None,
                relative_shortfall_mode="target_fraction",
            )
        )

    mismatches = _compare_rows(
        expected_rows,
        actual_rows,
        numeric_tolerance=numeric_tolerance,
    )
    return {
        "format": "sirap-coverage-parity-report-v1",
        "region": region,
        "scenario": solution_path.stem,
        "solution": str(solution_path),
        "summary": str(summary_path),
        "preparedInputs": str(prepared_inputs),
        "template": str(template_path),
        "passed": not mismatches,
        "mismatchCount": len(mismatches),
        "mismatches": mismatches,
        "computed": [asdict(row) for row in actual_rows],
    }


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--region", choices=tuple(REGION_FEATURE_FILES), required=True)
    parser.add_argument("--solution", type=Path, required=True)
    parser.add_argument("--summary", type=Path, required=True)
    parser.add_argument("--prepared-inputs-root", type=Path, required=True)
    parser.add_argument(
        "--template",
        type=Path,
        required=True,
        help="Regional planning-unit template used by the science model.",
    )
    parser.add_argument("--report", type=Path, default=None)
    parser.add_argument("--numeric-tolerance", type=float, default=1e-9)
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    report = evaluate(
        region=args.region,
        solution_path=args.solution,
        summary_path=args.summary,
        prepared_inputs_root=args.prepared_inputs_root,
        template_path=args.template,
        numeric_tolerance=args.numeric_tolerance,
    )
    if args.report is not None:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(
        json.dumps(
            {
                "passed": report["passed"],
                "mismatchCount": report["mismatchCount"],
                "region": report["region"],
                "scenario": report["scenario"],
            },
            sort_keys=True,
        )
    )
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
