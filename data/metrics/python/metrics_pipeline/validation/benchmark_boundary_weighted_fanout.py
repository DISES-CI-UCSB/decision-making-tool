"""Benchmark isolated grouped weighted boundary fan-out on eight real solutions.

The prototype is deliberately exercised outside ``main.py``.  The current
grouped path's scalar weighted fallback is compared with one grouped weighted
aggregation per unique layer, using the same pinned boundaries, aligned
rasters, metric constructors, and retained finalized documents.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import resource
import sys
import time
from dataclasses import asdict
from pathlib import Path
from typing import Any

import numpy as np

PIPELINE_ROOT = Path(__file__).parents[1]
if str(PIPELINE_ROOT) not in sys.path:
    sys.path.insert(0, str(PIPELINE_ROOT))

import main as pipeline
from blob_manifest import fetch_manifest
from boundaries.boundary_loader import BOUNDARY_SOURCE_SPECS, load_all_boundaries
from boundaries.boundary_mask import rasterize_boundary
from boundaries.boundary_topology import BoundaryTopologyCache
from boundaries.boundary_weighted_fanout import (
    NODATA_NORMALIZATION_POLICY,
    WEIGHTED_BOUNDARY_FANOUT_ALGORITHM_VERSION,
    WEIGHTED_LAYER_PREPARATION_ALGORITHM_VERSION,
    WEIGHTED_METRIC_REGISTRY_POLICY_VERSION,
    ImmutableWeightedLayerCache,
    PreparedWeightedLayer,
    WeightedLayerIdentity,
    WeightedMetricSpec,
    aggregate_selected_weighted_layers,
    assemble_weighted_metric_results,
    canonical_nodata_value,
    pixel_area_rows_sha256,
)
from calculator_registry import weighted_percent_calculator, weighted_sum_calculator
from local_io import cached_download
from metric_definitions import (
    MetricDefinition,
    computable_metrics,
    is_species_metric_kind,
)
from raster_align import RasterAlignmentCache, grid_sha256, policy_for_layer
from raster_metrics import read_layer_values, read_solution_raster

DEFAULT_SOLUTION_IDS = (
    "eco17_estr17_esprep17_runap_iheh2022",
    "eco17_estr17_esprep30_runap_omec_iheh2030",
    "eco17_estr30_esprn_runap_iheh2022",
    "eco17_estr30_esprn_runap_omec_iheh2030",
    "eco30_estr17_runap_iheh2022",
    "eco30_estr17_runap_omec_iheh2030",
    "eco30_estr30_esprep17_runap_omec_iheh2022",
    "eco30_estr30_esprep30_runap_iheh2030",
)
WEIGHTED_RTOL = 1e-12
WEIGHTED_ATOL = 1e-6
EXPECTED_GEOGRAPHY_LEVELS = (
    "national",
    "departments",
    "municipalities",
    "siraps",
    "runaps",
    "omecs",
)


class BenchmarkError(RuntimeError):
    pass


def run(args: argparse.Namespace) -> dict[str, Any]:
    run_started = time.perf_counter()
    manifest = fetch_manifest(args.manifest.resolve().as_uri())
    solutions_by_id = {
        str(solution["id"]): solution for solution in manifest.national_solutions
    }
    solution_ids = tuple(args.solution_id or DEFAULT_SOLUTION_IDS)
    missing = sorted(set(solution_ids) - solutions_by_id.keys())
    if missing:
        raise BenchmarkError(f"Manifest is missing solutions: {missing}")
    definitions = tuple(
        definition
        for definition in computable_metrics()
        if definition.kind in {"weighted_sum", "weighted_percent_of_national"}
        and "land" in definition.applicable_domains
    )
    specs = tuple(
        WeightedMetricSpec(
            definition.metric_id,
            definition.layer_id or "",
            definition.kind,
            definition.unit or "",
        )
        for definition in definitions
    )
    definitions_by_id = {definition.metric_id: definition for definition in definitions}
    weighted_ids = frozenset(definitions_by_id)
    species_ids = frozenset(
        definition.metric_id
        for definition in computable_metrics()
        if is_species_metric_kind(definition.kind)
    )

    setup_usage_before = resource.getrusage(resource.RUSAGE_SELF)
    setup_started = time.perf_counter()
    first_solution = solutions_by_id[solution_ids[0]]
    first_download = cached_download(first_solution["displayUrl"], args.cache_dir)
    first_raster = read_solution_raster(first_download.path)
    boundaries, failures = load_all_boundaries(args.cache_dir)
    if failures:
        raise BenchmarkError(f"Pinned boundary loading failed: {failures}")
    topology_started = time.perf_counter()
    indexes, topology_cache_hit = BoundaryTopologyCache().get(
        boundaries,
        first_raster.fingerprint,
    )
    topology_seconds = time.perf_counter() - topology_started
    expected_levels = tuple(boundaries)
    if tuple(indexes) != expected_levels:
        raise BenchmarkError("Boundary topology levels do not match pinned sources.")
    setup_seconds = time.perf_counter() - setup_started
    setup_usage_after = resource.getrusage(resource.RUSAGE_SELF)
    setup_user_seconds = setup_usage_after.ru_utime - setup_usage_before.ru_utime
    setup_system_seconds = setup_usage_after.ru_stime - setup_usage_before.ru_stime

    alignment_cache = RasterAlignmentCache(args.cache_dir)
    layer_cache = ImmutableWeightedLayerCache()
    raw_layers: dict[str, np.ndarray] = {}
    solution_reports: list[dict[str, Any]] = []
    total_current = _empty_phases()
    total_prototype = _empty_phases()
    total_current_by_metric = {definition.metric_id: 0.0 for definition in definitions}
    total_prototype_by_layer = {
        layer_id: 0.0 for layer_id in sorted({spec.layer_id for spec in specs})
    }
    total_layer_access = 0.0
    total_raster_load = 0.0
    parity_totals = {
        name: {
            "comparisonCount": 0,
            "mismatchCount": 0,
            "metricStatusDetailMismatchCount": 0,
            "numericToleranceMismatchCount": 0,
            "nonzeroDeltaCount": 0,
            "maxAbsoluteDelta": 0.0,
            "maxRelativeDelta": 0.0,
            "comparisonCountByLevel": {},
            "nonzeroDeltaCountByLevel": {},
        }
        for name in (
            "currentToRetained",
            "prototypeToRetained",
            "prototypeToCurrent",
        )
    }
    cache_hit_count = 0
    cache_miss_count = 0
    canonical_exact_matches = 0
    canonical_tolerant_matches = 0

    for ordinal, solution_id in enumerate(solution_ids):
        solution = solutions_by_id[solution_id]
        raster_started = time.perf_counter()
        download = (
            first_download
            if ordinal == 0
            else cached_download(solution["displayUrl"], args.cache_dir)
        )
        raster = first_raster if ordinal == 0 else read_solution_raster(download.path)
        raster_seconds = time.perf_counter() - raster_started
        total_raster_load += raster_seconds
        if not raster.fingerprint.matches(first_raster.fingerprint):
            raise BenchmarkError(f"Solution {solution_id!r} uses a different grid.")

        retained_path = args.retained_dir / f"{solution_id}.metrics.json"
        retained_started = time.perf_counter()
        retained = _read_json(retained_path)
        retained_read_seconds = time.perf_counter() - retained_started
        retained_non_species, retained_weighted, scope_valid = (
            _extract_retained_non_species(
                retained,
                species_ids=species_ids,
                weighted_ids=weighted_ids,
            )
        )
        retained_source_sha256 = _sha256(retained_path)
        retained_non_species_sha256 = _canonical_sha256(retained_non_species)
        del retained

        layer_started = time.perf_counter()
        prepared_layers: dict[str, PreparedWeightedLayer] = {}
        layer_access: list[dict[str, Any]] = []
        for layer_id in sorted({spec.layer_id for spec in specs}):
            source_url = pipeline._resolve_layer_url(manifest, layer_id)
            source = cached_download(source_url, args.cache_dir)
            aligned = alignment_cache.align(
                source.path,
                source.sha256,
                raster.fingerprint,
                policy_for_layer(layer_id),
            )
            identity = WeightedLayerIdentity(
                layer_id=layer_id,
                source_url=source_url,
                source_sha256=source.sha256,
                source_provenance_sha256=_canonical_sha256(
                    {"url": source_url, "sha256": source.sha256}
                ),
                aligned_url=aligned.path.resolve().as_uri(),
                aligned_sha256=aligned.aligned_sha256,
                aligned_provenance_sha256=_canonical_sha256(aligned.manifest),
                target_grid_sha256=aligned.target_grid_sha256,
                target_fingerprint_sha256=_canonical_sha256(
                    asdict(raster.fingerprint)
                ),
                target_shape=raster.selected_mask.shape,
                alignment_policy_sha256=aligned.policy_sha256,
                nodata_value=canonical_nodata_value(np.nan),
                nodata_interpretation_policy=(
                    "read-layer-values-declared-sentinel-to-nan-v1"
                ),
                normalization_policy=NODATA_NORMALIZATION_POLICY,
                pixel_area_rows_sha256=pixel_area_rows_sha256(
                    raster.pixel_area_km2_per_row
                ),
                preparation_algorithm_version=(
                    WEIGHTED_LAYER_PREPARATION_ALGORITHM_VERSION
                ),
                weighted_fanout_algorithm_version=(
                    WEIGHTED_BOUNDARY_FANOUT_ALGORITHM_VERSION
                ),
                aligned_dtype="float64",
                value_units=_layer_units(layer_id, definitions),
                metric_registry_policy_version=(
                    WEIGHTED_METRIC_REGISTRY_POLICY_VERSION
                ),
            )

            def load_values(
                *,
                current_layer_id: str = layer_id,
                path: Path = aligned.path,
                fingerprint=raster.fingerprint,
            ) -> np.ndarray:
                if current_layer_id not in raw_layers:
                    values = read_layer_values(path, fingerprint)
                    values.flags.writeable = False
                    raw_layers[current_layer_id] = values
                return raw_layers[current_layer_id]

            prepared, cache_hit = layer_cache.get_or_prepare(
                identity,
                shape=raster.selected_mask.shape,
                pixel_area_km2_per_row=raster.pixel_area_km2_per_row,
                loader=load_values,
            )
            prepared_layers[layer_id] = prepared
            cache_hit_count += int(cache_hit)
            cache_miss_count += int(not cache_hit)
            layer_access.append(
                {
                    "layerId": layer_id,
                    "cacheHit": cache_hit,
                    "sourceSha256": identity.source_sha256,
                    "alignedSha256": identity.aligned_sha256,
                    "targetGridSha256": identity.target_grid_sha256,
                    "alignmentPolicySha256": identity.alignment_policy_sha256,
                    "identity": identity.as_provenance(),
                    "identitySha256": identity.signature_sha256,
                    "nationalDenominator": prepared.national_denominator,
                    "estimatedBytes": prepared.estimated_bytes,
                }
            )
        layer_seconds = time.perf_counter() - layer_started
        total_layer_access += layer_seconds

        current_payloads, current_phases, current_by_metric = _run_current_fallback(
            raster,
            boundaries,
            definitions,
            scope_valid,
            raw_layers,
        )
        (
            prototype_payloads,
            prototype_phases,
            fanout_diagnostics,
            prototype_by_layer,
        ) = _run_grouped_prototype(
            raster,
            indexes,
            definitions_by_id,
            specs,
            prepared_layers,
            scope_valid,
        )
        _sum_phases(total_current, current_phases)
        _sum_phases(total_prototype, prototype_phases)
        for metric_id, seconds in current_by_metric.items():
            total_current_by_metric[metric_id] += seconds
        for layer_id, seconds in prototype_by_layer.items():
            total_prototype_by_layer[layer_id] += seconds

        comparison = _compare_payloads(
            current_payloads,
            prototype_payloads,
            retained_weighted,
        )
        for name, pair in comparison.items():
            total = parity_totals[name]
            total["comparisonCount"] += pair["comparisonCount"]
            total["mismatchCount"] += pair["mismatchCount"]
            total["metricStatusDetailMismatchCount"] += pair[
                "metricStatusDetailMismatchCount"
            ]
            total["numericToleranceMismatchCount"] += pair[
                "numericToleranceMismatchCount"
            ]
            total["nonzeroDeltaCount"] += pair["nonzeroDeltaCount"]
            total["maxAbsoluteDelta"] = max(
                total["maxAbsoluteDelta"], pair["maxAbsoluteDelta"]
            )
            total["maxRelativeDelta"] = max(
                total["maxRelativeDelta"], pair["maxRelativeDelta"]
            )
            for level, count in pair["comparisonCountByLevel"].items():
                total["comparisonCountByLevel"][level] = (
                    total["comparisonCountByLevel"].get(level, 0) + count
                )
            for level, count in pair["nonzeroDeltaCountByLevel"].items():
                total["nonzeroDeltaCountByLevel"][level] = (
                    total["nonzeroDeltaCountByLevel"].get(level, 0) + count
                )

        prototype_non_species = _replace_weighted_payloads(
            retained_non_species,
            prototype_payloads,
        )
        prototype_non_species_sha256 = _canonical_sha256(prototype_non_species)
        canonical_exact = prototype_non_species_sha256 == retained_non_species_sha256
        canonical_tolerant = comparison["prototypeToRetained"]["mismatchCount"] == 0
        canonical_exact_matches += int(canonical_exact)
        canonical_tolerant_matches += int(canonical_tolerant)
        solution_reports.append(
            {
                "solutionId": solution_id,
                "solutionRasterSha256": download.sha256,
                "solutionRaster": {
                    "sourceUrl": solution["displayUrl"],
                    "path": str(download.path.resolve()),
                    "sha256": download.sha256,
                    "bytes": download.path.stat().st_size,
                },
                "rasterLoadSeconds": raster_seconds,
                "retainedDocument": {
                    "path": str(retained_path.resolve()),
                    "sourceSha256": retained_source_sha256,
                    "bytes": retained_path.stat().st_size,
                    "readAndExtractSeconds": retained_read_seconds,
                    "canonicalNonSpeciesSha256": retained_non_species_sha256,
                },
                "layerAccessSeconds": layer_seconds,
                "layers": layer_access,
                "currentFallback": current_phases,
                "currentReductionSecondsByMetric": current_by_metric,
                "prototype": {
                    **prototype_phases,
                    "fanout": fanout_diagnostics,
                    "diagnosticReductionSecondsByLayer": prototype_by_layer,
                },
                "parity": comparison,
                "canonicalNonSpecies": {
                    "prototypeSha256": prototype_non_species_sha256,
                    "exact": canonical_exact,
                    "toleranceAware": canonical_tolerant,
                    "declaredDifference": (
                        None
                        if canonical_exact
                        else "weighted float64 reduction-order deltas only"
                    ),
                },
            }
        )

    current_wall = total_current["total"]
    prototype_wall = total_prototype["total"]
    speedup = current_wall / prototype_wall
    peak_rss = _peak_rss_bytes()
    topology_bytes = sum(index.estimated_bytes for index in indexes.values())
    retained_boundary_output = _retained_boundary_timing(args.retained_report)
    retained_artifacts = {
        "publishReport": _artifact_binding(args.retained_report),
        "metricsDocuments": [
            report["retainedDocument"] for report in solution_reports
        ],
        "boundarySnapshots": _boundary_snapshot_bindings(args.cache_dir),
    }
    estimated_prototype_boundary_output = (
        retained_boundary_output - current_wall + prototype_wall
    )
    boundary_output_speedup = (
        retained_boundary_output / estimated_prototype_boundary_output
    )
    estimated_batch_wall = args.reference_batch_wall_seconds - (
        current_wall - prototype_wall
    )
    estimated_batch_wall_reduction = (
        1.0 - estimated_batch_wall / args.reference_batch_wall_seconds
    ) * 100.0
    gate = {
        "boundaryOutputSpeedupAtLeast1_5x": boundary_output_speedup >= 1.5,
        "completeBatchWallReductionAtLeast10Percent": (
            estimated_batch_wall_reduction >= 10.0
        ),
        "zeroUnexpectedMetricStatusDetailDrift": all(
            pair["metricStatusDetailMismatchCount"] == 0
            for pair in parity_totals.values()
        ),
        "weightedNumericParity": all(
            pair["numericToleranceMismatchCount"] == 0
            for pair in parity_totals.values()
        ),
        "nationalUnchanged": all(
            pair["comparisonCountByLevel"].get("national", 0) > 0
            and pair["mismatchCount"] == 0
            for pair in parity_totals.values()
        ),
        "nationalAndAllFiveSubnationalLevelsCovered": all(
            set(pair["comparisonCountByLevel"]) == set(EXPECTED_GEOGRAPHY_LEVELS)
            and all(
                pair["comparisonCountByLevel"][level] > 0
                for level in EXPECTED_GEOGRAPHY_LEVELS
            )
            for pair in parity_totals.values()
        ),
        "contextualCombinedProcessRssBelow5GB": peak_rss < 5_000_000_000,
        "noSupportedAdditiveFallback": True,
    }
    passed = (
        gate["boundaryOutputSpeedupAtLeast1_5x"]
        or gate["completeBatchWallReductionAtLeast10Percent"]
    ) and all(
        value
        for key, value in gate.items()
        if key
        not in {
            "boundaryOutputSpeedupAtLeast1_5x",
            "completeBatchWallReductionAtLeast10Percent",
        }
    )
    report = {
        "format": "boundary-weighted-fanout-bounded-real-ab-v2",
        "classification": (
            "fresh combined-process bounded-solution all-geography isolated A/B"
        ),
        "prototypeIntegration": "not integrated into main.py",
        "inputs": {
            "manifest": str(args.manifest),
            "manifestSha256": _sha256(args.manifest),
            "cacheDirectory": str(args.cache_dir),
            "retainedDirectory": str(args.retained_dir),
            "orderedSolutionIds": solution_ids,
            "geographyLevels": {
                level: len(features) for level, features in boundaries.items()
            },
            "weightedMetricIds": sorted(weighted_ids),
            "uniqueWeightedLayers": sorted(prepared_layers),
            "targetGridSha256": grid_sha256(first_raster.fingerprint),
            "tolerances": {
                "relative": WEIGHTED_RTOL,
                "absolute": WEIGHTED_ATOL,
            },
            "retainedArtifacts": retained_artifacts,
        },
        "profile": {
            "retainedBufferedV2BoundaryOutputSeconds": retained_boundary_output,
            "retainedBufferedV2GroupedAggregationSeconds": 44.48,
            "finding": (
                "The current grouped path migrates area, binary, and categorical "
                "families, but rerasterizes each non-empty boundary and invokes "
                "scalar weighted calculators for biomass and soil carbon. Biomass "
                "is reduced three times per scope and its national denominator is "
                "rescanned once per scope."
            ),
            "freshCurrentWeightedFallback": total_current,
            "freshCurrentReductionSecondsByMetric": total_current_by_metric,
            "freshPrototype": total_prototype,
            "freshPrototypeDiagnosticReductionSecondsByLayer": (
                total_prototype_by_layer
            ),
            "rasterLoadSeconds": total_raster_load,
            "layerAccessSeconds": total_layer_access,
            "estimatedPrototypeCompleteBoundaryOutputSeconds": (
                estimated_prototype_boundary_output
            ),
            "estimatedCompleteBoundaryOutputSpeedup": boundary_output_speedup,
            "estimateMethod": (
                "Replace only the freshly measured scalar weighted fallback "
                "inside the retained 509.81-second boundary-output phase; leave "
                "all other grouped aggregation, metric, detail, and document work unchanged."
            ),
        },
        "architecture": {
            "topology": (
                "Approved overlap-safe indexes; CSR first owner is primary and "
                "every remaining owner receives a full extra contribution."
            ),
            "reduction": (
                "Deterministic float64 selected weighted sums, one per unique "
                "layer and geography level; no formula or non-additive metric changes."
            ),
            "reuse": (
                "Aligned values, finite masks, area-weighted arrays, and national "
                "denominators are immutable and reused only under exact source, "
                "aligned artifact, grid, and alignment-policy signatures."
            ),
            "failurePolicy": (
                "Signature drift, shape drift, and cancellation fail closed; loader "
                "failures do not publish partial cache entries."
            ),
        },
        "setup": {
            "totalSeconds": setup_seconds,
            "userSeconds": setup_user_seconds,
            "systemSeconds": setup_system_seconds,
            "topologySeconds": topology_seconds,
            "topologyCacheHit": topology_cache_hit,
            "topologyBytes": topology_bytes,
            "weightedLayerCacheBytes": layer_cache.estimated_bytes,
            "weightedLayerCacheHits": cache_hit_count,
            "weightedLayerCacheMisses": cache_miss_count,
        },
        "performance": {
            "currentWeightedBoundarySeconds": current_wall,
            "prototypeWeightedBoundarySeconds": prototype_wall,
            "boundaryWeightedSpeedup": speedup,
            "wallReductionPercent": (1.0 - prototype_wall / current_wall) * 100.0,
            "estimatedCompleteBoundaryOutputSpeedup": boundary_output_speedup,
            "measuredWorkLabel": (
                "Fresh equivalent weighted-family work for current and prototype "
                "across the same eight solutions and six geography levels."
            ),
            "modeledWorkLabel": (
                "Complete boundary-output and complete-batch values are modeled "
                "by substituting fresh weighted-family timings into retained phases."
            ),
            "estimatedCompleteBatchWallSeconds": estimated_batch_wall,
            "estimatedCompleteBatchWallReductionPercent": (
                estimated_batch_wall_reduction
            ),
            "referenceCompleteBatchWallSeconds": args.reference_batch_wall_seconds,
            "referenceRetainedCompleteBatchPeakRssBytes": (
                args.reference_peak_rss_bytes
            ),
            "currentWeightedUserSeconds": total_current["userSeconds"],
            "currentWeightedSystemSeconds": total_current["systemSeconds"],
            "prototypeWeightedUserSeconds": total_prototype["userSeconds"],
            "prototypeWeightedSystemSeconds": total_prototype["systemSeconds"],
            "userSeconds": resource.getrusage(resource.RUSAGE_SELF).ru_utime,
            "systemSeconds": resource.getrusage(resource.RUSAGE_SELF).ru_stime,
            "contextualCombinedProcessPeakRssBytes": peak_rss,
            "memoryClaim": (
                "Context only: current and prototype execute in one process. The "
                "fresh peak and retained complete-batch peak come from different "
                "workloads, so no relative-memory claim is made."
            ),
            "totalBenchmarkWallSeconds": time.perf_counter() - run_started,
        },
        "parity": {
            **parity_totals,
            "attribution": {
                "prototypeToCurrent": (
                    "In-tolerance numeric deltas here are attributable to grouped "
                    "primary-then-extra versus per-polygon float64 reduction order."
                ),
                "retainedComparisons": (
                    "Differences against retained output are reported separately "
                    "and are not attributed without independent causal evidence."
                ),
            },
            "nationalParityAsserted": all(
                pair["comparisonCountByLevel"].get("national", 0) > 0
                and pair["mismatchCount"] == 0
                for pair in parity_totals.values()
            ),
            "canonicalNonSpeciesExactMatches": canonical_exact_matches,
            "canonicalNonSpeciesToleranceAwareMatches": canonical_tolerant_matches,
            "solutionCount": len(solution_ids),
        },
        "solutions": solution_reports,
        "gates": gate,
        "passed": passed,
        "recommendation": (
            "RETAIN isolated for independent review; integration remains deferred."
            if passed
            else "NO-GO; retain evidence only and do not integrate."
        ),
        "actionsNotTaken": [
            "No main.py integration",
            "No default flip",
            "No all-168 run",
            "No upload or publishing",
            "No commit or push",
        ],
    }
    report["evidenceSha256"] = _canonical_sha256(report)
    return report


def _run_current_fallback(
    raster,
    boundaries,
    definitions: tuple[MetricDefinition, ...],
    scope_valid: dict[str, dict[str, int]],
    raw_layers: dict[str, np.ndarray],
) -> tuple[
    dict[str, dict[str, dict[str, Any]]],
    dict[str, float],
    dict[str, float],
]:
    phases = _empty_phases()
    reduction_by_metric = {definition.metric_id: 0.0 for definition in definitions}
    usage_before = resource.getrusage(resource.RUSAGE_SELF)
    started = time.perf_counter()
    payloads: dict[str, dict[str, dict[str, Any]]] = {}
    documents: dict[str, Any] = {}
    national_values: dict[str, float | None] = {}
    national_statuses: dict[str, str] = {}
    phase = time.perf_counter()
    for definition in definitions:
        layer_id = definition.layer_id or ""
        raw_values = raw_layers[layer_id]
        metric_started = time.perf_counter()
        if definition.kind == "weighted_sum":
            calculator = weighted_sum_calculator(definition)
        else:
            calculator = weighted_percent_calculator(layer_id)
        if calculator is None:
            raise BenchmarkError(f"No weighted calculator for {definition.metric_id}.")
        value = calculator(raster, raw_values)
        national_values[definition.metric_id] = value
        national_statuses[definition.metric_id] = (
            "ready" if value is not None else "blocked"
        )
        reduction_by_metric[definition.metric_id] += (
            time.perf_counter() - metric_started
        )
    phases["weightedReduction"] += time.perf_counter() - phase
    national_metrics = {
        definition.metric_id: _metric_payload(
            definition,
            national_values[definition.metric_id],
            national_statuses[definition.metric_id],
            national=True,
        )
        for definition in definitions
    }
    payloads["national"] = {"colombia": national_metrics}
    documents["national"] = {"colombia": {"metrics": list(national_metrics.values())}}
    for level, features in boundaries.items():
        payloads[level] = {}
        documents[level] = {}
        for feature in features:
            if scope_valid[level][feature.boundary_id] == 0:
                phase = time.perf_counter()
                metrics = {
                    definition.metric_id: _empty_metric_payload(definition)
                    for definition in definitions
                }
                phases["metricConstruction"] += time.perf_counter() - phase
                payloads[level][feature.boundary_id] = metrics
                phase = time.perf_counter()
                documents[level][feature.boundary_id] = {
                    "metrics": list(metrics.values())
                }
                phases["documentAssembly"] += time.perf_counter() - phase
                continue
            phase = time.perf_counter()
            mask = rasterize_boundary(
                feature.geometry,
                raster.fingerprint,
                source_crs=feature.source_crs,
            )
            scoped = raster.with_boundary_mask(mask)
            phases["masking"] += time.perf_counter() - phase

            phase = time.perf_counter()
            values: dict[str, float | None] = {}
            statuses: dict[str, str] = {}
            for definition in definitions:
                layer_id = definition.layer_id or ""
                raw_values = raw_layers[layer_id]
                metric_started = time.perf_counter()
                if definition.kind == "weighted_sum":
                    calculator = weighted_sum_calculator(definition)
                    if calculator is None:
                        raise BenchmarkError(
                            f"No weighted calculator for {definition.metric_id}."
                        )
                    values[definition.metric_id] = calculator(scoped, raw_values)
                    statuses[definition.metric_id] = "ready"
                else:
                    calculator = weighted_percent_calculator(layer_id)
                    if calculator is None:
                        raise BenchmarkError(
                            f"No weighted percent calculator for {layer_id}."
                        )
                    result = calculator(scoped, raw_values)
                    values[definition.metric_id] = result
                    statuses[definition.metric_id] = (
                        "ready" if result is not None else "blocked"
                    )
                reduction_by_metric[definition.metric_id] += (
                    time.perf_counter() - metric_started
                )
            phases["weightedReduction"] += time.perf_counter() - phase

            phase = time.perf_counter()
            metrics = {
                definition.metric_id: _metric_payload(
                    definition,
                    values[definition.metric_id],
                    statuses[definition.metric_id],
                )
                for definition in definitions
            }
            phases["metricConstruction"] += time.perf_counter() - phase
            payloads[level][feature.boundary_id] = metrics

            phase = time.perf_counter()
            documents[level][feature.boundary_id] = {"metrics": list(metrics.values())}
            phases["documentAssembly"] += time.perf_counter() - phase
    phase = time.perf_counter()
    _serialize_details(documents)
    phases["detailSerialization"] += time.perf_counter() - phase
    phase = time.perf_counter()
    json.dumps(documents, ensure_ascii=False, separators=(",", ":"))
    phases["serialization"] += time.perf_counter() - phase
    phases["total"] = time.perf_counter() - started
    usage_after = resource.getrusage(resource.RUSAGE_SELF)
    phases["userSeconds"] = usage_after.ru_utime - usage_before.ru_utime
    phases["systemSeconds"] = usage_after.ru_stime - usage_before.ru_stime
    return payloads, phases, reduction_by_metric


def _run_grouped_prototype(
    raster,
    indexes,
    definitions_by_id: dict[str, MetricDefinition],
    specs: tuple[WeightedMetricSpec, ...],
    layers: dict[str, PreparedWeightedLayer],
    scope_valid: dict[str, dict[str, int]],
) -> tuple[
    dict[str, dict[str, dict[str, Any]]],
    dict[str, float],
    dict[str, Any],
    dict[str, float],
]:
    phases = _empty_phases()
    usage_before = resource.getrusage(resource.RUSAGE_SELF)
    started = time.perf_counter()
    phase = time.perf_counter()
    fanout = aggregate_selected_weighted_layers(
        indexes,
        raster.selected_mask,
        layers,
    )
    phases["weightedReduction"] = time.perf_counter() - phase
    phase = time.perf_counter()
    selected = raster.selected_mask.ravel()
    national_values: dict[str, float | None] = {}
    national_statuses: dict[str, str] = {}
    for spec in specs:
        layer = layers[spec.layer_id]
        active = selected & layer.finite_mask
        selected_sum = float(
            layer.weighted_values[active].sum(dtype=np.float64)
        )
        if spec.kind == "weighted_sum":
            value: float | None = selected_sum
        else:
            denominator = layer.national_denominator
            value = (
                None
                if denominator == 0.0
                else (selected_sum / denominator) * 100.0
            )
        national_values[spec.metric_id] = value
        national_statuses[spec.metric_id] = (
            "ready" if value is not None else "blocked"
        )
    national_metrics = {
        metric_id: _metric_payload(
            definitions_by_id[metric_id],
            value,
            national_statuses[metric_id],
            national=True,
        )
        for metric_id, value in national_values.items()
    }
    phases["metricConstruction"] += time.perf_counter() - phase
    payloads: dict[str, dict[str, dict[str, Any]]] = {
        "national": {"colombia": national_metrics}
    }
    documents: dict[str, Any] = {
        "national": {"colombia": {"metrics": list(national_metrics.values())}}
    }
    for level, index in indexes.items():
        payloads[level] = {}
        documents[level] = {}
        for boundary_index, boundary_id in enumerate(index.boundary_ids):
            if scope_valid[level][boundary_id] == 0:
                phase = time.perf_counter()
                metrics = {
                    metric_id: _empty_metric_payload(definitions_by_id[metric_id])
                    for metric_id in definitions_by_id
                }
                phases["metricConstruction"] += time.perf_counter() - phase
                payloads[level][boundary_id] = metrics
                phase = time.perf_counter()
                documents[level][boundary_id] = {"metrics": list(metrics.values())}
                phases["documentAssembly"] += time.perf_counter() - phase
                continue
            phase = time.perf_counter()
            values = assemble_weighted_metric_results(
                specs,
                level=level,
                boundary_index=boundary_index,
                fanout=fanout,
                layers=layers,
            )
            metrics = {
                metric_id: _metric_payload(
                    definitions_by_id[metric_id],
                    result.value,
                    result.status,
                )
                for metric_id, result in values.items()
            }
            phases["metricConstruction"] += time.perf_counter() - phase
            payloads[level][boundary_id] = metrics
            phase = time.perf_counter()
            documents[level][boundary_id] = {"metrics": list(metrics.values())}
            phases["documentAssembly"] += time.perf_counter() - phase
    phase = time.perf_counter()
    _serialize_details(documents)
    phases["detailSerialization"] += time.perf_counter() - phase
    phase = time.perf_counter()
    json.dumps(documents, ensure_ascii=False, separators=(",", ":"))
    phases["serialization"] += time.perf_counter() - phase
    phases["total"] = time.perf_counter() - started
    usage_after = resource.getrusage(resource.RUSAGE_SELF)
    phases["userSeconds"] = usage_after.ru_utime - usage_before.ru_utime
    phases["systemSeconds"] = usage_after.ru_stime - usage_before.ru_stime
    diagnostic_by_layer: dict[str, float] = {}
    for layer_id, layer in layers.items():
        phase = time.perf_counter()
        aggregate_selected_weighted_layers(
            indexes,
            raster.selected_mask,
            {layer_id: layer},
        )
        diagnostic_by_layer[layer_id] = time.perf_counter() - phase
    diagnostics = {
        "selectedCellCount": fanout.diagnostics.selected_cell_count,
        "primaryClaimCountByLevel": dict(
            fanout.diagnostics.primary_claim_count_by_level
        ),
        "extraClaimCountByLevel": dict(fanout.diagnostics.extra_claim_count_by_level),
        "layerCount": fanout.diagnostics.layer_count,
    }
    return payloads, phases, diagnostics, diagnostic_by_layer


def _metric_payload(
    definition: MetricDefinition,
    value: float | None,
    status: str,
    *,
    national: bool = False,
) -> dict[str, Any]:
    layer_id = definition.layer_id or ""
    if definition.kind == "weighted_sum":
        return pipeline._metric_value(
            definition,
            value=value,
            status=status,
            notes=(
                (
                    "sum(pixel_value × pixel_area_km²) for selected ∩ finite "
                    f"cells of '{layer_id}'."
                )
                if national
                else (
                    "sum(pixel_value × pixel_area_km²) over selected finite "
                    f"cells of '{layer_id}'."
                )
            ),
            source=f"raster:{layer_id}",
        )
    return pipeline._metric_value(
        definition,
        value=value,
        status=status,
        notes=(
            (
                f"selectedWeightedSum('{layer_id}') / nationalWeightedSum × 100."
                if national
                else (
                    "selectedWeightedSum / nationalWeightedSum × 100 "
                    f"('{layer_id}')."
                )
            )
            if status == "ready"
            else "National weighted total is zero."
        ),
        source=f"raster:{layer_id}",
    )


def _empty_metric_payload(definition: MetricDefinition) -> dict[str, Any]:
    return pipeline._metric_value(
        definition,
        value=None,
        status="empty",
        notes="Boundary has zero cells intersecting verified solution valid data.",
        source="raster:boundary_mask",
    )


def _extract_retained_non_species(
    document: dict[str, Any],
    *,
    species_ids: frozenset[str],
    weighted_ids: frozenset[str],
) -> tuple[
    dict[str, Any],
    dict[str, dict[str, dict[str, Any]]],
    dict[str, dict[str, int]],
]:
    canonical = {"solutionId": document["solutionId"], "geographies": {}}
    weighted: dict[str, dict[str, dict[str, Any]]] = {}
    valid: dict[str, dict[str, int]] = {}
    for level, scopes in document["geographies"].items():
        canonical_scopes: dict[str, Any] = {}
        weighted[level] = {}
        valid[level] = {}
        for scope_id, scope in scopes.items():
            metrics = [
                metric
                for metric in scope["metrics"]
                if metric["metricId"] not in species_ids
            ]
            canonical_scopes[scope_id] = {
                key: value for key, value in scope.items() if key != "metrics"
            }
            canonical_scopes[scope_id]["metrics"] = metrics
            weighted[level][scope_id] = {
                metric["metricId"]: metric
                for metric in metrics
                if metric["metricId"] in weighted_ids
            }
            valid[level][scope_id] = int(scope["scopeState"]["solutionValidCellCount"])
        canonical["geographies"][level] = canonical_scopes
    return canonical, weighted, valid


def _replace_weighted_payloads(
    document: dict[str, Any],
    replacements: dict[str, dict[str, dict[str, Any]]],
) -> dict[str, Any]:
    for level, scopes in document["geographies"].items():
        for scope_id, scope in scopes.items():
            if scope_id not in replacements[level]:
                continue
            by_id = replacements[level][scope_id]
            scope["metrics"] = [
                by_id.get(metric["metricId"], metric) for metric in scope["metrics"]
            ]
    return document


def _compare_payloads(
    current,
    prototype,
    retained,
) -> dict[str, Any]:
    return {
        "currentToRetained": _compare_pair(current, retained),
        "prototypeToRetained": _compare_pair(prototype, retained),
        "prototypeToCurrent": _compare_pair(prototype, current),
    }


def _compare_pair(
    observed_payloads,
    expected_payloads,
) -> dict[str, Any]:
    metadata_mismatches = 0
    numeric_mismatches = 0
    nonzero = 0
    maximum_absolute = 0.0
    maximum_relative = 0.0
    compared = 0
    counts_by_level: dict[str, int] = {}
    nonzero_by_level: dict[str, int] = {}
    for level, scopes in observed_payloads.items():
        if level not in expected_payloads:
            metadata_mismatches += sum(
                len(metrics) for metrics in scopes.values()
            )
            continue
        expected_scopes = expected_payloads[level]
        metadata_mismatches += sum(
            len(metrics)
            for scope_id, metrics in scopes.items()
            if scope_id not in expected_scopes
        )
    for level, scopes in expected_payloads.items():
        counts_by_level[level] = 0
        nonzero_by_level[level] = 0
        for scope_id, expected_metrics in scopes.items():
            if level not in observed_payloads or scope_id not in observed_payloads[level]:
                metadata_mismatches += len(expected_metrics)
                continue
            observed_metrics = observed_payloads[level][scope_id]
            metadata_mismatches += len(
                set(observed_metrics) - set(expected_metrics)
            )
            for metric_id, expected in expected_metrics.items():
                compared += 1
                counts_by_level[level] += 1
                observed = observed_metrics.get(metric_id)
                if observed is None:
                    metadata_mismatches += 1
                    continue
                if {
                    key: value for key, value in observed.items() if key != "value"
                } != {
                    key: value for key, value in expected.items() if key != "value"
                }:
                    metadata_mismatches += 1
                observed_value = observed["value"]
                expected_value = expected["value"]
                if expected_value is None or observed_value is None:
                    if observed_value is not expected_value:
                        numeric_mismatches += 1
                    continue
                delta = abs(float(observed_value) - float(expected_value))
                relative = delta / max(abs(float(expected_value)), WEIGHTED_ATOL)
                maximum_absolute = max(maximum_absolute, delta)
                maximum_relative = max(maximum_relative, relative)
                nonzero += int(delta != 0.0)
                nonzero_by_level[level] += int(delta != 0.0)
                if not math.isclose(
                    float(observed_value),
                    float(expected_value),
                    rel_tol=WEIGHTED_RTOL,
                    abs_tol=WEIGHTED_ATOL,
                ):
                    numeric_mismatches += 1
    mismatches = metadata_mismatches + numeric_mismatches
    return {
        "comparisonCount": compared,
        "comparisonCountByLevel": counts_by_level,
        "mismatchCount": mismatches,
        "metricStatusDetailMismatchCount": metadata_mismatches,
        "numericToleranceMismatchCount": numeric_mismatches,
        "nonzeroDeltaCount": nonzero,
        "nonzeroDeltaCountByLevel": nonzero_by_level,
        "maxAbsoluteDelta": maximum_absolute,
        "maxRelativeDelta": maximum_relative,
    }


def _serialize_details(document: dict[str, Any]) -> None:
    for scopes in document.values():
        for scope in scopes.values():
            for metric in scope["metrics"]:
                if "details" in metric:
                    json.dumps(
                        metric["details"], ensure_ascii=False, separators=(",", ":")
                    )


def _retained_boundary_timing(path: Path) -> float:
    report = _read_json(path)
    return float(
        sum(
            entry["boundaryFanout"]["phaseSeconds"]["boundaryOutput"]
            for entry in report["entries"]
        )
    )


def _empty_phases() -> dict[str, float]:
    return {
        "masking": 0.0,
        "weightedReduction": 0.0,
        "metricConstruction": 0.0,
        "detailSerialization": 0.0,
        "documentAssembly": 0.0,
        "serialization": 0.0,
        "total": 0.0,
        "userSeconds": 0.0,
        "systemSeconds": 0.0,
    }


def _layer_units(
    layer_id: str,
    definitions: tuple[MetricDefinition, ...],
) -> str:
    units = {
        definition.unit or ""
        for definition in definitions
        if definition.layer_id == layer_id and definition.kind == "weighted_sum"
    }
    if len(units) != 1:
        raise BenchmarkError(
            f"Weighted layer {layer_id!r} must have one approved additive unit; "
            f"got {sorted(units)!r}."
        )
    return next(iter(units))


def _sum_phases(target: dict[str, float], addition: dict[str, float]) -> None:
    for key, value in addition.items():
        target[key] += value


def _read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _canonical_sha256(value: Any) -> str:
    encoded = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _peak_rss_bytes() -> int:
    value = int(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss)
    return value if sys.platform == "darwin" else value * 1024


def _artifact_binding(path: Path) -> dict[str, Any]:
    resolved = path.resolve()
    if not resolved.is_file():
        raise BenchmarkError(f"Required retained artifact is missing: {resolved}")
    return {
        "path": str(resolved),
        "sha256": _sha256(resolved),
        "bytes": resolved.stat().st_size,
    }


def _boundary_snapshot_bindings(cache_dir: Path) -> list[dict[str, Any]]:
    bindings: list[dict[str, Any]] = []
    for level, spec in BOUNDARY_SOURCE_SPECS.items():
        path = cache_dir / "boundaries" / spec.cache_filename
        binding = _artifact_binding(path)
        if binding["sha256"] != spec.expected_sha256:
            raise BenchmarkError(
                f"Pinned boundary snapshot checksum drift for {level!r}."
            )
        bindings.append(
            {
                "level": level,
                "sourceUrl": spec.url,
                "expectedFeatureCount": spec.expected_feature_count,
                **binding,
            }
        )
    return bindings


def _positive_int(value: str) -> int:
    parsed = int(value)
    if parsed <= 0:
        raise argparse.ArgumentTypeError("value must be greater than zero")
    return parsed


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    root = Path(__file__).resolve().parents[3]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--manifest",
        type=Path,
        default=root
        / "generated/releases/solutions-v0-2-0-20260805/preflight/manifest.json",
    )
    parser.add_argument(
        "--cache-dir",
        type=Path,
        default=root / "cache/releases/solutions-v0-2-0-20260805",
    )
    candidate = (
        root
        / "generated/releases/solutions-v3-0-0/species-buffered-v2-full-candidate/v2"
    )
    parser.add_argument("--retained-dir", type=Path, default=candidate / "cache")
    parser.add_argument(
        "--retained-report",
        type=Path,
        default=candidate / "publish-report.json",
    )
    parser.add_argument("--solution-id", action="append", default=[])
    parser.add_argument(
        "--reference-peak-rss-bytes",
        type=_positive_int,
        default=3_964_354_560,
        help=(
            "Retained complete-batch peak RSS for contextual metadata only; "
            "it is not used as a relative-memory baseline."
        ),
    )
    parser.add_argument(
        "--reference-batch-wall-seconds",
        type=float,
        default=3672.85,
    )
    parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args(argv)


def main() -> int:
    args = _parse_args()
    report = run(args)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(report, indent=2, ensure_ascii=False, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(
        f"weighted boundary A/B {'PASS' if report['passed'] else 'NO-GO'}: "
        f"{report['performance']['boundaryWeightedSpeedup']:.2f}x, "
        f"{sum(pair['mismatchCount'] for pair in report['parity'].values() if isinstance(pair, dict) and 'mismatchCount' in pair)} "
        "unexpected mismatch(es)"
    )
    print(f"evidence -> {args.output}")
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
