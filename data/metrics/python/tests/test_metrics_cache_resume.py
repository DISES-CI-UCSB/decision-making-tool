from __future__ import annotations

import hashlib
import json
from dataclasses import replace
from pathlib import Path

import main as pipeline
import pytest
from blob_manifest import ResolvedManifest
from local_io import CachedDownload, DownloadError
from metric_definitions import computable_metrics
from metrics_contract import (
    PROVENANCE_KEY,
    build_metrics_provenance,
    catalog_signature,
)
from solution_catalog import SolutionCatalog, SolutionCatalogEntry


def _solution(solution_id: str = "demo", *, domain: str = "land") -> dict:
    return {
        "id": solution_id,
        "domain": domain,
        "scope": domain,
        "displayUrl": f"https://example.test/{solution_id}.tif",
        "blobPath": f"solutions/{solution_id}.tif",
    }


def _manifest(solution: dict) -> ResolvedManifest:
    return ResolvedManifest(
        url="https://example.test/manifest.json",
        raw={},
        public_blob_host="https://example.test",
        layers_by_id={},
        national_solutions=[solution] if solution["domain"] == "land" else [],
        batch_solutions=[solution],
    )


def _write_cache(
    output_dir: Path,
    solution: dict,
    provenance: dict | None,
) -> None:
    cache_path = pipeline.cache_solution_path(output_dir, solution["id"])
    cache_path.parent.mkdir(parents=True)
    domain = solution["domain"]
    metrics = [
        {
            "metricId": definition.metric_id,
            "status": (
                "not_applicable"
                if (
                    domain not in definition.applicable_domains
                    or definition.kind == "aoi_percent"
                )
                else "ready"
            ),
            "unit": definition.unit,
            "labelKey": definition.label_key,
        }
        for definition in computable_metrics()
    ]
    document = {
        "solutionId": solution["id"],
        "generatedAt": "2026-07-23T00:00:00Z",
        "speciesCompleteness": {
            "expected": 1,
            "aligned": 1,
            "processed": 1,
            "missing": 0,
            "complete": True,
        },
        "geographies": {
            "national": {"colombia": {"metrics": metrics}},
            "departments": {"01": {"metrics": metrics}},
            "municipalities": {"001": {"metrics": metrics}},
            "siraps": {"sirap-1": {"metrics": metrics}},
            "runaps": {"runap-1": {"metrics": metrics}},
            "omecs": {"omec-1": {"metrics": metrics}},
        },
    }
    if provenance is not None:
        document[PROVENANCE_KEY] = provenance
    cache_path.write_text(json.dumps(document), encoding="utf-8")


def _resume(output_dir: Path, solution: dict):
    return pipeline._resume_entry_for_existing_cache(
        solution,
        _manifest(solution),
        output_dir,
        "metrics/cache",
    )


def _catalog(entries: list[SolutionCatalogEntry], tmp_path: Path) -> SolutionCatalog:
    return SolutionCatalog(
        catalog_version="0.1.0",
        release_id="test-release",
        expected_total_count=len(entries),
        expected_land_count=len(entries),
        expected_marine_count=0,
        solutions=tuple(entries),
        source_path=tmp_path / "catalog.json",
    )


def test_raster_preflight_reports_every_public_failure_and_ignores_local_fallback(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    local_raster = tmp_path / "staged.tif"
    local_raster.write_bytes(b"valid staged raster")
    solutions = [
        {
            **_solution(solution_id),
            "_localDisplayUrl": local_raster.resolve().as_uri(),
        }
        for solution_id in ("first", "second")
    ]
    requested_urls: list[str] = []

    def fail_download(url: str, *_args, **_kwargs):
        requested_urls.append(url)
        raise DownloadError("simulated 404")

    monkeypatch.setattr(pipeline, "cached_download", fail_download)

    downloads, failures = pipeline._preflight_solution_rasters(
        solutions,
        cache_dir=tmp_path / "cache",
        catalog=None,
    )

    assert downloads == {}
    assert requested_urls == [
        "https://example.test/first.tif",
        "https://example.test/second.tif",
    ]
    assert len(failures) == 2
    assert "first: unreachable raster source https://example.test/first.tif" in failures[0]
    assert "second: unreachable raster source https://example.test/second.tif" in failures[1]


def test_raster_preflight_accepts_file_source_with_matching_catalog_checksum(
    tmp_path: Path,
):
    raster = tmp_path / "staged.tif"
    raster.write_bytes(b"valid staged raster")
    sha256 = hashlib.sha256(raster.read_bytes()).hexdigest()
    solution = {
        **_solution(),
        "displayUrl": raster.resolve().as_uri(),
    }
    catalog = _catalog(
        [
            SolutionCatalogEntry(
                solution_id="demo",
                solution_basename="demo.tif",
                domain="land",
                raster_sha256=sha256,
            )
        ],
        tmp_path,
    )

    downloads, failures = pipeline._preflight_solution_rasters(
        [solution],
        cache_dir=tmp_path / "cache",
        catalog=catalog,
    )

    assert failures == []
    assert downloads["demo"].sha256 == sha256


def test_raster_preflight_rejects_catalog_checksum_mismatch(tmp_path: Path):
    raster = tmp_path / "staged.tif"
    raster.write_bytes(b"unexpected raster")
    solution = {
        **_solution(),
        "displayUrl": raster.resolve().as_uri(),
    }
    catalog = _catalog(
        [
            SolutionCatalogEntry(
                solution_id="demo",
                solution_basename="demo.tif",
                domain="land",
                raster_sha256="a" * 64,
            )
        ],
        tmp_path,
    )

    downloads, failures = pipeline._preflight_solution_rasters(
        [solution],
        cache_dir=tmp_path / "cache",
        catalog=catalog,
    )

    assert downloads == {}
    assert len(failures) == 1
    assert "demo: raster SHA-256 mismatch" in failures[0]
    assert f"expected {'a' * 64}" in failures[0]


def test_raster_preflight_accepts_immutable_public_source(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    cached_path = tmp_path / "downloaded.tif"
    cached_path.write_bytes(b"immutable raster")
    sha256 = hashlib.sha256(cached_path.read_bytes()).hexdigest()
    solution = _solution()
    catalog = _catalog(
        [
            SolutionCatalogEntry(
                solution_id="demo",
                solution_basename="demo.tif",
                domain="land",
                raster_sha256=sha256,
            )
        ],
        tmp_path,
    )

    monkeypatch.setattr(
        pipeline,
        "cached_download",
        lambda url, *_args, **_kwargs: CachedDownload(
            url=url,
            path=cached_path,
            sha256=sha256,
            bytes=cached_path.stat().st_size,
        ),
    )

    downloads, failures = pipeline._preflight_solution_rasters(
        [solution],
        cache_dir=tmp_path / "cache",
        catalog=catalog,
    )

    assert failures == []
    assert downloads["demo"].url == "https://example.test/demo.tif"


def test_main_stops_before_first_solution_when_raster_preflight_fails(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
):
    solutions = [_solution("first"), _solution("second")]
    manifest = ResolvedManifest(
        url="https://example.test/manifest.json",
        raw={},
        public_blob_host="https://example.test",
        layers_by_id={},
        national_solutions=solutions,
        batch_solutions=solutions,
    )

    monkeypatch.setattr(pipeline, "fetch_manifest", lambda _url: manifest)
    monkeypatch.setattr(
        pipeline,
        "cached_download",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            DownloadError("simulated 404")
        ),
    )
    monkeypatch.setattr(
        pipeline,
        "_process_solution",
        lambda **_kwargs: pytest.fail("solution processing started"),
    )
    output_dir = tmp_path / "output"

    result = pipeline.main(
        [
            "--manifest-url",
            manifest.url,
            "--output-dir",
            str(output_dir),
            "--cache-dir",
            str(tmp_path / "cache"),
            "--national-only",
            "--skip-species",
        ]
    )

    captured = capsys.readouterr()
    assert result == 2
    assert "no solutions were processed" in captured.err
    assert "first: unreachable raster source https://example.test/first.tif" in captured.err
    assert "second: unreachable raster source https://example.test/second.tif" in captured.err
    assert "[tier1-metrics] [1/2]" not in captured.out
    assert not output_dir.exists()


def test_local_preflight_metadata_preserves_canonical_signature_urls(
    tmp_path: Path,
):
    summary = tmp_path / "demo_summary.csv"
    summary.write_text("scenario,evaluated\ndemo,prioritizr_model\n", encoding="utf-8")
    solution = {
        **_solution(),
        "metadataUrl": "https://blob.example/solutions/demo_summary.csv",
        "_localMetadataUrl": summary.resolve().as_uri(),
    }

    identity = pipeline._solution_source_identity(
        solution,
        cache_dir=tmp_path / "cache",
        force_download=False,
        raster_sha256="a" * 64,
        species_csv_url="https://blob.example/species.csv",
        species_csv_sha256="b" * 64,
    )

    assert identity["solutionMetadata"]["url"] == solution["metadataUrl"]
    assert (
        identity["solutionMetadata"]["summaryCsvUrl"]
        == solution["metadataUrl"]
    )
    assert solution["_resolvedSummaryCsvUrl"] == summary.resolve().as_uri()


def test_resume_accepts_matching_catalog_signature(tmp_path: Path):
    solution = _solution()
    _write_cache(
        tmp_path,
        solution,
        build_metrics_provenance(
            "land",
            species_csv_url=pipeline.SPECIES_CSV_URL,
        ),
    )

    entry = _resume(tmp_path, solution)

    assert entry is not None
    assert entry["resumeSkipped"] is True
    assert entry["solutionDomain"] == "land"


def test_catalog_signature_is_deterministic_and_order_sensitive():
    provenance = build_metrics_provenance("land", species_csv_url="source.csv")
    config = provenance["generationConfig"]
    reordered_config = dict(reversed(list(config.items())))

    assert catalog_signature("land", config) == catalog_signature(
        "land",
        reordered_config,
    )
    assert catalog_signature(
        "land",
        config,
        catalog=reversed(computable_metrics()),
    ) != catalog_signature("land", config)


def test_resume_rejects_legacy_cache_without_signature(tmp_path: Path):
    solution = _solution()
    _write_cache(tmp_path, solution, None)

    assert _resume(tmp_path, solution) is None


def test_resume_rejects_applicability_catalog_change(tmp_path: Path):
    solution = _solution()
    provenance = build_metrics_provenance(
        "land",
        species_csv_url=pipeline.SPECIES_CSV_URL,
    )
    definitions = list(computable_metrics())
    definitions[0] = replace(
        definitions[0],
        applicable_domains=frozenset({"marine"}),
    )
    provenance["catalogSignature"] = catalog_signature(
        "land",
        provenance["generationConfig"],
        catalog=definitions,
    )
    _write_cache(tmp_path, solution, provenance)

    assert _resume(tmp_path, solution) is None


def test_resume_rejects_generation_config_change(tmp_path: Path):
    solution = _solution()
    _write_cache(
        tmp_path,
        solution,
        build_metrics_provenance(
            "land",
            national_only=True,
            species_csv_url=pipeline.SPECIES_CSV_URL,
        ),
    )

    assert _resume(tmp_path, solution) is None


def test_resume_rejects_land_cache_for_marine_solution(tmp_path: Path):
    solution = _solution(domain="marine")
    _write_cache(
        tmp_path,
        solution,
        build_metrics_provenance(
            "land",
            species_csv_url=pipeline.SPECIES_CSV_URL,
        ),
    )

    assert _resume(tmp_path, solution) is None


def test_resume_requires_matching_basename_and_raster_checksum(tmp_path: Path):
    solution = _solution()
    _write_cache(
        tmp_path,
        solution,
        build_metrics_provenance(
            "land",
            species_csv_url=pipeline.SPECIES_CSV_URL,
        ),
    )
    cache_path = pipeline.cache_solution_path(tmp_path, solution["id"])
    document = json.loads(cache_path.read_text())
    document["solutionRaster"] = {
        "solutionBasename": "demo.tif",
        "sha256": "a" * 64,
    }
    cache_path.write_text(json.dumps(document))

    matching = pipeline._resume_entry_for_existing_cache(
        solution,
        _manifest(solution),
        tmp_path,
        "metrics/cache",
        expected_solution_basename="demo.tif",
        expected_raster_sha256="a" * 64,
    )
    stale = pipeline._resume_entry_for_existing_cache(
        solution,
        _manifest(solution),
        tmp_path,
        "metrics/cache",
        expected_solution_basename="demo.tif",
        expected_raster_sha256="b" * 64,
    )

    assert matching is not None
    assert stale is None


def test_resume_rejects_cache_from_previous_release(tmp_path: Path):
    solution = _solution()
    _write_cache(
        tmp_path,
        solution,
        build_metrics_provenance(
            "land",
            species_csv_url=pipeline.SPECIES_CSV_URL,
            release_id="release-one",
        ),
    )
    cache_path = pipeline.cache_solution_path(tmp_path, solution["id"])
    document = json.loads(cache_path.read_text())
    document["solutionRaster"] = {
        "solutionBasename": "demo.tif",
        "sha256": "a" * 64,
    }
    cache_path.write_text(json.dumps(document))

    entry = pipeline._resume_entry_for_existing_cache(
        solution,
        _manifest(solution),
        tmp_path,
        "metrics/cache",
        release_id="release-two",
        expected_solution_basename="demo.tif",
        expected_raster_sha256="a" * 64,
    )

    assert entry is None


def test_resume_rejects_valid_json_with_incomplete_geography_coverage(tmp_path: Path):
    solution = _solution()
    _write_cache(
        tmp_path,
        solution,
        build_metrics_provenance(
            "land",
            species_csv_url=pipeline.SPECIES_CSV_URL,
        ),
    )
    cache_path = pipeline.cache_solution_path(tmp_path, solution["id"])
    document = json.loads(cache_path.read_text())
    del document["geographies"]["municipalities"]
    cache_path.write_text(json.dumps(document))

    assert _resume(tmp_path, solution) is None


def test_resume_rejects_blocked_required_layer_metric(tmp_path: Path):
    solution = _solution()
    _write_cache(
        tmp_path,
        solution,
        build_metrics_provenance(
            "land",
            species_csv_url=pipeline.SPECIES_CSV_URL,
        ),
    )
    cache_path = pipeline.cache_solution_path(tmp_path, solution["id"])
    document = json.loads(cache_path.read_text())
    metric = next(
        metric
        for metric in document["geographies"]["national"]["colombia"]["metrics"]
        if metric["metricId"] == "ecosystem_coverage"
    )
    metric["status"] = "blocked"
    cache_path.write_text(json.dumps(document))

    assert _resume(tmp_path, solution) is None


def test_resume_rejects_incomplete_species_counts(tmp_path: Path):
    solution = _solution()
    _write_cache(
        tmp_path,
        solution,
        build_metrics_provenance(
            "land",
            species_csv_url=pipeline.SPECIES_CSV_URL,
        ),
    )
    cache_path = pipeline.cache_solution_path(tmp_path, solution["id"])
    document = json.loads(cache_path.read_text())
    document["speciesCompleteness"]["aligned"] = 0
    document["speciesCompleteness"]["complete"] = False
    cache_path.write_text(json.dumps(document))

    assert _resume(tmp_path, solution) is None
