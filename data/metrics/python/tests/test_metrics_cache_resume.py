from __future__ import annotations

import hashlib
import json
from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace

import main as pipeline
import pytest
from blob_manifest import ResolvedManifest
from helpers import TEST_RASTER_SHA256, scope_state
from local_io import CachedDownload, DownloadError
from metric_definitions import computable_metrics
from metrics_contract import (
    PROVENANCE_KEY,
    build_metrics_provenance,
    catalog_signature,
)
from raster_metrics import RasterFingerprint
from solution_catalog import SolutionCatalog, SolutionCatalogEntry
from solution_input_signature import build_solution_input_signature


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
    def metrics_for(level: str) -> list[dict]:
        metrics = []
        for definition in computable_metrics():
            status = (
                "not_applicable"
                if (
                    domain not in definition.applicable_domains
                    or (
                        level == "national"
                        and definition.kind == "aoi_percent"
                    )
                    or (
                        level != "national"
                        and definition.kind
                        in {"metadata_summary", "metadata_coverage"}
                    )
                )
                else "ready"
            )
            metrics.append({
                "metricId": definition.metric_id,
                "value": None if status == "not_applicable" else 1.0,
                "status": status,
                "unit": definition.unit,
                "source": "n/a" if status == "not_applicable" else "test",
                "notes": None,
                "labelKey": definition.label_key,
                "formatHint": definition.format_hint,
            })
        return metrics
    levels = {
        "national": "colombia",
        "departments": "01",
        "municipalities": "001",
        "siraps": "sirap-1",
        "runaps": "runap-1",
        "omecs": "omec-1",
    }
    document = {
        "solutionId": solution["id"],
        "generatedAt": "2026-07-23T00:00:00Z",
        "solutionRaster": {
            "solutionBasename": f"{solution['id']}.tif",
            "sha256": TEST_RASTER_SHA256,
        },
        "speciesCompleteness": {
            "expected": 1,
            "aligned": 1,
            "processed": 1,
            "missing": 0,
            "complete": True,
        },
        "geographies": {
            level: {
                scope_id: {
                    "scopeState": scope_state(level, scope_id),
                    "metrics": metrics_for(level),
                }
            }
            for level, scope_id in levels.items()
        },
    }
    if provenance is not None:
        document[PROVENANCE_KEY] = provenance
    cache_path.write_text(json.dumps(document), encoding="utf-8")


def _resume(
    output_dir: Path,
    solution: dict,
    *,
    boundary_fanout_mode: str = "legacy",
    weighted_boundary_fanout_mode: str = "scalar",
):
    return pipeline._resume_entry_for_existing_cache(
        solution,
        _manifest(solution),
        output_dir,
        "metrics/cache",
        boundary_fanout_mode=boundary_fanout_mode,
        weighted_boundary_fanout_mode=weighted_boundary_fanout_mode,
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


def _fingerprint(width: int, height: int) -> RasterFingerprint:
    return RasterFingerprint(
        width=width,
        height=height,
        transform=(1000.0, 0.0, 0.0, 0.0, -1000.0, float(height * 1000)),
        crs="EPSG:9377",
    )


def _run_alignment_preflight(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    solutions: list[dict],
    fingerprints: dict[str, RasterFingerprint],
):
    downloads = {}
    for solution in solutions:
        solution_id = solution["id"]
        path = tmp_path / f"{solution_id}.tif"
        path.write_bytes(solution_id.encode("utf-8"))
        downloads[solution_id] = CachedDownload(
            url=path.resolve().as_uri(),
            path=path,
            sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
            bytes=path.stat().st_size,
        )
    monkeypatch.setattr(
        pipeline,
        "read_solution_raster",
        lambda path: SimpleNamespace(fingerprint=fingerprints[path.stem]),
    )
    monkeypatch.setattr(pipeline, "computable_metrics", lambda: ())
    manifest = ResolvedManifest(
        url="https://example.test/manifest.json",
        raw={},
        public_blob_host="https://example.test",
        layers_by_id={},
        national_solutions=[
            solution for solution in solutions if solution["domain"] == "land"
        ],
        batch_solutions=solutions,
    )
    return pipeline._preflight_aligned_inputs(
        solutions,
        downloads,
        manifest,
        cache_dir=tmp_path / "cache",
        force_download=False,
        species_records=None,
        skip_species=True,
    )


def test_alignment_preflight_accepts_distinct_valid_land_and_marine_grids(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    solutions = [
        _solution("land-a", domain="land"),
        _solution("marine-a", domain="marine"),
        _solution("land-b", domain="land"),
        _solution("marine-b", domain="marine"),
    ]
    land = _fingerprint(1353, 1838)
    marine = _fingerprint(1833, 1639)

    cache, inventory, failures = _run_alignment_preflight(
        tmp_path,
        monkeypatch,
        solutions,
        {
            "land-a": land,
            "land-b": land,
            "marine-a": marine,
            "marine-b": marine,
        },
    )

    assert cache is not None
    assert failures == []
    assert inventory["format"] == "metrics-alignment-inventory-v4"
    assert inventory["domains"]["land"]["targetGridSha256"] != (
        inventory["domains"]["marine"]["targetGridSha256"]
    )
    assert inventory["domains"]["land"]["solutionCount"] == 2
    assert inventory["domains"]["marine"]["solutionCount"] == 2


@pytest.mark.parametrize("mismatch_domain", ["land", "marine"])
def test_alignment_preflight_rejects_mismatch_within_domain(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    mismatch_domain: str,
):
    other_domain = "marine" if mismatch_domain == "land" else "land"
    solutions = [
        _solution(f"{mismatch_domain}-reference", domain=mismatch_domain),
        _solution(f"{other_domain}-valid", domain=other_domain),
        _solution(f"{mismatch_domain}-mismatch", domain=mismatch_domain),
    ]

    cache, inventory, failures = _run_alignment_preflight(
        tmp_path,
        monkeypatch,
        solutions,
        {
            f"{mismatch_domain}-reference": _fingerprint(10, 20),
            f"{other_domain}-valid": _fingerprint(30, 40),
            f"{mismatch_domain}-mismatch": _fingerprint(11, 20),
        },
    )

    assert cache is None
    assert inventory is None
    assert len(failures) == 1
    assert f"domain={mismatch_domain}" in failures[0]
    assert f"solution='{mismatch_domain}-mismatch'" in failures[0]
    assert "11x20" in failures[0]


def test_chunked_solutions_select_only_their_domain_grid_provenance(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    solutions = [
        _solution("land-a", domain="land"),
        _solution("marine-a", domain="marine"),
        _solution("land-b", domain="land"),
        _solution("marine-b", domain="marine"),
    ]
    _, inventory, failures = _run_alignment_preflight(
        tmp_path,
        monkeypatch,
        solutions,
        {
            "land-a": _fingerprint(10, 20),
            "land-b": _fingerprint(10, 20),
            "marine-a": _fingerprint(30, 40),
            "marine-b": _fingerprint(30, 40),
        },
    )

    assert failures == []
    first_chunk = pipeline._chunk_solutions(
        solutions,
        chunk_index=0,
        chunk_count=2,
    )
    second_chunk = pipeline._chunk_solutions(
        solutions,
        chunk_index=1,
        chunk_count=2,
    )
    assert [solution["id"] for solution in first_chunk] == ["land-a", "land-b"]
    assert [solution["id"] for solution in second_chunk] == [
        "marine-a",
        "marine-b",
    ]
    for solution in first_chunk + second_chunk:
        provenance = pipeline._alignment_provenance_for_solution(
            inventory,
            solution,
        )
        assert provenance["domain"] == solution["domain"]
        assert provenance is inventory["domains"][solution["domain"]]


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
    assert entry["boundaryFanout"] == pipeline.boundary_fanout_identity("legacy")


def test_resume_never_reuses_cache_across_boundary_fanout_modes(tmp_path: Path):
    solution = _solution()
    _write_cache(
        tmp_path,
        solution,
        build_metrics_provenance(
            "land",
            species_csv_url=pipeline.SPECIES_CSV_URL,
            boundary_fanout_mode="legacy",
        ),
    )

    assert _resume(tmp_path, solution, boundary_fanout_mode="legacy") is not None
    assert _resume(tmp_path, solution, boundary_fanout_mode="grouped") is None


@pytest.mark.parametrize(
    ("cached_mode", "requested_mode"),
    [
        ("scalar", "grouped-weighted-v1"),
        ("grouped-weighted-v1", "scalar"),
    ],
)
def test_resume_rejects_cache_across_weighted_orchestration_modes(
    tmp_path: Path,
    cached_mode: str,
    requested_mode: str,
):
    solution = _solution()
    _write_cache(
        tmp_path,
        solution,
        build_metrics_provenance(
            "land",
            species_csv_url=pipeline.SPECIES_CSV_URL,
            boundary_fanout_mode="grouped",
            weighted_execution_mode=cached_mode,
        ),
    )

    assert (
        _resume(
            tmp_path,
            solution,
            boundary_fanout_mode="grouped",
            weighted_boundary_fanout_mode=cached_mode,
        )
        is not None
    )
    assert (
        _resume(
            tmp_path,
            solution,
            boundary_fanout_mode="grouped",
            weighted_boundary_fanout_mode=requested_mode,
        )
        is None
    )


def test_grouped_resume_fails_closed_without_fanout_identity(tmp_path: Path):
    solution = _solution()
    provenance = build_metrics_provenance(
        "land",
        species_csv_url=pipeline.SPECIES_CSV_URL,
        boundary_fanout_mode="grouped",
    )
    del provenance["generationConfig"]["boundaryFanout"]
    provenance["catalogSignature"] = catalog_signature(
        "land",
        provenance["generationConfig"],
    )
    _write_cache(tmp_path, solution, provenance)

    assert _resume(tmp_path, solution, boundary_fanout_mode="grouped") is None


def test_legacy_resume_accepts_pre_identity_provenance(tmp_path: Path):
    solution = _solution()
    provenance = build_metrics_provenance(
        "land",
        species_csv_url=pipeline.SPECIES_CSV_URL,
        boundary_fanout_mode="legacy",
    )
    del provenance["generationConfig"]["boundaryFanout"]
    _write_cache(tmp_path, solution, provenance)

    assert _resume(tmp_path, solution, boundary_fanout_mode="legacy") is not None
    assert _resume(tmp_path, solution, boundary_fanout_mode="grouped") is None


def test_resume_rejects_stale_boundary_fanout_algorithm_version(tmp_path: Path):
    solution = _solution()
    provenance = build_metrics_provenance(
        "land",
        species_csv_url=pipeline.SPECIES_CSV_URL,
        boundary_fanout_mode="grouped",
    )
    provenance["generationConfig"]["boundaryFanout"]["algorithmVersion"] = (
        "boundary-fanout-exclusive-csr-four-channel-v0"
    )
    provenance["catalogSignature"] = catalog_signature(
        "land",
        provenance["generationConfig"],
    )
    _write_cache(tmp_path, solution, provenance)

    assert _resume(tmp_path, solution, boundary_fanout_mode="grouped") is None


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


def test_boundary_fanout_identity_changes_catalog_and_solution_input_signatures():
    solution = _solution()
    entry = SolutionCatalogEntry(
        solution_id=solution["id"],
        solution_basename="demo.tif",
        domain="land",
        raster_sha256="a" * 64,
    )
    provenances = {
        mode: build_metrics_provenance(
            "land",
            species_csv_url=pipeline.SPECIES_CSV_URL,
            boundary_fanout_mode=mode,
        )
        for mode in ("legacy", "grouped")
    }
    signatures = {
        mode: build_solution_input_signature(
            solution=solution,
            catalog_entry=entry,
            manifest=_manifest(solution),
            metrics_provenance=provenance,
            source_identity={"solutionRaster": {"sha256": "a" * 64}},
        )
        for mode, provenance in provenances.items()
    }

    assert provenances["legacy"]["catalogSignature"] != (
        provenances["grouped"]["catalogSignature"]
    )
    assert signatures["legacy"]["sha256"] != signatures["grouped"]["sha256"]
    legacy_without_identity = json.loads(json.dumps(provenances["legacy"]))
    del legacy_without_identity["generationConfig"]["boundaryFanout"]
    assert catalog_signature(
        "land",
        legacy_without_identity["generationConfig"],
    ) == provenances["legacy"]["catalogSignature"]
    assert build_solution_input_signature(
        solution=solution,
        catalog_entry=entry,
        manifest=_manifest(solution),
        metrics_provenance=legacy_without_identity,
        source_identity={"solutionRaster": {"sha256": "a" * 64}},
    ) == signatures["legacy"]


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
