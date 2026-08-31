"""Build and optionally publish immutable, source-faithful display COGs."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import time
import urllib.parse
import urllib.error
import urllib.request
import uuid
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
PUBLIC_BLOB_HOST = "https://aagibolq28slyfof.public.blob.vercel-storage.com"
RELEASE_PREFIX = "releases/view-layer-display-cogs-v2"
MAX_REPORTED_VALUES = 1_024


@dataclass(frozen=True)
class ViewLayer:
    layer_id: str
    source_url: str
    output_name: str
    # ``land-template`` reprojects to LAND_TEMPLATE_URL. ``source-grid`` keeps
    # an already-EPSG:9377 source's transform, dimensions, and CRS unchanged.
    grid_behavior: str
    expected_crs: str | None = None
    expected_values: frozenset[int] | None = None
    expected_dtype: str | None = None
    expected_nodata: float | None = None
    expected_min: float | None = None
    expected_max: float | None = None
    display_nodata: float | None = None
    # Mask layers retain only this value as one visible grayscale value.
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
            grid_behavior="land-template",
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
            grid_behavior="land-template",
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
            grid_behavior="land-template",
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
            grid_behavior="land-template",
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
            grid_behavior="land-template",
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
            grid_behavior="land-template",
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
            grid_behavior="land-template",
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
            grid_behavior="land-template",
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
            grid_behavior="land-template",
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
            grid_behavior="land-template",
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
            grid_behavior="land-template",
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
            grid_behavior="land-template",
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
            grid_behavior="land-template",
            expected_values=frozenset({0, 1}),
            presence_value=1,
        ),
        ViewLayer(
            layer_id="ecosistemas",
            source_url=(
                "https://aagibolq28slyfof.public.blob.vercel-storage.com/"
                "inputs/features/ecosystems/ecosistemas.tif"
            ),
            output_name="ecosistemas.epsg9377.cog.tif",
            grid_behavior="land-template",
        ),
        ViewLayer(
            layer_id="marine_ecosystems",
            source_url=(
                "https://aagibolq28slyfof.public.blob.vercel-storage.com/"
                "inputs/features/marine/marine_ecosystems.tif"
            ),
            output_name="marine_ecosystems.epsg9377.cog.tif",
            grid_behavior="source-grid",
            expected_crs="EPSG:9377",
            expected_values=frozenset(range(0, 146)),
        ),
        ViewLayer(
            layer_id="human_footprint_2022",
            source_url=(
                "https://aagibolq28slyfof.public.blob.vercel-storage.com/"
                "inputs/costs/human_footprint_2022.tif"
            ),
            output_name="human_footprint_2022.epsg9377.cog.tif",
            grid_behavior="land-template",
            display_nodata=-9999.0,
        ),
        ViewLayer(
            layer_id="hhm",
            source_url=(
                "https://aagibolq28slyfof.public.blob.vercel-storage.com/"
                "inputs/costs/huella_humana_marina.tif"
            ),
            output_name="hhm.epsg9377.cog.tif",
            grid_behavior="source-grid",
            display_nodata=-9999.0,
            expected_crs="EPSG:9377",
        ),
        ViewLayer(
            layer_id="net_benefit",
            source_url=(
                "https://aagibolq28slyfof.public.blob.vercel-storage.com/"
                "inputs/costs/net_benefit.tif"
            ),
            output_name="net_benefit.epsg9377.cog.tif",
            grid_behavior="land-template",
            display_nodata=-9999.0,
        ),
        ViewLayer(
            layer_id="coberturas",
            source_url=(
                "https://aagibolq28slyfof.public.blob.vercel-storage.com/"
                "boundaries/coberturas.tif"
            ),
            output_name="coberturas.epsg9377.cog.tif",
            grid_behavior="land-template",
            expected_values=frozenset(range(0, 6)),
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
        help="Publish validated COGs to a new immutable release prefix.",
    )
    parser.add_argument(
        "--release-id",
        help="Immutable release suffix for --publish (default: UTC timestamp).",
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
    if args.species_shard and not args.species_full_catalog:
        parser.error("--species-shard requires --species-full-catalog")
    return args


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def report_values(values: list[float | int]) -> list[float | int] | None:
    """Keep reports inspectable without serializing continuous rasters verbatim."""
    return values if len(values) <= MAX_REPORTED_VALUES else None


def download(url: str, destination: Path, force: bool) -> Path:
    if destination.exists() and not force:
        return destination
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(f"{destination.suffix}.download")
    temporary.unlink(missing_ok=True)
    urllib.request.urlretrieve(url, temporary)
    temporary.replace(destination)
    return destination


def load_blob_token() -> str:
    """Read the publishing token from the environment or local dotenv file."""
    token = os.environ.get("BLOB_READ_WRITE_TOKEN")
    env_path = REPO_ROOT / ".env.local"
    if not token and env_path.is_file():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            key, separator, value = line.partition("=")
            if separator and key.strip() == "BLOB_READ_WRITE_TOKEN":
                token = value.strip().strip("'\"")
                break
    if not token:
        raise RuntimeError("BLOB_READ_WRITE_TOKEN is required for --publish")
    return token


def public_url(pathname: str) -> str:
    return f"{PUBLIC_BLOB_HOST}/{pathname.lstrip('/')}"


def remote_sha256(url: str, attempts: int = 10) -> str:
    """Read public bytes, allowing time for a just-uploaded Blob to propagate."""
    for attempt in range(1, attempts + 1):
        try:
            digest = hashlib.sha256()
            with urllib.request.urlopen(url) as response:
                for chunk in iter(lambda: response.read(1024 * 1024), b""):
                    digest.update(chunk)
            return digest.hexdigest()
        except urllib.error.HTTPError as error:
            if error.code != 404 or attempt == attempts:
                raise
            time.sleep(attempt * 0.5)
    raise RuntimeError(f"public Blob did not become readable: {url}")


def require_fresh_remote_pathname(pathname: str) -> None:
    """Reject an existing pathname: release outputs must never be replaced."""
    try:
        with urllib.request.urlopen(public_url(pathname)):
            pass
    except urllib.error.HTTPError as error:
        if error.code == 404:
            return
        raise
    raise RuntimeError(f"immutable release pathname already exists: {pathname}")


def publish_layer(entry: dict[str, object], *, pathname: str, token: str) -> dict[str, object]:
    """Upload a new immutable blob and verify its public bytes."""
    output_path = Path(str(entry["outputPath"]))
    expected_sha256 = str(entry["outputSha256"])
    url = public_url(pathname)
    require_fresh_remote_pathname(pathname)
    upload = subprocess.run(
        [
            "vercel", "blob", "put", str(output_path), "--pathname", pathname,
            "--rw-token", token, "--no-color",
        ],
        capture_output=True,
        check=False,
        text=True,
    )
    if upload.returncode:
        raise RuntimeError(f"upload failed for immutable pathname {pathname}: {upload.stderr.strip()}")
    actual_sha256 = remote_sha256(url)
    if actual_sha256 != expected_sha256:
        raise RuntimeError(f"uploaded bytes do not match local checksum: {pathname}")
    return {
        **entry,
        "remotePathname": pathname,
        "remoteUrl": url,
        "remoteSha256": actual_sha256,
        "publishStatus": "uploaded_verified",
    }


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
    from rasterio.enums import ColorInterp, MaskFlags, Resampling
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
        if layer.expected_crs is not None and str(source.crs) != layer.expected_crs:
            raise ValueError(
                f"{layer.layer_id}: source CRS {source.crs}, expected {layer.expected_crs}"
            )
        source_band = source.read(1, masked=True)
        source_values = source_band.compressed()
        if source_values.size == 0:
            raise ValueError(f"{layer.layer_id}: source has no valid pixels")
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

        if layer.grid_behavior == "land-template":
            destination_transform = template.transform
            destination_crs = template.crs
            destination_width = template.width
            destination_height = template.height
            destination = np.full(
                (destination_height, destination_width),
                source.nodata if source.nodata is not None else 0,
                dtype=np.dtype(source_dtype),
            )
            reproject(
                source=rasterio.band(source, 1),
                destination=destination,
                src_transform=source.transform,
                src_crs=source.crs,
                src_nodata=source.nodata,
                dst_transform=destination_transform,
                dst_crs=destination_crs,
                dst_nodata=source.nodata,
                resampling=Resampling.nearest,
                init_dest_nodata=True,
            )
            destination_mask = np.zeros(
                (destination_height, destination_width),
                dtype=np.uint8,
            )
            reproject(
                source=source.dataset_mask(),
                destination=destination_mask,
                src_transform=source.transform,
                src_crs=source.crs,
                src_nodata=0,
                dst_transform=destination_transform,
                dst_crs=destination_crs,
                dst_nodata=0,
                resampling=Resampling.nearest,
                init_dest_nodata=True,
            )
        elif layer.grid_behavior == "source-grid":
            destination = source.read(1)
            destination_mask = source.dataset_mask()
            destination_transform = source.transform
            destination_crs = source.crs
            destination_width = source.width
            destination_height = source.height
        else:
            raise ValueError(f"{layer.layer_id}: unknown grid behavior {layer.grid_behavior!r}")

        if layer.presence_value is None:
            display_array = destination
            display_mask = destination_mask
            display_dtype = source_dtype
            display_nodata = (
                layer.display_nodata if layer.display_nodata is not None else source_nodata
            )
            if layer.display_nodata is not None:
                display_array = np.where(
                    np.isfinite(destination),
                    destination,
                    layer.display_nodata,
                )
        else:
            # Preserve the original sparse-mask display semantics: only the
            # configured presence class remains paintable. Source files are
            # untouched; non-mask layers never enter this branch.
            display_array = np.where(destination == layer.presence_value, 1.0, np.nan)
            display_mask = np.where(
                (destination_mask != 0) & (destination == layer.presence_value),
                255,
                0,
            ).astype(np.uint8)
            display_dtype, display_nodata = "float32", float("nan")

        profile = source.profile.copy()
        profile.update(
            driver="GTiff",
            width=destination_width,
            height=destination_height,
            transform=destination_transform,
            crs=destination_crs,
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
        # Direct COG consumers do not consistently honor a band's NoData tag.
        # Store validity as an internal TIFF dataset mask so transparency is
        # explicit without adding an alpha/value band or hiding valid zeroes.
        with rasterio.Env(GDAL_TIFF_INTERNAL_MASK=True):
            with rasterio.open(intermediate_path, "w", **profile) as aligned:
                aligned.write(display_array.astype(display_dtype), 1)
                aligned.write_mask(display_mask)

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
            "behavior": layer.grid_behavior,
            "crs": str(destination_crs),
            "width": destination_width,
            "height": destination_height,
            "transform": list(destination_transform),
        }

    with rasterio.Env(GDAL_TIFF_INTERNAL_MASK=True):
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

    with rasterio.open(output_path) as output:
        if (
            output.crs != destination_crs
            or output.transform != destination_transform
            or output.width != destination_width
            or output.height != destination_height
        ):
            raise ValueError(f"{layer.layer_id}: output does not exactly match its target grid")
        if output.colorinterp[0] is not ColorInterp.gray:
            raise ValueError(
                f"{layer.layer_id}: band 1 is {output.colorinterp[0].name}, expected grayscale. "
                "A palette band makes ArcGIS paint NoData black instead of transparent."
            )
        if not output.overviews(1):
            raise ValueError(f"{layer.layer_id}: COG has no internal overviews")
        mask_flags = output.mask_flag_enums[0]
        if mask_flags != [MaskFlags.per_dataset]:
            raise ValueError(
                f"{layer.layer_id}: output mask flags are "
                f"{[flag.name for flag in mask_flags]}, expected an internal dataset mask"
            )
        output_mask = output.dataset_mask()
        if not np.array_equal(output_mask, display_mask):
            raise ValueError(f"{layer.layer_id}: COG mask does not match aligned validity")
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
            "maskFlags": [flag.name for flag in mask_flags],
            "maskValues": sorted(np.unique(output_mask).tolist()),
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
    if layer.presence_value is None and not set(display_values).issubset(valid_aligned_values):
        raise ValueError(
            f"{layer.layer_id}: output values are not source values"
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
        "alignedValues": report_values(sorted(valid_aligned_values)),
        "alignedValueCount": len(valid_aligned_values),
        "displayValues": report_values(display_values),
        "displayValueCount": len(display_values),
        "displayPresenceCells": int(display_band.count()),
        "targetRaster": target_metadata,
        "outputRaster": output_metadata,
        "targetGridMatch": True,
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
    release_id = args.release_id or (
        f"{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')}-{uuid.uuid4().hex[:12]}"
    )
    if args.publish:
        token = load_blob_token()
        entries = [
            publish_layer(
                entry,
                pathname=f"{RELEASE_PREFIX}/{release_id}/{Path(str(entry['outputPath'])).name}",
                token=token,
            )
            for entry in entries
        ]
    report = {
        "format": "view-layer-display-cog-v2",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "landTemplateUrl": LAND_TEMPLATE_URL,
        "releasePrefix": f"{RELEASE_PREFIX}/{release_id}" if args.publish else None,
        "published": args.publish,
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
