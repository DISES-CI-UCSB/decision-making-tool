"""Fast compression benchmark — answer 'can we compress plants below 126 MB?'

Strategy:
- Decode the plants bundle once (4,978 species, ~30M cells)
- Encode all per-species delta lists as both int32 and varint (LEB128)
- Compress with gzip-9, brotli-6 (fast-ish, near brotli-11 quality), zstd-19
- Numpy-vectorized varint to keep this under a minute

No q=11 brotli — it's slow and the marginal gain is small.
"""
from __future__ import annotations

import gzip
import sys
import time
import urllib.request
from pathlib import Path

import brotli
import numpy as np
import zstandard

REPO = Path(__file__).resolve().parents[4]
SRC = REPO / "data/metrics/python/metrics_pipeline"
sys.path.insert(0, str(SRC))

from sparse.format import (  # noqa: E402
    decode_species_matrix_bytes,
    decode_sparse_bytes,
)


def varint_encode_vec(values: np.ndarray) -> bytes:
    """Numpy-vectorized LEB128 varint encoder for uint32 inputs.

    For each value, produce 1–5 bytes.  Bytes are written little-endian:
    7 data bits + 1 continuation bit per byte.
    """
    if values.size == 0:
        return b""
    v = values.astype(np.uint64, copy=True)
    width = np.where(v < (1 << 7), 1,
            np.where(v < (1 << 14), 2,
            np.where(v < (1 << 21), 3,
            np.where(v < (1 << 28), 4, 5))))
    total = int(width.sum())
    buf = np.empty(total, dtype=np.uint8)
    offsets = np.empty(values.size, dtype=np.int64)
    np.cumsum(width, out=offsets)
    offsets -= width
    for i in range(5):
        mask = width > i
        if not mask.any():
            break
        idxs = offsets[mask] + i
        chunk = (v[mask] >> (7 * i)) & 0x7F
        is_last = width[mask] == (i + 1)
        chunk = np.where(is_last, chunk, chunk | 0x80)
        buf[idxs] = chunk.astype(np.uint8)
    return buf.tobytes()


def fmt(n: int) -> str:
    return f"{n:>14,}"


def fetch(url: str) -> bytes:
    print(f"  fetching {url}", flush=True)
    t = time.time()
    with urllib.request.urlopen(url) as resp:
        data = resp.read()
    print(f"    {len(data):>14,} B in {time.time()-t:.2f}s", flush=True)
    return data


def deltas_for(cell_ids: np.ndarray) -> np.ndarray:
    if cell_ids.size == 0:
        return cell_ids.astype(np.uint32, copy=False)
    out = np.empty_like(cell_ids, dtype=np.uint32)
    out[0] = cell_ids[0]
    if cell_ids.size > 1:
        np.subtract(cell_ids[1:], cell_ids[:-1], out=out[1:], dtype=np.uint32)
    return out


def bench(name: str, current_blob_size: int, all_deltas: np.ndarray) -> None:
    print(f"\n=== {name} ===")
    print(f"  current on Vercel (gzip on int32 deltas + headers):  {fmt(current_blob_size)} B")

    int32_bytes = all_deltas.astype("<u4").tobytes()
    print(f"  int32 deltas (raw):                                  {fmt(len(int32_bytes))} B")

    t = time.time(); g = gzip.compress(int32_bytes, compresslevel=9)
    print(f"  int32 + gzip-9:                                      {fmt(len(g))} B  "
          f"({len(g)/current_blob_size:.0%} of current, {time.time()-t:.1f}s)")
    t = time.time(); b6 = brotli.compress(int32_bytes, quality=6)
    print(f"  int32 + brotli-6:                                    {fmt(len(b6))} B  "
          f"({len(b6)/current_blob_size:.0%} of current, {time.time()-t:.1f}s)")
    t = time.time(); z = zstandard.ZstdCompressor(level=19).compress(int32_bytes)
    print(f"  int32 + zstd-19:                                     {fmt(len(z))} B  "
          f"({len(z)/current_blob_size:.0%} of current, {time.time()-t:.1f}s)")

    t = time.time(); vbytes = varint_encode_vec(all_deltas)
    print(f"  varint deltas (raw, encoded in {time.time()-t:.1f}s):              {fmt(len(vbytes))} B  "
          f"({len(vbytes)/len(int32_bytes):.0%} of int32)")
    t = time.time(); vg = gzip.compress(vbytes, compresslevel=9)
    print(f"  varint + gzip-9:                                     {fmt(len(vg))} B  "
          f"({len(vg)/current_blob_size:.0%} of current, {time.time()-t:.1f}s)")
    t = time.time(); vb6 = brotli.compress(vbytes, quality=6)
    print(f"  varint + brotli-6:                                   {fmt(len(vb6))} B  "
          f"({len(vb6)/current_blob_size:.0%} of current, {time.time()-t:.1f}s)")
    t = time.time(); vz = zstandard.ZstdCompressor(level=19).compress(vbytes)
    print(f"  varint + zstd-19:                                    {fmt(len(vz))} B  "
          f"({len(vz)/current_blob_size:.0%} of current, {time.time()-t:.1f}s)")


def bench_smtx(url: str) -> None:
    blob = fetch(url)
    decoded = decode_species_matrix_bytes(blob)
    parts = [deltas_for(e.cell_ids) for e in decoded.entries]
    if not parts:
        return
    all_deltas = np.concatenate(parts)
    bench(f"smtx: {url.rsplit('/', 1)[-1]} ({len(decoded.entries)} species, "
          f"{all_deltas.size:,} cells)", len(blob), all_deltas)


def bench_sparse(url: str) -> None:
    blob = fetch(url)
    a = decode_sparse_bytes(blob)
    bench(f"sparse: {url.rsplit('/', 1)[-1]} ({a.cell_ids.size:,} cells)",
          len(blob), deltas_for(a.cell_ids))


def main() -> None:
    base = "https://aagibolq28slyfof.public.blob.vercel-storage.com"
    bench_smtx(f"{base}/inputs/features/species-sparse/species_threatened.smtx.gz")
    bench_smtx(f"{base}/inputs/features/species-sparse/species_birds.smtx.gz")
    bench_smtx(f"{base}/inputs/features/species-sparse/species_plants.smtx.gz")
    bench_sparse(f"{base}/inputs/features/biomass/aboveground_biomass_density.sparse.gz")


if __name__ == "__main__":
    main()
