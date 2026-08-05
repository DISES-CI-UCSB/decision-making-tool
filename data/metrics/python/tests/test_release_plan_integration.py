from __future__ import annotations

import json
from pathlib import Path

from main import _filter_release_plan_solutions
from mec_compact import _release_plan_land_ids
from plan_solution_release import build_release_plan
from solution_catalog import load_solution_catalog


def _signature(value: str) -> dict[str, str]:
    return {
        "format": "solution-input-signature-v1",
        "sha256": value * 64,
    }


def test_phase_two_plan_executes_exactly_24_recompute_solutions(tmp_path: Path):
    solution_ids = [f"solution-{index:03d}" for index in range(192)]
    catalog_path = tmp_path / "catalog.json"
    catalog_path.write_text(
        json.dumps(
            {
                "format": "solution-catalog-v1",
                "catalogVersion": "0.2.0",
                "releaseId": "phase-two",
                "expectedSolutionCount": 192,
                "expectedLandSolutionCount": 192,
                "expectedMarineSolutionCount": 0,
                "solutions": [
                    {
                        "solutionId": solution_id,
                        "solutionBasename": f"{solution_id}.tif",
                        "domain": "land",
                        "rasterSha256": "a" * 64,
                    }
                    for solution_id in solution_ids
                ],
            }
        ),
        encoding="utf-8",
    )
    baseline_path = tmp_path / "baseline.json"
    baseline = json.loads(catalog_path.read_text(encoding="utf-8"))
    baseline["releaseId"] = "phase-one"
    baseline_path.write_text(json.dumps(baseline), encoding="utf-8")
    catalog = load_solution_catalog(catalog_path)
    baseline_catalog = load_solution_catalog(baseline_path)
    baseline_signatures = {
        solution_id: _signature("a")
        for solution_id in solution_ids
    }
    current_signatures = {
        solution_id: _signature("a" if index < 168 else "b")
        for index, solution_id in enumerate(solution_ids)
    }
    plan = build_release_plan(
        catalog,
        baseline=baseline_catalog,
        input_signatures=current_signatures,
        baseline_input_signatures=baseline_signatures,
    )
    plan_path = tmp_path / "plan.json"
    plan_path.write_text(json.dumps(plan), encoding="utf-8")
    solutions = [{"id": solution_id} for solution_id in solution_ids]

    regular = _filter_release_plan_solutions(
        solutions,
        catalog=catalog,
        release_plan=plan_path,
    )
    mec = _release_plan_land_ids(
        plan_path,
        catalog=catalog,
        land_solution_ids=solution_ids,
    )

    assert plan["counts"] == {"total": 192, "reuse": 168, "recompute": 24}
    assert len(regular) == 24
    assert len(mec) == 24
    assert [solution["id"] for solution in regular] == solution_ids[-24:]
    assert mec == tuple(solution_ids[-24:])


def test_phase_one_plan_recomputes_82_land_and_preserves_4_marine(
    tmp_path: Path,
):
    land_ids = [f"land-{index:03d}" for index in range(82)]
    marine_ids = [f"marine-{index}" for index in range(4)]
    solution_ids = sorted(land_ids + marine_ids)
    catalog_path = tmp_path / "catalog.json"
    catalog_path.write_text(
        json.dumps(
            {
                "format": "solution-catalog-v1",
                "catalogVersion": "0.1.0",
                "releaseId": "solutions-v0-1-0-20260804",
                "expectedSolutionCount": 86,
                "expectedLandSolutionCount": 82,
                "expectedMarineSolutionCount": 4,
                "solutions": [
                    {
                        "solutionId": solution_id,
                        "solutionBasename": f"{solution_id}.tif",
                        "domain": (
                            "marine"
                            if solution_id in marine_ids
                            else "land"
                        ),
                        "rasterSha256": "a" * 64,
                    }
                    for solution_id in solution_ids
                ],
            }
        ),
        encoding="utf-8",
    )
    baseline_path = tmp_path / "baseline.json"
    baseline_path.write_text(
        json.dumps(
            {
                "format": "solution-catalog-v1",
                "catalogVersion": "0.0.0",
                "releaseId": "baseline",
                "expectedSolutionCount": 4,
                "expectedLandSolutionCount": 0,
                "expectedMarineSolutionCount": 4,
                "solutions": [
                    {
                        "solutionId": solution_id,
                        "solutionBasename": f"{solution_id}.tif",
                        "domain": "marine",
                        "rasterSha256": "a" * 64,
                    }
                    for solution_id in sorted(marine_ids)
                ],
            }
        ),
        encoding="utf-8",
    )
    catalog = load_solution_catalog(catalog_path)
    baseline = load_solution_catalog(baseline_path)
    current_signatures = {
        solution_id: _signature("a")
        for solution_id in solution_ids
    }
    baseline_signatures = {
        solution_id: current_signatures[solution_id]
        for solution_id in marine_ids
    }

    plan = build_release_plan(
        catalog,
        baseline=baseline,
        input_signatures=current_signatures,
        baseline_input_signatures=baseline_signatures,
    )
    plan_path = tmp_path / "plan.json"
    plan_path.write_text(json.dumps(plan), encoding="utf-8")
    runtime_solutions = [{"id": solution_id} for solution_id in solution_ids]

    selected = _filter_release_plan_solutions(
        runtime_solutions,
        catalog=catalog,
        release_plan=plan_path,
    )

    assert plan["counts"] == {"total": 86, "reuse": 4, "recompute": 82}
    assert [solution["id"] for solution in selected] == sorted(land_ids)
