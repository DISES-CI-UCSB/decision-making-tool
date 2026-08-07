from __future__ import annotations

import json
from pathlib import Path

import pytest

from strategic_ecosystem_outcomes import (
    derive_solution_outcomes,
    read_compact_national,
    validate_denominators,
)


FEATURES = [
    {
        "featureId": "paramos",
        "metricId": "ecosystem_coverage_paramo",
        "totalAlignedFeatureValue1AreaKm2": 27401,
    },
    {
        "featureId": "wetlands",
        "metricId": "ecosystem_coverage_wetlands",
        "totalAlignedFeatureValue1AreaKm2": 253986,
    },
    {
        "featureId": "bosque_seco",
        "metricId": "ecosystem_coverage_dry_forest",
        "totalAlignedFeatureValue1AreaKm2": 10135,
    },
    {
        "featureId": "mangroves",
        "metricId": "mangrove_coverage",
        "totalAlignedFeatureValue1AreaKm2": 2702,
    },
]


def _metric(metric_id: str, value: float, source: str, unit: str = "km2") -> dict:
    return {
        "metricId": metric_id,
        "value": value,
        "unit": unit,
        "status": "ready",
        "source": source,
        "notes": "test",
        "labelKey": f"metrics.{metric_id}",
        "formatHint": "number",
    }


def test_derives_ecosystems_only_solution_from_existing_covered_km2():
    outcomes = derive_solution_outcomes(
        [
            _metric("ecosystem_coverage_paramo", 14543, "raster:paramos"),
            _metric("ecosystem_coverage_wetlands", 50912, "raster:wetlands"),
            _metric("ecosystem_coverage_dry_forest", 3025, "raster:bosque_seco"),
            _metric("mangrove_coverage", 1200, "raster:mangroves"),
        ],
        FEATURES,
    )

    assert outcomes["paramos"]["coverageFraction"] == pytest.approx(14543 / 27401)
    assert outcomes["paramos"]["checkpoints"] == {"17": True, "30": True}
    assert outcomes["wetlands"]["coveragePercent"] == pytest.approx(20.045199341696)
    assert outcomes["wetlands"]["checkpoints"] == {"17": True, "30": False}
    assert outcomes["bosque_seco"]["coveragePercent"] == pytest.approx(29.84706462752837)
    assert outcomes["bosque_seco"]["checkpoints"] == {"17": True, "30": False}
    assert outcomes["mangroves"]["coveragePercent"] == pytest.approx(1200 / 2702 * 100)
    assert outcomes["mangroves"]["checkpoints"] == {"17": True, "30": True}


def test_fails_closed_when_covered_area_unit_is_not_km2():
    metrics = [
        _metric("ecosystem_coverage_paramo", 14543, "raster:paramos", unit="ha"),
        _metric("ecosystem_coverage_wetlands", 50912, "raster:wetlands"),
        _metric("ecosystem_coverage_dry_forest", 3025, "raster:bosque_seco"),
        _metric("mangrove_coverage", 1200, "raster:mangroves"),
    ]

    with pytest.raises(ValueError, match="unit must be km2"):
        derive_solution_outcomes(metrics, FEATURES)


def test_reads_only_national_rows_from_compact_document(tmp_path: Path):
    document = {
        "format": "metrics-compact-v1",
        "solutionId": "eco17_runap_iheh2022",
        "generatedAt": "2026-08-05T00:00:00Z",
        "metricCatalog": [
            ["ecosystem_coverage_paramo", "km2", "metrics.paramo", "number"],
        ],
        "statusCatalog": ["ready"],
        "sourceCatalog": ["raster:paramos"],
        "notesCatalog": ["test"],
        "geographies": {
            "national": {
                "colombia": {
                    "metrics": [[0, 14543, 0, 0, 0]],
                }
            },
            "departments": {
                "05": {
                    "metrics": [[0, 100, 0, 0, 0]],
                }
            },
        },
    }
    path = tmp_path / "metrics.compact.json"
    path.write_text(json.dumps(document, separators=(",", ":")), encoding="utf-8")

    solution_id, metrics = read_compact_national(path)

    assert solution_id == "eco17_runap_iheh2022"
    assert metrics == [
        _metric("ecosystem_coverage_paramo", 14543, "raster:paramos")
        | {"labelKey": "metrics.paramo"}
    ]


def test_release_denominator_contract_is_valid():
    repo_root = Path(__file__).resolve().parents[4]
    path = (
        repo_root
        / "data/metrics/release-specs/solutions-v0-2-0-20260805"
        / "strategic-ecosystem-denominators.json"
    )
    spec = json.loads(path.read_text(encoding="utf-8"))

    features = validate_denominators(
        spec,
        release_id="solutions-v0-2-0-20260805",
    )

    assert {
        feature["featureId"]: feature["totalAlignedFeatureValue1AreaKm2"]
        for feature in features
    } == {
        "paramos": 27401,
        "wetlands": 253986,
        "bosque_seco": 10135,
        "mangroves": 2702,
    }
