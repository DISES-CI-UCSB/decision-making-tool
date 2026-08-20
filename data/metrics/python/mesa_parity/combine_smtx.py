"""Combine compatible SMSP bundles without materializing their cell IDs."""

from __future__ import annotations

import argparse
import gzip
import json
import shutil
import struct
from pathlib import Path
from typing import Any

SMSP_MAGIC = b"SMSP"


def _read_toc(path: Path) -> tuple[dict[str, Any], int]:
    with gzip.open(path, "rb") as handle:
        header = handle.read(8)
        if len(header) != 8 or header[:4] != SMSP_MAGIC:
            raise ValueError(f"Invalid SMSP bundle: {path}")
        toc_length = struct.unpack_from("<I", header, 4)[0]
        toc = json.loads(handle.read(toc_length).decode("utf-8"))
    body_bytes = sum(int(entry["count"]) * 4 for entry in toc.get("species") or [])
    return toc, body_bytes


def combine(inputs: list[Path], output: Path) -> dict[str, Any]:
    if len(inputs) < 2:
        raise ValueError("At least two input bundles are required.")
    documents = [_read_toc(path) for path in inputs]
    grid = documents[0][0].get("grid") or {}
    if any((toc.get("grid") or {}) != grid for toc, _ in documents[1:]):
        raise ValueError("SMSP input grids differ.")

    species: list[dict[str, Any]] = []
    names: set[str] = set()
    cursor = 0
    for toc, _ in documents:
        for source in toc.get("species") or []:
            name = str(source["name"])
            if name in names:
                raise ValueError(f"Duplicate species across bundles: {name}")
            names.add(name)
            entry = dict(source)
            entry["offset"] = cursor
            cursor += int(entry["count"]) * 4
            species.append(entry)

    toc_raw = json.dumps(
        {"grid": grid, "species": species},
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")
    output.parent.mkdir(parents=True, exist_ok=True)
    with gzip.GzipFile(
        filename=str(output),
        mode="wb",
        compresslevel=1,
        mtime=0,
    ) as destination:
        destination.write(SMSP_MAGIC)
        destination.write(struct.pack("<I", len(toc_raw)))
        destination.write(toc_raw)
        for path, (source_toc, body_bytes) in zip(inputs, documents, strict=True):
            with gzip.open(path, "rb") as source:
                source_header = source.read(8)
                source_toc_length = struct.unpack_from("<I", source_header, 4)[0]
                source.read(source_toc_length)
                shutil.copyfileobj(source, destination, length=1024 * 1024)
            expected = sum(
                int(entry["count"]) * 4
                for entry in source_toc.get("species") or []
            )
            if expected != body_bytes:
                raise AssertionError("SMSP body accounting changed during combination.")
    return {
        "format": "mesa-smsp-combine-report-v1",
        "inputs": [str(path) for path in inputs],
        "output": str(output),
        "speciesCount": len(species),
        "cellReferenceCount": cursor // 4,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, action="append", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(combine(args.input, args.output), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
