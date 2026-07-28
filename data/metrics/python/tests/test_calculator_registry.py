from calculator_registry import (
    categorical_area_calculator,
    overlap_area_calculator,
    overlap_percent_calculator,
    weighted_percent_calculator,
    weighted_sum_calculator,
)
from metric_definitions import computable_metrics


def test_every_layer_metric_has_a_registered_calculator():
    missing: list[str] = []

    for definition in computable_metrics():
        if definition.kind == "binary_overlap_area":
            calculator = overlap_area_calculator(definition.layer_id or "")
        elif definition.kind == "binary_overlap_percent_of_selected":
            calculator = overlap_percent_calculator(definition.layer_id or "")
        elif definition.kind == "categorical_overlap_area":
            calculator = categorical_area_calculator(definition.metric_id)
        elif definition.kind == "weighted_sum":
            calculator = weighted_sum_calculator(definition)
        elif definition.kind == "weighted_percent_of_national":
            calculator = weighted_percent_calculator(definition.layer_id or "")
        else:
            continue

        if calculator is None:
            missing.append(definition.metric_id)

    assert missing == []


def test_metric_specific_weighted_calculators_are_registered():
    weighted_definitions = {
        definition.metric_id: definition
        for definition in computable_metrics()
        if definition.kind == "weighted_sum"
    }

    assert weighted_sum_calculator(weighted_definitions["carbon_storage_biomass"])
    assert weighted_sum_calculator(weighted_definitions["carbon_biomass_total"])
    assert weighted_sum_calculator(weighted_definitions["soil_organic_carbon"])
