from species_data import resolve_solution_species_target_percent


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
