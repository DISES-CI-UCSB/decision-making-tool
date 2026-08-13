"""Build the authoritative eight-scope SIRAP metric boundary release."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

PUBLIC_BLOB_HOST = "https://aagibolq28slyfof.public.blob.vercel-storage.com"
REPO_ROOT = Path(__file__).resolve().parents[3]
OUTPUT_FILENAME = "siraps_authoritative_combined_v3.geojson"
OUTPUT_PATHNAME = f"inputs/boundaries/sirap/{OUTPUT_FILENAME}"
METADATA_PATHNAME = f"metadata/{OUTPUT_FILENAME.removesuffix('.geojson')}.metadata.json"
DEFAULT_TERRITORIAL = (
    REPO_ROOT
    / "data/boundaries/sirap/siraps_territorial_authoritative_v3.geojson"
)
DEFAULT_THEMATIC_SOURCE = (
    REPO_ROOT / "data/boundaries/sirap/siraps_merged_polygon_v2.geojson"
)
DEFAULT_OUTPUT = REPO_ROOT / f"data/boundaries/sirap/{OUTPUT_FILENAME}"
DEFAULT_METADATA = DEFAULT_OUTPUT.with_suffix(".metadata.json")
DEFAULT_PROVENANCE = DEFAULT_OUTPUT.with_suffix(".provenance.json")

TERRITORIAL_SOURCE_SHA256 = (
    "7826e6cc0c34eb69446bb410427d8023415d6886339b624a2c0a6b990000db5d"
)
THEMATIC_SOURCE_SHA256 = (
    "2a44a7a4726448959432924a11703250a444fe9e06be3324563e7b89d14912de"
)
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
THEMATIC_CATALOG = (
    ("thematic_eje_cafetero_1", "Eje Cafetero"),
    ("thematic_macizo_2", "Macizo"),
)
THEMATIC_GEOMETRY_SHA256 = {
    "thematic_eje_cafetero_1": (
        "5288a528a2b7dcc67151180376b902c3d993aebfbcbae15a7bc34eb75822899b"
    ),
    "thematic_macizo_2": (
        "235fd8f6a33b8fe23aa4527ef46706aea91e1381c81e7b00eedf12c142936575"
    ),
}
TERRITORIAL_IDS = frozenset(item[0] for item in TERRITORIAL_CATALOG.values())
THEMATIC_IDS = frozenset(item[0] for item in THEMATIC_CATALOG)
EXPECTED_IDS = TERRITORIAL_IDS | THEMATIC_IDS
DEPRECATED_TERRITORIAL_IDS = frozenset(
    {
        "territorial_territorial_caribe_9",
        "territorial_territorial_pacifico_10",
    }
)


class SirapMetricBuildError(ValueError):
    """Raised when a source violates the authoritative metric contract."""


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


def _load_pinned(path: Path, expected_sha256: str, label: str) -> tuple[dict, int]:
    raw = path.read_bytes()
    observed_sha256 = hashlib.sha256(raw).hexdigest()
    if observed_sha256 != expected_sha256:
        raise SirapMetricBuildError(
            f"{label} checksum mismatch: expected {expected_sha256}, "
            f"got {observed_sha256}"
        )
    try:
        document = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise SirapMetricBuildError(f"{label} is not valid UTF-8 GeoJSON") from exc
    if document.get("type") != "FeatureCollection" or not isinstance(
        document.get("features"), list
    ):
        raise SirapMetricBuildError(f"{label} must be a GeoJSON FeatureCollection")
    return document, len(raw)


def _validated_feature(
    feature: dict,
    *,
    expected_id: str,
    expected_name: str,
    expected_kind: str,
) -> dict:
    properties = feature.get("properties")
    geometry = feature.get("geometry")
    if not isinstance(properties, dict):
        raise SirapMetricBuildError(f"{expected_id}: missing properties")
    expected_properties = {
        "sirap_id": expected_id,
        "sirap_name": expected_name,
        "sirap_kind": expected_kind,
    }
    mismatches = [
        field
        for field, expected in expected_properties.items()
        if properties.get(field) != expected
    ]
    if mismatches:
        raise SirapMetricBuildError(
            f"{expected_id}: source identity mismatch for {', '.join(mismatches)}"
        )
    geometry_type = geometry.get("type") if isinstance(geometry, dict) else None
    if geometry_type not in {"Polygon", "MultiPolygon"}:
        raise SirapMetricBuildError(
            f"{expected_id}: expected polygon geometry, got {geometry_type!r}"
        )
    return {
        "type": "Feature",
        "properties": dict(properties),
        "geometry": geometry,
    }


def _features_by_id(document: dict, label: str) -> dict[str, dict]:
    result = {}
    for feature in document["features"]:
        properties = feature.get("properties")
        sirap_id = properties.get("sirap_id") if isinstance(properties, dict) else None
        if not isinstance(sirap_id, str) or not sirap_id:
            raise SirapMetricBuildError(f"{label} contains a feature without sirap_id")
        if sirap_id in result:
            raise SirapMetricBuildError(f"{label} contains duplicate ID {sirap_id!r}")
        result[sirap_id] = feature
    return result


def build_collection(territorial: dict, thematic_source: dict) -> dict:
    territorial_by_id = _features_by_id(territorial, "territorial source")
    thematic_by_id = _features_by_id(thematic_source, "thematic source")
    if set(territorial_by_id) != TERRITORIAL_IDS:
        raise SirapMetricBuildError(
            "territorial source must contain exactly the six authoritative IDs"
        )

    features = []
    for sirap_id, sirap_name in THEMATIC_CATALOG:
        feature = _validated_feature(
            thematic_by_id[sirap_id],
            expected_id=sirap_id,
            expected_name=sirap_name,
            expected_kind="thematic",
        )
        geometry_hash = canonical_sha256(feature["geometry"])
        if geometry_hash != THEMATIC_GEOMETRY_SHA256[sirap_id]:
            raise SirapMetricBuildError(
                f"{sirap_id}: thematic geometry fingerprint mismatch"
            )
        features.append(feature)

    for source_code, (sirap_id, sirap_name) in TERRITORIAL_CATALOG.items():
        feature = _validated_feature(
            territorial_by_id[sirap_id],
            expected_id=sirap_id,
            expected_name=sirap_name,
            expected_kind="territorial",
        )
        if feature["properties"].get("source_code") != source_code:
            raise SirapMetricBuildError(f"{sirap_id}: source_code mismatch")
        features.append(feature)

    observed_ids = {feature["properties"]["sirap_id"] for feature in features}
    if observed_ids != EXPECTED_IDS or observed_ids & DEPRECATED_TERRITORIAL_IDS:
        raise SirapMetricBuildError(
            "combined source does not match the exact eight-scope catalog"
        )
    return {
        "type": "FeatureCollection",
        "name": "siraps_authoritative_combined_v3",
        "features": features,
    }


def build_documents(
    *,
    territorial_path: Path,
    thematic_path: Path,
) -> tuple[bytes, dict, dict]:
    territorial, territorial_bytes = _load_pinned(
        territorial_path,
        TERRITORIAL_SOURCE_SHA256,
        "territorial source",
    )
    thematic, thematic_bytes = _load_pinned(
        thematic_path,
        THEMATIC_SOURCE_SHA256,
        "thematic source",
    )
    collection = build_collection(territorial, thematic)
    output_bytes = serialize_json(collection)
    output_sha256 = hashlib.sha256(output_bytes).hexdigest()
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
    kinds = {
        feature["properties"]["sirap_id"]: feature["properties"]["sirap_kind"]
        for feature in collection["features"]
    }
    catalog_sha256 = canonical_sha256(sorted(catalog))
    geometry_collection_sha256 = canonical_sha256(geometry_catalog)
    output_url = f"{PUBLIC_BLOB_HOST}/{OUTPUT_PATHNAME}"
    provenance = {
        "schema_version": 1,
        "purpose": "authoritative combined SIRAP metric boundary",
        "sources": {
            "territorial": {
                "pathname": (
                    "inputs/boundaries/sirap/"
                    "siraps_territorial_authoritative_v3.geojson"
                ),
                "sha256": TERRITORIAL_SOURCE_SHA256,
                "bytes": territorial_bytes,
                "feature_count": 6,
            },
            "thematic": {
                "pathname": (
                    "inputs/boundaries/sirap/siraps_merged_polygon_v2.geojson"
                ),
                "sha256": THEMATIC_SOURCE_SHA256,
                "bytes": thematic_bytes,
                "selected_ids": sorted(THEMATIC_IDS),
                "selected_geometry_sha256": THEMATIC_GEOMETRY_SHA256,
            },
        },
        "output": {
            "pathname": OUTPUT_PATHNAME,
            "url": output_url,
            "sha256": output_sha256,
            "bytes": len(output_bytes),
            "content_type": "application/geo+json",
            "crs": "EPSG:4326",
        },
        "validation": {
            "feature_count": 8,
            "catalog": catalog,
            "stable_ids": sorted(EXPECTED_IDS),
            "kinds": kinds,
            "catalog_sha256": catalog_sha256,
            "geometry_collection_sha256": geometry_collection_sha256,
            "geometry_sha256": dict(geometry_catalog),
            "excluded_deprecated_ids": sorted(DEPRECATED_TERRITORIAL_IDS),
            "geometry_types": sorted(
                {feature["geometry"]["type"] for feature in collection["features"]}
            ),
        },
    }
    metadata = {
        "format": "sirap-boundary-metadata-v3",
        "geometryContract": "polygon-only",
        "metricCompatible": True,
        "crs": "EPSG:4326",
        "featureCount": 8,
        "stableIdField": "sirap_id",
        "nameField": "sirap_name",
        "kindField": "sirap_kind",
        "stableIds": sorted(EXPECTED_IDS),
        "kinds": kinds,
        "pathname": OUTPUT_PATHNAME,
        "metadataPathname": METADATA_PATHNAME,
        "url": output_url,
        "sha256": output_sha256,
        "catalogSha256": catalog_sha256,
        "geometryCollectionSha256": geometry_collection_sha256,
        "provenance": provenance,
    }
    return output_bytes, metadata, provenance


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--territorial", type=Path, default=DEFAULT_TERRITORIAL)
    parser.add_argument("--thematic-source", type=Path, default=DEFAULT_THEMATIC_SOURCE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--metadata", type=Path, default=DEFAULT_METADATA)
    parser.add_argument("--provenance", type=Path, default=DEFAULT_PROVENANCE)
    args = parser.parse_args()

    output_bytes, metadata, provenance = build_documents(
        territorial_path=args.territorial,
        thematic_path=args.thematic_source,
    )
    for path in (args.output, args.metadata, args.provenance):
        path.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(output_bytes)
    args.metadata.write_bytes(serialize_json(metadata))
    args.provenance.write_bytes(serialize_json(provenance))
    print(
        f"Wrote {args.output} "
        f"({metadata['featureCount']} features, sha256={metadata['sha256']})"
    )
    print(f"Wrote {args.metadata}")
    print(f"Wrote {args.provenance}")


if __name__ == "__main__":
    main()
