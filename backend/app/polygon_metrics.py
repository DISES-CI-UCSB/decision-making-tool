from __future__ import annotations

import time
from typing import Any, Iterable

from .artifacts import RuntimeArtifact
from .metric_adapters import AREA_METRIC_IDS, calculate_area_metrics_from_masks

AREA_ALIAS = "area"
SUPPORTED_METRICS = {AREA_ALIAS, *AREA_METRIC_IDS}


class PolygonMetricError(ValueError):
    pass


def requested_area_metrics(metrics: list[str] | None) -> list[str]:
    if not metrics:
        return list(AREA_METRIC_IDS)

    unsupported = sorted(set(metrics) - SUPPORTED_METRICS)
    if unsupported:
        raise PolygonMetricError(f"Unsupported metric ids: {', '.join(unsupported)}.")

    if AREA_ALIAS in metrics:
        return list(AREA_METRIC_IDS)

    return [metric for metric in AREA_METRIC_IDS if metric in metrics]


def calculate_custom_polygon_metrics(
    artifact: RuntimeArtifact,
    geometry: dict[str, Any],
    requested_metrics: list[str] | None,
) -> tuple[dict[str, float | None], dict[str, Any]]:
    started = time.perf_counter()
    polygons = _parse_geometry(geometry)
    metric_ids = requested_area_metrics(requested_metrics)
    selected_row: list[bool] = []
    valid_row: list[bool] = []
    matched_cells: list[str] = []

    for index, cell in enumerate(artifact.area_grid["cells"]):
        centroid = _bbox_centroid(cell["bbox"])
        in_polygon = any(_point_in_polygon(centroid, polygon) for polygon in polygons)
        is_valid = bool(cell["valid"]) and in_polygon
        is_selected = bool(cell["selected"]) and is_valid
        selected_row.append(is_selected)
        valid_row.append(is_valid)
        if is_valid:
            matched_cells.append(str(cell.get("id", index)))

    all_metrics = calculate_area_metrics_from_masks(
        [selected_row],
        [valid_row],
        pixel_area_km2=float(artifact.area_grid["pixel_area_km2"]),
    )
    elapsed_ms = round((time.perf_counter() - started) * 1000, 3)
    metadata = {
        "request_ms": elapsed_ms,
        "matched_cell_count": len(matched_cells),
        "matched_cells": matched_cells,
        "metric_source": "tiny-area-grid-centroid-v1",
    }
    return {metric_id: all_metrics[metric_id] for metric_id in metric_ids}, metadata


def _parse_geometry(geometry: dict[str, Any]) -> list[list[list[tuple[float, float]]]]:
    if not isinstance(geometry, dict):
        raise PolygonMetricError("geometry must be a GeoJSON object.")

    geometry_type = geometry.get("type")
    coordinates = geometry.get("coordinates")
    if geometry_type == "Polygon":
        return [_parse_polygon(coordinates)]
    if geometry_type == "MultiPolygon":
        if not isinstance(coordinates, list) or not coordinates:
            raise PolygonMetricError("MultiPolygon coordinates must be a non-empty array.")
        return [_parse_polygon(polygon) for polygon in coordinates]

    raise PolygonMetricError("geometry type must be Polygon or MultiPolygon.")


def _parse_polygon(coordinates: Any) -> list[list[tuple[float, float]]]:
    if not isinstance(coordinates, list) or not coordinates:
        raise PolygonMetricError("Polygon coordinates must include at least one ring.")

    rings = [_parse_ring(ring) for ring in coordinates]
    if _ring_area(rings[0]) == 0:
        raise PolygonMetricError("Polygon exterior ring must have non-zero area.")
    return rings


def _parse_ring(ring: Any) -> list[tuple[float, float]]:
    if not isinstance(ring, list) or len(ring) < 4:
        raise PolygonMetricError("Polygon rings must include at least four positions.")

    parsed: list[tuple[float, float]] = []
    for position in ring:
        if (
            not isinstance(position, list)
            or len(position) < 2
            or not isinstance(position[0], (int, float))
            or not isinstance(position[1], (int, float))
        ):
            raise PolygonMetricError("Polygon positions must be numeric [x, y] arrays.")
        parsed.append((float(position[0]), float(position[1])))

    if parsed[0] != parsed[-1]:
        raise PolygonMetricError("Polygon rings must be closed.")
    return parsed


def _ring_area(ring: list[tuple[float, float]]) -> float:
    return abs(
        sum(
            (x1 * y2) - (x2 * y1)
            for (x1, y1), (x2, y2) in zip(ring, ring[1:])
        )
        / 2
    )


def _bbox_centroid(bbox: Iterable[float]) -> tuple[float, float]:
    min_x, min_y, max_x, max_y = bbox
    return ((float(min_x) + float(max_x)) / 2, (float(min_y) + float(max_y)) / 2)


def _point_in_polygon(
    point: tuple[float, float],
    polygon: list[list[tuple[float, float]]],
) -> bool:
    exterior, *holes = polygon
    if not _point_in_ring(point, exterior):
        return False
    return not any(_point_in_ring(point, hole) for hole in holes)


def _point_in_ring(point: tuple[float, float], ring: list[tuple[float, float]]) -> bool:
    x, y = point
    inside = False
    for (x1, y1), (x2, y2) in zip(ring, ring[1:]):
        if _point_on_segment(point, (x1, y1), (x2, y2)):
            return True
        crosses = (y1 > y) != (y2 > y)
        if crosses:
            intersect_x = ((x2 - x1) * (y - y1) / (y2 - y1)) + x1
            if x < intersect_x:
                inside = not inside
    return inside


def _point_on_segment(
    point: tuple[float, float],
    start: tuple[float, float],
    end: tuple[float, float],
) -> bool:
    x, y = point
    x1, y1 = start
    x2, y2 = end
    cross = (y - y1) * (x2 - x1) - (x - x1) * (y2 - y1)
    if abs(cross) > 1e-12:
        return False
    return min(x1, x2) <= x <= max(x1, x2) and min(y1, y2) <= y <= max(y1, y2)
