from __future__ import annotations

import fcntl
import hashlib
import os
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import pyproj
import pytest
import rasterio
from calculators.species import SpeciesAccumulator, SpeciesScopeMetrics
from raster_align import AlignmentError, RasterAlignmentCache
from raster_metrics import RasterFingerprint
from rasterio.transform import from_origin
from rasterio.warp import calculate_default_transform
from shapely.geometry import Polygon
from shapely.ops import transform as transform_geometry
from species_data import SpeciesPoolSizes, SpeciesRecord
from species_overlap import (
    SPECIES_OVERLAP_ALGORITHM_VERSION,
    SpeciesOverlapCache,
    read_species_overlap,
)
from species_target_policy import SpeciesTargetPolicy


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _write_species(
    path: Path,
    values: np.ndarray,
    *,
    west: float = -74.01,
    north: float = 4.01,
    pixel_size: float = 1 / 120,
    nodata: int = 255,
) -> None:
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        width=values.shape[1],
        height=values.shape[0],
        count=1,
        dtype="uint8",
        crs="EPSG:4326",
        transform=from_origin(west, north, pixel_size, pixel_size),
        nodata=nodata,
        tiled=False,
    ) as dataset:
        dataset.write(values, 1)


def _target_for_source(path: Path, *, padding_cells: int = 2) -> RasterFingerprint:
    with rasterio.open(path) as source:
        transform, width, height = calculate_default_transform(
            source.crs,
            "EPSG:9377",
            source.width,
            source.height,
            *source.bounds,
            resolution=1000,
        )
    transform = rasterio.Affine(
        transform.a,
        transform.b,
        transform.c - padding_cells * 1000,
        transform.d,
        transform.e,
        transform.f + padding_cells * 1000,
    )
    return RasterFingerprint(
        width=width + 2 * padding_cells,
        height=height + 2 * padding_cells,
        transform=tuple(transform)[:6],
        crs="EPSG:9377",
    )


def _cache(tmp_path: Path) -> RasterAlignmentCache:
    return RasterAlignmentCache(tmp_path / "cache", max_cache_gb=0.1)


def test_fragmented_exact_overlap_conserves_area_and_is_sparse(tmp_path: Path):
    source = tmp_path / "fragmented.tif"
    values = np.zeros((5, 7), dtype=np.uint8)
    values[0, 0] = 1
    values[2, 4] = 1
    values[4, 6] = 1
    _write_species(source, values)
    target = _target_for_source(source)

    result = _cache(tmp_path).species.align(
        source,
        _sha256(source),
        target,
        authoritative_area_km2=2.55,
    )
    overlap = read_species_overlap(result.path, target)
    qa = result.manifest["qa"]

    assert result.path.suffix == ".npz"
    assert overlap.flat_indices.size < target.width * target.height
    assert qa["algorithmVersion"] == SPECIES_OVERLAP_ALGORITHM_VERSION
    assert qa["sourcePresentCellCount"] == 3
    assert qa["sourceCellsLostInsideTargetExtent"] == 0
    assert abs(qa["conservationDeltaM2"]) <= qa["conservationToleranceM2"]
    assert 0 < qa["minimumOverlapFraction"] <= qa["maximumOverlapFraction"] <= 1


def test_one_cell_overlap_matches_independent_geometry_oracle(tmp_path: Path):
    source = tmp_path / "one-cell.tif"
    _write_species(source, np.ones((1, 1), dtype=np.uint8))
    target = _target_for_source(source)

    result = _cache(tmp_path).species.align(
        source,
        _sha256(source),
        target,
        authoritative_area_km2=0.85,
    )
    overlap = read_species_overlap(result.path, target)

    with rasterio.open(source) as dataset:
        transform = dataset.transform
        polygon = Polygon(
            [
                transform * (0, 0),
                transform * (1, 0),
                transform * (1, 1),
                transform * (0, 1),
            ]
        )
        transformer = pyproj.Transformer.from_crs(
            dataset.crs, target.crs, always_xy=True
        )
    projected = transform_geometry(transformer.transform, polygon)
    target_transform = rasterio.Affine(*target.transform)
    oracle = 0.0
    for row in range(target.height):
        for col in range(target.width):
            cell = Polygon(
                [
                    target_transform * (col, row),
                    target_transform * (col + 1, row),
                    target_transform * (col + 1, row + 1),
                    target_transform * (col, row + 1),
                ]
            )
            oracle += projected.intersection(cell).area

    assert overlap.intersected_area_m2 == pytest.approx(oracle, abs=2.0)


def test_zero_range_species_produces_empty_sparse_artifact(tmp_path: Path):
    source = tmp_path / "zero.tif"
    _write_species(source, np.zeros((2, 2), dtype=np.uint8))
    target = _target_for_source(source)

    result = _cache(tmp_path).species.align(
        source,
        _sha256(source),
        target,
        authoritative_area_km2=0.0,
    )

    overlap = read_species_overlap(result.path, target)
    assert overlap.flat_indices.size == 0
    assert result.manifest["qa"]["intersectedAreaKm2"] == 0


def test_invalid_value_and_nodata_contracts_are_fatal(tmp_path: Path):
    target_source = tmp_path / "target-source.tif"
    _write_species(target_source, np.ones((1, 1), dtype=np.uint8))
    target = _target_for_source(target_source)

    invalid = tmp_path / "invalid.tif"
    _write_species(invalid, np.asarray([[2]], dtype=np.uint8))
    with pytest.raises(AlignmentError, match=r"outside \{0, 1\}"):
        _cache(tmp_path).species.align(
            invalid,
            _sha256(invalid),
            target,
            authoritative_area_km2=0.85,
        )

    wrong_nodata = tmp_path / "wrong-nodata.tif"
    _write_species(wrong_nodata, np.ones((1, 1), dtype=np.uint8), nodata=254)
    with pytest.raises(AlignmentError, match="nodata=255"):
        _cache(tmp_path).species.align(
            wrong_nodata,
            _sha256(wrong_nodata),
            target,
            authoritative_area_km2=0.85,
        )


def test_outside_extent_cells_are_reported_not_silently_lost(tmp_path: Path):
    source = tmp_path / "edge.tif"
    _write_species(source, np.ones((1, 3), dtype=np.uint8))
    full_target = _target_for_source(source, padding_cells=0)
    transform = rasterio.Affine(*full_target.transform)
    clipped_target = RasterFingerprint(
        width=1,
        height=full_target.height,
        transform=tuple(transform)[:6],
        crs=full_target.crs,
    )

    result = _cache(tmp_path).species.align(
        source,
        _sha256(source),
        clipped_target,
        authoritative_area_km2=2.55,
    )
    qa = result.manifest["qa"]

    assert qa["sourceCellsOutsideTargetExtent"] >= 1
    assert qa["sourceCellsLostInsideTargetExtent"] == 0
    assert qa["positiveTargetCellCount"] > 0


def test_cache_replay_is_deterministic_and_corruption_rebuilds(tmp_path: Path):
    source = tmp_path / "species.tif"
    _write_species(source, np.asarray([[1, 0], [0, 1]], dtype=np.uint8))
    target = _target_for_source(source)
    cache = _cache(tmp_path)

    first = cache.species.align(
        source,
        _sha256(source),
        target,
        authoritative_area_km2=1.7,
    )
    warm = cache.species.align(
        source,
        _sha256(source),
        target,
        authoritative_area_km2=1.7,
    )
    assert first.cache_hit is False
    assert warm.cache_hit is True
    assert warm.overlap_sha256 == first.overlap_sha256

    first.path.write_bytes(b"corrupt")
    rebuilt = cache.species.align(
        source,
        _sha256(source),
        target,
        authoritative_area_km2=1.7,
    )
    assert rebuilt.cache_hit is False
    assert rebuilt.overlap_sha256 == first.overlap_sha256

    replay = RasterAlignmentCache(
        tmp_path / "second-cache", max_cache_gb=0.1
    ).species.align(
        source,
        _sha256(source),
        target,
        authoritative_area_km2=1.7,
    )
    assert replay.cache_key == first.cache_key
    assert replay.overlap_sha256 == first.overlap_sha256


def test_concurrent_cache_publication_is_coherent(tmp_path: Path):
    source = tmp_path / "species.tif"
    _write_species(source, np.ones((2, 2), dtype=np.uint8))
    target = _target_for_source(source)

    def align():
        return _cache(tmp_path).species.align(
            source,
            _sha256(source),
            target,
            authoritative_area_km2=3.4,
        )

    with ThreadPoolExecutor(max_workers=4) as executor:
        results = list(executor.map(lambda _: align(), range(4)))

    assert len({result.cache_key for result in results}) == 1
    assert len({result.overlap_sha256 for result in results}) == 1
    assert sum(not result.cache_hit for result in results) == 1


def test_eviction_preserves_pinned_species_overlap(tmp_path: Path):
    first_source = tmp_path / "first.tif"
    second_source = tmp_path / "second.tif"
    _write_species(first_source, np.asarray([[1, 0]], dtype=np.uint8))
    _write_species(second_source, np.asarray([[0, 1]], dtype=np.uint8))
    target = _target_for_source(first_source)
    cache = RasterAlignmentCache(tmp_path / "cache", max_cache_gb=1e-9)

    first = cache.species.align(
        first_source,
        _sha256(first_source),
        target,
        authoritative_area_km2=0.85,
        pin=False,
    )
    second = cache.species.align(
        second_source,
        _sha256(second_source),
        target,
        authoritative_area_km2=0.85,
        pin=True,
    )

    assert not first.path.exists()
    assert second.path.is_file()
    assert second.path.with_suffix(".json").is_file()


def test_stale_temp_cleanup_skips_active_locked_write(tmp_path: Path):
    cache_dir = tmp_path / "cache"
    root = cache_dir / "species-overlap"
    root.mkdir(parents=True)
    active_key = "a" * 64
    abandoned_key = "b" * 64
    fresh_key = "c" * 64

    def temporary_path(key: str) -> Path:
        directory = root / key[:2]
        directory.mkdir()
        path = directory / f".{key}.1234.interrupted.tmp.npz"
        path.write_bytes(b"temporary")
        return path

    active = temporary_path(active_key)
    abandoned = temporary_path(abandoned_key)
    fresh = temporary_path(fresh_key)
    stale_time = time.time() - 120
    os.utime(active, (stale_time, stale_time))
    os.utime(abandoned, (stale_time, stale_time))

    active_lock = active.parent / f"{active_key}.lock"
    with active_lock.open("a+b") as handle:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        cache = SpeciesOverlapCache(
            cache_dir,
            max_cache_bytes=1024,
            lock_timeout_seconds=0.1,
            stale_temp_age_seconds=60,
        )
        assert active.is_file()
        assert not abandoned.exists()
        assert fresh.is_file()

    cache.evict()
    assert not active.exists()
    assert fresh.is_file()


def test_species_coverage_uses_exact_area_weights():
    record = SpeciesRecord(
        scientific_name="Example species",
        csv_class="Aves",
        iucn_status="EN",
        range_km2=1.0,
        bucket="birds",
        threatened=True,
    )
    accumulator = SpeciesAccumulator(
        target_pct=30.0,
        pool_sizes=SpeciesPoolSizes(
            total_non_fish=1,
            threatened_total=1,
            by_bucket={
                "mammals": 0,
                "birds": 1,
                "amphibians": 0,
                "reptiles": 0,
                "plants": 0,
            },
        ),
    )

    accumulator.record_species_national(
        record,
        selected_range_area_m2=299_999.0,
        total_range_area_m2=1_000_000.0,
    )
    assert accumulator.national.threatened_present == 1
    assert accumulator.national.threatened_secured == 0

    accumulator.record_species_national(
        record,
        selected_range_area_m2=300_001.0,
        total_range_area_m2=1_000_000.0,
    )
    assert accumulator.national.threatened_secured == 1


def test_per_species_targets_control_eligibility_and_thresholds():
    pool = SpeciesPoolSizes(
        total_non_fish=3,
        threatened_total=3,
        by_bucket={
            "mammals": 0,
            "birds": 3,
            "amphibians": 0,
            "reptiles": 0,
            "plants": 0,
        },
    )
    policy = SpeciesTargetPolicy(
        kind="per_species",
        scalar_target_pct=None,
        targets_by_species={"low_target": 20.0, "high_target": 80.0},
        provenance={},
    )
    accumulator = SpeciesAccumulator(
        target_pct=None,
        pool_sizes=pool,
        target_policy=policy,
    )
    records = [
        SpeciesRecord(name, "Aves", "EN", 1.0, "birds", True)
        for name in ("Low target", "High target", "Not targeted")
    ]

    for record in records:
        accumulator.record_species_national(
            record,
            selected_range_area_m2=500_000,
            total_range_area_m2=1_000_000,
        )

    coverage = accumulator.national.coverage_by_bucket["birds"]
    assert coverage.total == 2
    assert coverage.met == 1
    assert accumulator.national.threatened_present == 3
    assert accumulator.national.threatened_secured == 1


def test_dual_reference_thresholds_are_computed_in_one_accumulator_pass():
    pool = SpeciesPoolSizes(
        total_non_fish=3,
        threatened_total=3,
        by_bucket={
            "mammals": 0,
            "birds": 3,
            "amphibians": 0,
            "reptiles": 0,
            "plants": 0,
        },
    )
    policy = SpeciesTargetPolicy(
        kind="dual_reference",
        scalar_target_pct=None,
        targets_by_species={},
        provenance={},
    )
    accumulator = SpeciesAccumulator(
        target_pct=None,
        pool_sizes=pool,
        target_policy=policy,
    )

    for name, coverage_pct in (("Below", 10), ("Seventeen", 20), ("Thirty", 40)):
        accumulator.record_species_national(
            SpeciesRecord(name, "Aves", "EN", 1.0, "birds", True),
            selected_range_area_m2=coverage_pct,
            total_range_area_m2=100,
        )

    metrics = SpeciesScopeMetrics.from_counts(accumulator.national, pool)
    assert [
        (outcome["targetPercent"], outcome["value"])
        for outcome in metrics.species_group_reference_outcomes
    ] == [(17.0, 2), (30.0, 1)]
    assert [
        (outcome["targetPercent"], outcome["value"])
        for outcome in metrics.threatened_secured_reference_outcomes
    ] == [(17.0, 2), (30.0, 1)]
    assert metrics.species_group_reference_outcomes[0]["details"]["summary"] == {
        "metSpeciesCount": 2,
        "totalSpeciesCount": 3,
    }
