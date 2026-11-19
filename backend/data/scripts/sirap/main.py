"""Build the versioned polygon-only merged SIRAP boundary release."""

from __future__ import annotations

import argparse
import hashlib
import json
import urllib.request
from pathlib import Path

from helpers.geometry import normalize_geojson_geometry
from helpers.validate import validate_release_metadata, validate_repaired_collection

PUBLIC_BLOB_HOST = "https://aagibolq28slyfof.public.blob.vercel-storage.com"
SOURCE_URL = f"{PUBLIC_BLOB_HOST}/inputs/boundaries/sirap/siraps_merged.geojson"
SOURCE_SHA256 = "6900b9eba35871ef69ce0ed7222fc4f4b1388026ad5d5d40c3c2c9b8be9cb565"
REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_OUTPUT = REPO_ROOT / "data/boundaries/sirap/siraps_merged_polygon_v2.geojson"
DEFAULT_REPORT = (
    REPO_ROOT / "data/boundaries/sirap/siraps_merged_polygon_v2.provenance.json"
)
DEFAULT_METADATA = (
    REPO_ROOT / "data/boundaries/sirap/siraps_merged_polygon_v2.metadata.json"
)


def build_polygon_only_collection(source: dict) -> dict:
    """Return the same feature catalog with polygon-only geometries."""
    features = []
    for feature in source.get("features", []):
        repaired = {
            "type": "Feature",
            "properties": dict(feature.get("properties") or {}),
            "geometry": normalize_geojson_geometry(feature.get("geometry")),
        }
        if "id" in feature:
            repaired["id"] = feature["id"]
        features.append(repaired)
    return {
        "type": "FeatureCollection",
        "name": "siraps_merged_polygon_v2",
        "features": features,
    }


def serialize_geojson(data: dict) -> bytes:
    """Use stable UTF-8 serialization so the published checksum is reproducible."""
    return (
        json.dumps(data, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
        + "\n"
    ).encode("utf-8")


def download_pinned_source(url: str = SOURCE_URL) -> bytes:
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "dises-sirap-polygon-repair/2.0"},
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        return response.read()


def build_release_metadata(provenance: dict) -> dict:
    validation = provenance["validation"]
    output = provenance["output"]
    metadata = {
        "format": "sirap-boundary-metadata-v2",
        "geometryContract": "polygon-only",
        "featureCount": 10,
        "stableIdField": "sirap_id",
        "stableIds": validation["expected_ids"],
        "url": output["url"],
        "sha256": output["sha256"],
        "catalogSha256": validation["catalog_sha256"],
        "geometryCollectionSha256": validation["geometry_collection_sha256"],
        "crs": output["crs"],
        "provenance": provenance,
    }
    validate_release_metadata(metadata, provenance)
    return metadata


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-url", default=SOURCE_URL)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--report", type=Path, default=DEFAULT_REPORT)
    parser.add_argument("--metadata", type=Path, default=DEFAULT_METADATA)
    args = parser.parse_args()

    source_bytes = download_pinned_source(args.source_url)
    source_sha256 = hashlib.sha256(source_bytes).hexdigest()
    if source_sha256 != SOURCE_SHA256:
        raise RuntimeError(
            f"Pinned source checksum mismatch: expected {SOURCE_SHA256}, "
            f"got {source_sha256}"
        )

    source = json.loads(source_bytes)
    repaired = build_polygon_only_collection(source)
    validation = validate_repaired_collection(source, repaired)
    output_bytes = serialize_geojson(repaired)
    output_sha256 = hashlib.sha256(output_bytes).hexdigest()

    report = {
        "schema_version": 1,
        "source": {
            "url": args.source_url,
            "sha256": source_sha256,
            "bytes": len(source_bytes),
        },
        "output": {
            "pathname": "inputs/boundaries/sirap/siraps_merged_polygon_v2.geojson",
            "url": (
                f"{PUBLIC_BLOB_HOST}/inputs/boundaries/sirap/"
                "siraps_merged_polygon_v2.geojson"
            ),
            "sha256": output_sha256,
            "bytes": len(output_bytes),
            "content_type": "application/geo+json",
            "cache_control": "public, max-age=31536000",
            "crs": "EPSG:4326",
        },
        "validation": validation,
    }
    metadata = build_release_metadata(report)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.metadata.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(output_bytes)
    args.report.write_text(
        json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False) + "\n",
        encoding="utf-8",
    )
    args.metadata.write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2, allow_nan=False) + "\n",
        encoding="utf-8",
    )
    print(f"Wrote {args.output} ({len(output_bytes)} bytes, sha256={output_sha256})")
    print(f"Wrote {args.report}")
    print(f"Wrote {args.metadata}")


if __name__ == "__main__":
    main()
