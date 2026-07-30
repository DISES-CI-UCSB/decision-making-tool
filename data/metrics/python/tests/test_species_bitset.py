from __future__ import annotations

from pathlib import Path

import numpy as np

from sparse.format import SparseMetadata, SpeciesMatrixEntry, encode_species_matrix
from sparse.species_bitset import build_species_bitset, load_species_bitset_metadata


def test_species_bitset_builds_cell_major_rows_and_range_denominators(
    tmp_path: Path,
) -> None:
    grid = SparseMetadata(
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
    assert data_path.stat().st_size == loaded.expected_data_bytes


def _write_matrix(
    path: Path,
    grid: SparseMetadata,
    rows: list[tuple[str, str, str, list[int]]],
) -> Path:
    entries = [
        SpeciesMatrixEntry(
            name=name,
            iucn=iucn,
            csv_class=csv_class,
            cell_ids=np.asarray(cell_ids, dtype=np.uint32),
            metadata=SparseMetadata(
                width=grid.width,
                height=grid.height,
                x_origin=grid.x_origin,
                y_origin=grid.y_origin,
                x_scale=grid.x_scale,
                y_scale=grid.y_scale,
                nodata=grid.nodata,
                crs=grid.crs,
                count=len(cell_ids),
            ),
        )
        for name, iucn, csv_class, cell_ids in rows
    ]
    path.write_bytes(encode_species_matrix(entries))
    return path
