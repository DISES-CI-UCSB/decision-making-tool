from __future__ import annotations

import hashlib
import json
from pathlib import Path
from types import SimpleNamespace

import pytest

import main as pipeline
from blob_manifest import ResolvedManifest
from plan_solution_release import build_release_plan
from solution_catalog import SolutionCatalogError, load_solution_catalog


def _write_catalog_and_plan(
    tmp_path: Path,
    *,
    land_count: int = 168,
    marine_count: int = 4,
) -> tuple[Path, Path, object]:
    rows = [
        (f"land-{index:03d}", "land")
        for index in range(land_count)
    ] + [
        (f"marine-{index:03d}", "marine")
        for index in range(marine_count)
    ]
    catalog_path = tmp_path / "catalog.json"
    catalog_path.write_text(
        json.dumps(
            {
                "format": "solution-catalog-v1",
                "catalogVersion": "0.2.0",
                "releaseId": "domain-release",
                "expectedSolutionCount": len(rows),
                "expectedLandSolutionCount": land_count,
                "expectedMarineSolutionCount": marine_count,
                "solutions": [
                    {
                        "solutionId": solution_id,
                        "solutionBasename": f"{solution_id}.tif",
                        "domain": domain,
                        "rasterSha256": hashlib.sha256(
                            solution_id.encode()
                        ).hexdigest(),
                    }
                    for solution_id, domain in rows
                ],
            }
        ),
        encoding="utf-8",
    )
    catalog = load_solution_catalog(catalog_path)
    plan_path = tmp_path / "release-plan.json"
    plan_path.write_text(json.dumps(build_release_plan(catalog)), encoding="utf-8")
    return catalog_path, plan_path, catalog


def _runtime_solutions(catalog) -> list[dict]:
    return [
        {
            "id": entry.solution_id,
            "domain": entry.domain,
            "scope": entry.domain,
            "displayUrl": f"file:///{entry.solution_basename}",
            "blobPath": f"solutions/{entry.solution_basename}",
        }
        for entry in catalog.solutions
    ]


def test_domain_selection_requires_catalog_and_complete_plan():
    with pytest.raises(SystemExit):
        pipeline._parse_args(["--domain", "land"])


def test_domain_selection_is_exact_168_land_and_4_marine(tmp_path: Path):
    _, plan_path, catalog = _write_catalog_and_plan(tmp_path)
    solutions = _runtime_solutions(catalog)

    land = pipeline._filter_release_plan_solutions(
        solutions,
        catalog=catalog,
        release_plan=plan_path,
        domain="land",
    )
    marine = pipeline._filter_release_plan_solutions(
        solutions,
        catalog=catalog,
        release_plan=plan_path,
        domain="marine",
    )

    assert len(land) == 168
    assert len(marine) == 4
    assert {solution["domain"] for solution in land} == {"land"}
    assert {solution["domain"] for solution in marine} == {"marine"}


def test_domain_selection_rejects_missing_or_wrong_plan_entry(tmp_path: Path):
    _, plan_path, catalog = _write_catalog_and_plan(tmp_path)
    solutions = _runtime_solutions(catalog)
    plan = json.loads(plan_path.read_text())
    plan["entries"].pop()
    plan["counts"]["total"] -= 1
    plan["counts"]["recompute"] -= 1
    plan_path.write_text(json.dumps(plan))

    with pytest.raises(SolutionCatalogError, match="exactly match catalog order"):
        pipeline._filter_release_plan_solutions(
            solutions,
            catalog=catalog,
            release_plan=plan_path,
            domain="land",
        )

    plan_path.write_text(json.dumps(build_release_plan(catalog)))
    plan = json.loads(plan_path.read_text())
    plan["entries"][0]["domain"] = "marine"
    plan_path.write_text(json.dumps(plan))

    with pytest.raises(SolutionCatalogError, match="does not match the catalog"):
        pipeline._filter_release_plan_solutions(
            solutions,
            catalog=catalog,
            release_plan=plan_path,
            domain="land",
        )


def test_land_chunks_are_complete_and_disjoint(tmp_path: Path):
    _, plan_path, catalog = _write_catalog_and_plan(tmp_path)
    land = pipeline._filter_release_plan_solutions(
        _runtime_solutions(catalog),
        catalog=catalog,
        release_plan=plan_path,
        domain="land",
    )
    chunks = [
        pipeline._chunk_solutions(land, chunk_index=index, chunk_count=2)
        for index in range(2)
    ]

    chunk_ids = [{solution["id"] for solution in chunk} for chunk in chunks]
    assert len(chunks[0]) == 84
    assert len(chunks[1]) == 84
    assert chunk_ids[0].isdisjoint(chunk_ids[1])
    assert chunk_ids[0] | chunk_ids[1] == {
        solution["id"] for solution in land
    }


@pytest.mark.parametrize(
    ("selected_domain", "excluded_domain"),
    [("land", "marine"), ("marine", "land")],
)
def test_validate_only_preflight_never_opens_other_domain_grid(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    selected_domain: str,
    excluded_domain: str,
):
    catalog_path, plan_path, catalog = _write_catalog_and_plan(
        tmp_path,
        land_count=1,
        marine_count=1,
    )
    solutions = _runtime_solutions(catalog)
    manifest = ResolvedManifest(
        url="file:///manifest.json",
        raw={},
        public_blob_host="https://example.test",
        layers_by_id={},
        national_solutions=[solutions[0]],
        batch_solutions=solutions,
    )
    opened_domains: list[str] = []

    monkeypatch.setattr(pipeline, "fetch_manifest", lambda _url: manifest)

    def raster_preflight(selected, **_kwargs):
        opened_domains.extend(solution["domain"] for solution in selected)
        return {
            solution["id"]: SimpleNamespace(
                path=tmp_path / f"{solution['id']}.tif",
                sha256=catalog.by_id[solution["id"]].raster_sha256,
            )
            for solution in selected
        }, []

    def alignment_preflight(selected, *_args, **_kwargs):
        opened_domains.extend(solution["domain"] for solution in selected)
        inventory = {
            "format": "metrics-alignment-inventory-v4",
            "domains": {
                selected_domain: {
                    "domain": selected_domain,
                    "alignedInputs": 0,
                    "expectedAlignedInputs": 0,
                    "targetGridSha256": "a" * 64,
                }
            },
            "cacheStorage": {
                "completePairBytes": 0,
                "estimatedReleaseBytes": 0,
                "configuredMaxBytes": 1,
            },
        }
        return SimpleNamespace(), inventory, []

    monkeypatch.setattr(pipeline, "_preflight_solution_rasters", raster_preflight)
    monkeypatch.setattr(pipeline, "_preflight_aligned_inputs", alignment_preflight)

    result = pipeline.main(
        [
            "--manifest-url",
            manifest.url,
            "--solution-catalog",
            str(catalog_path),
            "--release-plan",
            str(plan_path),
            "--domain",
            selected_domain,
            "--validate-only",
            "--skip-species",
            "--cache-dir",
            str(tmp_path / "cache"),
        ]
    )

    assert result == 0
    assert opened_domains
    assert set(opened_domains) == {selected_domain}
    assert excluded_domain not in opened_domains
