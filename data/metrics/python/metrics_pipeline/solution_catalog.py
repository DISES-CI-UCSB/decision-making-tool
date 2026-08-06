"""Versioned, fail-closed solution catalogs for immutable metric releases."""

from __future__ import annotations

import hashlib
import json
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

from path_contracts import safe_solution_id
from solution_domain import normalize_domain

SOLUTION_CATALOG_FORMAT = "solution-catalog-v1"
SOLUTION_RELEASE_PLAN_FORMAT = "solution-release-plan-v1"
SOLUTION_CATALOG_BINDING_FORMAT = "solution-catalog-binding-v1"
SPECIES_EXCEPTION_BINDING_FORMAT = "release-species-exception-binding-v1"
SPECIES_EXCEPTION_POLICY_FORMAT = "release-species-exception-v1"

_SEMVER_PATTERN = re.compile(
    r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)"
    r"(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?"
    r"(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$"
)
_RELEASE_ID_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
_SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")


class SolutionCatalogError(ValueError):
    """Raised when a solution catalog or release plan is inconsistent."""


def _canonical_sha256(value: Any) -> str:
    encoded = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


@dataclass(frozen=True)
class SolutionCatalogEntry:
    solution_id: str
    solution_basename: str
    domain: str
    raster_sha256: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "solutionId": self.solution_id,
            "solutionBasename": self.solution_basename,
            "domain": self.domain,
            "rasterSha256": self.raster_sha256,
        }


@dataclass(frozen=True)
class SolutionCatalog:
    catalog_version: str
    release_id: str
    expected_total_count: int
    expected_land_count: int
    expected_marine_count: int
    solutions: tuple[SolutionCatalogEntry, ...]
    source_path: Path
    species_exception_binding: dict[str, Any] | None = None

    @property
    def solution_ids(self) -> tuple[str, ...]:
        return tuple(entry.solution_id for entry in self.solutions)

    @property
    def by_id(self) -> dict[str, SolutionCatalogEntry]:
        return {entry.solution_id: entry for entry in self.solutions}

    @property
    def sha256(self) -> str:
        return _canonical_sha256(self.to_dict())

    def count_for_domain(self, domain: str) -> int:
        normalized = normalize_domain(domain)
        return sum(entry.domain == normalized for entry in self.solutions)

    def to_dict(self) -> dict[str, Any]:
        document = {
            "format": SOLUTION_CATALOG_FORMAT,
            "catalogVersion": self.catalog_version,
            "releaseId": self.release_id,
            "expectedSolutionCount": self.expected_total_count,
            "expectedLandSolutionCount": self.expected_land_count,
            "expectedMarineSolutionCount": self.expected_marine_count,
            "solutions": [entry.to_dict() for entry in self.solutions],
        }
        if self.species_exception_binding is not None:
            document["speciesException"] = self.species_exception_binding
        return document


def catalog_binding(catalog: SolutionCatalog) -> dict[str, Any]:
    """Build the exact binding shared by every release artifact."""

    binding: dict[str, Any] = {
        "format": SOLUTION_CATALOG_BINDING_FORMAT,
        "releaseId": catalog.release_id,
        "catalogVersion": catalog.catalog_version,
        "catalogSha256": catalog.sha256,
    }
    if catalog.species_exception_binding is not None:
        binding["speciesException"] = catalog.species_exception_binding
    return binding


def validate_catalog_binding(
    value: Any,
    *,
    catalog: SolutionCatalog,
    label: str = "solutionCatalogBinding",
) -> None:
    """Require an exact binding, rejecting missing and unrelated fields."""

    if value != catalog_binding(catalog):
        raise SolutionCatalogError(
            f"{label} does not exactly match the solution catalog."
        )


def _required_string(raw: dict[str, Any], field: str, *, label: str) -> str:
    value = raw.get(field)
    if not isinstance(value, str) or not value.strip():
        raise SolutionCatalogError(f"{label}.{field} must be a non-empty string.")
    return value.strip()


def _positive_count(raw: dict[str, Any], field: str) -> int:
    value = raw.get(field)
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise SolutionCatalogError(f"{field} must be a non-negative integer.")
    return value


def load_solution_catalog(path: Path) -> SolutionCatalog:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SolutionCatalogError(f"could not read solution catalog {path}: {exc}") from exc
    if not isinstance(raw, dict):
        raise SolutionCatalogError("solution catalog must be a JSON object.")
    if raw.get("format") != SOLUTION_CATALOG_FORMAT:
        raise SolutionCatalogError(
            f"solution catalog format must be {SOLUTION_CATALOG_FORMAT!r}."
        )

    catalog_version = _required_string(raw, "catalogVersion", label="catalog")
    if not _SEMVER_PATTERN.fullmatch(catalog_version):
        raise SolutionCatalogError("catalogVersion must be a semantic version such as 0.2.0.")
    release_id = _required_string(raw, "releaseId", label="catalog")
    if not _RELEASE_ID_PATTERN.fullmatch(release_id):
        raise SolutionCatalogError(
            "releaseId must contain lowercase letters, digits, and single hyphens."
        )

    total = _positive_count(raw, "expectedSolutionCount")
    land = _positive_count(raw, "expectedLandSolutionCount")
    marine = _positive_count(raw, "expectedMarineSolutionCount")
    if total != land + marine:
        raise SolutionCatalogError(
            "expectedSolutionCount must equal expectedLandSolutionCount + "
            "expectedMarineSolutionCount."
        )

    raw_solutions = raw.get("solutions")
    if not isinstance(raw_solutions, list) or not raw_solutions:
        raise SolutionCatalogError("solutions must be a non-empty JSON array.")
    entries: list[SolutionCatalogEntry] = []
    for index, item in enumerate(raw_solutions):
        label = f"solutions[{index}]"
        if not isinstance(item, dict):
            raise SolutionCatalogError(f"{label} must be a JSON object.")
        solution_id = _required_string(item, "solutionId", label=label)
        basename = _required_string(item, "solutionBasename", label=label)
        if item.get("solutionId") != solution_id:
            raise SolutionCatalogError(f"{label}.solutionId is unsafe.")
        if item.get("solutionBasename") != basename:
            raise SolutionCatalogError(
                f"{label}.solutionBasename must be an exact basename."
            )
        if "/" in basename or "\\" in basename:
            raise SolutionCatalogError(f"{label}.solutionBasename must be a basename.")
        if Path(basename).suffix != ".tif":
            raise SolutionCatalogError(
                f"{label}.solutionBasename must include the .tif extension."
            )
        try:
            safe_solution_id(solution_id)
        except ValueError as exc:
            raise SolutionCatalogError(f"{label}.solutionId is unsafe.") from exc
        try:
            domain = normalize_domain(_required_string(item, "domain", label=label))
        except ValueError as exc:
            raise SolutionCatalogError(f"{label}.domain must be land or marine.") from exc

        raster_sha256 = _required_string(item, "rasterSha256", label=label).lower()
        if not _SHA256_PATTERN.fullmatch(raster_sha256):
            raise SolutionCatalogError(f"{label}.rasterSha256 must be a SHA-256 digest.")
        entries.append(
            SolutionCatalogEntry(
                solution_id=solution_id,
                solution_basename=basename,
                domain=domain,
                raster_sha256=raster_sha256,
            )
        )

    ids = [entry.solution_id for entry in entries]
    basenames = [entry.solution_basename for entry in entries]
    if len(ids) != len(set(ids)):
        raise SolutionCatalogError("solutions contains duplicate solutionId values.")
    if len(basenames) != len(set(basenames)):
        raise SolutionCatalogError("solutions contains duplicate solutionBasename values.")
    safe_ids = [safe_solution_id(solution_id) for solution_id in ids]
    if len(safe_ids) != len(set(safe_ids)):
        raise SolutionCatalogError(
            "solutions contains solutionId values that collide after path sanitization."
        )
    if ids != sorted(ids):
        raise SolutionCatalogError("solutions must be sorted lexically by solutionId.")
    observed_land = sum(entry.domain == "land" for entry in entries)
    observed_marine = sum(entry.domain == "marine" for entry in entries)
    if (len(entries), observed_land, observed_marine) != (total, land, marine):
        raise SolutionCatalogError(
            "catalog solution counts do not match expectedCounts: "
            f"observed total={len(entries)}, land={observed_land}, marine={observed_marine}."
        )
    species_exception_binding = raw.get("speciesException")
    if species_exception_binding is not None:
        expected_keys = {
            "format",
            "policyFormat",
            "policyId",
            "policySha256",
            "catalogTotal",
            "availableExpected",
            "excluded",
        }
        if (
            not isinstance(species_exception_binding, dict)
            or set(species_exception_binding) != expected_keys
            or species_exception_binding.get("format")
            != SPECIES_EXCEPTION_BINDING_FORMAT
            or species_exception_binding.get("policyFormat")
            != SPECIES_EXCEPTION_POLICY_FORMAT
            or not isinstance(species_exception_binding.get("policyId"), str)
            or not species_exception_binding["policyId"].strip()
            or not _SHA256_PATTERN.fullmatch(
                str(species_exception_binding.get("policySha256", ""))
            )
            or species_exception_binding.get("catalogTotal") != 8300
            or species_exception_binding.get("availableExpected") != 8298
            or species_exception_binding.get("excluded") != 2
        ):
            raise SolutionCatalogError(
                "catalog speciesException binding is missing or invalid."
            )
    return SolutionCatalog(
        catalog_version=catalog_version,
        release_id=release_id,
        expected_total_count=total,
        expected_land_count=land,
        expected_marine_count=marine,
        solutions=tuple(entries),
        source_path=path.resolve(),
        species_exception_binding=species_exception_binding,
    )


def validate_catalog_solution_ids(
    catalog: SolutionCatalog,
    solution_ids: Iterable[str],
) -> None:
    observed = tuple(sorted(str(solution_id) for solution_id in solution_ids))
    expected = catalog.solution_ids
    if observed != expected:
        missing = sorted(set(expected) - set(observed))
        unexpected = sorted(set(observed) - set(expected))
        raise SolutionCatalogError(
            "runtime solution catalog does not exactly match the release catalog; "
            f"missing={missing[:8]}, unexpected={unexpected[:8]}"
        )


def _load_release_plan_document(
    path: Path,
    *,
    catalog: SolutionCatalog,
) -> dict[str, Any]:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SolutionCatalogError(f"could not read release plan {path}: {exc}") from exc
    if not isinstance(raw, dict) or raw.get("format") != SOLUTION_RELEASE_PLAN_FORMAT:
        raise SolutionCatalogError(
            f"release plan format must be {SOLUTION_RELEASE_PLAN_FORMAT!r}."
        )
    if raw.get("releaseId") != catalog.release_id:
        raise SolutionCatalogError("release plan releaseId does not match the catalog.")
    if raw.get("catalogSha256") != catalog.sha256:
        raise SolutionCatalogError("release plan catalogSha256 does not match the catalog.")
    if raw.get("speciesException") != catalog.species_exception_binding:
        raise SolutionCatalogError(
            "release plan speciesException does not match the catalog."
        )
    cache_policy = raw.get("cachePolicy")
    if cache_policy not in {"use-cache", "recompute-all"}:
        raise SolutionCatalogError("release plan cachePolicy is invalid.")
    if raw.get("reuseValidation") != {
        "solutionBasename": "exact",
        "rasterSha256": "exact",
        "solutionInputSignature": "exact",
        "runtimeProvenance": "required",
    }:
        raise SolutionCatalogError("release plan reuseValidation is missing or invalid.")
    entries = raw.get("entries")
    if not isinstance(entries, list):
        raise SolutionCatalogError("release plan entries must be a JSON array.")
    observed_ids: list[str] = []
    for index, entry in enumerate(entries):
        if not isinstance(entry, dict):
            raise SolutionCatalogError("release plan entries must be JSON objects.")
        solution_id = entry.get("solutionId")
        if not isinstance(solution_id, str):
            raise SolutionCatalogError("release plan entry is missing solutionId.")
        observed_ids.append(solution_id)
        expected_entry = catalog.solutions[index] if index < len(catalog.solutions) else None
        if expected_entry is None or (
            entry.get("solutionBasename") != expected_entry.solution_basename
            or entry.get("domain") != expected_entry.domain
            or entry.get("rasterSha256") != expected_entry.raster_sha256
        ):
            raise SolutionCatalogError(
                f"release plan entry for {solution_id!r} does not match the catalog."
            )
        entry_action = entry.get("action")
        if entry_action not in {"reuse", "recompute"}:
            raise SolutionCatalogError(
                f"release plan entry for {solution_id!r} has an invalid action."
            )
        if cache_policy == "recompute-all" and entry_action != "recompute":
            raise SolutionCatalogError(
                "recompute-all release plans cannot contain reuse entries."
            )
        if entry_action == "reuse" and not raw.get("baselineReleaseId"):
            raise SolutionCatalogError(
                "reuse entries require a non-empty baselineReleaseId."
            )
        signature = entry.get("solutionInputSignature")
        if signature is not None and (
            not isinstance(signature, dict)
            or signature.get("format")
            not in {
                "solution-input-signature-v1",
                "solution-input-signature-v2",
                "solution-input-signature-v3",
            }
            or not isinstance(signature.get("sha256"), str)
            or not _SHA256_PATTERN.fullmatch(signature["sha256"])
        ):
            raise SolutionCatalogError(
                f"release plan entry for {solution_id!r} has an invalid input signature."
            )
        if entry_action == "reuse" and signature is None:
            raise SolutionCatalogError(
                "reuse entries require a solutionInputSignature."
            )
    if tuple(observed_ids) != catalog.solution_ids:
        raise SolutionCatalogError("release plan entries do not exactly match catalog order.")
    counts = raw.get("counts")
    expected_counts = {
        "total": len(entries),
        "reuse": sum(entry.get("action") == "reuse" for entry in entries),
        "recompute": sum(entry.get("action") == "recompute" for entry in entries),
    }
    if counts != expected_counts:
        raise SolutionCatalogError(
            f"release plan counts do not match entries: expected {expected_counts}."
        )
    return raw


def load_release_plan(
    path: Path,
    *,
    catalog: SolutionCatalog,
    action: str = "recompute",
) -> tuple[str, ...]:
    if action not in {"reuse", "recompute"}:
        raise SolutionCatalogError(f"unknown release plan action {action!r}.")
    raw = _load_release_plan_document(path, catalog=catalog)
    return tuple(
        entry["solutionId"]
        for entry in raw["entries"]
        if entry["action"] == action
    )


def release_plan_cache_policy(
    path: Path,
    *,
    catalog: SolutionCatalog,
) -> str:
    return str(_load_release_plan_document(path, catalog=catalog)["cachePolicy"])


def bind_release_output(
    output_dir: Path,
    *,
    catalog: SolutionCatalog,
    component: str,
) -> Path:
    """Bind an output directory to one immutable release/catalog pair."""

    marker = output_dir / ".solution-release.json"
    expected = {
        "format": "solution-release-output-v1",
        "releaseId": catalog.release_id,
        "catalogVersion": catalog.catalog_version,
        "catalogSha256": catalog.sha256,
        "component": component,
    }
    if marker.exists():
        try:
            observed = json.loads(marker.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise SolutionCatalogError(
                f"could not validate release output marker {marker}: {exc}"
            ) from exc
        if observed != expected:
            raise SolutionCatalogError(
                f"output directory is already bound to a different immutable release: {marker}"
            )
        return marker
    output_dir.mkdir(parents=True, exist_ok=True)
    temporary = marker.with_name(f".{marker.name}.{os.getpid()}.tmp")
    temporary.write_text(
        json.dumps(expected, indent=2, ensure_ascii=False, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    temporary.replace(marker)
    return marker
