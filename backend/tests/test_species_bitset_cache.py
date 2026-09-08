from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from scripts.species_bitset_cache import (
    INDEX_FORMAT,
    ensure_species_bitset,
    kit_blob_pathnames,
)


@dataclass(frozen=True)
class FakeDownload:
    path: Path
    sha256: str
    bytes: int


def test_kit_blob_pathnames_are_stable() -> None:
    paths = kit_blob_pathnames("orinoquia")
    assert paths["data"] == "runtime-artifacts/species-bitsets/orinoquia/species.cells.bits"
    assert paths["metadata"] == (
        "runtime-artifacts/species-bitsets/orinoquia/species.cells.json"
    )


def test_ensure_skips_existing_local_bitset(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.delenv("DMT_SPECIES_BITSET_INDEX_URL", raising=False)
    data_path = tmp_path / "species.cells.bits"
    metadata_path = tmp_path / "species.cells.json"
    data_path.write_bytes(b"already-built")
    metadata_path.write_text("{}", encoding="utf-8")
    calls: list[str] = []

    def download(*_args, **_kwargs):
        calls.append("download")
        raise AssertionError("should not download")

    def build(*_args, **_kwargs):
        calls.append("build")
        raise AssertionError("should not rebuild")

    ensure_species_bitset(
        kit_id="national",
        matrix_paths={},
        data_path=data_path,
        metadata_path=metadata_path,
        force=False,
        download=download,
        build=build,
    )
    assert calls == []
    assert data_path.read_bytes() == b"already-built"


def test_ensure_rebuilds_when_missing_and_index_unset(
    tmp_path: Path, monkeypatch
) -> None:
    monkeypatch.delenv("DMT_SPECIES_BITSET_INDEX_URL", raising=False)
    data_path = tmp_path / "species.cells.bits"
    metadata_path = tmp_path / "species.cells.json"
    built: list[str] = []

    def build(_matrices, dest_data: Path, dest_meta: Path) -> None:
        dest_data.write_bytes(b"rebuilt")
        dest_meta.write_text("{}", encoding="utf-8")
        built.append("build")

    ensure_species_bitset(
        kit_id="national",
        matrix_paths={},
        data_path=data_path,
        metadata_path=metadata_path,
        force=False,
        download=lambda *_args, **_kwargs: None,
        build=build,
    )
    assert built == ["build"]
    assert data_path.read_bytes() == b"rebuilt"


def test_ensure_downloads_published_kit(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv(
        "DMT_SPECIES_BITSET_INDEX_URL",
        "https://example.test/runtime-artifacts/species-bitsets/index.json",
    )
    data_path = tmp_path / "species.cells.bits"
    metadata_path = tmp_path / "species.cells.json"
    data_bytes = b"published-bits"
    meta_bytes = b'{"format":"species-cell-bitset/v2"}'

    def fake_index(_url: str, *, timeout: float = 30):
        return {
            "format": INDEX_FORMAT,
            "kits": {
                "orinoquia": {
                    "data": {
                        "url": "https://example.test/orinoquia.bits",
                        "checksum": {"algorithm": "sha256", "value": "d" * 64},
                        "size_bytes": len(data_bytes),
                    },
                    "metadata": {
                        "url": "https://example.test/orinoquia.json",
                        "checksum": {"algorithm": "sha256", "value": "e" * 64},
                        "size_bytes": len(meta_bytes),
                    },
                }
            },
        }

    monkeypatch.setattr(
        "scripts.species_bitset_cache.load_bitset_index",
        fake_index,
    )

    def download(url: str, target: Path, *, force: bool) -> FakeDownload:
        payload = data_bytes if url.endswith(".bits") else meta_bytes
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(payload)
        return FakeDownload(
            target,
            "d" * 64 if url.endswith(".bits") else "e" * 64,
            len(payload),
        )

    built: list[str] = []
    ensure_species_bitset(
        kit_id="orinoquia",
        matrix_paths={},
        data_path=data_path,
        metadata_path=metadata_path,
        force=False,
        download=download,
        build=lambda *_args, **_kwargs: built.append("build"),
    )
    assert built == []
    assert data_path.read_bytes() == data_bytes
    assert metadata_path.read_bytes() == meta_bytes


def test_ensure_rebuilds_after_published_checksum_mismatch(
    tmp_path: Path, monkeypatch
) -> None:
    monkeypatch.setenv(
        "DMT_SPECIES_BITSET_INDEX_URL",
        "https://example.test/runtime-artifacts/species-bitsets/index.json",
    )
    data_path = tmp_path / "species.cells.bits"
    metadata_path = tmp_path / "species.cells.json"

    monkeypatch.setattr(
        "scripts.species_bitset_cache.load_bitset_index",
        lambda *_args, **_kwargs: {
            "format": INDEX_FORMAT,
            "kits": {
                "national": {
                    "data": {
                        "url": "https://example.test/national.bits",
                        "checksum": {"algorithm": "sha256", "value": "a" * 64},
                        "size_bytes": 4,
                    },
                    "metadata": {
                        "url": "https://example.test/national.json",
                        "checksum": {"algorithm": "sha256", "value": "b" * 64},
                        "size_bytes": 2,
                    },
                }
            },
        },
    )

    def download(url: str, target: Path, *, force: bool) -> FakeDownload:
        payload = b"nope" if url.endswith(".bits") else b"{}"
        target.write_bytes(payload)
        return FakeDownload(target, "c" * 64, len(payload))

    def build(_matrices, dest_data: Path, dest_meta: Path) -> None:
        dest_data.write_bytes(b"rebuilt")
        dest_meta.write_text("{}", encoding="utf-8")

    ensure_species_bitset(
        kit_id="national",
        matrix_paths={},
        data_path=data_path,
        metadata_path=metadata_path,
        force=True,
        download=download,
        build=build,
    )
    assert data_path.read_bytes() == b"rebuilt"
