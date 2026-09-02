"""Validate Mesa-compatible national coverage against a scientist summary CSV.

This CLI is intentionally solution-evaluation only. It does not run Prioritizr.
It reads the pinned solution, Mesa ecosystem raster, and optional Mesa-exported
species SMSP matrices, then reports every unexplained row-level mismatch.
"""

from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import json
import struct
import sys
import time
from dataclasses import asdict
from pathlib import Path
from typing import Any, Iterator

import numpy as np
import rasterio

PIPELINE_DIR = Path(__file__).resolve().parents[1] / "metrics_pipeline"
if str(PIPELINE_DIR) not in sys.path:
    sys.path.insert(0, str(PIPELINE_DIR))

from mesa_coverage import (  # noqa: E402
    MesaCoverageRow,
    evaluate_categorical_coverage,
    mesa_coverage_row,
)
from raster_metrics import read_reference_raster, read_solution_raster  # noqa: E402
from sparse.format import SMSP_MAGIC  # noqa: E402

DEFAULT_CONTRACT = (
    Path("data/metrics/release-specs/solutions-v3-0-0/coverage-parity-contract.json")
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


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _read_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"Expected JSON object: {path}")
    return value


def _summary_rows(path: Path) -> list[dict[str, str]]:
    with path.open(newline="", encoding="utf-8-sig") as handle:
        return list(csv.DictReader(handle))


def _parse_float(value: Any) -> float | None:
    text = str(value or "").strip()
    if not text or text.upper() == "NA":
        return None
    return float(text)


def _parse_bool(value: Any) -> bool | None:
    text = str(value or "").strip().lower()
    if text in {"true", "1", "yes", "y"}:
        return True
    if text in {"false", "0", "no", "n"}:
        return False
    return None


def _read_catalog(path: Path) -> dict[str, int]:
    with path.open(newline="", encoding="utf-8-sig") as handle:
        rows = list(csv.DictReader(handle))
    result = {str(row["biome"]): int(row["biome_id"]) for row in rows}
    if len(result) != len(rows):
        raise ValueError("Ecosystem catalog contains duplicate labels.")
    return result


def _evaluate_ecosystems(
    *,
    summary_rows: list[dict[str, str]],
    solution_path: Path,
    ecosystem_raster_path: Path,
    ecosystem_catalog_path: Path,
) -> list[MesaCoverageRow]:
    expected = [row for row in summary_rows if row.get("feature_type") == "ecosystem"]
    catalog = _read_catalog(ecosystem_catalog_path)
    missing = [row["feature"] for row in expected if row["feature"] not in catalog]
    if missing:
        raise ValueError(f"Summary ecosystems missing from catalog: {missing[:10]}")

    solution = read_solution_raster(solution_path)
    with rasterio.open(ecosystem_raster_path) as dataset:
        if (
            dataset.width != solution.fingerprint.width
            or dataset.height != solution.fingerprint.height
            or dataset.crs.to_string() != solution.fingerprint.crs
            or tuple(dataset.transform)[:6] != solution.fingerprint.transform
        ):
            raise ValueError("Mesa ecosystem raster does not match solution grid.")
        values = dataset.read(1, masked=True).astype(np.float64).filled(np.nan)

    return evaluate_categorical_coverage(
        category_values=values,
        selected_mask=solution.selected_mask,
        feature_ids=[catalog[row["feature"]] for row in expected],
        feature_names=[row["feature"] for row in expected],
        relative_targets=[_parse_float(row["relative_target"]) for row in expected],
        evaluated=[row.get("evaluated") or None for row in expected],
    )


def _iter_species_matrix_rows(
    matrix_path: Path,
    selected_flat: np.ndarray,
    scope_flat: np.ndarray,
    summary_by_name: dict[str, dict[str, str]],
) -> Iterator[MesaCoverageRow]:
    with gzip.open(matrix_path, "rb") as handle:
        header = handle.read(8)
        if len(header) != 8 or header[:4] != SMSP_MAGIC:
            raise ValueError(f"Invalid species matrix header: {matrix_path}")
        toc_length = struct.unpack_from("<I", header, 4)[0]
        toc = json.loads(handle.read(toc_length).decode("utf-8"))
        grid = toc.get("grid") or {}
        if int(grid.get("width", 0)) * int(grid.get("height", 0)) != selected_flat.size:
            raise ValueError(f"Species matrix grid does not match solution: {matrix_path}")

        cursor = 0
        for entry in toc.get("species") or []:
            name = str(entry["name"])
            offset = int(entry["offset"])
            count = int(entry["count"])
            if offset != cursor:
                raise ValueError(f"Non-sequential species matrix offset for {name}")
            chunk = handle.read(count * 4)
            if len(chunk) != count * 4:
                raise ValueError(f"Species matrix body ended early for {name}")
            deltas = np.frombuffer(chunk, dtype="<u4")
            cell_ids = np.cumsum(deltas, dtype=np.uint32)
            if cell_ids.size and int(cell_ids[-1]) >= selected_flat.size:
                raise ValueError(f"Species matrix cell outside grid for {name}")
            cells_in_scope = cell_ids[scope_flat[cell_ids]]
            expected = summary_by_name.get(name)
            if expected is None:
                cursor += len(chunk)
                continue
            target = _parse_float(expected.get("relative_target"))
            yield mesa_coverage_row(
                feature=name,
                total_amount=float(cells_in_scope.size),
                absolute_held=float(np.count_nonzero(selected_flat[cells_in_scope])),
                relative_target=target,
                evaluated=expected.get("evaluated") or None,
                relative_shortfall_mode=(
                    "target_fraction"
                    if expected.get("evaluated") == "prioritizr_model"
                    else "target_difference"
                ),
            )
            cursor += len(chunk)


def _evaluate_species(
    *,
    summary_rows: list[dict[str, str]],
    solution_path: Path,
    template_path: Path,
    species_matrix_paths: list[Path],
    species_classes: set[str] | None = None,
) -> list[MesaCoverageRow]:
    expected = [
        row
        for row in summary_rows
        if row.get("feature_type") == "species"
        and (species_classes is None or row.get("class") in species_classes)
    ]
    expected_by_name = {row["feature"]: row for row in expected}
    if len(expected_by_name) != len(expected):
        raise ValueError("Summary contains duplicate species names.")
    solution = read_solution_raster(solution_path)
    template = read_reference_raster(template_path)
    if not solution.fingerprint.matches(template.fingerprint):
        raise ValueError("Mesa template does not match solution grid.")
    rows = [
        row
        for path in species_matrix_paths
        for row in _iter_species_matrix_rows(
            path,
            solution.selected_mask.ravel(),
            template.valid_mask.ravel(),
            expected_by_name,
        )
    ]
    observed = {row.feature for row in rows}
    missing = sorted(set(expected_by_name) - observed)
    if missing:
        raise ValueError(f"Species matrices omit {len(missing)} summary rows: {missing[:10]}")
    return rows


def _compare_rows(
    expected_rows: list[dict[str, str]],
    actual_rows: list[MesaCoverageRow],
    *,
    numeric_tolerance: float,
) -> list[dict[str, Any]]:
    actual_by_name = {row.feature: row for row in actual_rows}
    mismatches: list[dict[str, Any]] = []
    for expected in expected_rows:
        name = expected["feature"]
        actual = actual_by_name.get(name)
        if actual is None:
            mismatches.append({"feature": name, "field": "feature", "expected": "present", "actual": None})
            continue
        expected_met = _parse_bool(expected.get("met"))
        if expected_met != actual.met:
            mismatches.append(
                {"feature": name, "field": "met", "expected": expected_met, "actual": actual.met}
            )
        for field in NUMERIC_FIELDS:
            expected_number = _parse_float(expected.get(field))
            actual_number = getattr(actual, field)
            if expected_number is None or actual_number is None:
                equal = expected_number is None and actual_number is None
            else:
                equal = bool(
                    np.isclose(
                        expected_number,
                        actual_number,
                        atol=numeric_tolerance,
                        rtol=0,
                    )
                )
            if not equal:
                mismatches.append(
                    {
                        "feature": name,
                        "field": field,
                        "expected": expected_number,
                        "actual": actual_number,
                    }
                )
        expected_evaluated = expected.get("evaluated") or None
        if expected_evaluated != actual.evaluated:
            mismatches.append(
                {
                    "feature": name,
                    "field": "evaluated",
                    "expected": expected_evaluated,
                    "actual": actual.evaluated,
                }
            )
    extra = sorted(set(actual_by_name) - {row["feature"] for row in expected_rows})
    mismatches.extend(
        {"feature": name, "field": "feature", "expected": None, "actual": "present"}
        for name in extra
    )
    return mismatches


def _verify_contract_inputs(
    contract: dict[str, Any],
    *,
    summary_path: Path,
    solution_path: Path,
    template_path: Path,
    ecosystem_raster_path: Path,
    ecosystem_catalog_path: Path,
    verify_golden_checksums: bool,
) -> None:
    expected = {
        template_path: contract["grid"]["template"]["sha256"],
        ecosystem_raster_path: contract["ecosystems"]["raster"]["sha256"],
        ecosystem_catalog_path: contract["ecosystems"]["catalog"]["sha256"],
    }
    if verify_golden_checksums:
        expected.update({
            summary_path: contract["goldenMaster"]["summarySha256"],
            solution_path: contract["goldenMaster"]["solutionSha256"],
        })
    failures = [
        f"{path}: expected {sha}, observed {_sha256(path)}"
        for path, sha in expected.items()
        if _sha256(path) != sha
    ]
    if failures:
        raise ValueError("Pinned coverage input checksum mismatch:\n" + "\n".join(failures))


def _write_report(path: Path, report: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--contract", type=Path, default=DEFAULT_CONTRACT)
    parser.add_argument("--summary", type=Path, required=True)
    parser.add_argument("--solution", type=Path, required=True)
    parser.add_argument("--template", type=Path, required=True)
    parser.add_argument("--ecosystem-raster", type=Path, required=True)
    parser.add_argument("--ecosystem-catalog", type=Path, required=True)
    parser.add_argument("--species-matrix", type=Path, action="append", default=[])
    parser.add_argument(
        "--species-class",
        action="append",
        default=[],
        help="Restrict species parity to one or more summary classes (repeatable).",
    )
    parser.add_argument("--report", type=Path, default=None)
    parser.add_argument("--include-computed", action="store_true")
    parser.add_argument(
        "--allow-non-golden",
        action="store_true",
        help="Verify shared pinned inputs but allow a different solution/summary pair.",
    )
    parser.add_argument("--numeric-tolerance", type=float, default=1e-9)
    return parser.parse_args()


def main() -> int:
    started = time.perf_counter()
    args = _parse_args()
    contract = _read_json(args.contract)
    summary = _summary_rows(args.summary)
    _verify_contract_inputs(
        contract,
        summary_path=args.summary,
        solution_path=args.solution,
        template_path=args.template,
        ecosystem_raster_path=args.ecosystem_raster,
        ecosystem_catalog_path=args.ecosystem_catalog,
        verify_golden_checksums=not args.allow_non_golden,
    )

    ecosystem_expected = [row for row in summary if row.get("feature_type") == "ecosystem"]
    ecosystem_actual = _evaluate_ecosystems(
        summary_rows=summary,
        solution_path=args.solution,
        ecosystem_raster_path=args.ecosystem_raster,
        ecosystem_catalog_path=args.ecosystem_catalog,
    )
    mismatches = _compare_rows(
        ecosystem_expected,
        ecosystem_actual,
        numeric_tolerance=args.numeric_tolerance,
    )
    domain_counts: dict[str, dict[str, int]] = {
        "ecosystems": {
            "expected": len(ecosystem_expected),
            "actual": len(ecosystem_actual),
        }
    }

    species_actual: list[MesaCoverageRow] = []
    if args.species_matrix:
        species_classes = set(args.species_class) or None
        species_expected = [
            row
            for row in summary
            if row.get("feature_type") == "species"
            and (species_classes is None or row.get("class") in species_classes)
        ]
        species_actual = _evaluate_species(
            summary_rows=summary,
            solution_path=args.solution,
            template_path=args.template,
            species_matrix_paths=args.species_matrix,
            species_classes=species_classes,
        )
        mismatches.extend(
            _compare_rows(
                species_expected,
                species_actual,
                numeric_tolerance=args.numeric_tolerance,
            )
        )
        domain_counts["species"] = {
            "expected": len(species_expected),
            "actual": len(species_actual),
        }

    report = {
        "format": "coverage-parity-report-v1",
        "releaseId": contract["releaseId"],
        "solutionId": (
            contract["goldenMaster"]["solutionId"]
            if not args.allow_non_golden
            else args.solution.stem
        ),
        "scenario": next(
            (row.get("scenario") for row in summary if row.get("scenario")),
            args.solution.stem,
        ),
        "summarySha256": _sha256(args.summary),
        "solutionSha256": _sha256(args.solution),
        "domainCounts": domain_counts,
        "mismatchCount": len(mismatches),
        "passed": len(mismatches) == 0,
        "mismatches": mismatches,
        "elapsedSeconds": round(time.perf_counter() - started, 3),
        **(
            {
                "computed": {
                    "ecosystems": [asdict(row) for row in ecosystem_actual],
                    **(
                        {"species": [asdict(row) for row in species_actual]}
                        if species_actual
                        else {}
                    ),
                }
            }
            if args.include_computed
            else {}
        ),
    }
    if args.report is not None:
        _write_report(args.report, report)
    print(
        json.dumps(
            {
                "passed": report["passed"],
                "mismatchCount": report["mismatchCount"],
                "domainCounts": domain_counts,
            },
            sort_keys=True,
        )
    )
    if mismatches:
        for mismatch in mismatches[:20]:
            print(json.dumps(mismatch, ensure_ascii=False), file=sys.stderr)
    return 0 if not mismatches else 1


if __name__ == "__main__":
    raise SystemExit(main())
