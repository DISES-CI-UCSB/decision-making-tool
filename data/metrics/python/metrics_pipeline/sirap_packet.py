"""Packet-authoritative SIRAP summary and SMSP metric inputs."""

from __future__ import annotations

import csv
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
from rasterio.crs import CRS

from boundaries.boundary_topology import (
    AnyBoundaryIndex,
    aggregate_prepared_sparse_boundary_weighted_sums,
    prepare_sparse_boundary_weighted_channels,
)
from calculators.species import SpeciesAccumulator
from local_io import CachedDownload, DownloadError, cached_download
from raster_metrics import SolutionRaster
from sparse.format import SparseFormatError, decode_species_matrix_bytes
from species_data import SpeciesRecord, compute_pool_sizes
from species_target_policy import SpeciesTargetPolicy
from species_taxonomy import class_bucket, normalize_class_name


@dataclass(frozen=True)
class SirapSummary:
    target_count: int
    met_target_count: int

    @property
    def targets_met_pct(self) -> float | None:
        if not self.target_count:
            return None
        return self.met_target_count / self.target_count * 100


def download_pinned(
    binding: dict[str, Any], cache_dir: Path, *, force: bool
) -> CachedDownload:
    """Download one packet asset and reject any checksum mismatch."""
    url = binding["url"]
    download = cached_download(url, cache_dir, force=force)
    if download.sha256 != binding["sha256"]:
        raise DownloadError(
            f"Packet asset checksum mismatch for {url!r}; expected "
            f"{binding['sha256']}, observed {download.sha256}."
        )
    return download


def read_summary(
    binding: dict[str, Any], cache_dir: Path, *, force: bool
) -> tuple[SirapSummary, CachedDownload]:
    """Read the packet's Prioritizr summary without using manifest metadata."""
    download = download_pinned(binding, cache_dir, force=force)
    try:
        with download.path.open(encoding="utf-8", newline="") as source:
            rows = list(csv.DictReader(source))
    except (OSError, csv.Error) as exc:
        raise ValueError(f"Could not parse regional summary CSV: {exc}") from exc
    if not rows or not {"met", "relative_target"}.issubset(rows[0]):
        raise ValueError("Regional summary CSV lacks required met/relative_target columns.")
    target_rows = [
        row
        for row in rows
        if _number(row.get("relative_target")) is not None
        and _parse_bool(row.get("met")) is not None
    ]
    return (
        SirapSummary(
            target_count=len(target_rows),
            met_target_count=sum(_parse_bool(row["met"]) is True for row in target_rows),
        ),
        download,
    )


def regional_species_richness(
    matrices: list[dict[str, Any]],
    raster: SolutionRaster,
    packet_grid_sha256: str,
    cache_dir: Path,
    *,
    force: bool,
) -> tuple[dict[str, int], list[dict[str, str]]]:
    """Count selected species directly from declared packet SMSP matrices."""
    counts = {bucket: 0 for bucket in ("mammals", "birds", "amphibians", "reptiles", "plants")}
    provenance: list[dict[str, str]] = []
    selected = raster.selected_mask.ravel()
    for binding in matrices:
        if binding["gridSha256"] != packet_grid_sha256:
            raise ValueError(
                f"Species matrix {binding['taxonomicClass']!r} is not pinned to "
                "the packet grid."
            )
        download = download_pinned(binding, cache_dir, force=force)
        decoded = decode_species_matrix_bytes(download.path.read_bytes())
        if not _matrix_matches_packet_grid(decoded.grid, decoded.grid_raw, raster):
            raise SparseFormatError(
                f"Species matrix {binding['taxonomicClass']!r} grid differs from "
                "the SIRAP solution grid."
            )
        declared_class = normalize_class_name(binding["taxonomicClass"])
        for species in decoded.entries:
            if normalize_class_name(species.csv_class) != declared_class:
                raise SparseFormatError(
                    f"SMSP entry class {species.csv_class!r} does not match packet "
                    f"binding {binding['taxonomicClass']!r}."
                )
            bucket = class_bucket(species.csv_class)
            if bucket is not None and np.any(selected[species.cell_ids]):
                counts[bucket] += 1
        provenance.append(
            {
                "taxonomicClass": binding["taxonomicClass"],
                "url": binding["url"],
                "sha256": binding["sha256"],
            }
        )
    return counts, provenance


def regional_species_accumulator(
    matrices: list[dict[str, Any]],
    raster: SolutionRaster,
    packet_grid_sha256: str,
    boundary_indexes: dict[str, AnyBoundaryIndex],
    cache_dir: Path,
    *,
    force: bool,
    target_policy: SpeciesTargetPolicy,
) -> tuple[SpeciesAccumulator, list[dict[str, str]]]:
    """Compute packet SMSP species metrics for the primary and nested scopes.

    SMSP cells are already on the packet grid.  We use each cell's grid-area
    weight as the species-range denominator, preserving the regular pipeline's
    per-scope coverage rule without accessing national species sources.
    """
    decoded_matrices: list[tuple[dict[str, Any], Any]] = []
    records: list[SpeciesRecord] = []
    provenance: list[dict[str, str]] = []
    for binding in matrices:
        if binding["gridSha256"] != packet_grid_sha256:
            raise ValueError(
                f"Species matrix {binding['taxonomicClass']!r} is not pinned to "
                "the packet grid."
            )
        download = download_pinned(binding, cache_dir, force=force)
        decoded = decode_species_matrix_bytes(download.path.read_bytes())
        if not _matrix_matches_packet_grid(decoded.grid, decoded.grid_raw, raster):
            raise SparseFormatError(
                f"Species matrix {binding['taxonomicClass']!r} grid differs from "
                "the SIRAP solution grid."
            )
        declared_class = normalize_class_name(binding["taxonomicClass"])
        for entry in decoded.entries:
            if normalize_class_name(entry.csv_class) != declared_class:
                raise SparseFormatError(
                    f"SMSP entry class {entry.csv_class!r} does not match packet "
                    f"binding {binding['taxonomicClass']!r}."
                )
            records.append(
                SpeciesRecord(
                    scientific_name=entry.name,
                    csv_class=entry.csv_class,
                    iucn_status=entry.iucn,
                    range_km2=None,
                    bucket=class_bucket(entry.csv_class),
                    threatened=entry.iucn.strip().upper() in {"CR", "EN", "VU"},
                )
            )
        decoded_matrices.append((binding, decoded))
        provenance.append(
            {
                "taxonomicClass": binding["taxonomicClass"],
                "url": binding["url"],
                "sha256": download.sha256,
            }
        )

    pool_sizes = compute_pool_sizes(records)
    accumulator = SpeciesAccumulator(
        target_pct=target_policy.scalar_target_pct,
        pool_sizes=pool_sizes,
        target_policy=target_policy,
        species_expected=len(records),
    )
    accumulator.init_sub(
        {level: index.num_boundaries for level, index in boundary_indexes.items()}
    )
    selected = raster.selected_mask.ravel()
    area_m2 = raster.pixel_area_km2_per_row * 1_000_000.0

    record_index = 0
    for _, decoded in decoded_matrices:
        for entry in decoded.entries:
            record = records[record_index]
            record_index += 1
            cell_ids = np.asarray(entry.cell_ids, dtype=np.intp)
            if cell_ids.size and (cell_ids.min() < 0 or cell_ids.max() >= selected.size):
                raise SparseFormatError(
                    f"SMSP entry {entry.name!r} contains an out-of-grid cell index."
                )
            weights = area_m2[cell_ids // raster.fingerprint.width]
            selected_weights = weights[selected[cell_ids]]
            accumulator.record_species_national(
                record,
                float(selected_weights.sum()),
                float(weights.sum()),
            )
            prepared = prepare_sparse_boundary_weighted_channels(
                cell_ids,
                weights,
                selected=selected[cell_ids],
                pre_existing=np.zeros(cell_ids.size, dtype=np.bool_),
                new_prioritizr=np.zeros(cell_ids.size, dtype=np.bool_),
                num_pixels=selected.size,
            )
            for level, index in boundary_indexes.items():
                channels = aggregate_prepared_sparse_boundary_weighted_sums(
                    index, prepared
                )
                accumulator.record_species_sub_level(
                    record,
                    level,
                    channels.selected,
                    channels.total,
                )
            accumulator.species_processed += 1
            accumulator.species_aligned += 1
            if cell_ids.size:
                accumulator.species_with_range += 1
    return accumulator, provenance


def _matrix_matches_solution(matrix: Any, raster: SolutionRaster) -> bool:
    fingerprint = raster.fingerprint
    transform = matrix.transform or (
        matrix.x_scale,
        0.0,
        matrix.x_origin,
        0.0,
        matrix.y_scale,
        matrix.y_origin,
    )
    return (
        matrix.width == fingerprint.width
        and matrix.height == fingerprint.height
        and tuple(transform) == tuple(fingerprint.transform)
        and matrix.crs is not None
        and fingerprint.crs is not None
        and CRS.from_user_input(matrix.crs) == CRS.from_user_input(fingerprint.crs)
    )


def _matrix_matches_packet_grid(
    matrix: Any,
    grid_raw: dict[str, Any],
    raster: SolutionRaster,
) -> bool:
    """Validate a full grid header, or packet-bound dimensions for legacy SMSP."""
    if matrix is not None:
        return _matrix_matches_solution(matrix, raster)
    # The regional converter's first-generation SMSP bundles retain cell-grid
    # dimensions but not affine/CRS metadata. Their manifest grid checksum and
    # per-matrix checksum are the authoritative spatial binding; dimensions
    # still prevent applying cell indexes to a differently sized raster.
    return (
        grid_raw.get("width") == raster.fingerprint.width
        and grid_raw.get("height") == raster.fingerprint.height
    )


def _number(value: object) -> float | None:
    try:
        parsed = float(str(value))
    except (TypeError, ValueError):
        return None
    return parsed if np.isfinite(parsed) else None


def _parse_bool(value: object) -> bool | None:
    normalized = str(value or "").strip().lower()
    if normalized in {"true", "1"}:
        return True
    if normalized in {"false", "0"}:
        return False
    return None
