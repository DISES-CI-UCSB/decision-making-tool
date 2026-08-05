"""Versioned provenance for generated metric-cache documents."""

from __future__ import annotations

import hashlib
import json
import math
from collections.abc import Iterable
from typing import Any

from boundaries.boundary_loader import BOUNDARY_SOURCE_SPECS
from metric_definitions import (
    MetricDefinition,
    computable_metrics,
    is_species_metric_kind,
)
from solution_domain import SolutionDomain, normalize_domain
from species_overlap import SPECIES_OVERLAP_ALGORITHM_VERSION

# Bump this when output schema or calculation semantics change without a
# corresponding MetricDefinition change. The catalog itself is hashed below.
METRICS_SCHEMA_VERSION = 3
CATALOG_SIGNATURE_VERSION = "metrics-catalog-v3"
PROVENANCE_KEY = "metricsProvenance"
BOUNDARY_PROVENANCE_VERSION = "boundary-provenance-v1"
EXPECTED_BOUNDARY_COUNTS = {
    "departments": 33,
    "municipalities": 1105,
    "siraps": 10,
    "runaps": 1879,
    "omecs": 614,
}
BOUNDARY_RASTERIZATION = {
    "boundaryInclusion": "pixel-center",
    "allTouched": False,
    "referenceGrid": "solution raster grid",
}

METRIC_OUTPUT_FIELDS = (
    "metricId",
    "value",
    "unit",
    "status",
    "source",
    "notes",
    "labelKey",
    "formatHint",
    "details",
)
VALID_METRIC_STATUSES = (
    "ready",
    "partial",
    "blocked",
    "pending",
    "derivation_needed",
    "not_applicable",
    "empty",
)


def generation_config(
    domain: SolutionDomain,
    *,
    national_only: bool = False,
    skip_species: bool = False,
    skip_species_boundary_levels: Iterable[str] = (),
    species_csv_url: str | None = None,
    species_exception_binding: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Return the normalized output-affecting options for one solution."""

    config: dict[str, Any] = {"nationalOnly": bool(national_only)}
    if domain == "land":
        species_skipped = bool(skip_species)
        config["speciesSkipped"] = species_skipped
        config["speciesBoundaryLevelsSkipped"] = (
            []
            if national_only or species_skipped
            else sorted(set(skip_species_boundary_levels))
        )
        config["speciesCsvUrl"] = None if species_skipped else species_csv_url
        config["speciesAlignmentPolicy"] = (
            None if species_skipped else SPECIES_OVERLAP_ALGORITHM_VERSION
        )
        config["speciesException"] = (
            None if species_skipped else species_exception_binding
        )
    return config


def _definition_payload(definition: MetricDefinition) -> dict[str, Any]:
    return {
        "metricId": definition.metric_id,
        "metricNumber": definition.metric_number,
        "labelKey": definition.label_key,
        "englishLabel": definition.english_label,
        "spanishLabel": definition.spanish_label,
        "unit": definition.unit,
        "formatHint": definition.format_hint,
        "sourceNote": definition.source_note,
        "kind": definition.kind,
        "layerId": definition.layer_id,
        "offManifestUrl": definition.off_manifest_url,
        "offManifestRendering": definition.off_manifest_rendering,
        "speciesBucket": definition.species_bucket,
        "applicableDomains": sorted(definition.applicable_domains),
    }


def catalog_signature(
    domain: SolutionDomain,
    config: dict[str, Any],
    *,
    catalog: Iterable[MetricDefinition] | None = None,
) -> str:
    """Hash catalog order, applicability, output schema, domain, and run config."""

    definitions = tuple(computable_metrics() if catalog is None else catalog)
    payload = {
        "signatureVersion": CATALOG_SIGNATURE_VERSION,
        "schemaVersion": METRICS_SCHEMA_VERSION,
        "solutionDomain": domain,
        "generationConfig": config,
        "metricOutputFields": METRIC_OUTPUT_FIELDS,
        "validStatuses": VALID_METRIC_STATUSES,
        "catalog": [_definition_payload(definition) for definition in definitions],
    }
    encoded = json.dumps(
        payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    digest = hashlib.sha256(encoded).hexdigest()
    return f"{CATALOG_SIGNATURE_VERSION}:{digest}"


def build_metrics_provenance(
    domain: SolutionDomain,
    *,
    national_only: bool = False,
    skip_species: bool = False,
    skip_species_boundary_levels: Iterable[str] = (),
    species_csv_url: str | None = None,
    release_id: str | None = None,
    alignment_provenance: dict[str, Any] | None = None,
    species_exception_binding: dict[str, Any] | None = None,
) -> dict[str, Any]:
    config = generation_config(
        domain,
        national_only=national_only,
        skip_species=skip_species,
        skip_species_boundary_levels=skip_species_boundary_levels,
        species_csv_url=species_csv_url,
        species_exception_binding=species_exception_binding,
    )
    boundary_sources = {
        level: {
            "url": spec.url,
            "sha256": spec.expected_sha256,
            "catalogSha256": spec.expected_catalog_sha256,
            "geometryCollectionSha256": spec.expected_geometry_collection_sha256,
            "crs": spec.expected_crs,
            "featureCount": spec.expected_feature_count,
            "idField": spec.id_field,
            "nameField": spec.name_field,
            "featureBehavior": spec.feature_behavior,
            "rasterization": BOUNDARY_RASTERIZATION,
        }
        for level, spec in sorted(BOUNDARY_SOURCE_SPECS.items())
    }
    boundary_signature = hashlib.sha256(
        json.dumps(
            boundary_sources,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    ).hexdigest()
    provenance = {
        "schemaVersion": METRICS_SCHEMA_VERSION,
        "solutionDomain": domain,
        "generationConfig": config,
        "catalogSignature": catalog_signature(domain, config),
        "releaseId": release_id,
        "boundaryProvenance": {
            "format": BOUNDARY_PROVENANCE_VERSION,
            "sha256": boundary_signature,
            "sources": boundary_sources,
        },
    }
    if alignment_provenance is not None:
        provenance["inputAlignment"] = alignment_provenance
    return provenance


def provenance_issues(
    document: dict[str, Any],
    *,
    expected_domain: SolutionDomain | None = None,
    expected_config: dict[str, Any] | None = None,
    expected_release_id: str | None = None,
) -> list[str]:
    """Describe missing, malformed, stale, or context-mismatched provenance."""

    provenance = document.get(PROVENANCE_KEY)
    if not isinstance(provenance, dict):
        return [f"missing or invalid top-level '{PROVENANCE_KEY}'"]

    issues: list[str] = []
    if expected_release_id is not None and provenance.get("releaseId") != expected_release_id:
        issues.append(
            f"release id mismatch: found {provenance.get('releaseId')!r}, "
            f"expected {expected_release_id!r}"
        )
    if provenance.get("schemaVersion") != METRICS_SCHEMA_VERSION:
        issues.append(
            "metrics schema version mismatch: "
            f"found {provenance.get('schemaVersion')!r}, "
            f"expected {METRICS_SCHEMA_VERSION!r}"
        )

    raw_domain = provenance.get("solutionDomain")
    try:
        domain = normalize_domain(raw_domain)
    except ValueError:
        domain = None
        issues.append(f"invalid solution domain {raw_domain!r}")
    else:
        if raw_domain != domain:
            issues.append(f"solution domain must be canonical, found {raw_domain!r}")
        if expected_domain is not None and domain != expected_domain:
            issues.append(
                f"solution domain mismatch: found {domain!r}, expected {expected_domain!r}"
            )

    config = provenance.get("generationConfig")
    if not isinstance(config, dict):
        issues.append("missing or invalid generationConfig")
    elif expected_config is not None and config != expected_config:
        issues.append(
            f"generation config mismatch: found {config!r}, expected {expected_config!r}"
        )

    signature = provenance.get("catalogSignature")
    if not isinstance(signature, str) or not signature:
        issues.append("missing or invalid catalogSignature")
    elif domain is not None and isinstance(config, dict):
        expected_signature = catalog_signature(domain, config)
        if signature != expected_signature:
            issues.append(
                "catalog signature mismatch: "
                f"found {signature!r}, expected {expected_signature!r}"
            )

    boundary_provenance = provenance.get("boundaryProvenance")
    if not isinstance(boundary_provenance, dict):
        issues.append("missing or invalid boundaryProvenance")
    else:
        sources = boundary_provenance.get("sources")
        if boundary_provenance.get("format") != BOUNDARY_PROVENANCE_VERSION:
            issues.append("boundary provenance format mismatch")
        if not isinstance(sources, dict):
            issues.append("missing or invalid boundary provenance sources")
        else:
            expected = build_metrics_provenance(
                domain or "land",
            )["boundaryProvenance"]
            for level, count in EXPECTED_BOUNDARY_COUNTS.items():
                source = sources.get(level)
                expected_source = expected["sources"][level]
                if not isinstance(source, dict):
                    issues.append(f"missing boundary provenance for {level}")
                    continue
                if source.get("featureCount") != count:
                    issues.append(
                        f"{level} boundary count mismatch: found "
                        f"{source.get('featureCount')!r}, expected {count}"
                    )
                for field in (
                    "url",
                    "sha256",
                    "catalogSha256",
                    "geometryCollectionSha256",
                    "crs",
                    "rasterization",
                ):
                    if source.get(field) != expected_source[field]:
                        issues.append(f"{level} boundary {field} is missing or stale")
            encoded = json.dumps(
                sources,
                ensure_ascii=False,
                sort_keys=True,
                separators=(",", ":"),
            ).encode("utf-8")
            if boundary_provenance.get("sha256") != hashlib.sha256(encoded).hexdigest():
                issues.append("boundary provenance signature mismatch")

    return issues


def regular_artifact_completeness_issues(
    document: dict[str, Any],
    *,
    national_only: bool,
    domain: SolutionDomain,
    skip_species: bool = False,
) -> list[str]:
    """Validate the complete regular artifact contract shared by every gate."""

    expected_levels = (
        {"national"}
        if national_only
        else {"national", "departments", "municipalities", "siraps", "runaps", "omecs"}
    )
    geographies = document.get("geographies")
    if not isinstance(geographies, dict) or set(geographies) != expected_levels:
        return ["geography levels are incomplete or unexpected"]

    definitions = computable_metrics()
    expected_ids = [definition.metric_id for definition in definitions]
    issues: list[str] = []
    provenance = document.get(PROVENANCE_KEY)
    generation = (
        provenance.get("generationConfig")
        if isinstance(provenance, dict)
        else None
    )
    species_exception_binding = (
        generation.get("speciesException")
        if isinstance(generation, dict)
        else None
    )
    for level, scopes in geographies.items():
        if not isinstance(scopes, dict) or not scopes:
            issues.append(f"{level} has no scopes")
            continue
        if level == "national" and set(scopes) != {"colombia"}:
            issues.append("national scopes must contain exactly 'colombia'")
        for scope_id, scope in scopes.items():
            metrics = scope.get("metrics") if isinstance(scope, dict) else None
            if not isinstance(metrics, list):
                issues.append(f"{level}/{scope_id} has no metrics list")
                continue
            observed_ids = [
                metric.get("metricId") if isinstance(metric, dict) else None
                for metric in metrics
            ]
            if observed_ids != expected_ids:
                issues.append(f"{level}/{scope_id} metric catalog order is incomplete")
                continue
            for definition, metric in zip(definitions, metrics, strict=True):
                if not isinstance(metric, dict):
                    issues.append(f"{level}/{scope_id}/{definition.metric_id} is malformed")
                    continue
                status = metric.get("status")
                if status not in VALID_METRIC_STATUSES:
                    issues.append(
                        f"{level}/{scope_id}/{definition.metric_id} has invalid status "
                        f"{status!r}"
                    )
                    continue
                applicable_input = (
                    domain in definition.applicable_domains
                    and (
                        definition.layer_id is not None
                        or (
                            is_species_metric_kind(definition.kind)
                            and not skip_species
                        )
                    )
                )
                expected_status = (
                    "partial"
                    if species_exception_binding is not None
                    and is_species_metric_kind(definition.kind)
                    else "ready"
                )
                if applicable_input and status != expected_status:
                    issues.append(
                        f"{level}/{scope_id}/{definition.metric_id} must be "
                        f"{expected_status}"
                    )
                if status == "partial" and (
                    isinstance(metric.get("value"), bool)
                    or not isinstance(metric.get("value"), (int, float))
                    or not math.isfinite(metric["value"])
                    or metric.get("details", {}).get("speciesException")
                    != species_exception_binding
                ):
                    issues.append(
                        f"{level}/{scope_id}/{definition.metric_id} has invalid "
                        "partial-value provenance"
                    )
                if not isinstance(metric.get("unit"), str) or not isinstance(
                    metric.get("labelKey"), str
                ):
                    issues.append(
                        f"{level}/{scope_id}/{definition.metric_id} metadata is incomplete"
                    )

    if domain == "land" and not skip_species:
        completeness = document.get("speciesCompleteness")
        if not isinstance(completeness, dict):
            issues.append("speciesCompleteness is missing")
        else:
            if species_exception_binding is not None:
                expected = {
                    "catalogTotal": species_exception_binding["catalogTotal"],
                    "availableExpected": species_exception_binding["availableExpected"],
                    "excluded": species_exception_binding["excluded"],
                    "aligned": species_exception_binding["availableExpected"],
                    "processed": species_exception_binding["availableExpected"],
                    "missingUnexpected": 0,
                    "complete": True,
                    "exception": species_exception_binding,
                }
                if any(completeness.get(key) != value for key, value in expected.items()):
                    issues.append(
                        "speciesCompleteness does not match the signed exception policy"
                    )
            else:
                counts = [
                    completeness.get("expected"),
                    completeness.get("aligned"),
                    completeness.get("processed"),
                ]
                if (
                    completeness.get("complete") is not True
                    or completeness.get("missing") != 0
                    or any(
                        isinstance(value, bool) or not isinstance(value, int)
                        for value in counts
                    )
                    or len(set(counts)) != 1
                ):
                    issues.append(
                        "speciesCompleteness must have complete=true, missing=0, and "
                        "expected=aligned=processed"
                    )
    return issues


def expected_metric_definitions() -> tuple[MetricDefinition, ...]:
    """Definitions expected in every geography scope, in wire order."""

    return computable_metrics()
