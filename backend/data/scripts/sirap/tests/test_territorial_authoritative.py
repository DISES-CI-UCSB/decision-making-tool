import hashlib
import json
from pathlib import Path

from shapely.geometry import shape

from build_territorial_authoritative import (
    DEFAULT_METADATA,
    DEFAULT_OUTPUT,
    DEFAULT_PROVENANCE,
    OUTPUT_FILENAME,
    TERRITORIAL_CATALOG,
    serialize_json,
)


def test_authoritative_territorial_release_is_stable_and_visual_only():
    collection = json.loads(DEFAULT_OUTPUT.read_text(encoding="utf-8"))
    metadata = json.loads(DEFAULT_METADATA.read_text(encoding="utf-8"))
    provenance = json.loads(DEFAULT_PROVENANCE.read_text(encoding="utf-8"))
    features = collection["features"]

    assert collection["name"] == "siraps_territorial_authoritative_v3"
    assert len(features) == len(TERRITORIAL_CATALOG) == 6
    assert [
        (
            feature["properties"]["source_code"],
            feature["properties"]["sirap_id"],
            feature["properties"]["sirap_name"],
        )
        for feature in features
    ] == [
        (source_code, sirap_id, sirap_name)
        for source_code, (sirap_id, sirap_name) in TERRITORIAL_CATALOG.items()
    ]
    assert all(
        feature["geometry"]["type"] in {"Polygon", "MultiPolygon"}
        and shape(feature["geometry"]).is_valid
        for feature in features
    )

    raw = DEFAULT_OUTPUT.read_bytes()
    sha256 = hashlib.sha256(raw).hexdigest()
    assert raw == serialize_json(collection)
    assert metadata["featureCount"] == 6
    assert metadata["crs"] == "EPSG:4326"
    assert metadata["metricCompatible"] is False
    assert metadata["pathname"].endswith(OUTPUT_FILENAME)
    assert metadata["sha256"] == sha256
    assert provenance["output"]["sha256"] == sha256
    assert provenance["validation"]["metric_compatible"] is False
