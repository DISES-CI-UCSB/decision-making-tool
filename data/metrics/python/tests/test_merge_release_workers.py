from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest

from merge_release_workers import merge_workers
from plan_solution_release import build_release_plan
from solution_catalog import (
    SolutionCatalogError,
    catalog_binding,
    load_solution_catalog,
)


@pytest.fixture(autouse=True)
def _run_from_fixture_repo_root(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.chdir(tmp_path)


def _release_contracts(tmp_path: Path) -> tuple[Path, Path, object]:
    catalog_path = tmp_path / "catalog.json"
    catalog_path.write_text(
        json.dumps(
            {
                "format": "solution-catalog-v1",
                "catalogVersion": "0.2.0",
                "releaseId": "release-two",
                "expectedSolutionCount": 2,
                "expectedLandSolutionCount": 2,
                "expectedMarineSolutionCount": 0,
                "solutions": [
                    {
                        "solutionId": solution_id,
                        "solutionBasename": f"{solution_id}.tif",
                        "domain": "land",
                        "rasterSha256": str(index + 1) * 64,
                    }
                    for index, solution_id in enumerate(("solution-a", "solution-b"))
                ],
            }
        ),
        encoding="utf-8",
    )
    catalog = load_solution_catalog(catalog_path)
    plan_path = tmp_path / "release-plan.json"
    plan_path.write_text(json.dumps(build_release_plan(catalog)), encoding="utf-8")
    return catalog_path, plan_path, catalog


def _worker(
    tmp_path: Path,
    *,
    catalog,
    plan_path: Path,
    index: int,
    count: int,
    solution_id: str,
) -> Path:
    worker = Path("workers") / f"worker-{index}"
    cache = worker / "cache"
    cache.mkdir(parents=True)
    artifact = cache / f"{solution_id}.metrics.json"
    artifact.write_text(
        json.dumps(
            {
                "solutionId": solution_id,
                "solutionCatalogBinding": catalog_binding(catalog),
            }
        ),
        encoding="utf-8",
    )
    report = {
        "manifestUrl": "file:///manifest.json",
        "manifestGeneratedAt": "2026-08-05T00:00:00Z",
        "publicBlobHost": "https://example.test",
        "cacheDir": "/shared/cache",
        "cacheBlobDirectory": "releases/release-two/regular/verbose",
        "metricsSchemaVersion": "3",
        "metricCatalog": ["metric"],
        "deferredMetricIds": [],
        "speciesMetricIds": [],
        "speciesPoolSizes": {},
        "speciesSkipped": False,
        "speciesBoundaryLevelsSkipped": [],
        "cachePolicy": "use-cache",
        "inputAlignment": {"sha256": "a" * 64},
        "solutionCatalog": {
            "format": "solution-catalog-v1",
            "catalogVersion": catalog.catalog_version,
            "releaseId": catalog.release_id,
            "sha256": catalog.sha256,
            "expectedCounts": {"total": 2, "land": 2, "marine": 0},
        },
        "releasePlan": {
            "format": "solution-release-plan-binding-v1",
            "releaseId": catalog.release_id,
            "catalogSha256": catalog.sha256,
            "sha256": hashlib.sha256(plan_path.read_bytes()).hexdigest(),
            "recomputeCount": len(catalog.solutions),
        },
        "chunk": {
            "index": index,
            "count": count,
            "selectedBeforeChunk": 2,
            "selectedForChunk": 1,
        },
        "entries": [{"solutionId": solution_id, "cachePath": str(artifact)}],
        "failures": [],
    }
    (worker / "publish-report.json").write_text(
        json.dumps(report),
        encoding="utf-8",
    )
    return worker


def test_merge_workers_requires_and_builds_exact_disjoint_union(tmp_path: Path):
    catalog_path, plan_path, catalog = _release_contracts(tmp_path)
    workers = [
        _worker(
            tmp_path,
            catalog=catalog,
            plan_path=plan_path,
            index=index,
            count=2,
            solution_id=solution_id,
        )
        for index, solution_id in enumerate(("solution-a", "solution-b"))
    ]

    merged = merge_workers(
        catalog_path=catalog_path,
        release_plan_path=plan_path,
        worker_output_dirs=workers,
        output_dir=tmp_path / "merged",
    )

    assert [entry["solutionId"] for entry in merged["entries"]] == [
        "solution-a",
        "solution-b",
    ]
    assert all(len(entry["artifactSha256"]) == 64 for entry in merged["entries"])


def test_merge_workers_rejects_missing_partition(tmp_path: Path):
    catalog_path, plan_path, catalog = _release_contracts(tmp_path)
    worker = _worker(
        tmp_path,
        catalog=catalog,
        plan_path=plan_path,
        index=0,
        count=2,
        solution_id="solution-a",
    )

    with pytest.raises(SolutionCatalogError, match="complete disjoint set"):
        merge_workers(
            catalog_path=catalog_path,
            release_plan_path=plan_path,
            worker_output_dirs=[worker],
            output_dir=tmp_path / "merged",
        )


def test_merge_workers_rejects_duplicate_solution(tmp_path: Path):
    catalog_path, plan_path, catalog = _release_contracts(tmp_path)
    workers = [
        _worker(
            tmp_path,
            catalog=catalog,
            plan_path=plan_path,
            index=index,
            count=2,
            solution_id="solution-a",
        )
        for index in range(2)
    ]

    with pytest.raises(SolutionCatalogError, match="overlap"):
        merge_workers(
            catalog_path=catalog_path,
            release_plan_path=plan_path,
            worker_output_dirs=workers,
            output_dir=tmp_path / "merged",
        )


def _mixed_release_contracts(tmp_path: Path) -> tuple[Path, Path, object]:
    catalog_path = tmp_path / "mixed-catalog.json"
    solutions = [
        {
            "solutionId": solution_id,
            "solutionBasename": f"{solution_id}.tif",
            "domain": domain,
            "rasterSha256": str(index + 1) * 64,
        }
        for index, (solution_id, domain) in enumerate(
            (
                ("land-a", "land"),
                ("land-b", "land"),
                ("marine-a", "marine"),
                ("marine-b", "marine"),
            )
        )
    ]
    catalog_path.write_text(
        json.dumps(
            {
                "format": "solution-catalog-v1",
                "catalogVersion": "0.2.0",
                "releaseId": "mixed-release",
                "expectedSolutionCount": 4,
                "expectedLandSolutionCount": 2,
                "expectedMarineSolutionCount": 2,
                "solutions": solutions,
            }
        ),
        encoding="utf-8",
    )
    catalog = load_solution_catalog(catalog_path)
    plan_path = tmp_path / "mixed-plan.json"
    plan_path.write_text(json.dumps(build_release_plan(catalog)), encoding="utf-8")
    return catalog_path, plan_path, catalog


def _domain_worker(
    tmp_path: Path,
    *,
    catalog,
    plan_path: Path,
    domain: str,
    index: int,
    count: int,
    solution_ids: list[str],
    alignment_marker: str | None = None,
    species_pool_sizes: dict | None = None,
) -> Path:
    worker = (
        Path("data/metrics/generated/releases/mixed-release/workers")
        / f"{domain}-worker-{index}-{len(list(tmp_path.iterdir()))}"
    )
    cache = worker / "cache"
    cache.mkdir(parents=True)
    entries = []
    for solution_id in solution_ids:
        artifact = cache / f"{solution_id}.metrics.json"
        artifact.write_text(
            json.dumps(
                {
                    "solutionId": solution_id,
                    "solutionCatalogBinding": catalog_binding(catalog),
                }
            ),
            encoding="utf-8",
        )
        entries.append({"solutionId": solution_id, "cachePath": str(artifact)})
    domain_inventory = {
        "format": "metrics-domain-alignment-inventory-v1",
        "domain": domain,
        "estimatedReleaseBytes": 10 if domain == "land" else 20,
        "marker": alignment_marker or f"{domain}-alignment",
    }
    report = {
        "manifestUrl": "file:///manifest.json",
        "manifestGeneratedAt": "2026-08-05T00:00:00Z",
        "publicBlobHost": "https://example.test",
        "cacheDir": "/shared/cache",
        "cacheBlobDirectory": "releases/mixed-release/regular/verbose",
        "metricsSchemaVersion": "3",
        "metricCatalog": ["metric"],
        "deferredMetricIds": [],
        "speciesMetricIds": [],
        "speciesPoolSizes": species_pool_sizes,
        "speciesSkipped": False,
        "speciesBoundaryLevelsSkipped": [],
        "cachePolicy": "recompute-all",
        "inputAlignment": {
            "format": "metrics-alignment-inventory-v4",
            "domains": {domain: domain_inventory},
            "cacheStorage": {
                "completePairBytes": 30,
                "configuredMaxBytes": 100,
                "estimatedReleaseBytes": domain_inventory["estimatedReleaseBytes"],
            },
            "sha256": "a" * 64,
        },
        "solutionCatalog": {
            "format": "solution-catalog-v1",
            "catalogVersion": catalog.catalog_version,
            "releaseId": catalog.release_id,
            "sha256": catalog.sha256,
            "expectedCounts": {"total": 4, "land": 2, "marine": 2},
        },
        "releasePlan": {
            "format": "solution-release-plan-binding-v1",
            "releaseId": catalog.release_id,
            "catalogSha256": catalog.sha256,
            "sha256": hashlib.sha256(plan_path.read_bytes()).hexdigest(),
            "recomputeCount": 4,
        },
        "domainSelection": {
            "domain": domain,
            "catalogDomainCount": 2,
            "selectedRecomputeCount": 2,
        },
        "chunk": {
            "index": index,
            "count": count,
            "scope": "domain",
            "domain": domain,
            "selectedBeforeChunk": 2,
            "selectedForChunk": len(entries),
        },
        "entries": entries,
        "failures": [],
    }
    (worker / "publish-report.json").write_text(json.dumps(report), encoding="utf-8")
    return worker


def _three_domain_workers(tmp_path: Path, catalog, plan_path: Path) -> list[Path]:
    return [
        _domain_worker(
            tmp_path,
            catalog=catalog,
            plan_path=plan_path,
            domain="marine",
            index=0,
            count=1,
            solution_ids=["marine-a", "marine-b"],
        ),
        _domain_worker(
            tmp_path,
            catalog=catalog,
            plan_path=plan_path,
            domain="land",
            index=0,
            count=2,
            solution_ids=["land-a"],
        ),
        _domain_worker(
            tmp_path,
            catalog=catalog,
            plan_path=plan_path,
            domain="land",
            index=1,
            count=2,
            solution_ids=["land-b"],
        ),
    ]


def test_merge_two_land_workers_and_one_marine_worker(tmp_path: Path):
    catalog_path, plan_path, catalog = _mixed_release_contracts(tmp_path)
    workers = _three_domain_workers(tmp_path, catalog, plan_path)
    output_dir = Path(
        "data/metrics/generated/releases/mixed-release/regular/verbose"
    )

    merged = merge_workers(
        catalog_path=catalog_path,
        release_plan_path=plan_path,
        worker_output_dirs=workers,
        output_dir=output_dir,
    )

    for worker in workers:
        report = json.loads((worker / "publish-report.json").read_text())
        assert all(
            entry["cachePath"].startswith(f"{worker.as_posix()}/cache/")
            for entry in report["entries"]
        )
    assert merged["chunk"]["workerMode"] == "domain"
    assert set(merged["inputAlignment"]["domains"]) == {"land", "marine"}
    assert [entry["solutionId"] for entry in merged["entries"]] == [
        "land-a",
        "land-b",
        "marine-a",
        "marine-b",
    ]
    assert merged["solutionCatalog"]["expectedCounts"] == {
        "total": 4,
        "land": 2,
        "marine": 2,
    }
    assert all(
        entry["cachePath"]
        == (
            output_dir
            / "cache"
            / f"{entry['solutionId']}.metrics.json"
        ).as_posix()
        for entry in merged["entries"]
    )


def test_merge_allows_domain_specific_species_pool_sizes(tmp_path: Path):
    catalog_path, plan_path, catalog = _mixed_release_contracts(tmp_path)
    workers = [
        _domain_worker(
            tmp_path,
            catalog=catalog,
            plan_path=plan_path,
            domain="land",
            index=index,
            count=2,
            solution_ids=[solution_id],
            species_pool_sizes={"totalNonFish": 12},
        )
        for index, solution_id in enumerate(("land-a", "land-b"))
    ]
    workers.append(
        _domain_worker(
            tmp_path,
            catalog=catalog,
            plan_path=plan_path,
            domain="marine",
            index=0,
            count=1,
            solution_ids=["marine-a", "marine-b"],
        )
    )

    merged = merge_workers(
        catalog_path=catalog_path,
        release_plan_path=plan_path,
        worker_output_dirs=workers,
        output_dir=tmp_path / "merged",
    )

    assert merged["speciesPoolSizes"] == {
        "land": {"totalNonFish": 12},
        "marine": None,
    }


def test_merge_rejects_species_pool_disagreement_within_domain(tmp_path: Path):
    catalog_path, plan_path, catalog = _mixed_release_contracts(tmp_path)
    workers = _three_domain_workers(tmp_path, catalog, plan_path)
    report_path = workers[2] / "publish-report.json"
    report = json.loads(report_path.read_text())
    report["speciesPoolSizes"] = {"totalNonFish": 13}
    report_path.write_text(json.dumps(report))

    with pytest.raises(SolutionCatalogError, match="species pool metadata disagrees"):
        merge_workers(
            catalog_path=catalog_path,
            release_plan_path=plan_path,
            worker_output_dirs=workers,
            output_dir=tmp_path / "merged",
        )


def test_merge_rejects_wrong_domain_entry(tmp_path: Path):
    catalog_path, plan_path, catalog = _mixed_release_contracts(tmp_path)
    workers = _three_domain_workers(tmp_path, catalog, plan_path)
    report_path = workers[1] / "publish-report.json"
    report = json.loads(report_path.read_text())
    report["entries"][0]["solutionId"] = "marine-a"
    report_path.write_text(json.dumps(report))

    with pytest.raises(SolutionCatalogError, match="unexpected solution"):
        merge_workers(
            catalog_path=catalog_path,
            release_plan_path=plan_path,
            worker_output_dirs=workers,
            output_dir=tmp_path / "merged",
        )


def test_merge_rejects_conflicting_same_domain_alignment(tmp_path: Path):
    catalog_path, plan_path, catalog = _mixed_release_contracts(tmp_path)
    workers = _three_domain_workers(tmp_path, catalog, plan_path)
    report_path = workers[2] / "publish-report.json"
    report = json.loads(report_path.read_text())
    report["inputAlignment"]["domains"]["land"]["marker"] = "conflict"
    report_path.write_text(json.dumps(report))

    with pytest.raises(SolutionCatalogError, match="inventories conflict"):
        merge_workers(
            catalog_path=catalog_path,
            release_plan_path=plan_path,
            worker_output_dirs=workers,
            output_dir=tmp_path / "merged",
        )


def test_merge_rejects_missing_domain(tmp_path: Path):
    catalog_path, plan_path, catalog = _mixed_release_contracts(tmp_path)
    workers = _three_domain_workers(tmp_path, catalog, plan_path)[1:]

    with pytest.raises(SolutionCatalogError, match="every recompute domain"):
        merge_workers(
            catalog_path=catalog_path,
            release_plan_path=plan_path,
            worker_output_dirs=workers,
            output_dir=tmp_path / "merged",
        )


def test_merge_rejects_missing_solution_from_complete_partitions(tmp_path: Path):
    catalog_path, plan_path, catalog = _mixed_release_contracts(tmp_path)
    workers = _three_domain_workers(tmp_path, catalog, plan_path)
    report_path = workers[0] / "publish-report.json"
    report = json.loads(report_path.read_text())
    report["entries"].pop()
    report["chunk"]["selectedForChunk"] = 1
    report_path.write_text(json.dumps(report))

    with pytest.raises(SolutionCatalogError, match="does not exactly cover"):
        merge_workers(
            catalog_path=catalog_path,
            release_plan_path=plan_path,
            worker_output_dirs=workers,
            output_dir=tmp_path / "merged",
        )


def test_merge_rejects_unexpected_solution(tmp_path: Path):
    catalog_path, plan_path, catalog = _mixed_release_contracts(tmp_path)
    workers = _three_domain_workers(tmp_path, catalog, plan_path)
    report_path = workers[1] / "publish-report.json"
    report = json.loads(report_path.read_text())
    report["entries"][0]["solutionId"] = "unexpected"
    report_path.write_text(json.dumps(report))

    with pytest.raises(SolutionCatalogError, match="unexpected solution"):
        merge_workers(
            catalog_path=catalog_path,
            release_plan_path=plan_path,
            worker_output_dirs=workers,
            output_dir=tmp_path / "merged",
        )


def test_merge_rejects_incomplete_catalog_binding(tmp_path: Path):
    catalog_path, plan_path, catalog = _mixed_release_contracts(tmp_path)
    workers = _three_domain_workers(tmp_path, catalog, plan_path)
    report_path = workers[0] / "publish-report.json"
    report = json.loads(report_path.read_text())
    del report["solutionCatalog"]["expectedCounts"]
    report_path.write_text(json.dumps(report))

    with pytest.raises(SolutionCatalogError, match="catalog binding mismatch"):
        merge_workers(
            catalog_path=catalog_path,
            release_plan_path=plan_path,
            worker_output_dirs=workers,
            output_dir=tmp_path / "merged",
        )


def test_merge_rejects_duplicated_worker_prefix(tmp_path: Path):
    catalog_path, plan_path, catalog = _mixed_release_contracts(tmp_path)
    workers = _three_domain_workers(tmp_path, catalog, plan_path)
    report_path = workers[1] / "publish-report.json"
    report = json.loads(report_path.read_text())
    original = report["entries"][0]["cachePath"]
    report["entries"][0]["cachePath"] = f"{workers[1].as_posix()}/{original}"
    report_path.write_text(json.dumps(report))

    with pytest.raises(SolutionCatalogError, match="does not match its worker"):
        merge_workers(
            catalog_path=catalog_path,
            release_plan_path=plan_path,
            worker_output_dirs=workers,
            output_dir=tmp_path / "merged",
        )


def test_merge_rejects_cache_path_traversal(tmp_path: Path):
    catalog_path, plan_path, catalog = _mixed_release_contracts(tmp_path)
    workers = _three_domain_workers(tmp_path, catalog, plan_path)
    report_path = workers[1] / "publish-report.json"
    report = json.loads(report_path.read_text())
    report["entries"][0]["cachePath"] = (
        f"{workers[1].as_posix()}/cache/../cache/land-a.metrics.json"
    )
    report_path.write_text(json.dumps(report))

    with pytest.raises(SolutionCatalogError, match="canonical and repo-relative"):
        merge_workers(
            catalog_path=catalog_path,
            release_plan_path=plan_path,
            worker_output_dirs=workers,
            output_dir=tmp_path / "merged",
        )


def test_merge_rejects_cache_path_from_another_worker(tmp_path: Path):
    catalog_path, plan_path, catalog = _mixed_release_contracts(tmp_path)
    workers = _three_domain_workers(tmp_path, catalog, plan_path)
    report_path = workers[1] / "publish-report.json"
    other_report = json.loads((workers[2] / "publish-report.json").read_text())
    report = json.loads(report_path.read_text())
    report["entries"][0]["cachePath"] = other_report["entries"][0]["cachePath"]
    report_path.write_text(json.dumps(report))

    with pytest.raises(SolutionCatalogError, match="does not match its worker"):
        merge_workers(
            catalog_path=catalog_path,
            release_plan_path=plan_path,
            worker_output_dirs=workers,
            output_dir=tmp_path / "merged",
        )


def test_merge_rejects_missing_generator_cache_file(tmp_path: Path):
    catalog_path, plan_path, catalog = _mixed_release_contracts(tmp_path)
    workers = _three_domain_workers(tmp_path, catalog, plan_path)
    report = json.loads((workers[1] / "publish-report.json").read_text())
    Path(report["entries"][0]["cachePath"]).unlink()

    with pytest.raises(SolutionCatalogError, match="artifact is missing"):
        merge_workers(
            catalog_path=catalog_path,
            release_plan_path=plan_path,
            worker_output_dirs=workers,
            output_dir=tmp_path / "merged",
        )


def test_merge_rejects_worker_relative_cache_path_form(tmp_path: Path):
    catalog_path, plan_path, catalog = _mixed_release_contracts(tmp_path)
    workers = _three_domain_workers(tmp_path, catalog, plan_path)
    report_path = workers[1] / "publish-report.json"
    report = json.loads(report_path.read_text())
    report["entries"][0]["cachePath"] = "cache/land-a.metrics.json"
    report_path.write_text(json.dumps(report))

    with pytest.raises(SolutionCatalogError, match="does not match its worker"):
        merge_workers(
            catalog_path=catalog_path,
            release_plan_path=plan_path,
            worker_output_dirs=workers,
            output_dir=tmp_path / "merged",
        )


def test_merge_rejects_stale_absolute_cache_path(tmp_path: Path):
    catalog_path, plan_path, catalog = _mixed_release_contracts(tmp_path)
    workers = _three_domain_workers(tmp_path, catalog, plan_path)
    report_path = workers[1] / "publish-report.json"
    report = json.loads(report_path.read_text())
    report["entries"][0]["cachePath"] = str(
        Path(report["entries"][0]["cachePath"]).resolve()
    )
    report_path.write_text(json.dumps(report))

    with pytest.raises(SolutionCatalogError, match="canonical and repo-relative"):
        merge_workers(
            catalog_path=catalog_path,
            release_plan_path=plan_path,
            worker_output_dirs=workers,
            output_dir=tmp_path / "merged",
        )
