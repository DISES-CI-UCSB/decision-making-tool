"""Cell-major species bitset artifact format and streaming builder.

Each grid cell owns one fixed-width bit row. Bit ``n`` indicates that species
``n`` has modeled range in that cell. The layout supports fast AOI queries
without loading the species-major sparse matrices at runtime.
"""

from __future__ import annotations

import gzip
import json
import math
import struct
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator

import numpy as np
from rasterio.crs import CRS

from sparse.format import SMSP_MAGIC, SparseFormatError, SparseMetadata


FORMAT = "species-cell-bitset/v1"
BIT_ORDER = "little"
EARTH_RADIUS_KM = 6371.0088


@dataclass(frozen=True)
class SpeciesBitsetEntry:
    scientific_name: str
    group: str
    iucn_status: str
    csv_class: str
    range_cell_count: int
    range_area_km2: float


@dataclass(frozen=True)
class SpeciesBitsetMetadata:
    grid: SparseMetadata
    species: tuple[SpeciesBitsetEntry, ...]
    bytes_per_cell: int

    @property
    def species_count(self) -> int:
        return len(self.species)

    @property
    def cell_count(self) -> int:
        return self.grid.width * self.grid.height

    @property
    def expected_data_bytes(self) -> int:
        return self.cell_count * self.bytes_per_cell

    def to_json(self, *, data_filename: str) -> dict[str, object]:
        grid = self.grid.to_json()
        grid.pop("count", None)
        return {
            "format": FORMAT,
            "bit_order": BIT_ORDER,
            "data_file": data_filename,
            "species_count": self.species_count,
            "bytes_per_cell": self.bytes_per_cell,
            "grid": grid,
            "species": [
                {
                    "scientific_name": entry.scientific_name,
                    "group": entry.group,
                    "iucn_status": entry.iucn_status,
                    "class": entry.csv_class,
                    "range_cell_count": entry.range_cell_count,
                    "range_area_km2": entry.range_area_km2,
                }
                for entry in self.species
            ],
        }


@dataclass(frozen=True)
class _MatrixHeader:
    group: str
    path: Path
    grid: SparseMetadata
    species: tuple[dict[str, object], ...]


def build_species_bitset(
    matrix_paths: dict[str, Path],
    data_path: Path,
    metadata_path: Path,
) -> SpeciesBitsetMetadata:
    """Build a deterministic cell-major bitset from five taxonomic bundles."""

    if not matrix_paths:
        raise SparseFormatError("species bitset requires at least one matrix")

    headers = tuple(
        _read_matrix_header(group, path)
        for group, path in sorted(matrix_paths.items())
    )
    grid = headers[0].grid
    for header in headers[1:]:
        if _grid_identity(header.grid) != _grid_identity(grid):
            raise SparseFormatError(
                f"species matrix grid mismatch: {headers[0].group} and {header.group}"
            )

    species_count = sum(len(header.species) for header in headers)
    bytes_per_cell = math.ceil(species_count / 8)
    cell_count = grid.width * grid.height
    data_path.parent.mkdir(parents=True, exist_ok=True)
    metadata_path.parent.mkdir(parents=True, exist_ok=True)
    data_tmp = data_path.with_name(f".{data_path.name}.tmp")
    metadata_tmp = metadata_path.with_name(f".{metadata_path.name}.tmp")

    bitset = np.memmap(
        data_tmp,
        dtype=np.uint8,
        mode="w+",
        shape=(cell_count, bytes_per_cell),
    )
    bitset[:] = 0
    row_areas = pixel_area_km2_per_row(grid)
    entries: list[SpeciesBitsetEntry] = []

    try:
        species_index = 0
        for header in headers:
            for toc_entry, cell_ids in _iter_matrix_species(header):
                if cell_ids.size and int(cell_ids[-1]) >= cell_count:
                    raise SparseFormatError(
                        f"species {toc_entry['name']!r} contains a cell outside its grid"
                    )
                byte_index = species_index // 8
                bit_mask = np.uint8(1 << (species_index % 8))
                bitset[cell_ids, byte_index] |= bit_mask
                rows = cell_ids // grid.width
                range_area_km2 = float(row_areas[rows].sum())
                entries.append(
                    SpeciesBitsetEntry(
                        scientific_name=str(toc_entry["name"]),
                        group=header.group,
                        iucn_status=str(toc_entry.get("iucn") or ""),
                        csv_class=str(toc_entry.get("class") or ""),
                        range_cell_count=int(cell_ids.size),
                        range_area_km2=range_area_km2,
                    )
                )
                species_index += 1

        bitset.flush()
        metadata = SpeciesBitsetMetadata(
            grid=grid,
            species=tuple(entries),
            bytes_per_cell=bytes_per_cell,
        )
        metadata_tmp.write_text(
            json.dumps(
                metadata.to_json(data_filename=data_path.name),
                indent=2,
                ensure_ascii=False,
            )
            + "\n",
            encoding="utf-8",
        )
    except Exception:
        del bitset
        data_tmp.unlink(missing_ok=True)
        metadata_tmp.unlink(missing_ok=True)
        raise

    del bitset
    data_tmp.replace(data_path)
    metadata_tmp.replace(metadata_path)
    return metadata


def load_species_bitset_metadata(path: Path) -> SpeciesBitsetMetadata:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
        if raw.get("format") != FORMAT:
            raise SparseFormatError("unsupported species bitset format")
        if raw.get("bit_order") != BIT_ORDER:
            raise SparseFormatError("unsupported species bit order")
        grid_raw = dict(raw["grid"])
        grid_raw["count"] = 0
        grid = SparseMetadata.from_json(grid_raw)
        species = tuple(
            SpeciesBitsetEntry(
                scientific_name=str(entry["scientific_name"]),
                group=str(entry["group"]),
                iucn_status=str(entry.get("iucn_status") or ""),
                csv_class=str(entry.get("class") or ""),
                range_cell_count=int(entry["range_cell_count"]),
                range_area_km2=float(entry["range_area_km2"]),
            )
            for entry in raw["species"]
        )
        metadata = SpeciesBitsetMetadata(
            grid=grid,
            species=species,
            bytes_per_cell=int(raw["bytes_per_cell"]),
        )
    except (OSError, json.JSONDecodeError, KeyError, TypeError, ValueError) as exc:
        if isinstance(exc, SparseFormatError):
            raise
        raise SparseFormatError(f"invalid species bitset metadata: {exc}") from exc

    expected_bytes_per_cell = math.ceil(metadata.species_count / 8)
    if metadata.bytes_per_cell != expected_bytes_per_cell:
        raise SparseFormatError(
            "species bitset bytes_per_cell does not match species_count"
        )
    return metadata


def pixel_area_km2_per_row(grid: SparseMetadata) -> np.ndarray:
    if not grid.crs:
        raise SparseFormatError("species bitset grid has no CRS")
    crs = CRS.from_string(grid.crs)
    pixel_width = abs(grid.x_scale)
    pixel_height = abs(grid.y_scale)
    if crs.is_geographic:
        km_per_degree = (math.pi / 180.0) * EARTH_RADIUS_KM
        row_indices = np.arange(grid.height)
        latitudes = grid.y_origin + grid.y_scale * (row_indices + 0.5)
        return (
            pixel_width
            * km_per_degree
            * np.cos(np.deg2rad(latitudes))
            * pixel_height
            * km_per_degree
        )

    units = (crs.linear_units or "").lower()
    if units in {"metre", "meter", "m"}:
        area = (pixel_width * pixel_height) / 1_000_000.0
    elif units in {"kilometre", "kilometer", "km"}:
        area = pixel_width * pixel_height
    else:
        raise SparseFormatError(
            f"unsupported species bitset CRS unit: {crs.linear_units}"
        )
    return np.full(grid.height, area, dtype=np.float64)


def _read_matrix_header(group: str, path: Path) -> _MatrixHeader:
    try:
        with gzip.open(path, "rb") as handle:
            magic = handle.read(4)
            if magic != SMSP_MAGIC:
                raise SparseFormatError(f"bad species matrix magic for {group}")
            toc_length_raw = handle.read(4)
            if len(toc_length_raw) != 4:
                raise SparseFormatError(f"truncated species matrix header for {group}")
            toc_length = struct.unpack("<I", toc_length_raw)[0]
            toc = json.loads(handle.read(toc_length).decode("utf-8"))
    except (OSError, json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise SparseFormatError(f"species matrix header failed for {group}: {exc}") from exc

    grid_raw = dict(toc["grid"])
    grid_raw["count"] = 0
    return _MatrixHeader(
        group=group,
        path=path,
        grid=SparseMetadata.from_json(grid_raw),
        species=tuple(toc.get("species") or ()),
    )


def _iter_matrix_species(
    header: _MatrixHeader,
) -> Iterator[tuple[dict[str, object], np.ndarray]]:
    with gzip.open(header.path, "rb") as handle:
        handle.read(4)
        toc_length = struct.unpack("<I", handle.read(4))[0]
        handle.read(toc_length)
        cursor = 0
        for entry in header.species:
            offset = int(entry["offset"])
            count = int(entry["count"])
            if offset != cursor:
                raise SparseFormatError(
                    f"species matrix {header.group} has non-sequential offsets"
                )
            chunk = handle.read(count * 4)
            if len(chunk) != count * 4:
                raise SparseFormatError(
                    f"species matrix {header.group} ended before {entry['name']!r}"
                )
            cell_ids = np.cumsum(
                np.frombuffer(chunk, dtype=np.uint32),
                dtype=np.uint32,
            )
            cursor += len(chunk)
            yield entry, cell_ids


def _grid_identity(grid: SparseMetadata) -> tuple[object, ...]:
    return (
        grid.width,
        grid.height,
        grid.x_origin,
        grid.y_origin,
        grid.x_scale,
        grid.y_scale,
        grid.crs,
    )
