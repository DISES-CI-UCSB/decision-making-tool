import json
from pathlib import Path

import pytest

from coverage_parity_contract import (
    CoverageParityContractError,
    load_coverage_parity_contract,
)


CONTRACT_PATH = (
    Path(__file__).resolve().parents[2]
    / "release-specs/solutions-v3-0-0/coverage-parity-contract.json"
)


def test_v3_coverage_parity_contract_is_complete():
    contract = load_coverage_parity_contract(CONTRACT_PATH)

    assert contract.release_id == "solutions-v3-0-0"
    assert contract.solution_id == "eco17_estr17_esprep17_runap_iheh2022"
    assert contract.ecosystem_feature_count == 417
    assert contract.species_feature_count == 7_980
    assert len(contract.summary_sha256) == 64


def test_parity_contract_fails_closed_on_wrong_format(tmp_path: Path):
    path = tmp_path / "contract.json"
    path.write_text('{"format":"unknown"}', encoding="utf-8")

    with pytest.raises(CoverageParityContractError, match="format"):
        load_coverage_parity_contract(path)


def test_regional_parity_contract_accepts_region_specific_inventories(tmp_path: Path):
    document = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))
    document["scientificAuthority"]["speciesUniversePolicy"] = "regional-summary"
    document["scientificAuthority"]["regionId"] = "orinoquia"
    document["ecosystems"]["featureCount"] = 93
    document["species"]["summaryFeatureCount"] = 8_129
    path = tmp_path / "regional-contract.json"
    path.write_text(json.dumps(document), encoding="utf-8")

    contract = load_coverage_parity_contract(path)

    assert contract.ecosystem_feature_count == 93
    assert contract.species_feature_count == 8_129
