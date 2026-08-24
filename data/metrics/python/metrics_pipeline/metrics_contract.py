"""Versioned provenance for generated metric-cache documents."""

from __future__ import annotations

import hashlib
import json
import math
from collections.abc import Iterable
from typing import Any

from boundaries.boundary_loader import BOUNDARY_SOURCE_SPECS
from boundaries.boundary_topology import boundary_fanout_identity
from boundaries.boundary_weighted_fanout import weighted_execution_identity
from metric_definitions import (
    MetricDefinition,
    computable_metrics,
    is_species_metric_kind,
)
from solution_domain import SolutionDomain, normalize_domain
from species_overlap import SPECIES_OVERLAP_ALGORITHM_VERSION
from species_solution_batch import resolve_species_execution

# Bump this when output schema or calculation semantics change without a
# corresponding MetricDefinition change. The catalog itself is hashed below.
METRICS_SCHEMA_VERSION = 4
CATALOG_SIGNATURE_VERSION = "metrics-catalog-v4"
PROVENANCE_KEY = "metricsProvenance"
BOUNDARY_PROVENANCE_VERSION = "boundary-provenance-v1"
SCOPE_STATE_FORMAT = "solution-raster-scope-state-v1"
EXPECTED_BOUNDARY_COUNTS = {
    "departments": 33,
    "municipalities": 1105,
    "siraps": 8,
    "runaps": 1879,
    "omecs": 614,
}
BOUNDARY_RASTERIZATION = {
    "boundaryInclusion": "pixel-center",
    "allTouched": False,
    "referenceGrid": "solution raster grid",
}
NATIONAL_RASTERIZATION = {
    "boundaryInclusion": "none",
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
_SHA256_LENGTH = 64
_UNSET = object()


def _is_nonnegative_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and value >= 0


def _is_sha256(value: Any) -> bool:
    return (
        isinstance(value, str)
        and len(value) == _SHA256_LENGTH
        and all(character in "0123456789abcdef" for character in value)
    )


def build_scope_state(
    *,
    geography_level: str,
    scope_id: str,
    solution_valid_cell_count: int,
    selected_cell_count: int,
    boundary_grid_cell_count: int,
    target_grid_sha256: str,
    solution_raster_sha256: str,
    solution_validity_mask_sha256: str,
    boundary_source_sha256: str | None = None,
    boundary_geometry_sha256: str | None = None,
) -> dict[str, Any]:
    """Build cryptographically bound support evidence for one geography scope."""

    is_national = geography_level == "national"
    classification = (
        "supported" if solution_valid_cell_count > 0 else "empty"
    )
    return {
        "format": SCOPE_STATE_FORMAT,
        "classification": classification,
        "reason": (
            "positive_solution_valid_support"
            if classification == "supported"
            else "zero_solution_valid_support"
        ),
        "solutionValidCellCount": solution_valid_cell_count,
        "selectedCellCount": selected_cell_count,
        "boundaryGridCellCount": boundary_grid_cell_count,
        "targetGridSha256": target_grid_sha256,
        "solutionRasterSha256": solution_raster_sha256,
        "solutionValidityMaskSha256": solution_validity_mask_sha256,
        "boundary": (
            None
            if is_national
            else {
                "geographyLevel": geography_level,
                "scopeId": scope_id,
                "sourceSha256": boundary_source_sha256,
                "geometrySha256": boundary_geometry_sha256,
            }
        ),
        "rasterizationPolicy": (
            NATIONAL_RASTERIZATION if is_national else BOUNDARY_RASTERIZATION
        ),
    }


def scope_state_issues(
    scope_state: Any,
    *,
    geography_level: str,
    scope_id: str,
    expected_solution_raster_sha256: str | None = None,
    expected_target_grid_sha256: str | None = None,
    expected_solution_validity_mask_sha256: str | None = None,
    expected_boundary_source_sha256: str | None = None,
) -> list[str]:
    """Validate support evidence without trusting metric statuses."""

    label = f"{geography_level}/{scope_id} scopeState"
    if not isinstance(scope_state, dict):
        return [f"{label} is missing or invalid"]

    issues: list[str] = []
    if scope_state.get("format") != SCOPE_STATE_FORMAT:
        issues.append(f"{label} format is invalid")

    counts = {
        field: scope_state.get(field)
        for field in (
            "solutionValidCellCount",
            "selectedCellCount",
            "boundaryGridCellCount",
        )
    }
    for field, value in counts.items():
        if not _is_nonnegative_int(value):
            issues.append(f"{label}.{field} must be a non-negative integer")
    if all(_is_nonnegative_int(value) for value in counts.values()):
        valid = counts["solutionValidCellCount"]
        selected = counts["selectedCellCount"]
        boundary = counts["boundaryGridCellCount"]
        if selected > valid:
            issues.append(f"{label} selected cells exceed solution-valid cells")
        if valid > boundary:
            issues.append(f"{label} solution-valid cells exceed boundary-grid cells")

        expected_classification = "supported" if valid > 0 else "empty"
        expected_reason = (
            "positive_solution_valid_support"
            if valid > 0
            else "zero_solution_valid_support"
        )
        if scope_state.get("classification") != expected_classification:
            issues.append(f"{label} classification does not match support counts")
        if scope_state.get("reason") != expected_reason:
            issues.append(f"{label} reason does not match support counts")
        if geography_level == "national" and valid == 0:
            issues.append("national/colombia has zero solution-valid support")

    for field in (
        "targetGridSha256",
        "solutionRasterSha256",
        "solutionValidityMaskSha256",
    ):
        if not _is_sha256(scope_state.get(field)):
            issues.append(f"{label}.{field} must be a lowercase SHA-256")
    if (
        expected_solution_raster_sha256 is not None
        and scope_state.get("solutionRasterSha256")
        != expected_solution_raster_sha256
    ):
        issues.append(f"{label} solution raster SHA does not match document provenance")
    if (
        expected_target_grid_sha256 is not None
        and scope_state.get("targetGridSha256") != expected_target_grid_sha256
    ):
        issues.append(f"{label} target grid SHA does not match document identity")
    if (
        expected_solution_validity_mask_sha256 is not None
        and scope_state.get("solutionValidityMaskSha256")
        != expected_solution_validity_mask_sha256
    ):
        issues.append(f"{label} validity-mask SHA does not match national scope")

    is_national = geography_level == "national"
    expected_policy = NATIONAL_RASTERIZATION if is_national else BOUNDARY_RASTERIZATION
    if scope_state.get("rasterizationPolicy") != expected_policy:
        issues.append(f"{label} rasterization policy is invalid")
    boundary = scope_state.get("boundary")
    if is_national:
        if boundary is not None:
            issues.append(f"{label}.boundary must be null")
    elif not isinstance(boundary, dict):
        issues.append(f"{label}.boundary is missing or invalid")
    else:
        if boundary.get("geographyLevel") != geography_level:
            issues.append(f"{label} boundary geography level mismatch")
        if boundary.get("scopeId") != scope_id:
            issues.append(f"{label} boundary scope id mismatch")
        for field in ("sourceSha256", "geometrySha256"):
            if not _is_sha256(boundary.get(field)):
                issues.append(f"{label}.boundary.{field} must be a lowercase SHA-256")
        if (
            expected_boundary_source_sha256 is not None
            and boundary.get("sourceSha256") != expected_boundary_source_sha256
        ):
            issues.append(f"{label} boundary source SHA does not match provenance")
    return issues


def generation_config(
    domain: SolutionDomain,
    *,
    national_only: bool = False,
    skip_species: bool = False,
    skip_species_boundary_levels: Iterable[str] = (),
    species_csv_url: str | None = None,
    species_exception_binding: dict[str, Any] | None = None,
    boundary_fanout_mode: str = "legacy",
    weighted_execution_mode: str = "scalar",
    species_execution: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Return the normalized output-affecting options for one solution."""

    config: dict[str, Any] = {
        "nationalOnly": bool(national_only),
        "boundaryFanout": boundary_fanout_identity(boundary_fanout_mode),
        "weightedBoundaryExecution": weighted_execution_identity(
            weighted_execution_mode
        ),
    }
    if domain == "land":
        config["speciesExecution"] = (
            resolve_species_execution("independent").provenance()
            if species_execution is None
            else species_execution
        )
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
    signature_config = signature_generation_config(config)
    payload = {
        "signatureVersion": CATALOG_SIGNATURE_VERSION,
        "schemaVersion": METRICS_SCHEMA_VERSION,
        "solutionDomain": domain,
        "generationConfig": signature_config,
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


def signature_generation_config(config: dict[str, Any]) -> dict[str, Any]:
    """Keep historical legacy signatures stable while binding grouped mode."""

    fanout = config.get("boundaryFanout")
    if (
        isinstance(fanout, dict)
        and fanout.get("requestedMode") == "legacy"
        and fanout.get("effectiveMode") == "legacy"
    ):
        return {key: value for key, value in config.items() if key != "boundaryFanout"}
    return config


def _generation_configs_match(
    actual: dict[str, Any],
    expected: dict[str, Any],
) -> bool:
    if actual == expected:
        return True
    expected_fanout = expected.get("boundaryFanout")
    return (
        isinstance(expected_fanout, dict)
        and expected_fanout.get("requestedMode") == "legacy"
        and expected_fanout.get("effectiveMode") == "legacy"
        and actual == signature_generation_config(expected)
    )


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
    species_target_policy: dict[str, Any] | None = None,
    boundary_fanout_mode: str = "legacy",
    weighted_execution_mode: str = "scalar",
    species_execution: dict[str, Any] | None = None,
) -> dict[str, Any]:
    config = generation_config(
        domain,
        national_only=national_only,
        skip_species=skip_species,
        skip_species_boundary_levels=skip_species_boundary_levels,
        species_csv_url=species_csv_url,
        species_exception_binding=species_exception_binding,
        boundary_fanout_mode=boundary_fanout_mode,
        weighted_execution_mode=weighted_execution_mode,
        species_execution=species_execution,
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
    if species_target_policy is not None:
        provenance["speciesTargetPolicy"] = species_target_policy
    return provenance


def provenance_issues(
    document: dict[str, Any],
    *,
    expected_domain: SolutionDomain | None = None,
    expected_config: dict[str, Any] | None = None,
    expected_release_id: str | None = None,
    expected_species_target_policy: Any = _UNSET,
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
    target_policy = provenance.get("speciesTargetPolicy")
    if target_policy is not None:
        if (
            not isinstance(target_policy, dict)
            or target_policy.get("format") != "species-target-policy-v1"
            or target_policy.get("kind") not in {"per_species", "dual_reference"}
            or target_policy.get("source")
            != "manifest:finderInputs.structuredTargets"
            or not _is_nonnegative_int(target_policy.get("structuredTargetCount"))
            or not _is_sha256(target_policy.get("structuredTargetsSha256"))
        ):
            issues.append("species target policy provenance is invalid")
        elif target_policy.get("kind") == "dual_reference":
            thresholds = target_policy.get("referenceThresholds")
            expected_thresholds = [17, 30]
            if (
                thresholds != expected_thresholds
                or target_policy.get("decisionSource")
                != "approved:dual-reference-species-thresholds-v1"
                or target_policy.get("structuredTargetCount") != 0
                or target_policy.get("structuredTargetDimension") is not None
                or target_policy.get("structuredTargetsSha256")
                != hashlib.sha256(b"[]").hexdigest()
                or target_policy.get("referenceThresholdsSha256")
                != hashlib.sha256(
                    json.dumps(
                        expected_thresholds,
                        ensure_ascii=False,
                        sort_keys=True,
                        separators=(",", ":"),
                    ).encode("utf-8")
                ).hexdigest()
            ):
                issues.append("dual-reference target policy provenance is invalid")
    if (
        expected_species_target_policy is not _UNSET
        and target_policy != expected_species_target_policy
    ):
        issues.append("species target policy does not match manifest context")

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
    else:
        fanout = config.get("boundaryFanout")
        if not isinstance(fanout, dict):
            expected_fanout = (
                expected_config.get("boundaryFanout")
                if isinstance(expected_config, dict)
                else None
            )
            if not (
                expected_config is None
                or (
                    isinstance(expected_fanout, dict)
                    and expected_fanout.get("requestedMode") == "legacy"
                    and expected_fanout.get("effectiveMode") == "legacy"
                )
            ):
                issues.append("missing or invalid boundaryFanout generation identity")
        else:
            try:
                expected_fanout = boundary_fanout_identity(
                    fanout.get("requestedMode"),
                    effective_mode=fanout.get("effectiveMode"),
                )
            except (TypeError, ValueError):
                expected_fanout = None
            if fanout != expected_fanout:
                issues.append("boundaryFanout generation identity is invalid")
        weighted_execution = config.get("weightedBoundaryExecution")
        if not isinstance(weighted_execution, dict):
            issues.append(
                "missing or invalid weightedBoundaryExecution generation identity"
            )
        else:
            try:
                expected_weighted_execution = weighted_execution_identity(
                    weighted_execution.get("requestedMode")
                )
            except (TypeError, ValueError):
                expected_weighted_execution = None
            if weighted_execution != expected_weighted_execution:
                issues.append(
                    "weightedBoundaryExecution generation identity is invalid"
                )
        if (
            expected_config is not None
            and not _generation_configs_match(config, expected_config)
        ):
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


def _valid_dual_threshold_outcomes(
    metric: dict[str, Any],
    definition: MetricDefinition,
) -> bool:
    details = metric.get("details")
    outcomes = details.get("thresholdOutcomes") if isinstance(details, dict) else None
    if not isinstance(outcomes, list) or len(outcomes) != 2:
        return False
    if [outcome.get("targetPercent") for outcome in outcomes if isinstance(outcome, dict)] != [
        17.0,
        30.0,
    ]:
        return False
    for outcome in outcomes:
        if not isinstance(outcome, dict):
            return False
        value = outcome.get("value")
        if (
            isinstance(value, bool)
            or not isinstance(value, (int, float))
            or not math.isfinite(value)
        ):
            return False
        if definition.kind == "species_group_coverage":
            breakdown = outcome.get("details")
            if (
                not isinstance(breakdown, dict)
                or not isinstance(breakdown.get("summary"), dict)
                or not isinstance(breakdown.get("groups"), dict)
            ):
                return False
    return True


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
    solution_raster = document.get("solutionRaster")
    solution_raster_sha256 = (
        solution_raster.get("sha256")
        if isinstance(solution_raster, dict)
        else None
    )
    if not _is_sha256(solution_raster_sha256):
        issues.append("solutionRaster.sha256 must be a lowercase SHA-256")
    provenance = document.get(PROVENANCE_KEY)
    generation = (
        provenance.get("generationConfig")
        if isinstance(provenance, dict)
        else None
    )
    if not isinstance(generation, dict):
        issues.append("metricsProvenance.generationConfig is missing or invalid")
    else:
        fanout = generation.get("boundaryFanout")
        if not isinstance(fanout, dict):
            # Pre-identity artifacts are unambiguously legacy. Expected grouped
            # resume/candidate validation still rejects them via exact context.
            pass
        else:
            try:
                expected_fanout = boundary_fanout_identity(
                    fanout.get("requestedMode"),
                    effective_mode=fanout.get("effectiveMode"),
                )
            except (TypeError, ValueError):
                expected_fanout = None
            if fanout != expected_fanout:
                issues.append("generationConfig.boundaryFanout identity is stale")
        weighted_execution = generation.get("weightedBoundaryExecution")
        try:
            expected_weighted_execution = weighted_execution_identity(
                weighted_execution.get("requestedMode")
                if isinstance(weighted_execution, dict)
                else None
            )
        except (TypeError, ValueError):
            expected_weighted_execution = None
        if weighted_execution != expected_weighted_execution:
            issues.append(
                "generationConfig.weightedBoundaryExecution identity is stale"
            )
    species_exception_binding = (
        generation.get("speciesException")
        if isinstance(generation, dict)
        else None
    )
    target_policy = (
        provenance.get("speciesTargetPolicy")
        if isinstance(provenance, dict)
        else None
    )
    target_policy_kind = (
        target_policy.get("kind")
        if isinstance(target_policy, dict)
        else "scalar"
    )
    national_scope = geographies.get("national", {}).get("colombia", {})
    national_scope_state = (
        national_scope.get("scopeState")
        if isinstance(national_scope, dict)
        else None
    )
    expected_target_grid_sha256 = (
        national_scope_state.get("targetGridSha256")
        if isinstance(national_scope_state, dict)
        else None
    )
    expected_validity_mask_sha256 = (
        national_scope_state.get("solutionValidityMaskSha256")
        if isinstance(national_scope_state, dict)
        else None
    )
    alignment = provenance.get("inputAlignment") if isinstance(provenance, dict) else None
    if (
        isinstance(alignment, dict)
        and alignment.get("targetGridSha256") != expected_target_grid_sha256
    ):
        issues.append("national scope target grid SHA does not match input alignment")
    boundary_sources = (
        provenance.get("boundaryProvenance", {}).get("sources", {})
        if isinstance(provenance, dict)
        else {}
    )
    for level, scopes in geographies.items():
        if not isinstance(scopes, dict) or not scopes:
            issues.append(f"{level} has no scopes")
            continue
        if level == "national" and set(scopes) != {"colombia"}:
            issues.append("national scopes must contain exactly 'colombia'")
        for scope_id, scope in scopes.items():
            if not isinstance(scope, dict):
                issues.append(f"{level}/{scope_id} scope is malformed")
                continue
            scope_state = scope.get("scopeState")
            issues.extend(
                scope_state_issues(
                    scope_state,
                    geography_level=level,
                    scope_id=scope_id,
                    expected_solution_raster_sha256=solution_raster_sha256,
                    expected_target_grid_sha256=expected_target_grid_sha256,
                    expected_solution_validity_mask_sha256=expected_validity_mask_sha256,
                    expected_boundary_source_sha256=(
                        boundary_sources.get(level, {}).get("sha256")
                        if level != "national"
                        and isinstance(boundary_sources.get(level), dict)
                        else None
                    ),
                )
            )
            scope_is_empty = (
                isinstance(scope_state, dict)
                and scope_state.get("classification") == "empty"
                and scope_state.get("solutionValidCellCount") == 0
            )
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
                value = metric.get("value")
                dual_reference_metric = (
                    target_policy_kind == "dual_reference"
                    and definition.kind
                    in {"species_group_coverage", "species_threatened_secured"}
                )
                if (
                    status == "partial"
                    and value is None
                    and dual_reference_metric
                ):
                    if not _valid_dual_threshold_outcomes(metric, definition):
                        issues.append(
                            f"{level}/{scope_id}/{definition.metric_id} has invalid "
                            "dual-reference threshold outcomes"
                        )
                elif status in {"ready", "partial"}:
                    if (
                        isinstance(value, bool)
                        or not isinstance(value, (int, float))
                        or not math.isfinite(value)
                    ):
                        issues.append(
                            f"{level}/{scope_id}/{definition.metric_id} {status} "
                            "value must be finite numeric"
                        )
                elif value is not None:
                    issues.append(
                        f"{level}/{scope_id}/{definition.metric_id} {status} "
                        "value must be null"
                    )

                if scope_is_empty:
                    expected_empty_status = (
                        "empty"
                        if domain in definition.applicable_domains
                        else "not_applicable"
                    )
                    if status != expected_empty_status:
                        issues.append(
                            f"{level}/{scope_id}/{definition.metric_id} must be "
                            f"{expected_empty_status} for proven empty scope"
                        )
                    continue
                if status == "empty":
                    issues.append(
                        f"{level}/{scope_id}/{definition.metric_id} cannot be empty "
                        "without zero-support scope evidence"
                    )
                    continue
                structurally_not_applicable = (
                    domain not in definition.applicable_domains
                    or (
                        level == "national"
                        and definition.kind == "aoi_percent"
                    )
                    or (
                        level != "national"
                        and definition.kind
                        in {"metadata_summary", "metadata_coverage"}
                    )
                )
                expected_status: str | None
                if structurally_not_applicable:
                    expected_status = "not_applicable"
                elif skip_species and is_species_metric_kind(definition.kind):
                    expected_status = None
                elif (
                    target_policy_kind == "dual_reference"
                    and definition.kind
                    in {"species_group_coverage", "species_threatened_secured"}
                ) or (
                    species_exception_binding is not None
                    and is_species_metric_kind(definition.kind)
                ):
                    expected_status = "partial"
                else:
                    expected_status = "ready"
                if expected_status is not None and status != expected_status:
                    issues.append(
                        f"{level}/{scope_id}/{definition.metric_id} must be "
                        f"{expected_status}"
                    )
                if (
                    dual_reference_metric
                    and (
                        metric.get("source")
                        != "manifest:finderInputs.structuredTargets"
                        or metric.get("value") is not None
                        or not _valid_dual_threshold_outcomes(metric, definition)
                    )
                ):
                    issues.append(
                        f"{level}/{scope_id}/{definition.metric_id} has invalid "
                        "dual-reference metric contract"
                    )
                if status == "partial" and (
                    metric.get("details", {}).get("speciesException")
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
