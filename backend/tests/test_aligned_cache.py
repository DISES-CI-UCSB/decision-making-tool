from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pytest
import rasterio
from affine import Affine

from scripts.aligned_cache import (
    ALIGNMENT_MANIFEST_FORMAT,
    RESAMPLING_BY_LAYER_CLASS,
    AlignedCacheError,
    AlignedRasterCache,
    grid_descriptor,
    sha256_file,
)
from scripts.build_runtime_artifact import (
    ALIGNMENT_CLASS_BY_LAYER_ID,
    build_layer_specs,
    parse_args,
)
from raster_metrics import RasterFingerprint  # noqa: E402  (needs the pipeline path above)


TARGET = RasterFingerprint(
    width=2,
    height=2,
    transform=(1000.0, 0.0, 4331309.911856957, 0.0, -1000.0, 2933186.9308051495),
    crs="EPSG:9377",
)
BIOMASS_URL = "https://blob.example/inputs/features/biomass/biomasa.tif"


def write_entry(
    cache_dir: Path,
    cache_key: str,
    *,
    source_url: str,
    layer_class: str,
    target: RasterFingerprint = TARGET,
    manifest_format: str = ALIGNMENT_MANIFEST_FORMAT,
) -> Path:
    directory = cache_dir / "aligned" / cache_key[:2]
    directory.mkdir(parents=True, exist_ok=True)
    raster_path = directory / f"{cache_key}.tif"
    with rasterio.open(
        raster_path,
        "w",
        driver="GTiff",
        width=target.width,
        height=target.height,
        count=1,
        dtype="float32",
        crs=target.crs,
        transform=Affine(*target.transform),
        nodata=float("nan"),
    ) as dataset:
        dataset.write(np.ones((target.height, target.width), dtype=np.float32), 1)

    sidecar = {
        "format": manifest_format,
        "cacheKey": cache_key,
        "sourceUrl": source_url,
        "sourceSha256": "a" * 64,
        "alignedSha256": sha256_file(raster_path),
        "targetGrid": grid_descriptor(target),
        "policy": {
            "layer_class": layer_class,
            "resampling": RESAMPLING_BY_LAYER_CLASS[layer_class],
            "dtype_policy": "float32",
            "nodata_policy": "nan",
        },
    }
    (directory / f"{cache_key}.json").write_text(json.dumps(sidecar), encoding="utf-8")
    return raster_path


def test_lookup_resolves_entry_by_source_grid_and_policy(tmp_path: Path) -> None:
    raster_path = write_entry(
        tmp_path,
        "9f25b261",
        source_url=BIOMASS_URL,
        layer_class="fraction_or_density",
    )

    aligned = AlignedRasterCache(tmp_path).lookup(
        "biomasa",
        source_url=BIOMASS_URL,
        layer_class="fraction_or_density",
        target=TARGET,
    )

    assert aligned.path == raster_path
    assert aligned.resampling == "average"
    assert aligned.cache_key == "9f25b261"


def test_lookup_refuses_nearest_entry_for_a_density_layer(tmp_path: Path) -> None:
    write_entry(tmp_path, "c0be1234", source_url=BIOMASS_URL, layer_class="categorical")
    cache = AlignedRasterCache(tmp_path)

    with pytest.raises(AlignedCacheError, match="No aligned raster for layer 'biomasa'"):
        cache.lookup(
            "biomasa",
            source_url=BIOMASS_URL,
            layer_class="fraction_or_density",
            target=TARGET,
        )


def test_lookup_refuses_a_different_target_grid(tmp_path: Path) -> None:
    write_entry(
        tmp_path,
        "9f25b261",
        source_url=BIOMASS_URL,
        layer_class="fraction_or_density",
    )
    cache = AlignedRasterCache(tmp_path)
    wgs84_target = RasterFingerprint(
        width=2,
        height=2,
        transform=(0.00833333333333333, 0.0, -79.18333333333334, 0.0, -0.00833333333333333, 12.65),
        crs="EPSG:4326",
    )

    with pytest.raises(AlignedCacheError, match="No aligned raster"):
        cache.lookup(
            "biomasa",
            source_url=BIOMASS_URL,
            layer_class="fraction_or_density",
            target=wgs84_target,
        )


def test_lookup_refuses_a_raster_that_drifted_from_its_sidecar(tmp_path: Path) -> None:
    raster_path = write_entry(
        tmp_path,
        "9f25b261",
        source_url=BIOMASS_URL,
        layer_class="fraction_or_density",
    )
    cache = AlignedRasterCache(tmp_path)
    raster_path.write_bytes(raster_path.read_bytes() + b"drift")

    with pytest.raises(AlignedCacheError, match="recorded checksum"):
        cache.lookup(
            "biomasa",
            source_url=BIOMASS_URL,
            layer_class="fraction_or_density",
            target=TARGET,
        )


def test_legacy_v1_entries_are_ignored(tmp_path: Path) -> None:
    write_entry(
        tmp_path,
        "0011aabb",
        source_url=BIOMASS_URL,
        layer_class="fraction_or_density",
        manifest_format="metrics-raster-alignment-v1",
    )

    with pytest.raises(AlignedCacheError, match=ALIGNMENT_MANIFEST_FORMAT):
        AlignedRasterCache(tmp_path)


def test_every_layer_spec_declares_an_alignment_class() -> None:
    specs = build_layer_specs(
        {
            layer_id: {"displayUrl": f"https://blob.example/{layer_id}.tif", "rendering": {}}
            for layer_id in ("paramos", "bosque_seco", "wetlands", "mangroves", "resguardos", "comunidades")
        }
    )

    assert {spec.layer_id for spec in specs} == set(ALIGNMENT_CLASS_BY_LAYER_ID)
    for spec in specs:
        assert spec.alignment_class == ALIGNMENT_CLASS_BY_LAYER_ID[spec.layer_id]
        assert spec.alignment_class in RESAMPLING_BY_LAYER_CLASS


def test_density_layers_are_the_only_ones_resampled_by_average() -> None:
    averaged = {
        layer_id
        for layer_id, layer_class in ALIGNMENT_CLASS_BY_LAYER_ID.items()
        if RESAMPLING_BY_LAYER_CLASS[layer_class] == "average"
    }

    assert averaged == {"biomasa", "carbono_organico"}


def test_ecosystem_layer_is_the_authoritative_iavh_raster() -> None:
    specs = build_layer_specs({})
    ecosystem = next(spec for spec in specs if spec.layer_id == "ecosistemas_IAVH_2024")

    assert ecosystem.url.endswith("/inputs/features/ecosystems/ecosistemas_IAVH_2024.tif")
    assert ecosystem.metric_ids == ("ecosystem_coverage",)
    assert not any(spec.layer_id == "ecosistemas" for spec in specs)


@pytest.mark.parametrize(
    "argv",
    [
        ["build", "--reference-grid", "land-solution"],
        ["build", "--reference-grid", "land-solution", "--reference-raster", "solution.tif"],
        ["build", "--reference-grid", "land-solution", "--aligned-cache", "cache"],
        ["build", "--reference-raster", "solution.tif"],
    ],
)
def test_land_solution_build_requires_a_reference_raster_and_aligned_cache(
    argv: list[str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(sys, "argv", argv)

    with pytest.raises(SystemExit):
        parse_args()


def test_default_build_still_targets_the_ecosistemas_grid(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(sys, "argv", ["build"])

    args = parse_args()

    assert args.reference_grid == "ecosistemas"
    assert args.reference_raster is None
    assert args.aligned_cache is None
