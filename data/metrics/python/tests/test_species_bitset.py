from __future__ import annotations

from pathlib import Path

import numpy as np

import pytest

from sparse.format import (
    SparseFormatError,
    SparseMetadata,
    SpeciesMatrixEntry,
    encode_species_matrix,
)
from sparse.species_bitset import (
    RANGE_AREA_SOURCE_CELL_COUNT,
    RANGE_AREA_SOURCE_EXACT,
    build_species_bitset,
    load_species_bitset_metadata,
    rebuild_species_bitset_metadata,
)

GRID = SparseMetadata(
    width=3,
    height=2,
    x_origin=0,
    y_origin=2000,
    x_scale=1000,
    y_scale=-1000,
    nodata=255,
    crs="EPSG:3857",
    count=0,
)


def test_species_bitset_builds_cell_major_rows_and_range_denominators(
    tmp_path: Path,
) -> None:
    grid = GRID
    mammals = _write_matrix(
        tmp_path / "mammals.smtx.gz",
        grid,
        [
            ("Jaguar", "NT", "Mammalia", [0, 3]),
            ("Tapir", "VU", "Mammalia", [1]),
        ],
    )
    birds = _write_matrix(
        tmp_path / "birds.smtx.gz",
        grid,
        [("Condor", "VU", "Aves", [0, 1, 5])],
    )
    data_path = tmp_path / "species.cells.bits"
    metadata_path = tmp_path / "species.cells.json"

    built = build_species_bitset(
        {"mammals": mammals, "birds": birds},
        data_path,
        metadata_path,
    )
    loaded = load_species_bitset_metadata(metadata_path)
    rows = np.memmap(
        data_path,
        dtype=np.uint8,
        mode="r",
        shape=(loaded.cell_count, loaded.bytes_per_cell),
    )
    unpacked = np.unpackbits(rows, axis=1, count=loaded.species_count, bitorder="little")

    assert built == loaded
    assert [entry.scientific_name for entry in loaded.species] == [
        "Condor",
        "Jaguar",
        "Tapir",
    ]
    assert unpacked.tolist() == [
        [1, 1, 0],
        [1, 0, 1],
        [0, 0, 0],
        [0, 1, 0],
        [0, 0, 0],
        [1, 0, 0],
    ]
    assert [entry.range_area_km2 for entry in loaded.species] == [3.0, 2.0, 1.0]
    assert loaded.range_area_source == RANGE_AREA_SOURCE_CELL_COUNT
    assert data_path.stat().st_size == loaded.expected_data_bytes


def test_matrix_exact_area_beats_the_cell_total_for_a_partially_covered_range(
    tmp_path: Path,
) -> None:
    """A thin range touches whole cells it barely covers; the cells must not
    become its area."""
    matrix = _write_matrix(
        tmp_path / "birds.smtx.gz",
        GRID,
        [("Coastal wader", "LC", "Aves", [0, 1, 2, 3], 0.44)],
    )

    built = build_species_bitset(
        {"birds": matrix},
        tmp_path / "species.cells.bits",
        tmp_path / "species.cells.json",
    )

    entry = built.species[0]
    assert entry.range_cell_count == 4
    assert entry.range_cell_area_km2 == pytest.approx(4.0)
    assert entry.range_area_km2 == pytest.approx(0.44)
    assert entry.area_per_occupied_cell_area == pytest.approx(0.11)
    assert built.range_area_source == RANGE_AREA_SOURCE_EXACT


def test_partially_declared_exact_areas_fail_closed(tmp_path: Path) -> None:
    matrix = _write_matrix(
        tmp_path / "birds.smtx.gz",
        GRID,
        [("With area", "LC", "Aves", [0], 0.25), ("Without area", "LC", "Aves", [1], None)],
    )

    with pytest.raises(SparseFormatError, match="mix exact and cell-derived"):
        build_species_bitset(
            {"birds": matrix},
            tmp_path / "species.cells.bits",
            tmp_path / "species.cells.json",
        )


def test_metadata_only_rebuild_refreshes_areas_without_touching_the_bit_plane(
    tmp_path: Path,
) -> None:
    rows: list[tuple[str, str, str, list[int], float | None]] = [
        ("Coastal wader", "LC", "Aves", [0, 1, 2, 3], None)
    ]
    matrix = tmp_path / "birds.smtx.gz"
    _write_matrix(matrix, GRID, rows)
    data_path = tmp_path / "species.cells.bits"
    metadata_path = tmp_path / "species.cells.json"
    build_species_bitset({"birds": matrix}, data_path, metadata_path)
    original_bits = data_path.read_bytes()

    _write_matrix(matrix, GRID, [(*rows[0][:4], 0.44)])
    rebuilt = rebuild_species_bitset_metadata({"birds": matrix}, data_path, metadata_path)

    assert data_path.read_bytes() == original_bits
    assert rebuilt == load_species_bitset_metadata(metadata_path)
    assert rebuilt.species[0].range_area_km2 == pytest.approx(0.44)


def test_metadata_only_rebuild_rejects_a_bit_plane_of_the_wrong_shape(
    tmp_path: Path,
) -> None:
    matrix = _write_matrix(
        tmp_path / "birds.smtx.gz",
        GRID,
        [("Coastal wader", "LC", "Aves", [0], 0.25)],
    )
    data_path = tmp_path / "species.cells.bits"
    data_path.write_bytes(b"\x00" * 3)

    with pytest.raises(SparseFormatError, match="the matrices imply"):
        rebuild_species_bitset_metadata(
            {"birds": matrix},
            data_path,
            tmp_path / "species.cells.json",
        )


def _write_matrix(
    path: Path,
    grid: SparseMetadata,
    rows: list[tuple[str, str, str, list[int]]] | list[
        tuple[str, str, str, list[int], float | None]
    ],
) -> Path:
    entries = [
        SpeciesMatrixEntry(
            name=row[0],
            iucn=row[1],
            csv_class=row[2],
            cell_ids=np.asarray(row[3], dtype=np.uint32),
            metadata=SparseMetadata(
                width=grid.width,
                height=grid.height,
                x_origin=grid.x_origin,
                y_origin=grid.y_origin,
                x_scale=grid.x_scale,
                y_scale=grid.y_scale,
                nodata=grid.nodata,
                crs=grid.crs,
                count=len(row[3]),
            ),
            area_km2=row[4] if len(row) > 4 else None,
        )
        for row in rows
    ]
    path.write_bytes(encode_species_matrix(entries))
    return path
