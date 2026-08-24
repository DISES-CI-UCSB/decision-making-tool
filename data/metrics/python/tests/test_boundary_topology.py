from pathlib import Path

import numpy as np
import pytest
from rasterio.transform import from_bounds

from boundaries.boundary_loader import (
    BOUNDARY_SOURCE_SPECS,
    BoundaryFeature,
)
from boundaries.boundary_topology import (
    BoundaryTopologyAuditUnavailable,
    BoundaryTopologyCache,
    BoundaryTopologyError,
    ExclusiveBoundaryIndex,
    OverlapBoundaryIndex,
    aggregate_boundary_counts,
    aggregate_prepared_sparse_boundary_weighted_sums,
    aggregate_boundary_weighted_sums,
    aggregate_sparse_boundary_weighted_sums,
    audit_cached_boundary_topology,
    boundary_cell_counts,
    boundary_indices_for_pixel,
    build_boundary_topology_index,
    build_topology_indexes_for_levels,
    prepare_sparse_boundary_weighted_channels,
)
from raster_metrics import RasterFingerprint


_PINNED_CACHE_DIR = (
    Path(__file__).resolve().parents[2]
    / "cache/releases/solutions-v0-2-0-20260805/mec-v2"
)
_PINNED_CACHE_AVAILABLE = all(
    (_PINNED_CACHE_DIR / "boundaries" / spec.cache_filename).is_file()
    for spec in BOUNDARY_SOURCE_SPECS.values()
)


def _fingerprint() -> RasterFingerprint:
    return RasterFingerprint(
        width=3,
        height=2,
        transform=(1.0, 0.0, 0.0, 0.0, -1.0, 2.0),
        crs="EPSG:4326",
    )


def _feature(boundary_id: str, name: str) -> BoundaryFeature:
    return BoundaryFeature(
        boundary_id=boundary_id,
        name=name,
        geo_level="test-level",
        geometry={},
        properties={"provenance": boundary_id},
    )


def _provider(masks: dict[str, np.ndarray]):
    def provide(feature: BoundaryFeature) -> np.ndarray:
        return masks[feature.boundary_id]

    return provide


def test_disjoint_partition_builds_exclusive_index_with_diagnostics():
    features = [_feature("first", "First"), _feature("second", "Second")]
    masks = {
        "first": np.array([[True, True, False], [False, False, False]]),
        "second": np.array([[False, False, True], [True, True, False]]),
    }

    index = build_boundary_topology_index(
        "departments",
        features,
        _fingerprint(),
        mask_provider=_provider(masks),
    )

    assert isinstance(index, ExclusiveBoundaryIndex)
    assert index.flat.dtype == np.int32
    assert index.flat.tolist() == [0, 0, 1, 1, 1, -1]
    assert index.boundary_ids == ("first", "second")
    assert index.boundary_names == ("First", "Second")
    assert index.total_claims == 5
    assert index.claimed_pixels == 5
    assert index.overlap_pixels == 0
    assert index.max_multiplicity == 1
    assert index.estimated_bytes == index.flat.nbytes
    assert index.estimated_peak_build_bytes > index.estimated_bytes
    assert boundary_cell_counts(index).tolist() == [2, 3]


def test_overlap_csr_retains_all_pixel_owners():
    features = [_feature("first", "First"), _feature("second", "Second")]
    masks = {
        "first": np.array([[True, True, False], [False, False, False]]),
        "second": np.array([[False, True, True], [False, False, False]]),
    }

    index = build_boundary_topology_index(
        "siraps",
        features,
        _fingerprint(),
        mode="overlap",
        mask_provider=_provider(masks),
    )

    assert isinstance(index, OverlapBoundaryIndex)
    assert index.offsets.dtype == np.int64
    assert index.boundary_indices.dtype == np.int32
    assert boundary_indices_for_pixel(index, 0).tolist() == [0]
    assert boundary_indices_for_pixel(index, 1).tolist() == [0, 1]
    assert boundary_indices_for_pixel(index, 2).tolist() == [1]
    assert boundary_indices_for_pixel(index, 5).tolist() == []
    assert index.total_claims == 4
    assert index.claimed_pixels == 3
    assert index.overlap_pixels == 1
    assert index.max_multiplicity == 2
    assert index.estimated_bytes == (
        index.offsets.nbytes + index.boundary_indices.nbytes
    )
    assert index.estimated_peak_build_bytes > index.estimated_bytes


def test_auto_mode_falls_back_after_detecting_overlap():
    features = [_feature("first", "First"), _feature("second", "Second")]
    masks = {
        "first": np.array([[True, True, False], [False, False, False]]),
        "second": np.array([[False, True, False], [False, False, False]]),
    }
    calls = {"first": 0, "second": 0}

    def provide(feature: BoundaryFeature) -> np.ndarray:
        calls[feature.boundary_id] += 1
        return masks[feature.boundary_id]

    index = build_boundary_topology_index(
        "municipalities",
        features,
        _fingerprint(),
        mode="auto",
        mask_provider=provide,
    )

    assert isinstance(index, OverlapBoundaryIndex)
    assert boundary_indices_for_pixel(index, 1).tolist() == [0, 1]
    assert calls == {"first": 3, "second": 3}


@pytest.mark.parametrize(
    ("first_pass", "second_pass"),
    [
        (
            np.array([[True, True, False], [False, False, False]]),
            np.array([[True, False, False], [False, False, False]]),
        ),
        (
            np.array([[True, False, False], [False, False, False]]),
            np.array([[True, True, False], [False, False, False]]),
        ),
        (
            np.array([[True, False, False], [False, False, False]]),
            np.array([[False, True, False], [False, False, False]]),
        ),
    ],
    ids=("fewer-claims", "extra-claims", "changed-ownership"),
)
def test_overlap_builder_rejects_inconsistent_two_pass_provider(
    first_pass,
    second_pass,
):
    feature = _feature("unstable", "Unstable")
    masks = iter((first_pass, second_pass))

    with pytest.raises(
        BoundaryTopologyError,
        match="mask changed between CSR passes.*must be deterministic",
    ):
        build_boundary_topology_index(
            "siraps",
            [feature],
            _fingerprint(),
            mode="overlap",
            mask_provider=lambda _feature: next(masks),
        )


def test_exclusive_mode_rejects_overlapping_claims():
    features = [_feature("first", "First"), _feature("second", "Second")]
    shared = np.array([[True, False, False], [False, False, False]])

    with pytest.raises(BoundaryTopologyError, match="not exclusive"):
        build_boundary_topology_index(
            "departments",
            features,
            _fingerprint(),
            mode="exclusive",
            mask_provider=_provider({"first": shared, "second": shared}),
        )


def test_empty_catalog_builds_empty_exclusive_index():
    index = build_boundary_topology_index(
        "departments",
        [],
        _fingerprint(),
        mode="auto",
    )

    assert isinstance(index, ExclusiveBoundaryIndex)
    assert index.boundary_ids == ()
    assert index.boundary_provenance == ()
    assert index.flat.tolist() == [-1] * 6
    assert index.total_claims == 0
    assert index.claimed_pixels == 0
    assert index.max_multiplicity == 0
    assert boundary_cell_counts(index).size == 0


def test_duplicate_boundary_ids_are_rejected_before_rasterization():
    features = [_feature("duplicate", "First"), _feature("duplicate", "Second")]
    provider_called = False

    def provide(_feature):
        nonlocal provider_called
        provider_called = True
        return np.zeros((2, 3), dtype=bool)

    with pytest.raises(BoundaryTopologyError, match="duplicate ID.*'duplicate'"):
        build_boundary_topology_index(
            "departments",
            features,
            _fingerprint(),
            mask_provider=provide,
        )

    assert provider_called is False


def test_default_topology_selection_is_level_aware():
    levels = ("departments", "municipalities", "siraps", "runaps", "omecs")
    boundaries = {
        level: [_feature(f"{level}-only", level.title())]
        for level in levels
    }
    masks = {
        f"{level}-only": np.array(
            [[True, False, False], [False, False, False]]
        )
        for level in levels
    }

    indexes = build_topology_indexes_for_levels(
        boundaries,
        _fingerprint(),
        mask_provider=_provider(masks),
    )

    assert isinstance(indexes["departments"], ExclusiveBoundaryIndex)
    assert isinstance(indexes["municipalities"], ExclusiveBoundaryIndex)
    assert isinstance(indexes["siraps"], OverlapBoundaryIndex)
    assert isinstance(indexes["runaps"], OverlapBoundaryIndex)
    assert isinstance(indexes["omecs"], OverlapBoundaryIndex)


def test_empty_boundaries_and_source_order_are_preserved():
    features = [
        _feature("z-last", "Listed first"),
        _feature("a-first", "Listed second"),
        _feature("empty", "No cells"),
    ]
    masks = {
        "z-last": np.array([[True, False, False], [False, False, False]]),
        "a-first": np.array([[True, False, False], [False, False, False]]),
        "empty": np.zeros((2, 3), dtype=bool),
    }

    index = build_boundary_topology_index(
        "omecs",
        features,
        _fingerprint(),
        mode="overlap",
        mask_provider=_provider(masks),
    )

    assert index.boundary_ids == ("z-last", "a-first", "empty")
    assert index.boundary_names == ("Listed first", "Listed second", "No cells")
    assert boundary_indices_for_pixel(index, 0).tolist() == [0, 1]
    assert boundary_cell_counts(index).tolist() == [1, 1, 0]


@pytest.mark.parametrize("mode", ["auto", "overlap"])
def test_index_counts_equal_independent_scalar_masks(mode):
    features = [
        _feature("one", "One"),
        _feature("two", "Two"),
        _feature("none", "None"),
    ]
    masks = {
        "one": np.array([[True, True, False], [True, False, False]]),
        "two": np.array([[False, True, True], [False, True, False]]),
        "none": np.zeros((2, 3), dtype=bool),
    }

    index = build_boundary_topology_index(
        "test-level",
        features,
        _fingerprint(),
        mode=mode,
        mask_provider=_provider(masks),
    )

    independent_counts = [
        int(np.count_nonzero(masks[feature.boundary_id]))
        for feature in features
    ]
    assert boundary_cell_counts(index).tolist() == independent_counts


def test_overlapping_float_weights_are_duplicated_to_every_owner():
    features = [_feature("first", "First"), _feature("second", "Second")]
    masks = {
        "first": np.array([[True, True, False], [False, False, False]]),
        "second": np.array([[False, True, True], [False, False, False]]),
    }
    index = build_boundary_topology_index(
        "siraps",
        features,
        _fingerprint(),
        mode="overlap",
        mask_provider=_provider(masks),
    )
    all_cells = np.ones((2, 3), dtype=bool)
    shared_cell = np.array([[False, True, False], [False, False, False]])

    sums = aggregate_boundary_weighted_sums(
        index,
        np.array([[0.1, 0.2, 0.3], [0.0, 0.0, 0.0]]),
        total=all_cells,
        selected=shared_cell,
        pre_existing=all_cells,
        new_prioritizr=shared_cell,
    )

    np.testing.assert_allclose(sums.total, [0.3, 0.5])
    np.testing.assert_allclose(sums.selected, [0.2, 0.2])
    np.testing.assert_allclose(sums.pre_existing, [0.3, 0.5])
    np.testing.assert_allclose(sums.new_prioritizr, [0.2, 0.2])


def test_sparse_species_areas_duplicate_all_four_channels_to_overlapping_owners():
    features = [_feature("first", "First"), _feature("second", "Second")]
    masks = {
        "first": np.array([[True, True, False], [False, False, False]]),
        "second": np.array([[False, True, True], [False, False, False]]),
    }
    index = build_boundary_topology_index(
        "siraps",
        features,
        _fingerprint(),
        mode="overlap",
        mask_provider=_provider(masks),
    )

    pixel_indices = np.array([0, 1, 2, 5])
    weights = np.array([1.0, 2.0, 4.0, np.nan], dtype=np.float64)
    channels = {
        "selected": np.array([False, True, True, True]),
        "pre_existing": np.array([True, True, False, False]),
        "new_prioritizr": np.array([False, False, True, False]),
    }
    sums = aggregate_sparse_boundary_weighted_sums(
        index,
        pixel_indices,
        weights,
        **channels,
    )

    finite = np.isfinite(weights)
    scalar_channels = {
        "total": np.ones(pixel_indices.size, dtype=bool),
        **channels,
    }
    for channel_name, channel in scalar_channels.items():
        expected = []
        for feature in features:
            owner_at_sparse_cells = masks[feature.boundary_id].ravel()[pixel_indices]
            active = owner_at_sparse_cells & finite & channel
            expected.append(float(weights[active].sum(dtype=np.float64)))
        np.testing.assert_allclose(
            getattr(sums, channel_name),
            expected,
            rtol=1e-13,
            atol=1e-13,
        )


def test_randomized_sparse_species_hybrid_matches_independent_scalar_masks():
    rng = np.random.default_rng(20260820)
    height, width = 41, 37
    fingerprint = RasterFingerprint(
        width=width,
        height=height,
        transform=(1.0, 0.0, 0.0, 0.0, -1.0, float(height)),
        crs="EPSG:4326",
    )
    features = [_feature(f"owner-{position}", f"Owner {position}") for position in range(9)]
    masks = {
        feature.boundary_id: rng.random((height, width)) < 0.18
        for feature in features
    }
    index = build_boundary_topology_index(
        "municipalities",
        features,
        fingerprint,
        mode="overlap",
        mask_provider=_provider(masks),
    )
    pixel_indices = np.sort(
        rng.choice(height * width, size=811, replace=False)
    )
    weights = rng.uniform(0.01, 8_000.0, pixel_indices.size).astype(np.float64)
    weights[::157] = np.nan
    channels = {
        "selected": rng.random(pixel_indices.size) < 0.55,
        "pre_existing": rng.random(pixel_indices.size) < 0.3,
        "new_prioritizr": rng.random(pixel_indices.size) < 0.25,
    }
    prepared = prepare_sparse_boundary_weighted_channels(
        pixel_indices,
        weights,
        **channels,
        num_pixels=height * width,
    )
    sums = aggregate_prepared_sparse_boundary_weighted_sums(index, prepared)

    finite = np.isfinite(weights)
    scalar_channels = {
        "total": np.ones(pixel_indices.size, dtype=bool),
        **channels,
    }
    for channel_name, channel in scalar_channels.items():
        expected = []
        for feature in features:
            owner = masks[feature.boundary_id].ravel()[pixel_indices]
            expected.append(
                float(weights[owner & finite & channel].sum(dtype=np.float64))
            )
        np.testing.assert_allclose(
            getattr(sums, channel_name),
            expected,
            rtol=1e-13,
            atol=1e-9,
        )


def test_topology_cache_reuses_only_matching_grid_and_boundary_identity():
    feature = _feature("only", "Only")
    masks = {"only": np.array([[True, False, False], [False, False, False]])}
    cache = BoundaryTopologyCache()

    # Empty catalogs isolate cache-key behavior without invoking rasterio.
    first, first_hit = cache.get({"departments": []}, _fingerprint())
    second, second_hit = cache.get({"departments": []}, _fingerprint())
    changed, changed_hit = cache.get({"municipalities": []}, _fingerprint())

    assert first_hit is False
    assert second_hit is True
    assert first is second
    assert changed_hit is False
    assert changed is not first
    assert build_boundary_topology_index(
        "departments",
        [feature],
        _fingerprint(),
        mask_provider=_provider(masks),
    ).boundary_ids == ("only",)


def test_weighted_aggregation_filters_nan_infinity_and_nodata():
    feature = _feature("only", "Only")
    all_cells = np.ones((2, 3), dtype=bool)
    index = build_boundary_topology_index(
        "runaps",
        [feature],
        _fingerprint(),
        mode="overlap",
        mask_provider=_provider({"only": all_cells}),
    )
    valid = np.array([[True, True, False], [True, True, True]])

    counts = aggregate_boundary_counts(
        index,
        total=all_cells,
        selected=all_cells,
        pre_existing=all_cells,
        new_prioritizr=all_cells,
        valid_mask=valid,
    )
    sums = aggregate_boundary_weighted_sums(
        index,
        np.array([[1.0, np.nan, 3.0], [4.0, np.inf, 6.0]]),
        total=all_cells,
        selected=all_cells,
        pre_existing=all_cells,
        new_prioritizr=all_cells,
        valid_mask=valid,
    )

    assert counts.total.tolist() == [5]
    np.testing.assert_array_equal(counts.selected, counts.total)
    np.testing.assert_allclose(sums.total, [11.0])
    np.testing.assert_array_equal(sums.selected, sums.total)
    np.testing.assert_array_equal(sums.pre_existing, sums.total)
    np.testing.assert_array_equal(sums.new_prioritizr, sums.total)


def test_randomized_csr_channels_match_independent_scalar_masks():
    rng = np.random.default_rng(20260819)
    height, width = 9, 7
    fingerprint = RasterFingerprint(
        width=width,
        height=height,
        transform=(1.0, 0.0, 0.0, 0.0, -1.0, float(height)),
        crs="EPSG:4326",
    )
    features = [_feature(f"boundary-{index}", f"Boundary {index}") for index in range(6)]
    masks = {
        feature.boundary_id: rng.random((height, width)) < 0.35
        for feature in features
    }
    index = build_boundary_topology_index(
        "omecs",
        features,
        fingerprint,
        mode="overlap",
        mask_provider=_provider(masks),
    )
    channels = {
        "total": rng.random((height, width)) < 0.9,
        "selected": rng.random((height, width)) < 0.45,
        "pre_existing": rng.random((height, width)) < 0.3,
        "new_prioritizr": rng.random((height, width)) < 0.25,
    }
    valid = rng.random((height, width)) < 0.85
    weights = rng.normal(loc=2.0, scale=3.0, size=(height, width))
    weights[0, 0] = np.nan
    weights[1, 1] = np.inf

    counts = aggregate_boundary_counts(
        index,
        **channels,
        valid_mask=valid,
    )
    sums = aggregate_boundary_weighted_sums(
        index,
        weights,
        **channels,
        valid_mask=valid,
    )

    finite = np.isfinite(weights)
    for channel_name, channel in channels.items():
        expected_counts = []
        expected_sums = []
        for feature in features:
            owner = masks[feature.boundary_id]
            active = owner & channel & valid
            expected_counts.append(int(np.count_nonzero(active)))
            expected_sums.append(
                float(np.sum(weights[active & finite], dtype=np.float64))
            )
        np.testing.assert_array_equal(
            getattr(counts, channel_name),
            expected_counts,
        )
        np.testing.assert_allclose(
            getattr(sums, channel_name),
            expected_sums,
            rtol=1e-13,
            atol=1e-13,
        )


def test_explicit_cached_audit_fails_when_sources_are_unavailable(tmp_path):
    with pytest.raises(
        BoundaryTopologyAuditUnavailable,
        match="audit cannot run.*missing",
    ):
        audit_cached_boundary_topology(
            tmp_path,
            "siraps",
            _fingerprint(),
        )


@pytest.mark.skipif(
    not _PINNED_CACHE_AVAILABLE,
    reason="Optional cache-only audit requires all pinned boundary snapshots.",
)
def test_optional_cached_pinned_sirap_topology_audit():
    transform = from_bounds(-82.0, -5.0, -66.0, 14.0, 48, 57)
    fingerprint = RasterFingerprint(
        width=48,
        height=57,
        transform=tuple(transform)[:6],
        crs="EPSG:4326",
    )
    index = audit_cached_boundary_topology(
        _PINNED_CACHE_DIR,
        "siraps",
        fingerprint,
    )

    assert isinstance(index, OverlapBoundaryIndex)
    assert index.total_claims == 887
    assert index.claimed_pixels == 831
    assert index.overlap_pixels == 56
    assert index.max_multiplicity == 2
    assert int(boundary_cell_counts(index).sum()) == index.total_claims
    assert all(item.source_sha256 for item in index.boundary_provenance)
    assert all(item.source_url for item in index.boundary_provenance)
