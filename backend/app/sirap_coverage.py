from __future__ import annotations

import csv
import json
from dataclasses import dataclass
from pathlib import Path

from .coverage_target_validation import (
    CoverageTargetValidationError,
    normalize_feature_name,
    validate_coverage_targets,
)
from .solution_coverage import CoverageTarget, SolutionCoverageError, _read_aligned_categories
from mesa_coverage import MesaAoiCoverageRow, evaluate_categorical_aoi
from raster_metrics import SolutionRaster


class SirapCoverageError(ValueError):
    pass


@dataclass(frozen=True)
class RuntimeSirapCoverage:
    ecosystem_raster_path: Path
    ecosystem_catalog_path: Path
    targets_by_solution: dict[str, tuple[CoverageTarget, ...]]

    def targets(self, solution_id: str, feature_type: str) -> tuple[CoverageTarget, ...]:
        return tuple(
            target
            for target in self.targets_by_solution.get(solution_id, ())
            if target.feature_type == feature_type
        )


def load_runtime_sirap_coverage(
    ecosystem_raster_path: Path,
    ecosystem_catalog_path: Path,
    solution_targets: dict[str, Path],
) -> RuntimeSirapCoverage:
    targets_by_solution: dict[str, tuple[CoverageTarget, ...]] = {}
    try:
        for solution_id, targets_path in sorted(solution_targets.items()):
            payload = json.loads(targets_path.read_text(encoding="utf-8"))
            if payload.get("format") != "sirap-solution-targets-v1":
                raise SirapCoverageError("sirap_coverage_targets_format_invalid")
            raw_targets = payload.get("targets")
            if not isinstance(raw_targets, list):
                raise SirapCoverageError(
                    f"{solution_id} sirap coverage targets must be a list."
                )
            validated = validate_coverage_targets(
                raw_targets,
                solution_id=solution_id,
            )
            targets_by_solution[solution_id] = tuple(
                CoverageTarget(
                    feature=row.feature,
                    feature_type=row.feature_type,
                    feature_class=row.feature_class,
                    relative_target=row.relative_target,
                    evaluated=row.evaluated,
                )
                for row in validated
            )
    except (CoverageTargetValidationError, OSError, json.JSONDecodeError) as exc:
        raise SirapCoverageError(f"sirap_coverage_target_invalid:{exc}") from exc

    return RuntimeSirapCoverage(
        ecosystem_raster_path=ecosystem_raster_path,
        ecosystem_catalog_path=ecosystem_catalog_path,
        targets_by_solution=targets_by_solution,
    )


def calculate_sirap_ecosystem_aoi_coverage(
    coverage: RuntimeSirapCoverage,
    solution_id: str,
    aoi_raster: SolutionRaster,
    solution_raster: SolutionRaster,
) -> dict[str, MesaAoiCoverageRow]:
    targets = coverage.targets(solution_id, "ecosystem")
    if not targets:
        return {}
    values = _read_aligned_categories(coverage.ecosystem_raster_path, solution_raster)
    catalog = _read_ecosystem_catalog(coverage.ecosystem_catalog_path)
    missing = [target.feature for target in targets if target.feature not in catalog]
    if missing:
        raise SirapCoverageError(
            "sirap_ecosystem_catalog_features_missing:" + ",".join(missing[:10])
        )
    rows = evaluate_categorical_aoi(
        category_values=values,
        selected_mask=solution_raster.selected_mask,
        aoi_mask=aoi_raster.selected_mask,
        feature_ids=[catalog[target.feature] for target in targets],
        feature_names=[target.feature for target in targets],
        national_targets=[target.relative_target for target in targets],
        pre_existing_mask=solution_raster.pre_existing_mask,
        new_prioritizr_mask=solution_raster.new_prioritizr_mask,
    )
    return {normalize_feature_name(row.feature): row for row in rows}


def _read_ecosystem_catalog(path: Path) -> dict[str, int]:
    try:
        with path.open(newline="", encoding="utf-8-sig") as handle:
            rows = list(csv.DictReader(handle))
        result = {str(row["biome"]): int(row["biome_id"]) for row in rows}
    except (OSError, KeyError, TypeError, ValueError) as exc:
        raise SirapCoverageError(f"sirap_ecosystem_catalog_invalid:{exc}") from exc
    if len(result) != len(rows):
        raise SirapCoverageError("sirap_ecosystem_catalog_duplicate_features")
    return result
