from __future__ import annotations

import csv
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

import numpy as np
import rasterio

from .coverage_target_validation import (
    CoverageTargetValidationError,
    normalize_feature_name,
    validate_coverage_targets,
)
from mesa_coverage import (
    MesaAoiCoverageRow,
    MesaCoverageRow,
    evaluate_categorical_aoi,
    evaluate_categorical_coverage,
)
from raster_metrics import SolutionRaster


class SolutionCoverageError(ValueError):
    pass


@dataclass(frozen=True)
class CoverageTarget:
    feature: str
    feature_type: str
    feature_class: str | None
    relative_target: float
    evaluated: str | None


@dataclass(frozen=True)
class CoverageSourceBinding:
    url: str | None
    sha256: str | None
    ecosystem_feature_count: int | None
    species_feature_count: int | None


@dataclass(frozen=True)
class RuntimeMesaCoverage:
    ecosystem_raster_path: Path
    ecosystem_catalog_path: Path
    targets_by_solution: dict[str, tuple[CoverageTarget, ...]]
    source_bindings_by_solution: dict[str, CoverageSourceBinding]
    species_groups: tuple[str, ...]

    def targets(self, solution_id: str, feature_type: str) -> tuple[CoverageTarget, ...]:
        return tuple(
            target
            for target in self.targets_by_solution.get(solution_id, ())
            if target.feature_type == feature_type
        )

    def species_target(self, solution_id: str, scientific_name: str) -> float | None:
        wanted = normalize_feature_name(scientific_name)
        for target in self.targets(solution_id, "species"):
            if normalize_feature_name(target.feature) == wanted:
                return target.relative_target
        return None

    def species_targets_by_normalized_name(
        self,
        solution_id: str,
        *,
        is_cancelled: Callable[[], bool] | None = None,
    ) -> dict[str, float]:
        """Build one evaluation-scoped lookup for a solution's species targets."""

        targets: dict[str, float] = {}
        for index, target in enumerate(
            self.targets_by_solution.get(solution_id, ())
        ):
            if (
                is_cancelled is not None
                and index % 512 == 0
                and is_cancelled()
            ):
                raise SolutionCoverageError("species_coverage_cancelled")
            if target.feature_type != "species":
                continue
            normalized_name = normalize_feature_name(target.feature)
            if normalized_name in targets:
                raise SolutionCoverageError(
                    f"mesa_species_target_duplicate:{normalized_name}"
                )
            targets[normalized_name] = target.relative_target

        if is_cancelled is not None and is_cancelled():
            raise SolutionCoverageError("species_coverage_cancelled")
        return targets


def load_runtime_mesa_coverage(
    ecosystem_raster_path: Path,
    ecosystem_catalog_path: Path,
    targets_path: Path,
    species_groups: list[str],
) -> RuntimeMesaCoverage:
    try:
        payload = json.loads(targets_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SolutionCoverageError(f"mesa_coverage_targets_invalid:{exc}") from exc
    if payload.get("format") != "mesa-solution-targets-v1":
        raise SolutionCoverageError("mesa_coverage_targets_format_invalid")

    raw_solutions = payload.get("solutions")
    if not isinstance(raw_solutions, dict):
        raise SolutionCoverageError("mesa_coverage_targets_solutions_invalid")
    raw_bindings = payload.get("source_bindings", {})
    if not isinstance(raw_bindings, dict):
        raise SolutionCoverageError("mesa_coverage_source_bindings_invalid")
    targets_by_solution: dict[str, tuple[CoverageTarget, ...]] = {}
    source_bindings_by_solution: dict[str, CoverageSourceBinding] = {}
    try:
        for solution_id, raw_targets in raw_solutions.items():
            if not isinstance(solution_id, str) or not solution_id:
                raise TypeError("solution ids must be non-empty strings")
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
        for solution_id, raw in raw_bindings.items():
            if not isinstance(solution_id, str) or solution_id not in targets_by_solution:
                raise TypeError(f"{solution_id} source binding has no target inventory")
            if not isinstance(raw, dict):
                raise TypeError(f"{solution_id} source binding must be an object")
            binding = CoverageSourceBinding(
                url=raw.get("url") if isinstance(raw.get("url"), str) else None,
                sha256=(
                    raw.get("sha256")
                    if isinstance(raw.get("sha256"), str)
                    else None
                ),
                ecosystem_feature_count=(
                    raw.get("ecosystem_feature_count")
                    if type(raw.get("ecosystem_feature_count")) is int
                    else None
                ),
                species_feature_count=(
                    raw.get("species_feature_count")
                    if type(raw.get("species_feature_count")) is int
                    else None
                ),
            )
            targets = targets_by_solution[solution_id]
            ecosystem_count = sum(
                target.feature_type == "ecosystem" for target in targets
            )
            species_count = sum(target.feature_type == "species" for target in targets)
            if (
                binding.ecosystem_feature_count != ecosystem_count
                or binding.species_feature_count != species_count
            ):
                raise TypeError(
                    f"{solution_id} source binding counts do not match validated targets"
                )
            source_bindings_by_solution[solution_id] = binding
    except (CoverageTargetValidationError, KeyError, TypeError, ValueError) as exc:
        raise SolutionCoverageError(f"mesa_coverage_target_invalid:{exc}") from exc

    return RuntimeMesaCoverage(
        ecosystem_raster_path=ecosystem_raster_path,
        ecosystem_catalog_path=ecosystem_catalog_path,
        targets_by_solution=targets_by_solution,
        source_bindings_by_solution=source_bindings_by_solution,
        species_groups=tuple(species_groups),
    )


def calculate_ecosystem_aoi_coverage(
    coverage: RuntimeMesaCoverage,
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
        raise SolutionCoverageError(
            "mesa_ecosystem_catalog_features_missing:" + ",".join(missing[:10])
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


def calculate_ecosystem_national_coverage(
    coverage: RuntimeMesaCoverage,
    solution_id: str,
    solution_raster: SolutionRaster,
) -> list[MesaCoverageRow]:
    """National parity path used by validation and deterministic fixtures."""

    targets = coverage.targets(solution_id, "ecosystem")
    values = _read_aligned_categories(coverage.ecosystem_raster_path, solution_raster)
    catalog = _read_ecosystem_catalog(coverage.ecosystem_catalog_path)
    return evaluate_categorical_coverage(
        category_values=values,
        selected_mask=solution_raster.selected_mask,
        feature_ids=[catalog[target.feature] for target in targets],
        feature_names=[target.feature for target in targets],
        relative_targets=[target.relative_target for target in targets],
        evaluated=[target.evaluated for target in targets],
    )


def _read_ecosystem_catalog(path: Path) -> dict[str, int]:
    try:
        with path.open(newline="", encoding="utf-8-sig") as handle:
            rows = list(csv.DictReader(handle))
        result = {str(row["biome"]): int(row["biome_id"]) for row in rows}
    except (OSError, KeyError, TypeError, ValueError) as exc:
        raise SolutionCoverageError(f"mesa_ecosystem_catalog_invalid:{exc}") from exc
    if len(result) != len(rows):
        raise SolutionCoverageError("mesa_ecosystem_catalog_duplicate_features")
    return result


def _read_aligned_categories(path: Path, solution_raster: SolutionRaster) -> np.ndarray:
    try:
        with rasterio.open(path) as dataset:
            transform = tuple(dataset.transform)[:6]
            aligned = (
                dataset.width == solution_raster.fingerprint.width
                and dataset.height == solution_raster.fingerprint.height
                and str(dataset.crs) == solution_raster.fingerprint.crs
                and all(
                    abs(left - right) <= 1e-6
                    for left, right in zip(
                        transform,
                        solution_raster.fingerprint.transform,
                        strict=True,
                    )
                )
            )
            if not aligned:
                raise SolutionCoverageError("mesa_ecosystem_raster_grid_mismatch")
            return dataset.read(1, masked=True).astype(np.float64).filled(np.nan)
    except SolutionCoverageError:
        raise
    except Exception as exc:
        raise SolutionCoverageError(f"mesa_ecosystem_raster_invalid:{exc}") from exc
