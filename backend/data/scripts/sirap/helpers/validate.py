"""Validation and comparison helpers for the versioned SIRAP repair."""

from __future__ import annotations

import hashlib
import json
import math
from collections.abc import Iterable

import numpy as np
import rasterio.features
from affine import Affine
from pyproj import Geod, Transformer
from shapely import transform
from shapely.geometry import MultiPolygon, Polygon, shape

EXPECTED_SIRAP_CATALOG: tuple[tuple[str, str], ...] = (
    ("thematic_eje_cafetero_1", "Eje Cafetero"),
    ("thematic_macizo_2", "Macizo"),
    ("territorial_territorial_amazonia_3", "Territorial Amazonia"),
    (
        "territorial_territorial_andes_nororientales_4",
        "Territorial Andes Nororientales",
    ),
    (
        "territorial_territorial_andes_occidentales_5",
        "Territorial Andes Occidentales",
    ),
    ("territorial_territorial_caribe_6", "Territorial Caribe"),
    ("territorial_territorial_orinoquia_7", "Territorial Orinoquia"),
    ("territorial_territorial_pacifico_8", "Territorial Pacifico"),
    ("territorial_territorial_caribe_9", "Territorial Caribe"),
    ("territorial_territorial_pacifico_10", "Territorial Pacifico"),
)
AMAZONIA_ID = "territorial_territorial_amazonia_3"
AREA_RELATIVE_TOLERANCE = 1e-9
AREA_ABSOLUTE_TOLERANCE_M2 = 1.0
RASTER_RESOLUTION_METERS = 1_000
_GEOD = Geod(ellps="WGS84")
_TO_EQUAL_AREA = Transformer.from_crs("EPSG:4326", "EPSG:6933", always_xy=True)


class SirapValidationError(ValueError):
    """Raised when a repaired SIRAP catalog violates its source contract."""


def validate_release_metadata(metadata: dict, provenance: dict) -> None:
    """Fail closed when versioned metadata drifts from generated provenance."""
    output = provenance.get("output") or {}
    validation = provenance.get("validation") or {}
    required = {
        "format": "sirap-boundary-metadata-v2",
        "geometryContract": "polygon-only",
        "featureCount": 10,
        "stableIdField": "sirap_id",
        "url": output.get("url"),
        "sha256": output.get("sha256"),
        "catalogSha256": validation.get("catalog_sha256"),
        "geometryCollectionSha256": validation.get("geometry_collection_sha256"),
    }
    mismatches = [
        key for key, expected in required.items() if metadata.get(key) != expected
    ]
    if mismatches:
        raise SirapValidationError(
            f"SIRAP release metadata is missing or stale: {', '.join(mismatches)}"
        )
    if metadata.get("stableIds") != validation.get("expected_ids"):
        raise SirapValidationError("SIRAP release metadata stableIds do not match")
    if metadata.get("provenance") != provenance:
        raise SirapValidationError("SIRAP release metadata provenance is not exact")


def canonical_sha256(value: object) -> str:
    encoded = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def geodesic_polygon_area_m2(geometry: dict) -> float:
    """Measure polygon-only geodesic area, excluding line and point members."""
    polygonal = _polygon_members(shape(geometry))
    return sum(abs(_GEOD.geometry_area_perimeter(part)[0]) for part in polygonal)


def validate_repaired_collection(
    original: dict,
    repaired: dict,
) -> dict:
    """Validate source invariants and return deterministic provenance metadata."""
    _require_feature_collection(original, "original")
    _require_feature_collection(repaired, "repaired")
    original_by_id = _index_features(original)
    repaired_by_id = _index_features(repaired)

    expected_ids = {sirap_id for sirap_id, _ in EXPECTED_SIRAP_CATALOG}
    if set(original_by_id) != expected_ids or set(repaired_by_id) != expected_ids:
        raise SirapValidationError("SIRAP IDs do not match the exact 10-feature catalog")

    expected_catalog = sorted(EXPECTED_SIRAP_CATALOG)
    repaired_catalog = sorted(
        (sirap_id, feature["properties"].get("sirap_name"))
        for sirap_id, feature in repaired_by_id.items()
    )
    if repaired_catalog != expected_catalog:
        raise SirapValidationError("SIRAP names or IDs changed during normalization")

    area_rows = []
    geometry_catalog = []
    for sirap_id, _ in EXPECTED_SIRAP_CATALOG:
        before = original_by_id[sirap_id]
        after = repaired_by_id[sirap_id]
        if before.get("properties") != after.get("properties"):
            raise SirapValidationError(f"{sirap_id}: properties changed")

        geometry = after.get("geometry")
        geometry_type = geometry.get("type") if isinstance(geometry, dict) else None
        if geometry_type not in {"Polygon", "MultiPolygon"}:
            raise SirapValidationError(
                f"{sirap_id}: expected Polygon/MultiPolygon, got {geometry_type!r}"
            )
        parsed = shape(geometry)
        if parsed.is_empty or not parsed.is_valid:
            raise SirapValidationError(f"{sirap_id}: repaired geometry is invalid")

        before_area = geodesic_polygon_area_m2(before["geometry"])
        after_area = geodesic_polygon_area_m2(geometry)
        difference = after_area - before_area
        tolerance = max(
            AREA_ABSOLUTE_TOLERANCE_M2,
            before_area * AREA_RELATIVE_TOLERANCE,
        )
        if abs(difference) > tolerance:
            raise SirapValidationError(
                f"{sirap_id}: polygon area changed by {difference:.6f} m² "
                f"(tolerance {tolerance:.6f} m²)"
            )
        geometry_hash = canonical_sha256(geometry)
        geometry_catalog.append((sirap_id, geometry_hash))
        area_rows.append(
            {
                "sirap_id": sirap_id,
                "before_area_m2": before_area,
                "after_area_m2": after_area,
                "difference_m2": difference,
                "tolerance_m2": tolerance,
                "geometry_sha256": geometry_hash,
            }
        )

    amazon_before = original_by_id[AMAZONIA_ID]["geometry"]
    amazon_after = repaired_by_id[AMAZONIA_ID]["geometry"]
    if amazon_before.get("type") != "GeometryCollection":
        raise SirapValidationError("expected the pinned Amazonia defect to be present")
    if amazon_after.get("type") not in {"Polygon", "MultiPolygon"}:
        raise SirapValidationError("southern Amazonia is not ArcGIS-loadable")

    return {
        "feature_count": len(repaired_by_id),
        "expected_ids": sorted(expected_ids),
        "catalog_sha256": canonical_sha256(expected_catalog),
        "geometry_collection_sha256": canonical_sha256(geometry_catalog),
        "area_tolerance": {
            "relative": AREA_RELATIVE_TOLERANCE,
            "absolute_m2": AREA_ABSOLUTE_TOLERANCE_M2,
        },
        "areas": area_rows,
        "amazonia": {
            "before_geometry_type": amazon_before["type"],
            "after_geometry_type": amazon_after["type"],
            "arcgis_compatible": True,
            "rasterized_comparison": compare_rasterized_area(
                amazon_before,
                amazon_after,
            ),
        },
    }


def compare_rasterized_area(before: dict, after: dict) -> dict:
    """Compare rasterized area on a globally aligned EPSG:6933 1 km grid."""
    before_projected = transform(shape(before), _TO_EQUAL_AREA.transform, interleaved=False)
    after_projected = transform(shape(after), _TO_EQUAL_AREA.transform, interleaved=False)
    min_x, min_y, max_x, max_y = before_projected.union(after_projected).bounds
    resolution = RASTER_RESOLUTION_METERS
    left = math.floor(min_x / resolution) * resolution
    bottom = math.floor(min_y / resolution) * resolution
    right = math.ceil(max_x / resolution) * resolution
    top = math.ceil(max_y / resolution) * resolution
    width = round((right - left) / resolution)
    height = round((top - bottom) / resolution)
    grid_transform = Affine(resolution, 0, left, 0, -resolution, top)

    before_mask = rasterio.features.rasterize(
        [(before_projected, 1)],
        out_shape=(height, width),
        transform=grid_transform,
        fill=0,
        dtype=np.uint8,
    )
    after_mask = rasterio.features.rasterize(
        [(after_projected, 1)],
        out_shape=(height, width),
        transform=grid_transform,
        fill=0,
        dtype=np.uint8,
    )
    before_pixels = int(before_mask.sum())
    after_pixels = int(after_mask.sum())
    removed_pixels = int(np.count_nonzero((before_mask == 1) & (after_mask == 0)))
    added_pixels = int(np.count_nonzero((before_mask == 0) & (after_mask == 1)))
    pixel_area_km2 = (resolution * resolution) / 1_000_000
    return {
        "crs": "EPSG:6933",
        "resolution_m": resolution,
        "all_touched": False,
        "before_pixels": before_pixels,
        "after_pixels": after_pixels,
        "removed_line_pixels": removed_pixels,
        "added_pixels": added_pixels,
        "before_area_km2": before_pixels * pixel_area_km2,
        "after_area_km2": after_pixels * pixel_area_km2,
        "difference_km2": (after_pixels - before_pixels) * pixel_area_km2,
    }


def _polygon_members(geometry) -> Iterable[Polygon]:
    if isinstance(geometry, Polygon):
        yield geometry
    elif isinstance(geometry, MultiPolygon):
        yield from geometry.geoms
    elif hasattr(geometry, "geoms"):
        for member in geometry.geoms:
            yield from _polygon_members(member)


def _require_feature_collection(data: dict, label: str) -> None:
    if data.get("type") != "FeatureCollection" or not isinstance(
        data.get("features"), list
    ):
        raise SirapValidationError(f"{label} must be a GeoJSON FeatureCollection")
    if len(data["features"]) != len(EXPECTED_SIRAP_CATALOG):
        raise SirapValidationError(f"{label} must contain exactly 10 features")


def _index_features(data: dict) -> dict[str, dict]:
    result = {}
    for index, feature in enumerate(data["features"]):
        if feature.get("type") != "Feature":
            raise SirapValidationError(f"feature {index} is not a GeoJSON Feature")
        properties = feature.get("properties")
        if not isinstance(properties, dict):
            raise SirapValidationError(f"feature {index} has invalid properties")
        sirap_id = properties.get("sirap_id")
        if not isinstance(sirap_id, str) or not sirap_id:
            raise SirapValidationError(f"feature {index} has no sirap_id")
        if sirap_id in result:
            raise SirapValidationError(f"duplicate SIRAP ID {sirap_id!r}")
        for field in ("sirap_name", "sirap_kind", "source_file"):
            if not isinstance(properties.get(field), str) or not properties[field]:
                raise SirapValidationError(f"{sirap_id}: missing required {field}")
        result[sirap_id] = feature
    return result
