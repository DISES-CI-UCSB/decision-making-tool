"""Cache eviction skips files Windows keeps open instead of crashing the worker.

Windows behavior is simulated with monkeypatching so these run on any OS.
"""

from __future__ import annotations

import errno
import os
import time
from pathlib import Path
from types import SimpleNamespace

import pytest

import platform_io
from raster_align import RasterAlignmentCache
from species_overlap import SpeciesOverlapCache


@pytest.fixture
def simulate_windows_file_errors(monkeypatch) -> None:
    monkeypatch.setattr(platform_io, "_RETRY_FILE_IN_USE_ERRORS", True)
    monkeypatch.setattr(platform_io, "time", SimpleNamespace(sleep=lambda seconds: None))


def _block_unlink_of(monkeypatch, blocked: set[Path]) -> None:
    real_unlink = Path.unlink

    def unlink(self, missing_ok=False):
        if self in blocked:
            raise PermissionError(errno.EACCES, "file is open in another process")
        real_unlink(self, missing_ok=missing_ok)

    monkeypatch.setattr(Path, "unlink", unlink)


def _write_pair(directory: Path, key: str, suffix: str, age_seconds: float) -> tuple[Path, Path]:
    directory.mkdir(parents=True, exist_ok=True)
    artifact = directory / f"{key}{suffix}"
    manifest = directory / f"{key}.json"
    artifact.write_bytes(b"x" * 100)
    manifest.write_text("{}", encoding="utf-8")
    stamp = time.time() - age_seconds
    for path in (artifact, manifest):
        os.utime(path, (stamp, stamp))
    return artifact, manifest


def test_aligned_raster_eviction_skips_a_pair_held_open_and_evicts_the_next(
    tmp_path: Path, monkeypatch, simulate_windows_file_errors
):
    cache = RasterAlignmentCache(tmp_path, max_cache_gb=1e-9, lock_timeout_seconds=0.1)
    oldest_key, newer_key = "a" * 64, "b" * 64
    held_raster, held_manifest = _write_pair(
        cache.root / "aa", oldest_key, ".tif", age_seconds=200
    )
    free_raster, free_manifest = _write_pair(
        cache.root / "bb", newer_key, ".tif", age_seconds=100
    )
    _block_unlink_of(monkeypatch, {held_manifest})

    removed = cache.evict()

    assert removed == 1
    assert held_raster.is_file() and held_manifest.is_file()
    assert not free_raster.exists() and not free_manifest.exists()


def test_species_overlap_eviction_skips_an_artifact_held_open_and_evicts_the_next(
    tmp_path: Path, monkeypatch, simulate_windows_file_errors
):
    cache = SpeciesOverlapCache(tmp_path, max_cache_bytes=1, lock_timeout_seconds=0.1)
    oldest_key, newer_key = "c" * 64, "d" * 64
    held_artifact, held_manifest = _write_pair(
        cache.root / "cc", oldest_key, ".npz", age_seconds=200
    )
    free_artifact, free_manifest = _write_pair(
        cache.root / "dd", newer_key, ".npz", age_seconds=100
    )
    _block_unlink_of(monkeypatch, {held_artifact})

    removed = cache.evict()

    assert removed == 1
    assert held_artifact.is_file() and held_manifest.is_file()
    assert not free_artifact.exists() and not free_manifest.exists()


def test_species_overlap_stale_temp_cleanup_skips_a_temp_file_held_open(
    tmp_path: Path, monkeypatch, simulate_windows_file_errors
):
    root = tmp_path / "species-overlap"
    key = "e" * 64
    directory = root / key[:2]
    directory.mkdir(parents=True)
    held = directory / f".{key}.{'1' * 32}.tmp.npz"
    held.write_bytes(b"temporary")
    stale = time.time() - 120
    os.utime(held, (stale, stale))
    _block_unlink_of(monkeypatch, {held})

    cache = SpeciesOverlapCache(
        tmp_path, max_cache_bytes=1024, lock_timeout_seconds=0.1, stale_temp_age_seconds=60
    )

    assert held.is_file()
    assert cache.cleanup_stale_temporary_files() == 0


def test_species_overlap_stale_temp_cleanup_removes_temp_names_without_a_pid(
    tmp_path: Path,
):
    root = tmp_path / "species-overlap"
    key = "f" * 64
    directory = root / key[:2]
    directory.mkdir(parents=True)
    abandoned = directory / f".{key}.{'2' * 32}.tmp.json"
    fresh = directory / f".{key}.{'3' * 32}.tmp.npz"
    abandoned.write_bytes(b"temporary")
    fresh.write_bytes(b"temporary")
    stale = time.time() - 120
    os.utime(abandoned, (stale, stale))

    SpeciesOverlapCache(
        tmp_path, max_cache_bytes=1024, lock_timeout_seconds=0.1, stale_temp_age_seconds=60
    )

    assert not abandoned.exists()
    assert fresh.is_file()
