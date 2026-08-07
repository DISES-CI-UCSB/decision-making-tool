from __future__ import annotations

import io
import json
import urllib.error

import pytest
import verify_artifacts

from compact_metrics import to_compact_document
from metrics_contract import PROVENANCE_KEY, build_metrics_provenance, provenance_issues
from release_config import load_release_config
from verify_artifacts import _cache_max_age_seconds, verify_report


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

    assert result["ok"] is False
    assert result["entries"][0]["format"] == "metrics-verbose-v1"
    assert result["entries"][0]["contractIssues"]


def test_remote_verification_accepts_vercel_blob_cache_duration():
    assert _cache_max_age_seconds("public, max-age=2592000") == 2_592_000
    assert _cache_max_age_seconds("public, max-age=31536000, immutable") == 31_536_000
    assert _cache_max_age_seconds("public, max-age=3600") == 3_600
    assert _cache_max_age_seconds("public") is None
    assert _cache_max_age_seconds("public, max-age=invalid") is None


def test_remote_verification_fetch_retries_transient_failure(monkeypatch):
    class Response:
        headers = {"content-type": "application/json"}

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def read(self):
            return io.BytesIO(b"verified").read()

    outcomes = iter(
        [
            urllib.error.URLError(ConnectionResetError("connection reset")),
            Response(),
        ]
    )
    sleeps = []

    def urlopen(*_args, **_kwargs):
        outcome = next(outcomes)
        if isinstance(outcome, BaseException):
            raise outcome
        return outcome

    monkeypatch.setattr(verify_artifacts.urllib.request, "urlopen", urlopen)

    payload, headers = verify_artifacts._fetch(
        "https://example.test/artifact",
        retry_base_seconds=0.25,
        sleep=sleeps.append,
    )

    assert payload == b"verified"
    assert headers == {"content-type": "application/json"}
    assert sleeps == [0.25]


def test_remote_verification_rejects_legacy_goals_path(tmp_path):
    artifact = tmp_path / "demo.goals.json"
    artifact.write_text('{"solutionId":"demo"}\n', encoding="utf-8")
    report = tmp_path / "goals-publish-report.json"
    report.write_text(
        json.dumps(
            {
                "entries": [
                    {
                        "solutionId": "demo",
                        "goalsPath": str(artifact),
                        "expectedPublicUrl": "https://example.test/demo.goals.json",
                    }
                ]
            }
        ),
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match="canonical cachePath"):
        verify_report(report, repo_root=tmp_path)
