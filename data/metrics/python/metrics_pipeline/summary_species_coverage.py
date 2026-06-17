"""Species-group target coverage from per-solution summary CSVs."""

from __future__ import annotations

import csv
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from species_data import SpeciesRecord

IUCN_STATUS_ORDER: tuple[str, ...] = ("CR", "EN", "VU", "NT", "LC", "DD", "other", "unknown")

_CLASS_TO_GROUP: dict[str, str] = {
    "mammalia": "mammals",
    "aves": "birds",
    "amphibia": "amphibians",
    "squamata": "reptiles",
    "crocodylia": "reptiles",
    "magnoliopsida": "plants",
    "magnoliospida": "plants",
}

_GROUP_LABELS: dict[str, str] = {
    "mammals": "Mammals",
    "birds": "Birds",
    "amphibians": "Amphibians",
    "reptiles": "Reptiles",
    "plants": "Plants",
}


@dataclass
class _Count:
    met: int = 0
    total: int = 0

    def record(self, met: bool) -> None:
        self.total += 1
        if met:
            self.met += 1

    def as_dict(self) -> dict[str, int]:
        return {
            "metSpeciesCount": self.met,
            "totalSpeciesCount": self.total,
        }


@dataclass
class _GroupCount:
    total: _Count = field(default_factory=_Count)
    by_status: dict[str, _Count] = field(
        default_factory=lambda: {status: _Count() for status in IUCN_STATUS_ORDER}
    )

    def record(self, met: bool, iucn_status: str) -> None:
        self.total.record(met)
        self.by_status[iucn_status].record(met)


def normalize_summary_class(class_name: str) -> str | None:
    """Map summary CSV taxonomic classes onto existing species bucket names."""
    return _CLASS_TO_GROUP.get(class_name.strip().lower())


def species_lookup_by_name(records: list[SpeciesRecord]) -> dict[str, SpeciesRecord]:
    """Build a lookup keyed like summary CSV feature names."""
    return {_normalize_species_name(record.scientific_name): record for record in records}


def compute_species_group_coverage_details(
    summary_csv_path: Path,
    species_records: list[SpeciesRecord],
) -> dict[str, Any] | None:
    """Return per-group met/total counts and nested IUCN status counts.

    The per-solution summary CSV has one row per feature. Species rows are
    counted by normalized taxonomic class, with ``met`` interpreted per row.
    IUCN status comes from the existing species lookup CSV by scientific name.
    """
    if not summary_csv_path.exists():
        raise FileNotFoundError(f"Summary CSV not found at {summary_csv_path}")

    lookup = species_lookup_by_name(species_records)
    groups = {group: _GroupCount() for group in _GROUP_LABELS}
    total = _Count()
    unmatched_species_count = 0
    ignored_species_row_count = 0

    with summary_csv_path.open(newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            if (row.get("type") or "").strip().lower() != "species":
                continue

            group = normalize_summary_class(row.get("class") or "")
            if group is None:
                ignored_species_row_count += 1
                continue

            met = _parse_bool(row.get("met"))
            status = "unknown"
            record = lookup.get(_normalize_species_name(row.get("feature") or ""))
            if record is None:
                unmatched_species_count += 1
            else:
                status = _normalize_iucn_status(record.iucn_status)

            total.record(met)
            groups[group].record(met, status)

    if total.total == 0:
        return None

    return {
        "summary": total.as_dict(),
        "groups": {
            group: {
                "label": _GROUP_LABELS[group],
                **count.total.as_dict(),
                "iucnStatusBreakdown": {
                    status: status_count.as_dict()
                    for status, status_count in count.by_status.items()
                    if status_count.total > 0
                },
            }
            for group, count in groups.items()
            if count.total.total > 0
        },
        "unmatchedSpeciesCount": unmatched_species_count,
        "ignoredSpeciesRowCount": ignored_species_row_count,
    }


def _parse_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    return str(value or "").strip().lower() in {"true", "1", "yes", "y"}


def _normalize_iucn_status(value: str) -> str:
    status = value.strip().upper()
    if status in {"CR", "EN", "VU", "NT", "LC", "DD"}:
        return status
    if status:
        return "other"
    return "unknown"


def _normalize_species_name(value: str) -> str:
    normalized = value.replace("_", " ").strip().lower()
    return re.sub(r"\s+", " ", normalized)
