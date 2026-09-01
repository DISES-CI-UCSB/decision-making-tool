"""Packet-authoritative SIRAP summary and SMSP metric inputs."""

from __future__ import annotations

import csv
import re
from dataclasses import dataclass
from itertools import chain, groupby
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
from calculators.species import SpeciesDetailSink
from local_io import CachedDownload, DownloadError, cached_download
from raster_metrics import SolutionRaster
from sparse.format import SparseFormatError, iter_species_matrix_chunks
from species_data import SpeciesRecord, compute_pool_sizes, load_species_records
from species_target_policy import SpeciesTargetPolicy
from species_taxonomy import class_bucket, normalize_class_name

_SPECIES_CELL_CHUNK_SIZE = 1_000_000


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
        declared_class = normalize_class_name(binding["taxonomicClass"])
        grid_validated = False
        species_has_overlap = False
        species_bucket = None
        for species, grid, grid_raw in iter_species_matrix_chunks(
            download.path,
            max_cells=_SPECIES_CELL_CHUNK_SIZE,
        ):
            if not grid_validated:
                if not _matrix_matches_packet_grid(grid, grid_raw, raster):
                    raise SparseFormatError(
                        f"Species matrix {binding['taxonomicClass']!r} grid differs "
                        "from the SIRAP solution grid."
                    )
                grid_validated = True
            if species.first and normalize_class_name(species.csv_class) != declared_class:
                raise SparseFormatError(
                    f"SMSP entry class {species.csv_class!r} does not match packet "
                    f"binding {binding['taxonomicClass']!r}."
                )
            if species.first:
                species_bucket = class_bucket(species.csv_class)
                species_has_overlap = False
            species_has_overlap = species_has_overlap or bool(
                np.any(selected[species.cell_ids])
            )
            if species.last and species_bucket is not None and species_has_overlap:
                counts[species_bucket] += 1
        provenance.append(
            {
                "taxonomicClass": binding["taxonomicClass"],
                "url": binding["url"],
                "sha256": binding["sha256"],
            }
        )
    return counts, provenance


def regional_species_accumulator(
    species_binding: dict[str, Any],
    raster: SolutionRaster,
    packet_grid_sha256: str,
    boundary_indexes: dict[str, AnyBoundaryIndex],
    cache_dir: Path,
    *,
    force: bool,
    target_policy: SpeciesTargetPolicy,
    detail_sink: SpeciesDetailSink | None = None,
) -> tuple[SpeciesAccumulator, list[dict[str, str]]]:
    """Compute packet SMSP species metrics for the primary and nested scopes.

    SMSP cells are already on the packet grid.  We use each cell's grid-area
    weight as the species-range denominator, preserving the regular pipeline's
    per-scope coverage rule without accessing national species sources.
    """
    matrices = species_binding["matrices"]
    metadata_download = download_pinned(
        species_binding["metadataLookup"],
        cache_dir,
        force=force,
    )
    national_records = load_species_records(metadata_download.path)
    expected_denominator = species_binding["nationalDenominator"]["nonFishCount"]
    if len(national_records) != expected_denominator:
        raise ValueError(
            "National species denominator mismatch: "
            f"packet declares {expected_denominator}, lookup contains "
            f"{len(national_records)} non-fish species."
        )
    national_by_name: dict[str, list[SpeciesRecord]] = {}
    for record in national_records:
        national_by_name.setdefault(
            normalize_species_name(record.scientific_name), []
        ).append(record)
    duplicate_national_names = {
        name: candidates
        for name, candidates in national_by_name.items()
        if len(candidates) != 1
    }
    if duplicate_national_names:
        raise ValueError(
            "National species lookup contains ambiguous normalized names: "
            f"{sorted(duplicate_national_names)[:8]}."
        )

    regional_names: set[str] = set()
    provenance: list[dict[str, str]] = []
    pool_sizes = compute_pool_sizes(national_records)
    accumulator = SpeciesAccumulator(
        target_pct=target_policy.scalar_target_pct,
        pool_sizes=pool_sizes,
        target_policy=target_policy,
        detail_sink=detail_sink,
    )
    accumulator.init_sub(
        {level: index.num_boundaries for level, index in boundary_indexes.items()}
    )
    selected = raster.selected_mask.ravel()
    pre_existing = raster.pre_existing_mask.ravel()
    new_prioritizr = raster.new_prioritizr_mask.ravel()
    area_m2 = raster.pixel_area_km2_per_row * 1_000_000.0
    for binding in matrices:
        if binding["gridSha256"] != packet_grid_sha256:
            raise ValueError(
                f"Species matrix {binding['taxonomicClass']!r} is not pinned to "
                "the packet grid."
            )
        download = download_pinned(binding, cache_dir, force=force)
        declared_class = normalize_class_name(binding["taxonomicClass"])
        grid_validated = False
        numbered_chunks = _number_species_chunks(
            iter_species_matrix_chunks(
                download.path,
                max_cells=_SPECIES_CELL_CHUNK_SIZE,
            )
        )
        for _, grouped in groupby(numbered_chunks, key=lambda item: item[0]):
            items = (item for _, item in grouped)
            first_entry, grid, grid_raw = next(items)
            entries = chain(((first_entry, grid, grid_raw),), items)
            if not grid_validated:
                if not _matrix_matches_packet_grid(grid, grid_raw, raster):
                    raise SparseFormatError(
                        f"Species matrix {binding['taxonomicClass']!r} grid differs "
                        "from the SIRAP solution grid."
                    )
                grid_validated = True
            if normalize_class_name(first_entry.csv_class) != declared_class:
                raise SparseFormatError(
                    f"SMSP entry class {first_entry.csv_class!r} does not match packet "
                    f"binding {binding['taxonomicClass']!r}."
                )
            normalized_name = normalize_species_name(first_entry.name)
            if normalized_name in regional_names:
                raise ValueError(
                    "Regional species matrices contain duplicate name "
                    f"{first_entry.name!r}."
                )
            regional_names.add(normalized_name)
            candidates = national_by_name.get(normalized_name, [])
            if len(candidates) != 1:
                raise ValueError(
                    f"Regional species {first_entry.name!r} has {len(candidates)} "
                    "matches in the pinned national lookup."
                )
            record = candidates[0]
            if normalize_class_name(record.csv_class) != declared_class:
                raise ValueError(
                    f"Regional species {first_entry.name!r} class "
                    f"{first_entry.csv_class!r} "
                    f"does not match national class {record.csv_class!r}."
                )
            has_cells = _record_species_in_chunks(
                accumulator=accumulator,
                record=record,
                species_name=first_entry.name,
                cell_chunks=(entry.cell_ids for entry, _, _ in entries),
                raster_width=raster.fingerprint.width,
                area_m2=area_m2,
                selected=selected,
                pre_existing=pre_existing,
                new_prioritizr=new_prioritizr,
                boundary_indexes=boundary_indexes,
            )
            accumulator.species_processed += 1
            accumulator.species_aligned += 1
            if has_cells:
                accumulator.species_with_range += 1
        provenance.append(
            {
                "taxonomicClass": binding["taxonomicClass"],
                "url": binding["url"],
                "sha256": download.sha256,
            }
        )

    accumulator.species_expected = len(regional_names)
    provenance.append(
        {
            "taxonomicClass": "national-metadata",
            "url": metadata_download.url,
            "sha256": metadata_download.sha256,
        }
    )
    return accumulator, provenance


def normalize_species_name(value: str) -> str:
    """Normalize only formatting differences; never infer taxonomic synonyms."""
    return re.sub(r"\s+", " ", value.replace("_", " ").strip().lower())


def _record_species_in_chunks(
    *,
    accumulator: SpeciesAccumulator,
    record: SpeciesRecord,
    species_name: str,
    cell_chunks,
    raster_width: int,
    area_m2: np.ndarray,
    selected: np.ndarray,
    pre_existing: np.ndarray,
    new_prioritizr: np.ndarray,
    boundary_indexes: dict[str, AnyBoundaryIndex],
) -> bool:
    national = np.zeros(4, dtype=np.float64)
    has_cells = False
    per_level = {
        level: [
            np.zeros(index.num_boundaries, dtype=np.float64)
            for _ in range(4)
        ]
        for level, index in boundary_indexes.items()
    }
    for cells in cell_chunks:
        cells = np.asarray(cells, dtype=np.intp)
        if cells.size and (cells.min() < 0 or cells.max() >= selected.size):
            raise SparseFormatError(
                f"SMSP entry {species_name!r} contains an out-of-grid cell index."
            )
        has_cells = has_cells or bool(cells.size)
        weights = area_m2[cells // raster_width]
        selected_cells = selected[cells]
        pre_existing_cells = pre_existing[cells]
        new_prioritizr_cells = new_prioritizr[cells]
        national += (
            float(weights.sum()),
            float(weights[selected_cells].sum()),
            float(weights[pre_existing_cells].sum()),
            float(weights[new_prioritizr_cells].sum()),
        )
        prepared = prepare_sparse_boundary_weighted_channels(
            cells,
            weights,
            selected=selected_cells,
            pre_existing=pre_existing_cells,
            new_prioritizr=new_prioritizr_cells,
            num_pixels=selected.size,
        )
        for level, index in boundary_indexes.items():
            channels = aggregate_prepared_sparse_boundary_weighted_sums(
                index, prepared
            )
            for total, values in zip(
                per_level[level],
                (
                    channels.total,
                    channels.selected,
                    channels.pre_existing,
                    channels.new_prioritizr,
                ),
                strict=True,
            ):
                total += values

    accumulator.record_species_national(
        record,
        national[1],
        national[0],
        pre_existing_range_area_m2=national[2],
        new_prioritizr_range_area_m2=national[3],
    )
    for level, (total, selected_area, pre_existing_area, new_area) in per_level.items():
        accumulator.record_species_sub_level(
            record,
            level,
            selected_area,
            total,
            pre_existing_per_boundary=pre_existing_area,
            new_prioritizr_per_boundary=new_area,
        )
    return has_cells


def _number_species_chunks(chunks):
    species_index = -1
    for item in chunks:
        chunk = item[0]
        if chunk.first:
            species_index += 1
        yield species_index, item


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
