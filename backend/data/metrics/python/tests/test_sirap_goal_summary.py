import hashlib

import pytest
from goal_summary import build_goal_summary

HEADER = (
    "feature,met,total_amount,absolute_target,absolute_held,absolute_shortfall,"
    "relative_target,relative_held,relative_shortfall,scenario,evaluated,"
    "total_amount_km2,absolute_held_km2,feature_type,class"
)


def _solution(tmp_path, *, solution_id, name, region_id, rows):
    summary = tmp_path / f"{solution_id}.csv"
    summary.write_text("\n".join([HEADER, *rows]) + "\n", encoding="utf-8")
    return {
        "id": solution_id,
        "name": name,
        "sirapId": region_id,
        "regionalInputPacket": {
            "authoritativeSummary": {
                "url": summary.as_uri(),
                "sha256": hashlib.sha256(summary.read_bytes()).hexdigest(),
                "schema": "prioritizr-summary-v1",
            }
        },
    }


def test_eje_goal_summary_preserves_selected_context_and_solver_rows(tmp_path):
    scenario = "Estr17+Bs100+HuEC70+RUNAP_IHEH2022"
    solution = _solution(
        tmp_path,
        solution_id="eje-cafetero-test",
        name=scenario,
        region_id="eje-cafetero",
        rows=[
            f"paramos,TRUE,100,17,52,0,0.17,0.52,0,{scenario},prioritizr_model,9,4.68,strategic ecosystem,NA",
            f"humedales,TRUE,100,17,17,0,0.17,0.17,0,{scenario},prioritizr_model,9,1.53,strategic ecosystem,NA",
            f"bosque seco,TRUE,100,100,100,0,1,1,0,{scenario},prioritizr_model,9,9,NA,NA",
            f"EC wetlands,FALSE,100,70,65,5,0.7,0.65,0.05,{scenario},prioritizr_model,9,5.85,NA,NA",
            f"Generic wetland,NA,100,NA,80,NA,NA,0.8,NA,{scenario},post-hoc,9,7.2,ecosystem,NA",
        ],
    )

    document = build_goal_summary(solution, "2026-08-31T00:00:00Z")

    assert (
        document["source"]["summaryCsvSha256"]
        == solution["regionalInputPacket"]["authoritativeSummary"]["sha256"]
    )
    assert document["targetContext"]["targetFeatureIds"] == [
        "strategic-ecosystems",
        "dry-forest",
        "eje-wetlands",
    ]
    strategic, dry_forest, wetlands = document["regionalTargetGroups"]
    assert [feature["featureId"] for feature in strategic["features"]] == [
        "paramos",
        "humedales",
    ]
    assert dry_forest["targetPercent"] == 100
    assert dry_forest["targetMode"] == "separate"
    wetland_feature = wetlands["features"][0]
    assert wetland_feature["absoluteTarget"] == 70
    assert wetland_feature["absoluteHeld"] == 65
    assert wetland_feature["absoluteShortfall"] == 5
    assert wetland_feature["relativeTarget"] == 0.7
    assert wetland_feature["relativeHeld"] == 0.65
    assert wetland_feature["relativeShortfall"] == 0.05
    assert wetland_feature["met"] is False
    assert all(
        feature["evaluationSource"] == "prioritizr_model"
        for group in document["regionalTargetGroups"]
        for feature in group["features"]
    )
    assert "generic-wetland" not in {
        feature["featureId"] for feature in document["features"]["strategicEcosystems"]
    }


def test_eje_dry_forest_inherits_strategic_target(tmp_path):
    scenario = "Estr30+HuEC100+RUNAP_IHEH2022"
    solution = _solution(
        tmp_path,
        solution_id="eje-cafetero-inherited",
        name=scenario,
        region_id="eje-cafetero",
        rows=[
            f"paramos,TRUE,100,30,52,0,0.3,0.52,0,{scenario},prioritizr_model,9,4.68,strategic ecosystem,NA",
            f"humedales,TRUE,100,30,31,0,0.3,0.31,0,{scenario},prioritizr_model,9,2.79,strategic ecosystem,NA",
            f"bosque_seco,TRUE,100,30,30,0,0.3,0.3,0,{scenario},prioritizr_model,9,2.7,strategic ecosystem,NA",
            f"EC wetlands,TRUE,100,100,100,0,1,1,0,{scenario},prioritizr_model,9,9,NA,NA",
        ],
    )

    document = build_goal_summary(solution, "2026-08-31T00:00:00Z")
    dry_forest = document["regionalTargetGroups"][1]

    assert dry_forest["targetMode"] == "inherits-strategic"
    assert dry_forest["targetPercent"] == 30
    assert dry_forest["features"][0]["relativeTarget"] == 0.3


def test_orinoquia_goal_summary_keeps_congriales_pairing_and_savanna_target(tmp_path):
    scenario = "Estr17+Cong17+Sab30+RUNAP_IHEH2022"
    solution = _solution(
        tmp_path,
        solution_id="orinoquia-test",
        name=scenario,
        region_id="orinoquia",
        rows=[
            f"paramos,TRUE,100,17,52,0,0.17,0.52,0,{scenario},prioritizr_model,25,13,strategic ecosystem,NA",
            f"bosque_seco,TRUE,100,17,17,0,0.17,0.17,0,{scenario},prioritizr_model,25,4.25,strategic ecosystem,NA",
            f"humedales,TRUE,100,17,23,0,0.17,0.23,0,{scenario},prioritizr_model,25,5.75,strategic ecosystem,NA",
            f"congriales,TRUE,100,17,65,0,0.17,0.65,0,{scenario},prioritizr_model,25,16.25,NA,NA",
            f"savannas,FALSE,100,30,29,1,0.3,0.29,0.01,{scenario},prioritizr_model,25,7.25,NA,NA",
        ],
    )

    document = build_goal_summary(solution, "2026-08-31T00:00:00Z")
    strategic, congriales, savannas = document["regionalTargetGroups"]

    assert len(strategic["features"]) == 3
    assert congriales["targetMode"] == "paired-with-strategic"
    assert congriales["targetPercent"] == strategic["targetPercent"] == 17
    assert congriales["features"][0]["featureName"] == "congriales"
    assert savannas["targetPercent"] == 30
    assert savannas["features"][0]["relativeShortfall"] == 0.01


def test_goal_summary_rejects_selected_target_without_authoritative_row(tmp_path):
    scenario = "Estr17+Cong17+Sab17+RUNAP_IHEH2022"
    solution = _solution(
        tmp_path,
        solution_id="orinoquia-missing-congriales",
        name=scenario,
        region_id="orinoquia",
        rows=[
            f"paramos,TRUE,100,17,17,0,0.17,0.17,0,{scenario},prioritizr_model,25,4.25,strategic ecosystem,NA",
            f"congriales,NA,100,NA,65,NA,NA,0.65,NA,{scenario},post-hoc,25,16.25,ecosystem,NA",
            f"savannas,TRUE,100,17,17,0,0.17,0.17,0,{scenario},prioritizr_model,25,4.25,NA,NA",
        ],
    )

    with pytest.raises(ValueError, match="lacks target rows for congriales"):
        build_goal_summary(solution, "2026-08-31T00:00:00Z")
