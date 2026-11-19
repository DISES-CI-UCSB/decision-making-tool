"""Build the marine Caribe / Pacífico SIRAP analysis polygons.

These are ocean-extent features distinct from official land Territorial Caribe
(`territorial_territorial_caribe_6`) and Territorial Pacífico
(`territorial_territorial_pacifico_8`). Incoming source names stay
"Territorial Caribe/Pacifico"; this builder assigns marine IDs and labels.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

from osgeo import ogr, osr

ogr.UseExceptions()

REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_SHAPEFILE = (
    REPO_ROOT
    / "data/boundaries/sirap/sources/caribe_pacifico/caribe_pacifico.shp"
)
OUTPUT_FILENAME = "siraps_marine_caribe_pacifico_v1.geojson"
OUTPUT_SHA256 = "183dce77b1695649926c91d2fd1f6ed4b973cc336c3816035b4c91dccd9e6149"
DEFAULT_OUTPUT = REPO_ROOT / "data/boundaries/sirap" / OUTPUT_FILENAME
DEFAULT_METADATA = DEFAULT_OUTPUT.with_suffix(".metadata.json")
DEFAULT_PROVENANCE = DEFAULT_OUTPUT.with_suffix(".provenance.json")
PUBLIC_BLOB_HOST = "https://aagibolq28slyfof.public.blob.vercel-storage.com"

# Incoming shapefile `nombre` → stable marine SIRAP identity.
MARINE_SIRAP_BY_SOURCE_NAME = {
    "Territorial Caribe": (
        "territorial_marine_caribe",
        "Caribe marino",
    ),
    "Territorial Pacifico": (
        "territorial_marine_pacifico",
        "Pacífico marino",
    ),
}
EXPECTED_IDS = tuple(item[0] for item in MARINE_SIRAP_BY_SOURCE_NAME.values())


class MarineSirapBuildError(ValueError):
    """Raised when the marine SIRAP source violates its contract."""


def canonical_sha256(value: Any) -> str:
    encoded = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def serialize_json(document: dict) -> bytes:
    return (
        json.dumps(
            document,
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
            allow_nan=False,
        )
        + "\n"
    ).encode("utf-8")


def _geometry_to_4326(geometry: ogr.Geometry, source_srs: osr.SpatialReference) -> dict:
    dst_srs = osr.SpatialReference()
    dst_srs.ImportFromEPSG(4326)
    source_srs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    dst_srs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    cloned = geometry.Clone()
    cloned.Transform(osr.CoordinateTransformation(source_srs, dst_srs))
    geometry_json = json.loads(cloned.ExportToJson())
    if geometry_json.get("type") not in {"Polygon", "MultiPolygon"}:
        raise MarineSirapBuildError(
            f"expected polygon geometry, got {geometry_json.get('type')!r}"
        )
    return geometry_json


def build_collection(shapefile_path: Path) -> tuple[dict, int]:
    if not shapefile_path.exists():
        raise MarineSirapBuildError(f"missing shapefile {shapefile_path}")
    source_bytes = shapefile_path.read_bytes()
    dataset = ogr.Open(str(shapefile_path))
    if dataset is None:
        raise MarineSirapBuildError(f"could not open {shapefile_path}")
    layer = dataset.GetLayer(0)
    source_srs = layer.GetSpatialRef()
    if source_srs is None:
        raise MarineSirapBuildError("shapefile is missing a spatial reference")

    by_name: dict[str, dict] = {}
    layer.ResetReading()
    for feature in layer:
        source_name = feature.GetField("nombre")
        if source_name not in MARINE_SIRAP_BY_SOURCE_NAME:
            raise MarineSirapBuildError(
                f"unexpected source name {source_name!r}; "
                f"expected {sorted(MARINE_SIRAP_BY_SOURCE_NAME)}"
            )
        if source_name in by_name:
            raise MarineSirapBuildError(f"duplicate source name {source_name!r}")
        sirap_id, sirap_name = MARINE_SIRAP_BY_SOURCE_NAME[source_name]
        geometry = feature.GetGeometryRef()
        if geometry is None:
            raise MarineSirapBuildError(f"{source_name!r} has no geometry")
        by_name[source_name] = {
            "type": "Feature",
            "properties": {
                "sirap_id": sirap_id,
                "sirap_name": sirap_name,
                "sirap_kind": "marine",
                "source_file": "caribe_pacifico.shp",
                "source_name": source_name,
                "source_code": feature.GetField("source"),
            },
            "geometry": _geometry_to_4326(geometry, source_srs),
        }

    missing = set(MARINE_SIRAP_BY_SOURCE_NAME) - set(by_name)
    if missing:
        raise MarineSirapBuildError(f"shapefile missing {sorted(missing)}")

    features = [
        by_name[source_name] for source_name in MARINE_SIRAP_BY_SOURCE_NAME
    ]
    return (
        {
            "type": "FeatureCollection",
            "name": "siraps_marine_caribe_pacifico_v1",
            "features": features,
        },
        len(source_bytes),
    )


def build_documents(*, shapefile_path: Path) -> tuple[bytes, dict, dict]:
    collection, source_bytes = build_collection(shapefile_path)
    output_bytes = serialize_json(collection)
    output_sha256 = hashlib.sha256(output_bytes).hexdigest()
    if output_sha256 != OUTPUT_SHA256:
        raise MarineSirapBuildError(
            f"output checksum mismatch: expected {OUTPUT_SHA256}, got {output_sha256}"
        )
    catalog = [
        [feature["properties"]["sirap_id"], feature["properties"]["sirap_name"]]
        for feature in collection["features"]
    ]
    geometry_catalog = [
        [
            feature["properties"]["sirap_id"],
            canonical_sha256(feature["geometry"]),
        ]
        for feature in collection["features"]
    ]
    output_pathname = (
        f"inputs/boundaries/sirap/v1/sha256-{output_sha256}/{OUTPUT_FILENAME}"
    )
    output_url = f"{PUBLIC_BLOB_HOST}/{output_pathname}"
    shapefile_sha256 = hashlib.sha256(shapefile_path.read_bytes()).hexdigest()
    provenance = {
        "schema_version": 1,
        "purpose": "marine Caribe and Pacífico SIRAP analysis extents",
        "sources": {
            "shapefile": {
                "pathname": "data/boundaries/sirap/sources/caribe_pacifico/caribe_pacifico.shp",
                "sha256": shapefile_sha256,
                "bytes": source_bytes,
                "crs": "EPSG:4686",
            }
        },
        "output": {
            "pathname": output_pathname,
            "url": output_url,
            "sha256": output_sha256,
            "bytes": len(output_bytes),
            "content_type": "application/geo+json",
            "crs": "EPSG:4326",
        },
        "validation": {
            "feature_count": 2,
            "catalog": catalog,
            "stable_ids": list(EXPECTED_IDS),
            "catalog_sha256": canonical_sha256(sorted(catalog)),
            "geometry_collection_sha256": canonical_sha256(geometry_catalog),
            "geometry_sha256": dict(geometry_catalog),
            "geometry_types": sorted(
                {feature["geometry"]["type"] for feature in collection["features"]}
            ),
        },
    }
    metadata = {
        "format": "sirap-marine-boundary-metadata-v1",
        "geometryContract": "polygon-only",
        "metricCompatible": True,
        "planningDomain": "marine",
        "crs": "EPSG:4326",
        "featureCount": 2,
        "stableIdField": "sirap_id",
        "nameField": "sirap_name",
        "kindField": "sirap_kind",
        "stableIds": list(EXPECTED_IDS),
        "pathname": output_pathname,
        "url": output_url,
        "sha256": output_sha256,
        "catalogSha256": provenance["validation"]["catalog_sha256"],
        "geometryCollectionSha256": provenance["validation"][
            "geometry_collection_sha256"
        ],
        "provenance": provenance,
    }
    return output_bytes, metadata, provenance


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--shapefile", type=Path, default=DEFAULT_SHAPEFILE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--metadata", type=Path, default=DEFAULT_METADATA)
    parser.add_argument("--provenance", type=Path, default=DEFAULT_PROVENANCE)
    args = parser.parse_args()

    output_bytes, metadata, provenance = build_documents(
        shapefile_path=args.shapefile
    )
    for path in (args.output, args.metadata, args.provenance):
        path.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(output_bytes)
    args.metadata.write_bytes(serialize_json(metadata))
    args.provenance.write_bytes(serialize_json(provenance))
    print(
        f"wrote {args.output} ({len(output_bytes)} bytes, sha256={metadata['sha256']})"
    )


if __name__ == "__main__":
    main()
