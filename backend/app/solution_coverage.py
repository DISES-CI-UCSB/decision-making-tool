from __future__ import annotations

import csv
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import rasterio

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
class RuntimeMesaCoverage:
    ecosystem_raster_path: Path
    ecosystem_catalog_path: Path
    targets_by_solution: dict[str, tuple[CoverageTarget, ...]]
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
    targets_by_solution: dict[str, tuple[CoverageTarget, ...]] = {}
    try:
        for solution_id, raw_targets in raw_solutions.items():
            targets_by_solution[str(solution_id)] = tuple(
                CoverageTarget(
                    feature=str(raw["feature"]),
                    feature_type=str(raw["feature_type"]).strip().lower(),
                    feature_class=(
                        str(raw["class"]).strip()
                        if raw.get("class") is not None
                        else None
                    ),
                    relative_target=float(raw["relative_target"]),
                    evaluated=(
                        str(raw["evaluated"]).strip()
                        if raw.get("evaluated") is not None
                        else None
                    ),
                )
                for raw in raw_targets
            )
    except (KeyError, TypeError, ValueError) as exc:
        raise SolutionCoverageError(f"mesa_coverage_target_invalid:{exc}") from exc

    return RuntimeMesaCoverage(
        ecosystem_raster_path=ecosystem_raster_path,
        ecosystem_catalog_path=ecosystem_catalog_path,
        targets_by_solution=targets_by_solution,
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


def normalize_feature_name(value: str) -> str:
    return re.sub(r"\s+", " ", value.replace("_", " ").strip().casefold())


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
