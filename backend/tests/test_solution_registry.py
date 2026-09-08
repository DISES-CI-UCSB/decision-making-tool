from __future__ import annotations

import io
from pathlib import Path

import numpy as np
import pytest
import rasterio
from rasterio.transform import from_origin
from rasterio.warp import transform_bounds

from app.solution_registry import (
    SolutionRegistryError,
    _fingerprints_compatible,
    build_solution_registry,
)
from raster_metrics import RasterFingerprint


class _Response(io.BytesIO):
    def __enter__(self) -> _Response:
        return self

    def __exit__(self, *_args: object) -> None:
        self.close()


def test_solution_registry_downloads_validates_and_reuses_raster(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source = tmp_path / "source.tif"
    _write_solution(source)
    payload = source.read_bytes()
    download_count = 0

    def urlopen(*_args: object, **_kwargs: object) -> _Response:
        nonlocal download_count
        download_count += 1
        return _Response(payload)

    monkeypatch.setattr("urllib.request.urlopen", urlopen)
    registry = build_solution_registry(
        [
            {
                "solution_id": "solution-1",
                "source_url": "https://blob.example/solutions/solution-1.tif",
            }
        ],
        cache_dir=tmp_path / "cache",
        reference_fingerprint=_fingerprint(),
        public_blob_host="https://blob.example",
        release_id="release-1",
    )
    assert registry is not None

    first, first_checksum = registry.load("solution-1")
    second, second_checksum = registry.load("solution-1")

    assert first is second
    assert first_checksum == second_checksum
    assert download_count == 1
    assert first.pre_existing_mask.tolist() == [[True, False], [False, False]]
    assert first.new_prioritizr_mask.tolist() == [[False, True], [False, False]]


def test_solution_registry_uses_local_path_without_download(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source = tmp_path / "packaged-sample.tif"
    _write_solution(source)

    def urlopen(*_args: object, **_kwargs: object) -> _Response:
        raise AssertionError("local_path solutions must not download from blob")

    monkeypatch.setattr("urllib.request.urlopen", urlopen)
    registry = build_solution_registry(
        [
            {
                "solution_id": "eje-cafetero-001",
                "source_url": "https://blob.example/solutions/eje-cafetero-001.tif",
                "local_path": str(source),
            }
        ],
        cache_dir=tmp_path / "cache",
        reference_fingerprint=_fingerprint(),
        public_blob_host="https://blob.example",
        release_id="release-1",
    )
    assert registry is not None

    raster, checksum = registry.load("eje-cafetero-001")

    assert checksum
    assert raster.pre_existing_mask.tolist() == [[True, False], [False, False]]
    assert registry.metadata()["locally_bound_solution_ids"] == ["eje-cafetero-001"]


def test_solution_registry_aligns_mismatched_crs_to_reference(
    tmp_path: Path,
) -> None:
    reference = RasterFingerprint(
        width=4,
        height=3,
        transform=(0.05, 0.0, -74.2, 0.0, -0.05, 4.7),
        crs="EPSG:4326",
    )
    left, bottom, right, top = transform_bounds(
        "EPSG:4326",
        "EPSG:3857",
        -74.2,
        4.55,
        -74.0,
        4.7,
    )
    source = tmp_path / "projected-solution.tif"
    pixel_width = (right - left) / 2
    pixel_height = (top - bottom) / 2
    with rasterio.open(
        source,
        "w",
        driver="GTiff",
        width=2,
        height=2,
        count=1,
        dtype="uint8",
        crs="EPSG:3857",
        transform=from_origin(left, top, pixel_width, pixel_height),
        nodata=255,
    ) as dataset:
        dataset.write(np.array([[2, 1], [1, 2]], dtype=np.uint8), 1)

    registry = build_solution_registry(
        [
            {
                "solution_id": "projected-solution",
                "source_url": "https://blob.example/solutions/projected.tif",
                "local_path": str(source),
            }
        ],
        cache_dir=tmp_path / "cache",
        reference_fingerprint=reference,
        public_blob_host="https://blob.example",
        release_id="release-1",
    )
    assert registry is not None

    raster, checksum = registry.load("projected-solution")

    assert checksum
    assert _fingerprints_compatible(raster.fingerprint, reference)
    assert raster.fingerprint.matches(reference)
    assert raster.selected_cells > 0
    assert raster.selected_mask.shape == (reference.height, reference.width)


def test_solution_registry_rejects_untrusted_source() -> None:
    with pytest.raises(SolutionRegistryError, match="source_not_allowed"):
        build_solution_registry(
            [
                {
                    "solution_id": "solution-1",
                    "source_url": "https://untrusted.example/solution.tif",
                }
            ],
            cache_dir=Path("unused"),
            reference_fingerprint=_fingerprint(),
            public_blob_host="https://blob.example",
            release_id="release-1",
        )


def _write_solution(path: Path) -> None:
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        width=2,
        height=2,
        count=1,
        dtype="uint8",
        crs="EPSG:3857",
        transform=from_origin(0.0, 2000.0, 1000.0, 1000.0),
        nodata=255,
    ) as dataset:
        dataset.write(np.array([[2, 1], [0, 0]], dtype=np.uint8), 1)


def _fingerprint() -> RasterFingerprint:
    return RasterFingerprint(
        width=2,
        height=2,
        transform=(1000.0, 0.0, 0.0, 0.0, -1000.0, 2000.0),
        crs="EPSG:3857",
    )
