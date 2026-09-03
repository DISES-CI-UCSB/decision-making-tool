"""Phase 1 tests for the regional SIRAP custom-AOI artifact builder."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pytest
import rasterio
from affine import Affine

from scripts import build_sirap_runtime_artifact as builder
from scripts.aligned_cache import sha256_file
from scripts.build_runtime_artifact import DownloadedSource

PUBLIC_BLOB_HOST = builder.PUBLIC_BLOB_HOST
RELEASE_ID = "sirap-test-release"
SIRAP_ID = "eje-cafetero"
GRID = Affine(300.0, 0.0, 1000.0, 0.0, -300.0, 2000.0)


def write_raster(path: Path, data: np.ndarray, *, crs: str, transform: Affine) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        width=data.shape[1],
        height=data.shape[0],
        count=1,
        dtype=data.dtype,
        crs=crs,
        transform=transform,
        nodata=255,
    ) as dataset:
        dataset.write(data, 1)
    return path


def fake_release_manifest() -> dict:
    solutions = [
        {
            "id": f"{SIRAP_ID}-{index:03d}",
            "name": f"Fixture solution {index}",
            "scope": "sirap",
            "sirapId": SIRAP_ID,
            "displayUrl": f"{PUBLIC_BLOB_HOST}/solutions/{SIRAP_ID}-{index:03d}.tif",
            "blobPath": f"releases/{RELEASE_ID}/solutions/{SIRAP_ID}-{index:03d}.tif",
            "rasterSha256": "a" * 64,
            "precomputedMetricUrls": {
                "mecNationalDenominator": (
                    f"{PUBLIC_BLOB_HOST}/releases/{RELEASE_ID}/mec/v2/national-denominator.mec.json"
                ),
            },
        }
        for index in range(1, 41)
    ]
    solutions.extend(
        {
            "id": f"sirap-orinoquia-fixture-{index:02d}",
            "name": f"Orinoquia fixture {index}",
            "scope": "sirap",
            "sirapId": "orinoquia",
            "displayUrl": f"{PUBLIC_BLOB_HOST}/solutions/orinoquia-{index:02d}.tif",
            "blobPath": f"releases/{RELEASE_ID}/solutions/orinoquia-{index:02d}.tif",
            "rasterSha256": "b" * 64,
        }
        for index in range(1, 17)
    )
    return {
        "format": "sirap-runtime-manifest-v1",
        "releaseId": RELEASE_ID,
        "publicBlobHost": PUBLIC_BLOB_HOST,
        "solutions": solutions,
    }


def fake_packet_manifest(*, ecosystem_sha256: str) -> dict:
    return {
        "format": "sirap-approved-packet-manifest-v2",
        "solutions": [
            {
                "id": f"{SIRAP_ID}-{index:03d}",
                "sirapId": SIRAP_ID,
                "regionalInputPacket": _packet_for(SIRAP_ID, ecosystem_sha256=ecosystem_sha256),
            }
            for index in range(1, 41)
        ]
        + [
            {
                "id": f"sirap-orinoquia-fixture-{index:02d}",
                "sirapId": "orinoquia",
                "regionalInputPacket": _packet_for("orinoquia", ecosystem_sha256=ecosystem_sha256),
            }
            for index in range(1, 17)
        ],
    }


def _packet_for(sirap_id: str, *, ecosystem_sha256: str) -> dict:
    return {
        "format": "sirap-metric-input-packet-v2",
        "regionId": sirap_id,
        "grid": {"sha256": "c" * 64},
        "authoritativeSummary": {
            "url": f"file://packet/{sirap_id}/summary.csv",
            "sha256": "d" * 64,
            "schema": "prioritizr-summary-v1",
        },
        "layers": {
            builder.ECOSYSTEM_LAYER_ID: {
                "url": f"{PUBLIC_BLOB_HOST}/inputs/features/ecosystems/{sirap_id}_mec.tif",
                "sha256": ecosystem_sha256,
                "rendering": {"valueType": "categorical"},
            }
        },
        "species": {
            "universePolicy": "regional-matrices-national-metadata",
            "matrices": [
                {
                    "taxonomicClass": "Magnoliopsida",
                    "format": "smsp-v1",
                    "url": f"{PUBLIC_BLOB_HOST}/inputs/features/species/{sirap_id}_plants.smsp.gz",
                    "sha256": "f" * 64,
                    "gridSha256": "c" * 64,
                }
            ],
        },
    }


def publish_fixture_sources(tmp_path: Path) -> dict[str, Path]:
    solution = write_raster(
        tmp_path / "published" / f"{SIRAP_ID}-001.tif",
        np.array([[1, 0, 2], [0, 1, 255]], dtype=np.uint8),
        crs="EPSG:9377",
        transform=GRID,
    )
    ecosystem = write_raster(
        tmp_path / "published" / f"{SIRAP_ID}_mec.tif",
        np.array([[10, 11, 12], [13, 14, 15]], dtype=np.uint16),
        crs="EPSG:9377",
        transform=GRID,
    )
    crosswalk = tmp_path / "published" / "crosswalk.csv"
    crosswalk.write_text(
        "rasterValue,tipoEcosistema,biomeFamily,broadBiomeContext,"
        "biomeRegion,broadEcosystem,detailedEcosystem\n"
        "10,Bosque,Orobioma,Contexto bosque,Orobioma Región,Forest,Forest detail\n",
        encoding="utf-8",
    )
    provenance = tmp_path / "published" / "provenance.json"
    provenance.write_text(
        json.dumps(
            {
                "format": "mec-2024-provenance-v1",
                "generatedAt": "2026-09-02T00:00:00Z",
                "source": {"publisher": "IDEAM"},
                "catalog": {
                    "rowCount": 1,
                    "crosswalkSha256": sha256_file(crosswalk),
                    "crosswalkSignature": "fixture",
                    "tupleFields": [
                        "tipo_ecos",
                        "gran_bioma",
                        "bioma_iavh",
                        "ecos_sintesis",
                        "ecos_general",
                    ],
                },
                "outputs": {
                    "compositeRaster": {"sha256": sha256_file(ecosystem)},
                    "crosswalk": {"sha256": sha256_file(crosswalk)},
                },
                "rasterization": {"dtype": "uint16", "nodata": 0},
                "grid": {"fingerprintSha256": "fixture"},
            }
        ),
        encoding="utf-8",
    )
    catalog = tmp_path / "published" / "catalog.csv"
    catalog.write_text("biome,biome_id\nForest,10\n", encoding="utf-8")
    summary = tmp_path / "published" / "summary.csv"
    summary.write_text(
        "\n".join(
            [
                (
                    "feature,met,total_amount,absolute_target,absolute_held,"
                    "absolute_shortfall,relative_target,relative_held,"
                    "relative_shortfall,scenario,evaluated,total_amount_km2,"
                    "absolute_held_km2,feature_type,class"
                ),
                (
                    f"Forest,TRUE,100,30,30,0,0.3,0.3,0,Fixture solution 1,"
                    "prioritizr_model,9,2.7,ecosystem,NA"
                ),
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    denominator = tmp_path / "published" / "national-denominator.mec.json"
    denominator.write_text(
        json.dumps(
            {
                "format": "mec-national-denominator-v1",
                "releaseId": RELEASE_ID,
            }
        ),
        encoding="utf-8",
    )
    published = {
        f"{PUBLIC_BLOB_HOST}/solutions/{SIRAP_ID}-001.tif": solution,
        f"{PUBLIC_BLOB_HOST}/inputs/features/ecosystems/{SIRAP_ID}_mec.tif": ecosystem,
        builder.published_source_summary_url(
            builder.SirapReleaseManifest(
                url="https://example.invalid/manifest.json",
                release_id=RELEASE_ID,
                public_blob_host=PUBLIC_BLOB_HOST,
                solutions=[],
            ),
            f"{SIRAP_ID}-001",
        ): summary,
        f"{PUBLIC_BLOB_HOST}/releases/{RELEASE_ID}/mec/v2/national-denominator.mec.json": denominator,
        builder.MESA_ECOSYSTEM_CATALOG_URL: catalog,
    }
    for index in range(1, 41):
        solution_id = f"{SIRAP_ID}-{index:03d}"
        published[
            builder.published_source_summary_url(
                builder.SirapReleaseManifest(
                    url="https://example.invalid/manifest.json",
                    release_id=RELEASE_ID,
                    public_blob_host=PUBLIC_BLOB_HOST,
                    solutions=[],
                ),
                solution_id,
            )
        ] = summary
    from scripts.build_runtime_artifact import ECOSYSTEM_SOURCE_URLS_BY_GRID

    for url in ECOSYSTEM_SOURCE_URLS_BY_GRID["land-solution"].values():
        if url.endswith(".csv"):
            published[url] = crosswalk
        elif url.endswith(".json"):
            published[url] = provenance
    return published


def build_fixture_artifact(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> Path:
    published = publish_fixture_sources(tmp_path)
    release_path = tmp_path / "release-manifest.json"
    packet_path = tmp_path / "packet-manifest.json"
    release_path.write_text(json.dumps(fake_release_manifest()), encoding="utf-8")
    ecosystem_path = published[f"{PUBLIC_BLOB_HOST}/inputs/features/ecosystems/{SIRAP_ID}_mec.tif"]
    packet_path.write_text(
        json.dumps(fake_packet_manifest(ecosystem_sha256=sha256_file(ecosystem_path))),
        encoding="utf-8",
    )

    def fake_download(url: str, target: Path, *, force: bool) -> DownloadedSource:
        source = published.get(url)
        if source is None:
            raise AssertionError(f"Unexpected download URL: {url}")
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(source.read_bytes())
        return DownloadedSource(target, sha256_file(target), target.stat().st_size)

    artifact_root = tmp_path / "runtime-artifacts"
    monkeypatch.setattr(builder, "download_source", fake_download)
    monkeypatch.setattr(
        builder,
        "parse_args",
        lambda: argparse.Namespace(
            sirap_id=SIRAP_ID,
            release_id=RELEASE_ID,
            artifact_dir=artifact_root,
            manifest_url=release_path.as_uri(),
            packet_manifest_url=packet_path.as_uri(),
            force=False,
        ),
    )
    builder.main()
    return artifact_root / SIRAP_ID


def test_filter_solutions_returns_only_requested_sirap() -> None:
    solutions = fake_release_manifest()["solutions"]
    regional = builder.filter_solutions(solutions, SIRAP_ID)
    assert len(regional) == 40
    assert all(item["sirapId"] == SIRAP_ID for item in regional)


def test_builds_regional_manifest_with_expected_shape(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    artifact_dir = build_fixture_artifact(tmp_path, monkeypatch)
    manifest = json.loads((artifact_dir / "manifest.json").read_text(encoding="utf-8"))

    assert manifest["artifact_kind"] == builder.ARTIFACT_KIND
    assert manifest["sirap_id"] == SIRAP_ID
    assert manifest["release_id"] == RELEASE_ID
    assert len(manifest["solution_rasters"]) == 40
    assert manifest["reference_grid"]["width"] == 3
    assert manifest["reference_grid"]["height"] == 2
    assert manifest["reference_grid"]["crs"] == "EPSG:9377"
    assert manifest["valid_data"]["valid_cell_count"] == 5
    assert manifest["raster_layers"][0]["layer_id"] == builder.ECOSYSTEM_LAYER_ID
    assert manifest["authoritative_summary"]["format"] == builder.SOURCE_SUMMARY_FORMAT
    assert manifest["ecosystem_inventory"]["raster"]["checksum"]["value"]
    assert manifest["sirap_coverage"]["format"] == builder.SIRAP_RUNTIME_COVERAGE_FORMAT
    assert manifest["sirap_coverage"]["solution_targets"]["eje-cafetero-001"]["target_count"] == 1
    assert manifest["mec_national_denominator"]["source_url"].endswith(
        "national-denominator.mec.json"
    )
    assert manifest["species_matrices"]["status"] == "stubbed"
    assert len(manifest["species_matrices"]["declared_bindings"]) == 1
    assert manifest["checksum"]["algorithm"] == "sha256"
    assert len(manifest["files"]) >= 8


def test_rejects_solution_count_mismatch(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    release_path = tmp_path / "release-manifest.json"
    packet_path = tmp_path / "packet-manifest.json"
    release = fake_release_manifest()
    release["solutions"] = release["solutions"][:39]
    published = publish_fixture_sources(tmp_path)
    release_path.write_text(json.dumps(release), encoding="utf-8")
    ecosystem_path = published[f"{PUBLIC_BLOB_HOST}/inputs/features/ecosystems/{SIRAP_ID}_mec.tif"]
    packet_path.write_text(
        json.dumps(fake_packet_manifest(ecosystem_sha256=sha256_file(ecosystem_path))),
        encoding="utf-8",
    )

    monkeypatch.setattr(
        builder,
        "parse_args",
        lambda: argparse.Namespace(
            sirap_id=SIRAP_ID,
            release_id=RELEASE_ID,
            artifact_dir=tmp_path / "runtime-artifacts",
            manifest_url=release_path.as_uri(),
            packet_manifest_url=packet_path.as_uri(),
            force=False,
        ),
    )

    with pytest.raises(SystemExit, match="expected 40"):
        builder.main()


def test_rejects_ecosystem_checksum_mismatch(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    release_path = tmp_path / "release-manifest.json"
    packet_path = tmp_path / "packet-manifest.json"
    published = publish_fixture_sources(tmp_path)
    release_path.write_text(json.dumps(fake_release_manifest()), encoding="utf-8")
    ecosystem_path = published[f"{PUBLIC_BLOB_HOST}/inputs/features/ecosystems/{SIRAP_ID}_mec.tif"]
    packet = fake_packet_manifest(ecosystem_sha256=sha256_file(ecosystem_path))
    packet["solutions"][0]["regionalInputPacket"]["layers"][builder.ECOSYSTEM_LAYER_ID][
        "sha256"
    ] = "0" * 64
    packet_path.write_text(json.dumps(packet), encoding="utf-8")

    def fake_download(url: str, target: Path, *, force: bool) -> DownloadedSource:
        source = published[url]
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(source.read_bytes())
        return DownloadedSource(target, sha256_file(target), target.stat().st_size)

    monkeypatch.setattr(builder, "download_source", fake_download)
    monkeypatch.setattr(
        builder,
        "parse_args",
        lambda: argparse.Namespace(
            sirap_id=SIRAP_ID,
            release_id=RELEASE_ID,
            artifact_dir=tmp_path / "runtime-artifacts",
            manifest_url=release_path.as_uri(),
            packet_manifest_url=packet_path.as_uri(),
            force=False,
        ),
    )

    with pytest.raises(SystemExit, match="checksum does not match"):
        builder.main()
