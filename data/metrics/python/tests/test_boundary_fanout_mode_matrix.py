from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import main as pipeline
import numpy as np
import pytest
from blob_manifest import ResolvedManifest
from boundaries.boundary_id_grid import BoundaryIdGridCache
from boundaries.boundary_loader import (
    BOUNDARY_SOURCE_SPECS,
    BoundaryFeature,
    BoundarySourceMetadata,
    canonical_geometry_sha256,
)
from boundaries.boundary_mask import BoundaryMaskCache
from boundaries.boundary_topology import BoundaryTopologyCache, OverlapBoundaryIndex
from boundaries.boundary_weighted_fanout import PreparedWeightedLayer
from local_io import CachedDownload
from metric_definitions import computable_metrics
from metrics_contract import build_metrics_provenance
from raster_metrics import RasterFingerprint, SolutionRaster
from solution_catalog import SolutionCatalogEntry
from solution_input_signature import build_solution_input_signature

_AREA_ABS_TOL = 1e-6
_PERCENT_ABS_TOL = 1e-9
_WEIGHTED_ABS_TOL = 1e-6
_WEIGHTED_REL_TOL = 1e-12


class _SyntheticLayerMaskCache:
    def __init__(self, masks: dict[str, np.ndarray], source_mode: str):
        self.masks = masks
        self.source_mode = source_mode
        self.requests: list[tuple[str, str]] = []

    def get(self, layer_id: str, *_args, **_kwargs) -> np.ndarray:
        self.requests.append((layer_id, self.source_mode))
        return self.masks[layer_id]


class _SyntheticLayerValueCache:
    def __init__(self, values: dict[str, np.ndarray]):
        self.values = values

    def get(self, layer_id: str, *_args, **_kwargs) -> np.ndarray:
        return self.values[layer_id]

    def get_prepared_weighted(
        self,
        layer_id: str,
        _url: str,
        raster: SolutionRaster,
        _cache_dir: Path,
        _force: bool,
        cache,
        *,
        value_units: str,
    ):
        del value_units
        values = self.values[layer_id]
        finite = np.isfinite(values)
        weighted = np.zeros_like(values, dtype=np.float64)
        np.multiply(
            values,
            raster.pixel_area_km2_per_row[:, np.newaxis],
            out=weighted,
            where=finite,
        )
        return (
            PreparedWeightedLayer(
                identity=SimpleNamespace(
                    layer_id=layer_id,
                    value_units="Mg·km²",
                    metric_registry_policy_version=(
                        pipeline.WEIGHTED_METRIC_REGISTRY_POLICY_VERSION
                    ),
                ),
                weighted_values=weighted.ravel(),
                finite_mask=finite.ravel(),
                national_denominator=float(weighted[finite].sum()),
            ),
            cache.entry_count > 0,
        )


def _polygon(x_min: float, y_min: float, x_max: float, y_max: float) -> dict:
    return {
        "type": "Polygon",
        "coordinates": [
            [
                [x_min, y_min],
                [x_max, y_min],
                [x_max, y_max],
                [x_min, y_max],
                [x_min, y_min],
            ]
        ],
    }


def _feature(
    level: str,
    boundary_id: str,
    geometry: dict,
    *,
    properties: dict[str, Any] | None = None,
) -> BoundaryFeature:
    spec = BOUNDARY_SOURCE_SPECS[level]
    metadata = BoundarySourceMetadata(
        url=spec.url,
        sha256=spec.expected_sha256,
        crs=spec.expected_crs,
        feature_count=spec.expected_feature_count,
        id_field=spec.id_field,
        name_field=spec.name_field,
        catalog_sha256=spec.expected_catalog_sha256,
        geometry_collection_sha256=spec.expected_geometry_collection_sha256,
        feature_behavior=spec.feature_behavior,
    )
    return BoundaryFeature(
        boundary_id=boundary_id,
        name=boundary_id.title(),
        geo_level=level,
        geometry=geometry,
        properties=properties or {},
        source_crs="EPSG:4326",
        source_metadata=metadata,
        geometry_sha256=canonical_geometry_sha256(geometry),
    )


def _boundaries(*, overlapping_departments: bool) -> dict[str, list[BoundaryFeature]]:
    first = _polygon(0.0, 1.0, 2.0, 2.0)
    second = (
        _polygon(1.0, 1.0, 3.0, 2.0)
        if overlapping_departments
        else _polygon(0.0, 0.0, 2.0, 1.0)
    )
    whole = _polygon(0.0, 0.0, 3.0, 2.0)
    return {
        "departments": [
            _feature("departments", "department-a", first),
            _feature("departments", "department-b", second),
        ],
        "municipalities": [_feature("municipalities", "municipality-a", whole)],
        "siraps": [
            _feature(
                "siraps",
                "sirap-a",
                whole,
                properties={"sirap_kind": "territorial"},
            )
        ],
        "runaps": [
            _feature(
                "runaps",
                "runap-a",
                whole,
                properties={"runap_category": "national"},
            )
        ],
        "omecs": [
            _feature(
                "omecs",
                "omec-a",
                whole,
                properties={"DESIG": "other-effective-measure"},
            )
        ],
    }


def _raster() -> SolutionRaster:
    fingerprint = RasterFingerprint(
        width=3,
        height=2,
        transform=(1.0, 0.0, 0.0, 0.0, -1.0, 2.0),
        crs="EPSG:4326",
    )
    new = np.array([[True, False, False], [False, True, False]])
    pre_existing = np.array([[False, True, False], [False, False, False]])
    selected = new | pre_existing
    valid = np.array([[True, True, False], [True, True, True]])
    return SolutionRaster(
        path=Path("/dev/null"),
        selected_mask=selected,
        valid_mask=valid,
        pixel_area_km2_per_row=np.array([1.0, 2.0]),
        fingerprint=fingerprint,
        selected_cells=int(selected.sum()),
        valid_cells=int(valid.sum()),
        new_prioritizr_mask=new,
        pre_existing_mask=pre_existing,
    )


def _definitions():
    by_id = {definition.metric_id: definition for definition in computable_metrics()}
    return tuple(
        by_id[metric_id]
        for metric_id in (
            "ecosystem_coverage",
            "carbon_storage_biomass",
            "carbon_biomass_total",
            "soil_organic_carbon",
            "carbon_pct_of_national",
            "national_contribution",
            "priority_area_in_region",
            "priority_area_pct_of_region",
            "ecosystem_coverage_paramo",
            "indigenous_reservations_area",
            "indigenous_territory_pct",
        )
    )


def _manifest(solution: dict[str, Any]) -> ResolvedManifest:
    layers = {
        "ecosistemas_IAVH_2024": {},
        "biomasa": {},
        "carbono_organico": {},
        "paramos": {"rendering": {"valueType": "binary", "selectedValue": 1}},
        "resguardos": {"rendering": {"valueType": "binary", "selectedValue": 1}},
    }
    for layer_id, layer in layers.items():
        layer.update(
            {
                "id": layer_id,
                "displayUrl": f"https://example.test/{layer_id}.tif",
            }
        )
    return ResolvedManifest(
        url="https://example.test/manifest.json",
        raw={},
        public_blob_host="https://example.test",
        layers_by_id=layers,
        national_solutions=[solution],
        batch_solutions=[solution],
    )


def _run_document(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    *,
    fanout_mode: str,
    layer_source_mode: str,
    overlapping_departments: bool,
    weighted_mode: str = "scalar",
) -> tuple[dict[str, Any], dict[str, Any], BoundaryTopologyCache, list[tuple[str, str]]]:
    raster = _raster()
    solution = {
        "id": "synthetic-mode-matrix",
        "domain": "land",
        "scope": "land",
        "displayUrl": "https://example.test/solution.tif",
        "blobPath": "solutions/solution.tif",
    }
    manifest = _manifest(solution)
    definitions = _definitions()
    monkeypatch.setattr(pipeline, "computable_metrics", lambda: definitions)
    monkeypatch.setattr(pipeline, "_utc_now_iso", lambda: "2026-08-19T00:00:00Z")
    monkeypatch.setenv("METRICS_LAYER_SOURCE", layer_source_mode)

    layer_masks = {
        "paramos": np.array([[True, False, False], [True, True, False]]),
        "resguardos": np.array([[False, True, False], [False, True, True]]),
    }
    layer_values = {
        "ecosistemas_IAVH_2024": np.array(
            [[1.0, 430.0, np.nan], [431.0, 2.0, 0.0]]
        ),
        "biomasa": np.array([[2.0, 3.0, np.nan], [5.0, 7.0, 11.0]]),
        "carbono_organico": np.array(
            [[13.0, 17.0, np.nan], [19.0, 23.0, 29.0]]
        ),
    }
    mask_cache = _SyntheticLayerMaskCache(layer_masks, layer_source_mode)
    value_cache = _SyntheticLayerValueCache(layer_values)
    topology_cache = BoundaryTopologyCache()
    provenance = build_metrics_provenance(
        "land",
        skip_species=True,
        boundary_fanout_mode=fanout_mode,
        weighted_execution_mode=weighted_mode,
    )
    signature = build_solution_input_signature(
        solution=solution,
        catalog_entry=SolutionCatalogEntry(
            solution_id=solution["id"],
            solution_basename="solution.tif",
            domain="land",
            raster_sha256="a" * 64,
        ),
        manifest=manifest,
        metrics_provenance=provenance,
        source_identity={"synthetic": True},
    )

    serialized_path = tmp_path / (
        f"{fanout_mode}-{layer_source_mode}-"
        f"{'overlap' if overlapping_departments else 'exclusive'}.metrics.json"
    )

    def serialize_document(**kwargs) -> Path:
        serialized_path.write_text(
            json.dumps(kwargs["document"], ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        return serialized_path

    monkeypatch.setattr(pipeline, "_finalize_solution_document", serialize_document)
    download = CachedDownload(
        url=solution["displayUrl"],
        path=Path("/dev/null"),
        sha256="a" * 64,
        bytes=0,
    )
    monkeypatch.setattr(pipeline, "read_solution_raster", lambda _path: raster)
    report_entry = pipeline._process_solution(
        solution=solution,
        manifest=manifest,
        cache_dir=tmp_path / "cache",
        output_dir=tmp_path,
        force_download=False,
        layer_cache=mask_cache,
        value_cache=value_cache,
        boundary_mask_cache=BoundaryMaskCache(),
        boundaries_by_level=_boundaries(
            overlapping_departments=overlapping_departments
        ),
        species_records=None,
        species_pool_sizes=None,
        boundary_grid_cache=BoundaryIdGridCache(),
        boundary_topology_cache=topology_cache,
        boundary_fanout_mode=fanout_mode,
        weighted_boundary_fanout_mode=weighted_mode,
        weighted_layer_cache=pipeline.ImmutableWeightedLayerCache(),
        skip_species=True,
        solution_input_signature=signature,
        raster_download=download,
    )
    return (
        json.loads(serialized_path.read_text(encoding="utf-8")),
        report_entry,
        topology_cache,
        mask_cache.requests,
    )


def _assert_metric_value_equal(actual: dict[str, Any], expected: dict[str, Any]) -> None:
    assert list(actual) == list(expected)
    for key, actual_value in actual.items():
        if key != "value":
            assert actual_value == expected[key]
            continue
        expected_value = expected[key]
        if (
            isinstance(actual_value, int)
            and not isinstance(actual_value, bool)
            and isinstance(expected_value, int)
            and not isinstance(expected_value, bool)
        ):
            assert actual_value == expected_value
        elif isinstance(actual_value, float) and isinstance(expected_value, float):
            if actual["unit"] == "%":
                assert actual_value == pytest.approx(
                    expected_value,
                    rel=0.0,
                    abs=_PERCENT_ABS_TOL,
                )
            elif actual["unit"] == "Mg·km²":
                assert actual_value == pytest.approx(
                    expected_value,
                    rel=_WEIGHTED_REL_TOL,
                    abs=_WEIGHTED_ABS_TOL,
                )
            else:
                assert actual_value == pytest.approx(
                    expected_value,
                    rel=0.0,
                    abs=_AREA_ABS_TOL,
                )
        else:
            assert actual_value == expected_value


def _assert_serialized_semantic_parity(
    actual: dict[str, Any],
    expected: dict[str, Any],
) -> None:
    assert list(actual) == list(expected)
    assert actual["solutionId"] == expected["solutionId"]
    assert actual["generatedAt"] == expected["generatedAt"]
    assert actual["solutionRaster"] == expected["solutionRaster"]
    assert list(actual["solutionInputSignature"]) == list(
        expected["solutionInputSignature"]
    )
    assert actual["solutionInputSignature"]["format"] == (
        expected["solutionInputSignature"]["format"]
    )
    assert actual["solutionCatalogBinding"] == expected["solutionCatalogBinding"]

    actual_provenance = actual["metricsProvenance"]
    expected_provenance = expected["metricsProvenance"]
    assert list(actual_provenance) == list(expected_provenance)
    assert actual_provenance["schemaVersion"] == expected_provenance["schemaVersion"]
    assert actual_provenance["solutionDomain"] == expected_provenance["solutionDomain"]
    actual_config = actual_provenance["generationConfig"]
    expected_config = expected_provenance["generationConfig"]
    assert list(actual_config) == list(expected_config)
    execution_identity_keys = {"boundaryFanout", "weightedBoundaryExecution"}
    assert {
        key: value
        for key, value in actual_config.items()
        if key not in execution_identity_keys
    } == {
        key: value
        for key, value in expected_config.items()
        if key not in execution_identity_keys
    }
    assert actual_provenance["releaseId"] == expected_provenance["releaseId"]
    assert actual_provenance["boundaryProvenance"] == (
        expected_provenance["boundaryProvenance"]
    )
    assert actual["speciesCompleteness"] == expected["speciesCompleteness"]

    assert list(actual["geographies"]) == list(expected["geographies"])
    for level, actual_scopes in actual["geographies"].items():
        expected_scopes = expected["geographies"][level]
        assert list(actual_scopes) == list(expected_scopes)
        for scope_id, actual_scope in actual_scopes.items():
            expected_scope = expected_scopes[scope_id]
            assert list(actual_scope) == list(expected_scope)
            assert actual_scope["name"] == expected_scope["name"]
            assert actual_scope["scopeState"] == expected_scope["scopeState"]
            assert actual_scope.get("kind") == expected_scope.get("kind")
            assert actual_scope.get("subtype") == expected_scope.get("subtype")
            assert len(actual_scope["metrics"]) == len(expected_scope["metrics"])
            for actual_metric, expected_metric in zip(
                actual_scope["metrics"],
                expected_scope["metrics"],
                strict=True,
            ):
                _assert_metric_value_equal(actual_metric, expected_metric)


def test_serialized_boundary_fanout_mode_matrix(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    legacy_dense, legacy_dense_report, _, legacy_dense_requests = _run_document(
        tmp_path,
        monkeypatch,
        fanout_mode="legacy",
        layer_source_mode="dense",
        overlapping_departments=False,
    )
    grouped_dense, grouped_dense_report, _, grouped_dense_requests = _run_document(
        tmp_path,
        monkeypatch,
        fanout_mode="grouped",
        layer_source_mode="dense",
        overlapping_departments=False,
    )
    legacy_sparse, _, _, legacy_sparse_requests = _run_document(
        tmp_path,
        monkeypatch,
        fanout_mode="legacy",
        layer_source_mode="sparse",
        overlapping_departments=False,
    )
    grouped_sparse, _, _, grouped_sparse_requests = _run_document(
        tmp_path,
        monkeypatch,
        fanout_mode="grouped",
        layer_source_mode="sparse",
        overlapping_departments=False,
    )
    grouped_fallback, fallback_report, fallback_cache, fallback_requests = _run_document(
        tmp_path,
        monkeypatch,
        fanout_mode="grouped",
        layer_source_mode="dense",
        overlapping_departments=True,
    )
    legacy_overlap, _, _, _ = _run_document(
        tmp_path,
        monkeypatch,
        fanout_mode="legacy",
        layer_source_mode="dense",
        overlapping_departments=True,
    )

    _assert_serialized_semantic_parity(grouped_dense, legacy_dense)
    assert legacy_sparse == legacy_dense
    assert grouped_sparse == grouped_dense
    _assert_serialized_semantic_parity(grouped_fallback, legacy_overlap)

    assert legacy_dense_report["boundaryFanout"][
        "algorithmVersion"
    ] == "boundary-fanout-dense-mask-v1"
    assert grouped_dense_report["boundaryFanout"][
        "algorithmVersion"
    ] == "boundary-fanout-primary-extra-four-channel-v2"
    assert fallback_report["boundaryFanout"]["effectiveMode"] == "grouped"
    fallback_indexes, cache_hit = fallback_cache.get(
        _boundaries(overlapping_departments=True),
        _raster().fingerprint,
    )
    assert cache_hit is True
    assert isinstance(fallback_indexes["departments"], OverlapBoundaryIndex)

    assert {mode for _, mode in legacy_dense_requests} == {"dense"}
    assert {mode for _, mode in grouped_dense_requests} == {"dense"}
    assert {mode for _, mode in legacy_sparse_requests} == {"sparse"}
    assert {mode for _, mode in grouped_sparse_requests} == {"sparse"}
    assert {mode for _, mode in fallback_requests} == {"dense"}

    # These are the internal-regression policies: integer counts are exact;
    # area and weighted reductions permit 1e-6 absolute drift, percentages
    # permit 1e-9 absolute drift, and weighted values additionally permit
    # 1e-12 relative drift. Grouped bincount/CSR reduction order can differ
    # by a few least-significant bits from row-major scalar mask reductions.
    assert (
        _AREA_ABS_TOL,
        _PERCENT_ABS_TOL,
        _WEIGHTED_ABS_TOL,
        _WEIGHTED_REL_TOL,
    ) == (1e-6, 1e-9, 1e-6, 1e-12)


def test_guarded_weighted_main_orchestration_matches_scalar_final_output(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    scalar, scalar_report, _, _ = _run_document(
        tmp_path,
        monkeypatch,
        fanout_mode="grouped",
        weighted_mode="scalar",
        layer_source_mode="dense",
        overlapping_departments=True,
    )
    grouped, grouped_report, _, _ = _run_document(
        tmp_path,
        monkeypatch,
        fanout_mode="grouped",
        weighted_mode="grouped-weighted-v1",
        layer_source_mode="dense",
        overlapping_departments=True,
    )

    _assert_serialized_semantic_parity(grouped, scalar)
    assert scalar_report["boundaryFanout"]["weightedFallback"] is True
    assert grouped_report["boundaryFanout"]["weightedFallback"] is False
    assert (
        grouped_report["weightedBoundaryExecution"]["effectiveMode"]
        == "grouped-weighted-v1"
    )
