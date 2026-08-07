"""Pin the solution catalog identity digest so JavaScript cannot silently drift.

The JavaScript promotion tool recomputes this digest in
frontend/layer-manifest/lib/solution-catalog.mjs and compares it against digests Python
baked into immutable published artifacts. Both runtimes assert against the same checked-in
fixture, so a canonicalization change on either side fails here or in
frontend/layer-manifest/lib/solution-catalog-hash-parity.spec.mjs.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from solution_catalog import SolutionCatalogError, load_solution_catalog

PARITY_FIXTURE = (
    Path(__file__).parents[2] / "fixtures/solution-catalog-hash-parity.json"
)
EXPECTED_CASE_NAMES = [
    "null-species-exception",
    "reversed-key-insertion-order",
    "unicode-strings",
    "with-species-exception",
    "without-species-exception",
]


@pytest.fixture(scope="module")
def parity_fixture() -> dict:
    fixture = json.loads(PARITY_FIXTURE.read_text(encoding="utf-8"))
    assert fixture["format"] == "solution-catalog-hash-parity-v1"
    return fixture


def _case(fixture: dict, name: str) -> dict:
    for case in fixture["cases"]:
        if case["name"] == name:
            return case
    raise AssertionError(f"parity fixture is missing the {name!r} case")


def _load(tmp_path: Path, catalog: dict, name: str = "catalog"):
    path = tmp_path / f"{name}.json"
    path.write_text(
        json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return load_solution_catalog(path)


def test_fixture_covers_every_catalog_shape(parity_fixture: dict) -> None:
    names = sorted(case["name"] for case in parity_fixture["cases"])
    assert names == EXPECTED_CASE_NAMES


def test_catalog_digests_match_the_pinned_fixture(
    parity_fixture: dict, tmp_path: Path
) -> None:
    for case in parity_fixture["cases"]:
        catalog = _load(tmp_path, case["catalog"], name=case["name"])
        assert catalog.sha256 == case["expectedSha256"], case["name"]


def test_null_species_exception_hashes_like_an_absent_one(
    parity_fixture: dict,
) -> None:
    assert (
        _case(parity_fixture, "null-species-exception")["expectedSha256"]
        == _case(parity_fixture, "without-species-exception")["expectedSha256"]
    )


def test_key_insertion_order_does_not_change_the_digest(
    parity_fixture: dict,
) -> None:
    reversed_case = _case(parity_fixture, "reversed-key-insertion-order")
    assert list(reversed_case["catalog"]) != sorted(reversed_case["catalog"])
    assert (
        reversed_case["expectedSha256"]
        == _case(parity_fixture, "with-species-exception")["expectedSha256"]
    )


def test_non_ascii_strings_survive_canonicalization(
    parity_fixture: dict, tmp_path: Path
) -> None:
    case = _case(parity_fixture, "unicode-strings")
    basenames = [entry["solutionBasename"] for entry in case["catalog"]["solutions"]]
    assert any(not basename.isascii() for basename in basenames)
    catalog = _load(tmp_path, case["catalog"], name="unicode")
    assert catalog.sha256 == case["expectedSha256"]
    assert any(not entry.solution_basename.isascii() for entry in catalog.solutions)


def test_hashed_document_keys_match_the_declared_contract(
    parity_fixture: dict, tmp_path: Path
) -> None:
    """Growing to_dict() without updating the fixture must fail loudly."""

    contract = parity_fixture["contract"]
    catalog = _load(
        tmp_path, _case(parity_fixture, "with-species-exception")["catalog"], name="contract"
    )
    document = catalog.to_dict()
    assert sorted(document) == contract["catalogKeys"]
    assert sorted(document["solutions"][0]) == contract["solutionEntryKeys"]
    assert sorted(document["speciesException"]) == contract["speciesExceptionKeys"]


def test_unknown_species_exception_keys_are_rejected(
    parity_fixture: dict, tmp_path: Path
) -> None:
    catalog = json.loads(
        json.dumps(_case(parity_fixture, "with-species-exception")["catalog"])
    )
    catalog["speciesException"]["excludedIds"] = ["a", "b"]
    with pytest.raises(SolutionCatalogError, match="speciesException binding"):
        _load(tmp_path, catalog, name="unknown-exception-key")
