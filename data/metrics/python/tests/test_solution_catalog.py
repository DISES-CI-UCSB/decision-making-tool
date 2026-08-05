from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest

from blob_manifest import ResolvedManifest
from metrics_contract import build_metrics_provenance
from plan_solution_release import build_release_plan
from solution_catalog import (
    SOLUTION_CATALOG_FORMAT,
    SolutionCatalogError,
    bind_release_output,
    load_release_plan,
    load_solution_catalog,
)
from solution_input_signature import build_solution_input_signature

SHARED_CATALOG_FIXTURE = (
    Path(__file__).parents[2] / "fixtures/solution-catalog-v1.json"
)


def _write_catalog(
    path: Path,
    raster_paths: list[Path],
    *,
    release_id: str,
    catalog_version: str = "0.2.0",
) -> Path:
    solutions = [
        {
            "solutionId": f"solution-{index}",
            "solutionBasename": f"solution-{index}.tif",
            "domain": "land" if index < len(raster_paths) - 1 else "marine",
                "rasterSha256": hashlib.sha256(raster_path.read_bytes()).hexdigest(),
        }
        for index, raster_path in enumerate(raster_paths)
    ]
    path.write_text(
        json.dumps(
            {
                "format": SOLUTION_CATALOG_FORMAT,
                "catalogVersion": catalog_version,
                "releaseId": release_id,
                "expectedSolutionCount": len(solutions),
                "expectedLandSolutionCount": len(solutions) - 1,
                "expectedMarineSolutionCount": 1,
                "solutions": solutions,
            }
        ),
        encoding="utf-8",
    )
    return path


def test_catalog_accepts_zero_major_semver_and_enforces_declared_counts(tmp_path):
    rasters = [tmp_path / "a.tif", tmp_path / "b.tif"]
    for index, raster in enumerate(rasters):
        raster.write_bytes(f"raster-{index}".encode())
    catalog_path = _write_catalog(
        tmp_path / "catalog.json",
        rasters,
        release_id="release-two",
        catalog_version="0.3.1",
    )

    catalog = load_solution_catalog(catalog_path)

    assert catalog.catalog_version == "0.3.1"
    assert catalog.expected_total_count == 2
    assert catalog.expected_land_count == 1
    assert catalog.expected_marine_count == 1
    assert len(catalog.sha256) == 64

    raw = json.loads(catalog_path.read_text())
    raw["expectedSolutionCount"] = 3
    catalog_path.write_text(json.dumps(raw))
    with pytest.raises(
        SolutionCatalogError,
        match=r"expectedSolutionCount must equal expectedLandSolutionCount",
    ):
        load_solution_catalog(catalog_path)


def test_shared_catalog_fixture_matches_canonical_contract():
    catalog = load_solution_catalog(SHARED_CATALOG_FIXTURE)

    assert catalog.to_dict() == json.loads(
        SHARED_CATALOG_FIXTURE.read_text(encoding="utf-8")
    )
    assert catalog.solution_ids == ("fixture-land", "fixture-marine")


def test_solution_input_signature_covers_consumed_manifest_metadata():
    catalog = load_solution_catalog(SHARED_CATALOG_FIXTURE)
    entry = catalog.by_id["fixture-land"]
    solution = {
        "id": "fixture-land",
        "name": "Ecos17",
        "displayUrl": "https://example.test/fixture-land.tif",
        "metadataUrl": "https://example.test/summary.csv",
        "summaryMetrics": {"pctTargetsMet": 80},
        "coverage": [{"met": True}],
    }
    manifest = ResolvedManifest(
        url="https://example.test/manifest.json",
        raw={},
        public_blob_host="https://example.test",
        layers_by_id={"carbon": {"id": "carbon", "displayUrl": "carbon.tif"}},
        national_solutions=[solution],
        batch_solutions=[solution],
    )
    arguments = {
        "catalog_entry": entry,
        "manifest": manifest,
        "metrics_provenance": build_metrics_provenance("land"),
        "source_identity": {
            "summaryCsvSha256": "c" * 64,
            "speciesCsvSha256": "d" * 64,
        },
    }

    original = build_solution_input_signature(solution=solution, **arguments)
    changed = build_solution_input_signature(
        solution={**solution, "coverage": [{"met": False}]},
        **arguments,
    )

    assert original != changed


def test_plan_reuses_unchanged_rasters_and_selects_only_recompute_entries(tmp_path):
    old_a = tmp_path / "old-a.tif"
    old_b = tmp_path / "old-b.tif"
    new_a = tmp_path / "new-a.tif"
    new_b = tmp_path / "new-b.tif"
    for raster, content in (
        (old_a, b"same"),
        (old_b, b"old"),
        (new_a, b"same"),
        (new_b, b"new"),
    ):
        raster.write_bytes(content)
    baseline = load_solution_catalog(
        _write_catalog(
            tmp_path / "baseline.json",
            [old_a, old_b],
            release_id="release-one",
        )
    )
    catalog = load_solution_catalog(
        _write_catalog(
            tmp_path / "catalog.json",
            [new_a, new_b],
            release_id="release-two",
        )
    )
    signatures = {
        solution_id: {
            "format": "solution-input-signature-v1",
            "sha256": f"{index + 1:064x}",
        }
        for index, solution_id in enumerate(catalog.solution_ids)
    }

    plan = build_release_plan(
        catalog,
        baseline=baseline,
        input_signatures=signatures,
        baseline_input_signatures=signatures,
    )
    plan_path = tmp_path / "plan.json"
    plan_path.write_text(json.dumps(plan), encoding="utf-8")

    assert plan["counts"] == {"total": 2, "reuse": 1, "recompute": 1}
    assert plan["reuseValidation"]["runtimeProvenance"] == "required"
    assert [entry["action"] for entry in plan["entries"]] == ["reuse", "recompute"]
    assert load_release_plan(plan_path, catalog=catalog) == ("solution-1",)
    assert load_release_plan(
        plan_path,
        catalog=catalog,
        action="reuse",
    ) == ("solution-0",)

    plan["entries"][0]["rasterSha256"] = "f" * 64
    plan_path.write_text(json.dumps(plan), encoding="utf-8")
    with pytest.raises(SolutionCatalogError, match="does not match the catalog"):
        load_release_plan(plan_path, catalog=catalog)
    assert build_release_plan(
        catalog,
        baseline=baseline,
        cache_policy="recompute-all",
        input_signatures=signatures,
        baseline_input_signatures=signatures,
    )["counts"]["recompute"] == 2
    assert build_release_plan(
        catalog,
        baseline=baseline,
    )["counts"]["recompute"] == 2


def test_catalog_checksum_mismatch_and_output_rebinding_fail_closed(tmp_path):
    raster = tmp_path / "solution.tif"
    raster.write_bytes(b"content")
    first_path = _write_catalog(
        tmp_path / "catalog.json",
        [raster],
        release_id="release-one",
    )
    raw = json.loads(first_path.read_text())
    raw["solutions"][0]["rasterSha256"] = "0" * 64
    first_path.write_text(json.dumps(raw))
    first = load_solution_catalog(first_path)

    with pytest.raises(SolutionCatalogError, match="must be a SHA-256 digest"):
        raw["solutions"][0]["rasterSha256"] = "not-a-checksum"
        first_path.write_text(json.dumps(raw))
        load_solution_catalog(first_path)

    raw["solutions"][0]["rasterSha256"] = hashlib.sha256(
        raster.read_bytes()
    ).hexdigest()
    first_path.write_text(json.dumps(raw))
    first = load_solution_catalog(first_path)
    output_dir = tmp_path / "release-output"
    bind_release_output(output_dir, catalog=first, component="regular-verbose")

    second = load_solution_catalog(
        _write_catalog(
            tmp_path / "catalog-two.json",
            [raster],
            release_id="release-two",
        )
    )
    with pytest.raises(SolutionCatalogError, match="different immutable release"):
        bind_release_output(
            output_dir,
            catalog=second,
            component="regular-verbose",
        )


def test_catalog_rejects_noncanonical_solution_ids(tmp_path: Path):
    rasters = [tmp_path / "a.tif", tmp_path / "b.tif"]
    for raster in rasters:
        raster.write_bytes(b"content")
    catalog_path = _write_catalog(
        tmp_path / "catalog.json",
        rasters,
        release_id="collision-release",
    )
    raw = json.loads(catalog_path.read_text(encoding="utf-8"))
    raw["solutions"][0]["solutionId"] = "demo/a"
    raw["solutions"][1]["solutionId"] = "demo_a"
    catalog_path.write_text(json.dumps(raw), encoding="utf-8")

    with pytest.raises(SolutionCatalogError, match="solutionId is unsafe"):
        load_solution_catalog(catalog_path)


@pytest.mark.parametrize("basename", ("demo", "demo.TIF", "demo.tiff", "demo.json"))
def test_catalog_requires_exact_lowercase_tif_extension(
    tmp_path: Path,
    basename: str,
):
    raster = tmp_path / "demo.tif"
    raster.write_bytes(b"content")
    catalog_path = _write_catalog(
        tmp_path / "catalog.json",
        [raster],
        release_id="basename-release",
    )
    raw = json.loads(catalog_path.read_text(encoding="utf-8"))
    raw["solutions"][0]["solutionBasename"] = basename
    catalog_path.write_text(json.dumps(raw), encoding="utf-8")

    with pytest.raises(SolutionCatalogError, match="include the .tif extension"):
        load_solution_catalog(catalog_path)
