from __future__ import annotations

from dataclasses import replace

import boundaries.boundary_weighted_fanout as weighted_fanout
import main as pipeline
import numpy as np
import pytest
from boundaries.boundary_loader import BoundaryFeature
from boundaries.boundary_topology import build_boundary_topology_index
from boundaries.boundary_weighted_fanout import (
    NODATA_NORMALIZATION_POLICY,
    WEIGHTED_BOUNDARY_FANOUT_ALGORITHM_VERSION,
    WEIGHTED_LAYER_PREPARATION_ALGORITHM_VERSION,
    WEIGHTED_METRIC_REGISTRY_POLICY_VERSION,
    ImmutableWeightedLayerCache,
    WeightedFanoutCancelled,
    WeightedFanoutError,
    WeightedLayerIdentity,
    WeightedMetricSpec,
    aggregate_selected_weighted_layers,
    approved_weighted_specs,
    assemble_weighted_metric_results,
    canonical_nodata_value,
    pixel_area_rows_sha256,
)
from metric_definitions import computable_metrics
from metrics_contract import build_metrics_provenance, provenance_issues
from raster_metrics import RasterFingerprint
from validation.benchmark_boundary_weighted_fanout import _compare_payloads, _parse_args


def _fingerprint(height: int, width: int) -> RasterFingerprint:
    return RasterFingerprint(
        width=width,
        height=height,
        transform=(1.0, 0.0, 0.0, 0.0, -1.0, float(height)),
        crs="EPSG:4326",
    )


def _feature(boundary_id: str) -> BoundaryFeature:
    return BoundaryFeature(
        boundary_id=boundary_id,
        name=boundary_id,
        geo_level="siraps",
        geometry={},
        properties={},
    )


def _identity(
    layer_id: str = "biomasa",
    *,
    shape: tuple[int, int] = (2, 3),
    row_areas: np.ndarray | None = None,
    dtype: str = "float64",
    nodata: float | None = np.nan,
    units: str = "Mg·km²",
) -> WeightedLayerIdentity:
    rows = np.ones(shape[0]) if row_areas is None else row_areas
    return WeightedLayerIdentity(
        layer_id=layer_id,
        source_url=f"https://example.test/{layer_id}.tif",
        source_sha256="a" * 64,
        source_provenance_sha256="1" * 64,
        aligned_url=f"file:///cache/{layer_id}.tif",
        aligned_sha256="b" * 64,
        aligned_provenance_sha256="2" * 64,
        target_grid_sha256="c" * 64,
        target_fingerprint_sha256="3" * 64,
        target_shape=shape,
        alignment_policy_sha256="d" * 64,
        nodata_value=canonical_nodata_value(nodata),
        nodata_interpretation_policy="dataset-declared-nodata-v1",
        normalization_policy=NODATA_NORMALIZATION_POLICY,
        pixel_area_rows_sha256=pixel_area_rows_sha256(rows),
        preparation_algorithm_version=WEIGHTED_LAYER_PREPARATION_ALGORITHM_VERSION,
        weighted_fanout_algorithm_version=(
            WEIGHTED_BOUNDARY_FANOUT_ALGORITHM_VERSION
        ),
        aligned_dtype=dtype,
        value_units=units,
        metric_registry_policy_version=WEIGHTED_METRIC_REGISTRY_POLICY_VERSION,
    )


def _prepare(
    cache: ImmutableWeightedLayerCache,
    values: np.ndarray,
    *,
    identity: WeightedLayerIdentity | None = None,
    row_areas: np.ndarray | None = None,
):
    rows = (
        row_areas
        if row_areas is not None
        else np.arange(1, values.shape[0] + 1, dtype=np.float64)
    )
    return cache.get_or_prepare(
        identity
        or _identity(
            shape=values.shape,
            row_areas=rows,
            dtype=values.dtype.name,
        ),
        shape=values.shape,
        pixel_area_km2_per_row=rows,
        loader=lambda: values,
    )[0]


def _overlap_cancellation_fixture():
    values = np.arange(6, dtype=np.float64).reshape(1, 6)
    cache = ImmutableWeightedLayerCache()
    prepared = _prepare(cache, values, row_areas=np.ones(1))
    index = build_boundary_topology_index(
        "siraps",
        [_feature("first"), _feature("second")],
        _fingerprint(1, 6),
        mode="overlap",
        mask_provider=lambda _: np.ones((1, 6), dtype=bool),
    )
    return cache, prepared, index


def test_weighted_execution_control_defaults_scalar_and_rejects_invalid(monkeypatch):
    monkeypatch.delenv("METRICS_WEIGHTED_BOUNDARY_FANOUT", raising=False)
    assert pipeline._weighted_boundary_fanout_mode() == "scalar"

    monkeypatch.setenv("METRICS_WEIGHTED_BOUNDARY_FANOUT", "grouped-weighted-v1")
    assert pipeline._weighted_boundary_fanout_mode() == "grouped-weighted-v1"

    monkeypatch.setenv("METRICS_WEIGHTED_BOUNDARY_FANOUT", "silent-fallback")
    with pytest.raises(ValueError, match="must be 'scalar' or 'grouped-weighted-v1'"):
        pipeline._weighted_boundary_fanout_mode()


def test_grouped_weighted_execution_requires_grouped_topology():
    with pytest.raises(ValueError, match="requires METRICS_BOUNDARY_FANOUT=grouped"):
        pipeline._process_solution(
            solution={"id": "guard", "domain": "land"},
            manifest=None,
            cache_dir=None,
            output_dir=None,
            force_download=False,
            layer_cache=None,
            value_cache=None,
            boundary_mask_cache=None,
            boundaries_by_level={},
            boundary_fanout_mode="legacy",
            weighted_boundary_fanout_mode="grouped-weighted-v1",
        )


def test_weighted_execution_identity_drift_rejects_provenance():
    provenance = build_metrics_provenance(
        "land",
        boundary_fanout_mode="grouped",
        weighted_execution_mode="grouped-weighted-v1",
    )
    document = {"metricsProvenance": provenance}
    expected = provenance["generationConfig"]
    assert provenance_issues(document, expected_config=expected) == []

    provenance["generationConfig"]["weightedBoundaryExecution"][
        "allowlistSha256"
    ] = "0" * 64
    issues = provenance_issues(document, expected_config=expected)
    assert any("weightedBoundaryExecution" in issue for issue in issues)


def test_weighted_allowlist_rejects_identical_duplicate_before_mapping():
    definitions = tuple(computable_metrics())
    duplicate = next(
        definition
        for definition in definitions
        if definition.metric_id == "carbon_storage_biomass"
    )

    with pytest.raises(WeightedFanoutError, match="cardinality.*duplicate"):
        approved_weighted_specs((*definitions, duplicate))


def test_weighted_allowlist_rejects_conflicting_duplicate_before_mapping():
    definitions = tuple(computable_metrics())
    original = next(
        definition
        for definition in definitions
        if definition.metric_id == "carbon_storage_biomass"
    )
    conflicting = replace(original, layer_id="carbono_organico")

    with pytest.raises(WeightedFanoutError, match="cardinality.*duplicate"):
        approved_weighted_specs((*definitions, conflicting))


def test_overlap_nodata_negative_zero_partial_cells_and_empty_boundary():
    values = np.array(
        [
            [2.0, np.nan, -3.0, 0.0],
            [4.0, 5.0, np.inf, -1.0],
        ]
    )
    row_areas = np.array([0.25, 1.5])
    selected = np.array(
        [
            [True, True, True, True],
            [True, False, True, True],
        ]
    )
    masks = {
        "left": np.array([[True, True, True, False], [True, False, False, False]]),
        "overlap": np.array([[False, False, True, True], [True, True, True, True]]),
        "empty": np.zeros((2, 4), dtype=bool),
    }
    features = [_feature(boundary_id) for boundary_id in masks]
    index = build_boundary_topology_index(
        "siraps",
        features,
        _fingerprint(2, 4),
        mode="overlap",
        mask_provider=lambda feature: masks[feature.boundary_id],
    )
    layer = _prepare(
        ImmutableWeightedLayerCache(),
        values,
        row_areas=row_areas,
    )

    result = aggregate_selected_weighted_layers(
        {"siraps": index},
        selected,
        {"biomasa": layer},
    )

    expected = []
    weighted = values * row_areas[:, np.newaxis]
    for feature in features:
        active = masks[feature.boundary_id] & selected & np.isfinite(values)
        expected.append(float(weighted[active].sum(dtype=np.float64)))
    np.testing.assert_allclose(
        result.sums["biomasa"]["siraps"],
        expected,
        rtol=0.0,
        atol=0.0,
    )
    assert expected == [pytest.approx(5.75), pytest.approx(3.75), 0.0]
    assert result.diagnostics.extra_claim_count_by_level["siraps"] == 2


@pytest.mark.parametrize("seed", range(12))
def test_randomized_masks_match_independent_scalar_oracle(seed):
    rng = np.random.default_rng(20260820 + seed)
    height, width = 11, 13
    values = rng.normal(0.0, 8.0, size=(height, width))
    values.ravel()[::29] = np.nan
    values.ravel()[::47] = np.inf
    selected = rng.random((height, width)) < 0.43
    row_areas = rng.uniform(0.01, 1.7, height)
    masks = {f"owner-{index}": rng.random((height, width)) < 0.31 for index in range(8)}
    masks["empty"] = np.zeros((height, width), dtype=bool)
    features = [_feature(boundary_id) for boundary_id in masks]
    index = build_boundary_topology_index(
        "siraps",
        features,
        _fingerprint(height, width),
        mode="overlap",
        mask_provider=lambda feature: masks[feature.boundary_id],
    )
    layer = _prepare(
        ImmutableWeightedLayerCache(),
        values,
        row_areas=row_areas,
    )

    result = aggregate_selected_weighted_layers(
        {"siraps": index},
        selected,
        {"biomasa": layer},
    ).sums["biomasa"]["siraps"]
    weighted = values * row_areas[:, np.newaxis]
    expected = np.asarray(
        [
            weighted[mask & selected & np.isfinite(values)].sum(dtype=np.float64)
            for mask in masks.values()
        ]
    )

    np.testing.assert_allclose(result, expected, rtol=1e-12, atol=1e-12)


def test_weighted_sum_and_national_percent_metric_families_reuse_one_sum():
    values = np.array([[1.0, 2.0], [3.0, 4.0]])
    selected = np.array([[True, False], [True, False]])
    masks = {"all": np.ones((2, 2), dtype=bool)}
    index = build_boundary_topology_index(
        "siraps",
        [_feature("all")],
        _fingerprint(2, 2),
        mode="overlap",
        mask_provider=lambda feature: masks[feature.boundary_id],
    )
    layer = _prepare(
        ImmutableWeightedLayerCache(),
        values,
        row_areas=np.array([0.5, 2.0]),
    )
    fanout = aggregate_selected_weighted_layers(
        {"siraps": index},
        selected,
        {"biomasa": layer},
    )
    metrics = assemble_weighted_metric_results(
        (
            WeightedMetricSpec(
                "carbon_storage_biomass", "biomasa", "weighted_sum", "Mg·km²"
            ),
            WeightedMetricSpec(
                "carbon_biomass_total", "biomasa", "weighted_sum", "Mg·km²"
            ),
            WeightedMetricSpec(
                "carbon_pct_of_national",
                "biomasa",
                "weighted_percent_of_national",
                "%",
            ),
        ),
        level="siraps",
        boundary_index=0,
        fanout=fanout,
        layers={"biomasa": layer},
    )

    assert metrics["carbon_storage_biomass"].value == 6.5
    assert metrics["carbon_biomass_total"].value == 6.5
    assert metrics["carbon_pct_of_national"].value == pytest.approx(6.5 / 15.5 * 100.0)
    assert {metric.status for metric in metrics.values()} == {"ready"}


def test_zero_national_denominator_blocks_only_percent_metric():
    values = np.array([[0.0, -2.0], [2.0, np.nan]])
    index = build_boundary_topology_index(
        "siraps",
        [_feature("all")],
        _fingerprint(2, 2),
        mode="overlap",
        mask_provider=lambda _: np.ones((2, 2), dtype=bool),
    )
    layer = _prepare(
        ImmutableWeightedLayerCache(),
        values,
        row_areas=np.ones(2),
    )
    fanout = aggregate_selected_weighted_layers(
        {"siraps": index},
        np.ones((2, 2), dtype=bool),
        {"biomasa": layer},
    )
    metrics = assemble_weighted_metric_results(
        (
            WeightedMetricSpec(
                "carbon_storage_biomass", "biomasa", "weighted_sum", "Mg·km²"
            ),
            WeightedMetricSpec(
                "carbon_pct_of_national",
                "biomasa",
                "weighted_percent_of_national",
                "%",
            ),
        ),
        level="siraps",
        boundary_index=0,
        fanout=fanout,
        layers={"biomasa": layer},
    )

    assert metrics["carbon_storage_biomass"].value == 0.0
    assert metrics["carbon_storage_biomass"].status == "ready"
    assert metrics["carbon_pct_of_national"].value is None
    assert metrics["carbon_pct_of_national"].status == "blocked"


def test_source_order_is_deterministic_and_changes_only_output_order():
    masks = {
        "z": np.array([[True, True, False]]),
        "a": np.array([[False, True, True]]),
    }
    values = np.array([[0.1, 0.2, 0.3]])
    selected = np.ones_like(values, dtype=bool)
    prepared = _prepare(
        ImmutableWeightedLayerCache(),
        values,
        row_areas=np.ones(1),
    )

    observed = []
    for order in (("z", "a"), ("a", "z")):
        index = build_boundary_topology_index(
            "siraps",
            [_feature(boundary_id) for boundary_id in order],
            _fingerprint(1, 3),
            mode="overlap",
            mask_provider=lambda feature: masks[feature.boundary_id],
        )
        result = aggregate_selected_weighted_layers(
            {"siraps": index},
            selected,
            {"biomasa": prepared},
        )
        observed.append(
            dict(
                zip(
                    index.boundary_ids,
                    result.sums["biomasa"]["siraps"],
                    strict=True,
                )
            )
        )

    assert observed[0] == observed[1]
    assert observed[0] == {"z": pytest.approx(0.3), "a": pytest.approx(0.5)}


def test_cache_hits_freeze_arrays_and_fail_closed_on_signature_drift():
    cache = ImmutableWeightedLayerCache()
    values = np.arange(6, dtype=np.float64).reshape(2, 3)
    first, hit = cache.get_or_prepare(
        _identity(),
        shape=values.shape,
        pixel_area_km2_per_row=np.ones(2),
        loader=lambda: values,
    )
    second, second_hit = cache.get_or_prepare(
        _identity(),
        shape=values.shape,
        pixel_area_km2_per_row=np.ones(2),
        loader=lambda: pytest.fail("cache hit must not call loader"),
    )

    assert hit is False
    assert second_hit is True
    assert first is second
    assert first.weighted_values.flags.writeable is False
    assert first.finite_mask.flags.writeable is False
    assert cache.hits == 1
    assert cache.misses == 1
    with pytest.raises(WeightedFanoutError, match="signature drift"):
        cache.get_or_prepare(
            replace(_identity(), aligned_sha256="e" * 64),
            shape=values.shape,
            pixel_area_km2_per_row=np.ones(2),
            loader=lambda: values,
        )


@pytest.mark.parametrize(
    ("field", "replacement"),
    [
        ("source_url", "https://example.test/other.tif"),
        ("source_sha256", "6" * 64),
        ("source_provenance_sha256", "4" * 64),
        ("aligned_url", "file:///cache/other.tif"),
        ("aligned_sha256", "8" * 64),
        ("aligned_provenance_sha256", "5" * 64),
        ("target_grid_sha256", "9" * 64),
        ("target_fingerprint_sha256", "7" * 64),
        ("nodata_value", canonical_nodata_value(-9999.0)),
        ("nodata_interpretation_policy", "mask-band-v2"),
        ("normalization_policy", "other-v2"),
        ("preparation_algorithm_version", "prepare-v999"),
        ("weighted_fanout_algorithm_version", "fanout-v999"),
        ("aligned_dtype", "float32"),
        ("value_units", "kg"),
        ("metric_registry_policy_version", "registry-v999"),
    ],
)
def test_cache_rejects_identity_policy_and_provenance_drift(field, replacement):
    cache = ImmutableWeightedLayerCache()
    values = np.arange(6, dtype=np.float64).reshape(2, 3)
    _prepare(cache, values, row_areas=np.ones(2))

    with pytest.raises(WeightedFanoutError):
        cache.get_or_prepare(
            replace(_identity(), **{field: replacement}),
            shape=values.shape,
            pixel_area_km2_per_row=np.ones(2),
            loader=lambda: values,
        )


def test_cache_hit_revalidates_shape_and_pixel_area_rows():
    cache = ImmutableWeightedLayerCache()
    values = np.arange(6, dtype=np.float64).reshape(2, 3)
    _prepare(cache, values, row_areas=np.ones(2))

    with pytest.raises(WeightedFanoutError, match="Call shape"):
        cache.get_or_prepare(
            _identity(shape=(2, 2)),
            shape=(1, 6),
            pixel_area_km2_per_row=np.ones(1),
            loader=lambda: pytest.fail("must reject before loading"),
        )
    with pytest.raises(WeightedFanoutError, match="row checksum drift"):
        cache.get_or_prepare(
            _identity(),
            shape=values.shape,
            pixel_area_km2_per_row=np.array([1.0, 2.0]),
            loader=lambda: pytest.fail("must reject before loading"),
        )
    changed_shape_identity = replace(
        _identity(),
        target_shape=(1, 6),
        pixel_area_rows_sha256=pixel_area_rows_sha256(np.ones(1)),
    )
    with pytest.raises(WeightedFanoutError, match="signature drift"):
        cache.get_or_prepare(
            changed_shape_identity,
            shape=(1, 6),
            pixel_area_km2_per_row=np.ones(1),
            loader=lambda: pytest.fail("must reject cache identity drift"),
        )
    assert cache.hits == 0


def test_nodata_sentinel_and_nan_are_invalid_but_negative_zero_is_preserved():
    values = np.array([[-9999.0, np.nan, -0.0], [-2.0, 3.0, 4.0]])
    rows = np.array([1.0, 2.0])
    layer = _prepare(
        ImmutableWeightedLayerCache(),
        values,
        identity=_identity(
            shape=values.shape,
            row_areas=rows,
            nodata=-9999.0,
        ),
        row_areas=rows,
    )

    assert layer.finite_mask.tolist() == [False, False, True, True, True, True]
    assert np.signbit(layer.weighted_values[2])
    assert layer.national_denominator == 10.0


@pytest.mark.parametrize(
    "spec",
    [
        WeightedMetricSpec("unknown", "biomasa", "weighted_sum", "Mg·km²"),
        WeightedMetricSpec(
            "carbon_storage_biomass",
            "biomasa",
            "weighted_percent_of_national",
            "Mg·km²",
        ),
        WeightedMetricSpec(
            "carbon_storage_biomass",
            "carbono_organico",
            "weighted_sum",
            "Mg·km²",
        ),
        WeightedMetricSpec(
            "carbon_storage_biomass",
            "biomasa",
            "weighted_sum",
            "kg",
        ),
    ],
)
def test_runtime_allowlist_rejects_unknown_or_mismatched_specs(spec):
    values = np.ones((1, 1))
    layer = _prepare(ImmutableWeightedLayerCache(), values)
    index = build_boundary_topology_index(
        "siraps",
        [_feature("all")],
        _fingerprint(1, 1),
        mode="overlap",
        mask_provider=lambda _: np.ones((1, 1), dtype=bool),
    )
    fanout = aggregate_selected_weighted_layers(
        {"siraps": index}, np.ones((1, 1), dtype=bool), {"biomasa": layer}
    )

    with pytest.raises(WeightedFanoutError, match="not approved"):
        assemble_weighted_metric_results(
            (spec,),
            level="siraps",
            boundary_index=0,
            fanout=fanout,
            layers={"biomasa": layer},
        )


def test_nonfinite_denominator_fails_closed():
    with pytest.raises(WeightedFanoutError, match="non-finite national denominator"):
        _prepare(
            ImmutableWeightedLayerCache(),
            np.array([[np.finfo(np.float64).max, np.finfo(np.float64).max]]),
        )

    layer = _prepare(ImmutableWeightedLayerCache(), np.ones((1, 2)))
    poisoned = replace(layer, national_denominator=np.inf)
    fanout = aggregate_selected_weighted_layers(
        {
            "siraps": build_boundary_topology_index(
                "siraps",
                [_feature("all")],
                _fingerprint(1, 2),
                mode="overlap",
                mask_provider=lambda _: np.ones((1, 2), dtype=bool),
            )
        },
        np.ones((1, 2), dtype=bool),
        {"biomasa": layer},
    )
    with pytest.raises(WeightedFanoutError, match="non-finite"):
        assemble_weighted_metric_results(
            (
                WeightedMetricSpec(
                    "carbon_pct_of_national",
                    "biomasa",
                    "weighted_percent_of_national",
                    "%",
                ),
            ),
            level="siraps",
            boundary_index=0,
            fanout=fanout,
            layers={"biomasa": poisoned},
        )


def test_loader_failure_and_cancellation_do_not_publish_partial_cache_entries():
    cache = ImmutableWeightedLayerCache()
    values = np.ones((2, 2))

    with pytest.raises(OSError, match="isolated"):
        cache.get_or_prepare(
            _identity(shape=(2, 2)),
            shape=values.shape,
            pixel_area_km2_per_row=np.ones(2),
            loader=lambda: (_ for _ in ()).throw(OSError("isolated")),
        )
    assert cache.misses == 0
    prepared = _prepare(cache, values)
    assert cache.misses == 1

    with pytest.raises(WeightedFanoutCancelled):
        aggregate_selected_weighted_layers(
            {
                "siraps": build_boundary_topology_index(
                    "siraps",
                    [_feature("all")],
                    _fingerprint(2, 2),
                    mode="overlap",
                    mask_provider=lambda _: np.ones((2, 2), dtype=bool),
                )
            },
            np.ones((2, 2), dtype=bool),
            {"biomasa": prepared},
            cancel_check=lambda: True,
        )


def test_late_preparation_cancellation_publishes_no_cache_entry():
    cache = ImmutableWeightedLayerCache()
    values = np.ones((2, 2))
    calls = 0

    def cancel_after_preparation() -> bool:
        nonlocal calls
        calls += 1
        return calls >= 4

    with pytest.raises(WeightedFanoutCancelled):
        cache.get_or_prepare(
            _identity(shape=(2, 2)),
            shape=(2, 2),
            pixel_area_km2_per_row=np.ones(2),
            loader=lambda: values,
            cancel_check=cancel_after_preparation,
        )
    assert cache.entry_count == 0
    assert cache.misses == 0


def test_late_fanout_cancellation_returns_no_result():
    values = np.ones((2, 2))
    prepared = _prepare(ImmutableWeightedLayerCache(), values)
    index = build_boundary_topology_index(
        "siraps",
        [_feature("all")],
        _fingerprint(2, 2),
        mode="overlap",
        mask_provider=lambda _: np.ones((2, 2), dtype=bool),
    )
    calls = 0

    def cancel_before_publication() -> bool:
        nonlocal calls
        calls += 1
        return calls >= 3

    with pytest.raises(WeightedFanoutCancelled):
        aggregate_selected_weighted_layers(
            {"siraps": index},
            np.ones((2, 2), dtype=bool),
            {"biomasa": prepared},
            cancel_check=cancel_before_publication,
        )


@pytest.mark.parametrize(
    ("cancel_call", "phase"),
    [
        (3, "primary-discovery"),
        (6, "extra-owner-discovery"),
        (13, "extra-owner-materialization"),
    ],
)
def test_claim_construction_cancellation_publishes_no_partial_result(
    monkeypatch,
    cancel_call,
    phase,
):
    monkeypatch.setattr(weighted_fanout, "_REDUCTION_CHUNK_CELLS", 2)
    cache, prepared, index = _overlap_cancellation_fixture()
    calls = 0
    published = []

    def cancel_during_claim_phase() -> bool:
        nonlocal calls
        calls += 1
        return calls == cancel_call

    with pytest.raises(WeightedFanoutCancelled):
        published.append(
            aggregate_selected_weighted_layers(
                {"siraps": index},
                np.ones((1, 6), dtype=bool),
                {"biomasa": prepared},
                cancel_check=cancel_during_claim_phase,
            )
        )

    assert phase
    assert published == []
    assert cache.entry_count == 1
    assert cache.hits == 0
    assert cache.misses == 1


def test_final_publication_cancellation_releases_partial_output(monkeypatch):
    monkeypatch.setattr(weighted_fanout, "_REDUCTION_CHUNK_CELLS", 2)
    cache, prepared, index = _overlap_cancellation_fixture()
    complete_calls = 0

    def count_checks() -> bool:
        nonlocal complete_calls
        complete_calls += 1
        return False

    aggregate_selected_weighted_layers(
        {"siraps": index},
        np.ones((1, 6), dtype=bool),
        {"biomasa": prepared},
        cancel_check=count_checks,
    )
    cancellation_calls = 0
    published = []

    def cancel_at_final_publication() -> bool:
        nonlocal cancellation_calls
        cancellation_calls += 1
        return cancellation_calls == complete_calls

    with pytest.raises(WeightedFanoutCancelled):
        published.append(
            aggregate_selected_weighted_layers(
                {"siraps": index},
                np.ones((1, 6), dtype=bool),
                {"biomasa": prepared},
                cancel_check=cancel_at_final_publication,
            )
        )

    assert cancellation_calls == complete_calls
    assert published == []
    assert cache.entry_count == 1
    assert cache.hits == 0
    assert cache.misses == 1


def test_reference_peak_rss_cli_is_validated_and_retained_as_context(tmp_path):
    args = _parse_args(
        [
            "--output",
            str(tmp_path / "evidence.json"),
            "--reference-peak-rss-bytes",
            "123456",
        ]
    )

    assert args.reference_peak_rss_bytes == 123456
    with pytest.raises(SystemExit):
        _parse_args(
            [
                "--output",
                str(tmp_path / "evidence.json"),
                "--reference-peak-rss-bytes",
                "0",
            ]
        )


def test_evidence_comparisons_are_split_and_assert_national_with_every_level():
    levels = (
        "national",
        "departments",
        "municipalities",
        "siraps",
        "runaps",
        "omecs",
    )
    retained = {
        level: {
            "colombia" if level == "national" else f"{level}-1": {
                "carbon_storage_biomass": {
                    "metricId": "carbon_storage_biomass",
                    "status": "ready",
                    "value": 4.0,
                }
            }
        }
        for level in levels
    }
    current = {
        level: {
            scope_id: {
                metric_id: dict(metric)
                for metric_id, metric in metrics.items()
            }
            for scope_id, metrics in scopes.items()
        }
        for level, scopes in retained.items()
    }
    prototype = {
        level: {
            scope_id: {
                metric_id: dict(metric)
                for metric_id, metric in metrics.items()
            }
            for scope_id, metrics in scopes.items()
        }
        for level, scopes in retained.items()
    }
    prototype["siraps"]["siraps-1"]["carbon_storage_biomass"]["value"] = (
        4.0 + 1e-13
    )

    comparison = _compare_payloads(current, prototype, retained)

    assert set(comparison) == {
        "currentToRetained",
        "prototypeToRetained",
        "prototypeToCurrent",
    }
    for pair in comparison.values():
        assert pair["comparisonCountByLevel"] == {level: 1 for level in levels}
        assert pair["mismatchCount"] == 0
    assert comparison["currentToRetained"]["nonzeroDeltaCount"] == 0
    assert comparison["prototypeToRetained"]["nonzeroDeltaCount"] == 1
    assert comparison["prototypeToCurrent"]["nonzeroDeltaCount"] == 1
