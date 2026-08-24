from __future__ import annotations

import gzip
import hashlib
import json
import os
import shutil
import struct
import sys
import tempfile
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

import numpy as np


def _install_metrics_pipeline_path() -> Path:
    candidates: list[Path] = []
    configured_path = os.getenv("DMT_METRICS_PIPELINE_PATH")
    if configured_path:
        candidates.append(Path(configured_path))

    repo_root = Path(__file__).resolve().parents[2]
    candidates.append(repo_root / "data" / "metrics" / "python" / "metrics_pipeline")

    for candidate in candidates:
        if (candidate / "sparse" / "format.py").exists():
            candidate_text = str(candidate)
            if candidate_text not in sys.path:
                sys.path.insert(0, candidate_text)
            return candidate

    searched = ", ".join(str(path) for path in candidates)
    raise RuntimeError(f"Unable to locate metrics pipeline source. Searched: {searched}")


_install_metrics_pipeline_path()

from raster_metrics import SolutionRaster  # noqa: E402
from mesa_coverage import mesa_aoi_coverage_row  # noqa: E402
from sparse.format import SMSP_MAGIC, SparseFormatError, SparseMetadata  # noqa: E402
from sparse.species_bitset import (  # noqa: E402
    FORMAT as BITSET_FORMAT,
    SpeciesBitsetMetadata,
    load_species_bitset_metadata,
)


class SpeciesIndexLoadError(ValueError):
    pass


class SpeciesIndexQueryError(ValueError):
    pass


@dataclass(frozen=True)
class SpeciesOverlapRecord:
    id: str
    scientific_name: str
    group: str
    iucn_status: str


@dataclass(frozen=True)
class SpeciesCoverageRecord:
    id: str
    scientific_name: str
    group: str
    iucn_status: str
    range_area_km2: float
    range_in_aoi_area_km2: float
    range_in_aoi_pct: float
    solution_covered_in_aoi_area_km2: float
    solution_covered_in_aoi_pct: float
    pre_existing_covered_in_aoi_area_km2: float
    pre_existing_covered_in_aoi_pct: float
    new_covered_in_aoi_area_km2: float
    new_covered_in_aoi_pct: float
    total_in_aoi: float | None = None
    held_in_aoi: float | None = None
    coverage_within_aoi: float | None = None
    contribution_to_national_coverage: float | None = None
    contribution_to_national_target: float | None = None


@dataclass(frozen=True)
class RuntimeSpeciesMetadata:
    scientific_name: str
    iucn_status: str
    csv_class: str

    def overlap_record(self, group: str) -> SpeciesOverlapRecord:
        return SpeciesOverlapRecord(
            id=species_dataset_id(self.scientific_name),
            scientific_name=self.scientific_name,
            group=group,
            iucn_status=self.iucn_status,
        )


@dataclass(frozen=True)
class RuntimeSpeciesGroupIndex:
    group: str
    grid: SparseMetadata
    cell_ids: np.ndarray
    offsets: np.ndarray
    species_metadata: tuple[RuntimeSpeciesMetadata, ...]
    cache_path: Path

    @property
    def species_count(self) -> int:
        return max(0, int(self.offsets.size) - 1)

    @property
    def cell_reference_count(self) -> int:
        return int(self.cell_ids.size)

    @property
    def memory_bytes(self) -> int:
        return int(self.offsets.nbytes)

    @property
    def decoded_cell_bytes(self) -> int:
        return int(self.cell_ids.nbytes)

    def count_overlaps(self, raster: SolutionRaster) -> int:
        return len(self.overlap_records(raster))

    def overlap_records(self, raster: SolutionRaster) -> list[SpeciesOverlapRecord]:
        selected_window = selected_window_for_species_grid(raster, self.grid, self.group)
        selected_cell_ids = np.flatnonzero(selected_window).astype(np.uint32, copy=False)
        if selected_cell_ids.size == 0:
            return []

        records: list[SpeciesOverlapRecord] = []
        for metadata, start, end in zip(
            self.species_metadata,
            self.offsets[:-1],
            self.offsets[1:],
        ):
            start_index = int(start)
            end_index = int(end)
            if start_index == end_index:
                continue
            if _sorted_cells_overlap(self.cell_ids[start_index:end_index], selected_cell_ids):
                records.append(metadata.overlap_record(self.group))
        return sort_species_records(records)


@dataclass(frozen=True)
class RuntimeSpeciesIndex:
    groups: dict[str, RuntimeSpeciesGroupIndex]
    cache_dir: Path

    @property
    def group_count(self) -> int:
        return len(self.groups)

    @property
    def species_count(self) -> int:
        return sum(group.species_count for group in self.groups.values())

    @property
    def cell_reference_count(self) -> int:
        return sum(group.cell_reference_count for group in self.groups.values())

    @property
    def memory_bytes(self) -> int:
        return sum(group.memory_bytes for group in self.groups.values())

    @property
    def decoded_cell_bytes(self) -> int:
        return sum(group.decoded_cell_bytes for group in self.groups.values())

    def count_overlaps(self, group: str, raster: SolutionRaster) -> int:
        group_index = self.groups.get(group)
        if group_index is None:
            raise SpeciesIndexQueryError(f"species_index_group_missing:{group}")
        return group_index.count_overlaps(raster)

    def overlap_records(self, group: str, raster: SolutionRaster) -> list[SpeciesOverlapRecord]:
        group_index = self.groups.get(group)
        if group_index is None:
            raise SpeciesIndexQueryError(f"species_index_group_missing:{group}")
        return group_index.overlap_records(raster)

    def entry_count(self, group: str) -> int:
        group_index = self.groups.get(group)
        if group_index is None:
            raise SpeciesIndexQueryError(f"species_index_group_missing:{group}")
        return group_index.species_count

    def metadata(self) -> dict[str, Any]:
        return {
            "status": "ready",
            "group_count": self.group_count,
            "species_count": self.species_count,
            "cell_reference_count": self.cell_reference_count,
            "memory_bytes": self.memory_bytes,
            "memory_mb": round(self.memory_bytes / (1024 * 1024), 3),
            "decoded_cell_bytes": self.decoded_cell_bytes,
            "decoded_cell_mb": round(self.decoded_cell_bytes / (1024 * 1024), 3),
            "storage": "memmap",
            "groups": {
                group: {
                    "species_count": group_index.species_count,
                    "cell_reference_count": group_index.cell_reference_count,
                    "memory_bytes": group_index.memory_bytes,
                    "decoded_cell_bytes": group_index.decoded_cell_bytes,
                    "cache_path": str(group_index.cache_path),
                }
                for group, group_index in sorted(self.groups.items())
            },
        }

    def close(self) -> None:
        for group_index in self.groups.values():
            try:
                group_index.cell_ids.flush()
                mmap = getattr(group_index.cell_ids, "_mmap", None)
                if mmap is not None:
                    mmap.close()
            except Exception:
                pass
        shutil.rmtree(self.cache_dir, ignore_errors=True)

    cleanup = close


@dataclass(frozen=True)
class RuntimeSpeciesBitsetIndex:
    metadata_document: SpeciesBitsetMetadata
    bits: np.memmap
    data_path: Path
    metadata_path: Path
    groups: dict[str, tuple[int, ...]]
    query_chunk_cells: int = 2048

    @property
    def species_count(self) -> int:
        return self.metadata_document.species_count

    @property
    def cell_reference_count(self) -> int:
        return sum(entry.range_cell_count for entry in self.metadata_document.species)

    def count_overlaps(self, group: str, raster: SolutionRaster) -> int:
        return len(self.overlap_records(group, raster))

    def overlap_records(
        self,
        group: str,
        raster: SolutionRaster,
    ) -> list[SpeciesOverlapRecord]:
        indices = self.groups.get(group)
        if indices is None:
            raise SpeciesIndexQueryError(f"species_index_group_missing:{group}")
        present = self._present_species(raster)
        records = [
            self._overlap_record(species_index)
            for species_index in indices
            if present[species_index]
        ]
        return sort_species_records(records)

    def all_overlap_records(self, raster: SolutionRaster) -> list[SpeciesOverlapRecord]:
        present = self._present_species(raster)
        return sort_species_records(
            [
                self._overlap_record(species_index)
                for species_index in np.flatnonzero(present)
            ]
        )

    def detailed_coverage_records(
        self,
        aoi_raster: SolutionRaster,
        solution_raster: SolutionRaster,
        is_cancelled: Callable[[], bool] | None = None,
        *,
        target_for_species: Callable[[str], float | None] | None = None,
    ) -> list[SpeciesCoverageRecord]:
        if not aoi_raster.fingerprint.matches(solution_raster.fingerprint):
            raise SpeciesIndexQueryError("solution_raster_grid_mismatch")

        grid = self.metadata_document.grid
        aoi_window = selected_window_for_species_grid(
            aoi_raster,
            grid,
            "cell-major",
        )
        solution_window = _array_window_for_species_grid(
            solution_raster.selected_mask,
            solution_raster,
            grid,
            "solution",
        )
        pre_existing_window = _array_window_for_species_grid(
            solution_raster.pre_existing_mask,
            solution_raster,
            grid,
            "solution",
        )
        new_window = _array_window_for_species_grid(
            solution_raster.new_prioritizr_mask,
            solution_raster,
            grid,
            "solution",
        )
        selected_cell_ids = np.flatnonzero(aoi_window).astype(np.uint32, copy=False)
        if selected_cell_ids.size == 0:
            return []

        row_offset, _ = _species_grid_offsets(aoi_raster, grid, "cell-major")
        local_rows = selected_cell_ids // grid.width
        weights = aoi_raster.pixel_area_km2_per_row[row_offset + local_rows]
        solution_selected = solution_window.ravel()[selected_cell_ids]
        pre_existing_selected = pre_existing_window.ravel()[selected_cell_ids]
        new_selected = new_window.ravel()[selected_cell_ids]

        areas = np.zeros((4, self.species_count), dtype=np.float64)
        cell_counts = np.zeros((2, self.species_count), dtype=np.float64)

        for start in range(0, selected_cell_ids.size, self.query_chunk_cells):
            if is_cancelled is not None and is_cancelled():
                raise SpeciesIndexQueryError("species_coverage_cancelled")
            end = min(start + self.query_chunk_cells, selected_cell_ids.size)
            chunk_ids = selected_cell_ids[start:end]
            presence = np.unpackbits(
                self.bits[chunk_ids],
                axis=1,
                count=self.species_count,
                bitorder="little",
            )
            chunk_weights = weights[start:end]
            coverage_weights = np.stack(
                (
                    chunk_weights,
                    chunk_weights * solution_selected[start:end],
                    chunk_weights * pre_existing_selected[start:end],
                    chunk_weights * new_selected[start:end],
                )
            )
            areas += coverage_weights @ presence
            cell_counts[0] += presence.sum(axis=0, dtype=np.int64)
            cell_counts[1] += (
                solution_selected[start:end].astype(np.float64, copy=False)
                @ presence
            )

        within_area, covered_area, pre_existing_area, new_area = areas
        within_cells, held_cells = cell_counts

        records: list[SpeciesCoverageRecord] = []
        present_species = np.flatnonzero(within_area > 0)
        for record_index, species_index in enumerate(present_species):
            if (
                is_cancelled is not None
                and record_index % 512 == 0
                and is_cancelled()
            ):
                raise SpeciesIndexQueryError("species_coverage_cancelled")
            entry = self.metadata_document.species[int(species_index)]
            # Presence is recorded for any positive overlap, so summing whole
            # cells overstates a range that only clips the cells it touches.
            # Rescaling by the species' mean cell coverage puts these areas on
            # the same scale as the national range they are reported against.
            density = entry.area_per_occupied_cell_area
            range_area = entry.range_area_km2
            # Each of these sums over a subset of the cells the next one out
            # sums over, so only float rounding across differing accumulation
            # orders can invert them. Holding the nesting keeps every reported
            # percentage at or below 100.
            within = min(float(within_area[species_index]) * density, range_area)
            covered = min(float(covered_area[species_index]) * density, within)
            pre_existing = min(float(pre_existing_area[species_index]) * density, within)
            new = min(float(new_area[species_index]) * density, within)
            target = (
                target_for_species(entry.scientific_name)
                if target_for_species is not None
                else None
            )
            total_in_aoi = float(within_cells[species_index])
            held_in_aoi = float(held_cells[species_index])
            national_total = float(entry.range_cell_count)
            mesa_row = (
                mesa_aoi_coverage_row(
                    feature=entry.scientific_name,
                    total_amount_aoi=total_in_aoi,
                    absolute_held_aoi=held_in_aoi,
                    national_total=national_total,
                    national_target=target,
                )
                if target is not None
                else None
            )
            records.append(
                SpeciesCoverageRecord(
                    id=species_dataset_id(entry.scientific_name),
                    scientific_name=entry.scientific_name,
                    group=entry.group,
                    iucn_status=entry.iucn_status,
                    range_area_km2=range_area,
                    range_in_aoi_area_km2=within,
                    range_in_aoi_pct=_percentage(within, range_area),
                    solution_covered_in_aoi_area_km2=covered,
                    solution_covered_in_aoi_pct=_percentage(covered, within),
                    pre_existing_covered_in_aoi_area_km2=pre_existing,
                    pre_existing_covered_in_aoi_pct=_percentage(pre_existing, within),
                    new_covered_in_aoi_area_km2=new,
                    new_covered_in_aoi_pct=_percentage(new, within),
                    total_in_aoi=total_in_aoi,
                    held_in_aoi=held_in_aoi,
                    coverage_within_aoi=_ratio(held_in_aoi, total_in_aoi),
                    contribution_to_national_coverage=_ratio(
                        held_in_aoi,
                        national_total,
                    ),
                    contribution_to_national_target=(
                        mesa_row.contribution_to_national_target
                        if mesa_row is not None
                        else None
                    ),
                )
            )
        records.sort(
            key=lambda record: (
                normalize_species_name(record.scientific_name),
                record.id,
            )
        )
        return records

    def entry_count(self, group: str) -> int:
        indices = self.groups.get(group)
        if indices is None:
            raise SpeciesIndexQueryError(f"species_index_group_missing:{group}")
        return len(indices)

    def metadata(self) -> dict[str, Any]:
        return {
            "status": "ready",
            "format": BITSET_FORMAT,
            "range_area_source": self.metadata_document.range_area_source,
            "species_count": self.species_count,
            "cell_count": self.metadata_document.cell_count,
            "cell_reference_count": self.cell_reference_count,
            "data_bytes": int(self.bits.nbytes),
            "data_mb": round(self.bits.nbytes / (1024 * 1024), 3),
            "storage": "memmap",
            "groups": {
                group: {"species_count": len(indices)}
                for group, indices in sorted(self.groups.items())
            },
        }

    def close(self) -> None:
        mmap = getattr(self.bits, "_mmap", None)
        if mmap is not None:
            mmap.close()

    cleanup = close

    def _present_species(self, raster: SolutionRaster) -> np.ndarray:
        selected_window = selected_window_for_species_grid(
            raster,
            self.metadata_document.grid,
            "cell-major",
        )
        selected_cell_ids = np.flatnonzero(selected_window).astype(
            np.uint32,
            copy=False,
        )
        packed = np.zeros(self.metadata_document.bytes_per_cell, dtype=np.uint8)
        for start in range(0, selected_cell_ids.size, self.query_chunk_cells):
            chunk = selected_cell_ids[start : start + self.query_chunk_cells]
            if chunk.size:
                packed |= np.bitwise_or.reduce(self.bits[chunk], axis=0)
        return np.unpackbits(
            packed,
            count=self.species_count,
            bitorder="little",
        ).astype(bool, copy=False)

    def _overlap_record(self, species_index: int) -> SpeciesOverlapRecord:
        entry = self.metadata_document.species[int(species_index)]
        return SpeciesOverlapRecord(
            id=species_dataset_id(entry.scientific_name),
            scientific_name=entry.scientific_name,
            group=entry.group,
            iucn_status=entry.iucn_status,
        )


def load_runtime_species_index(matrices: dict[str, Any]) -> RuntimeSpeciesIndex:
    cache_dir = Path(tempfile.mkdtemp(prefix="dmt-species-index-"))
    groups: dict[str, RuntimeSpeciesGroupIndex] = {}
    try:
        for group, matrix in matrices.items():
            groups[group] = _load_species_group_index(group, Path(matrix.path), cache_dir)
        return RuntimeSpeciesIndex(groups=groups, cache_dir=cache_dir)
    except Exception:
        shutil.rmtree(cache_dir, ignore_errors=True)
        raise


def load_runtime_species_bitset_index(
    data_path: Path,
    metadata_path: Path,
) -> RuntimeSpeciesBitsetIndex:
    try:
        metadata = load_species_bitset_metadata(metadata_path)
        if data_path.stat().st_size != metadata.expected_data_bytes:
            raise SpeciesIndexLoadError(
                "species_bitset_data_size_mismatch"
            )
        bits = np.memmap(
            data_path,
            dtype=np.uint8,
            mode="r",
            shape=(metadata.cell_count, metadata.bytes_per_cell),
        )
        groups: dict[str, list[int]] = {"threatened": []}
        for index, entry in enumerate(metadata.species):
            groups.setdefault(entry.group, []).append(index)
            if entry.iucn_status.upper() in {"CR", "EN", "VU"}:
                groups.setdefault("threatened", []).append(index)
        return RuntimeSpeciesBitsetIndex(
            metadata_document=metadata,
            bits=bits,
            data_path=data_path,
            metadata_path=metadata_path,
            groups={
                group: tuple(indices)
                for group, indices in groups.items()
            },
        )
    except (OSError, SparseFormatError, ValueError) as exc:
        if isinstance(exc, SpeciesIndexLoadError):
            raise
        raise SpeciesIndexLoadError(f"species_bitset_load_failed:{exc}") from exc


def normalize_species_name(name: str) -> str:
    return " ".join(unicodedata.normalize("NFKC", name).casefold().split())


def species_dataset_id(scientific_name: str) -> str:
    digest = hashlib.sha256(normalize_species_name(scientific_name).encode("utf-8")).hexdigest()
    return f"species:v1:{digest}"


def sort_species_records(records: list[SpeciesOverlapRecord]) -> list[SpeciesOverlapRecord]:
    return sorted(
        records,
        key=lambda record: (normalize_species_name(record.scientific_name), record.id),
    )


def stream_species_overlap_records(
    matrix: Any,
    raster: SolutionRaster,
) -> list[SpeciesOverlapRecord]:
    group = str(matrix.group)
    try:
        with gzip.open(Path(matrix.path), "rb") as handle:
            header = handle.read(8)
            if len(header) < 8 or header[:4] != SMSP_MAGIC:
                raise SparseFormatError(f"bad species matrix magic for {group}")
            toc_length = struct.unpack_from("<I", header, 4)[0]
            toc = json.loads(handle.read(toc_length).decode("utf-8"))
            grid = _species_grid_from_toc(toc, group)
            selected_window = selected_window_for_species_grid(raster, grid, group).ravel()
            records: list[SpeciesOverlapRecord] = []
            cursor = 0
            for entry in toc.get("species") or []:
                offset = int(entry["offset"])
                cell_count = int(entry["count"])
                if offset != cursor:
                    raise SparseFormatError(
                        f"species matrix {group} has non-sequential body offset"
                    )
                chunk = handle.read(cell_count * 4)
                if len(chunk) != cell_count * 4:
                    raise SparseFormatError(f"species matrix {group} body ended early")
                decoded = np.cumsum(np.frombuffer(chunk, dtype=np.uint32), dtype=np.uint32)
                if decoded.size and bool(selected_window[decoded].any()):
                    metadata = RuntimeSpeciesMetadata(
                        scientific_name=str(entry["name"]),
                        iucn_status=str(entry.get("iucn") or ""),
                        csv_class=str(entry.get("class") or ""),
                    )
                    records.append(metadata.overlap_record(group))
                cursor += len(chunk)
            return sort_species_records(records)
    except (OSError, json.JSONDecodeError, KeyError, UnicodeDecodeError, SparseFormatError) as exc:
        raise SpeciesIndexQueryError(f"species_matrix_load_failed:{group}") from exc


def selected_window_for_species_grid(
    raster: SolutionRaster,
    grid: SparseMetadata,
    group: str,
) -> np.ndarray:
    return _array_window_for_species_grid(
        raster.selected_mask,
        raster,
        grid,
        group,
    )


def _array_window_for_species_grid(
    values: np.ndarray,
    raster: SolutionRaster,
    grid: SparseMetadata,
    group: str,
) -> np.ndarray:
    row_offset, col_offset = _species_grid_offsets(raster, grid, group)
    row_end = row_offset + grid.height
    col_end = col_offset + grid.width
    return values[row_offset:row_end, col_offset:col_end]


def _species_grid_offsets(
    raster: SolutionRaster,
    grid: SparseMetadata,
    group: str,
) -> tuple[int, int]:
    sol_a, sol_b, sol_c, sol_d, sol_e, sol_f = raster.fingerprint.transform
    if (
        abs(grid.x_scale - sol_a) > 1e-6
        or abs(grid.y_scale - sol_e) > 1e-6
        or abs(sol_b) > 1e-9
        or abs(sol_d) > 1e-9
    ):
        raise SpeciesIndexQueryError(f"species_matrix_grid_mismatch:{group}")

    if grid.crs and raster.fingerprint.crs and str(grid.crs) != str(raster.fingerprint.crs):
        raise SpeciesIndexQueryError(f"species_matrix_crs_mismatch:{group}")

    col_offset = round((grid.x_origin - sol_c) / sol_a)
    row_offset = round((grid.y_origin - sol_f) / sol_e)
    row_end = row_offset + grid.height
    col_end = col_offset + grid.width
    if (
        row_offset < 0
        or col_offset < 0
        or row_end > raster.selected_mask.shape[0]
        or col_end > raster.selected_mask.shape[1]
    ):
        raise SpeciesIndexQueryError(f"species_matrix_outside_reference_grid:{group}")

    return row_offset, col_offset


def _load_species_group_index(
    group: str,
    path: Path,
    cache_dir: Path,
) -> RuntimeSpeciesGroupIndex:
    try:
        with gzip.open(path, "rb") as handle:
            header = handle.read(8)
            if len(header) < 8 or header[:4] != SMSP_MAGIC:
                raise SparseFormatError(f"bad species matrix magic for {group}")
            toc_length = struct.unpack_from("<I", header, 4)[0]
            toc = json.loads(handle.read(toc_length).decode("utf-8"))
            grid = _species_grid_from_toc(toc, group)
            species_entries = toc.get("species") or []
            total_cell_references = sum(int(entry["count"]) for entry in species_entries)
            species_metadata = tuple(
                RuntimeSpeciesMetadata(
                    scientific_name=str(entry["name"]),
                    iucn_status=str(entry.get("iucn") or ""),
                    csv_class=str(entry.get("class") or ""),
                )
                for entry in species_entries
            )
            offsets = np.empty(len(species_entries) + 1, dtype=np.uint64)
            offsets[0] = 0
            cache_path = cache_dir / f"{group}.uint32"
            cell_ids = np.memmap(
                cache_path,
                dtype=np.uint32,
                mode="w+",
                shape=(total_cell_references,),
            )

            cursor = 0
            cell_cursor = 0
            for index, entry in enumerate(species_entries):
                offset = int(entry["offset"])
                cell_count = int(entry["count"])
                if offset != cursor:
                    raise SparseFormatError(
                        f"species matrix {group} has non-sequential body offset"
                    )
                chunk = handle.read(cell_count * 4)
                if len(chunk) != cell_count * 4:
                    raise SparseFormatError(f"species matrix {group} body ended early")
                _decode_species_cell_ids(chunk, cell_ids[cell_cursor : cell_cursor + cell_count])
                cell_cursor += cell_count
                offsets[index + 1] = cell_cursor
                cursor += len(chunk)
            cell_ids.flush()

            return RuntimeSpeciesGroupIndex(
                group=group,
                grid=grid,
                cell_ids=cell_ids,
                offsets=offsets,
                species_metadata=species_metadata,
                cache_path=cache_path,
            )
    except (OSError, json.JSONDecodeError, KeyError, UnicodeDecodeError, SparseFormatError) as exc:
        raise SpeciesIndexLoadError(f"species_matrix_load_failed:{group}") from exc


def _species_grid_from_toc(toc: dict[str, Any], group: str) -> SparseMetadata:
    grid_raw = toc.get("grid")
    if not isinstance(grid_raw, dict):
        raise SparseFormatError(f"species matrix {group} is missing grid metadata")
    grid_with_count = dict(grid_raw)
    grid_with_count.setdefault("count", 0)
    return SparseMetadata.from_json(grid_with_count)


def _decode_species_cell_ids(chunk: bytes, out: np.ndarray) -> None:
    if not chunk:
        return
    deltas = np.frombuffer(chunk, dtype=np.uint32)
    np.cumsum(deltas, dtype=np.uint32, out=out)


def _sorted_cells_overlap(cell_ids: np.ndarray, selected_cell_ids: np.ndarray) -> bool:
    if cell_ids.size == 0 or selected_cell_ids.size == 0:
        return False

    if selected_cell_ids.size <= cell_ids.size:
        positions = np.searchsorted(cell_ids, selected_cell_ids)
        valid = positions < cell_ids.size
        return bool(valid.any() and np.any(cell_ids[positions[valid]] == selected_cell_ids[valid]))

    positions = np.searchsorted(selected_cell_ids, cell_ids)
    valid = positions < selected_cell_ids.size
    return bool(valid.any() and np.any(selected_cell_ids[positions[valid]] == cell_ids[valid]))


def _percentage(numerator: float, denominator: float) -> float:
    if denominator <= 0:
        return 0.0
    return (numerator / denominator) * 100.0


def _ratio(numerator: float, denominator: float) -> float:
    if denominator <= 0:
        return 0.0
    return numerator / denominator
