import main as pipeline
from metric_definitions import MetricDefinition


def _definition(
    metric_id: str,
    *,
    kind: str,
    layer_id: str | None = None,
) -> MetricDefinition:
    return MetricDefinition(
        metric_id=metric_id,
        metric_number=999,
        label_key=f"metrics.{metric_id}",
        english_label=metric_id,
        spanish_label=metric_id,
        unit="count",
        format_hint="number",
        source_note="Test metric.",
        kind=kind,
        layer_id=layer_id,
    )


def test_exception_requires_partial_species_and_ready_layer_metrics(monkeypatch):
    definitions = (
        _definition("layer_metric", kind="binary_overlap_area", layer_id="layer"),
        _definition("species_metric", kind="species_group_coverage"),
    )
    monkeypatch.setattr(pipeline, "computable_metrics", lambda: definitions)
    geographies = {
        "national": {
            "colombia": {
                "metrics": [
                    {"metricId": "layer_metric", "status": "ready"},
                    {"metricId": "species_metric", "status": "partial"},
                ]
            }
        }
    }

    assert pipeline._has_complete_required_input_metrics(
        geographies,
        domain="land",
        skip_species=False,
        species_exception_binding={"excluded": 2},
    )


def test_required_metric_issues_report_every_exact_failure(monkeypatch):
    definitions = (
        _definition("layer_metric", kind="binary_overlap_area", layer_id="layer"),
        _definition("species_metric", kind="species_threatened_secured"),
    )
    monkeypatch.setattr(pipeline, "computable_metrics", lambda: definitions)
    geographies = {
        "national": {
            "colombia": {
                "metrics": [
                    {
                        "metricId": "layer_metric",
                        "status": "blocked",
                        "notes": "Layer unavailable.",
                    },
                    {
                        "metricId": "species_metric",
                        "status": "derivation_needed",
                        "notes": "Species target unavailable.",
                    },
                ]
            }
        }
    }

    assert pipeline._required_input_metric_issues(
        geographies,
        domain="land",
        skip_species=False,
        species_exception_binding={"excluded": 2},
    ) == [
        {
            "geography": "national/colombia",
            "metricId": "layer_metric",
            "expectedStatus": "ready",
            "actualStatus": "blocked",
            "reason": "Layer unavailable.",
        },
        {
            "geography": "national/colombia",
            "metricId": "species_metric",
            "expectedStatus": "partial",
            "actualStatus": "derivation_needed",
            "reason": "Species target unavailable.",
        },
    ]


def test_dual_reference_policy_requires_target_dependent_metrics_partial(
    monkeypatch,
):
    definitions = (
        _definition("groups", kind="species_group_coverage"),
        _definition("secured", kind="species_threatened_secured"),
        _definition("richness", kind="species_richness"),
    )
    monkeypatch.setattr(pipeline, "computable_metrics", lambda: definitions)
    geographies = {
        "national": {
            "colombia": {
                "metrics": [
                    {"metricId": "groups", "status": "partial"},
                    {"metricId": "secured", "status": "partial"},
                    {"metricId": "richness", "status": "partial"},
                ]
            }
        }
    }

    assert pipeline._has_complete_required_input_metrics(
        geographies,
        domain="land",
        skip_species=False,
        species_exception_binding={"excluded": 2},
        species_target_policy_kind="dual_reference",
    )
