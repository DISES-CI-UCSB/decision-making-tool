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
    is_completed_species_reconciliation,
    mark_species_complete,
    resolve_policy_kind,
    select_untargeted_land_ids,
    stamp_document,
    validate_all_species_metrics,
    validate_dual_reference_secured,
    _threatened_rows,
)
from metrics_contract import PROVENANCE_KEY
from metric_definitions import species_metric_ids
from species_goals import (
    CATALOG_ROW_LAYOUT,
    COMPACT_ROW_LAYOUT,
    FLAG_CONFIGURED_TARGET_MET,
    FLAG_MET_17,
    FLAG_MET_30,
    FLAG_TARGET_CONFIGURED,
)
from species_target_policy import TARGET_POLICY_SOURCE


REQUIRED_LAND_SPECIES_METRIC_IDS = (
    "species_groups_protected",
    "threatened_species_secured",
    "species_richness_mammals",
    "species_richness_birds",
    "species_richness_amphibians",
    "species_richness_reptiles",
    "species_richness_plants",
    "threatened_species_count",
    "endemic_species_count",
    "species_pct_of_national",
)


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


def test_reconcile_all_species_metrics_from_sidecars_preserves_other_rows(
    tmp_path: Path,
):
    assert species_metric_ids() == REQUIRED_LAND_SPECIES_METRIC_IDS
    solution_id = "eco17_estr17_runap_iheh2022"
    goals_root = _write_goals(tmp_path, solution_id)
    non_species = {
        "metricId": "selected_area",
        "value": 12.5,
        "unit": "km2",
        "status": "ready",
        "source": "test",
        "notes": "preserve me",
        "labelKey": "metrics.tier1.selected_area",
        "formatHint": "number",
    }
    document = _document(extra_metric=non_species)
    catalog = json.loads(
        (goals_root / "species-goals/catalog/v1/catalog.json").read_text(
            encoding="utf-8"
        )
    )

    updated = stamp_document(
        document,
        species_goals_root=goals_root,
        scientific_names={0: "Alpha beta", 1: "Gamma delta", 2: "Safe bird"},
        endemic_by_name={"Alpha beta": True},
        threatened_indexes={0, 1},
        release_id="catalog-v3-7-0",
        catalog_solution=_structured_solution(solution_id=solution_id),
        metric_ids=set(species_metric_ids()),
        catalog_rows=catalog["rows"],
        available_species_count=3,
    )
    metrics = {
        row["metricId"]: row
        for row in updated["geographies"]["national"]["colombia"]["metrics"]
    }

    assert set(species_metric_ids()).issubset(metrics)
    assert metrics["selected_area"] == non_species
    assert metrics["species_richness_birds"]["value"] == 3
    assert metrics["threatened_species_count"]["value"] == 2
    assert metrics["endemic_species_count"]["value"] == 1
    assert metrics["species_pct_of_national"]["value"] == 100.0
    assert metrics["species_groups_protected"]["status"] == "partial"
    assert metrics["species_groups_protected"]["value"] is None
    assert [
        outcome["targetPercent"]
        for outcome in metrics["species_groups_protected"]["details"][
            "thresholdOutcomes"
        ]
    ] == [17.0, 30.0]
    assert validate_all_species_metrics(updated) == []
    assert updated[PROVENANCE_KEY]["generationConfig"]["speciesSkipped"] is False
    assert updated[PROVENANCE_KEY]["generationConfig"]["speciesBoundaryLevelsSkipped"] == []

    mark_species_complete(
        updated,
        catalog_total=3,
        available_expected=3,
        exception_binding=None,
    )
    assert updated["speciesCompleteness"]["complete"] is True
    assert updated[PROVENANCE_KEY]["speciesCompleteness"]["processed"] == 3
    assert is_completed_species_reconciliation(updated)

    updated["speciesCompleteness"]["complete"] = False
    assert not is_completed_species_reconciliation(updated)


def test_reconcile_all_species_metrics_handles_empty_and_marine_scopes(
    tmp_path: Path,
):
    species_ids = set(species_metric_ids())
    land_id = "eco17_estr17_runap_iheh2022"
    goals_root = _write_goals(tmp_path, land_id)
    catalog = json.loads(
        (goals_root / "species-goals/catalog/v1/catalog.json").read_text(
            encoding="utf-8"
        )
    )
    empty_document = _document(solution_id=land_id)
    empty_document["geographies"]["national"]["colombia"]["scopeState"][
        "solutionValidCellCount"
    ] = 0

    empty = stamp_document(
        empty_document,
        species_goals_root=goals_root,
        scientific_names={},
        endemic_by_name={},
        threatened_indexes={0, 1},
        release_id="catalog-v3-7-0",
        catalog_solution=_structured_solution(solution_id=land_id),
        metric_ids=species_ids,
        catalog_rows=catalog["rows"],
        available_species_count=3,
    )
    empty_rows = [
        row
        for row in empty["geographies"]["national"]["colombia"]["metrics"]
        if row["metricId"] in species_ids
    ]
    assert {row["status"] for row in empty_rows} == {"empty"}

    marine_id = "marine_ecos30_mang30_runap_hhm"
    marine = stamp_document(
        _document(solution_id=marine_id, domain="marine"),
        species_goals_root=goals_root,
        scientific_names={},
        endemic_by_name={},
        threatened_indexes=set(),
        release_id="catalog-v3-7-0",
        catalog_solution=_structured_solution(
            solution_id=marine_id,
            domain="marine",
        ),
        metric_ids=species_ids,
        catalog_rows=catalog["rows"],
        available_species_count=3,
    )
    marine_rows = [
        row
        for row in marine["geographies"]["national"]["colombia"]["metrics"]
        if row["metricId"] in species_ids
    ]
    assert {row["status"] for row in marine_rows} == {"not_applicable"}
    assert validate_all_species_metrics(marine) == []


def test_reconcile_all_species_metrics_supports_configured_targets(tmp_path: Path):
    solution_id = "eco17_estr17_esprep17_runap_iheh2022"
    goals_root = _write_goals(tmp_path, solution_id)
    partition_path = (
        goals_root
        / "species-goals"
        / "compact"
        / "v1"
        / solution_id
        / "national.species-goals.compact.json"
    )
    partition = json.loads(partition_path.read_text(encoding="utf-8"))
    for row in partition["rows"]:
        row[COMPACT_ROW_LAYOUT.index("configuredTargetPercent")] = 17.0
        row[COMPACT_ROW_LAYOUT.index("flags")] |= FLAG_TARGET_CONFIGURED
        row[COMPACT_ROW_LAYOUT.index("flags")] |= FLAG_CONFIGURED_TARGET_MET
    partition_path.write_text(json.dumps(partition), encoding="utf-8")
    catalog = json.loads(
        (goals_root / "species-goals/catalog/v1/catalog.json").read_text(
            encoding="utf-8"
        )
    )

    updated = stamp_document(
        _document(solution_id=solution_id),
        species_goals_root=goals_root,
        scientific_names={0: "Alpha beta", 1: "Gamma delta", 2: "Safe bird"},
        endemic_by_name={"Alpha beta": True},
        threatened_indexes={0, 1},
        release_id="catalog-v3-7-0",
        catalog_solution=_structured_solution(
            solution_id=solution_id,
            feature_set="species",
            species_representation=[
                {"featureId": "alpha_beta", "targetPercent": 17}
            ],
        ),
        metric_ids=set(species_metric_ids()),
        catalog_rows=catalog["rows"],
        available_species_count=3,
    )
    metrics = {
        row["metricId"]: row
        for row in updated["geographies"]["national"]["colombia"]["metrics"]
    }

    assert metrics["species_groups_protected"]["status"] == "ready"
    assert metrics["species_groups_protected"]["value"] == 3
    assert metrics["threatened_species_secured"]["status"] == "ready"
    assert metrics["threatened_species_secured"]["value"] == 2
