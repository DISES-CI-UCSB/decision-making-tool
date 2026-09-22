"""Publish Mesa ecosystem relative_held for national and known-AOI geographies.

One calculator, same inputs as the science-team summary CSV. National uses
evaluate_categorical_coverage. Known AOI / SIRAP uses the same cell counts
with an extra geography mask (evaluate_categorical_aoi). AOI-scoped
relative_held is coverage_within_aoi: held E1 cells / E1 cells in the mask.

This CLI does not copy the CSV into the UI. It computes independently, then
optionally exams the national result against the CSV.
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path
from typing import Any, Sequence

import numpy as np
import rasterio

from mesa_coverage import (
    MesaAoiCoverageRow,
    MesaCoverageRow,
    evaluate_categorical_aoi,
    evaluate_categorical_coverage,
)
from raster_metrics import RasterError, RasterFingerprint, read_solution_raster

FORMAT = "mesa-ecosystem-coverage-v1"
ALGORITHM_VERSION = "mesa-smsp-cell-count-v1"
RELATIVE_HELD_DEFINITION = "held_e1_planning_cells / e1_planning_cells_in_geography"
GEOGRAPHY_LEVELS = (
    "national",
    "departments",
    "municipalities",
    "siraps",
    "runaps",
    "omecs",
)


class MesaEcosystemCoverageError(ValueError):
    """Raised when ecosystem relative_held inputs or artifacts are invalid."""


def _parse_float(value: Any) -> float | None:
    text = str(value or "").strip()
    if not text or text.upper() == "NA":
        return None
    return float(text)


def load_ecosystem_catalog(path: Path) -> dict[str, int]:
    with path.open(newline="", encoding="utf-8-sig") as handle:
        rows = list(csv.DictReader(handle))
    catalog = {str(row["biome"]): int(row["biome_id"]) for row in rows}
    if len(catalog) != len(rows):
        raise MesaEcosystemCoverageError("Ecosystem catalog contains duplicate labels.")
    return catalog


def load_summary_ecosystems(path: Path) -> list[dict[str, str]]:
    with path.open(newline="", encoding="utf-8-sig") as handle:
        rows = list(csv.DictReader(handle))
    return [row for row in rows if row.get("feature_type") == "ecosystem"]


def load_ecosystem_values(path: Path, fingerprint: RasterFingerprint) -> np.ndarray:
    with rasterio.open(path) as dataset:
        observed = RasterFingerprint(
            width=dataset.width,
            height=dataset.height,
            transform=tuple(dataset.transform)[:6],
            crs=dataset.crs.to_string() if dataset.crs is not None else None,
        )
        if not observed.matches(fingerprint):
            raise MesaEcosystemCoverageError(
                f"Ecosystem raster {path} does not match the solution grid."
            )
        return dataset.read(1, masked=True).astype(np.float64).filled(np.nan)


def load_aoi_mask(path: Path, fingerprint: RasterFingerprint) -> np.ndarray:
    """Treat finite, non-nodata, non-zero cells as inside the geography."""

    with rasterio.open(path) as dataset:
        observed = RasterFingerprint(
            width=dataset.width,
            height=dataset.height,
            transform=tuple(dataset.transform)[:6],
            crs=dataset.crs.to_string() if dataset.crs is not None else None,
        )
        if not observed.matches(fingerprint):
            raise MesaEcosystemCoverageError(
                f"AOI mask {path} does not match the solution grid."
            )
        band = dataset.read(1, masked=False).astype(np.float64)
        valid = np.isfinite(band)
        if dataset.nodata is not None:
            valid &= band != dataset.nodata
        return valid & (band != 0)


def _feature_specs(
    summary_rows: Sequence[dict[str, str]],
    catalog: dict[str, int],
) -> tuple[list[int], list[str], list[float | None], list[str | None]]:
    missing = [row["feature"] for row in summary_rows if row["feature"] not in catalog]
    if missing:
        raise MesaEcosystemCoverageError(
            f"Summary ecosystems missing from catalog: {missing[:10]}"
        )
    return (
        [catalog[row["feature"]] for row in summary_rows],
        [row["feature"] for row in summary_rows],
        [_parse_float(row.get("relative_target")) for row in summary_rows],
        [row.get("evaluated") or None for row in summary_rows],
    )


def evaluate_national_rows(
    *,
    category_values: np.ndarray,
    selected_mask: np.ndarray,
    feature_ids: Sequence[int],
    feature_names: Sequence[str],
    relative_targets: Sequence[float | None],
    evaluated: Sequence[str | None],
) -> list[MesaCoverageRow]:
    return evaluate_categorical_coverage(
        category_values=category_values,
        selected_mask=selected_mask,
        feature_ids=feature_ids,
        feature_names=feature_names,
        relative_targets=relative_targets,
        evaluated=evaluated,
    )


def evaluate_aoi_rows(
    *,
    category_values: np.ndarray,
    selected_mask: np.ndarray,
    aoi_mask: np.ndarray,
    feature_ids: Sequence[int],
    feature_names: Sequence[str],
    relative_targets: Sequence[float | None],
    pre_existing_mask: np.ndarray | None = None,
    new_prioritizr_mask: np.ndarray | None = None,
) -> list[MesaAoiCoverageRow]:
    if np.array_equal(np.asarray(aoi_mask, dtype=bool), np.asarray(selected_mask, dtype=bool)):
        raise MesaEcosystemCoverageError(
            "AOI mask equals the solution selected mask; refusing a tautological "
            "relative_held denominator."
        )
    targets = [0.0 if target is None else float(target) for target in relative_targets]
    return evaluate_categorical_aoi(
        category_values=category_values,
        selected_mask=selected_mask,
        aoi_mask=aoi_mask,
        feature_ids=feature_ids,
        feature_names=feature_names,
        national_targets=targets,
        pre_existing_mask=pre_existing_mask,
        new_prioritizr_mask=new_prioritizr_mask,
    )


def _national_row_payload(
    row: MesaCoverageRow,
    feature_id: int,
) -> dict[str, Any]:
    return {
        "feature": row.feature,
        "featureId": feature_id,
        "evaluated": row.evaluated,
        "met": row.met,
        "relativeTarget": row.relative_target,
        "relativeHeld": row.relative_held,
        "relativeShortfall": row.relative_shortfall,
        "totalAmount": row.total_amount,
        "absoluteHeld": row.absolute_held,
        "absoluteTarget": row.absolute_target,
        "absoluteShortfall": row.absolute_shortfall,
    }


def _aoi_row_payload(
    row: MesaAoiCoverageRow,
    *,
    feature_id: int,
    relative_target: float | None,
    evaluated: str | None,
) -> dict[str, Any]:
    met = (
        None
        if relative_target is None or row.coverage_within_aoi is None
        else bool(row.coverage_within_aoi + 1e-12 >= relative_target)
    )
    return {
        "feature": row.feature,
        "featureId": feature_id,
        "evaluated": evaluated,
        "met": met,
        "relativeTarget": relative_target,
        "relativeHeld": row.coverage_within_aoi,
        "relativeHeldAlias": "coverage_within_aoi",
        "totalAmount": row.total_amount_aoi,
        "absoluteHeld": row.absolute_held_aoi,
        "nationalTotalAmount": row.national_total_amount,
        "contributionToNationalCoverage": row.contribution_to_national_coverage,
        "shareOfNationalAmount": row.share_of_national_amount,
        "absolutePreExisting": row.absolute_pre_existing_aoi,
        "absoluteNewPrioritizr": row.absolute_new_prioritizr_aoi,
        "preExistingRelativeHeld": row.pre_existing_coverage_within_aoi,
        "newRelativeHeld": row.new_prioritizr_coverage_within_aoi,
    }


def build_national_document(
    *,
    solution_id: str,
    rows: Sequence[MesaCoverageRow],
    feature_ids: Sequence[int],
    source_paths: dict[str, str],
) -> dict[str, Any]:
    return {
        "format": FORMAT,
        "algorithmVersion": ALGORITHM_VERSION,
        "relativeHeldDefinition": RELATIVE_HELD_DEFINITION,
        "solutionId": solution_id,
        "geographyLevel": "national",
        "geographyId": "colombia",
        "rowCount": len(rows),
        "sourcePaths": source_paths,
        "rows": [
            _national_row_payload(row, feature_id)
            for row, feature_id in zip(rows, feature_ids, strict=True)
        ],
    }


def build_aoi_document(
    *,
    solution_id: str,
    geography_level: str,
    geography_id: str,
    rows: Sequence[MesaAoiCoverageRow],
    feature_ids: Sequence[int],
    relative_targets: Sequence[float | None],
    evaluated: Sequence[str | None],
    source_paths: dict[str, str],
) -> dict[str, Any]:
    if geography_level not in GEOGRAPHY_LEVELS or geography_level == "national":
        raise MesaEcosystemCoverageError(
            f"Known-AOI geographyLevel must be a subnational key, got {geography_level!r}."
        )
    return {
        "format": FORMAT,
        "algorithmVersion": ALGORITHM_VERSION,
        "relativeHeldDefinition": RELATIVE_HELD_DEFINITION,
        "solutionId": solution_id,
        "geographyLevel": geography_level,
        "geographyId": geography_id,
        "rowCount": len(rows),
        "sourcePaths": source_paths,
        "rows": [
            _aoi_row_payload(
                row,
                feature_id=feature_id,
                relative_target=target,
                evaluated=source,
            )
            for row, feature_id, target, source in zip(
                rows, feature_ids, relative_targets, evaluated, strict=True
            )
        ],
    }


def write_document(path: Path, document: dict[str, Any]) -> None:
    if document.get("format") != FORMAT:
        raise MesaEcosystemCoverageError(f"Refusing to write unknown format {document.get('format')!r}.")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(document, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def compare_national_to_summary(
    rows: Sequence[MesaCoverageRow],
    summary_rows: Sequence[dict[str, str]],
    *,
    numeric_tolerance: float = 1e-9,
) -> list[dict[str, Any]]:
    actual_by_name = {row.feature: row for row in rows}
    mismatches: list[dict[str, Any]] = []
    numeric_fields = (
        ("total_amount", "total_amount"),
        ("absolute_held", "absolute_held"),
        ("relative_target", "relative_target"),
        ("relative_held", "relative_held"),
    )
    for expected in summary_rows:
        name = expected["feature"]
        actual = actual_by_name.get(name)
        if actual is None:
            mismatches.append(
                {"feature": name, "field": "feature", "expected": "present", "actual": None}
            )
            continue
        expected_met = str(expected.get("met") or "").strip().lower() in {"true", "1", "yes"}
        if expected_met != bool(actual.met):
            mismatches.append(
                {"feature": name, "field": "met", "expected": expected_met, "actual": actual.met}
            )
        for csv_field, attr in numeric_fields:
            expected_number = _parse_float(expected.get(csv_field))
            actual_number = getattr(actual, attr)
            if expected_number is None or actual_number is None:
                equal = expected_number is None and actual_number is None
            else:
                equal = bool(
                    np.isclose(expected_number, actual_number, atol=numeric_tolerance, rtol=0)
                )
            if not equal:
                mismatches.append(
                    {
                        "feature": name,
                        "field": csv_field,
                        "expected": expected_number,
                        "actual": actual_number,
                    }
                )
    extra = sorted(set(actual_by_name) - {row["feature"] for row in summary_rows})
    mismatches.extend(
        {"feature": name, "field": "feature", "expected": None, "actual": "present"}
        for name in extra
    )
    return mismatches


def default_output_path(
    output_root: Path,
    solution_id: str,
    geography_level: str,
    geography_id: str,
) -> Path:
    return (
        output_root
        / solution_id
        / f"{geography_level}__{geography_id}.mesa-ecosystem-coverage.json"
    )


def _parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--solution-id", required=True)
    parser.add_argument("--solution", type=Path, required=True)
    parser.add_argument("--ecosystem-raster", type=Path, required=True)
    parser.add_argument("--ecosystem-catalog", type=Path, required=True)
    parser.add_argument("--summary", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--geography-level", default="national", choices=GEOGRAPHY_LEVELS)
    parser.add_argument("--geography-id", default="colombia")
    parser.add_argument("--aoi-mask", type=Path, default=None)
    parser.add_argument("--compare-summary", action="store_true")
    parser.add_argument("--numeric-tolerance", type=float, default=1e-9)
    return parser.parse_args(argv)


def run(args: argparse.Namespace) -> dict[str, Any]:
    summary_rows = load_summary_ecosystems(args.summary)
    catalog = load_ecosystem_catalog(args.ecosystem_catalog)
    feature_ids, feature_names, targets, evaluated = _feature_specs(summary_rows, catalog)
    solution = read_solution_raster(args.solution)
    values = load_ecosystem_values(args.ecosystem_raster, solution.fingerprint)
    source_paths = {
        "solution": str(args.solution),
        "ecosystemRaster": str(args.ecosystem_raster),
        "ecosystemCatalog": str(args.ecosystem_catalog),
        "summary": str(args.summary),
    }

    if args.geography_level == "national":
        if args.aoi_mask is not None:
            raise MesaEcosystemCoverageError("National relative_held does not take an AOI mask.")
        rows = evaluate_national_rows(
            category_values=values,
            selected_mask=solution.selected_mask,
            feature_ids=feature_ids,
            feature_names=feature_names,
            relative_targets=targets,
            evaluated=evaluated,
        )
        document = build_national_document(
            solution_id=args.solution_id,
            rows=rows,
            feature_ids=feature_ids,
            source_paths=source_paths,
        )
        if args.compare_summary:
            mismatches = compare_national_to_summary(
                rows, summary_rows, numeric_tolerance=args.numeric_tolerance
            )
            document["summaryExam"] = {
                "compared": True,
                "mismatchCount": len(mismatches),
                "mismatches": mismatches,
            }
            if mismatches:
                write_document(args.output, document)
                raise MesaEcosystemCoverageError(
                    f"National relative_held missed the summary CSV on {len(mismatches)} fields."
                )
    else:
        if args.aoi_mask is None:
            raise MesaEcosystemCoverageError("Known-AOI relative_held requires --aoi-mask.")
        aoi_mask = load_aoi_mask(args.aoi_mask, solution.fingerprint)
        source_paths["aoiMask"] = str(args.aoi_mask)
        rows = evaluate_aoi_rows(
            category_values=values,
            selected_mask=solution.selected_mask,
            aoi_mask=aoi_mask,
            feature_ids=feature_ids,
            feature_names=feature_names,
            relative_targets=targets,
            pre_existing_mask=solution.pre_existing_mask,
            new_prioritizr_mask=solution.new_prioritizr_mask,
        )
        document = build_aoi_document(
            solution_id=args.solution_id,
            geography_level=args.geography_level,
            geography_id=args.geography_id,
            rows=rows,
            feature_ids=feature_ids,
            relative_targets=targets,
            evaluated=evaluated,
            source_paths=source_paths,
        )

    write_document(args.output, document)
    return document


def main(argv: Sequence[str] | None = None) -> int:
    args = _parse_args(argv)
    try:
        document = run(args)
    except (MesaEcosystemCoverageError, RasterError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    exam = document.get("summaryExam") or {}
    print(
        json.dumps(
            {
                "format": document["format"],
                "solutionId": document["solutionId"],
                "geographyLevel": document["geographyLevel"],
                "geographyId": document["geographyId"],
                "rowCount": document["rowCount"],
                "output": str(args.output),
                "mismatchCount": exam.get("mismatchCount"),
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
