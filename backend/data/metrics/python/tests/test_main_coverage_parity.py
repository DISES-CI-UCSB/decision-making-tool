from pathlib import Path

import pytest

import main as pipeline


def test_parity_contract_requires_complete_input_set():
    with pytest.raises(SystemExit):
        pipeline._parse_args(["--coverage-parity-contract", "contract.json"])


def test_parity_contract_accepts_all_bound_inputs():
    args = pipeline._parse_args([
        "--coverage-parity-contract",
        "contract.json",
        "--coverage-parity-summary",
        "summary.csv",
        "--coverage-parity-template",
        "template.tif",
        "--coverage-parity-ecosystem-raster",
        "ecosystems.tif",
        "--coverage-parity-ecosystem-catalog",
        "ecosystems.csv",
        "--coverage-parity-species-matrix",
        "birds.smtx.gz",
    ])

    assert args.coverage_parity_contract == Path("contract.json")
    assert args.coverage_parity_species_matrix == [Path("birds.smtx.gz")]
