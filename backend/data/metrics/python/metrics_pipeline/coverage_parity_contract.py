"""Versioned contract loader for Mesa-compatible coverage parity."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

CONTRACT_FORMAT = "coverage-parity-contract-v1"


class CoverageParityContractError(ValueError):
    pass


@dataclass(frozen=True)
class CoverageParityContract:
    path: Path
    document: dict[str, Any]

    @property
    def release_id(self) -> str:
        return str(self.document["releaseId"])

    @property
    def solution_id(self) -> str:
        return str(self.document["goldenMaster"]["solutionId"])

    @property
    def summary_sha256(self) -> str:
        return str(self.document["goldenMaster"]["summarySha256"])

    @property
    def ecosystem_feature_count(self) -> int:
        return int(self.document["ecosystems"]["featureCount"])

    @property
    def species_feature_count(self) -> int:
        return int(self.document["species"]["summaryFeatureCount"])


def load_coverage_parity_contract(path: Path) -> CoverageParityContract:
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise CoverageParityContractError(f"Unreadable parity contract {path}: {exc}") from exc
    if not isinstance(document, dict) or document.get("format") != CONTRACT_FORMAT:
        raise CoverageParityContractError(
            f"Parity contract must use format {CONTRACT_FORMAT!r}."
        )
    required_paths = (
        ("releaseId",),
        ("scientificAuthority", "speciesUniversePolicy"),
        ("grid", "template", "sha256"),
        ("goldenMaster", "solutionId"),
        ("goldenMaster", "solutionSha256"),
        ("goldenMaster", "summarySha256"),
        ("ecosystems", "featureCount"),
        ("ecosystems", "raster", "sha256"),
        ("ecosystems", "catalog", "sha256"),
        ("species", "summaryFeatureCount"),
        ("validation", "unexplainedMismatchLimit"),
    )
    for keys in required_paths:
        value: Any = document
        try:
            for key in keys:
                value = value[key]
        except (KeyError, TypeError) as exc:
            raise CoverageParityContractError(
                f"Parity contract is missing {'.'.join(keys)}."
            ) from exc
    species_policy = document["scientificAuthority"]["speciesUniversePolicy"]
    if species_policy not in {"legacy-summary-7980", "regional-summary"}:
        raise CoverageParityContractError(
            "Parity contract speciesUniversePolicy is unsupported."
        )
    if int(document["validation"]["unexplainedMismatchLimit"]) != 0:
        raise CoverageParityContractError("Parity contract must reject every unexplained mismatch.")
    ecosystem_count = int(document["ecosystems"]["featureCount"])
    species_count = int(document["species"]["summaryFeatureCount"])
    if species_policy == "legacy-summary-7980":
        if ecosystem_count != 417:
            raise CoverageParityContractError(
                "V3 ecosystem golden inventory must contain 417 rows."
            )
        if species_count != 7980:
            raise CoverageParityContractError(
                "V3 species golden inventory must contain 7,980 rows."
            )
    else:
        region_id = document["scientificAuthority"].get("regionId")
        if not isinstance(region_id, str) or not region_id.strip():
            raise CoverageParityContractError(
                "Regional parity requires scientificAuthority.regionId."
            )
        if ecosystem_count < 1 or species_count < 1:
            raise CoverageParityContractError(
                "Regional parity inventories must contain ecosystem and species rows."
            )
    return CoverageParityContract(path=path, document=document)
