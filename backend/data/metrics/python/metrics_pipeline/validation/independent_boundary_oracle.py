"""Validate grouped fan-out with independent scalar boundary masks.

This oracle deliberately does not read or construct the grouped boundary CSR.
It rasterizes every source polygon independently, discovers overlap pixels from
the sum of those masks, and checks species and representative non-species
outputs for one deterministic overlap-owning boundary at every level.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import sys
import unicodedata
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse

import numpy as np

PIPELINE_ROOT = Path(__file__).parents[1]
if str(PIPELINE_ROOT) not in sys.path:
    sys.path.insert(0, str(PIPELINE_ROOT))

from boundaries.boundary_loader import BoundaryFeature, load_all_boundaries
from boundaries.boundary_mask import rasterize_boundary
from local_io import cached_download
from metric_definitions import computable_metrics
from raster_metrics import (
    RasterFingerprint,
    read_layer_mask,
    read_layer_values,
    read_solution_raster,
    weighted_sum_km2,
)
from species_overlap import read_species_overlap

LEVELS = ("departments", "municipalities", "siraps", "runaps", "omecs")
SPECIES_ROW_FIELDS = (
    "scopeIndex",
    "speciesIndex",
    "rangeAreaKm2",
    "solutionCoveredAreaKm2",
    "preExistingCoveredAreaKm2",
    "newPrioritizrCoveredAreaKm2",
    "configuredTargetPercent",
    "flags",
)
CHANNEL_FIELDS = (
    "rangeAreaKm2",
    "solutionCoveredAreaKm2",
    "preExistingCoveredAreaKm2",
    "newPrioritizrCoveredAreaKm2",
)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _species_id(source_url: str) -> str:
    basename = Path(unquote(urlparse(source_url).path)).stem
    basename = re.sub(r"_10_MAXENT$", "", basename)
    normalized = unicodedata.normalize("NFKD", basename)
    ascii_name = normalized.encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "_", ascii_name).strip("_")


def _metric(scope: dict[str, Any], metric_id: str) -> dict[str, Any]:
    return next(
        metric
        for metric in scope["metrics"]
        if metric.get("metricId") == metric_id
    )


def _aligned_path(
    cache_dir: Path,
    alignment_entries: list[dict[str, Any]],
    input_id: str,
) -> Path:
    entry = next(item for item in alignment_entries if item.get("inputId") == input_id)
    key = entry["cacheKey"]
    path = cache_dir / "aligned" / key[:2] / f"{key}.tif"
    if _sha256(path) != entry["alignedSha256"]:
        raise RuntimeError(f"aligned checksum mismatch for {input_id}")
    return path


def _overlap_counts(
    features: list[BoundaryFeature],
    fingerprint: RasterFingerprint,
) -> np.ndarray:
    counts = np.zeros((fingerprint.height, fingerprint.width), dtype=np.uint16)
    for feature in features:
        counts += rasterize_boundary(
            feature.geometry,
            fingerprint,
            source_crs=feature.source_crs,
        )
    return counts


def _species_cache_candidates(cache_dir: Path) -> list[tuple[int, str, Path]]:
    candidates: list[tuple[int, str, Path]] = []
    for metadata_path in cache_dir.joinpath("species-overlap").glob("*/*.json"):
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        candidates.append(
            (
                int(metadata["qa"]["positiveTargetCellCount"]),
                _species_id(metadata["sourceUrl"]),
                metadata_path.with_suffix(".npz"),
            )
        )
    return sorted(candidates, key=lambda item: (-item[0], item[1]))


def _select_species(
    candidates: list[tuple[int, str, Path]],
    fingerprint: RasterFingerprint,
    overlap_positions: dict[str, np.ndarray],
) -> tuple[str, Path, np.ndarray, np.ndarray]:
    for _, species_id, path in candidates:
        overlap = read_species_overlap(path, fingerprint)
        pixels = overlap.flat_indices
        if pixels.size == 0:
            continue
        if all(np.intersect1d(pixels, positions, assume_unique=True).size for positions in overlap_positions.values()):
            return species_id, path, pixels, overlap.areas_m2
    raise RuntimeError("no cached species intersects overlap pixels at every level")


def _species_row(
    path: Path,
    *,
    scope_id: str,
    species_index: int,
) -> dict[str, Any]:
    document = json.loads(path.read_text(encoding="utf-8"))
    if document.get("rowLayout") != list(SPECIES_ROW_FIELDS):
        raise RuntimeError(f"unexpected species row layout in {path}")
    scope_index = next(
        index
        for index, row in enumerate(document["scopeCatalog"])
        if row[0] == scope_id
    )
    row = next(
        row
        for row in document["rows"]
        if row[0] == scope_index and row[1] == species_index
    )
    return dict(zip(SPECIES_ROW_FIELDS, row, strict=True))


def _scalar_channels(
    mask_flat: np.ndarray,
    pixels: np.ndarray,
    areas_m2: np.ndarray,
    *,
    selected_flat: np.ndarray,
    pre_existing_flat: np.ndarray,
    new_prioritizr_flat: np.ndarray,
) -> dict[str, float]:
    inside = mask_flat[pixels]
    selectors = {
        "rangeAreaKm2": inside,
        "solutionCoveredAreaKm2": inside & selected_flat[pixels],
        "preExistingCoveredAreaKm2": inside & pre_existing_flat[pixels],
        "newPrioritizrCoveredAreaKm2": inside & new_prioritizr_flat[pixels],
    }
    return {
        field: round(float(areas_m2[selector].sum(dtype=np.float64)) / 1_000_000.0, 6)
        for field, selector in selectors.items()
    }


def _select_boundary(
    features: list[BoundaryFeature],
    fingerprint: RasterFingerprint,
    overlap_flat: np.ndarray,
    pixels: np.ndarray,
    areas_m2: np.ndarray,
    *,
    selected_flat: np.ndarray,
    pre_existing_flat: np.ndarray,
    new_prioritizr_flat: np.ndarray,
) -> tuple[BoundaryFeature, np.ndarray, dict[str, float], int]:
    range_overlap = np.zeros(overlap_flat.size, dtype=bool)
    range_overlap[pixels] = overlap_flat[pixels]
    for feature in features:
        mask = rasterize_boundary(
            feature.geometry,
            fingerprint,
            source_crs=feature.source_crs,
        )
        mask_flat = mask.ravel()
        if not np.any(mask_flat & range_overlap):
            continue
        channels = _scalar_channels(
            mask_flat,
            pixels,
            areas_m2,
            selected_flat=selected_flat,
            pre_existing_flat=pre_existing_flat,
            new_prioritizr_flat=new_prioritizr_flat,
        )
        if (
            channels["rangeAreaKm2"] > 0
            and channels["solutionCoveredAreaKm2"] > 0
        ):
            overlap_claims = int(np.count_nonzero(mask_flat & overlap_flat))
            return feature, mask, channels, overlap_claims
    raise RuntimeError("no overlap-owning boundary has positive total and selected areas")


def _close(expected: float, actual: Any, *, absolute: float, relative: float = 0.0) -> bool:
    return isinstance(actual, (int, float)) and math.isclose(
        expected,
        float(actual),
        abs_tol=absolute,
        rel_tol=relative,
    )


def run(args: argparse.Namespace) -> dict[str, Any]:
    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    candidate = json.loads(args.candidate_verbose.read_text(encoding="utf-8"))
    solution = next(item for item in manifest["solutions"] if item["id"] == candidate["solutionId"])
    raster_path = cached_download(solution["displayUrl"], args.cache_dir).path
    raster = read_solution_raster(raster_path)
    fingerprint = raster.fingerprint

    boundaries, errors = load_all_boundaries(args.cache_dir)
    if errors:
        raise RuntimeError(f"boundary cache errors: {errors}")

    counts_by_level = {
        level: _overlap_counts(boundaries[level], fingerprint)
        for level in LEVELS
    }
    overlap_positions = {
        level: np.flatnonzero(counts.ravel() > 1)
        for level, counts in counts_by_level.items()
    }
    if any(positions.size == 0 for positions in overlap_positions.values()):
        raise RuntimeError("every boundary level must contain overlap pixels")

    candidates = _species_cache_candidates(args.cache_dir)
    species_id, species_path, pixels, areas_m2 = _select_species(
        candidates,
        fingerprint,
        overlap_positions,
    )
    species_catalog = json.loads(args.species_catalog.read_text(encoding="utf-8"))
    species_index = next(
        index
        for index, row in enumerate(species_catalog["rows"])
        if row[0] == species_id
    )

    alignment_entries = candidate["metricsProvenance"]["inputAlignment"]["entries"]
    water_definition = next(
        definition
        for definition in computable_metrics()
        if definition.layer_id == "recarga_agua"
    )
    water_mask = read_layer_mask(
        _aligned_path(args.cache_dir, alignment_entries, "layer:recarga_agua"),
        fingerprint,
        rendering=water_definition.off_manifest_rendering,
    )
    biomass_values = read_layer_values(
        _aligned_path(args.cache_dir, alignment_entries, "layer:biomasa"),
        fingerprint,
    )

    selected_flat = raster.selected_mask.ravel()
    pre_existing_flat = raster.pre_existing_mask.ravel()
    new_prioritizr_flat = raster.new_prioritizr_mask.ravel()
    level_results: dict[str, Any] = {}
    for level in LEVELS:
        counts = counts_by_level[level]
        feature, mask, expected_channels, overlap_claims = _select_boundary(
            boundaries[level],
            fingerprint,
            counts.ravel() > 1,
            pixels,
            areas_m2,
            selected_flat=selected_flat,
            pre_existing_flat=pre_existing_flat,
            new_prioritizr_flat=new_prioritizr_flat,
        )
        partition = args.species_partitions / f"{level}.species-goals.compact.json"
        candidate_row = _species_row(
            partition,
            scope_id=feature.boundary_id,
            species_index=species_index,
        )
        channel_checks = {
            field: {
                "oracle": expected,
                "candidate": candidate_row[field],
                "match": _close(expected, candidate_row[field], absolute=5e-7),
            }
            for field, expected in expected_channels.items()
        }

        scoped_selected = mask & raster.selected_mask
        expected_metrics = {
            "priority_area_in_region": float(
                (scoped_selected.sum(axis=1) * raster.pixel_area_km2_per_row).sum()
            ),
            "water_regulation_area": float(
                (
                    (scoped_selected & water_mask).sum(axis=1)
                    * raster.pixel_area_km2_per_row
                ).sum()
            ),
            "carbon_biomass_total": weighted_sum_km2(
                scoped_selected,
                biomass_values,
                raster.pixel_area_km2_per_row,
            ),
        }
        scope = candidate["geographies"][level][feature.boundary_id]
        metric_checks = {}
        for metric_id, expected in expected_metrics.items():
            actual = _metric(scope, metric_id)["value"]
            weighted = metric_id == "carbon_biomass_total"
            metric_checks[metric_id] = {
                "oracle": expected,
                "candidate": actual,
                "match": _close(
                    expected,
                    actual,
                    absolute=1e-6,
                    relative=1e-12 if weighted else 0.0,
                ),
            }

        level_results[level] = {
            "boundaryId": feature.boundary_id,
            "boundaryName": feature.name,
            "boundaryGeometrySha256": feature.geometry_sha256,
            "overlapPixels": int(overlap_positions[level].size),
            "maxMultiplicity": int(counts.max()),
            "selectedBoundaryOverlapPixels": overlap_claims,
            "speciesRangeOverlapPixels": int(
                np.intersect1d(
                    pixels,
                    overlap_positions[level],
                    assume_unique=True,
                ).size
            ),
            "speciesChannels": channel_checks,
            "nonSpeciesMetrics": metric_checks,
        }

    checks = [
        check["match"]
        for level in level_results.values()
        for group in ("speciesChannels", "nonSpeciesMetrics")
        for check in level[group].values()
    ]
    return {
        "format": "independent-scalar-boundary-oracle-v1",
        "method": {
            "boundaryMembership": "independent per-polygon rasterio scalar masks",
            "overlapDiscovery": "sum of independent scalar masks; no CSR or first-owner grid",
            "speciesWeights": "actual cached exact sparse overlap float64 areas",
            "channels": list(CHANNEL_FIELDS),
            "nonSpeciesMetrics": [
                "priority_area_in_region",
                "water_regulation_area",
                "carbon_biomass_total",
            ],
        },
        "inputs": {
            "manifest": str(args.manifest),
            "manifestSha256": _sha256(args.manifest),
            "candidateVerbose": str(args.candidate_verbose),
            "candidateVerboseSha256": _sha256(args.candidate_verbose),
            "speciesCatalog": str(args.species_catalog),
            "speciesCatalogSha256": _sha256(args.species_catalog),
            "cacheDir": str(args.cache_dir),
        },
        "species": {
            "speciesId": species_id,
            "speciesIndex": species_index,
            "overlapArtifact": str(species_path),
            "overlapArtifactSha256": _sha256(species_path),
        },
        "levels": level_results,
        "checkCount": len(checks),
        "mismatchCount": checks.count(False),
        "result": "pass" if all(checks) else "fail",
    }


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--candidate-verbose", type=Path, required=True)
    parser.add_argument("--species-catalog", type=Path, required=True)
    parser.add_argument("--species-partitions", type=Path, required=True)
    parser.add_argument("--cache-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    result = run(args)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(result, indent=2, ensure_ascii=False, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(
        f"independent boundary oracle {result['result']}: "
        f"{result['checkCount']} checks, {result['mismatchCount']} mismatch(es)"
    )
    print(f"oracle evidence -> {args.output}")
    return 0 if result["result"] == "pass" else 1


if __name__ == "__main__":
    raise SystemExit(main())
