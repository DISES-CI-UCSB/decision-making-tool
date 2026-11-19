"""Build the visual-only authoritative Territorial SIRAP boundary asset."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from helpers.shapefile_source import read_features, source_manifest

PUBLIC_BLOB_HOST = "https://aagibolq28slyfof.public.blob.vercel-storage.com"
OUTPUT_FILENAME = "siraps_territorial_authoritative_v3.geojson"
OUTPUT_PATHNAME = f"inputs/boundaries/sirap/{OUTPUT_FILENAME}"
REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_OUTPUT = REPO_ROOT / f"data/boundaries/sirap/{OUTPUT_FILENAME}"
DEFAULT_METADATA = DEFAULT_OUTPUT.with_suffix(".metadata.json")
DEFAULT_PROVENANCE = DEFAULT_OUTPUT.with_suffix(".provenance.json")

TERRITORIAL_CATALOG = {
    "DTAM": ("territorial_territorial_amazonia_3", "Territorial Amazonia"),
    "DTAN": (
        "territorial_territorial_andes_nororientales_4",
        "Territorial Andes Nororientales",
    ),
    "DTAO": (
        "territorial_territorial_andes_occidentales_5",
        "Territorial Andes Occidentales",
    ),
    "DTCA": ("territorial_territorial_caribe_6", "Territorial Caribe"),
    "DTOR": ("territorial_territorial_orinoquia_7", "Territorial Orinoquia"),
    "DTPA": ("territorial_territorial_pacifico_8", "Territorial Pacifico"),
}


def build_collection(source: Path) -> dict:
    """Return the stable six-feature EPSG:4326 territorial catalog."""
    features = read_features(
        source,
        code_field="Territoria",
        catalog=TERRITORIAL_CATALOG,
        kind="territorial",
    )
    features.sort(key=lambda feature: feature["properties"]["source_code"])
    return {
        "type": "FeatureCollection",
        "name": "siraps_territorial_authoritative_v3",
        "features": features,
    }


def serialize_json(document: dict) -> bytes:
    return (
        json.dumps(document, ensure_ascii=False, separators=(",", ":"), sort_keys=True) + "\n"
    ).encode("utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--metadata", type=Path, default=DEFAULT_METADATA)
    parser.add_argument("--provenance", type=Path, default=DEFAULT_PROVENANCE)
    args = parser.parse_args()

    collection = build_collection(args.source)
    output_bytes = serialize_json(collection)
    output_sha256 = hashlib.sha256(output_bytes).hexdigest()
    url = f"{PUBLIC_BLOB_HOST}/{OUTPUT_PATHNAME}"
    catalog = [
        [feature["properties"]["sirap_id"], feature["properties"]["sirap_name"]]
        for feature in collection["features"]
    ]

    metadata = {
        "format": "sirap-territorial-visual-boundary-v1",
        "geometryContract": "polygon-only",
        "crs": "EPSG:4326",
        "featureCount": len(collection["features"]),
        "stableIdField": "sirap_id",
        "nameField": "sirap_name",
        "pathname": OUTPUT_PATHNAME,
        "url": url,
        "sha256": output_sha256,
        "metricCompatible": False,
    }
    provenance = {
        "schema_version": 1,
        "purpose": "visual-only authoritative Territorial SIRAP comparison layer",
        "source": source_manifest(args.source),
        "output": {
            "pathname": OUTPUT_PATHNAME,
            "url": url,
            "sha256": output_sha256,
            "bytes": len(output_bytes),
            "content_type": "application/geo+json",
        },
        "validation": {
            "crs": "EPSG:4326",
            "feature_count": len(collection["features"]),
            "catalog": catalog,
            "geometry_types": sorted(
                {feature["geometry"]["type"] for feature in collection["features"]}
            ),
            "metric_compatible": False,
        },
    }

    for path in (args.output, args.metadata, args.provenance):
        path.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(output_bytes)
    args.metadata.write_bytes(serialize_json(metadata))
    args.provenance.write_bytes(serialize_json(provenance))

    print(f"Wrote {args.output}")
    print(f"Features: {len(collection['features'])}")
    print(f"SHA-256: {output_sha256}")


if __name__ == "__main__":
    main()
