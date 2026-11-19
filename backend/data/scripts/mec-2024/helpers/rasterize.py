"""Rasterize validated MEC vectors onto the authoritative IAvH grid."""

from __future__ import annotations

import csv
import hashlib
import json
import math
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from arcgis import atomic_write_json, load_json, sha256_file
from validate import (
    CatalogRow,
    ValidationError,
    category_from_properties,
    validate_geometry,
)

EXPECTED_WIDTH = 1_497
EXPECTED_HEIGHT = 2_069
EXPECTED_CRS = "EPSG:4326"
EXPECTED_RESOLUTION_DEGREES = 0.008333333
COMPOSITE_FILENAME = "ecosistemas_IDEAM_MEC_2024.tif"
HIT_COUNT_FILENAME = "ecosistemas_IDEAM_MEC_2024_hit_count.tif"
GAP_MASK_FILENAME = "ecosistemas_IDEAM_MEC_2024_land_gaps.tif"
DERIVED_REGION_FILENAME = "ecosistemas_IDEAM_MEC_2024_biome_region.tif"


class RasterizationError(RuntimeError):
    """Raised when rasterization would produce an ambiguous or invalid output."""


@dataclass(frozen=True)
class GridFingerprint:
    width: int
    height: int
    transform: tuple[float, float, float, float, float, float]
    crs: str
    nodata: float | int | None
    dtype: str
    validation_raster_sha256: str

    @property
    def sha256(self) -> str:
        payload = json.dumps(
            asdict(self),
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
            allow_nan=False,
        ).encode("utf-8")
        return hashlib.sha256(payload).hexdigest()


def load_grid_fingerprint(
    validation_raster: Path,
    *,
    require_planning_grid: bool = True,
) -> GridFingerprint:
    try:
        import rasterio
    except ImportError as exc:
        raise RasterizationError("rasterio is required for MEC rasterization.") from exc

    try:
        with rasterio.open(validation_raster) as dataset:
            transform = tuple(float(value) for value in dataset.transform[:6])
            fingerprint = GridFingerprint(
                width=dataset.width,
                height=dataset.height,
                transform=transform,  # type: ignore[arg-type]
                crs=dataset.crs.to_string() if dataset.crs else "",
                nodata=dataset.nodata,
                dtype=dataset.dtypes[0],
                validation_raster_sha256=sha256_file(validation_raster),
            )
    except (OSError, ValueError) as exc:
        raise RasterizationError(
            f"Could not load validation raster grid from {validation_raster}: {exc}"
        ) from exc

    if require_planning_grid:
        if (fingerprint.width, fingerprint.height) != (
            EXPECTED_WIDTH,
            EXPECTED_HEIGHT,
        ):
            raise RasterizationError(
                "Validation raster is not the IAvH planning grid: expected "
                f"{EXPECTED_WIDTH}×{EXPECTED_HEIGHT}, received "
                f"{fingerprint.width}×{fingerprint.height}."
            )
        if fingerprint.crs != EXPECTED_CRS:
            raise RasterizationError(
                f"Validation raster CRS must be {EXPECTED_CRS}, received "
                f"{fingerprint.crs!r}."
            )
        x_resolution = fingerprint.transform[0]
        y_resolution = abs(fingerprint.transform[4])
        if not (
            math.isclose(
                x_resolution,
                EXPECTED_RESOLUTION_DEGREES,
                rel_tol=0,
                abs_tol=1e-9,
            )
            and math.isclose(
                y_resolution,
                EXPECTED_RESOLUTION_DEGREES,
                rel_tol=0,
                abs_tol=1e-9,
            )
        ):
            raise RasterizationError(
                "Validation raster resolution does not match the IAvH planning "
                f"grid: {x_resolution}, {y_resolution}."
            )
    return fingerprint


def _raster_profile(
    fingerprint: GridFingerprint,
    *,
    dtype: str,
    nodata: int,
) -> dict[str, Any]:
    from rasterio.transform import Affine

    profile: dict[str, Any] = {
        "driver": "GTiff",
        "width": fingerprint.width,
        "height": fingerprint.height,
        "count": 1,
        "crs": fingerprint.crs,
        "transform": Affine(*fingerprint.transform),
        "dtype": dtype,
        "nodata": nodata,
        "compress": "DEFLATE",
        "predictor": 2,
        "zlevel": 6,
        "BIGTIFF": "IF_SAFER",
    }
    if fingerprint.width >= 16 and fingerprint.height >= 16:
        profile.update(tiled=True, blockxsize=256, blockysize=256)
    return profile


def _atomic_write_raster(
    path: Path,
    values: Any,
    fingerprint: GridFingerprint,
    *,
    dtype: str,
    nodata: int,
) -> str:
    import rasterio

    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp.tif")
    with rasterio.open(
        temporary,
        "w",
        **_raster_profile(fingerprint, dtype=dtype, nodata=nodata),
    ) as target:
        target.write(values, 1)
        target.update_tags(
            AREA_OR_POINT="Area",
            RASTERIZATION="pixel-center; all_touched=false",
        )
    temporary.replace(path)
    return sha256_file(path)


def _load_validation(
    validation_raster: Path,
) -> tuple[Any, Any]:
    import rasterio

    with rasterio.open(validation_raster) as dataset:
        values = dataset.read(1)
        valid_mask = dataset.read_masks(1) > 0
    return values, valid_mask


def _load_iavh_biome_crosswalk(path: Path) -> dict[str, int]:
    try:
        with path.open("r", encoding="utf-8-sig", newline="") as source:
            reader = csv.DictReader(source)
            required = {"biome_id", "biome"}
            if not required.issubset(reader.fieldnames or []):
                raise RasterizationError(
                    f"Validation crosswalk {path} must contain biome_id and biome."
                )
            mapping = {row["biome"]: int(row["biome_id"]) for row in reader}
    except (OSError, csv.Error, KeyError, ValueError) as exc:
        if isinstance(exc, RasterizationError):
            raise
        raise RasterizationError(
            f"Could not parse validation biome crosswalk {path}: {exc}"
        ) from exc
    if not mapping or len(mapping) != len(set(mapping.values())):
        raise RasterizationError(
            "Validation biome crosswalk has empty or duplicate label/ID mappings."
        )
    return mapping


def _transform_geometry(
    geometry: dict[str, Any],
    *,
    source_crs: str,
    target_crs: str,
) -> dict[str, Any]:
    if source_crs == target_crs:
        return geometry
    from rasterio.warp import transform_geom

    try:
        return transform_geom(
            source_crs,
            target_crs,
            geometry,
            antimeridian_cutting=False,
            precision=-1,
        )
    except Exception as exc:
        raise RasterizationError(
            f"Could not transform geometry from {source_crs} to {target_crs}: {exc}"
        ) from exc


def _rasterize_page(
    page_path: Path,
    *,
    category_ids: dict[tuple[str, str, str, str, str], int],
    fingerprint: GridFingerprint,
    source_crs: str,
) -> tuple[Any, Any, dict[str, int]]:
    import numpy as np
    from rasterio.enums import MergeAlg
    from rasterio.features import rasterize
    from rasterio.transform import Affine

    page = load_json(page_path)
    features = page.get("features")
    if not isinstance(features, list):
        raise RasterizationError(f"{page_path} has no features array.")
    shapes: list[tuple[dict[str, Any], int]] = []
    geometry_counts = {"features": 0, "multipartFeatures": 0, "holes": 0}

    def oid_for(feature: dict[str, Any]) -> int:
        return int(feature["properties"]["objectid"])

    try:
        ordered_features = sorted(features, key=oid_for)
    except (KeyError, TypeError, ValueError) as exc:
        raise RasterizationError(f"{page_path} contains an invalid objectid.") from exc

    for feature in ordered_features:
        properties = feature.get("properties")
        if not isinstance(properties, dict):
            raise RasterizationError(f"{page_path} contains invalid properties.")
        oid = int(properties["objectid"])
        try:
            raster_value = category_ids[category_from_properties(properties)]
        except (KeyError, ValidationError) as exc:
            raise RasterizationError(
                f"Feature objectid={oid} is absent from the stable crosswalk."
            ) from exc
        geometry = feature.get("geometry")
        try:
            part_count, hole_count = validate_geometry(geometry, oid=oid)
        except ValidationError as exc:
            raise RasterizationError(str(exc)) from exc
        transformed = _transform_geometry(
            geometry,
            source_crs=source_crs,
            target_crs=fingerprint.crs,
        )
        shapes.append((transformed, raster_value))
        geometry_counts["features"] += 1
        geometry_counts["multipartFeatures"] += int(part_count > 1)
        geometry_counts["holes"] += hole_count

    transform = Affine(*fingerprint.transform)
    shape = (fingerprint.height, fingerprint.width)
    try:
        page_values = rasterize(
            shapes,
            out_shape=shape,
            transform=transform,
            fill=0,
            all_touched=False,
            dtype="uint16",
        )
        page_hits = rasterize(
            ((geometry, 1) for geometry, _ in shapes),
            out_shape=shape,
            transform=transform,
            fill=0,
            all_touched=False,
            dtype="uint32",
            merge_alg=MergeAlg.add,
        )
    except Exception as exc:
        raise RasterizationError(
            f"Rasterization failed for {page_path}: {exc}"
        ) from exc
    return (
        np.asarray(page_values, dtype=np.uint16),
        np.asarray(page_hits, dtype=np.uint32),
        geometry_counts,
    )


def _comparison_diagnostics(
    *,
    composite: Any,
    validation_values: Any,
    validation_valid: Any,
    rows: list[CatalogRow],
    validation_crosswalk: Path,
) -> tuple[Any, dict[str, Any]]:
    import numpy as np

    biome_ids = _load_iavh_biome_crosswalk(validation_crosswalk)
    lookup = np.zeros(65_536, dtype=np.uint16)
    missing_labels: list[str] = []
    for row in rows:
        biome_id = biome_ids.get(row.category[2])
        if biome_id is None:
            missing_labels.append(row.category[2])
        else:
            lookup[row.raster_value] = biome_id
    if missing_labels:
        raise RasterizationError(
            "Composite biomeRegion labels are absent from the validation crosswalk: "
            f"{sorted(set(missing_labels))[:10]}"
        )

    derived = lookup[composite]
    composite_valid = composite > 0
    both_valid = composite_valid & validation_valid
    class_matches = both_valid & (derived == validation_values)
    class_mismatches = both_valid & (derived != validation_values)
    diagnostics = {
        "totalCells": int(composite.size),
        "compositeValidCells": int(composite_valid.sum()),
        "validationValidCells": int(validation_valid.sum()),
        "bothValidCells": int(both_valid.sum()),
        "validMaskAgreementCells": int((composite_valid == validation_valid).sum()),
        "compositeOnlyValidCells": int((composite_valid & ~validation_valid).sum()),
        "validationOnlyValidCells": int((validation_valid & ~composite_valid).sum()),
        "classAgreementCells": int(class_matches.sum()),
        "classMismatchCells": int(class_mismatches.sum()),
        "classAgreementFraction": (
            float(class_matches.sum() / both_valid.sum()) if both_valid.any() else None
        ),
    }
    return derived, diagnostics


def rasterize_mec(
    *,
    page_paths: list[Path],
    rows: list[CatalogRow],
    validation_raster: Path,
    validation_crosswalk: Path,
    output_dir: Path,
    source_geometry_crs: str = "EPSG:4326",
    require_planning_grid: bool = True,
) -> dict[str, Any]:
    """Rasterize pages, fail on overlaps, and report validation-mask gaps."""

    import numpy as np

    fingerprint = load_grid_fingerprint(
        validation_raster,
        require_planning_grid=require_planning_grid,
    )
    category_ids = {row.category: row.raster_value for row in rows}
    composite = np.zeros(
        (fingerprint.height, fingerprint.width),
        dtype=np.uint16,
    )
    hit_count = np.zeros_like(composite, dtype=np.uint32)
    geometry_counts = {"features": 0, "multipartFeatures": 0, "holes": 0}

    for page_path in page_paths:
        page_values, page_hits, page_counts = _rasterize_page(
            page_path,
            category_ids=category_ids,
            fingerprint=fingerprint,
            source_crs=source_geometry_crs,
        )
        claimed = page_values > 0
        composite[claimed] = page_values[claimed]
        hit_count += page_hits
        for key, value in page_counts.items():
            geometry_counts[key] += value

    validation_values, validation_valid = _load_validation(validation_raster)
    overlap_mask = hit_count > 1
    gap_mask = validation_valid & (hit_count == 0)
    outside_land_mask = (~validation_valid) & (hit_count > 0)
    overlap_cells = int(overlap_mask.sum())
    diagnostics: dict[str, Any] = {
        **geometry_counts,
        "grid": asdict(fingerprint),
        "gridFingerprintSha256": fingerprint.sha256,
        "rasterization": {
            "allTouched": False,
            "pixelRule": "pixel-center",
            "dtype": "uint16",
            "nodata": 0,
            "featureOrder": "objectid ascending within deterministic OID pages",
        },
        "overlapCells": overlap_cells,
        "maximumCenterClaims": int(hit_count.max(initial=0)),
        "landMaskCells": int(validation_valid.sum()),
        "landGapCells": int(gap_mask.sum()),
        "claimsOutsideLandMaskCells": int(outside_land_mask.sum()),
    }

    hit_path = output_dir / HIT_COUNT_FILENAME
    gap_path = output_dir / GAP_MASK_FILENAME
    diagnostics["hitCountSha256"] = _atomic_write_raster(
        hit_path,
        hit_count,
        fingerprint,
        dtype="uint32",
        nodata=0,
    )
    diagnostics["gapMaskSha256"] = _atomic_write_raster(
        gap_path,
        gap_mask.astype(np.uint8),
        fingerprint,
        dtype="uint8",
        nodata=0,
    )
    diagnostics["hitCountRaster"] = str(hit_path)
    diagnostics["gapMaskRaster"] = str(gap_path)

    if overlap_cells:
        atomic_write_json(output_dir / "rasterization-diagnostics.json", diagnostics)
        raise RasterizationError(
            f"{overlap_cells:,} pixels have overlapping polygon center claims. "
            "Diagnostics were written; no composite raster was emitted."
        )

    derived_region, comparison = _comparison_diagnostics(
        composite=composite,
        validation_values=validation_values,
        validation_valid=validation_valid,
        rows=rows,
        validation_crosswalk=validation_crosswalk,
    )
    composite_path = output_dir / COMPOSITE_FILENAME
    derived_path = output_dir / DERIVED_REGION_FILENAME
    diagnostics["compositeRaster"] = str(composite_path)
    diagnostics["compositeSha256"] = _atomic_write_raster(
        composite_path,
        composite,
        fingerprint,
        dtype="uint16",
        nodata=0,
    )
    diagnostics["derivedBiomeRegionRaster"] = str(derived_path)
    diagnostics["derivedBiomeRegionSha256"] = _atomic_write_raster(
        derived_path,
        derived_region,
        fingerprint,
        dtype="uint16",
        nodata=0,
    )
    diagnostics["validationComparison"] = comparison
    atomic_write_json(output_dir / "rasterization-diagnostics.json", diagnostics)
    return diagnostics
