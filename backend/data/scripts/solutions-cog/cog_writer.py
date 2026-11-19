"""Rasterio helpers for translating source rasters into COGs."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import rasterio
from rasterio.crs import CRS
from rasterio.enums import Resampling
from rasterio.shutil import copy as rasterio_copy
from rasterio.warp import aligned_target, calculate_default_transform, reproject

COG_CREATION_OPTIONS = {
    "COMPRESS": "LZW",
    "BLOCKSIZE": 512,
    "OVERVIEW_RESAMPLING": "NEAREST",
    "RESAMPLING": "NEAREST",
    "OVERVIEWS": "IGNORE_EXISTING",
    "BIGTIFF": "IF_SAFER",
}


def read_raster_metadata(path: Path) -> dict[str, Any]:
    with rasterio.open(path) as dataset:
        crs = dataset.crs
        bounds = dataset.bounds
        transform = dataset.transform
        return {
            "crs": str(crs) if crs else None,
            "epsg": crs.to_epsg() if crs else None,
            "width": dataset.width,
            "height": dataset.height,
            "bounds": [bounds.left, bounds.bottom, bounds.right, bounds.top],
            "transform": list(transform.to_gdal()),
            "resolution": [abs(transform.a), abs(transform.e)],
        }


def write_cog(
    source_path: Path,
    target_path: Path,
    *,
    target_crs: str | None = None,
    target_resolution: tuple[float, float] | None = None,
    target_aligned_pixels: bool = False,
) -> None:
    target_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = target_path.with_suffix(".tmp.tif")
    tmp_path.unlink(missing_ok=True)

    if target_crs:
        warped_path = target_path.with_suffix(".warp.tmp.tif")
        warped_path.unlink(missing_ok=True)
        try:
            _write_reprojected_tif(
                source_path,
                warped_path,
                target_crs=target_crs,
                target_resolution=target_resolution,
                target_aligned_pixels=target_aligned_pixels,
            )
            _copy_as_cog(warped_path, tmp_path)
        finally:
            warped_path.unlink(missing_ok=True)
    else:
        _copy_as_cog(source_path, tmp_path)

    tmp_path.replace(target_path)


def _copy_as_cog(source_path: Path, target_path: Path) -> None:
    rasterio_copy(
        str(source_path),
        str(target_path),
        driver="COG",
        **COG_CREATION_OPTIONS,
    )


def _write_reprojected_tif(
    source_path: Path,
    target_path: Path,
    *,
    target_crs: str,
    target_resolution: tuple[float, float] | None,
    target_aligned_pixels: bool,
) -> None:
    dst_crs = CRS.from_user_input(target_crs)
    with rasterio.open(source_path) as source:
        if source.crs is None:
            raise ValueError(f"Source raster has no CRS: {source_path}")

        dst_transform, dst_width, dst_height = calculate_default_transform(
            source.crs,
            dst_crs,
            source.width,
            source.height,
            *source.bounds,
            resolution=target_resolution,
        )
        if target_resolution and target_aligned_pixels:
            dst_transform, dst_width, dst_height = aligned_target(
                dst_transform,
                dst_width,
                dst_height,
                target_resolution,
            )

        profile = source.profile.copy()
        profile.update(
            driver="GTiff",
            crs=dst_crs,
            transform=dst_transform,
            width=dst_width,
            height=dst_height,
            compress="LZW",
            tiled=True,
            blockxsize=512,
            blockysize=512,
            bigtiff="IF_SAFER",
        )

        with rasterio.open(target_path, "w", **profile) as target:
            for band_index in range(1, source.count + 1):
                reproject(
                    source=rasterio.band(source, band_index),
                    destination=rasterio.band(target, band_index),
                    src_transform=source.transform,
                    src_crs=source.crs,
                    src_nodata=source.nodata,
                    dst_transform=dst_transform,
                    dst_crs=dst_crs,
                    dst_nodata=source.nodata,
                    resampling=Resampling.nearest,
                )
                description = source.descriptions[band_index - 1]
                if description:
                    target.set_band_description(band_index, description)


def validate_cog(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {
            "isValidCog": False,
            "exists": False,
            "layoutIsCog": False,
            "isTiled": False,
            "blockSize512": False,
            "hasInternalOverviews": False,
        }

    with rasterio.open(path) as dataset:
        image_structure = dataset.tags(ns="IMAGE_STRUCTURE")
        layout = image_structure.get("LAYOUT")
        block_shapes = [list(shape) for shape in dataset.block_shapes]
        overview_levels = dataset.overviews(1) if dataset.count else []
        is_tiled = bool(getattr(dataset, "is_tiled", False))
        block_size_512 = all(shape == [512, 512] for shape in block_shapes)
        has_internal_overviews = bool(overview_levels)
        layout_is_cog = layout == "COG"
        raster_metadata = read_raster_metadata(path)

    return {
        "isValidCog": layout_is_cog and is_tiled and block_size_512 and has_internal_overviews,
        "exists": True,
        "layoutIsCog": layout_is_cog,
        "layout": layout,
        "isTiled": is_tiled,
        "blockSize512": block_size_512,
        "blockShapes": block_shapes,
        "hasInternalOverviews": has_internal_overviews,
        "overviewLevels": overview_levels,
        "compression": image_structure.get("COMPRESSION"),
        "interleave": image_structure.get("INTERLEAVE"),
        **raster_metadata,
    }
