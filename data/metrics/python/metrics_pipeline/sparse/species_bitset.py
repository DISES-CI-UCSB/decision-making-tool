"""Cell-major species bitset artifact format and streaming builder.

Each grid cell owns one fixed-width bit row. Bit ``n`` indicates that species
``n`` has modeled range in that cell. The layout supports fast AOI queries
without loading the species-major sparse matrices at runtime.

Two areas are recorded per species and they are not interchangeable.
``range_cell_area_km2`` totals the whole cells the species occupies, which is
the only quantity a presence bitset can reconstruct at query time.
``range_area_km2`` is the true range area, taken from the source matrix when
it carries one. Presence is emitted for any positive overlap, so a range that
threads through partially covered cells occupies far more cell area than it
truly covers; reporting the cell total as the range would overstate small
ranges badly. Runtime callers scale cell-derived AOI areas by the ratio of the
two so that everything they report shares the true-area scale.
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


FORMAT = "species-cell-bitset/v2"
BIT_ORDER = "little"
EARTH_RADIUS_KM = 6371.0088

RANGE_AREA_SOURCE_EXACT = "matrix-exact-area"
RANGE_AREA_SOURCE_CELL_COUNT = "cell-count"


@dataclass(frozen=True)
class SpeciesBitsetEntry:
    scientific_name: str
    group: str
    iucn_status: str
    csv_class: str
    range_cell_count: int
    range_cell_area_km2: float
    range_area_km2: float

    @property
    def area_per_occupied_cell_area(self) -> float:
        """True range area as a fraction of the cell area it is spread across."""
        if self.range_cell_area_km2 <= 0:
            return 0.0
        return self.range_area_km2 / self.range_cell_area_km2


@dataclass(frozen=True)
class SpeciesBitsetMetadata:
    grid: SparseMetadata
    species: tuple[SpeciesBitsetEntry, ...]
    bytes_per_cell: int
    range_area_source: str

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
            "range_area_source": self.range_area_source,
            "grid": grid,
            "species": [
                {
                    "scientific_name": entry.scientific_name,
                    "group": entry.group,
                    "iucn_status": entry.iucn_status,
                    "class": entry.csv_class,
                    "range_cell_count": entry.range_cell_count,
                    "range_cell_area_km2": entry.range_cell_area_km2,
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

    headers, grid, bytes_per_cell = _read_matrix_set(matrix_paths)
    range_area_source = _range_area_source(headers)
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
    entries: list[SpeciesBitsetEntry] = []

    try:
        for species_index, (cell_ids, entry) in enumerate(_iter_species_entries(headers, grid)):
            bitset[cell_ids, species_index // 8] |= np.uint8(1 << (species_index % 8))
            entries.append(entry)

        bitset.flush()
        metadata = SpeciesBitsetMetadata(
            grid=grid,
            species=tuple(entries),
            bytes_per_cell=bytes_per_cell,
            range_area_source=range_area_source,
        )
        _write_metadata(metadata_tmp, metadata, data_path.name)
    except Exception:
        del bitset
        data_tmp.unlink(missing_ok=True)
        metadata_tmp.unlink(missing_ok=True)
        raise

    del bitset
    data_tmp.replace(data_path)
    metadata_tmp.replace(metadata_path)
    return metadata


def rebuild_species_bitset_metadata(
    matrix_paths: dict[str, Path],
    data_path: Path,
    metadata_path: Path,
) -> SpeciesBitsetMetadata:
    """Rewrite the sidecar metadata against a bit plane that is already correct.

    Presence bits are a function of the cell IDs alone, so a change confined to
    the metadata does not justify rewriting a multi-gigabyte data file. The
    shape implied by the matrices is checked against the existing file so a bit
    plane built from a different species set cannot be adopted by mistake.
    """

    headers, grid, bytes_per_cell = _read_matrix_set(matrix_paths)
    range_area_source = _range_area_source(headers)
    metadata = SpeciesBitsetMetadata(
        grid=grid,
        species=tuple(entry for _, entry in _iter_species_entries(headers, grid)),
        bytes_per_cell=bytes_per_cell,
        range_area_source=range_area_source,
    )
    if data_path.stat().st_size != metadata.expected_data_bytes:
        raise SparseFormatError(
            f"species bitset {data_path.name} holds {data_path.stat().st_size} bytes but "
            f"the matrices imply {metadata.expected_data_bytes}"
        )

    metadata_tmp = metadata_path.with_name(f".{metadata_path.name}.tmp")
    _write_metadata(metadata_tmp, metadata, data_path.name)
    metadata_tmp.replace(metadata_path)
    return metadata


def _read_matrix_set(
    matrix_paths: dict[str, Path],
) -> tuple[tuple[_MatrixHeader, ...], SparseMetadata, int]:
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
    return headers, grid, math.ceil(species_count / 8)


def _iter_species_entries(
    headers: tuple[_MatrixHeader, ...],
    grid: SparseMetadata,
) -> Iterator[tuple[np.ndarray, SpeciesBitsetEntry]]:
    cell_count = grid.width * grid.height
    row_areas = pixel_area_km2_per_row(grid)
    for header in headers:
        for toc_entry, cell_ids in _iter_matrix_species(header):
            if cell_ids.size and int(cell_ids[-1]) >= cell_count:
                raise SparseFormatError(
                    f"species {toc_entry['name']!r} contains a cell outside its grid"
                )
            range_cell_area_km2 = float(row_areas[cell_ids // grid.width].sum())
            exact_area_km2 = toc_entry.get("area_km2")
            yield cell_ids, SpeciesBitsetEntry(
                scientific_name=str(toc_entry["name"]),
                group=header.group,
                iucn_status=str(toc_entry.get("iucn") or ""),
                csv_class=str(toc_entry.get("class") or ""),
                range_cell_count=int(cell_ids.size),
                range_cell_area_km2=range_cell_area_km2,
                range_area_km2=(
                    range_cell_area_km2 if exact_area_km2 is None else float(exact_area_km2)
                ),
            )


def _range_area_source(headers: tuple[_MatrixHeader, ...]) -> str:
    """Decide whether the bundles carry exact areas, refusing a partial set."""
    declared = sum(
        1
        for header in headers
        for entry in header.species
        if entry.get("area_km2") is not None
    )
    total = sum(len(header.species) for header in headers)
    if declared == 0:
        return RANGE_AREA_SOURCE_CELL_COUNT
    if declared != total:
        raise SparseFormatError(
            f"{declared} of {total} species declare an exact range area; refusing to "
            "mix exact and cell-derived areas"
        )
    return RANGE_AREA_SOURCE_EXACT


def _write_metadata(
    path: Path,
    metadata: SpeciesBitsetMetadata,
    data_filename: str,
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            metadata.to_json(data_filename=data_filename),
            indent=2,
            ensure_ascii=False,
        )
        + "\n",
        encoding="utf-8",
    )


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
                range_cell_area_km2=float(entry["range_cell_area_km2"]),
                range_area_km2=float(entry["range_area_km2"]),
            )
            for entry in raw["species"]
        )
        metadata = SpeciesBitsetMetadata(
            grid=grid,
            species=species,
            bytes_per_cell=int(raw["bytes_per_cell"]),
            range_area_source=str(raw["range_area_source"]),
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
