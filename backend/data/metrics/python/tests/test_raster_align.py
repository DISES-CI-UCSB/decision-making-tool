from __future__ import annotations

import hashlib
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import pytest
import rasterio
from rasterio.transform import from_bounds
from rasterio.warp import calculate_default_transform

import raster_align
from raster_align import (
    AVERAGE_DENSITY,
    AlignmentError,
    NEAREST_BINARY,
    NEAREST_CATEGORICAL,
    RasterAlignmentCache,
    SPECIES_POLICY,
    grid_sha256,
    layer_policy_registry,
    policy_for_layer,
)
from raster_metrics import RasterFingerprint


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _write_source(path: Path) -> None:
    values = np.zeros((80, 80), dtype=np.uint8)
    values[15:65, 20:60] = 1
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        width=80,
        height=80,
        count=1,
        dtype="uint8",
        crs="EPSG:4326",
        transform=from_bounds(-74.2, 3.8, -73.4, 4.6, 80, 80),
        nodata=255,
    ) as dataset:
        dataset.write(values, 1)


def _projected_target(source_path: Path) -> RasterFingerprint:
    with rasterio.open(source_path) as source:
        transform, width, height = calculate_default_transform(
            source.crs,
            "EPSG:9377",
            source.width,
            source.height,
            *source.bounds,
            resolution=1000,
        )
    return RasterFingerprint(
        width=width,
        height=height,
        transform=(
            transform.a,
            transform.b,
            transform.c,
            transform.d,
            transform.e,
            transform.f,
        ),
        crs="EPSG:9377",
    )


def test_mixed_crs_alignment_is_content_addressed_and_reused(tmp_path: Path):
    source = tmp_path / "source.tif"
    _write_source(source)
    target = _projected_target(source)
    cache = RasterAlignmentCache(tmp_path / "cache")

    first = cache.align(
        source,
        _sha256(source),
        target,
        NEAREST_CATEGORICAL,
    )
    second = cache.align(
        source,
        _sha256(source),
        target,
        NEAREST_CATEGORICAL,
    )

    assert first.cache_hit is False
    assert second.cache_hit is True
    assert second.path == first.path
    assert second.target_grid_sha256 == grid_sha256(target)
    assert second.manifest["qa"]["alignedAllowedValues"] == [0, 1]
    assert second.path.parts[-3] == "aligned"
    with rasterio.open(second.path) as aligned:
        assert aligned.crs.to_epsg() == 9377
        assert (aligned.width, aligned.height) == (target.width, target.height)


def test_cache_identity_isolated_between_land_and_marine_target_grids(
    tmp_path: Path,
):
    source = tmp_path / "source.tif"
    _write_source(source)
    land_target = _projected_target(source)
    marine_target = RasterFingerprint(
        width=land_target.width + 1,
        height=land_target.height,
        transform=land_target.transform,
        crs=land_target.crs,
    )
    cache = RasterAlignmentCache(tmp_path / "cache")

    land = cache.align(
        source,
        _sha256(source),
        land_target,
        NEAREST_CATEGORICAL,
    )
    marine = cache.align(
        source,
        _sha256(source),
        marine_target,
        NEAREST_CATEGORICAL,
    )

    assert land.cache_key != marine.cache_key
    assert land.path != marine.path
    assert land.target_grid_sha256 == grid_sha256(land_target)
    assert marine.target_grid_sha256 == grid_sha256(marine_target)


def test_categorical_alignment_preserves_actual_taxonomy(tmp_path: Path):
    source = tmp_path / "marine-classes.tif"
    values = np.arange(1, 13, dtype=np.uint8).reshape(3, 4)
    with rasterio.open(
        source,
        "w",
        driver="GTiff",
        width=4,
        height=3,
        count=1,
        dtype="uint8",
        crs="EPSG:4326",
        transform=from_bounds(-74, 3, -73, 4, 4, 3),
        nodata=255,
    ) as dataset:
        dataset.write(values, 1)
    target = _projected_target(source)

    result = RasterAlignmentCache(tmp_path / "cache").align(
        source,
        _sha256(source),
        target,
        NEAREST_CATEGORICAL,
    )

    assert set(result.manifest["qa"]["sourceAllowedValues"]) == set(range(1, 13))
    assert set(result.manifest["qa"]["alignedAllowedValues"]).issubset(
        set(range(1, 13))
    )
    assert result.manifest["qa"]["checks"] is None


def test_continuous_alignment_does_not_apply_binary_qa(tmp_path: Path):
    source = tmp_path / "biomass.tif"
    values = np.linspace(0.05, 12.5, 100, dtype=np.float32).reshape(10, 10)
    with rasterio.open(
        source,
        "w",
        driver="GTiff",
        width=10,
        height=10,
        count=1,
        dtype="float32",
        crs="EPSG:4326",
        transform=from_bounds(-74, 3, -73, 4, 10, 10),
        nodata=np.nan,
    ) as dataset:
        dataset.write(values, 1)

    result = RasterAlignmentCache(tmp_path / "cache").align(
        source,
        _sha256(source),
        _projected_target(source),
        AVERAGE_DENSITY,
    )

    assert result.manifest["qa"]["checks"] is None


def test_non_species_binary_policy_skips_species_area_qa(
    tmp_path: Path,
    monkeypatch,
):
    source = tmp_path / "binary-layer.tif"
    _write_source(source)
    monkeypatch.setattr(
        raster_align,
        "_binary_qa",
        lambda *_args, **_kwargs: pytest.fail("species QA must not run"),
    )

    result = RasterAlignmentCache(tmp_path / "cache").align(
        source,
        _sha256(source),
        _projected_target(source),
        NEAREST_BINARY,
    )

    assert result.manifest["qa"]["checks"] is None


def test_nearest_species_alignment_is_retired(tmp_path: Path):
    source = tmp_path / "species.tif"
    _write_source(source)

    with pytest.raises(AlignmentError, match="retired"):
        RasterAlignmentCache(tmp_path / "cache").align(
            source,
            _sha256(source),
            _projected_target(source),
            SPECIES_POLICY,
            authoritative_area_km2=10_000.0,
        )


def test_corrupt_aligned_cache_is_rebuilt(tmp_path: Path):
    source = tmp_path / "source.tif"
    _write_source(source)
    target = _projected_target(source)
    cache = RasterAlignmentCache(tmp_path / "cache")
    first = cache.align(source, _sha256(source), target, NEAREST_CATEGORICAL)
    first.path.write_bytes(b"corrupt")

    rebuilt = cache.align(source, _sha256(source), target, NEAREST_CATEGORICAL)

    assert rebuilt.cache_hit is False
    with rasterio.open(rebuilt.path) as aligned:
        assert aligned.crs.to_epsg() == 9377


def test_registry_covers_all_metric_layers_and_unknown_fails_closed():
    assert layer_policy_registry()
    with pytest.raises(AlignmentError, match="no explicit alignment classification"):
        policy_for_layer("future_unknown_layer")


def test_orphan_cache_member_is_never_accepted(tmp_path: Path):
    source = tmp_path / "source.tif"
    _write_source(source)
    target = _projected_target(source)
    cache = RasterAlignmentCache(tmp_path / "cache")
    first = cache.align(source, _sha256(source), target, NEAREST_CATEGORICAL)
    manifest_path = first.path.with_suffix(".json")
    manifest_path.unlink()

    rebuilt = RasterAlignmentCache(tmp_path / "cache").align(
        source,
        _sha256(source),
        target,
        NEAREST_CATEGORICAL,
    )

    assert rebuilt.cache_hit is False
    assert manifest_path.is_file()


def test_concurrent_alignment_publishes_one_coherent_pair(tmp_path: Path):
    source = tmp_path / "source.tif"
    _write_source(source)
    target = _projected_target(source)
    source_sha = _sha256(source)

    def align():
        return RasterAlignmentCache(tmp_path / "cache").align(
            source,
            source_sha,
            target,
            NEAREST_CATEGORICAL,
        )

    with ThreadPoolExecutor(max_workers=4) as executor:
        results = list(executor.map(lambda _: align(), range(4)))

    assert len({result.cache_key for result in results}) == 1
    assert len({result.aligned_sha256 for result in results}) == 1
    assert sum(not result.cache_hit for result in results) == 1
    assert results[0].path.with_suffix(".json").is_file()


def test_eviction_removes_only_complete_unpinned_pairs(tmp_path: Path):
    first_source = tmp_path / "first.tif"
    second_source = tmp_path / "second.tif"
    _write_source(first_source)
    _write_source(second_source)
    with rasterio.open(second_source, "r+") as dataset:
        values = dataset.read(1)
        values[0, 0] = 1
        dataset.write(values, 1)
    target = _projected_target(first_source)
    cache = RasterAlignmentCache(tmp_path / "cache", max_cache_gb=1e-9)
    first = cache.align(
        first_source,
        _sha256(first_source),
        target,
        NEAREST_CATEGORICAL,
        pin=False,
    )
    second = cache.align(
        second_source,
        _sha256(second_source),
        target,
        NEAREST_CATEGORICAL,
        pin=True,
    )

    assert not first.path.exists()
    assert second.path.is_file()
    assert second.path.with_suffix(".json").is_file()
