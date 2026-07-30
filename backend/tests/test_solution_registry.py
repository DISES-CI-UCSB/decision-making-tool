from __future__ import annotations

import io
from pathlib import Path

import numpy as np
import pytest
import rasterio
from rasterio.transform import from_origin

from app.solution_registry import SolutionRegistryError, build_solution_registry
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
