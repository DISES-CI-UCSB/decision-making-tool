"""Read and normalize authoritative SIRAP shapefiles."""

from __future__ import annotations

import hashlib
from pathlib import Path

import shapefile
from pyproj import CRS, Transformer
from shapely import set_precision, transform
from shapely.geometry import mapping, shape

from helpers.geometry import polygonal_geometry

SHAPEFILE_SUFFIXES = (".cpg", ".dbf", ".prj", ".shp", ".shx")


def read_features(
    shapefile_path: Path,
    *,
    code_field: str,
    catalog: dict[str, tuple[str, str]],
    kind: str,
) -> list[dict]:
    """Return stable-ID GeoJSON features reprojected to EPSG:4326."""
    transformer = Transformer.from_crs(
        _source_crs(shapefile_path),
        "EPSG:4326",
        always_xy=True,
    )
    features = []

    with shapefile.Reader(str(shapefile_path), encoding="utf-8") as reader:
        for shape_record in reader.iterShapeRecords():
            properties = shape_record.record.as_dict()
            code = str(properties.get(code_field, "")).strip()
            if code not in catalog:
                raise ValueError(f"Unexpected {code_field} value {code!r}")

            sirap_id, sirap_name = catalog[code]
            source_geometry = shape(shape_record.shape.__geo_interface__)
            projected = transform(
                source_geometry,
                transformer.transform,
                interleaved=False,
            )
            geometry = polygonal_geometry(set_precision(projected, grid_size=1e-7))
            features.append(
                {
                    "type": "Feature",
                    "properties": {
                        "sirap_id": sirap_id,
                        "sirap_name": sirap_name,
                        "sirap_kind": kind,
                        "source_file": shapefile_path.name,
                        "source_code": code,
                    },
                    "geometry": mapping(geometry),
                }
            )

    missing = set(catalog) - {
        feature["properties"]["source_code"] for feature in features
    }
    if missing:
        raise ValueError(f"Missing {code_field} values: {sorted(missing)}")
    if len(features) != len(catalog):
        raise ValueError(f"Expected {len(catalog)} {kind} features, got {len(features)}")
    return features


def source_manifest(shapefile_path: Path) -> dict:
    """Describe and checksum every required shapefile sidecar."""
    files = []
    for suffix in SHAPEFILE_SUFFIXES:
        path = shapefile_path.with_suffix(suffix)
        raw = path.read_bytes()
        files.append(
            {
                "filename": path.name,
                "sha256": hashlib.sha256(raw).hexdigest(),
                "bytes": len(raw),
            }
        )
    return {
        "shapefile": shapefile_path.name,
        "crs": _source_crs(shapefile_path).to_string(),
        "files": files,
    }


def _source_crs(shapefile_path: Path) -> CRS:
    return CRS.from_wkt(shapefile_path.with_suffix(".prj").read_text(encoding="utf-8"))
