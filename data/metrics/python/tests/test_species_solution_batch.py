
import hashlib
import json

import main as pipeline
import numpy as np
import pytest
import rasterio
from boundaries.boundary_topology import (
    ExclusiveBoundaryIndex,
    OverlapBoundaryIndex,
    aggregate_prepared_sparse_boundary_weighted_sums,
    prepare_sparse_boundary_weighted_channels,
)
from calculators.species import SpeciesAccumulator
from raster_metrics import RasterFingerprint
from rasterio.transform import from_origin
from species_data import SpeciesRecord, compute_pool_sizes
from species_overlap import SpeciesOverlap
from species_solution_batch import (
    BUFFERED_MICROBATCH_EXECUTION,
    MICROBATCH_EXECUTION,
    SpeciesSolutionBatchCancelled,
    SpeciesSolutionBatchError,
    build_batch_binding,
    build_checkpoint_metadata,
    build_release_batch_binding,
    category_mask_sha256,
    checkpoint_is_resumable,
    discover_exact_overlap_inventory,
    evaluate_species_batch,
    load_category_matrix,
    process_exact_species_batch,
    resolve_species_execution,
    validate_category_matrix,
)
from species_target_policy import SpeciesTargetPolicy


def _fingerprint() -> RasterFingerprint:
    return RasterFingerprint(
        width=4,
        height=2,
        transform=(1.0, 0.0, 0.0, 0.0, -1.0, 2.0),
        crs="EPSG:9377",
    )


def _exclusive() -> ExclusiveBoundaryIndex:
    owners = np.array([0, 0, 1, 1, 0, 1, -1, 1], dtype=np.int32)
    return ExclusiveBoundaryIndex(
        level="departments",
        boundary_ids=("a", "b"),
        boundary_names=("A", "B"),
        boundary_provenance=(),
        total_claims=7,
        claimed_pixels=7,
        overlap_pixels=0,
        max_multiplicity=1,
        estimated_bytes=owners.nbytes,
        estimated_peak_build_bytes=owners.nbytes,
        flat=owners,
    )


def _overlap() -> OverlapBoundaryIndex:
    # Pixel owners: [0], [0,1], [1], [], [0], [1], [], [0,1].
    offsets = np.array([0, 1, 3, 4, 4, 5, 6, 6, 8], dtype=np.int64)
    owners = np.array([0, 0, 1, 1, 0, 1, 0, 1], dtype=np.int32)
    return OverlapBoundaryIndex(
        level="siraps",
        boundary_ids=("a", "b"),
        boundary_names=("A", "B"),
        boundary_provenance=(),
        total_claims=8,
        claimed_pixels=6,
        overlap_pixels=2,
        max_multiplicity=2,
        estimated_bytes=offsets.nbytes + owners.nbytes,
        estimated_peak_build_bytes=offsets.nbytes + owners.nbytes,
        offsets=offsets,
        boundary_indices=owners,
    )


def _overlap_values() -> SpeciesOverlap:
    return SpeciesOverlap(
        flat_indices=np.array([0, 1, 2, 4, 7], dtype=np.int64),
        areas_m2=np.array([1.0, 0.25, 2.0, 0.5, 0.125], dtype=np.float64),
    )


def _categories() -> np.ndarray:
    return np.array(
        [
            [0, 1],
            [1, 2],
            [2, 0],
            [0, 0],
            [1, 2],
            [0, 0],
            [0, 0],
            [2, 1],
        ],
        dtype=np.uint8,
    )


def _record(name: str = "Species one") -> SpeciesRecord:
    return SpeciesRecord(
        scientific_name=name,
        csv_class="Mammalia",
        iucn_status="VU",
        range_km2=1.0,
        bucket="mammals",
        threatened=True,
    )


def _accumulators(records: list[SpeciesRecord]) -> list[SpeciesAccumulator]:
    pool = compute_pool_sizes(records)
    policies = (
        SpeciesTargetPolicy("scalar", 30.0, {}, {"kind": "scalar"}),
        SpeciesTargetPolicy(
            "per_species",
            None,
            {"species_one": 50.0},
            {"kind": "per_species"},
        ),
    )
    values = [
        SpeciesAccumulator(
            target_pct=policy.scalar_target_pct,
            pool_sizes=pool,
            target_policy=policy,
            species_expected=len(records),
        )
        for policy in policies
    ]
    for value in values:
        value.init_sub({"departments": 2, "siraps": 2})
    return values


def _setup_policies():
    return {
        "first": SpeciesTargetPolicy("scalar", 10.0, {}, {"kind": "scalar"}),
        "second": SpeciesTargetPolicy("scalar", 20.0, {}, {"kind": "scalar"}),
        "third": SpeciesTargetPolicy("scalar", 30.0, {}, {"kind": "scalar"}),
    }


def test_microbatch_sink_constructor_failure_preserves_member_order():
    records = [_record()]
    policies = _setup_policies()

    def build_sink(solution_id, _policy):
        if solution_id == "second":
            raise RuntimeError("sink constructor failed")

    sinks, accumulators, failures = pipeline._initialize_species_microbatch_members(
        ordered_ids=["first", "second", "third"],
        target_policies=policies,
        pool_sizes=compute_pool_sizes(records),
        species_expected=1,
        sub_sizes={},
        sink_factory=build_sink,
    )

    assert sinks == [None, None, None]
    assert [value is not None for value in accumulators] == [True, False, True]
    assert list(failures) == ["second"]
    assert "sink constructor failed" in failures["second"][0]


def test_microbatch_accumulator_constructor_failure_preserves_siblings(monkeypatch):
    records = [_record()]
    policies = _setup_policies()
    real_accumulator = pipeline.SpeciesAccumulator

    def construct_accumulator(**kwargs):
        if kwargs["target_pct"] == 20.0:
            raise RuntimeError("accumulator constructor failed")
        return real_accumulator(**kwargs)

    monkeypatch.setattr(pipeline, "SpeciesAccumulator", construct_accumulator)
    _sinks, accumulators, failures = pipeline._initialize_species_microbatch_members(
        ordered_ids=["first", "second", "third"],
        target_policies=policies,
        pool_sizes=compute_pool_sizes(records),
        species_expected=1,
        sub_sizes={},
        sink_factory=lambda *_args: None,
    )

    assert [value is not None for value in accumulators] == [True, False, True]
    assert list(failures) == ["second"]
    assert "accumulator constructor failed" in failures["second"][0]


def test_microbatch_accumulator_init_failure_closes_only_failed_sink(monkeypatch):
    policies = _setup_policies()
    closed = []

    class Sink:
        def __init__(self, solution_id):
            self.solution_id = solution_id

        def close(self):
            closed.append(self.solution_id)

    class Accumulator:
        def __init__(self, **kwargs):
            self.target_pct = kwargs["target_pct"]

        def init_sub(self, _sub_sizes):
            if self.target_pct == 20.0:
                raise RuntimeError("init failed")

    monkeypatch.setattr(pipeline, "SpeciesAccumulator", Accumulator)
    sinks, accumulators, failures = pipeline._initialize_species_microbatch_members(
        ordered_ids=["first", "second", "third"],
        target_policies=policies,
        pool_sizes=compute_pool_sizes([_record()]),
        species_expected=1,
        sub_sizes={"departments": 2},
        sink_factory=lambda solution_id, _policy: Sink(solution_id),
    )

    assert [sink.solution_id if sink else None for sink in sinks] == [
        "first",
        None,
        "third",
    ]
    assert [value is not None for value in accumulators] == [True, False, True]
    assert list(failures) == ["second"]
    assert closed == ["second"]


def test_microbatch_close_failure_is_returned_without_suppressing_siblings():
    closed = []

    class Sink:
        def __init__(self, solution_id, *, fail=False):
            self.solution_id = solution_id
            self.fail = fail

        def close(self):
            closed.append(self.solution_id)
            if self.fail:
                raise RuntimeError("close failed")

    errors = [
        pipeline._close_species_goals_sink(Sink("first", fail=True)),
        pipeline._close_species_goals_sink(Sink("second")),
    ]

    assert isinstance(errors[0], RuntimeError)
    assert errors[1] is None
    assert closed == ["first", "second"]


def test_post_close_finalization_failure_does_not_close_sink_twice():
    class Sink:
        def __init__(self):
            self.closed = False
            self.close_calls = 0

        def close(self):
            self.close_calls += 1
            self.closed = True

    sink = Sink()
    assert pipeline._close_species_goals_sink(sink) is None
    primary = RuntimeError("post-close finalization failed")
    cleanup_error = pipeline._close_species_goals_sink(sink)

    assert cleanup_error is None
    assert sink.close_calls == 1
    assert str(primary) == "post-close finalization failed"


def test_category_matrix_is_cell_major_uint8_and_nodata_is_zero(tmp_path):
    paths = []
    for index, data in enumerate(
        (
            np.array([[0, 1], [2, 255]], dtype=np.uint8),
            np.array([[2, 0], [1, 255]], dtype=np.uint8),
        )
    ):
        path = tmp_path / f"solution-{index}.tif"
        with rasterio.open(
            path,
            "w",
            driver="GTiff",
            width=2,
            height=2,
            count=1,
            dtype="uint8",
            crs="EPSG:9377",
            transform=from_origin(0, 2, 1, 1),
            nodata=255,
        ) as dataset:
            dataset.write(data, 1)
        paths.append(path)

    matrix = load_category_matrix(paths)

    assert matrix.values.flags.c_contiguous
    assert matrix.values.dtype == np.uint8
    assert matrix.values.tolist() == [[0, 2], [1, 0], [2, 1], [0, 0]]


def test_category_validation_rejects_wrong_dtype_and_values():
    with pytest.raises(SpeciesSolutionBatchError, match="uint8"):
        validate_category_matrix(np.zeros((4, 2), dtype=bool))
    with pytest.raises(SpeciesSolutionBatchError, match="0, 1, or 2"):
        validate_category_matrix(np.array([[0], [3]], dtype=np.uint8))


def test_exact_partial_national_channels_preserve_source_order():
    result = evaluate_species_batch(_overlap_values(), _categories(), {})

    assert result.national.total == 3.875
    assert result.national.selected.tolist() == [2.875, 1.875]
    assert result.national.pre_existing.tolist() == [2.125, 0.75]
    assert result.national.new_prioritizr.tolist() == [0.75, 1.125]
    np.testing.assert_array_equal(
        result.national.selected,
        result.national.pre_existing + result.national.new_prioritizr,
    )


@pytest.mark.parametrize(
    ("level", "index"),
    (("departments", _exclusive()), ("siraps", _overlap())),
)
def test_batch_boundary_channels_match_current_grouped_path(level, index):
    overlap = _overlap_values()
    categories = _categories()
    observed = evaluate_species_batch(overlap, categories, {level: index}).boundaries[
        level
    ]

    for solution_index in range(categories.shape[1]):
        at_range = categories[overlap.flat_indices, solution_index]
        prepared = prepare_sparse_boundary_weighted_channels(
            overlap.flat_indices,
            overlap.areas_m2,
            selected=at_range != 0,
            pre_existing=at_range == 2,
            new_prioritizr=at_range == 1,
            num_pixels=categories.shape[0],
        )
        expected = aggregate_prepared_sparse_boundary_weighted_sums(index, prepared)
        np.testing.assert_allclose(observed.total, expected.total, rtol=1e-12, atol=1e-6)
        for channel in ("selected", "pre_existing", "new_prioritizr"):
            np.testing.assert_allclose(
                getattr(observed, channel)[solution_index],
                getattr(expected, channel),
                rtol=1e-12,
                atol=1e-6,
            )


def test_process_opens_each_species_once_and_applies_target_policies(tmp_path):
    records = [_record()]
    path = tmp_path / "overlap.npz"
    path.write_bytes(b"fixture")
    opens = []

    def load(observed_path, fingerprint):
        opens.append((observed_path, fingerprint))
        return _overlap_values()

    accumulators = _accumulators(records)
    stats = process_exact_species_batch(
        species_records=records,
        overlap_paths=[path],
        categories=_categories(),
        fingerprint=_fingerprint(),
        boundary_indexes={"departments": _exclusive(), "siraps": _overlap()},
        accumulators=accumulators,
        overlap_loader=load,
    )

    assert stats.npz_opens == 1
    assert opens == [(path, _fingerprint())]
    assert [value.national.all_present for value in accumulators] == [1, 1]
    assert [value.national.threatened_secured for value in accumulators] == [1, 0]
    assert [value.species_processed for value in accumulators] == [1, 1]


def test_solution_specific_accumulator_failure_preserves_healthy_sibling(tmp_path):
    records = [_record("First"), _record("Second")]
    paths = [tmp_path / "first.npz", tmp_path / "second.npz"]
    for path in paths:
        path.write_bytes(b"x")
    accumulators = _accumulators(records)

    def fail_national(*_args, **_kwargs):
        raise RuntimeError("isolated sink failure")

    accumulators[0].record_species_national = fail_national
    stats = process_exact_species_batch(
        species_records=records,
        overlap_paths=paths,
        categories=_categories(),
        fingerprint=_fingerprint(),
        boundary_indexes={"departments": _exclusive(), "siraps": _overlap()},
        accumulators=accumulators,
        overlap_loader=lambda *_args: _overlap_values(),
    )

    assert stats.npz_opens == 2
    assert len(stats.solution_failures) == 1
    assert stats.solution_failures[0].solution_index == 0
    assert stats.solution_failures[0].species_index == 0
    assert accumulators[1].species_processed == 2
    assert accumulators[1].national.all_present == 2


def test_processing_preserves_catalog_order_and_cancels_at_species_boundary(tmp_path):
    records = [_record("First"), _record("Second")]
    paths = [tmp_path / "first.npz", tmp_path / "second.npz"]
    for path in paths:
        path.write_bytes(b"x")
    loaded = []

    def load(path, _fingerprint):
        loaded.append(path.name)
        return _overlap_values()

    checks = iter((False, True))
    with pytest.raises(SpeciesSolutionBatchCancelled, match="index 1"):
        process_exact_species_batch(
            species_records=records,
            overlap_paths=paths,
            categories=_categories(),
            fingerprint=_fingerprint(),
            boundary_indexes={},
            overlap_loader=load,
            cancel_check=lambda: next(checks),
        )
    assert loaded == ["first.npz"]


def test_binding_and_checkpoint_are_order_sensitive_and_fail_closed():
    hashes = ["1" * 64, "2" * 64]
    binding = build_batch_binding(
        exact_cache_inventory_sha256="a" * 64,
        ordered_solution_ids=["first", "second"],
        solution_sha256s=hashes,
        topology_provenance_sha256="b" * 64,
        target_policy_sha256s=["3" * 64, "4" * 64],
        species_catalog_sha256="c" * 64,
    )
    reversed_binding = build_batch_binding(
        exact_cache_inventory_sha256="a" * 64,
        ordered_solution_ids=["second", "first"],
        solution_sha256s=list(reversed(hashes)),
        topology_provenance_sha256="b" * 64,
        target_policy_sha256s=["4" * 64, "3" * 64],
        species_catalog_sha256="c" * 64,
    )
    checkpoint = build_checkpoint_metadata(
        binding=binding,
        completed_species_count=64,
        species_count=128,
    )

    assert binding["sha256"] != reversed_binding["sha256"]
    assert checkpoint_is_resumable(checkpoint, binding=binding, species_count=128)
    assert not checkpoint_is_resumable(
        checkpoint,
        binding=reversed_binding,
        species_count=128,
    )
    with pytest.raises(SpeciesSolutionBatchError, match="unique"):
        build_batch_binding(
            exact_cache_inventory_sha256="a" * 64,
            ordered_solution_ids=["same", "same"],
            solution_sha256s=hashes,
            topology_provenance_sha256="b" * 64,
            target_policy_sha256s=["3" * 64, "4" * 64],
            species_catalog_sha256="c" * 64,
        )


def test_species_execution_defaults_and_invalid_values_fail_closed(monkeypatch):
    monkeypatch.delenv("METRICS_SPECIES_EXECUTION", raising=False)
    monkeypatch.delenv("METRICS_SPECIES_BATCH_SIZE", raising=False)
    assert resolve_species_execution().effective_mode == "independent"
    assert resolve_species_execution().batch_size == 1

    configured = resolve_species_execution(MICROBATCH_EXECUTION)
    assert configured.batch_size == 8
    assert configured.is_microbatch
    assert resolve_species_execution(MICROBATCH_EXECUTION, 4).batch_size == 4
    buffered = resolve_species_execution(BUFFERED_MICROBATCH_EXECUTION, 8)
    assert buffered.is_microbatch
    assert buffered.is_buffered_microbatch
    assert buffered.algorithm_version.endswith("-v2")

    with pytest.raises(SpeciesSolutionBatchError, match="must be"):
        resolve_species_execution("unknown")
    with pytest.raises(SpeciesSolutionBatchError, match="positive integer"):
        resolve_species_execution(MICROBATCH_EXECUTION, 0)


def test_main_microbatch_guard_requires_recompute_all_and_grouped():
    independent = resolve_species_execution("independent")
    pipeline._validate_species_execution_run(
        independent,
        cache_policy="use-cache",
        boundary_fanout_mode="legacy",
    )
    microbatch = resolve_species_execution(MICROBATCH_EXECUTION)
    with pytest.raises(ValueError, match="recompute-all"):
        pipeline._validate_species_execution_run(
            microbatch,
            cache_policy="use-cache",
            boundary_fanout_mode="grouped",
        )
    with pytest.raises(ValueError, match="requires METRICS_BOUNDARY_FANOUT=grouped"):
        pipeline._validate_species_execution_run(
            microbatch,
            cache_policy="recompute-all",
            boundary_fanout_mode="legacy",
        )
    pipeline._validate_species_execution_run(
        microbatch,
        cache_policy="recompute-all",
        boundary_fanout_mode="grouped",
    )


def test_release_binding_changes_for_every_bound_component():
    base = {
        "ordered_solution_ids": ["one", "two"],
        "solution_raster_sha256s": ["1" * 64, "2" * 64],
        "category_mask_sha256s": ["3" * 64, "4" * 64],
        "exact_overlap_inventory": {"inventorySha256": "5" * 64},
        "species_records_component": {"sha256": "6" * 64},
        "target_policy_sha256s": ["7" * 64, "8" * 64],
        "boundary_component": {"sha256": "9" * 64},
        "active_geography_levels": ["national", "siraps"],
        "batch_ordinal": 0,
        "configured_batch_size": 8,
    }
    original = build_release_batch_binding(**base)
    variants = (
        {"ordered_solution_ids": ["two", "one"]},
        {"solution_raster_sha256s": ["a" * 64, "2" * 64]},
        {"category_mask_sha256s": ["b" * 64, "4" * 64]},
        {"exact_overlap_inventory": {"inventorySha256": "c" * 64}},
        {"species_records_component": {"sha256": "d" * 64}},
        {"target_policy_sha256s": ["e" * 64, "8" * 64]},
        {"boundary_component": {"sha256": "f" * 64}},
        {"active_geography_levels": ["national"]},
        {"batch_ordinal": 1},
        {"configured_batch_size": 2},
        {"algorithm_version": "solution-microbatch-buffered-exact-npz-v2"},
    )
    for change in variants:
        candidate = build_release_batch_binding(**{**base, **change})
        assert candidate["sha256"] != original["sha256"]


def test_category_checksum_is_shape_and_order_bound():
    values = np.array([0, 1, 2, 0], dtype=np.uint8)
    assert category_mask_sha256(values) == category_mask_sha256(values.copy())
    assert category_mask_sha256(values) != category_mask_sha256(values[::-1].copy())
    with pytest.raises(SpeciesSolutionBatchError, match="uint8 vector"):
        category_mask_sha256(values.astype(np.int16))


def test_exact_inventory_verifies_and_binds_consumed_npz(tmp_path):
    record = _record()
    artifact = tmp_path / "species-overlap" / "aa" / "cache.npz"
    artifact.parent.mkdir(parents=True)
    artifact.write_bytes(b"verified exact overlap")
    digest = hashlib.sha256(artifact.read_bytes()).hexdigest()
    artifact.with_suffix(".json").write_text(
        json.dumps(
            {
                "format": "species-exact-overlap-v1",
                "sourceUrl": record.blob_url,
                "sourceSha256": "1" * 64,
                "targetGridSha256": "2" * 64,
                "cacheKey": "cache",
                "overlapSha256": digest,
                "policy": {"kind": "exact"},
                "policySha256": "3" * 64,
                "qa": {"algorithmVersion": "exact-v1"},
            }
        ),
        encoding="utf-8",
    )

    inputs, inventory = discover_exact_overlap_inventory(
        tmp_path,
        [record],
        target_grid_sha256="2" * 64,
    )

    assert [value.path for value in inputs] == [artifact]
    assert inputs[0].expected_sha256 == digest
    assert inventory["speciesCount"] == 1
    assert inventory["entriesSha256"]


def test_processing_rehashes_discovered_inventory_before_accumulation(tmp_path):
    record = _record()
    artifact = tmp_path / "species-overlap" / "aa" / "cache.npz"
    artifact.parent.mkdir(parents=True)
    original = b"original exact bytes"
    artifact.write_bytes(original)
    artifact.with_suffix(".json").write_text(
        json.dumps(
            {
                "format": "species-exact-overlap-v1",
                "sourceUrl": record.blob_url,
                "sourceSha256": "1" * 64,
                "targetGridSha256": "2" * 64,
                "cacheKey": "cache",
                "overlapSha256": hashlib.sha256(original).hexdigest(),
                "policy": {"kind": "exact"},
                "policySha256": "3" * 64,
                "qa": {"algorithmVersion": "exact-v1"},
            }
        ),
        encoding="utf-8",
    )
    inputs, _inventory = discover_exact_overlap_inventory(
        tmp_path,
        [record],
        target_grid_sha256="2" * 64,
    )
    artifact.write_bytes(b"x" * len(original))
    loader_called = False
    accumulator = _accumulators([record])[0]

    def load(*_args):
        nonlocal loader_called
        loader_called = True
        return _overlap_values()

    with pytest.raises(SpeciesSolutionBatchError, match="changed after discovery"):
        process_exact_species_batch(
            species_records=[record],
            overlap_paths=inputs,
            categories=_categories()[:, :1],
            fingerprint=_fingerprint(),
            boundary_indexes={},
            accumulators=[accumulator],
            overlap_loader=load,
        )

    assert not loader_called
    assert accumulator.species_processed == 0


def test_exact_inventory_rejects_same_size_in_place_corruption(tmp_path):
    record = _record()
    artifact = tmp_path / "species-overlap" / "aa" / "cache.npz"
    artifact.parent.mkdir(parents=True)
    original = b"original exact bytes"
    artifact.write_bytes(original)
    artifact.with_suffix(".json").write_text(
        json.dumps(
            {
                "format": "species-exact-overlap-v1",
                "sourceUrl": record.blob_url,
                "sourceSha256": "1" * 64,
                "targetGridSha256": "2" * 64,
                "cacheKey": "cache",
                "overlapSha256": hashlib.sha256(original).hexdigest(),
                "policy": {"kind": "exact"},
                "policySha256": "3" * 64,
                "qa": {"algorithmVersion": "exact-v1"},
            }
        ),
        encoding="utf-8",
    )
    artifact.write_bytes(b"x" * len(original))

    with pytest.raises(SpeciesSolutionBatchError, match="checksum mismatch"):
        discover_exact_overlap_inventory(
            tmp_path,
            [record],
            target_grid_sha256="2" * 64,
        )


def test_exact_inventory_accepts_identical_toolchain_cache_aliases(tmp_path):
    record = _record()
    overlap_sha = hashlib.sha256(b"same exact bytes").hexdigest()
    for cache_key, tools in (("a" * 64, {"gdal": "3.10"}), ("b" * 64, {"gdal": "3.12"})):
        artifact = tmp_path / "species-overlap" / cache_key[:2] / f"{cache_key}.npz"
        artifact.parent.mkdir(parents=True, exist_ok=True)
        artifact.write_bytes(b"same exact bytes")
        artifact.with_suffix(".json").write_text(
            json.dumps(
                {
                    "format": "species-exact-overlap-v1",
                    "sourceUrl": record.blob_url,
                    "sourceSha256": "1" * 64,
                    "targetGrid": {"width": 4, "height": 2},
                    "targetGridSha256": "2" * 64,
                    "cacheKey": cache_key,
                    "overlapSha256": overlap_sha,
                    "policy": {"kind": "exact"},
                    "policySha256": "3" * 64,
                    "authoritativeAreaKm2": 1.0,
                    "qa": {
                        "algorithmVersion": "exact-v1",
                        "positiveTargetCellCount": 2,
                    },
                    "tools": tools,
                }
            ),
            encoding="utf-8",
        )

    inputs, inventory = discover_exact_overlap_inventory(
        tmp_path,
        [record],
        target_grid_sha256="2" * 64,
    )

    assert inputs[0].path.name == f"{'a' * 64}.npz"
    assert inventory["speciesCount"] == 1


def test_randomized_multi_owner_batch_matches_grouped_kernel():
    rng = np.random.default_rng(20260820)
    num_cells = 128
    num_boundaries = 7
    owner_lists = [
        np.sort(rng.choice(num_boundaries, size=rng.integers(0, 5), replace=False))
        for _ in range(num_cells)
    ]
    offsets = np.zeros(num_cells + 1, dtype=np.int64)
    offsets[1:] = np.cumsum([owners.size for owners in owner_lists])
    owners = np.concatenate(owner_lists).astype(np.int32)
    index = OverlapBoundaryIndex(
        level="random",
        boundary_ids=tuple(str(value) for value in range(num_boundaries)),
        boundary_names=tuple(str(value) for value in range(num_boundaries)),
        boundary_provenance=(),
        total_claims=int(owners.size),
        claimed_pixels=sum(bool(value.size) for value in owner_lists),
        overlap_pixels=sum(value.size > 1 for value in owner_lists),
        max_multiplicity=max(value.size for value in owner_lists),
        estimated_bytes=offsets.nbytes + owners.nbytes,
        estimated_peak_build_bytes=offsets.nbytes + owners.nbytes,
        offsets=offsets,
        boundary_indices=owners,
    )
    flat_indices = np.sort(rng.choice(num_cells, size=83, replace=False))
    overlap = SpeciesOverlap(
        flat_indices=flat_indices,
        areas_m2=rng.random(flat_indices.size).astype(np.float64),
    )
    categories = rng.integers(0, 3, size=(num_cells, 5), dtype=np.uint8)
    observed = evaluate_species_batch(
        overlap,
        categories,
        {"random": index},
    ).boundaries["random"]

    for solution_index in range(categories.shape[1]):
        at_range = categories[flat_indices, solution_index]
        expected = aggregate_prepared_sparse_boundary_weighted_sums(
            index,
            prepare_sparse_boundary_weighted_channels(
                flat_indices,
                overlap.areas_m2,
                selected=at_range != 0,
                pre_existing=at_range == 2,
                new_prioritizr=at_range == 1,
                num_pixels=num_cells,
            ),
        )
        for channel in ("total", "selected", "pre_existing", "new_prioritizr"):
            actual = getattr(observed, channel)
            if channel != "total":
                actual = actual[solution_index]
            np.testing.assert_allclose(
                actual,
                getattr(expected, channel),
                rtol=1e-12,
                atol=1e-6,
            )
