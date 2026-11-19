"""Round-trip tests for the .sparse.gz / .smtx.gz format module.

These tests guarantee that any supported input array (binary, categorical,
continuous) survives encode → decode without value loss, and that bundle
encoding correctly preserves per-species offsets and counts.
"""

from __future__ import annotations

import gzip
import json
import struct

import numpy as np
import pytest

from sparse import (
    LAYER_TYPE_BINARY,
    LAYER_TYPE_CATEGORICAL,
    LAYER_TYPE_CONTINUOUS,
    SparseArtifact,
    SparseMetadata,
    SpeciesMatrixEntry,
    decode_sparse_bytes,
    decode_species_matrix_bytes,
    encode_sparse_artifact,
    encode_species_matrix,
    iter_species_matrix_chunks,
)
from sparse.format import (
    SparseFormatError,
    artifact_from_array,
)

_BASE_GRID = {
    "xOrigin": -79.0,
    "yOrigin": 13.0,
    "xScale": 0.008333,
    "yScale": -0.008333,
    "crs": "EPSG:4326",
}


def _make_meta(width: int, height: int, count: int, *, nodata=None) -> SparseMetadata:
    return SparseMetadata(
        width=width,
        height=height,
        x_origin=_BASE_GRID["xOrigin"],
        y_origin=_BASE_GRID["yOrigin"],
        x_scale=_BASE_GRID["xScale"],
        y_scale=_BASE_GRID["yScale"],
        nodata=nodata,
        crs=_BASE_GRID["crs"],
        count=count,
    )


def test_binary_roundtrip_simple():
    array = np.array(
        [
            [1, 0, 1, 0],
            [0, 1, 1, 0],
            [0, 0, 0, 1],
        ],
        dtype=np.uint8,
    )
    expected_cells = np.flatnonzero(array.ravel() == 1).astype(np.uint32)

    artifact = artifact_from_array(
        array,
        layer_type=LAYER_TYPE_BINARY,
        metadata_grid={**_BASE_GRID, "width": array.shape[1], "height": array.shape[0]},
    )
    encoded = encode_sparse_artifact(artifact)
    decoded = decode_sparse_bytes(encoded)

    assert decoded.layer_type == LAYER_TYPE_BINARY
    assert decoded.metadata.count == int(expected_cells.size)
    assert decoded.values is None
    np.testing.assert_array_equal(decoded.cell_ids, expected_cells)


def test_binary_roundtrip_random_large():
    rng = np.random.default_rng(seed=7)
    width, height = 200, 150
    occupancy = rng.random(size=(height, width)) < 0.05
    array = occupancy.astype(np.uint8)
    expected = np.flatnonzero(array.ravel() == 1).astype(np.uint32)

    artifact = artifact_from_array(
        array,
        layer_type=LAYER_TYPE_BINARY,
        metadata_grid={**_BASE_GRID, "width": width, "height": height},
    )
    decoded = decode_sparse_bytes(encode_sparse_artifact(artifact))

    np.testing.assert_array_equal(decoded.cell_ids, expected)


def test_categorical_roundtrip_preserves_values():
    array = np.array(
        [
            [0, 2, 0, 5],
            [3, 0, 4, 1],
            [0, 0, 5, 0],
        ],
        dtype=np.uint16,
    )
    expected_cells = np.flatnonzero(array.ravel() != 0).astype(np.uint32)
    expected_values = array.ravel()[expected_cells].astype(np.uint16)

    artifact = artifact_from_array(
        array,
        layer_type=LAYER_TYPE_CATEGORICAL,
        metadata_grid={**_BASE_GRID, "width": array.shape[1], "height": array.shape[0]},
    )
    decoded = decode_sparse_bytes(encode_sparse_artifact(artifact))

    assert decoded.layer_type == LAYER_TYPE_CATEGORICAL
    np.testing.assert_array_equal(decoded.cell_ids, expected_cells)
    np.testing.assert_array_equal(decoded.values, expected_values)


def test_continuous_roundtrip_preserves_float32_values():
    array = np.array(
        [
            [0.0, 1.5, np.nan, 0.0],
            [3.25, 0.0, -2.75, 0.5],
            [0.0, 0.0, 4.125, 0.0],
        ],
        dtype=np.float32,
    )

    artifact = artifact_from_array(
        array,
        layer_type=LAYER_TYPE_CONTINUOUS,
        metadata_grid={**_BASE_GRID, "width": array.shape[1], "height": array.shape[0]},
    )
    expected_mask = np.isfinite(array.ravel()) & (array.ravel() != 0)
    expected_cells = np.flatnonzero(expected_mask).astype(np.uint32)
    expected_values = array.ravel()[expected_mask].astype(np.float32)

    decoded = decode_sparse_bytes(encode_sparse_artifact(artifact))

    assert decoded.layer_type == LAYER_TYPE_CONTINUOUS
    np.testing.assert_array_equal(decoded.cell_ids, expected_cells)
    np.testing.assert_array_equal(decoded.values, expected_values)


def test_binary_with_nodata_excluded():
    array = np.array(
        [
            [1, 1, 255, 0],
            [255, 1, 0, 1],
        ],
        dtype=np.uint8,
    )
    artifact = artifact_from_array(
        array,
        layer_type=LAYER_TYPE_BINARY,
        metadata_grid={**_BASE_GRID, "width": array.shape[1], "height": array.shape[0]},
        nodata=255,
    )
    decoded = decode_sparse_bytes(encode_sparse_artifact(artifact))

    expected = np.flatnonzero((array.ravel() == 1) & (array.ravel() != 255))
    np.testing.assert_array_equal(decoded.cell_ids, expected.astype(np.uint32))


def test_binary_with_selected_value_other_than_one():
    # Some manifest 'binary' layers encode 1=present, 2=absent, 255=nodata;
    # ensure ``selected_value`` overrides the default of 1.
    array = np.array(
        [
            [2, 1, 2, 1],
            [255, 2, 1, 2],
        ],
        dtype=np.uint8,
    )
    artifact = artifact_from_array(
        array,
        layer_type=LAYER_TYPE_BINARY,
        metadata_grid={**_BASE_GRID, "width": array.shape[1], "height": array.shape[0]},
        selected_value=1,
        nodata=255,
    )
    decoded = decode_sparse_bytes(encode_sparse_artifact(artifact))

    expected = np.flatnonzero(array.ravel() == 1).astype(np.uint32)
    np.testing.assert_array_equal(decoded.cell_ids, expected)


def test_binary_with_selected_values_set():
    array = np.array(
        [
            [3, 4, 5, 1],
            [2, 3, 4, 5],
        ],
        dtype=np.uint8,
    )
    artifact = artifact_from_array(
        array,
        layer_type=LAYER_TYPE_BINARY,
        metadata_grid={**_BASE_GRID, "width": array.shape[1], "height": array.shape[0]},
        selected_values=[3, 4, 5],
    )
    decoded = decode_sparse_bytes(encode_sparse_artifact(artifact))

    expected_mask = np.isin(array.ravel(), [3, 4, 5])
    expected = np.flatnonzero(expected_mask).astype(np.uint32)
    np.testing.assert_array_equal(decoded.cell_ids, expected)


def test_encoded_bytes_are_deterministic():
    array = np.array(
        [
            [1, 0, 1, 0],
            [0, 1, 0, 1],
        ],
        dtype=np.uint8,
    )
    artifact = artifact_from_array(
        array,
        layer_type=LAYER_TYPE_BINARY,
        metadata_grid={**_BASE_GRID, "width": array.shape[1], "height": array.shape[0]},
    )
    a = encode_sparse_artifact(artifact)
    b = encode_sparse_artifact(artifact)
    assert a == b, "gzip output must be deterministic (mtime fixed at 0)"


def test_empty_artifact_roundtrip():
    array = np.zeros((4, 5), dtype=np.uint8)
    artifact = artifact_from_array(
        array,
        layer_type=LAYER_TYPE_BINARY,
        metadata_grid={**_BASE_GRID, "width": 5, "height": 4},
    )
    decoded = decode_sparse_bytes(encode_sparse_artifact(artifact))

    assert decoded.metadata.count == 0
    assert decoded.cell_ids.shape == (0,)


def test_invalid_magic_raises():
    bogus = gzip.compress(b"NOT A SPARSE ARTIFACT")
    with pytest.raises(SparseFormatError):
        decode_sparse_bytes(bogus)


def _encoded_raw_metadata(payload) -> bytes:
    metadata = json.dumps(payload).encode("utf-8")
    raw = b"SMTX" + bytes([LAYER_TYPE_BINARY])
    raw += struct.pack("<H", len(metadata)) + metadata
    return gzip.compress(raw)


@pytest.mark.parametrize("payload", [[], 7, None])
def test_sparse_metadata_must_be_json_object(payload):
    with pytest.raises(SparseFormatError, match="JSON object"):
        decode_sparse_bytes(_encoded_raw_metadata(payload))


def test_overflowing_sparse_metadata_is_normalized():
    payload = {
        **_BASE_GRID,
        "width": 1e309,
        "height": 1,
        "nodata": None,
        "count": 0,
    }

    with pytest.raises(SparseFormatError, match="invalid sparse metadata"):
        decode_sparse_bytes(_encoded_raw_metadata(payload))


@pytest.mark.parametrize(
    "blob",
    [
        b"",
        b"not-gzip",
        b"\x1f\x8b\x08\x00",
    ],
)
def test_malformed_sparse_bytes_are_normalized(blob):
    with pytest.raises(SparseFormatError):
        decode_sparse_bytes(blob)


def test_species_matrix_roundtrip():
    width, height = 16, 12
    grid_meta = _make_meta(width, height, count=0)

    rng = np.random.default_rng(seed=11)
    entries: list[SpeciesMatrixEntry] = []
    expected_cells: dict[str, np.ndarray] = {}
    for idx, name in enumerate(["Sp_alpha", "Sp_beta", "Sp_gamma", "Sp_delta"]):
        n_cells = int(rng.integers(low=2, high=20))
        cells = np.sort(
            rng.choice(width * height, size=n_cells, replace=False).astype(np.uint32)
        )
        expected_cells[name] = cells
        meta = _make_meta(width, height, count=int(cells.size))
        entries.append(
            SpeciesMatrixEntry(
                name=name,
                iucn=("CR" if idx % 2 else "LC"),
                csv_class="Mammalia",
                cell_ids=cells,
                metadata=meta,
            )
        )

    encoded = encode_species_matrix(entries)
    decoded = decode_species_matrix_bytes(encoded)

    assert {entry.name for entry in decoded.entries} == set(expected_cells)
    for entry in decoded.entries:
        np.testing.assert_array_equal(entry.cell_ids, expected_cells[entry.name])
        assert entry.csv_class == "Mammalia"
        assert entry.metadata.width == width
        assert entry.metadata.height == height


def test_species_matrix_streams_bounded_delta_chunks(tmp_path):
    cells = np.array([2, 5, 9, 10, 100, 105, 120], dtype=np.uint32)
    encoded = encode_species_matrix(
        [
            SpeciesMatrixEntry(
                name="Sp_chunked",
                iucn="VU",
                csv_class="Mammalia",
                cell_ids=cells,
                metadata=_make_meta(width=16, height=12, count=len(cells)),
            )
        ]
    )
    path = tmp_path / "chunked.smsp.gz"
    path.write_bytes(encoded)

    chunks = [
        chunk
        for chunk, _, _ in iter_species_matrix_chunks(path, max_cells=3)
    ]

    assert [chunk.cell_ids.size for chunk in chunks] == [3, 3, 1]
    assert chunks[0].first is True
    assert chunks[-1].last is True
    np.testing.assert_array_equal(
        np.concatenate([chunk.cell_ids for chunk in chunks]),
        cells,
    )


def test_species_matrix_rejects_inconsistent_grid():
    cells = np.array([1, 2, 3], dtype=np.uint32)
    a = SpeciesMatrixEntry(
        name="A", iucn="LC", csv_class="Aves",
        cell_ids=cells, metadata=_make_meta(width=10, height=10, count=3),
    )
    b = SpeciesMatrixEntry(
        name="B", iucn="LC", csv_class="Aves",
        cell_ids=cells, metadata=_make_meta(width=20, height=20, count=3),  # different grid
    )
    with pytest.raises(SparseFormatError):
        encode_species_matrix([a, b])
