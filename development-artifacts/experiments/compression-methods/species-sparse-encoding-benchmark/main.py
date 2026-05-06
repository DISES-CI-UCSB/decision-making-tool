#!/usr/bin/env python3
"""Benchmark sparse encodings for DISES species presence rasters.

This script answers a narrow architecture question: if we filter the species
stack to threatened and/or endemic species, how much smaller could a sparse
presence index be than the current compressed GeoTIFF files?

It intentionally uses only Python stdlib plus GDAL/numpy, which are already
available in the local environment.
"""

from __future__ import annotations

import argparse
import gzip
import json
import math
import struct
import time
import xml.etree.ElementTree as ET
from collections import Counter
from dataclasses import asdict, dataclass
from pathlib import Path
from zipfile import ZipFile

import numpy as np
from osgeo import gdal


REPO_ROOT = Path(__file__).resolve().parents[4]
EXPERIMENT_DIR = Path(__file__).resolve().parent
DEFAULT_METADATA = REPO_ROOT / "data/archive/metadata/features_v4_4_24_(MAPV).xlsx"
DEFAULT_SPECIES_DIR = REPO_ROOT / "data/inputs/features/species"
DEFAULT_OUTPUT = EXPERIMENT_DIR / "results.json"

XLSX_NS = {"a": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
THREATENED_CODES = {"CR", "EN", "VU"}


@dataclass(frozen=True)
class SpeciesRecord:
    species_id: str
    name: str
    taxon_class: str
    threat_status: str
    endemic_status: str
    filename: str


@dataclass
class BenchmarkTotals:
    species_count: int = 0
    missing_files: int = 0
    geotiff_bytes: int = 0
    present_cells: int = 0
    uint32_cell_id_bytes: int = 0
    delta_varint_bytes: int = 0
    gzip_uint32_cell_id_bytes: int = 0
    gzip_delta_uint32_bytes: int = 0
    elapsed_seconds: float = 0.0


def column_index(cell_reference: str) -> int:
    letters = "".join(char for char in cell_reference if char.isalpha())
    index = 0
    for char in letters:
        index = index * 26 + ord(char.upper()) - 64
    return index - 1


def load_xlsx_rows(path: Path) -> list[dict[str, str | None]]:
    with ZipFile(path) as archive:
        shared_strings: list[str] = []
        shared_root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
        for item in shared_root.findall("a:si", XLSX_NS):
            shared_strings.append("".join(text.text or "" for text in item.findall(".//a:t", XLSX_NS)))

        sheet_root = ET.fromstring(archive.read("xl/worksheets/sheet1.xml"))
        rows: list[list[str | None]] = []
        for row in sheet_root.findall("a:sheetData/a:row", XLSX_NS):
            values: list[str | None] = []
            for cell in row.findall("a:c", XLSX_NS):
                index = column_index(cell.attrib.get("r", "A1"))
                while len(values) <= index:
                    values.append(None)

                raw_value = cell.find("a:v", XLSX_NS)
                if raw_value is None:
                    value = None
                elif cell.attrib.get("t") == "s":
                    value = shared_strings[int(raw_value.text or "0")]
                else:
                    value = raw_value.text
                values[index] = value
            rows.append(values)

    headers = rows[0]
    return [
        {str(headers[index]): row[index] if index < len(row) else None for index in range(len(headers))}
        for row in rows[1:]
    ]


def species_filename(archivo: str | None) -> str:
    if not archivo:
        return ""
    return Path(archivo.replace("\\", "/")).name


def load_species_records(metadata_path: Path) -> list[SpeciesRecord]:
    rows = load_xlsx_rows(metadata_path)
    records: list[SpeciesRecord] = []
    for row in rows:
        if row.get("id_elemento_priorizacion") != "21":
            continue
        filename = species_filename(row.get("archivo"))
        if not filename:
            continue
        records.append(
            SpeciesRecord(
                species_id=row.get("id") or "",
                name=row.get("name") or "",
                taxon_class=row.get("class") or "",
                threat_status=(row.get("amenaza") or "").strip(),
                endemic_status=(row.get("endemica") or "").strip(),
                filename=filename,
            )
        )
    return records


def select_records(records: list[SpeciesRecord], subset: str) -> list[SpeciesRecord]:
    def is_threatened(record: SpeciesRecord) -> bool:
        return record.threat_status.upper() in THREATENED_CODES

    def is_endemic(record: SpeciesRecord) -> bool:
        return bool(record.endemic_status)

    if subset == "threatened":
        return [record for record in records if is_threatened(record)]
    if subset == "endemic":
        return [record for record in records if is_endemic(record)]
    if subset == "threatened-or-endemic":
        return [record for record in records if is_threatened(record) or is_endemic(record)]
    if subset == "all":
        return records
    raise ValueError(f"Unsupported subset: {subset}")


def varint_byte_count(values: np.ndarray) -> int:
    """Return bytes needed by unsigned LEB128-style varints for uint deltas."""
    if values.size == 0:
        return 0
    counts = np.ones(values.shape, dtype=np.uint8)
    counts += values >= 1 << 7
    counts += values >= 1 << 14
    counts += values >= 1 << 21
    counts += values >= 1 << 28
    return int(counts.sum())


def raster_presence_indices(path: Path) -> tuple[np.ndarray, tuple[int, int], int | None]:
    dataset = gdal.Open(str(path))
    if dataset is None:
        raise RuntimeError(f"GDAL could not open {path}")

    band = dataset.GetRasterBand(1)
    nodata = band.GetNoDataValue()
    array = band.ReadAsArray()

    if nodata is None:
        present = array > 0
    else:
        present = (array > 0) & (array != nodata)

    indices = np.flatnonzero(present.ravel()).astype(np.uint32, copy=False)
    return indices, (dataset.RasterXSize, dataset.RasterYSize), None if nodata is None else int(nodata)


def gzip_size(data: bytes) -> int:
    return len(gzip.compress(data, compresslevel=6))


def benchmark(records: list[SpeciesRecord], species_dir: Path, sample_limit: int | None) -> dict[str, object]:
    selected = records[:sample_limit] if sample_limit else records
    totals = BenchmarkTotals(species_count=len(selected))
    taxon_counts = Counter(record.taxon_class or "(blank)" for record in selected)
    threat_counts = Counter(record.threat_status or "(blank)" for record in selected)
    endemic_counts = Counter(record.endemic_status or "(blank)" for record in selected)
    dimensions: Counter[str] = Counter()
    nodata_values: Counter[str] = Counter()
    per_species_examples: list[dict[str, object]] = []

    started = time.perf_counter()
    for index, record in enumerate(selected, start=1):
        raster_path = species_dir / record.filename
        if not raster_path.exists():
            totals.missing_files += 1
            continue

        indices, (width, height), nodata = raster_presence_indices(raster_path)
        present_count = int(indices.size)
        geotiff_bytes = raster_path.stat().st_size
        raw_uint32 = indices.astype("<u4", copy=False).tobytes()
        deltas = np.diff(indices, prepend=np.uint32(0)).astype(np.uint32, copy=False)
        raw_delta_uint32 = deltas.astype("<u4", copy=False).tobytes()

        uint32_bytes = present_count * 4
        delta_varint_bytes = varint_byte_count(deltas)
        gzip_uint32_bytes = gzip_size(raw_uint32)
        gzip_delta_uint32_bytes = gzip_size(raw_delta_uint32)

        totals.geotiff_bytes += geotiff_bytes
        totals.present_cells += present_count
        totals.uint32_cell_id_bytes += uint32_bytes
        totals.delta_varint_bytes += delta_varint_bytes
        totals.gzip_uint32_cell_id_bytes += gzip_uint32_bytes
        totals.gzip_delta_uint32_bytes += gzip_delta_uint32_bytes
        dimensions[f"{width}x{height}"] += 1
        nodata_values[str(nodata)] += 1

        if len(per_species_examples) < 10:
            per_species_examples.append(
                {
                    "filename": record.filename,
                    "name": record.name,
                    "taxon_class": record.taxon_class,
                    "threat_status": record.threat_status,
                    "endemic_status": record.endemic_status,
                    "geotiff_bytes": geotiff_bytes,
                    "present_cells": present_count,
                    "uint32_cell_id_bytes": uint32_bytes,
                    "delta_varint_bytes": delta_varint_bytes,
                    "gzip_uint32_cell_id_bytes": gzip_uint32_bytes,
                    "gzip_delta_uint32_bytes": gzip_delta_uint32_bytes,
                }
            )

        if index % 50 == 0:
            print(f"Processed {index}/{len(selected)} species...")

    totals.elapsed_seconds = round(time.perf_counter() - started, 3)
    cell_count = 0
    if dimensions:
        first_dimension = dimensions.most_common(1)[0][0]
        width, height = (int(part) for part in first_dimension.split("x"))
        cell_count = width * height

    dense_bitset_bytes = math.ceil((cell_count * max(0, totals.species_count - totals.missing_files)) / 8)

    return {
        "totals": asdict(totals),
        "dense_cell_by_species_bitset_bytes": dense_bitset_bytes,
        "dimensions": dict(dimensions),
        "nodata_values": dict(nodata_values),
        "taxon_counts": dict(taxon_counts),
        "threat_counts": dict(threat_counts),
        "endemic_counts": dict(endemic_counts),
        "per_species_examples": per_species_examples,
        "size_ratios_vs_geotiff": {
            "uint32_cell_ids": safe_ratio(totals.uint32_cell_id_bytes, totals.geotiff_bytes),
            "delta_varint": safe_ratio(totals.delta_varint_bytes, totals.geotiff_bytes),
            "gzip_uint32_cell_ids": safe_ratio(totals.gzip_uint32_cell_id_bytes, totals.geotiff_bytes),
            "gzip_delta_uint32": safe_ratio(totals.gzip_delta_uint32_bytes, totals.geotiff_bytes),
            "dense_bitset": safe_ratio(dense_bitset_bytes, totals.geotiff_bytes),
        },
    }


def safe_ratio(numerator: int, denominator: int) -> float | None:
    if denominator == 0:
        return None
    return round(numerator / denominator, 3)


def mb(size_bytes: int) -> float:
    return round(size_bytes / 1024 / 1024, 2)


def print_summary(subset: str, result: dict[str, object]) -> None:
    totals = result["totals"]
    assert isinstance(totals, dict)
    print(f"\nSubset: {subset}")
    print(f"Species processed: {totals['species_count'] - totals['missing_files']} / {totals['species_count']}")
    print(f"Elapsed seconds: {totals['elapsed_seconds']}")
    print(f"Current compressed GeoTIFFs: {mb(int(totals['geotiff_bytes']))} MB")
    print(f"Dense cell x species bitset: {mb(int(result['dense_cell_by_species_bitset_bytes']))} MB")
    print(f"Sparse uint32 cell IDs: {mb(int(totals['uint32_cell_id_bytes']))} MB")
    print(f"Sparse delta varints: {mb(int(totals['delta_varint_bytes']))} MB")
    print(f"Gzip sparse uint32 cell IDs: {mb(int(totals['gzip_uint32_cell_id_bytes']))} MB")
    print(f"Gzip sparse delta uint32: {mb(int(totals['gzip_delta_uint32_bytes']))} MB")
    print("Ratios vs current GeoTIFF bytes:")
    for key, value in result["size_ratios_vs_geotiff"].items():
        print(f"  {key}: {value}x")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--metadata", type=Path, default=DEFAULT_METADATA)
    parser.add_argument("--species-dir", type=Path, default=DEFAULT_SPECIES_DIR)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument(
        "--subset",
        choices=["threatened", "endemic", "threatened-or-endemic", "all"],
        default="threatened-or-endemic",
    )
    parser.add_argument("--sample-limit", type=int, default=None)
    args = parser.parse_args()

    gdal.UseExceptions()
    records = select_records(load_species_records(args.metadata), args.subset)
    result = benchmark(records, args.species_dir, args.sample_limit)

    payload = {
        "metadata_path": str(args.metadata),
        "species_dir": str(args.species_dir),
        "subset": args.subset,
        "sample_limit": args.sample_limit,
        "result": result,
    }
    args.output.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print_summary(args.subset, result)
    print(f"\nWrote {args.output}")


if __name__ == "__main__":
    main()
