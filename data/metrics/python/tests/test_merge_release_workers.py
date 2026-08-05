from __future__ import annotations

import json
from pathlib import Path

import pytest

from merge_release_workers import merge_workers
from plan_solution_release import build_release_plan
from solution_catalog import SolutionCatalogError, load_solution_catalog


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
    index: int,
    count: int,
    solution_id: str,
) -> Path:
    worker = tmp_path / f"worker-{index}"
    cache = worker / "cache"
    cache.mkdir(parents=True)
    artifact = cache / f"{solution_id}.metrics.json"
    artifact.write_text(
        json.dumps(
            {
                "solutionId": solution_id,
                "solutionCatalogBinding": {
                    "releaseId": catalog.release_id,
                    "catalogSha256": catalog.sha256,
                },
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
            "releaseId": catalog.release_id,
            "sha256": catalog.sha256,
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
