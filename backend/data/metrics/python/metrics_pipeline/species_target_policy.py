"""Fail-closed species-target policy derived from manifest metadata."""

from __future__ import annotations

import hashlib
import json
import math
import re
import unicodedata
from dataclasses import dataclass
from typing import Any, Literal

from species_data import SpeciesRecord, parse_solution_target_percent

SpeciesTargetPolicyKind = Literal["scalar", "per_species", "dual_reference"]
TARGET_POLICY_FORMAT = "species-target-policy-v1"
TARGET_POLICY_SOURCE = "manifest:finderInputs.structuredTargets"
REFERENCE_THRESHOLDS: tuple[float, float] = (17.0, 30.0)
REFERENCE_THRESHOLD_DECISION = "approved:dual-reference-species-thresholds-v1"
_STRUCTURED_TARGET_FORMAT = "solution-target-metadata-v1"
_SUPPORTED_SPECIES_TARGET_SOURCES = frozenset(
    {"prioritizr_model", "final_summary_csv"}
)


class SpeciesTargetPolicyError(ValueError):
    """Raised when species targets cannot be bound without guessing."""


def normalize_species_feature_id(value: str) -> str:
    """Match manifest feature IDs using the generator's exact normalization."""

    normalized = unicodedata.normalize("NFD", value)
    normalized = "".join(
        character for character in normalized if unicodedata.category(character) != "Mn"
    )
    return re.sub(
        r"^_+|_+$", "", re.sub(r"[^a-z0-9]+", "_", normalized.strip().lower())
    )


def _canonical_sha256(value: Any) -> str:
    return hashlib.sha256(
        json.dumps(
            value,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    ).hexdigest()


@dataclass(frozen=True)
class SpeciesTargetPolicy:
    kind: SpeciesTargetPolicyKind
    scalar_target_pct: float | None
    targets_by_species: dict[str, float]
    provenance: dict[str, Any] | None

    def target_for(self, scientific_name: str) -> float | None:
        if self.kind == "scalar":
            return self.scalar_target_pct
        if self.kind == "per_species":
            return self.targets_by_species.get(
                normalize_species_feature_id(scientific_name)
            )
        return None


def _validated_entries(value: Any, *, label: str) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        raise SpeciesTargetPolicyError(f"{label} must be an array.")
    entries: list[dict[str, Any]] = []
    seen: set[str] = set()
    for index, raw in enumerate(value):
        if not isinstance(raw, dict):
            raise SpeciesTargetPolicyError(f"{label}[{index}] must be an object.")
        feature_id = raw.get("featureId")
        target_pct = raw.get("targetPercent")
        if not isinstance(feature_id, str) or not feature_id.strip():
            raise SpeciesTargetPolicyError(
                f"{label}[{index}].featureId must be non-empty."
            )
        normalized = normalize_species_feature_id(feature_id)
        if normalized != feature_id:
            raise SpeciesTargetPolicyError(
                f"{label}[{index}].featureId is not canonically normalized."
            )
        if normalized in seen:
            raise SpeciesTargetPolicyError(
                f"{label} contains duplicate featureId {normalized!r}."
            )
        if (
            isinstance(target_pct, bool)
            or not isinstance(target_pct, (int, float))
            or not math.isfinite(target_pct)
            or not 0 <= target_pct <= 100
        ):
            raise SpeciesTargetPolicyError(
                f"{label}[{index}].targetPercent must be finite and between 0 and 100."
            )
        seen.add(normalized)
        entries.append({"featureId": normalized, "targetPercent": float(target_pct)})
    return entries


def resolve_species_target_policy(
    solution: dict[str, Any],
    *,
    catalog_records: list[SpeciesRecord] | None = None,
    available_records: list[SpeciesRecord] | None = None,
) -> SpeciesTargetPolicy:
    """Classify scalar, EspRN, and dual-reference solutions from manifest metadata.

    Structured metadata is authoritative. Legacy token parsing is used only when
    ``structuredTargets`` is absent, preserving old-manifest scalar behavior.
    Per-species targets bind one-to-one to normalized CSV scientific names.
    """

    finder_inputs = solution.get("finderInputs")
    if not isinstance(finder_inputs, dict):
        legacy = parse_solution_target_percent(
            str(solution.get("name") or solution.get("id") or "")
        )
        if legacy is None:
            return _dual_reference_policy()
        return SpeciesTargetPolicy("scalar", legacy, {}, None)

    structured = finder_inputs.get("structuredTargets")
    if structured is None:
        legacy = parse_solution_target_percent(
            str(solution.get("name") or solution.get("id") or "")
        )
        if legacy is None:
            return _dual_reference_policy()
        return SpeciesTargetPolicy("scalar", legacy, {}, None)
    if not isinstance(structured, dict):
        raise SpeciesTargetPolicyError(
            "finderInputs.structuredTargets must be an object."
        )
    if structured.get("format") != _STRUCTURED_TARGET_FORMAT:
        raise SpeciesTargetPolicyError(
            "finderInputs.structuredTargets format is missing or unsupported."
        )

    scalar_entries = _validated_entries(
        structured.get("speciesRepresentation"),
        label="structuredTargets.speciesRepresentation",
    )
    per_species_entries = _validated_entries(
        structured.get("espRn"),
        label="structuredTargets.espRn",
    )
    if scalar_entries and per_species_entries:
        raise SpeciesTargetPolicyError(
            "speciesRepresentation and espRn targets cannot both be populated."
        )

    target_feature_set = normalize_species_feature_id(
        str(finder_inputs.get("targetFeatureSet") or "")
    )
    source_evaluation = structured.get("sourceEvaluation")
    explicit_entries = per_species_entries or (
        scalar_entries if source_evaluation == "final_summary_csv" else []
    )
    if explicit_entries:
        expected_feature_sets = (
            {"esp_rn"} if per_species_entries else {"species", "species_representation"}
        )
        if target_feature_set not in expected_feature_sets:
            raise SpeciesTargetPolicyError(
                "structured per-species targets do not match finderInputs.targetFeatureSet."
            )
        if source_evaluation not in _SUPPORTED_SPECIES_TARGET_SOURCES:
            raise SpeciesTargetPolicyError(
                "per-species targets require a supported source evaluation."
            )
        if catalog_records is None or available_records is None:
            raise SpeciesTargetPolicyError(
                "EspRN targets require catalog and available species inventories."
            )
        catalog_by_id: dict[str, SpeciesRecord] = {}
        for record in catalog_records:
            feature_id = normalize_species_feature_id(record.scientific_name)
            if feature_id in catalog_by_id:
                raise SpeciesTargetPolicyError(
                    f"species catalog normalization collision for {feature_id!r}."
                )
            catalog_by_id[feature_id] = record
        target_ids = {entry["featureId"] for entry in explicit_entries}
        missing = sorted(target_ids - catalog_by_id.keys())
        if missing:
            raise SpeciesTargetPolicyError(
                f"EspRN targets do not bind to the species catalog: {missing[:8]}."
            )
        available_ids = {
            normalize_species_feature_id(record.scientific_name)
            for record in available_records
        }
        canonical_entries = sorted(
            explicit_entries, key=lambda entry: entry["featureId"]
        )
        provenance = {
            "format": TARGET_POLICY_FORMAT,
            "kind": "per_species",
            "source": TARGET_POLICY_SOURCE,
            "sourceEvaluation": source_evaluation,
            "structuredTargetDimension": (
                "espRn" if per_species_entries else "speciesRepresentation"
            ),
            "structuredTargetCount": len(canonical_entries),
            "structuredTargetsSha256": _canonical_sha256(canonical_entries),
            "matchingInventory": {
                "normalization": "manifest-target-feature-id-v1",
                "catalogSpeciesCount": len(catalog_by_id),
                "availableSpeciesCount": len(available_ids),
                "matchedTargetCount": len(target_ids),
                "availableMatchedTargetCount": len(target_ids & available_ids),
                "excludedMatchedTargetCount": len(target_ids - available_ids),
            },
        }
        return SpeciesTargetPolicy(
            "per_species",
            None,
            {
                entry["featureId"]: entry["targetPercent"]
                for entry in canonical_entries
                if entry["featureId"] in available_ids
            },
            provenance,
        )

    if scalar_entries:
        if target_feature_set not in {"species", "species_representation"}:
            raise SpeciesTargetPolicyError(
                "speciesRepresentation targets require a species targetFeatureSet."
            )
        target_pct = finder_inputs.get("targetPercent")
        if (
            isinstance(target_pct, bool)
            or not isinstance(target_pct, (int, float))
            or not math.isfinite(target_pct)
            or not 0 <= target_pct <= 100
        ):
            raise SpeciesTargetPolicyError(
                "scalar species targets require a finite finderInputs.targetPercent."
            )
        # Scalar provenance is intentionally omitted: existing v0.2 cache bytes and
        # solution-input signatures remain scientifically identical and reusable.
        return SpeciesTargetPolicy("scalar", float(target_pct), {}, None)

    if target_feature_set in {"esp_rn", "species", "species_representation"}:
        raise SpeciesTargetPolicyError(
            "species targetFeatureSet is configured without structured species targets."
        )
    return _dual_reference_policy()


def _dual_reference_policy() -> SpeciesTargetPolicy:
    thresholds = [17, 30]
    return SpeciesTargetPolicy(
        "dual_reference",
        None,
        {},
        {
            "format": TARGET_POLICY_FORMAT,
            "kind": "dual_reference",
            "source": TARGET_POLICY_SOURCE,
            "decisionSource": REFERENCE_THRESHOLD_DECISION,
            "structuredTargetDimension": None,
            "structuredTargetCount": 0,
            "structuredTargetsSha256": _canonical_sha256([]),
            "referenceThresholds": thresholds,
            "referenceThresholdsSha256": _canonical_sha256(thresholds),
        },
    )
