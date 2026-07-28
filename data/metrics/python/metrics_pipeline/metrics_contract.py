"""Versioned provenance for generated metric-cache documents."""

from __future__ import annotations

import hashlib
import json
from collections.abc import Iterable
from typing import Any

from boundaries.boundary_loader import BOUNDARY_SOURCE_SPECS
from metric_definitions import MetricDefinition, computable_metrics
from solution_domain import SolutionDomain, normalize_domain

# Bump this when output schema or calculation semantics change without a
# corresponding MetricDefinition change. The catalog itself is hashed below.
METRICS_SCHEMA_VERSION = 1
CATALOG_SIGNATURE_VERSION = "metrics-catalog-v1"
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
) -> dict[str, Any]:
    config = generation_config(
        domain,
        national_only=national_only,
        skip_species=skip_species,
        skip_species_boundary_levels=skip_species_boundary_levels,
        species_csv_url=species_csv_url,
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
    return {
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


def expected_metric_definitions() -> tuple[MetricDefinition, ...]:
    """Definitions expected in every geography scope, in wire order."""

    return computable_metrics()
