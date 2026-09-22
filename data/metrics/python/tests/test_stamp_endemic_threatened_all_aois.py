from __future__ import annotations

import json
from pathlib import Path

import pytest

from backfill_threatened_species_secured import (
    EXPECTED_UNTARGETED_LAND_COUNT,
    GOLD_ID,
    SECURED_METRIC_ID,
    assert_regular_cache_dirs,
    assert_untargeted_land_selection,
    catalog_policy_kind,
    document_exception_binding,
    resolve_policy_kind,
    select_untargeted_land_ids,
    stamp_document,
    validate_dual_reference_secured,
    _threatened_rows,
)
from metrics_contract import PROVENANCE_KEY
from species_goals import (
    CATALOG_ROW_LAYOUT,
    COMPACT_ROW_LAYOUT,
    FLAG_MET_17,
    FLAG_MET_30,
)
from species_target_policy import TARGET_POLICY_SOURCE


def _structured_solution(
    *,
    solution_id: str = "eco17_estr17_runap_iheh2022",
    domain: str = "land",
    feature_set: str | None = "strategic_ecosystems",
    species_representation: list[dict] | None = None,
    esp_rn: list[dict] | None = None,
) -> dict:
    return {
        "id": solution_id,
        "domain": domain,
        "finderInputs": {
            "targetFeatureSet": feature_set,
            "targetPercent": None,
            "structuredTargets": {
                "format": "solution-target-metadata-v1",
                "sourceEvaluation": "final_summary_csv",
                "ecosystems": [],
                "strategicEcosystems": [],
                "ecosystemServices": [],
                "speciesRepresentation": species_representation or [],
                "espRn": esp_rn or [],
            },
        },
    }


def _document(
    *,
    solution_id: str = "eco17_estr17_runap_iheh2022",
    domain: str = "land",
    extra_metric: dict | None = None,
    policy_kind: str | None = None,
) -> dict:
    metrics = [
        {
            "metricId": "threatened_species_count",
            "value": 3,
            "unit": "count",
            "status": "ready",
            "source": "test",
            "notes": "count",
            "labelKey": "metrics.tier1.threatened_species_count",
            "formatHint": "number",
        },
        {
            "metricId": SECURED_METRIC_ID,
            "value": 0,
            "unit": "count",
            "status": "ready",
            "source": "csv:biomod_spp_ranges_updatedIUCN+species-goals",
            "notes": "configured",
            "labelKey": "metrics.tier1.threatened_species_secured",
            "formatHint": "number",
            "details": {"speciesException": {"policyId": "demo"}},
        },
        {
            "metricId": "endemic_species_count",
            "value": 9,
            "unit": "count",
            "status": "ready",
            "source": "test",
            "notes": "endemic",
            "labelKey": "metrics.tier1.endemic_species_count",
            "formatHint": "number",
        },
    ]
    if extra_metric:
        metrics.append(extra_metric)
    provenance = {
        "schemaVersion": 4,
        "solutionDomain": domain,
        "generationConfig": {"nationalOnly": False, "regionalPacket": False},
        "catalogSignature": "metrics-catalog-v4:" + "a" * 64,
    }
    if policy_kind:
        provenance["speciesTargetPolicy"] = {"kind": policy_kind}
    return {
        "solutionId": solution_id,
        "generatedAt": "2026-09-12T00:00:00Z",
        PROVENANCE_KEY: provenance,
        "geographies": {
            "national": {
                "colombia": {
                    "name": "Colombia",
                    "scopeState": {
                        "classification": "supported",
                        "solutionValidCellCount": 4,
                    },
                    "metrics": metrics,
                }
            }
        },
    }


def _write_goals(root: Path, solution_id: str) -> Path:
    catalog_dir = root / "species-goals" / "catalog" / "v1"
    catalog_dir.mkdir(parents=True)
    catalog = {
        "format": "species-goals-catalog-v1",
        "rowLayout": list(CATALOG_ROW_LAYOUT),
        "rows": [
            ["alpha_beta", "Alpha beta", "birds", "VU", 10.0, "available"],
            ["gamma_delta", "Gamma delta", "birds", "EN", 8.0, "available"],
            ["safe_bird", "Safe bird", "birds", "LC", 5.0, "available"],
        ],
    }
    (catalog_dir / "catalog.json").write_text(json.dumps(catalog), encoding="utf-8")
    compact_root = root / "species-goals" / "compact" / "v1" / solution_id
    compact_root.mkdir(parents=True)
    national = {
        "format": "species-goals-compact-v1",
        "solutionId": solution_id,
        "geographyLevel": "national",
        "rowLayout": list(COMPACT_ROW_LAYOUT),
        "scopeCatalog": [["colombia", "Colombia"]],
        "rows": [
            [0, 0, 10.0, 2.5, 0.0, 2.5, None, FLAG_MET_17 | FLAG_MET_30],
            [0, 1, 8.0, 1.0, 0.0, 1.0, None, FLAG_MET_17],
            [0, 2, 5.0, 4.0, 0.0, 4.0, None, FLAG_MET_17 | FLAG_MET_30],
        ],
    }
    (compact_root / "national.species-goals.compact.json").write_text(
        json.dumps(national),
        encoding="utf-8",
    )
    return root


def test_missing_provenance_uses_catalog_structured_targets():
    document = _document()
    catalog_solution = _structured_solution()

    assert resolve_policy_kind(document, catalog_solution) == "dual_reference"
    assert catalog_policy_kind(catalog_solution) == "dual_reference"


def test_missing_catalog_fails_closed_instead_of_scalar():
    with pytest.raises(ValueError, match="without catalog finderInputs"):
        resolve_policy_kind(_document(), None)


def test_dual_reference_rows_use_target_percent_and_manifest_source():
    rows = _threatened_rows(
        domain="land",
        empty_scope=False,
        counts={
            "threatened_present": 2,
            "threatened_secured": 0,
            "threatened_17": 2,
            "threatened_30": 1,
        },
        policy_kind="dual_reference",
        exception_binding=None,
    )
    secured = next(row for row in rows if row["metricId"] == SECURED_METRIC_ID)

    assert secured["status"] == "partial"
    assert secured["value"] is None
    assert secured["source"] == TARGET_POLICY_SOURCE
    assert secured["details"] == {
        "thresholdOutcomes": [
            {"targetPercent": 17.0, "value": 2},
            {"targetPercent": 30.0, "value": 1},
        ]
    }
    assert "speciesException" not in secured["details"]
    assert all("thresholdPercent" not in item for item in secured["details"]["thresholdOutcomes"])


def test_dual_reference_rows_emit_species_exception_only_when_bound():
    rows = _threatened_rows(
        domain="land",
        empty_scope=False,
        counts={
            "threatened_present": 2,
            "threatened_secured": 0,
            "threatened_17": 2,
            "threatened_30": 1,
        },
        policy_kind="dual_reference",
        exception_binding={"policyId": "demo", "excluded": 2},
    )
    secured = next(row for row in rows if row["metricId"] == SECURED_METRIC_ID)

    assert secured["details"]["speciesException"] == {"policyId": "demo", "excluded": 2}
    assert secured["details"]["thresholdOutcomes"][0]["targetPercent"] == 17.0


def test_select_untargeted_refuses_marine_gold_and_species_targets():
    catalog = {
        "eco17_estr17_runap_iheh2022": _structured_solution(),
        GOLD_ID: _structured_solution(solution_id=GOLD_ID),
        "marine_ecos30_mang30_runap_hhm": _structured_solution(
            solution_id="marine_ecos30_mang30_runap_hhm",
            domain="marine",
        ),
        "eco17_estr17_esprep17_runap_iheh2022": _structured_solution(
            solution_id="eco17_estr17_esprep17_runap_iheh2022",
            feature_set="species",
            species_representation=[{"featureId": "alpha_beta", "targetPercent": 17}],
        ),
    }
    discovered = list(catalog)

    with pytest.raises(ValueError, match="Expected 24"):
        select_untargeted_land_ids(discovered, catalog)

    too_few = [f"eco17_runap_{index:02d}" for index in range(EXPECTED_UNTARGETED_LAND_COUNT - 1)]
    with pytest.raises(ValueError, match="Expected 24"):
        assert_untargeted_land_selection(too_few, {sid: _structured_solution(solution_id=sid) for sid in too_few})

    with pytest.raises(ValueError, match="gold"):
        assert_untargeted_land_selection(
            [GOLD_ID] + [f"eco17_runap_{index:02d}" for index in range(23)],
            {
                GOLD_ID: catalog[GOLD_ID],
                **{
                    f"eco17_runap_{index:02d}": _structured_solution(
                        solution_id=f"eco17_runap_{index:02d}"
                    )
                    for index in range(23)
                },
            },
        )


def test_regular_cache_guard_rejects_sirap_batch(tmp_path: Path):
    sirap_dir = tmp_path / "sirap-2026-09-09-v7-endemic" / "cache"
    sirap_dir.mkdir(parents=True)
    with pytest.raises(ValueError, match="SIRAP"):
        assert_regular_cache_dirs(sirap_dir)


def test_stamp_secured_only_leaves_other_metrics(tmp_path: Path):
    solution_id = "eco17_estr17_runap_iheh2022"
    goals_root = _write_goals(tmp_path, solution_id)
    extra = {
        "metricId": "species_groups_protected",
        "value": None,
        "unit": "count",
        "status": "derivation_needed",
        "source": "csv:biomod_spp_ranges_updatedIUCN",
        "notes": "skipped",
        "labelKey": "metrics.tier1.species_groups_protected",
        "formatHint": "number",
    }
    document = _document(extra_metric=extra)
    catalog_rows = json.loads(
        (goals_root / "species-goals/catalog/v1/catalog.json").read_text(encoding="utf-8")
    )["rows"]
    threatened_indexes = {
        index
        for index, row in enumerate(catalog_rows)
        if row[3] in {"CR", "EN", "VU"}
    }

    updated = stamp_document(
        document,
        species_goals_root=goals_root,
        scientific_names={0: "Alpha beta", 1: "Gamma delta", 2: "Safe bird"},
        endemic_by_name={"Alpha beta": True},
        threatened_indexes=threatened_indexes,
        release_id="catalog-v3-7-0",
        catalog_solution=_structured_solution(solution_id=solution_id),
        metric_ids={SECURED_METRIC_ID},
    )
    metrics = {
        row["metricId"]: row
        for row in updated["geographies"]["national"]["colombia"]["metrics"]
    }
    secured = metrics[SECURED_METRIC_ID]

    assert metrics["endemic_species_count"]["value"] == 9
    assert metrics["threatened_species_count"]["value"] == 3
    assert metrics["species_groups_protected"] == extra
    assert secured["status"] == "partial"
    assert secured["value"] is None
    assert secured["source"] == TARGET_POLICY_SOURCE
    assert secured["details"] == {
        "thresholdOutcomes": [
            {"targetPercent": 17.0, "value": 2},
            {"targetPercent": 30.0, "value": 1},
        ]
    }
    assert "speciesException" not in secured["details"]
    assert document_exception_binding(updated) is None
    assert validate_dual_reference_secured(updated) == []


def test_stamp_refuses_marine_and_species_targeted_incremental(tmp_path: Path):
    goals_root = _write_goals(tmp_path, "marine_ecos30_mang30_runap_hhm")
    marine = _document(solution_id="marine_ecos30_mang30_runap_hhm", domain="marine")
    targeted = _document(solution_id="eco17_estr17_esprep17_runap_iheh2022")

    with pytest.raises(ValueError, match="marine"):
        stamp_document(
            marine,
            species_goals_root=goals_root,
            scientific_names={},
            endemic_by_name={},
            threatened_indexes=set(),
            release_id="catalog-v3-7-0",
            catalog_solution=_structured_solution(
                solution_id="marine_ecos30_mang30_runap_hhm",
                domain="marine",
            ),
            metric_ids={SECURED_METRIC_ID},
        )
    with pytest.raises(ValueError, match="species-targeted"):
        stamp_document(
            targeted,
            species_goals_root=goals_root,
            scientific_names={},
            endemic_by_name={},
            threatened_indexes=set(),
            release_id="catalog-v3-7-0",
            catalog_solution=_structured_solution(
                solution_id="eco17_estr17_esprep17_runap_iheh2022",
                feature_set="species",
                species_representation=[{"featureId": "alpha_beta", "targetPercent": 17}],
            ),
            metric_ids={SECURED_METRIC_ID},
        )
