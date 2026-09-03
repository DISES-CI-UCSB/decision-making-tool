from __future__ import annotations

import csv
import json
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

import numpy as np

from .coverage_target_validation import (
    CoverageTargetValidationError,
    normalize_feature_name,
    validate_coverage_targets,
)
from .solution_coverage import CoverageTarget, SolutionCoverageError, _read_aligned_categories
from mesa_coverage import MesaAoiCoverageRow, evaluate_categorical_aoi, mesa_aoi_coverage_row
from raster_metrics import SolutionRaster, read_layer_mask

if TYPE_CHECKING:
    from .artifacts import RuntimeRasterLayer


class SirapCoverageError(ValueError):
    pass


STRATEGIC_FEATURE_LAYER_IDS: dict[str, str] = {
    "paramos": "paramos",
    "humedales": "wetlands",
    "bosque seco": "bosque_seco",
    "bosque_seco": "bosque_seco",
    "mangroves": "mangroves",
    "manglares": "mangroves",
}


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


def calculate_sirap_strategic_aoi_coverage(
    coverage: RuntimeSirapCoverage,
    solution_id: str,
    aoi_raster: SolutionRaster,
    solution_raster: SolutionRaster,
    raster_layers: dict[str, RuntimeRasterLayer],
) -> dict[str, MesaAoiCoverageRow]:
    targets = coverage.targets(solution_id, "strategic ecosystem")
    if not targets:
        return {}

    classified_total_aoi = _classified_planning_cells_in_aoi(
        coverage.ecosystem_raster_path,
        solution_raster,
        aoi_raster,
    )
    rows: dict[str, MesaAoiCoverageRow] = {}
    for target in targets:
        layer_id = _strategic_layer_id(target.feature)
        if layer_id is None:
            raise SirapCoverageError(
                "sirap_strategic_layer_missing:" + normalize_feature_name(target.feature)
            )
        layer = raster_layers.get(layer_id)
        if layer is None:
            raise SirapCoverageError(f"sirap_strategic_raster_layer_missing:{layer_id}")
        layer_mask = read_layer_mask(
            layer.path,
            solution_raster.fingerprint,
            rendering=layer.rendering,
        )
        row = _evaluate_binary_aoi(
            layer_mask=layer_mask,
            selected_mask=solution_raster.selected_mask,
            aoi_mask=aoi_raster.selected_mask,
            feature_name=target.feature,
            national_target=target.relative_target,
            classified_total_amount_aoi=classified_total_aoi,
            pre_existing_mask=solution_raster.pre_existing_mask,
            new_prioritizr_mask=solution_raster.new_prioritizr_mask,
        )
        rows[normalize_feature_name(row.feature)] = row
    return rows




def _classified_planning_cells_in_aoi(
    ecosystem_raster_path: Path,
    solution_raster: SolutionRaster,
    aoi_raster: SolutionRaster,
) -> float:
    values = _read_aligned_categories(ecosystem_raster_path, solution_raster)
    aoi = np.asarray(aoi_raster.selected_mask, dtype=bool).ravel()
    flat_values = values.ravel()
    finite = np.isfinite(flat_values)
    return float(np.count_nonzero(finite & aoi))

def _strategic_layer_id(feature: str) -> str | None:
    return STRATEGIC_FEATURE_LAYER_IDS.get(normalize_feature_name(feature))


def _evaluate_binary_aoi(
    *,
    layer_mask: np.ndarray,
    selected_mask: np.ndarray,
    aoi_mask: np.ndarray,
    feature_name: str,
    national_target: float,
    classified_total_amount_aoi: float,
    pre_existing_mask: np.ndarray | None,
    new_prioritizr_mask: np.ndarray | None,
) -> MesaAoiCoverageRow:
    present = np.asarray(layer_mask, dtype=bool).ravel()
    selected = np.asarray(selected_mask, dtype=bool).ravel()
    aoi = np.asarray(aoi_mask, dtype=bool).ravel()
    if selected.size != aoi.size or present.size != selected.size:
        raise SirapCoverageError("sirap_strategic_mask_size_mismatch")

    aoi_present = present & aoi
    total_aoi = float(np.count_nonzero(aoi_present))
    held = float(np.count_nonzero(present & selected & aoi))
    national_total = float(np.count_nonzero(present))
    pre_existing = (
        float(np.count_nonzero(present & np.asarray(pre_existing_mask, dtype=bool).ravel() & aoi))
        if pre_existing_mask is not None
        else None
    )
    new_prioritizr = (
        float(np.count_nonzero(present & np.asarray(new_prioritizr_mask, dtype=bool).ravel() & aoi))
        if new_prioritizr_mask is not None
        else None
    )
    return mesa_aoi_coverage_row(
        feature=feature_name,
        total_amount_aoi=total_aoi,
        absolute_held_aoi=held,
        national_total=national_total,
        national_target=national_target,
        classified_total_amount_aoi=classified_total_amount_aoi,
        absolute_pre_existing_aoi=pre_existing,
        absolute_new_prioritizr_aoi=new_prioritizr,
    )


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
