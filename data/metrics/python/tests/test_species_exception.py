from __future__ import annotations

import json
from pathlib import Path

import pytest

from metrics_contract import catalog_signature, generation_config
from species_data import SpeciesRecord
from species_exception import SpeciesExceptionError, load_species_exception


CONTRACT_PATH = (
    Path(__file__).parents[2]
    / "release-specs"
    / "solutions-v0-1-0-20260804"
    / "species-exception.json"
)
V020_CONTRACT_PATH = (
    Path(__file__).parents[2]
    / "release-specs"
    / "solutions-v0-2-0-20260805"
    / "species-exception.json"
)


def _records() -> list[SpeciesRecord]:
    records = [
        SpeciesRecord(
            scientific_name=f"Species {index}",
            csv_class="Magnoliopsida",
            iucn_status="NA",
            range_km2=float(index),
            bucket="plants",
            threatened=False,
        )
        for index in range(8298)
    ]
    records.extend(
        [
            SpeciesRecord(
                scientific_name="Hypericum strictum",
                csv_class="Magnoliopsida",
                iucn_status="NA",
                range_km2=33968.78813552595,
                bucket="plants",
                threatened=False,
            ),
            SpeciesRecord(
                scientific_name="Paradrymonia ciliosa",
                csv_class="Magnoliopsida",
                iucn_status="NA",
                range_km2=407368.6744619733,
                bucket="plants",
                threatened=False,
            ),
        ]
    )
    return records


def test_v010_policy_excludes_only_two_exact_metadata_records():
    policy = load_species_exception(
        CONTRACT_PATH,
        release_id="solutions-v0-1-0-20260804",
        catalog_version="0.1.0",
    )

    available = policy.filter_available(_records())

    assert len(available) == 8298
    assert policy.binding["catalogTotal"] == 8300
    assert policy.binding["excluded"] == 2
    assert set(policy.excluded_filenames) == {
        "Hypericum_strictum_10_MAXENT.tif",
        "Paradrymonia_ciliosa_10_MAXENT.tif",
    }


def test_v021_policy_carries_exact_exception_with_fail_closed_continuation():
    policy = load_species_exception(
        V020_CONTRACT_PATH,
        release_id="solutions-v0-2-0-20260805",
        catalog_version="0.2.1",
    )

    assert len(policy.filter_available(_records())) == 8298
    assert policy.excluded_filenames == (
        "Hypericum_strictum_10_MAXENT.tif",
        "Paradrymonia_ciliosa_10_MAXENT.tif",
    )
    assert policy.document["patchResolution"] == {
        "authoritativeChecksumsRequired": True,
        "authoritativeReceiptStatus": "not_received",
        "continuationCatalogVersion": "0.2.1",
        "fallbackInvalidation": "all_species_derived_metrics_and_signatures",
        "invalidationScope": "affected_species_derived_metrics_and_signatures_when_safe",
        "required": True,
        "timing": "first_subsequent_patch_release_after_authoritative_receipt",
        "wildcardSkipAllowed": False,
    }


def test_species_exception_rejects_wildcard_patch_skip(tmp_path: Path):
    policy = load_species_exception(V020_CONTRACT_PATH)
    tampered = json.loads(json.dumps(policy.document))
    tampered["patchResolution"]["wildcardSkipAllowed"] = True
    path = tmp_path / "wildcard.json"
    path.write_text(json.dumps(tampered), encoding="utf-8")

    with pytest.raises(SpeciesExceptionError, match="fail-closed"):
        load_species_exception(path)


def test_policy_tampering_is_rejected_by_catalog_binding(tmp_path: Path):
    policy = load_species_exception(CONTRACT_PATH)
    tampered = policy.document | {"reason": "temporary"}
    path = tmp_path / "tampered.json"
    path.write_text(json.dumps(tampered), encoding="utf-8")

    with pytest.raises(SpeciesExceptionError, match="upstream_source_missing"):
        load_species_exception(path)


def test_unapproved_third_species_is_not_excluded():
    policy = load_species_exception(CONTRACT_PATH)
    available = policy.filter_available(_records())

    assert any(record.blob_filename == "Species_0_10_MAXENT.tif" for record in available)


def test_v020_resolution_invalidates_species_contract_signature():
    policy = load_species_exception(CONTRACT_PATH)
    v010 = generation_config(
        "land",
        species_csv_url="species.csv",
        species_exception_binding=policy.binding,
    )
    v020 = generation_config(
        "land",
        species_csv_url="species.csv",
        species_exception_binding=None,
    )

    assert catalog_signature("land", v010) != catalog_signature("land", v020)
    assert v010["speciesException"]["policySha256"] == policy.sha256
    assert v020["speciesException"] is None
