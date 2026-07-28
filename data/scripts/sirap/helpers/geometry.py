"""Polygon-only normalization for SIRAP GeoJSON geometries."""

from __future__ import annotations

from collections.abc import Iterator

from shapely import make_valid
from shapely.geometry import GeometryCollection, MultiPolygon, Polygon, mapping, shape
from shapely.geometry.base import BaseGeometry
from shapely.ops import unary_union


class PolygonNormalizationError(ValueError):
    """Raised when a source geometry has no usable polygonal area."""


def iter_polygon_members(geometry: BaseGeometry) -> Iterator[Polygon]:
    """Yield every polygon recursively while preserving rings and holes."""
    if isinstance(geometry, Polygon):
        yield geometry
        return
    if isinstance(geometry, MultiPolygon | GeometryCollection):
        for member in geometry.geoms:
            yield from iter_polygon_members(member)


def polygonal_geometry(geometry: BaseGeometry) -> Polygon | MultiPolygon:
    """Return only polygon members, repairing and unioning only when necessary."""
    polygonal_members = list(_iter_polygonal_geometries(geometry))
    if not polygonal_members:
        raise PolygonNormalizationError("geometry contains no polygonal area")

    if len(polygonal_members) == 1 and polygonal_members[0].is_valid:
        return polygonal_members[0]

    repaired_members = [
        member if member.is_valid else make_valid(member)
        for member in polygonal_members
    ]
    polygons = [
        polygon
        for member in repaired_members
        for polygon in iter_polygon_members(member)
    ]
    candidate: BaseGeometry = polygons[0] if len(polygons) == 1 else unary_union(polygons)
    if not candidate.is_valid:
        candidate = make_valid(candidate)

    normalized_polygons = list(iter_polygon_members(candidate))
    if not normalized_polygons:
        raise PolygonNormalizationError("polygon repair produced no polygonal area")

    normalized: BaseGeometry = (
        normalized_polygons[0]
        if len(normalized_polygons) == 1
        else unary_union(normalized_polygons)
    )
    if not isinstance(normalized, Polygon | MultiPolygon) or normalized.is_empty:
        raise PolygonNormalizationError("normalization did not produce Polygon/MultiPolygon")
    if not normalized.is_valid:
        raise PolygonNormalizationError("normalized polygon geometry is invalid")
    return normalized


def _iter_polygonal_geometries(
    geometry: BaseGeometry,
) -> Iterator[Polygon | MultiPolygon]:
    if isinstance(geometry, Polygon | MultiPolygon):
        yield geometry
        return
    if isinstance(geometry, GeometryCollection):
        for member in geometry.geoms:
            yield from _iter_polygonal_geometries(member)


def normalize_geojson_geometry(geometry: dict) -> dict:
    """Normalize a GeoJSON geometry to an ArcGIS-compatible polygon type."""
    if not isinstance(geometry, dict):
        raise PolygonNormalizationError("geometry must be a GeoJSON object")
    return mapping(polygonal_geometry(shape(geometry)))
