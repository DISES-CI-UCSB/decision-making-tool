"""Build aligned, display-safe COGs on the canonical land solution grid."""

from __future__ import annotations

import argparse
import hashlib
import json
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from species_builder import (
    DEFAULT_CATALOG_URL,
    DEFAULT_OUTPUT_DIR as SPECIES_OUTPUT_DIR,
    parse_species_shard,
    run_batch_3a,
    run_full_species_catalog,
    run_species_preflight,
)


REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_OUTPUT_DIR = REPO_ROOT / "data/metrics/generated/view-layer-cogs"
LAND_TEMPLATE_URL = (
    "https://aagibolq28slyfof.public.blob.vercel-storage.com/"
    "releases/solutions-v3-0-0/inputs/mesa/"
    "template_terrestre-4WWWG3Y3cQaPYv5aycJJhXeGiwgTUL.tif"
)


@dataclass(frozen=True)
class ViewLayer:
    layer_id: str
    source_url: str
    output_name: str
    expected_values: frozenset[int] | None = None
    expected_dtype: str | None = None
    expected_nodata: float | None = None
    expected_min: float | None = None
    expected_max: float | None = None
    # Mask layers keep only `presence_value` as real data and drop everything
    # else to NoData. See `build_layer` for why that matters to the renderer.
    presence_value: int | None = None


VIEW_LAYERS = {
    layer.layer_id: layer
    for layer in (
        ViewLayer(
            layer_id="species-richness",
            source_url=(
                "https://aagibolq28slyfof.public.blob.vercel-storage.com/"
                "inputs/features/species_richness/riqueza_especies.tif"
            ),
            output_name="riqueza_especies.epsg9377.cog.tif",
            expected_dtype="float32",
            expected_nodata=float("nan"),
            expected_min=1,
            expected_max=3806,
        ),
        ViewLayer(
            layer_id="species-richness-mammals",
            source_url=(
                "https://aagibolq28slyfof.public.blob.vercel-storage.com/"
                "inputs/features/species_richness/riqueza_especies_mammals.tif"
            ),
            output_name="riqueza_especies_mammals.epsg9377.cog.tif",
            expected_dtype="uint16",
            expected_nodata=65535,
            expected_min=1,
            expected_max=142,
        ),
        ViewLayer(
            layer_id="species-richness-birds",
            source_url=(
                "https://aagibolq28slyfof.public.blob.vercel-storage.com/"
                "inputs/features/species_richness/riqueza_especies_birds.tif"
            ),
            output_name="riqueza_especies_birds.epsg9377.cog.tif",
            expected_dtype="uint16",
            expected_nodata=65535,
            expected_min=1,
            expected_max=823,
        ),
        ViewLayer(
            layer_id="species-richness-amphibians",
            source_url=(
                "https://aagibolq28slyfof.public.blob.vercel-storage.com/"
                "inputs/features/species_richness/riqueza_especies_amphibians.tif"
            ),
            output_name="riqueza_especies_amphibians.epsg9377.cog.tif",
            expected_dtype="uint16",
            expected_nodata=65535,
            expected_min=1,
            expected_max=56,
        ),
        ViewLayer(
            layer_id="species-richness-reptiles",
            source_url=(
                "https://aagibolq28slyfof.public.blob.vercel-storage.com/"
                "inputs/features/species_richness/riqueza_especies_reptiles.tif"
            ),
            output_name="riqueza_especies_reptiles.epsg9377.cog.tif",
            expected_dtype="uint16",
            expected_nodata=65535,
            expected_min=1,
            expected_max=68,
        ),
        ViewLayer(
            layer_id="species-richness-plants",
            source_url=(
                "https://aagibolq28slyfof.public.blob.vercel-storage.com/"
                "inputs/features/species_richness/riqueza_especies_plants.tif"
            ),
            output_name="riqueza_especies_plants.epsg9377.cog.tif",
            expected_dtype="uint16",
            expected_nodata=65535,
            expected_min=1,
            expected_max=2884,
        ),
        ViewLayer(
            layer_id="alouatta-palliata",
            source_url=(
                "https://aagibolq28slyfof.public.blob.vercel-storage.com/"
                "inputs/features/species/Alouatta_palliata_10_MAXENT.tif"
            ),
            output_name="Alouatta_palliata_10_MAXENT.epsg9377.cog.tif",
            expected_values=frozenset({0, 1}),
            presence_value=1,
        ),
        ViewLayer(
            layer_id="comunidades",
            source_url=(
                "https://aagibolq28slyfof.public.blob.vercel-storage.com/"
                "inputs/includes/comunidades.tif"
            ),
            output_name="comunidades.epsg9377.cog.tif",
            expected_values=frozenset({0, 1}),
            presence_value=1,
        ),
        ViewLayer(
            layer_id="resguardos",
            source_url=(
                "https://aagibolq28slyfof.public.blob.vercel-storage.com/"
                "inputs/includes/resguardos.tif"
            ),
            output_name="resguardos.epsg9377.cog.tif",
            expected_values=frozenset({0, 1}),
            presence_value=1,
        ),
        ViewLayer(
            layer_id="paramos",
            source_url=(
                "https://aagibolq28slyfof.public.blob.vercel-storage.com/"
                "inputs/features/strategic/paramos.tif"
            ),
            output_name="paramos.epsg9377.cog.tif",
            expected_values=frozenset({1, 2}),
            presence_value=1,
        ),
        ViewLayer(
            layer_id="wetlands",
            source_url=(
                "https://aagibolq28slyfof.public.blob.vercel-storage.com/"
                "inputs/features/strategic/humedales.tif"
            ),
            output_name="humedales.epsg9377.cog.tif",
            expected_values=frozenset({1, 2}),
            presence_value=1,
        ),
        ViewLayer(
            layer_id="bosque_seco",
            source_url=(
                "https://aagibolq28slyfof.public.blob.vercel-storage.com/"
                "inputs/features/strategic/bosque_seco.tif"
            ),
            output_name="bosque_seco.epsg9377.cog.tif",
            expected_values=frozenset({1}),
            presence_value=1,
        ),
        ViewLayer(
            layer_id="mangroves",
            source_url=(
                "https://aagibolq28slyfof.public.blob.vercel-storage.com/"
                "inputs/features/strategic/mangroves.tif"
            ),
            output_name="mangroves.epsg9377.cog.tif",
            expected_values=frozenset({0, 1}),
            presence_value=1,
        ),
    )
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--layer",
        action="append",
        choices=sorted(VIEW_LAYERS),
        help="View layer to build. Repeatable; defaults to every configured layer.",
    )
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--force-download", action="store_true")
    parser.add_argument(
        "--species-dry-run",
        action="store_true",
        help="Catalog-only Batch 3 preflight; do not build or upload display COGs.",
    )
    parser.add_argument(
        "--species-benchmark-100",
        action="store_true",
        help="Build a deterministic 100-species local-only cross-taxon Batch 3 benchmark.",
    )
    parser.add_argument(
        "--species-batch-3a",
        action="store_true",
        help="Build the authorized 600-record mammal, amphibian, and reptile batch.",
    )
    parser.add_argument(
        "--species-full-catalog",
        action="store_true",
        help="Build every available non-fish source in the authoritative catalog.",
    )
    parser.add_argument(
        "--publish",
        action="store_true",
        help="Publish Batch 3A COGs to their immutable release pathnames after validation.",
    )
    parser.add_argument(
        "--species-workers",
        type=int,
        default=4,
        help="Bounded concurrent workers for --species-full-catalog (default: 4).",
    )
    parser.add_argument(
        "--species-shard",
        help="Taxon-local half-open filename range: taxon:START:END (for example plants:A:G).",
    )
    parser.add_argument(
        "--species-output-dir",
        type=Path,
        default=SPECIES_OUTPUT_DIR,
        help="Local-only Batch 3 benchmark directory.",
    )
    parser.add_argument("--species-catalog-url", default=DEFAULT_CATALOG_URL)
    parser.add_argument("--species-template-url", default=LAND_TEMPLATE_URL)
    args = parser.parse_args()
    modes = sum((
        args.species_dry_run,
        args.species_benchmark_100,
        args.species_batch_3a,
        args.species_full_catalog,
    ))
    if modes > 1:
        parser.error("species modes are mutually exclusive")
    if args.publish and not (args.species_batch_3a or args.species_full_catalog):
        parser.error("--publish requires a build mode")
    if args.species_shard and not args.species_full_catalog:
        parser.error("--species-shard requires --species-full-catalog")
    return args


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def download(url: str, destination: Path, force: bool) -> Path:
    if destination.exists() and not force:
        return destination
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(f"{destination.suffix}.download")
    temporary.unlink(missing_ok=True)
    urllib.request.urlretrieve(url, temporary)
    temporary.replace(destination)
    return destination


def build_layer(
    layer: ViewLayer,
    *,
    template_path: Path,
    cache_dir: Path,
    output_dir: Path,
    force_download: bool,
) -> dict[str, object]:
    import numpy as np
    import rasterio
    from rasterio.enums import ColorInterp, Resampling
    from rasterio.shutil import copy as rasterio_copy
    from rasterio.warp import reproject

    source_path = download(
        layer.source_url,
        cache_dir / Path(urllib.parse.urlparse(layer.source_url).path).name,
        force_download,
    )
    output_path = output_dir / layer.output_name
    intermediate_path = output_path.with_suffix(".aligned.tif")
    output_path.parent.mkdir(parents=True, exist_ok=True)

    with rasterio.open(template_path) as template, rasterio.open(source_path) as source:
        if source.crs is None:
            raise ValueError(f"{layer.layer_id}: source raster has no CRS")
        source_band = source.read(1, masked=True)
        source_values = source_band.compressed()
        source_min = float(source_values.min())
        source_max = float(source_values.max())
        source_dtype = source.dtypes[0]
        source_nodata = source.nodata
        if layer.expected_dtype and source_dtype != layer.expected_dtype:
            raise ValueError(f"{layer.layer_id}: source dtype {source_dtype}, expected {layer.expected_dtype}")
        if layer.expected_nodata is not None:
            expected_nodata_is_nan = np.isnan(layer.expected_nodata)
            actual_nodata_is_nan = source_nodata is not None and np.isnan(source_nodata)
            if not (
                (expected_nodata_is_nan and actual_nodata_is_nan)
                or source_nodata == layer.expected_nodata
            ):
                raise ValueError(
                    f"{layer.layer_id}: source NoData {source_nodata}, expected {layer.expected_nodata}"
                )
        if layer.expected_min is not None and source_min != layer.expected_min:
            raise ValueError(f"{layer.layer_id}: source minimum {source_min}, expected {layer.expected_min}")
        if layer.expected_max is not None and source_max != layer.expected_max:
            raise ValueError(f"{layer.layer_id}: source maximum {source_max}, expected {layer.expected_max}")

        output_dtype = np.dtype(source_dtype)
        destination = np.full(
            (template.height, template.width),
            source.nodata if source.nodata is not None else 0,
            dtype=output_dtype,
        )
        reproject(
            source=rasterio.band(source, 1),
            destination=destination,
            src_transform=source.transform,
            src_crs=source.crs,
            src_nodata=source.nodata,
            dst_transform=template.transform,
            dst_crs=template.crs,
            dst_nodata=source.nodata,
            resampling=Resampling.nearest,
            init_dest_nodata=True,
        )

        profile = source.profile.copy()
        if layer.presence_value is None:
            display_array = destination
            display_dtype, display_nodata = output_dtype.name, source_nodata
        else:
            # Float32 + NaN NoData, single grayscale band, no colour palette:
            # this is byte-for-byte the same shape of artefact as the solution
            # display COGs, which are the only rasters known to render
            # correctly through ImageryTileLayer in this app. Absence (0) is
            # deliberately collapsed into NoData so that *every* non-presence
            # cell is unpaintable — if ArcGIS ever falls back to its default
            # stretch renderer, the layer stays sparse instead of flooding the
            # country with colour. The source raster keeps its 0/1/255 values.
            display_array = np.where(destination == layer.presence_value, 1.0, np.nan)
            display_dtype, display_nodata = "float32", float("nan")
        profile.update(
            driver="GTiff",
            width=template.width,
            height=template.height,
            transform=template.transform,
            crs=template.crs,
            count=1,
            dtype=display_dtype,
            nodata=display_nodata,
            photometric="MINISBLACK",
            tiled=True,
            blockxsize=512,
            blockysize=512,
            compress="LZW",
            bigtiff="IF_SAFER",
        )
        with rasterio.open(intermediate_path, "w", **profile) as aligned:
            aligned.write(display_array.astype(display_dtype), 1)

        source_metadata = {
            "crs": str(source.crs),
            "width": source.width,
            "height": source.height,
            "transform": list(source.transform),
            "dtype": source_dtype,
            "nodata": source_nodata,
            "valueRange": [source_min, source_max],
        }
        target_metadata = {
            "crs": str(template.crs),
            "width": template.width,
            "height": template.height,
            "transform": list(template.transform),
        }

    rasterio_copy(
        intermediate_path,
        output_path,
        driver="COG",
        COMPRESS="LZW",
        BLOCKSIZE=512,
        OVERVIEW_RESAMPLING="NEAREST",
        RESAMPLING="NEAREST",
        OVERVIEWS="IGNORE_EXISTING",
        BIGTIFF="IF_SAFER",
    )
    intermediate_path.unlink(missing_ok=True)

    with rasterio.open(template_path) as template, rasterio.open(output_path) as output:
        if (
            output.crs != template.crs
            or output.transform != template.transform
            or output.width != template.width
            or output.height != template.height
        ):
            raise ValueError(f"{layer.layer_id}: output does not exactly match the land grid")
        if output.colorinterp[0] is not ColorInterp.gray:
            raise ValueError(
                f"{layer.layer_id}: band 1 is {output.colorinterp[0].name}, expected grayscale. "
                "A palette band makes ArcGIS paint NoData black instead of transparent."
            )
        if not output.overviews(1):
            raise ValueError(f"{layer.layer_id}: COG has no internal overviews")
        display_band = output.read(1, masked=True)
        display_values = sorted(np.unique(display_band.compressed()).tolist())
        output_min = float(display_band.min())
        output_max = float(display_band.max())
        try:
            has_color_table = bool(output.colormap(1))
        except ValueError:
            has_color_table = False
        output_metadata = {
            "dtype": output.dtypes[0],
            "nodata": output.nodata,
            "colorInterp": output.colorinterp[0].name,
            "hasColorTable": has_color_table,
            "overviewLevels": output.overviews(1),
            "valueRange": [output_min, output_max],
        }

    # `nan` is not equal to itself, so filtering by `source_nodata` would
    # accidentally retain it for EPSG:4326 masks that use NaN NoData.
    valid_aligned_values = {
        value for value in np.unique(destination).tolist() if np.isfinite(value)
    }
    if layer.expected_values is not None and not valid_aligned_values.issubset(layer.expected_values):
        raise ValueError(
            f"{layer.layer_id}: unexpected aligned values {sorted(valid_aligned_values)}"
        )
    if layer.presence_value is not None and display_values != [1.0]:
        raise ValueError(
            f"{layer.layer_id}: display band holds {display_values}, expected only [1.0]"
        )

    return {
        "layerId": layer.layer_id,
        "sourceUrl": layer.source_url,
        "sourcePath": str(source_path),
        "sourceSha256": sha256_file(source_path),
        "sourceRaster": source_metadata,
        "outputPath": str(output_path),
        "outputSha256": sha256_file(output_path),
        "outputBytes": output_path.stat().st_size,
        "alignedValues": sorted(valid_aligned_values),
        "displayValues": display_values,
        "displayPresenceCells": int(display_band.count()),
        "targetRaster": target_metadata,
        "outputRaster": output_metadata,
        "exactGridMatch": True,
    }


def main() -> int:
    args = parse_args()
    if args.species_full_catalog:
        report, exit_code = run_full_species_catalog(
            catalog_url=args.species_catalog_url,
            template_url=args.species_template_url,
            output_dir=args.species_output_dir,
            publish=args.publish,
            force_download=args.force_download,
            workers=args.species_workers,
            shard=parse_species_shard(args.species_shard) if args.species_shard else None,
        )
        print(
            f"[species-display-cogs] full-catalog: expected={report['expected']} "
            f"statuses={report['statusCounts']} uploadedOrVerified={report['uploadedReopenedVerified']}"
        )
        return exit_code
    if args.species_batch_3a:
        report, exit_code = run_batch_3a(
            catalog_url=args.species_catalog_url,
            template_url=args.species_template_url,
            output_dir=args.species_output_dir,
            publish=args.publish,
            force_download=args.force_download,
        )
        print(
            f"[species-display-cogs] batch-3a: expected={report['expected']} "
            f"statuses={report['statusCounts']} uploadedOrVerified={report['uploadedOrVerified']}"
        )
        return exit_code
    if args.species_dry_run or args.species_benchmark_100:
        report, exit_code = run_species_preflight(
            catalog_url=args.species_catalog_url,
            template_url=args.species_template_url,
            output_dir=args.species_output_dir,
            dry_run=args.species_dry_run,
            benchmark_count=100 if args.species_benchmark_100 else None,
            force_download=args.force_download,
        )
        print(
            f"[species-display-cogs] {report['mode']}: selected={report['selected']} "
            f"statuses={report['statusCounts']} uploads={report['uploadsAttempted']}"
        )
        return exit_code
    output_dir = args.output_dir.resolve()
    cache_dir = output_dir / "cache"
    template_path = download(
        LAND_TEMPLATE_URL,
        cache_dir / "template_terrestre.tif",
        args.force_download,
    )
    selected_ids = args.layer or list(VIEW_LAYERS)
    entries = [
        build_layer(
            VIEW_LAYERS[layer_id],
            template_path=template_path,
            cache_dir=cache_dir,
            output_dir=output_dir,
            force_download=args.force_download,
        )
        for layer_id in selected_ids
    ]
    report = {
        "format": "view-layer-cog-v1",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "templateUrl": LAND_TEMPLATE_URL,
        "entries": entries,
    }
    report_path = output_dir / "build-report.json"
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    for entry in entries:
        print(
            f"[view-layer-cog] {entry['layerId']}: "
            f"{entry['sourceRaster']['crs']} -> {entry['targetRaster']['crs']} "
            f"({entry['outputPath']})"
        )
    print(f"[view-layer-cog] report: {report_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
