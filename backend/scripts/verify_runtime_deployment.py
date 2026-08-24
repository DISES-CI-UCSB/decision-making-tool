from __future__ import annotations

import argparse
import json
import urllib.request
from typing import Any

DEFAULT_BASE_URL = "https://api.decision-making-support-tool.xyz"
EXPECTED_RELEASE_ID = "solutions-v3-0-0"
EXPECTED_CONTRACT_SHA256 = (
    "b96da51fd75a876885bfe2561ecb930f2d3b4337a1a46e73b6b05f25150f324e"
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Verify the deployed Custom AOI API and V3 Mesa provenance."
    )
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL)
    return parser.parse_args()


def main() -> None:
    base_url = parse_args().base_url.rstrip("/")
    ready = fetch_json(f"{base_url}/ready")
    openapi = fetch_json(f"{base_url}/openapi.json")
    verify_readiness(ready)
    verify_openapi(openapi)
    print(f"Verified V3 Custom AOI deployment at {base_url}.")


def fetch_json(url: str) -> dict[str, Any]:
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "dmt-runtime-deployment-verifier/1.0"},
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        payload = json.load(response)
    if not isinstance(payload, dict):
        raise SystemExit(f"{url} did not return a JSON object.")
    return payload


def verify_readiness(payload: dict[str, Any]) -> None:
    state = payload.get("artifact_state")
    if payload.get("status") != "ready" or not isinstance(state, dict):
        raise SystemExit("Custom AOI backend is not ready.")
    if state.get("required") is not True or state.get("available") is not True:
        raise SystemExit("Production runtime artifacts are not required and available.")
    metadata = state.get("metadata")
    mesa = metadata.get("mesa_coverage") if isinstance(metadata, dict) else None
    contract = mesa.get("contract") if isinstance(mesa, dict) else None
    if not isinstance(contract, dict) or mesa.get("status") != "ready":
        raise SystemExit("Deployed runtime has no ready V3 Mesa coverage bundle.")
    expected = {
        "format": "coverage-parity-contract-v1",
        "release_id": EXPECTED_RELEASE_ID,
        "sha256": EXPECTED_CONTRACT_SHA256,
        "ecosystem_feature_count": 417,
        "species_feature_count": 7_980,
        "golden_master_solution_id": "eco17_estr17_esprep17_runap_iheh2022",
    }
    for key, value in expected.items():
        if contract.get(key) != value:
            raise SystemExit(f"Deployed Mesa contract has invalid {key}.")
    species_index = metadata.get("species_index")
    if (
        not isinstance(species_index, dict)
        or species_index.get("species_count") != 7_980
    ):
        raise SystemExit("Deployed runtime species index does not contain 7,980 species.")


def verify_openapi(payload: dict[str, Any]) -> None:
    components = payload.get("components")
    schemas = components.get("schemas") if isinstance(components, dict) else None
    if not isinstance(schemas, dict):
        raise SystemExit("OpenAPI schemas are missing.")
    ecosystem = schemas.get("EcosystemAreaProfileSection")
    ecosystem_properties = (
        ecosystem.get("properties") if isinstance(ecosystem, dict) else None
    )
    if (
        not isinstance(ecosystem_properties, dict)
        or "solution_coverage" not in ecosystem_properties
    ):
        raise SystemExit("OpenAPI omits Mesa ecosystem solution coverage.")
    species = schemas.get("DetailedSpeciesCoverageRecord")
    species_properties = species.get("properties") if isinstance(species, dict) else None
    required_species_fields = {
        "total_in_aoi",
        "held_in_aoi",
        "coverage_within_aoi",
        "contribution_to_national_coverage",
        "contribution_to_national_target",
    }
    if (
        not isinstance(species_properties, dict)
        or not required_species_fields <= species_properties.keys()
    ):
        raise SystemExit("OpenAPI omits Mesa detailed-species coverage fields.")


if __name__ == "__main__":
    main()
