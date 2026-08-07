"""Acquisition, geometry conversion, provenance, and validation."""

from __future__ import annotations

import hashlib
import importlib.metadata
import json
import platform
import shutil
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import geopandas as gpd
import pyproj
import requests
import shapely
from requests.adapters import HTTPAdapter
from shapely.geometry import GeometryCollection, MultiPolygon, Polygon, mapping, shape
from urllib3.util.retry import Retry

from helpers.blob import PUBLIC_HOST, sha256_file

OUTPUT_CRS = "EPSG:4326"
SIMPLIFICATION_CRS = "EPSG:9377"
SIMPLIFICATION_METERS = 10.5
VERSION = "v0.1.0"


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(f"{path.suffix}.tmp")
    temporary.write_text(
        json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False)
        + "\n",
        encoding="utf-8",
    )
    temporary.replace(path)


def _session() -> requests.Session:
    session = requests.Session()
    retry = Retry(
        total=5,
        backoff_factor=1,
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=("GET", "POST"),
    )
    session.mount("https://", HTTPAdapter(max_retries=retry))
    session.headers["User-Agent"] = "DISES-reference-layer-pipeline/0.1.0"
    return session


def _request_json(
    session: requests.Session,
    url: str,
    parameters: dict[str, Any],
    *,
    method: str = "GET",
) -> dict[str, Any]:
    response = session.request(method, url, params=parameters, timeout=180)
    response.raise_for_status()
    payload = response.json()
    if payload.get("error"):
        raise RuntimeError(f"ArcGIS error from {url}: {payload['error']}")
    return payload


def _source_epsg(asset: dict[str, Any]) -> int:
    return int(str(asset["source_crs"]).split(":")[-1])


def _acquire_arcgis(
    asset: dict[str, Any], raw_dir: Path, retrieved_at: str
) -> tuple[gpd.GeoDataFrame, Path, dict[str, Any]]:
    session = _session()
    source_url = asset["source_url"]
    layer_metadata = _request_json(session, source_url, {"f": "pjson"})
    item_metadata = _request_json(session, asset["item_url"], {"f": "json"})
    ids = _request_json(
        session,
        f"{source_url}/query",
        {"f": "json", "where": "1=1", "returnIdsOnly": "true"},
        method="POST",
    )
    oid_field = ids.get("objectIdFieldName") or layer_metadata.get("objectIdField")
    object_ids = sorted(int(value) for value in ids.get("objectIds") or [])
    if not oid_field or not object_ids:
        raise RuntimeError(f"{asset['id']} returned no object IDs")

    write_json(raw_dir / "layer-metadata.json", layer_metadata)
    write_json(raw_dir / "item-metadata.json", item_metadata)
    write_json(
        raw_dir / "source-request.json",
        {
            "retrievedAt": retrieved_at,
            "sourceUrl": source_url,
            "objectIdField": oid_field,
            "objectIds": object_ids,
            "sourceCrs": asset["source_crs"],
        },
    )

    features: list[dict[str, Any]] = []
    page_size = min(int(layer_metadata.get("maxRecordCount") or 1000), 1000)
    for page_index, start in enumerate(range(0, len(object_ids), page_size)):
        page_ids = object_ids[start : start + page_size]
        page = _request_json(
            session,
            f"{source_url}/query",
            {
                "f": "geojson",
                "objectIds": ",".join(str(value) for value in page_ids),
                "outFields": "*",
                "returnGeometry": "true",
                "returnZ": "false",
                "returnM": "false",
                "outSR": _source_epsg(asset),
                "orderByFields": f"{oid_field} ASC",
            },
            method="POST",
        )
        page_features = page.get("features")
        if not isinstance(page_features, list):
            raise RuntimeError(f"{asset['id']} page {page_index} is not GeoJSON")
        write_json(raw_dir / "pages" / f"page-{page_index:04d}.geojson", page)
        features.extend(page_features)

    def feature_oid(feature: dict[str, Any]) -> int:
        properties = feature.get("properties") or {}
        value = properties.get(oid_field, properties.get(str(oid_field).upper()))
        return int(value)

    features.sort(key=feature_oid)
    actual_ids = [feature_oid(feature) for feature in features]
    if actual_ids != object_ids:
        raise RuntimeError(f"{asset['id']} download did not exactly match its OID list")

    snapshot_path = raw_dir / "source-snapshot.geojson"
    snapshot = {"type": "FeatureCollection", "features": features}
    write_json(snapshot_path, snapshot)
    frame = gpd.GeoDataFrame.from_features(features, crs=asset["source_crs"])
    source_details = {
        "sourceFeatureCount": len(object_ids),
        "objectIdField": oid_field,
        "layerName": layer_metadata.get("name"),
        "serviceItemId": layer_metadata.get("serviceItemId"),
        "rawFiles": [
            "item-metadata.json",
            "layer-metadata.json",
            "source-request.json",
            "source-snapshot.geojson",
        ],
    }
    return frame, snapshot_path, source_details


def _acquire_shapefile(
    asset: dict[str, Any], raw_dir: Path, retrieved_at: str
) -> tuple[gpd.GeoDataFrame, Path, dict[str, Any]]:
    source_path = Path(asset["local_path"])
    sidecars = sorted(source_path.parent.glob(f"{source_path.stem}.*"))
    required = {".shp", ".shx", ".dbf", ".prj"}
    if not required.issubset({path.suffix.lower() for path in sidecars}):
        raise RuntimeError(f"incomplete source shapefile: {source_path}")

    archive_path = raw_dir / "source-shapefile.zip"
    archive_path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for sidecar in sidecars:
            archive.write(sidecar, arcname=sidecar.name)
    (raw_dir / "source-files").mkdir(parents=True, exist_ok=True)
    for sidecar in sidecars:
        shutil.copy2(sidecar, raw_dir / "source-files" / sidecar.name)

    frame = gpd.read_file(source_path)
    if frame.crs is None:
        raise RuntimeError(f"source shapefile has no CRS: {source_path}")
    if frame.crs.to_epsg() != _source_epsg(asset):
        raise RuntimeError(
            f"outline CRS is {frame.crs.to_string()}, expected {asset['source_crs']}"
        )
    write_json(
        raw_dir / "source-request.json",
        {
            "retrievedAt": retrieved_at,
            "sourceUrl": asset["source_url"],
            "sourceCrs": asset["source_crs"],
            "sidecars": [path.name for path in sidecars],
        },
    )
    return frame, archive_path, {
        "sourceFeatureCount": len(frame),
        "rawFiles": ["source-shapefile.zip", "source-request.json", "source-files/"],
    }


def _polygonal(geometry: shapely.Geometry) -> MultiPolygon:
    polygons: list[Polygon] = []

    def collect(value: shapely.Geometry) -> None:
        if isinstance(value, Polygon):
            polygons.append(value)
        elif isinstance(value, MultiPolygon):
            polygons.extend(value.geoms)
        elif isinstance(value, GeometryCollection):
            for member in value.geoms:
                collect(member)

    collect(geometry)
    result = MultiPolygon(polygons)
    if result.is_empty:
        raise RuntimeError("geometry repair produced no polygonal geometry")
    return result


def _clean_property(value: Any) -> Any:
    if value is None:
        return None
    if hasattr(value, "item"):
        value = value.item()
    if isinstance(value, float) and (value != value):
        return None
    if isinstance(value, (datetime,)):
        return value.isoformat()
    return value


def _round_coordinates(value: Any) -> Any:
    if isinstance(value, (float, int)):
        return round(float(value), 6)
    return [_round_coordinates(member) for member in value]


def _write_geojson(
    path: Path, frame: gpd.GeoDataFrame, asset: dict[str, Any]
) -> None:
    features: list[dict[str, Any]] = []
    property_columns = [column for column in frame.columns if column != frame.geometry.name]
    for _, row in frame.iterrows():
        geometry = mapping(row.geometry)
        geometry["coordinates"] = _round_coordinates(geometry["coordinates"])
        properties = {
            column: _clean_property(row[column]) for column in property_columns
        }
        if asset.get("visual_only"):
            properties.update(
                {
                    "name": "Colombia",
                    "displayRole": "visual-only-national-outline",
                    "roleInMetricCalculation": "none",
                }
            )
        features.append(
            {"type": "Feature", "properties": properties, "geometry": geometry}
        )
    write_json(path, {"type": "FeatureCollection", "features": features})


def _validate_output(
    output_path: Path,
    *,
    expected_count: int,
    source_count: int,
) -> dict[str, Any]:
    payload = json.loads(output_path.read_text(encoding="utf-8"))
    features = payload.get("features") or []
    if len(features) != expected_count or expected_count != source_count:
        raise RuntimeError(
            f"feature count mismatch: source={source_count}, output={len(features)}"
        )

    geometries = [shape(feature["geometry"]) for feature in features]
    invalid = [index for index, geometry in enumerate(geometries) if not geometry.is_valid]
    empty = [index for index, geometry in enumerate(geometries) if geometry.is_empty]
    wrong_types = [
        index for index, geometry in enumerate(geometries) if geometry.geom_type != "MultiPolygon"
    ]
    empty_attributes = [
        index
        for index, feature in enumerate(features)
        if not any(
            value not in (None, "")
            for value in (feature.get("properties") or {}).values()
        )
    ]
    if invalid or empty or wrong_types or empty_attributes:
        raise RuntimeError(
            "output validation failed: "
            f"invalid={invalid}, empty={empty}, nonMultiPolygon={wrong_types}, "
            f"emptyAttributes={empty_attributes}"
        )

    bounds = gpd.GeoSeries(geometries, crs=OUTPUT_CRS).total_bounds.tolist()
    if not (
        -180 <= bounds[0] <= bounds[2] <= 180
        and -90 <= bounds[1] <= bounds[3] <= 90
    ):
        raise RuntimeError(f"output bounds are outside EPSG:4326: {bounds}")
    return {
        "passed": True,
        "featureCount": len(features),
        "validGeometryCount": len(features),
        "multiPolygonCount": len(features),
        "nonemptyAttributeCount": len(features),
        "bounds": [round(float(value), 6) for value in bounds],
        "outputCrs": OUTPUT_CRS,
        "coordinatePrecisionDecimals": 6,
    }


def tool_versions() -> dict[str, str]:
    versions = {
        "python": platform.python_version(),
        "geopandas": importlib.metadata.version("geopandas"),
        "shapely": shapely.__version__,
        "geos": shapely.geos_version_string,
        "pyproj": pyproj.__version__,
        "proj": pyproj.proj_version_str,
    }
    try:
        versions["pyogrio"] = importlib.metadata.version("pyogrio")
        import pyogrio

        versions["gdal"] = pyogrio.__gdal_version_string__
    except (ImportError, importlib.metadata.PackageNotFoundError):
        versions["gdal"] = "unavailable"
    return versions


def build_asset(asset: dict[str, Any], work_dir: Path) -> dict[str, Any]:
    asset_dir = work_dir / asset["id"]
    raw_dir = asset_dir / "raw"
    output_dir = asset_dir / "output"
    retrieved_at = utc_now()

    if asset["kind"] == "arcgis":
        frame, source_snapshot, source_details = _acquire_arcgis(
            asset, raw_dir, retrieved_at
        )
    else:
        frame, source_snapshot, source_details = _acquire_shapefile(
            asset, raw_dir, retrieved_at
        )
    source_count = len(frame)
    if source_count < 1 or source_count != source_details["sourceFeatureCount"]:
        raise RuntimeError(f"{asset['id']} has an invalid source feature count")

    original_vertices = int(
        sum(shapely.get_num_coordinates(value) for value in frame.geometry)
    )
    repaired: list[MultiPolygon] = []
    repaired_count = 0
    for geometry in frame.geometry:
        if geometry is None or geometry.is_empty:
            raise RuntimeError(f"{asset['id']} contains an empty source geometry")
        geometry = shapely.force_2d(geometry)
        if not geometry.is_valid:
            repaired_count += 1
        repaired.append(_polygonal(shapely.make_valid(geometry)))

    projected = gpd.GeoDataFrame(
        frame.drop(columns=frame.geometry.name),
        geometry=repaired,
        crs=frame.crs,
    ).to_crs(SIMPLIFICATION_CRS)
    simplified = [
        _polygonal(geometry.simplify(SIMPLIFICATION_METERS, preserve_topology=True))
        for geometry in projected.geometry
    ]
    output_frame = gpd.GeoDataFrame(
        projected.drop(columns=projected.geometry.name),
        geometry=simplified,
        crs=SIMPLIFICATION_CRS,
    ).to_crs(OUTPUT_CRS)
    output_frame.geometry = [
        _polygonal(shapely.set_precision(geometry, grid_size=0.000001))
        for geometry in output_frame.geometry
    ]
    simplified_vertices = int(
        sum(shapely.get_num_coordinates(value) for value in output_frame.geometry)
    )

    output_path = output_dir / f"{asset['id']}.geojson"
    _write_geojson(output_path, output_frame, asset)
    validation = _validate_output(
        output_path, expected_count=len(output_frame), source_count=source_count
    )

    blob_prefix = f"inputs/reference/{asset['id']}/{VERSION}"
    geojson_blob_path = f"{blob_prefix}/{asset['id']}.geojson"
    metadata_blob_path = f"{blob_prefix}/{asset['id']}.metadata.json"
    metadata_path = output_dir / f"{asset['id']}.metadata.json"
    metadata = {
        "schemaVersion": "reference-layer-metadata-v1",
        "layerId": asset["id"],
        "title": asset["title"],
        "version": VERSION,
        "source": {
            "url": asset["source_url"],
            "organization": asset["organization"],
            "sourceCrs": asset["source_crs"],
            "retrievedAt": retrieved_at,
            "sha256": sha256_file(source_snapshot),
            **source_details,
        },
        "output": {
            "crs": OUTPUT_CRS,
            "sha256": sha256_file(output_path),
            "bytes": output_path.stat().st_size,
            "featureCount": len(output_frame),
            "blobPath": geojson_blob_path,
            "publicUrl": f"{PUBLIC_HOST}/{geojson_blob_path}",
        },
        "processing": {
            "geometryRepair": "Shapely MakeValid before simplification; polygonal components retained",
            "geometryNormalization": "2D MultiPolygon",
            "simplification": {
                "crs": SIMPLIFICATION_CRS,
                "toleranceMeters": SIMPLIFICATION_METERS,
                "preserveTopology": True,
            },
            "coordinatePrecisionDecimals": 6,
            "sourceVertexCount": original_vertices,
            "outputVertexCount": simplified_vertices,
            "repairedFeatureCount": repaired_count,
            "roleInMetricCalculation": "none",
            "displayOnly": bool(asset.get("visual_only")),
        },
        "validation": validation,
        "tools": tool_versions(),
        "metadataBlobPath": metadata_blob_path,
        "metadataPublicUrl": f"{PUBLIC_HOST}/{metadata_blob_path}",
    }
    write_json(metadata_path, metadata)
    return {
        "layerId": asset["id"],
        "geojsonPath": str(output_path),
        "metadataPath": str(metadata_path),
        "geojsonBlobPath": geojson_blob_path,
        "metadataBlobPath": metadata_blob_path,
        "validation": validation,
        "sourceSha256": metadata["source"]["sha256"],
        "outputSha256": metadata["output"]["sha256"],
    }
