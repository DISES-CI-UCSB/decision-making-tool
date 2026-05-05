#!/usr/bin/env python3
"""Export compressed metric payloads for the JavaScript browser-style benchmark."""

from __future__ import annotations

import gzip
import importlib.util
import json
import shutil
import sys
from pathlib import Path

import numpy as np
from osgeo import gdal


REPO_ROOT = Path(__file__).resolve().parents[2]
ARTIFACT_DIR = REPO_ROOT / "scripts/browser-metric-benchmark/artifacts"
MANIFEST_PATH = ARTIFACT_DIR / "manifest.json"


def import_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


aoi_bench = import_module(
    "aoi_bench", REPO_ROOT / "scripts/aoi-layer-compression-benchmark/main.py"
)
species_bench = import_module(
    "species_bench", REPO_ROOT / "scripts/species-sparse-benchmark/main.py"
)


def gzip_write(path: Path, data: bytes) -> int:
    payload = gzip.compress(data, compresslevel=6)
    path.write_bytes(payload)
    return len(payload)


def valid_mask(array: np.ndarray, nodata: float | int | None) -> np.ndarray:
    valid = np.isfinite(array)
    if nodata is not None:
        if isinstance(nodata, float) and np.isnan(nodata):
            valid &= ~np.isnan(array)
        else:
            valid &= array != nodata
    valid &= np.abs(array) < 1e20
    return valid


def delta_bytes(indices: np.ndarray) -> bytes:
    if indices.size == 0:
        return b""
    deltas = np.diff(indices.astype(np.uint32, copy=False), prepend=np.uint32(0))
    return deltas.astype("<u4", copy=False).tobytes()


def dtype_name(array: np.ndarray) -> str:
    if array.dtype == np.dtype("uint8"):
        return "uint8"
    if array.dtype == np.dtype("int16"):
        return "int16"
    if array.dtype == np.dtype("uint16"):
        return "uint16"
    if array.dtype == np.dtype("int32"):
        return "int32"
    if array.dtype == np.dtype("uint32"):
        return "uint32"
    if array.dtype == np.dtype("float32"):
        return "float32"
    if array.dtype == np.dtype("float64"):
        return "float64"
    raise ValueError(f"Unsupported dtype for JS benchmark: {array.dtype}")


def json_nodata(nodata: float | int | None) -> float | int | None:
    if nodata is None:
        return None
    if isinstance(nodata, float) and np.isnan(nodata):
        return None
    return int(nodata) if float(nodata).is_integer() else float(nodata)


def export_layer_payload(layer_spec) -> dict:
    path = aoi_bench.resolve_layer_path(layer_spec, aoi_bench.CACHE_DIR, download=True)
    if path is None:
        raise RuntimeError(f"Missing layer {layer_spec.layer_id}")

    result = aoi_bench.benchmark_layer(layer_spec, path)
    dataset = gdal.Open(str(path))
    band = dataset.GetRasterBand(1)
    array = band.ReadAsArray()
    nodata = band.GetNoDataValue()
    valid = valid_mask(array, nodata)
    nonzero = valid & (array != 0)
    flat = array.ravel()

    layer_dir = ARTIFACT_DIR / "layers" / layer_spec.layer_id
    layer_dir.mkdir(parents=True, exist_ok=True)

    payload: dict = {
        "layerId": layer_spec.layer_id,
        "label": layer_spec.label,
        "metricGroup": layer_spec.metric_group,
        "valueKind": layer_spec.value_kind,
        "encoding": result.chosen_exact_payload_kind,
        "width": dataset.RasterXSize,
        "height": dataset.RasterYSize,
        "dtype": dtype_name(array),
        "nodata": json_nodata(nodata),
        "currentGeotiffBytes": result.file_bytes,
        "payloadBytes": 0,
        "nonzeroCells": result.nonzero_cells,
        "uniqueValueCount": result.unique_value_count,
    }

    if result.chosen_exact_payload_kind == "current_geotiff":
        out = layer_dir / "source.tif"
        shutil.copyfile(path, out)
        payload["files"] = {"geotiff": str(out.relative_to(ARTIFACT_DIR))}
        payload["payloadBytes"] = out.stat().st_size
        return payload

    if result.chosen_exact_payload_kind == "raw_array_gzip":
        out = layer_dir / "array.raw.gz"
        payload["payloadBytes"] = gzip_write(out, array.tobytes())
        payload["files"] = {"array": str(out.relative_to(ARTIFACT_DIR))}
        return payload

    if result.chosen_exact_payload_kind == "nonzero_index_value_gzip":
        indices = np.flatnonzero(nonzero.ravel()).astype(np.uint32, copy=False)
        values = flat[indices]
        delta_path = layer_dir / "index-deltas.u32.gz"
        value_path = layer_dir / "values.raw.gz"
        payload["files"] = {
            "indexDeltas": str(delta_path.relative_to(ARTIFACT_DIR)),
            "values": str(value_path.relative_to(ARTIFACT_DIR)),
        }
        payload["recordCount"] = int(indices.size)
        payload["payloadBytes"] = gzip_write(delta_path, delta_bytes(indices)) + gzip_write(
            value_path, values.tobytes()
        )
        return payload

    if result.chosen_exact_payload_kind == "by_value_delta_gzip":
        values_payload = []
        total_bytes = 0
        for value_index, value in enumerate(np.unique(array[nonzero])):
            indices = np.flatnonzero(flat == value).astype(np.uint32, copy=False)
            out = layer_dir / f"value-{value_index:03d}-deltas.u32.gz"
            total_bytes += gzip_write(out, delta_bytes(indices))
            values_payload.append(
                {
                    "value": float(value),
                    "count": int(indices.size),
                    "indexDeltas": str(out.relative_to(ARTIFACT_DIR)),
                }
            )
        payload["values"] = values_payload
        payload["payloadBytes"] = total_bytes
        return payload

    raise ValueError(result.chosen_exact_payload_kind)


def export_species_payload() -> dict:
    records = species_bench.select_records(
        species_bench.load_species_records(species_bench.DEFAULT_METADATA),
        "threatened-or-endemic",
    )
    species_dir = ARTIFACT_DIR / "species-threatened-endemic"
    species_dir.mkdir(parents=True, exist_ok=True)

    entries = []
    total_bytes = 0
    dimensions = None
    for record in records:
        path = species_bench.DEFAULT_SPECIES_DIR / record.filename
        if not path.exists():
            continue
        indices, (width, height), _nodata = species_bench.raster_presence_indices(path)
        if dimensions is None:
            dimensions = (width, height)
        out = species_dir / f"{len(entries):04d}-{Path(record.filename).stem}.u32.gz"
        total_bytes += gzip_write(out, delta_bytes(indices))
        entries.append(
            {
                "speciesId": record.species_id,
                "name": record.name,
                "filename": record.filename,
                "taxonClass": record.taxon_class,
                "threatStatus": record.threat_status,
                "endemicStatus": record.endemic_status,
                "presentCells": int(indices.size),
                "indexDeltas": str(out.relative_to(ARTIFACT_DIR)),
            }
        )

    width, height = dimensions or (0, 0)
    return {
        "subset": "threatened-or-endemic",
        "encoding": "species_sparse_delta_u32_gzip",
        "width": width,
        "height": height,
        "speciesCount": len(entries),
        "payloadBytes": total_bytes,
        "species": entries,
    }


def main() -> None:
    gdal.UseExceptions()
    if ARTIFACT_DIR.exists():
        shutil.rmtree(ARTIFACT_DIR)
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)

    layers = []
    for layer_spec in aoi_bench.LAYERS:
        print(f"Exporting {layer_spec.layer_id}")
        layers.append(export_layer_payload(layer_spec))

    print("Exporting threatened/endemic species sparse payload")
    species = export_species_payload()

    manifest = {
        "formatVersion": 1,
        "description": "Metric-ready compressed payloads for browser-style benchmark.",
        "layers": layers,
        "species": species,
        "totals": {
            "layerPayloadBytes": sum(layer["payloadBytes"] for layer in layers),
            "speciesPayloadBytes": species["payloadBytes"],
            "allPayloadBytes": sum(layer["payloadBytes"] for layer in layers)
            + species["payloadBytes"],
        },
    }
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"Wrote {MANIFEST_PATH}")
    print(json.dumps(manifest["totals"], indent=2))


if __name__ == "__main__":
    main()
