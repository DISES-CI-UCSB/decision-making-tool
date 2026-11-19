import hashlib
import json

import pytest

from build_metric_authoritative import (
    DEFAULT_METADATA,
    DEFAULT_OUTPUT,
    DEFAULT_PROVENANCE,
    DEFAULT_TERRITORIAL,
    DEFAULT_THEMATIC_SOURCE,
    DEPRECATED_TERRITORIAL_IDS,
    EXPECTED_IDS,
    OUTPUT_PATHNAME,
    OUTPUT_SHA256,
    SirapMetricBuildError,
    build_collection,
    build_documents,
    canonical_sha256,
    serialize_json,
)


def test_authoritative_metric_release_is_reproducible_and_exact():
    output_bytes, metadata, provenance = build_documents(
        territorial_path=DEFAULT_TERRITORIAL,
        thematic_path=DEFAULT_THEMATIC_SOURCE,
    )
    collection = json.loads(output_bytes)
    features = collection["features"]
    ids = {feature["properties"]["sirap_id"] for feature in features}
    kinds = {
        feature["properties"]["sirap_id"]: feature["properties"]["sirap_kind"]
        for feature in features
    }

    assert output_bytes == DEFAULT_OUTPUT.read_bytes()
    assert serialize_json(metadata) == DEFAULT_METADATA.read_bytes()
    assert serialize_json(provenance) == DEFAULT_PROVENANCE.read_bytes()
    assert len(features) == 8
    assert ids == EXPECTED_IDS
    assert ids.isdisjoint(DEPRECATED_TERRITORIAL_IDS)
    assert list(kinds.values()).count("territorial") == 6
    assert list(kinds.values()).count("thematic") == 2
    assert metadata["metricCompatible"] is True
    assert metadata["kindField"] == "sirap_kind"
    assert metadata["sha256"] == hashlib.sha256(output_bytes).hexdigest() == OUTPUT_SHA256
    assert metadata["pathname"] == OUTPUT_PATHNAME
    assert f"/v3/sha256-{OUTPUT_SHA256}/" in metadata["url"]
    assert metadata["catalogSha256"] == canonical_sha256(
        sorted(provenance["validation"]["catalog"])
    )


def test_combined_build_rejects_deprecated_territorial_feature():
    territorial = json.loads(DEFAULT_TERRITORIAL.read_text(encoding="utf-8"))
    thematic = json.loads(DEFAULT_THEMATIC_SOURCE.read_text(encoding="utf-8"))
    replacement = next(
        feature
        for feature in thematic["features"]
        if feature["properties"]["sirap_id"]
        == "territorial_territorial_caribe_9"
    )
    territorial["features"][-1] = replacement

    with pytest.raises(
        SirapMetricBuildError,
        match="exactly the six authoritative IDs",
    ):
        build_collection(territorial, thematic)
