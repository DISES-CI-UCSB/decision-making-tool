from __future__ import annotations

import json
from pathlib import Path

import pytest

from assemble_solution_release import (
    ARTIFACT_INVENTORY_FORMAT,
    _document_has_usable_structure,
    _expected_keys,
    _local_relative_path,
    assemble_release,
    sha256_path,
)
from compact_metrics import to_compact_document, to_verbose_document
from metric_definitions import computable_metrics
from metrics_contract import build_metrics_provenance
from mec_compact import (
    MEC_SIGNATURE_FORMAT,
    ROW_LAYOUT,
    SCOPE_STATS_FIELDS,
)
from plan_solution_release import build_release_plan
from solution_catalog import (
    SolutionCatalogError,
    catalog_binding,
    load_solution_catalog,
)
from helpers import scope_state


def _signature(value: str) -> dict[str, str]:
    return {
        "format": "solution-input-signature-v1",
        "sha256": value * 64,
    }


def _binding(catalog) -> dict:
    return catalog_binding(catalog)


def _document(component, entry, catalog, signature, geography_level):
    if component in {"regularVerbose", "regularCompact"}:
        def metrics_for(level: str) -> list[dict]:
            metrics = []
            for definition in computable_metrics():
                not_applicable = (
                    "land" not in definition.applicable_domains
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
                metrics.append({
                    "metricId": definition.metric_id,
                    "value": None if not_applicable else 0,
                    "status": "not_applicable" if not_applicable else "ready",
                    "unit": definition.unit,
                    "labelKey": definition.label_key,
                })
            return metrics
        geographies = {
            level: {
                ("colombia" if level == "national" else "scope"): {
                    "scopeState": scope_state(
                        level,
                        "colombia" if level == "national" else "scope",
                        solution_raster_sha256=entry.raster_sha256,
                    ),
                    "metrics": metrics_for(level),
                }
            }
            for level in (
                "national",
                "departments",
                "municipalities",
                "siraps",
                "runaps",
                "omecs",
            )
        }
        document = {
            "solutionId": entry.solution_id,
            "solutionRaster": {
                "solutionBasename": entry.solution_basename,
                "sha256": entry.raster_sha256,
            },
            "solutionInputSignature": signature,
            "solutionCatalogBinding": _binding(catalog),
            "metricsProvenance": build_metrics_provenance(
                "land",
                release_id=catalog.release_id,
            ),
            "speciesCompleteness": {
                "expected": 1,
                "aligned": 1,
                "processed": 1,
                "missing": 0,
                "complete": True,
            },
            "geographies": geographies,
        }
        if component == "regularCompact":
            return to_compact_document(document)
        return document
    if component == "goals":
        return {
            "format": "conservation-goals-v1",
            "solutionId": entry.solution_id,
            "generatedAt": "2026-01-01T00:00:00Z",
            "source": {
                "metadataUrl": "https://example.test/metadata.json",
                "summaryCsvUrl": "https://example.test/summary.csv",
                "summaryCsvRows": 0,
                "solutionDomain": "land",
                "speciesLookupUrl": "https://example.test/species.csv",
            },
            "targetContext": {},
            "goalsProvenance": {
                "releaseId": catalog.release_id,
                "catalogBinding": _binding(catalog),
                "solutionBasename": entry.solution_basename,
                "rasterSha256": entry.raster_sha256,
                "inputSignature": "goals-input",
            },
            "summary": {
                "metCount": 0,
                "totalCount": 0,
                "pctMet": None,
                "byType": {
                    "species": {
                        "metSpeciesCount": 0,
                        "totalSpeciesCount": 0,
                        "pctMet": None,
                    },
                    **{
                        key: {"metCount": 0, "totalCount": 0, "pctMet": None}
                        for key in (
                            "strategicEcosystems",
                            "ecosystems",
                            "other",
                        )
                    },
                },
            },
            "rollups": {
                "species": {},
                "strategicEcosystems": {},
                "ecosystems": {},
            },
            "features": {
                "species": [],
                "strategicEcosystems": [],
                "ecosystems": [],
                "other": [],
            },
            "diagnostics": {
                "rawTypeCounts": {},
                "rowCounts": {
                    "species": 0,
                    "strategicEcosystems": 0,
                    "ecosystems": 0,
                    "other": 0,
                },
            },
        }
    return {
        "format": "mec-compact-v2",
        "solutionId": entry.solution_id,
        "geographyLevel": geography_level,
        "solutionCatalogBinding": _binding(catalog),
        "generationSignature": {
            "format": MEC_SIGNATURE_FORMAT,
            "sha256": "b" * 64,
        },
        "sources": {"solutionRasterSha256": entry.raster_sha256},
        "rowLayout": ROW_LAYOUT,
        "scopeStatsFields": list(SCOPE_STATS_FIELDS),
        "scopeCatalog": [["colombia", "Colombia"]],
        "classCatalog": [["class", "Class"]],
        "viewCatalog": [["view", "View"]],
        "scopeStats": {
            "0": {field: 0 for field in SCOPE_STATS_FIELDS}
        },
        "rows": [],
    }


def _write_catalog(
    path: Path,
    release_id: str,
    count: int,
    *,
    species_exception: dict | None = None,
):
    path.write_text(
        json.dumps(
            {
                "format": "solution-catalog-v1",
                "catalogVersion": "0.2.0",
                "releaseId": release_id,
                "expectedSolutionCount": count,
                "expectedLandSolutionCount": count,
                "expectedMarineSolutionCount": 0,
                **(
                    {"speciesException": species_exception}
                    if species_exception is not None
                    else {}
                ),
                "solutions": [
                    {
                        "solutionId": f"solution-{index:03d}",
                        "solutionBasename": f"solution-{index:03d}.tif",
                        "domain": "land",
                        "rasterSha256": "a" * 64,
                    }
                    for index in range(count)
                ],
            }
        ),
        encoding="utf-8",
    )
    return load_solution_catalog(path)


def _prepare_release(
    tmp_path: Path,
    count: int = 192,
    *,
    species_exception: dict | None = None,
):
    baseline = _write_catalog(
        tmp_path / "baseline.json",
        "phase-one",
        count,
        species_exception=species_exception,
    )
    catalog = _write_catalog(
        tmp_path / "catalog.json",
        "phase-two",
        count,
        species_exception=species_exception,
    )
    baseline_signatures = {
        solution_id: _signature("a")
        for solution_id in catalog.solution_ids
    }
    current_signatures = {
        solution_id: _signature("a" if index < count - 24 else "b")
        for index, solution_id in enumerate(catalog.solution_ids)
    }
    plan = build_release_plan(
        catalog,
        baseline=baseline,
        input_signatures=current_signatures,
        baseline_input_signatures=baseline_signatures,
    )
    plan_path = tmp_path / "plan.json"
    plan_path.write_text(json.dumps(plan), encoding="utf-8")
    baseline_root = tmp_path / "baseline-root"
    release_root = tmp_path / "release-root"
    baseline_artifacts = []
    reuse_ids = set(catalog.solution_ids[:-24])
    for component, solution_id, level in _expected_keys(catalog):
        entry = catalog.by_id[solution_id]
        relative = _local_relative_path(component, solution_id, level)
        if solution_id in reuse_ids:
            path = baseline_root / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(
                json.dumps(
                    _document(
                        component,
                        entry,
                        baseline,
                        baseline_signatures[solution_id],
                        level,
                    )
                ),
                encoding="utf-8",
            )
            baseline_artifacts.append(
                {
                    "component": component,
                    "solutionId": solution_id,
                    "geographyLevel": level,
                    "path": relative.as_posix(),
                    "sha256": sha256_path(path),
                }
            )
        else:
            path = release_root / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(
                json.dumps(
                    _document(
                        component,
                        entry,
                        catalog,
                        current_signatures[solution_id],
                        level,
                    )
                ),
                encoding="utf-8",
            )
    inventory_path = tmp_path / "baseline-inventory.json"
    inventory_path.write_text(
        json.dumps(
            {
                "format": ARTIFACT_INVENTORY_FORMAT,
                "releaseId": baseline.release_id,
                "catalogSha256": baseline.sha256,
                "artifacts": baseline_artifacts,
            }
        ),
        encoding="utf-8",
    )
    return catalog, plan_path, inventory_path, baseline_root, release_root


def test_assembles_realistic_168_reuse_and_24_recompute_release(tmp_path: Path):
    catalog, plan, inventory_path, baseline_root, release_root = _prepare_release(
        tmp_path
    )

    inventory, summary = assemble_release(
        catalog=catalog,
        release_plan=plan,
        baseline_inventory_path=inventory_path,
        baseline_root=baseline_root,
        release_root=release_root,
    )

    assert summary["solutionCount"] == 192
    assert summary["artifactCount"] == 1728
    assert summary["reusedArtifactCount"] == 1512
    assert summary["recomputedArtifactCount"] == 216
    assert summary["complete"] is True
    assert inventory["artifactCount"] == 1728
    reused = json.loads(
        (
            release_root
            / "regular/verbose/cache/solution-000.metrics.json"
        ).read_text(encoding="utf-8")
    )
    assert reused["metricsProvenance"]["releaseId"] == "phase-two"
    assert reused["metricsProvenance"]["reusedFromReleaseId"] == "phase-one"
    assert reused["solutionCatalogBinding"]["catalogSha256"] == catalog.sha256


def test_assembly_preserves_species_exception_in_all_catalog_bindings(tmp_path: Path):
    species_exception = {
        "format": "release-species-exception-binding-v1",
        "policyFormat": "release-species-exception-v1",
        "policyId": "assembly-release-policy",
        "policySha256": "c" * 64,
        "catalogTotal": 8300,
        "availableExpected": 8298,
        "excluded": 2,
    }
    catalog, plan, inventory_path, baseline_root, release_root = _prepare_release(
        tmp_path,
        count=25,
        species_exception=species_exception,
    )

    assemble_release(
        catalog=catalog,
        release_plan=plan,
        baseline_inventory_path=inventory_path,
        baseline_root=baseline_root,
        release_root=release_root,
    )

    reused = json.loads(
        (
            release_root
            / "regular/verbose/cache/solution-000.metrics.json"
        ).read_text(encoding="utf-8")
    )
    recomputed_goals = json.loads(
        (
            release_root
            / "goals/v2/cache/solution-024.goals.json"
        ).read_text(encoding="utf-8")
    )
    assert reused["solutionCatalogBinding"]["speciesException"] == species_exception
    assert (
        recomputed_goals["goalsProvenance"]["catalogBinding"]["speciesException"]
        == species_exception
    )


def test_shared_compact_fixture_matches_python_assembly_contract():
    fixture_path = (
        Path(__file__).parents[2]
        / "fixtures"
        / "release-compact-artifact-v1.json"
    )
    fixture_bytes = fixture_path.read_bytes()
    document = json.loads(fixture_bytes)
    regenerated = to_compact_document(to_verbose_document(document))
    regenerated_bytes = (
        json.dumps(regenerated, ensure_ascii=False, separators=(",", ":")) + "\n"
    ).encode("utf-8")

    assert regenerated == document
    assert regenerated_bytes == fixture_bytes
    assert _document_has_usable_structure(
        document,
        component="regularCompact",
        solution_id="fixture-land",
        geography_level=None,
    )


def test_assembly_rejects_corrupt_baseline_and_differing_destination(tmp_path: Path):
    catalog, plan, inventory_path, baseline_root, release_root = _prepare_release(
        tmp_path,
        count=25,
    )
    source = baseline_root / "regular/verbose/cache/solution-000.metrics.json"
    source.write_text("corrupt", encoding="utf-8")

    with pytest.raises(SolutionCatalogError, match="checksum mismatch"):
        assemble_release(
            catalog=catalog,
            release_plan=plan,
            baseline_inventory_path=inventory_path,
            baseline_root=baseline_root,
            release_root=release_root,
        )
    # Restore the inventory checksum, then pre-create a conflicting destination.
    source.write_text(
        json.dumps(
            _document(
                "regularVerbose",
                catalog.by_id["solution-000"],
                load_solution_catalog(tmp_path / "baseline.json"),
                _signature("a"),
                None,
            )
        ),
        encoding="utf-8",
    )
    raw_inventory = json.loads(inventory_path.read_text(encoding="utf-8"))
    raw_inventory["artifacts"][0]["sha256"] = sha256_path(source)
    inventory_path.write_text(json.dumps(raw_inventory), encoding="utf-8")
    destination = release_root / "regular/verbose/cache/solution-000.metrics.json"
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text("different", encoding="utf-8")

    with pytest.raises(SolutionCatalogError, match="already differs"):
        assemble_release(
            catalog=catalog,
            release_plan=plan,
            baseline_inventory_path=inventory_path,
            baseline_root=baseline_root,
            release_root=release_root,
        )


def test_all_recompute_assembly_needs_no_baseline_inventory(tmp_path: Path):
    catalog, plan, _, _, release_root = _prepare_release(
        tmp_path,
        count=24,
    )

    _, summary = assemble_release(
        catalog=catalog,
        release_plan=plan,
        baseline_inventory_path=None,
        baseline_root=None,
        release_root=release_root,
    )

    assert summary["reusedArtifactCount"] == 0
    assert summary["recomputedArtifactCount"] == 216


@pytest.mark.parametrize(
    ("component", "level", "damage"),
    (
        ("regularVerbose", None, lambda document: document.update(geographies={})),
        ("regularCompact", None, lambda document: document.pop("metricCatalog")),
        ("goals", None, lambda document: document.update(features={})),
        ("mecV2", "national", lambda document: document.pop("classCatalog")),
    ),
)
def test_assembly_rejects_checksum_valid_skeletal_artifacts(
    tmp_path: Path,
    component: str,
    level: str | None,
    damage,
):
    catalog, plan, inventory_path, baseline_root, release_root = _prepare_release(
        tmp_path,
        count=25,
    )
    relative = _local_relative_path(component, "solution-000", level)
    source = baseline_root / relative
    document = json.loads(source.read_text(encoding="utf-8"))
    damage(document)
    source.write_text(json.dumps(document), encoding="utf-8")

    raw_inventory = json.loads(inventory_path.read_text(encoding="utf-8"))
    record = next(
        item
        for item in raw_inventory["artifacts"]
        if item["component"] == component
        and item["solutionId"] == "solution-000"
        and item["geographyLevel"] == level
    )
    record["sha256"] = sha256_path(source)
    inventory_path.write_text(json.dumps(raw_inventory), encoding="utf-8")

    assert not _document_has_usable_structure(
        document,
        component=component,
        solution_id="solution-000",
        geography_level=level,
    )
    with pytest.raises(SolutionCatalogError, match="structure is incomplete"):
        assemble_release(
            catalog=catalog,
            release_plan=plan,
            baseline_inventory_path=inventory_path,
            baseline_root=baseline_root,
            release_root=release_root,
        )
