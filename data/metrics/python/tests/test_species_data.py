import pytest
from species_data import SpeciesRecord, resolve_solution_species_target_percent
from species_target_policy import (
    SpeciesTargetPolicyError,
    resolve_species_target_policy,
)


def _record(name: str) -> SpeciesRecord:
    return SpeciesRecord(
        scientific_name=name,
        csv_class="Aves",
        iucn_status="EN",
        range_km2=1.0,
        bucket="birds",
        threatened=True,
    )


def _structured_solution(
    *,
    feature_set: str | None,
    species_representation: list[dict] | None = None,
    esp_rn: list[dict] | None = None,
) -> dict:
    return {
        "id": "demo",
        "finderInputs": {
            "targetFeatureSet": feature_set,
            "targetPercent": 17 if species_representation else None,
            "structuredTargets": {
                "format": "solution-target-metadata-v1",
                "sourceEvaluation": "prioritizr_model",
                "ecosystems": [],
                "strategicEcosystems": [],
                "ecosystemServices": [],
                "speciesRepresentation": species_representation or [],
                "espRn": esp_rn or [],
            },
        },
    }


def test_resolves_release_species_target_with_zero_percent_exception_entries():
    solution = {
        "name": "NameWithoutLegacyTargetTokens",
        "finderInputs": {
            "targetFeatureSet": "species",
            "targetPercent": 17,
            "structuredTargets": {
                "speciesRepresentation": [
                    {"featureId": "species_a", "targetPercent": 17},
                    {"featureId": "approved_missing_species", "targetPercent": 0},
                ],
                "espRn": [],
            },
        },
    }

    assert resolve_solution_species_target_percent(solution) == 17.0


def test_structured_species_target_conflict_fails_closed():
    solution = {
        "name": "NameWithoutLegacyTargetTokens",
        "finderInputs": {
            "structuredTargets": {
                "speciesRepresentation": [
                    {"featureId": "species_a", "targetPercent": 17},
                    {"featureId": "species_b", "targetPercent": 30},
                ],
            },
        },
    }

    assert resolve_solution_species_target_percent(solution) is None


def test_species_finder_target_precedes_legacy_name_fallback():
    solution = {
        "name": "Eco17+Estr17+EspRep17+RUNAP+OMEC_IHEH2030",
        "finderInputs": {
            "targetFeatureSet": "species",
            "targetPercent": 17,
        },
    }

    assert resolve_solution_species_target_percent(solution) == 17.0


def test_target_policy_classifies_scalar_per_species_and_dual_reference():
    records = [_record("Alpha beta"), _record("Gamma delta")]
    scalar = resolve_species_target_policy(
        _structured_solution(
            feature_set="species",
            species_representation=[{"featureId": "alpha_beta", "targetPercent": 17}],
        ),
        catalog_records=records,
        available_records=records,
    )
    per_species = resolve_species_target_policy(
        _structured_solution(
            feature_set="esp_rn",
            esp_rn=[
                {"featureId": "alpha_beta", "targetPercent": 12.5},
                {"featureId": "gamma_delta", "targetPercent": 44},
            ],
        ),
        catalog_records=records,
        available_records=records[:1],
    )
    dual_reference = resolve_species_target_policy(
        _structured_solution(feature_set=None),
        catalog_records=records,
        available_records=records,
    )

    assert scalar.kind == "scalar"
    assert scalar.scalar_target_pct == 17
    assert scalar.provenance is None
    assert per_species.kind == "per_species"
    assert per_species.target_for("Alpha beta") == 12.5
    assert per_species.target_for("Gamma delta") is None
    assert per_species.provenance["structuredTargetCount"] == 2
    assert (
        per_species.provenance["matchingInventory"]["excludedMatchedTargetCount"] == 1
    )
    assert dual_reference.kind == "dual_reference"
    assert dual_reference.provenance["structuredTargetCount"] == 0
    assert dual_reference.provenance["referenceThresholds"] == [17, 30]
    assert dual_reference.provenance["decisionSource"] == (
        "approved:dual-reference-species-thresholds-v1"
    )


@pytest.mark.parametrize(
    ("solution", "message"),
    [
        (
            _structured_solution(
                feature_set="esp_rn",
                esp_rn=[
                    {"featureId": "alpha_beta", "targetPercent": 10},
                    {"featureId": "alpha_beta", "targetPercent": 20},
                ],
            ),
            "duplicate",
        ),
        (
            _structured_solution(
                feature_set="esp_rn",
                esp_rn=[{"featureId": "unknown_species", "targetPercent": 10}],
            ),
            "do not bind",
        ),
        (
            _structured_solution(feature_set="esp_rn"),
            "without structured species targets",
        ),
    ],
)
def test_target_policy_rejects_duplicate_missing_and_unbound_targets(
    solution: dict,
    message: str,
):
    records = [_record("Alpha beta")]
    with pytest.raises(SpeciesTargetPolicyError, match=message):
        resolve_species_target_policy(
            solution,
            catalog_records=records,
            available_records=records,
        )
