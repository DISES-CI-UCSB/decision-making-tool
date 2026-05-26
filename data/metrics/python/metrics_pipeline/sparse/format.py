"""On-disk sparse artifact format: encode/decode for .sparse.gz and .smtx.gz.

Two artifact types live here:

1. ``.sparse.gz`` — one sidecar per source ``.tif``.  The whole file is a
   valid gzip stream; once decompressed, the bytes look like::

       [4 bytes] magic       = b"SMTX"  (0x53 0x4D 0x54 0x58)
       [1 byte ] layer_type  = 0 binary, 1 categorical, 2 continuous
       [2 bytes] metadata_length (uint16 little-endian)
       [N bytes] metadata    = JSON UTF-8: {width, height, xOrigin, yOrigin,
                                             xScale, yScale, nodata, crs, count}
       [body  ] depending on layer_type:
                 binary      → uint32[] sorted delta-encoded cell indices
                 categorical → interleaved (uint32 delta, uint16 value)
                 continuous  → interleaved (uint32 delta, float32 value)

2. ``.smtx.gz`` — one packed bundle per taxonomic group, replacing thousands
   of individual species sidecars on the runtime hot path.  The whole file
   is a valid gzip stream; once decompressed, the bytes look like::

       [4 bytes] magic        = b"SMSP"  (Species Multi-SParse)
       [4 bytes] toc_length   (uint32 little-endian)
       [N bytes] toc          = JSON UTF-8: {grid: {...}, species: [
                                  {name, iucn, class, offset, count}, ...]}
       [body  ] concatenated per-species delta-encoded uint32 cell IDs.
                ``offset`` is the byte offset into this body (after gzip
                decompression); ``count`` is the number of uint32 cell IDs.

The body of an ``.smtx.gz`` is the same as a binary ``.sparse.gz`` body,
which keeps the build pipeline symmetric: per-species ``.sparse.gz`` files
are the build cache, and ``.smtx.gz`` bundles concatenate their bodies.

Determinism: gzip mtime is set to 0 so the same input produces the same
file bytes.  This makes the artifacts cacheable by content hash and
diff-friendly across rebuilds.
"""

from __future__ import annotations

import gzip
import io
import json
import struct
from dataclasses import dataclass, field
from typing import Any

import numpy as np

SMTX_MAGIC = b"SMTX"
SMSP_MAGIC = b"SMSP"

LAYER_TYPE_BINARY = 0
LAYER_TYPE_CATEGORICAL = 1
LAYER_TYPE_CONTINUOUS = 2

_LAYER_TYPES: tuple[int, ...] = (
    LAYER_TYPE_BINARY,
    LAYER_TYPE_CATEGORICAL,
    LAYER_TYPE_CONTINUOUS,
)


class SparseFormatError(RuntimeError):
    """Raised when a sparse artifact is malformed or version-incompatible."""


# ---------------------------------------------------------------------------
# .sparse.gz
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class SparseMetadata:
    """Header metadata describing the source raster grid.

    All fields are stored as JSON in the artifact header.  The grid fields
    are taken straight off the source TIF so the decoder can place cell
    indices back into the source raster's coordinate system.

    ``count`` is the number of occupied cells written into the body.
    """

    width: int
    height: int
    x_origin: float
    y_origin: float
    x_scale: float
    y_scale: float
    nodata: float | int | None
    crs: str | None
    count: int

    def to_json(self) -> dict[str, Any]:
        return {
            "width": self.width,
            "height": self.height,
            "xOrigin": self.x_origin,
            "yOrigin": self.y_origin,
            "xScale": self.x_scale,
            "yScale": self.y_scale,
            "nodata": self.nodata,
            "crs": self.crs,
            "count": self.count,
        }

    @classmethod
    def from_json(cls, payload: dict[str, Any]) -> "SparseMetadata":
        try:
            return cls(
                width=int(payload["width"]),
                height=int(payload["height"]),
                x_origin=float(payload["xOrigin"]),
                y_origin=float(payload["yOrigin"]),
                x_scale=float(payload["xScale"]),
                y_scale=float(payload["yScale"]),
                nodata=payload.get("nodata"),
                crs=payload.get("crs"),
                count=int(payload["count"]),
            )
        except (KeyError, TypeError, ValueError) as exc:
            raise SparseFormatError(f"invalid sparse metadata: {exc}") from exc


@dataclass(frozen=True)
class SparseArtifact:
    """In-memory representation of a decoded ``.sparse.gz`` artifact."""

    layer_type: int
    metadata: SparseMetadata
    cell_ids: np.ndarray
    values: np.ndarray | None = None

    def __post_init__(self) -> None:
        if self.layer_type not in _LAYER_TYPES:
            raise SparseFormatError(f"unknown layer_type: {self.layer_type}")
        if self.cell_ids.dtype != np.uint32:
            raise SparseFormatError(
                f"cell_ids dtype must be uint32, got {self.cell_ids.dtype}"
            )
        if self.layer_type == LAYER_TYPE_BINARY:
            if self.values is not None:
                raise SparseFormatError("binary layer_type cannot carry values")
        else:
            if self.values is None:
                raise SparseFormatError(
                    f"layer_type {self.layer_type} requires a values array"
                )
            if self.values.shape != self.cell_ids.shape:
                raise SparseFormatError(
                    "values and cell_ids must have the same shape "
                    f"(got {self.values.shape} vs {self.cell_ids.shape})"
                )
            expected_dtype = (
                np.uint16 if self.layer_type == LAYER_TYPE_CATEGORICAL else np.float32
            )
            if self.values.dtype != expected_dtype:
                raise SparseFormatError(
                    f"layer_type {self.layer_type} requires {expected_dtype} values, "
                    f"got {self.values.dtype}"
                )

        if int(self.metadata.count) != int(self.cell_ids.size):
            raise SparseFormatError(
                "metadata.count does not match cell_ids length "
                f"({self.metadata.count} vs {self.cell_ids.size})"
            )


def _delta_encode_sorted(cell_ids: np.ndarray) -> np.ndarray:
    """Return delta-encoded copy of *cell_ids*.  Input must be sorted ascending."""
    if cell_ids.size == 0:
        return cell_ids.astype(np.uint32, copy=False)
    out = np.empty_like(cell_ids, dtype=np.uint32)
    out[0] = cell_ids[0]
    if cell_ids.size > 1:
        np.subtract(cell_ids[1:], cell_ids[:-1], out=out[1:], dtype=np.uint32)
    return out


def _delta_decode(deltas: np.ndarray) -> np.ndarray:
    """Cumulative sum of *deltas*, returning sorted cell IDs."""
    return np.cumsum(deltas.astype(np.uint32, copy=False), dtype=np.uint32)


def _gzip_bytes(payload: bytes) -> bytes:
    """Gzip *payload* deterministically (no mtime, no fname)."""
    buf = io.BytesIO()
    with gzip.GzipFile(fileobj=buf, mode="wb", mtime=0) as gz:
        gz.write(payload)
    return buf.getvalue()


def _gunzip_bytes(payload: bytes) -> bytes:
    return gzip.decompress(payload)


def _build_sparse_payload(
    layer_type: int,
    metadata: SparseMetadata,
    body: bytes,
) -> bytes:
    if layer_type not in _LAYER_TYPES:
        raise SparseFormatError(f"unknown layer_type: {layer_type}")
    metadata_json = json.dumps(metadata.to_json(), separators=(",", ":")).encode("utf-8")
    if len(metadata_json) > 0xFFFF:
        raise SparseFormatError(
            f"metadata JSON too large ({len(metadata_json)} bytes; max 65535)"
        )
    header = (
        SMTX_MAGIC
        + struct.pack("<B", layer_type)
        + struct.pack("<H", len(metadata_json))
        + metadata_json
    )
    return header + body


def encode_sparse_artifact(artifact: SparseArtifact) -> bytes:
    """Encode *artifact* into a ``.sparse.gz`` byte string."""
    deltas = _delta_encode_sorted(artifact.cell_ids)
    if artifact.layer_type == LAYER_TYPE_BINARY:
        body = deltas.tobytes()
    elif artifact.layer_type == LAYER_TYPE_CATEGORICAL:
        if artifact.values is None:
            raise SparseFormatError("categorical body requires values")
        body = _interleave_uint16(deltas, artifact.values)
    else:
        if artifact.values is None:
            raise SparseFormatError("continuous body requires values")
        body = _interleave_float32(deltas, artifact.values)

    payload = _build_sparse_payload(artifact.layer_type, artifact.metadata, body)
    return _gzip_bytes(payload)


def decode_sparse_bytes(blob: bytes) -> SparseArtifact:
    """Decode a ``.sparse.gz`` byte string back into a :class:`SparseArtifact`."""
    raw = _gunzip_bytes(blob)
    return _decode_sparse_uncompressed(raw)


def _decode_sparse_uncompressed(raw: bytes) -> SparseArtifact:
    if len(raw) < 7:
        raise SparseFormatError("sparse artifact truncated (header < 7 bytes)")
    if raw[:4] != SMTX_MAGIC:
        raise SparseFormatError(
            f"bad sparse magic: expected {SMTX_MAGIC!r}, got {raw[:4]!r}"
        )
    layer_type = raw[4]
    metadata_length = struct.unpack_from("<H", raw, 5)[0]
    body_offset = 7 + metadata_length
    if len(raw) < body_offset:
        raise SparseFormatError("sparse artifact truncated (metadata)")
    try:
        metadata_json = json.loads(raw[7:body_offset].decode("utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise SparseFormatError(f"invalid sparse metadata JSON: {exc}") from exc
    metadata = SparseMetadata.from_json(metadata_json)

    body = raw[body_offset:]
    cell_ids, values = _decode_body(layer_type, body, expected_count=metadata.count)
    return SparseArtifact(
        layer_type=layer_type,
        metadata=metadata,
        cell_ids=cell_ids,
        values=values,
    )


def _decode_body(
    layer_type: int, body: bytes, *, expected_count: int
) -> tuple[np.ndarray, np.ndarray | None]:
    if layer_type == LAYER_TYPE_BINARY:
        deltas = np.frombuffer(body, dtype=np.uint32)
        if deltas.size != expected_count:
            raise SparseFormatError(
                f"body cell count mismatch: header says {expected_count}, body has {deltas.size}"
            )
        return _delta_decode(deltas), None

    if layer_type == LAYER_TYPE_CATEGORICAL:
        # Interleaved (uint32 delta, uint16 value) → 6 bytes/entry.
        return _deinterleave_uint16(body, expected_count)

    if layer_type == LAYER_TYPE_CONTINUOUS:
        # Interleaved (uint32 delta, float32 value) → 8 bytes/entry.
        return _deinterleave_float32(body, expected_count)

    raise SparseFormatError(f"unknown layer_type: {layer_type}")


def _interleave_uint16(deltas: np.ndarray, values: np.ndarray) -> bytes:
    # Pack into bytes via Python struct because numpy structured arrays would
    # 4-byte-align the uint16 field.  Six-byte stride is required by the spec.
    if deltas.size != values.size:
        raise SparseFormatError("delta/value length mismatch (categorical)")
    out = bytearray(6 * deltas.size)
    delta_view = deltas.astype("<u4", copy=False).tobytes()
    value_view = values.astype("<u2", copy=False).tobytes()
    for idx in range(deltas.size):
        out[idx * 6 : idx * 6 + 4] = delta_view[idx * 4 : (idx + 1) * 4]
        out[idx * 6 + 4 : idx * 6 + 6] = value_view[idx * 2 : (idx + 1) * 2]
    return bytes(out)


def _deinterleave_uint16(body: bytes, expected_count: int) -> tuple[np.ndarray, np.ndarray]:
    if len(body) != 6 * expected_count:
        raise SparseFormatError(
            f"categorical body size mismatch: expected {6 * expected_count}, got {len(body)}"
        )
    deltas = np.empty(expected_count, dtype=np.uint32)
    values = np.empty(expected_count, dtype=np.uint16)
    for idx in range(expected_count):
        deltas[idx] = struct.unpack_from("<I", body, idx * 6)[0]
        values[idx] = struct.unpack_from("<H", body, idx * 6 + 4)[0]
    return _delta_decode(deltas), values


def _interleave_float32(deltas: np.ndarray, values: np.ndarray) -> bytes:
    # 4 + 4 = 8 bytes/entry; numpy structured array works because both fields
    # are 4-byte aligned naturally.
    if deltas.size != values.size:
        raise SparseFormatError("delta/value length mismatch (continuous)")
    dtype = np.dtype([("delta", "<u4"), ("value", "<f4")])
    arr = np.empty(deltas.size, dtype=dtype)
    arr["delta"] = deltas.astype("<u4", copy=False)
    arr["value"] = values.astype("<f4", copy=False)
    return arr.tobytes()


def _deinterleave_float32(body: bytes, expected_count: int) -> tuple[np.ndarray, np.ndarray]:
    if len(body) != 8 * expected_count:
        raise SparseFormatError(
            f"continuous body size mismatch: expected {8 * expected_count}, got {len(body)}"
        )
    dtype = np.dtype([("delta", "<u4"), ("value", "<f4")])
    arr = np.frombuffer(body, dtype=dtype)
    return _delta_decode(arr["delta"].copy()), arr["value"].astype(np.float32, copy=True)


# ---------------------------------------------------------------------------
# .smtx.gz (combined species matrix)
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class SpeciesMatrixEntry:
    """One species record inside a packed ``.smtx.gz`` bundle."""

    name: str
    iucn: str
    csv_class: str
    cell_ids: np.ndarray
    metadata: SparseMetadata

    def __post_init__(self) -> None:
        if self.cell_ids.dtype != np.uint32:
            raise SparseFormatError(
                f"species cell_ids dtype must be uint32, got {self.cell_ids.dtype}"
            )


@dataclass(frozen=True)
class _SpeciesMatrixHeader:
    grid: dict[str, Any]
    species: list[dict[str, Any]] = field(default_factory=list)


def encode_species_matrix(entries: list[SpeciesMatrixEntry]) -> bytes:
    """Pack a list of species into a single ``.smtx.gz`` byte string.

    Every entry is delta-encoded (the body is byte-equivalent to the binary
    ``.sparse.gz`` body), then concatenated.  The TOC records each species's
    byte offset and uint32 count so the decoder can slice without scanning.

    Each entry must declare its source grid via ``metadata``.  All entries in
    one ``.smtx.gz`` are required to share the same grid: the Tier 1 species
    rasters all use the same Colombia 1 km MAXENT grid, so this avoids
    duplicating the grid block in every TOC entry.  If a heterogeneous grid
    is ever needed, the header layout will need a ``grids`` list.
    """
    if not entries:
        raise SparseFormatError("encode_species_matrix requires at least one entry")

    grid = entries[0].metadata.to_json()
    grid.pop("count", None)
    for entry in entries[1:]:
        next_grid = entry.metadata.to_json()
        next_grid.pop("count", None)
        if next_grid != grid:
            raise SparseFormatError(
                "species matrix entries must share a single source grid; "
                f"'{entries[0].name}' and '{entry.name}' differ"
            )

    body_chunks: list[bytes] = []
    toc_entries: list[dict[str, Any]] = []
    cursor = 0
    for entry in entries:
        deltas = _delta_encode_sorted(entry.cell_ids)
        chunk = deltas.tobytes()
        body_chunks.append(chunk)
        toc_entries.append({
            "name": entry.name,
            "iucn": entry.iucn,
            "class": entry.csv_class,
            "offset": cursor,
            "count": int(entry.cell_ids.size),
        })
        cursor += len(chunk)

    toc_payload = {"grid": grid, "species": toc_entries}
    toc_json = json.dumps(toc_payload, separators=(",", ":")).encode("utf-8")

    header = SMSP_MAGIC + struct.pack("<I", len(toc_json)) + toc_json
    body = b"".join(body_chunks)
    return _gzip_bytes(header + body)


@dataclass(frozen=True)
class DecodedSpeciesMatrix:
    grid: SparseMetadata | None
    grid_raw: dict[str, Any]
    entries: list[SpeciesMatrixEntry]


def decode_species_matrix_bytes(blob: bytes) -> DecodedSpeciesMatrix:
    """Decode a ``.smtx.gz`` byte string back into species matrix entries."""
    raw = _gunzip_bytes(blob)
    if len(raw) < 8:
        raise SparseFormatError("smtx artifact truncated (header < 8 bytes)")
    if raw[:4] != SMSP_MAGIC:
        raise SparseFormatError(
            f"bad smtx magic: expected {SMSP_MAGIC!r}, got {raw[:4]!r}"
        )
    toc_length = struct.unpack_from("<I", raw, 4)[0]
    body_offset = 8 + toc_length
    if len(raw) < body_offset:
        raise SparseFormatError("smtx artifact truncated (TOC)")
    try:
        toc = json.loads(raw[8:body_offset].decode("utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise SparseFormatError(f"invalid smtx TOC JSON: {exc}") from exc

    grid_raw = toc.get("grid") or {}
    grid_meta: SparseMetadata | None = None
    if grid_raw:
        try:
            grid_with_count = dict(grid_raw)
            grid_with_count.setdefault("count", 0)
            grid_meta = SparseMetadata.from_json(grid_with_count)
        except SparseFormatError:
            grid_meta = None

    body = raw[body_offset:]
    species_entries: list[SpeciesMatrixEntry] = []
    for entry in toc.get("species") or []:
        name = str(entry["name"])
        iucn = str(entry.get("iucn") or "")
        csv_class = str(entry.get("class") or "")
        offset = int(entry["offset"])
        count = int(entry["count"])
        chunk_end = offset + 4 * count
        if chunk_end > len(body):
            raise SparseFormatError(
                f"smtx body too small for species '{name}' "
                f"(needs {chunk_end} bytes, body has {len(body)})"
            )
        deltas = np.frombuffer(body[offset:chunk_end], dtype=np.uint32)
        cell_ids = _delta_decode(deltas)
        # Per-entry metadata mirrors the bundle grid.  We attach a count so the
        # SparseMetadata invariant (count == cell_ids.size) holds.
        per_entry_grid = dict(grid_raw)
        per_entry_grid["count"] = int(cell_ids.size)
        try:
            entry_meta = SparseMetadata.from_json(per_entry_grid)
        except SparseFormatError:
            entry_meta = SparseMetadata(
                width=0, height=0,
                x_origin=0.0, y_origin=0.0,
                x_scale=0.0, y_scale=0.0,
                nodata=None, crs=None,
                count=int(cell_ids.size),
            )
        species_entries.append(
            SpeciesMatrixEntry(
                name=name,
                iucn=iucn,
                csv_class=csv_class,
                cell_ids=cell_ids,
                metadata=entry_meta,
            )
        )

    return DecodedSpeciesMatrix(
        grid=grid_meta,
        grid_raw=grid_raw,
        entries=species_entries,
    )


# ---------------------------------------------------------------------------
# Convenience: build SparseArtifact from a 2-D numpy array
# ---------------------------------------------------------------------------

def artifact_from_array(
    array: np.ndarray,
    *,
    layer_type: int,
    metadata_grid: dict[str, Any],
    nodata: float | int | None = None,
    selected_value: int | None = None,
    selected_values: list[int] | None = None,
    drop_zero_for_continuous: bool = True,
) -> SparseArtifact:
    """Build a :class:`SparseArtifact` directly from a 2-D raster array.

    Args:
        array: 2-D raster band (any numeric dtype).
        layer_type: one of ``LAYER_TYPE_BINARY/CATEGORICAL/CONTINUOUS``.
        metadata_grid: dict with grid keys (width/height/xOrigin/yOrigin/
            xScale/yScale/crs).  ``count`` and ``nodata`` are added here.
        nodata: nodata value to exclude (passed-through to metadata).
        selected_value: for binary layers, the value treated as 'present'
            (default 1 if ``selected_values`` is None).
        selected_values: alternative for binary layers — set of values
            counted as 'present'.
        drop_zero_for_continuous: when True, treat zero-valued cells as
            background.  Recommended (smaller files) and matches the
            real-world raster conventions in this dataset.

    The returned cell IDs are sorted ascending and use the row-major flat
    index ``row * width + col``, which matches numpy ``ravel()``.
    """
    if array.ndim != 2:
        raise SparseFormatError(f"array must be 2-D, got shape {array.shape}")

    height, width = array.shape
    flat = array.ravel()

    if layer_type == LAYER_TYPE_BINARY:
        if selected_values is not None:
            mask = np.isin(flat, np.asarray(list(selected_values)))
        else:
            target = 1 if selected_value is None else int(selected_value)
            mask = flat == target
        if nodata is not None and array.dtype.kind in "iu":
            mask &= flat != nodata
        cell_ids = np.flatnonzero(mask).astype(np.uint32)
        values = None
    elif layer_type == LAYER_TYPE_CATEGORICAL:
        valid = np.ones_like(flat, dtype=bool)
        if nodata is not None:
            valid &= flat != nodata
        if np.issubdtype(flat.dtype, np.floating):
            valid &= np.isfinite(flat)
        # Categorical metric semantics: any valid non-zero cell.  Zero is
        # typically the implicit background even when nodata is encoded
        # separately (e.g. coberturas.tif).
        valid &= flat != 0
        cell_ids = np.flatnonzero(valid).astype(np.uint32)
        values = flat[valid].astype(np.uint16, copy=False)
    elif layer_type == LAYER_TYPE_CONTINUOUS:
        valid = np.ones_like(flat, dtype=bool)
        if np.issubdtype(flat.dtype, np.floating):
            valid &= np.isfinite(flat)
        if nodata is not None:
            valid &= flat != nodata
        if drop_zero_for_continuous:
            valid &= flat != 0
        cell_ids = np.flatnonzero(valid).astype(np.uint32)
        values = flat[valid].astype(np.float32, copy=False)
    else:
        raise SparseFormatError(f"unknown layer_type: {layer_type}")

    metadata = SparseMetadata(
        width=int(width),
        height=int(height),
        x_origin=float(metadata_grid["xOrigin"]),
        y_origin=float(metadata_grid["yOrigin"]),
        x_scale=float(metadata_grid["xScale"]),
        y_scale=float(metadata_grid["yScale"]),
        nodata=nodata,
        crs=metadata_grid.get("crs"),
        count=int(cell_ids.size),
    )
    return SparseArtifact(
        layer_type=layer_type,
        metadata=metadata,
        cell_ids=cell_ids,
        values=values,
    )
