from pathlib import Path

import numpy as np
import pytest
from rasterio.transform import from_bounds

import main as pipeline
from blob_manifest import ResolvedManifest
from boundaries.boundary_loader import BOUNDARY_SOURCE_SPECS, BoundaryFeature, load_all_boundaries
from boundaries.boundary_mask import rasterize_boundary
from boundaries.boundary_topology import (
    BoundaryTopologyCache,
    aggregate_prepared_sparse_boundary_weighted_sums,
    build_boundary_topology_index,
    prepare_sparse_boundary_weighted_channels,
)
from metric_definitions import computable_metrics
from raster_metrics import RasterFingerprint, SolutionRaster


_PINNED_CACHE_DIR = (
    Path(__file__).resolve().parents[2]
    / "cache/releases/solutions-v0-2-0-20260805/mec-v2"
)
_PINNED_CACHE_AVAILABLE = all(
    (_PINNED_CACHE_DIR / "boundaries" / spec.cache_filename).is_file()
    for spec in BOUNDARY_SOURCE_SPECS.values()
)


def _feature(boundary_id: str) -> BoundaryFeature:
    return BoundaryFeature(
        boundary_id=boundary_id,
        name=boundary_id.title(),
        geo_level="siraps",
        geometry={},
        properties={},
    )


def _manifest() -> ResolvedManifest:
    return ResolvedManifest(
        url="https://example.test/manifest.json",
        raw={},
        public_blob_host="https://example.test",
        layers_by_id={
            "recarga_agua": {
                "rendering": {"valueType": "binary", "selectedValue": 1}
            },
            "ecosistemas_IAVH_2024": {},
        },
        national_solutions=[],
    )


def _synthetic_raster() -> SolutionRaster:
    fingerprint = RasterFingerprint(
        width=3,
        height=2,
        transform=(1.0, 0.0, 0.0, 0.0, -1.0, 2.0),
        crs="EPSG:32618",
    )
    new = np.array([[True, False, False], [False, True, False]])
    pre_existing = np.array([[False, True, False], [False, False, False]])
    selected = new | pre_existing
    valid = np.array([[True, True, False], [True, True, True]])
    return SolutionRaster(
        path=Path("/dev/null"),
        selected_mask=selected,
        valid_mask=valid,
        pixel_area_km2_per_row=np.array([1.0, 2.0]),
        fingerprint=fingerprint,
        selected_cells=int(selected.sum()),
        valid_cells=int(valid.sum()),
        new_prioritizr_mask=new,
        pre_existing_mask=pre_existing,
    )


def test_boundary_fanout_flag_defaults_legacy_and_rejects_unknown(monkeypatch):
    monkeypatch.delenv("METRICS_BOUNDARY_FANOUT", raising=False)
    assert pipeline._boundary_fanout_mode() == "legacy"

    monkeypatch.setenv("METRICS_BOUNDARY_FANOUT", "grouped")
    assert pipeline._boundary_fanout_mode() == "grouped"

    monkeypatch.setenv("METRICS_BOUNDARY_FANOUT", "surprise")
    with pytest.raises(ValueError, match="legacy.*grouped"):
        pipeline._boundary_fanout_mode()


def test_grouped_main_metrics_match_independent_overlapping_masks(monkeypatch, tmp_path):
    raster = _synthetic_raster()
    masks = {
        "first": np.array([[True, True, False], [True, False, False]]),
        "second": np.array([[False, True, True], [False, True, False]]),
        "empty": np.zeros((2, 3), dtype=bool),
    }
    features = [_feature(boundary_id) for boundary_id in masks]
    index = build_boundary_topology_index(
        "siraps",
        features,
        raster.fingerprint,
        mode="overlap",
        mask_provider=lambda feature: masks[feature.boundary_id],
    )
    definitions_by_id = {definition.metric_id: definition for definition in computable_metrics()}
    definitions = tuple(
        definitions_by_id[metric_id]
        for metric_id in (
            "national_contribution",
            "priority_area_in_region",
            "priority_area_pct_of_region",
            "water_regulation_area",
            "ecosystem_coverage",
        )
    )
    monkeypatch.setattr(pipeline, "computable_metrics", lambda: definitions)
    layer_masks = {
        "recarga_agua": np.array(
            [[True, False, False], [True, True, False]],
            dtype=bool,
        )
    }
    layer_values = {
        "ecosistemas_IAVH_2024": np.array(
            [[1.0, 430.0, np.nan], [431.0, 2.0, 0.0]]
        )
    }
    grouped = pipeline._build_grouped_boundary_primitives(
        raster,
        {"siraps": index},
        definitions,
        layer_masks,
        layer_values,
    )["siraps"]
    solution = {"id": "synthetic", "domain": "land"}

    for boundary_index, feature in enumerate(features):
        scalar_raster = raster.with_boundary_mask(masks[feature.boundary_id])
        scalar = pipeline._build_metrics(
            scalar_raster,
            solution,
            _manifest(),
            pipeline._LayerMaskCache(),
            pipeline._LayerValueCache(),
            tmp_path,
            False,
            subnational=True,
            preloaded_layer_masks=layer_masks,
            preloaded_layer_values=layer_values,
        )
        overrides = pipeline._grouped_metric_overrides(
            definitions,
            grouped,
            boundary_index,
            _manifest(),
        )
        actual = pipeline._build_metrics(
            raster,
            solution,
            _manifest(),
            pipeline._LayerMaskCache(),
            pipeline._LayerValueCache(),
            tmp_path,
            False,
            subnational=True,
            preloaded_layer_masks=layer_masks,
            preloaded_layer_values=layer_values,
            grouped_metric_overrides=overrides,
            scope_valid_cells=int(grouped.valid_cells[boundary_index]),
        )

        assert [metric["metricId"] for metric in actual] == [
            metric["metricId"] for metric in scalar
        ]
        for observed, expected in zip(actual, scalar, strict=True):
            assert observed.keys() == expected.keys()
            for key in observed:
                if key == "value" and isinstance(observed[key], float):
                    assert observed[key] == pytest.approx(expected[key], rel=1e-13, abs=1e-13)
                else:
                    assert observed[key] == expected[key]


@pytest.mark.skipif(
    not _PINNED_CACHE_AVAILABLE,
    reason="Optional cache-only parity requires pinned boundary snapshots.",
)
def test_real_cache_grouped_scope_primitives_match_scalar_masks():
    transform = from_bounds(-82.0, -5.0, -66.0, 14.0, 48, 57)
    fingerprint = RasterFingerprint(
        width=48,
        height=57,
        transform=tuple(transform)[:6],
        crs="EPSG:4326",
    )
    rng = np.random.default_rng(20260819)
    valid = rng.random((57, 48)) > 0.08
    selected = valid & (rng.random((57, 48)) < 0.3)
    raster = SolutionRaster(
        path=Path("/dev/null"),
        selected_mask=selected,
        valid_mask=valid,
        pixel_area_km2_per_row=np.linspace(0.8, 1.2, 57),
        fingerprint=fingerprint,
        selected_cells=int(selected.sum()),
        valid_cells=int(valid.sum()),
    )
    boundaries, errors = load_all_boundaries(_PINNED_CACHE_DIR)
    assert errors == {}
    indexes, cache_hit = BoundaryTopologyCache().get(boundaries, fingerprint)
    assert cache_hit is False
    species_pixels = np.sort(
        rng.choice(fingerprint.width * fingerprint.height, size=1500, replace=False)
    )
    species_areas_m2 = rng.uniform(0.01, 1_000_000.0, species_pixels.size).astype(
        np.float64
    )
    species_areas_m2[::337] = np.nan
    species_channels = {
        "selected": rng.random(species_pixels.size) < 0.55,
        "pre_existing": rng.random(species_pixels.size) < 0.3,
        "new_prioritizr": rng.random(species_pixels.size) < 0.25,
    }
    prepared_species = prepare_sparse_boundary_weighted_channels(
        species_pixels,
        species_areas_m2,
        **species_channels,
        num_pixels=fingerprint.width * fingerprint.height,
    )
    species_by_level = {
        level: aggregate_prepared_sparse_boundary_weighted_sums(index, prepared_species)
        for level, index in indexes.items()
    }
    grouped = pipeline._build_grouped_boundary_primitives(
        raster,
        indexes,
        (),
        {},
        {},
    )

    for level, features in boundaries.items():
        primitives = grouped[level]
        species = species_by_level[level]
        for boundary_index, feature in enumerate(features):
            mask = rasterize_boundary(
                feature.geometry,
                fingerprint,
                source_crs=feature.source_crs,
            )
            scalar = raster.with_boundary_mask(mask)
            assert primitives.boundary_grid_cells[boundary_index] == int(mask.sum())
            assert primitives.valid_cells[boundary_index] == scalar.valid_cells
            assert primitives.selected_cells[boundary_index] == scalar.selected_cells
            assert primitives.valid_area_km2[boundary_index] == pytest.approx(
                scalar.valid_area_km2,
                rel=1e-13,
                abs=1e-13,
            )
            assert primitives.selected_area_km2[boundary_index] == pytest.approx(
                scalar.selected_area_km2,
                rel=1e-13,
                abs=1e-13,
            )
            owner_at_species = mask.ravel()[species_pixels]
            finite = np.isfinite(species_areas_m2)
            for channel_name, selector in {
                "total": np.ones(species_pixels.size, dtype=bool),
                **species_channels,
            }.items():
                expected = float(
                    species_areas_m2[
                        owner_at_species & finite & selector
                    ].sum(dtype=np.float64)
                )
                assert getattr(species, channel_name)[boundary_index] == pytest.approx(
                    expected,
                    rel=1e-13,
                    abs=1e-6,
                )
