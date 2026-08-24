from __future__ import annotations

import pytest

from scripts.verify_runtime_deployment import (
    EXPECTED_CONTRACT_SHA256,
    verify_openapi,
    verify_readiness,
)


def test_deployment_verifier_accepts_v3_readiness_and_openapi() -> None:
    verify_readiness(
        {
            "status": "ready",
            "artifact_state": {
                "required": True,
                "available": True,
                "metadata": {
                    "species_index": {"species_count": 7_980},
                    "mesa_coverage": {
                        "status": "ready",
                        "contract": {
                            "format": "coverage-parity-contract-v1",
                            "release_id": "solutions-v3-0-0",
                            "sha256": EXPECTED_CONTRACT_SHA256,
                            "ecosystem_feature_count": 417,
                            "species_feature_count": 7_980,
                            "golden_master_solution_id": (
                                "eco17_estr17_esprep17_runap_iheh2022"
                            ),
                        },
                    }
                },
            },
        }
    )
    verify_openapi(
        {
            "components": {
                "schemas": {
                    "EcosystemAreaProfileSection": {
                        "properties": {"solution_coverage": {}}
                    },
                    "DetailedSpeciesCoverageRecord": {
                        "properties": {
                            "total_in_aoi": {},
                            "held_in_aoi": {},
                            "coverage_within_aoi": {},
                            "contribution_to_national_coverage": {},
                            "contribution_to_national_target": {},
                        }
                    },
                }
            }
        }
    )


def test_deployment_verifier_rejects_missing_mesa_runtime() -> None:
    with pytest.raises(SystemExit, match="no ready V3 Mesa"):
        verify_readiness(
            {
                "status": "ready",
                "artifact_state": {
                    "required": True,
                    "available": True,
                    "metadata": {},
                },
            }
        )
