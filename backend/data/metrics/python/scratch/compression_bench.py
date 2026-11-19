"""Benchmark alternative compressors / encodings on existing sparse artifacts.

Goal: see how much smaller the species bundles could plausibly become.
"""
from __future__ import annotations

import gzip
import io
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
    SMTX_MAGIC,
    SMSP_MAGIC,
)


def varint_encode(values: np.ndarray) -> bytes:
    """LEB128 varint encoding for unsigned ints."""
    out = bytearray()
    for v in values.tolist():
        while v >= 0x80:
            out.append((v & 0x7F) | 0x80)
            v >>= 7
        out.append(v & 0x7F)
    return bytes(out)


def fetch(url: str) -> bytes:
    print(f"  fetching {url} …", flush=True)
    t = time.time()
    with urllib.request.urlopen(url) as resp:
        data = resp.read()
    print(f"    {len(data):>14,} B in {time.time()-t:.2f}s", flush=True)
    return data


def bench_blob(name: str, gzipped: bytes, all_cell_ids_per_species: list[np.ndarray]) -> None:
    print(f"\n=== {name} ===")
    print(f"  current (.smtx.gz / .sparse.gz, gzip on int32 deltas): {len(gzipped):>12,} B")

    # Strip gzip → raw bytes (header + deltas as int32)
    raw = gzip.decompress(gzipped)

    # Try brotli on the same raw bytes
    t = time.time()
    br = brotli.compress(raw, quality=11)
    print(f"  brotli q=11 over current payload:                      {len(br):>12,} B  "
          f"({len(br)/len(gzipped):.2%}, encoded in {time.time()-t:.1f}s)")

    t = time.time()
    zs = zstandard.ZstdCompressor(level=22).compress(raw)
    print(f"  zstd level=22 over current payload:                    {len(zs):>12,} B  "
          f"({len(zs)/len(gzipped):.2%}, encoded in {time.time()-t:.1f}s)")

    # Replace the payload's int32-delta bodies with varint (LEB128) bodies
    # then compress.  Build a new logical "varint payload" that's the union of
    # all per-species deltas.
    deltas_concat = []
    for cell_ids in all_cell_ids_per_species:
        deltas = np.empty_like(cell_ids, dtype=np.uint32)
        if cell_ids.size:
            deltas[0] = cell_ids[0]
            if cell_ids.size > 1:
                np.subtract(cell_ids[1:], cell_ids[:-1], out=deltas[1:], dtype=np.uint32)
        deltas_concat.append(deltas)
    flat_deltas = np.concatenate(deltas_concat) if deltas_concat else np.zeros(0, dtype=np.uint32)
    int32_size = flat_deltas.size * 4
    varint_bytes = varint_encode(flat_deltas)
    print(f"  raw deltas as int32:                                   {int32_size:>12,} B")
    print(f"  raw deltas as LEB128 varint:                           {len(varint_bytes):>12,} B  "
          f"({len(varint_bytes)/int32_size:.2%} of int32)")

    t = time.time()
    vg = gzip.compress(varint_bytes, compresslevel=9)
    print(f"  varint + gzip:                                         {len(vg):>12,} B  "
          f"({len(vg)/len(gzipped):.2%} of current)")
    t = time.time()
    vb = brotli.compress(varint_bytes, quality=11)
    print(f"  varint + brotli q=11:                                  {len(vb):>12,} B  "
          f"({len(vb)/len(gzipped):.2%} of current, {time.time()-t:.1f}s)")
    t = time.time()
    vz = zstandard.ZstdCompressor(level=22).compress(varint_bytes)
    print(f"  varint + zstd level=22:                                {len(vz):>12,} B  "
          f"({len(vz)/len(gzipped):.2%} of current, {time.time()-t:.1f}s)")

    # Bit-packing: smallest fixed bit width that fits all deltas
    if flat_deltas.size:
        max_delta = int(flat_deltas.max())
        bits = max(1, int(np.ceil(np.log2(max_delta + 1))))
        bp_size = (flat_deltas.size * bits + 7) // 8
        print(f"  bit-packed (uniform {bits}-bit) deltas:                       {bp_size:>12,} B  "
              f"(theoretical max occupancy)")


def bench_smtx(url: str) -> None:
    blob = fetch(url)
    decoded = decode_species_matrix_bytes(blob)
    species_ids = [e.cell_ids for e in decoded.entries]
    bench_blob(f"smtx bundle: {url.rsplit('/', 1)[-1]} ({len(species_ids)} species)", blob, species_ids)


def bench_sparse(url: str) -> None:
    blob = fetch(url)
    artifact = decode_sparse_bytes(blob)
    bench_blob(f"sparse layer: {url.rsplit('/', 1)[-1]}", blob, [artifact.cell_ids])


def main() -> None:
    base = "https://aagibolq28slyfof.public.blob.vercel-storage.com"
    bench_smtx(f"{base}/inputs/features/species-sparse/species_threatened.smtx.gz")
    bench_smtx(f"{base}/inputs/features/species-sparse/species_birds.smtx.gz")
    bench_smtx(f"{base}/inputs/features/species-sparse/species_plants.smtx.gz")
    bench_sparse(f"{base}/inputs/features/biomass/aboveground_biomass_density.sparse.gz")
    bench_sparse(f"{base}/inputs/features/ecosystems/ecosistemas.sparse.gz")


if __name__ == "__main__":
    main()
