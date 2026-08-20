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
