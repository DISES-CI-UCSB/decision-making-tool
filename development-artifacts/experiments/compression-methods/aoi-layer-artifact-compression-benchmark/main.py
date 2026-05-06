#!/usr/bin/env python3
"""Benchmark exact-ish compression options for AOI metric input layers.

The benchmark compares current GeoTIFF size against simple binary payloads that
could be decoded in a browser or Metrics API:

- gzip(raw array): whole raster array compressed as bytes
- gzip(nonzero index + value): sparse records for cells with nonzero values
- gzip(by-value delta indexes): categorical encoding, grouping cell IDs by value

The outputs are estimates for data movement and decode complexity, not a final
file format recommendation.
"""

from __future__ import annotations

import argparse
import gzip
import json
import math
import time
import urllib.request
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

import numpy as np
from osgeo import gdal


REPO_ROOT = Path(__file__).resolve().parents[4]
EXPERIMENT_DIR = Path(__file__).resolve().parent
CACHE_DIR = EXPERIMENT_DIR / "cache"
DEFAULT_OUTPUT = EXPERIMENT_DIR / "results.json"
PUBLIC_BLOB_HOST = "https://aagibolq28slyfof.public.blob.vercel-storage.com"


@dataclass(frozen=True)
class LayerSpec:
    layer_id: str
    label: str
    metric_group: str
    local_path: str | None
    blob_path: str | None
    value_kind: str
    notes: str = ""


@dataclass
class LayerResult:
    layer_id: str
    label: str
    metric_group: str
    value_kind: str
    path: str
    width: int
    height: int
    cells: int
    dtype: str
    nodata: float | int | None
    file_bytes: int
    valid_cells: int
    nonzero_cells: int
    unique_value_count: int
    raw_array_gzip_bytes: int
    nonzero_index_value_gzip_bytes: int
    by_value_delta_gzip_bytes: int | None
    chosen_exact_payload_bytes: int
    chosen_exact_payload_kind: str
    elapsed_seconds: float
    notes: str


LAYERS: list[LayerSpec] = [
    LayerSpec(
        "species_richness",
        "Species richness aggregate",
        "species",
        None,
        "inputs/features/species_richness/riqueza_especies.tif",
        "continuous",
    ),
    LayerSpec(
        "ecosystems",
        "Ecosystems",
        "ecosystems",
        "data/inputs/features/ecosystems/ecosistemas.tif",
        "inputs/features/ecosystems/ecosistemas.tif",
        "categorical",
    ),
    LayerSpec(
        "paramos",
        "Paramos",
        "ecosystems",
        "data/inputs/features/strategic/paramos.tif",
        "inputs/features/strategic/paramos.tif",
        "binary",
    ),
    LayerSpec(
        "mangroves",
        "Mangroves",
        "ecosystems",
        "data/inputs/features/strategic/mangroves.tif",
        "inputs/features/strategic/mangroves.tif",
        "binary",
    ),
    LayerSpec(
        "wetlands",
        "Wetlands",
        "ecosystems",
        "data/inputs/features/strategic/humedales.tif",
        "inputs/features/strategic/humedales.tif",
        "binary",
    ),
    LayerSpec(
        "dry_forest",
        "Dry forest",
        "ecosystems",
        "data/inputs/features/strategic/bosque_seco.tif",
        "inputs/features/strategic/bosque_seco.tif",
        "binary",
    ),
    LayerSpec(
        "biomass",
        "Above + below-ground biomass",
        "carbon",
        None,
        "inputs/features/biomass/biomasa_areara%2Bsubterranea_1km.tif",
        "continuous",
    ),
    LayerSpec(
        "soil_carbon",
        "Soil organic carbon",
        "carbon",
        None,
        "inputs/features/carbon/carbono_organico.tif",
        "continuous",
    ),
    LayerSpec(
        "groundwater_recharge",
        "Groundwater recharge",
        "water",
        None,
        "inputs/features/ground_water_recharge/recarga_agua_subterranea_moderado_alto.tif",
        "binary",
    ),
    LayerSpec(
        "net_benefit",
        "Net benefit / ag opportunity cost",
        "cost",
        "data/inputs/costs/net_benefit.tif",
        "inputs/costs/net_benefit.tif",
        "continuous",
    ),
    LayerSpec(
        "conflict",
        "Conflict",
        "conflict",
        "data/inputs/costs/conflict.tif",
        "inputs/costs/conflict.tif",
        "continuous",
    ),
    LayerSpec(
        "human_footprint_2030",
        "Human footprint 2030",
        "context",
        "data/inputs/costs/human_footprint_2030.tif",
        "inputs/costs/human_footprint_2030.tif",
        "continuous",
    ),
    LayerSpec(
        "runap",
        "RUNAP protected areas",
        "protection",
        "data/inputs/includes/runap_protected_areas.tif",
        "inputs/includes/runap_protected_areas.tif",
        "categorical",
    ),
    LayerSpec(
        "comunidades",
        "Afro-Colombian communities",
        "cultural",
        "data/inputs/includes/comunidades.tif",
        "inputs/includes/comunidades.tif",
        "binary",
    ),
    LayerSpec(
        "resguardos",
        "Indigenous reserves",
        "cultural",
        "data/inputs/includes/resguardos.tif",
        "inputs/includes/resguardos.tif",
        "binary",
    ),
    LayerSpec(
        "omecs",
        "OMECs",
        "protection",
        "data/inputs/includes/omecs.tif",
        "inputs/includes/omecs.tif",
        "categorical",
    ),
]


def gzip_size(data: bytes) -> int:
    return len(gzip.compress(data, compresslevel=6))


def resolve_layer_path(spec: LayerSpec, cache_dir: Path, download: bool) -> Path | None:
    if spec.local_path:
        local = REPO_ROOT / spec.local_path
        if local.exists():
            return local

    if not spec.blob_path:
        return None

    filename = spec.blob_path.split("/")[-1].replace("%2B", "+")
    cached = cache_dir / filename
    if cached.exists():
        return cached

    if not download:
        return None

    cache_dir.mkdir(parents=True, exist_ok=True)
    url = f"{PUBLIC_BLOB_HOST}/{spec.blob_path}"
    print(f"Downloading {spec.layer_id} from {url}")
    with urllib.request.urlopen(url, timeout=120) as response:
        cached.write_bytes(response.read())
    return cached


def unique_count(array: np.ndarray, valid: np.ndarray, cap: int = 1_000_000) -> int:
    values = array[valid]
    if values.size > cap:
        values = values[:cap]
    return int(np.unique(values).size)


def delta_bytes(indices: np.ndarray) -> bytes:
    if indices.size == 0:
        return b""
    deltas = np.diff(indices.astype(np.uint32, copy=False), prepend=np.uint32(0))
    return deltas.astype("<u4", copy=False).tobytes()


def nonzero_index_value_payload(array: np.ndarray, nonzero: np.ndarray) -> bytes:
    flat = array.ravel()
    indices = np.flatnonzero(nonzero.ravel()).astype(np.uint32, copy=False)
    values = flat[indices]
    return delta_bytes(indices) + values.tobytes()


def by_value_delta_payload_size(array: np.ndarray, nonzero: np.ndarray, max_values: int = 512) -> int | None:
    values = np.unique(array[nonzero])
    if values.size > max_values:
        return None

    flat = array.ravel()
    payload = bytearray()
    # Store a tiny self-describing header estimate: value count and each value.
    payload.extend(int(values.size).to_bytes(4, "little"))
    for value in values:
        value_bytes = np.asarray([value], dtype=array.dtype).tobytes()
        payload.extend(len(value_bytes).to_bytes(1, "little"))
        payload.extend(value_bytes)
        indices = np.flatnonzero(flat == value).astype(np.uint32, copy=False)
        encoded = delta_bytes(indices)
        payload.extend(len(encoded).to_bytes(4, "little"))
        payload.extend(encoded)
    return gzip_size(bytes(payload))


def benchmark_layer(spec: LayerSpec, path: Path) -> LayerResult:
    started = time.perf_counter()
    dataset = gdal.Open(str(path))
    if dataset is None:
        raise RuntimeError(f"GDAL could not open {path}")

    band = dataset.GetRasterBand(1)
    array = band.ReadAsArray()
    nodata = band.GetNoDataValue()
    valid = np.isfinite(array)
    if nodata is not None:
        if isinstance(nodata, float) and math.isnan(nodata):
            valid &= ~np.isnan(array)
        else:
            valid &= array != nodata
    # Some collaborator GeoTIFFs rely on extreme sentinels rather than a clean
    # nodata tag. Exclude them from sparse summaries so they do not become data.
    valid &= np.abs(array) < 1e20
    nonzero = valid & (array != 0)

    raw_array_gzip = gzip_size(array.tobytes())
    nonzero_gzip = gzip_size(nonzero_index_value_payload(array, nonzero))
    by_value_gzip = by_value_delta_payload_size(array, nonzero)

    candidates: list[tuple[str, int]] = [
        ("current_geotiff", path.stat().st_size),
        ("raw_array_gzip", raw_array_gzip),
        ("nonzero_index_value_gzip", nonzero_gzip),
    ]
    if by_value_gzip is not None:
        candidates.append(("by_value_delta_gzip", by_value_gzip))

    chosen_kind, chosen_bytes = min(candidates, key=lambda item: item[1])

    return LayerResult(
        layer_id=spec.layer_id,
        label=spec.label,
        metric_group=spec.metric_group,
        value_kind=spec.value_kind,
        path=str(path.relative_to(REPO_ROOT) if path.is_relative_to(REPO_ROOT) else path),
        width=int(dataset.RasterXSize),
        height=int(dataset.RasterYSize),
        cells=int(dataset.RasterXSize * dataset.RasterYSize),
        dtype=str(array.dtype),
        nodata=None if nodata is None else int(nodata) if float(nodata).is_integer() else float(nodata),
        file_bytes=int(path.stat().st_size),
        valid_cells=int(valid.sum()),
        nonzero_cells=int(nonzero.sum()),
        unique_value_count=unique_count(array, valid),
        raw_array_gzip_bytes=raw_array_gzip,
        nonzero_index_value_gzip_bytes=nonzero_gzip,
        by_value_delta_gzip_bytes=by_value_gzip,
        chosen_exact_payload_bytes=chosen_bytes,
        chosen_exact_payload_kind=chosen_kind,
        elapsed_seconds=round(time.perf_counter() - started, 3),
        notes=spec.notes,
    )


def mb(size: int | None) -> float | None:
    if size is None:
        return None
    return round(size / 1024 / 1024, 2)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--cache-dir", type=Path, default=CACHE_DIR)
    parser.add_argument("--no-download", action="store_true")
    args = parser.parse_args()

    gdal.UseExceptions()
    results: list[LayerResult] = []
    missing: list[str] = []

    for spec in LAYERS:
        path = resolve_layer_path(spec, args.cache_dir, download=not args.no_download)
        if path is None:
            print(f"Missing {spec.layer_id}")
            missing.append(spec.layer_id)
            continue
        print(f"Benchmarking {spec.layer_id} ({path})")
        results.append(benchmark_layer(spec, path))

    payload: dict[str, Any] = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "missing_layers": missing,
        "layers": [asdict(result) for result in results],
        "totals": {
            "current_geotiff_bytes": sum(result.file_bytes for result in results),
            "chosen_exact_payload_bytes": sum(result.chosen_exact_payload_bytes for result in results),
            "raw_array_gzip_bytes": sum(result.raw_array_gzip_bytes for result in results),
            "nonzero_index_value_gzip_bytes": sum(
                result.nonzero_index_value_gzip_bytes for result in results
            ),
        },
    }
    args.output.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    print("\nLayer results")
    for result in results:
        print(
            f"{result.layer_id}: current={mb(result.file_bytes)} MB, "
            f"best={mb(result.chosen_exact_payload_bytes)} MB ({result.chosen_exact_payload_kind}), "
            f"nonzero={result.nonzero_cells:,}, unique={result.unique_value_count}"
        )

    totals = payload["totals"]
    print("\nTotals")
    print(f"Current GeoTIFFs: {mb(totals['current_geotiff_bytes'])} MB")
    print(f"Best exact payloads: {mb(totals['chosen_exact_payload_bytes'])} MB")
    ratio = totals["chosen_exact_payload_bytes"] / totals["current_geotiff_bytes"]
    print(f"Ratio: {ratio:.3f}x")
    print(f"Wrote {args.output}")


if __name__ == "__main__":
    main()
