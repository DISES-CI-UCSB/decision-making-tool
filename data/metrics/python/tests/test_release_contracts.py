from __future__ import annotations

import json

import pytest

from compact_metrics import to_compact_document
from metrics_contract import PROVENANCE_KEY, build_metrics_provenance, provenance_issues
from release_config import load_release_config
from verify_artifacts import verify_report


def test_release_prefixes_are_immutable_and_overridable():
    default = load_release_config()
    custom = load_release_config("future-release-1")

    assert default.release_id == "sirap-polygon-v2-20260727"
    assert default.regular_verbose_directory.endswith("/regular/verbose")
    assert default.regular_compact_directory.endswith("/regular/compact")
    assert default.mec_v2_directory.endswith("/mec/v2")
    assert custom.regular_verbose_directory.startswith("releases/future-release-1/")


def test_missing_release_contract_raises_file_not_found(tmp_path):
    shallow_module_path = tmp_path / "metrics_pipeline" / "release_config.py"

    with pytest.raises(FileNotFoundError, match="release-contract.json"):
        load_release_config(search_start=shallow_module_path)


def test_boundary_provenance_requires_exact_catalogs_and_compact_binding():
    provenance = build_metrics_provenance("land")
    document = {
        "solutionId": "demo",
        "generatedAt": "2026-07-27T00:00:00Z",
        PROVENANCE_KEY: provenance,
        "geographies": {},
    }
    compact = to_compact_document(document)

    assert provenance_issues(document) == []
    assert len(compact["metricsProvenanceSha256"]) == 64

    provenance["boundaryProvenance"]["sources"]["municipalities"]["featureCount"] = 1104
    assert any("municipalities boundary count mismatch" in issue for issue in provenance_issues(document))


def test_remote_verification_compares_hash_size_headers_and_format(tmp_path):
    artifact = tmp_path / "demo.metrics.json"
    artifact.write_text('{"solutionId":"demo"}\n', encoding="utf-8")
    report = tmp_path / "publish-report.json"
    report.write_text(
        json.dumps(
            {
                "entries": [
                    {
                        "solutionId": "demo",
                        "cachePath": str(artifact),
                        "expectedPublicUrl": "https://example.test/demo.metrics.json",
                    }
                ]
            }
        ),
        encoding="utf-8",
    )
    payload = artifact.read_bytes()

    result = verify_report(
        report,
        repo_root=tmp_path,
        fetch=lambda _url: (
            payload,
            {
                "content-type": "application/json",
                "cache-control": "public, max-age=31536000, immutable",
            },
        ),
    )

    assert result["ok"] is True
    assert result["entries"][0]["format"] == "metrics-verbose-v1"
