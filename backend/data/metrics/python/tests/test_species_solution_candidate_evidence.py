import json

from validation.species_solution_candidate_evidence import (
    build_evidence,
    compare_candidate_outputs,
)


def _write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value), encoding="utf-8")


def _metrics_document(mode, *, status="ready", details=None):
    return {
        "solutionId": "solution-a",
        "generatedAt": f"{mode}-runtime",
        "solutionInputSignature": {
            "format": "solution-input-signature-v3",
            "sha256": mode,
            "catalogBinding": {"releaseId": "fixture-release"},
        },
        "metricsProvenance": {
            "catalogSignature": f"metrics-catalog-v4:{mode}",
            "generationConfig": {
                "speciesExecution": {"effectiveMode": mode},
                "boundaryFanout": {"effectiveMode": "grouped"},
            },
        },
        "speciesCompleteness": {"expected": 8298, "processed": 8298},
        "geographies": {
            "national": {
                "colombia": {
                    "metrics": [
                        {
                            "metricId": "species-richness",
                            "value": 10,
                            "status": status,
                            "details": details,
                        }
                    ]
                }
            }
        },
    }


def _candidate_tree(root, mode, *, status="ready", details=None):
    _write_json(
        root / "publish-report.json",
        {"entries": [{"solutionId": "solution-a"}]},
    )
    _write_json(
        root / "cache" / "solution-a.metrics.json",
        _metrics_document(mode, status=status, details=details),
    )
    _write_json(
        root / "species-goals" / "solution-a" / "national.json",
        {
            "generatedAt": f"{mode}-runtime",
            "solutionId": "solution-a",
            "species": [{"speciesId": "one", "selectedAreaM2": 1.0}],
        },
    )


def test_canonical_candidate_parity_excludes_only_runtime_and_execution_mode(tmp_path):
    independent = tmp_path / "independent"
    microbatch = tmp_path / "microbatch"
    _candidate_tree(independent, "independent", details={"count": 1})
    _candidate_tree(microbatch, "solution-microbatch-v1", details={"count": 1})

    parity = compare_candidate_outputs(independent, microbatch)

    assert parity["outputOrderEqual"]
    assert parity["canonicalDocumentMismatchCount"] == 0
    assert parity["metricStatusMismatchCount"] == 0
    assert parity["metricDetailsMismatchCount"] == 0
    assert parity["speciesCompletenessMismatchCount"] == 0
    assert parity["speciesGoals"]["mismatchCount"] == 0


def test_canonical_candidate_parity_detects_status_details_and_goal_drift(tmp_path):
    independent = tmp_path / "independent"
    microbatch = tmp_path / "microbatch"
    _candidate_tree(independent, "independent", details={"count": 1})
    _candidate_tree(
        microbatch,
        "solution-microbatch-v1",
        status="partial",
        details={"count": 2},
    )
    goal = microbatch / "species-goals" / "solution-a" / "national.json"
    value = json.loads(goal.read_text(encoding="utf-8"))
    value["species"][0]["selectedAreaM2"] = 2.0
    _write_json(goal, value)

    parity = compare_candidate_outputs(independent, microbatch)

    assert parity["canonicalDocumentMismatchCount"] == 1
    assert parity["metricStatusMismatchCount"] == 1
    assert parity["metricDetailsMismatchCount"] == 1
    assert parity["speciesGoals"]["mismatchCount"] == 1


def test_canonical_candidate_parity_detects_unrelated_signature_binding_drift(
    tmp_path,
):
    independent = tmp_path / "independent"
    microbatch = tmp_path / "microbatch"
    _candidate_tree(independent, "independent")
    _candidate_tree(microbatch, "solution-microbatch-v1")
    metrics_path = microbatch / "cache" / "solution-a.metrics.json"
    document = json.loads(metrics_path.read_text(encoding="utf-8"))
    document["solutionInputSignature"]["catalogBinding"]["releaseId"] = "drifted"
    _write_json(metrics_path, document)

    parity = compare_candidate_outputs(independent, microbatch)

    assert parity["canonicalDocumentMismatchCount"] == 1


def test_buffered_v2_evidence_uses_predeclared_accumulator_gate(tmp_path):
    v1 = tmp_path / "v1"
    v2 = tmp_path / "v2"
    _candidate_tree(v1, "solution-microbatch-v1")
    _candidate_tree(v2, "solution-microbatch-buffered-v2")
    for root, accumulator_seconds in ((v1, 3.8518440505332854), (v2, 1.0)):
        _write_json(
            root / "publish-report.json",
            {
                "entries": [
                    {
                        "solutionId": "solution-a",
                        "speciesExecution": {
                            "runtime": {
                                "npzOpens": 1,
                                "npzBytes": 2,
                                "phaseSeconds": {
                                    "exactRead": 1.0,
                                    "evaluation": 2.0,
                                    "accumulator": accumulator_seconds,
                                },
                            }
                        },
                    }
                ]
            },
        )
    v1_log = tmp_path / "v1.log"
    v2_log = tmp_path / "v2.log"
    v1_log.write_text(
        "  1.4824073948024015 real 2.0 user 3.0 sys\n"
        "  100 maximum resident set size\n",
        encoding="utf-8",
    )
    v2_log.write_text(
        "  1.0 real 2.0 user 3.0 sys\n  100 maximum resident set size\n",
        encoding="utf-8",
    )

    evidence = build_evidence(
        independent_root=v1,
        microbatch_root=v2,
        independent_log=v1_log,
        microbatch_log=v2_log,
        candidate_schema="buffered-v2",
    )

    assert evidence["format"] == "species-solution-buffered-full-catalog-candidate-v2"
    assert evidence["accumulatorSpeedup"] == 3.8518440505332854
    assert evidence["endToEndWallSpeedup"] == 1.4824073948024015
    assert evidence["gates"]["accumulatorSpeedupAtLeast1_5x"]
    assert evidence["performanceGate"]["threshold"] == 1.5
    assert "does not move or reinterpret" in evidence["performanceGate"]["rationale"]
