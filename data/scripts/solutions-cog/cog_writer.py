"""Rasterio helpers for translating source rasters into COGs."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import rasterio
from rasterio.shutil import copy as rasterio_copy

COG_CREATION_OPTIONS = {
    "COMPRESS": "LZW",
    "BLOCKSIZE": 512,
    "OVERVIEW_RESAMPLING": "NEAREST",
    "RESAMPLING": "NEAREST",
    "OVERVIEWS": "IGNORE_EXISTING",
    "BIGTIFF": "IF_SAFER",
}


def write_cog(source_path: Path, target_path: Path) -> None:
    target_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = target_path.with_suffix(".tmp.tif")
    tmp_path.unlink(missing_ok=True)

    rasterio_copy(
        str(source_path),
        str(tmp_path),
        driver="COG",
        **COG_CREATION_OPTIONS,
    )
    tmp_path.replace(target_path)


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
    }
