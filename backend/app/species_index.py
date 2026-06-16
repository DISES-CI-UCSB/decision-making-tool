from __future__ import annotations

import gzip
import json
import os
import shutil
import struct
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

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
from sparse.format import SMSP_MAGIC, SparseFormatError, SparseMetadata  # noqa: E402


class SpeciesIndexLoadError(ValueError):
    pass


class SpeciesIndexQueryError(ValueError):
    pass


@dataclass(frozen=True)
class RuntimeSpeciesGroupIndex:
    group: str
    grid: SparseMetadata
    cell_ids: np.ndarray
    offsets: np.ndarray
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
        selected_window = selected_window_for_species_grid(raster, self.grid, self.group)
        selected_cell_ids = np.flatnonzero(selected_window).astype(np.uint32, copy=False)
        if selected_cell_ids.size == 0:
            return 0

        present_count = 0
        for start, end in zip(self.offsets[:-1], self.offsets[1:]):
            start_index = int(start)
            end_index = int(end)
            if start_index == end_index:
                continue
            if _sorted_cells_overlap(self.cell_ids[start_index:end_index], selected_cell_ids):
                present_count += 1
        return present_count


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


def selected_window_for_species_grid(
    raster: SolutionRaster,
    grid: SparseMetadata,
    group: str,
) -> np.ndarray:
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

    return raster.selected_mask[row_offset:row_end, col_offset:col_end].ravel()


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
