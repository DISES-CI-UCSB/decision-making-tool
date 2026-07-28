from pathlib import Path

import numpy as np

import main as pipeline
from blob_manifest import ResolvedManifest, _validate_and_index
from helpers import raster_from_fixture
from metric_definitions import computable_metrics


def _manifest(solution: dict) -> ResolvedManifest:
    return _validate_and_index(
        "https://example.test/manifest.json",
        {
            "publicBlobHost": "https://example.test",
            "layers": [
                {
                    "id": "dummy",
                    "displayUrl": "https://example.test/dummy.tif",
                }
            ],
            "solutions": [solution],
        },
    )


def _ecosystem_definition():
    return next(
        metric for metric in computable_metrics()
        if metric.metric_id == "ecosystem_coverage"
    )


def test_generic_aoi_dispatch_reuses_authoritative_categorical_values(
    tmp_path: Path,
    monkeypatch,
):
    solution = {
        "id": "land",
        "scope": "nacional",
        "domain": "land",
        "displayUrl": "https://example.test/land.tif",
        "blobPath": "solutions/land.tif",
    }
    raster = raster_from_fixture({
        "shape": [2, 2],
        "pixel_area_km2": 1,
        "selected": [[True, False], [True, True]],
        "valid": [[True, True], [True, True]],
    })
    values = np.array([[1, 0], [430, 431]], dtype=np.float64)
    definition = _ecosystem_definition()
    monkeypatch.setattr(pipeline, "computable_metrics", lambda: (definition,))

    national = pipeline._build_metrics(
        raster,
        solution,
        _manifest(solution),
        pipeline._LayerMaskCache(),
        pipeline._LayerValueCache(),
        tmp_path,
        False,
        preloaded_layer_values={definition.layer_id: values},
    )
    aoi = pipeline._build_metrics(
        raster.with_boundary_mask(np.array([[True, True], [False, False]])),
        solution,
        _manifest(solution),
        pipeline._LayerMaskCache(),
        pipeline._LayerValueCache(),
        tmp_path,
        False,
        subnational=True,
        preloaded_layer_values={definition.layer_id: values},
    )

    assert national[0]["metricId"] == "ecosystem_coverage"
    assert national[0]["value"] == 2.0
    assert aoi[0]["value"] == 1.0


def test_marine_domain_gate_never_loads_authoritative_land_raster(
    tmp_path: Path,
    monkeypatch,
):
    solution = {
        "id": "marine",
        "scope": "marine",
        "domain": "marine",
        "displayUrl": "https://example.test/marine.tif",
        "blobPath": "solutions/marine.tif",
    }
    raster = raster_from_fixture({
        "shape": [1, 1],
        "pixel_area_km2": 1,
        "selected": [[True]],
        "valid": [[True]],
    })
    definition = _ecosystem_definition()
    monkeypatch.setattr(pipeline, "computable_metrics", lambda: (definition,))

    class NoLandValues:
        def get(self, *args, **kwargs):
            raise AssertionError("marine dispatch loaded the IAvH land raster")

    metrics = pipeline._build_metrics(
        raster,
        solution,
        _manifest(solution),
        pipeline._LayerMaskCache(),
        NoLandValues(),
        tmp_path,
        False,
    )

    assert metrics[0]["metricId"] == "ecosystem_coverage"
    assert metrics[0]["status"] == "not_applicable"
    assert metrics[0]["source"] == "n/a"
