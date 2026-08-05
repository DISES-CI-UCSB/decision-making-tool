"""Signed, release-specific exceptions for unavailable species sources."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

from species_data import SpeciesRecord

SPECIES_EXCEPTION_FORMAT = "release-species-exception-v1"
SPECIES_EXCEPTION_BINDING_FORMAT = "release-species-exception-binding-v1"


class SpeciesExceptionError(ValueError):
    """A release species exception is malformed or does not match its metadata."""


def canonical_sha256(value: Any) -> str:
    encoded = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


@dataclass(frozen=True)
class SpeciesExceptionPolicy:
    document: dict[str, Any]
    source_path: Path

    @property
    def sha256(self) -> str:
        return canonical_sha256(self.document)

    @property
    def release_id(self) -> str:
        return str(self.document["releaseId"])

    @property
    def catalog_version(self) -> str:
        return str(self.document["catalogVersion"])

    @property
    def excluded_filenames(self) -> tuple[str, ...]:
        return tuple(entry["filename"] for entry in self.document["excludedSpecies"])

    @property
    def binding(self) -> dict[str, Any]:
        inventory = self.document["inventory"]
        return {
            "format": SPECIES_EXCEPTION_BINDING_FORMAT,
            "policyFormat": SPECIES_EXCEPTION_FORMAT,
            "policyId": self.document["policyId"],
            "policySha256": self.sha256,
            "catalogTotal": inventory["catalogTotal"],
            "availableExpected": inventory["availableExpected"],
            "excluded": inventory["excluded"],
        }

    def filter_available(self, records: Iterable[SpeciesRecord]) -> list[SpeciesRecord]:
        records = list(records)
        by_filename = {record.blob_filename: record for record in records}
        inventory = self.document["inventory"]
        if len(records) != inventory["catalogTotal"]:
            raise SpeciesExceptionError(
                "species metadata catalog count does not match the signed exception."
            )
        for entry in self.document["excludedSpecies"]:
            record = by_filename.get(entry["filename"])
            if record is None:
                raise SpeciesExceptionError(
                    f"approved species {entry['filename']!r} is absent from metadata."
                )
            if (
                record.scientific_name != entry["scientificName"]
                or record.csv_class != entry["metadata"]["class"]
                or record.iucn_status != entry["metadata"]["iucnStatus"]
                or record.range_km2 != entry["metadata"]["rangeKm2"]
            ):
                raise SpeciesExceptionError(
                    f"metadata drift for approved species {entry['filename']!r}."
                )
        available = [
            record for record in records if record.blob_filename not in self.excluded_filenames
        ]
        if len(available) != inventory["availableExpected"]:
            raise SpeciesExceptionError(
                "available species count does not match the signed exception."
            )
        return available


def load_species_exception(
    path: Path,
    *,
    release_id: str | None = None,
    catalog_version: str | None = None,
) -> SpeciesExceptionPolicy:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SpeciesExceptionError(
            f"could not read species exception contract {path}: {exc}"
        ) from exc
    if not isinstance(raw, dict) or raw.get("format") != SPECIES_EXCEPTION_FORMAT:
        raise SpeciesExceptionError(
            f"species exception format must be {SPECIES_EXCEPTION_FORMAT!r}."
        )
    if release_id is not None and raw.get("releaseId") != release_id:
        raise SpeciesExceptionError("species exception releaseId does not match.")
    if catalog_version is not None and raw.get("catalogVersion") != catalog_version:
        raise SpeciesExceptionError("species exception catalogVersion does not match.")
    if raw.get("reason") != "upstream_source_missing":
        raise SpeciesExceptionError(
            "species exception reason must be 'upstream_source_missing'."
        )
    approval = raw.get("approval")
    resolution = raw.get("patchResolution")
    if not isinstance(approval, dict) or approval.get("approved") is not True:
        raise SpeciesExceptionError("species exception lacks explicit approval.")
    if not isinstance(resolution, dict) or resolution != {
        "authoritativeChecksumsRequired": True,
        "expectedPatchCatalogVersion": "0.2.1",
        "fallbackInvalidation": "all_species_derived_metrics_and_signatures",
        "invalidationScope": "affected_species_derived_metrics_and_signatures_when_safe",
        "required": True,
        "timing": "first_subsequent_patch_release_after_authoritative_receipt",
        "wildcardSkipAllowed": False,
    }:
        raise SpeciesExceptionError(
            "species exception lacks the fail-closed first-patch resolution policy."
        )
    inventory = raw.get("inventory")
    if inventory != {
        "catalogTotal": 8300,
        "availableExpected": 8298,
        "excluded": 2,
    }:
        raise SpeciesExceptionError("species exception inventory counts are invalid.")
    entries = raw.get("excludedSpecies")
    if not isinstance(entries, list) or len(entries) != inventory["excluded"]:
        raise SpeciesExceptionError(
            "species exception entries do not match the excluded count."
        )
    filenames: list[str] = []
    for index, entry in enumerate(entries):
        if not isinstance(entry, dict):
            raise SpeciesExceptionError(f"excludedSpecies[{index}] must be an object.")
        filename = entry.get("filename")
        metadata = entry.get("metadata")
        if (
            not isinstance(filename, str)
            or not filename.endswith("_10_MAXENT.tif")
            or not isinstance(entry.get("scientificName"), str)
            or not isinstance(entry.get("metadataCsvRow"), int)
            or not isinstance(metadata, dict)
            or not isinstance(metadata.get("rangeKm2"), (int, float))
        ):
            raise SpeciesExceptionError(
                f"excludedSpecies[{index}] metadata is incomplete."
            )
        filenames.append(filename)
    if filenames != sorted(filenames) or len(filenames) != len(set(filenames)):
        raise SpeciesExceptionError(
            "excluded species filenames must be unique and lexically sorted."
        )
    return SpeciesExceptionPolicy(document=raw, source_path=path.resolve())
