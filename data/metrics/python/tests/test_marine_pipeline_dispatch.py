from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

import main as pipeline
import numpy as np
import pytest
from blob_manifest import (
    ManifestError,
    ResolvedManifest,
    _validate_and_index,
    fetch_manifest,
)
from helpers import raster_from_fixture
from solution_domain import solution_domain


def _solution(solution_id: str, scope: str, *, domain: str | None = None) -> dict:
    solution = {
        "id": solution_id,
        "scope": scope,
        "displayUrl": f"https://example.test/{solution_id}.tif",
        "blobPath": f"solutions/{solution_id}.tif",
        "summaryMetrics": {"pctTargetsMet": 100},
    }
    if domain is not None:
        solution["domain"] = domain
    return solution


def _manifest(solutions: list[dict]) -> ResolvedManifest:
    payload = {
        "publicBlobHost": "https://example.test",
        "layers": [{"id": "dummy", "displayUrl": "https://example.test/dummy.tif"}],
        "solutions": solutions,
    }
    return _validate_and_index("https://example.test/manifest.json", payload)


def _raster():
    return raster_from_fixture(
        {
        "shape": [2, 2],
        "pixel_area_km2": 1,
        "selected": [[True, False], [True, True]],
        "valid": [[True, True], [True, True]],
        }
    )


def test_manifest_batch_includes_land_and_marine_but_excludes_other_scopes():
    manifest = _manifest(
        [
        _solution("legacy-land", "nacional"),
        _solution("marine", "marine", domain="marine"),
        _solution("regional", "sirap", domain="land"),
        ]
    )

    assert [row["id"] for row in manifest.batch_solutions] == [
        "legacy-land",
        "marine",
    ]
    assert [row["id"] for row in manifest.national_solutions] == ["legacy-land"]
    assert [row["id"] for row in pipeline._select_solutions(manifest, None, None)] == [
        "legacy-land",
        "marine",
    ]


def test_manifest_rejects_unknown_batch_domain():
    with pytest.raises(ManifestError, match="Unknown solution domain"):
        _manifest([_solution("unknown", "nacional", domain="freshwater")])


def test_fetch_manifest_supports_local_release_preflight(tmp_path: Path):
    path = tmp_path / "manifest.json"
    path.write_text(
        json.dumps(
            {
                "publicBlobHost": "https://example.test",
                "layers": [
                    {
                        "id": "dummy",
                        "displayUrl": "https://example.test/dummy.tif",
                    }
                ],
                "solutions": [_solution("local-land", "nacional")],
            }
        ),
        encoding="utf-8",
    )

    manifest = fetch_manifest(path.resolve().as_uri())

    assert manifest.url == path.resolve().as_uri()
    assert [solution["id"] for solution in manifest.batch_solutions] == ["local-land"]


@pytest.mark.parametrize(
    ("solution", "expected"),
    [
        ({"id": "missing"}, "land"),
        ({"id": "land", "domain": "land"}, "land"),
        ({"id": "national", "domain": "nacional"}, "land"),
        ({"id": "terrestrial", "domain": "terrestrial"}, "land"),
        ({"id": "marine", "domain": "marine"}, "marine"),
    ],
)
def test_solution_domain_normalizes_supported_values(solution, expected):
    assert solution_domain(solution) == expected


def test_marine_metric_dispatch_loads_only_marine_layer(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    manifest = _manifest([_solution("marine", "marine", domain="marine")])
    loaded_value_layers: list[str] = []

    class NoLandMasks:
        def get(self, *args, **kwargs):
            raise AssertionError("marine dispatch attempted to load a land mask")

    class MarineValues:
        def get(self, layer_id, *args, **kwargs):
            loaded_value_layers.append(layer_id)
            assert layer_id == "marine_ecosystems"
            return np.array([[23, 55], [86, np.nan]], dtype=np.float64)

    monkeypatch.setattr(
        pipeline,
        "_compute_species_metric",
        lambda *args, **kwargs: pytest.fail("marine dispatch attempted species work"),
    )
    metrics = pipeline._build_metrics(
        _raster(),
        manifest.batch_solutions[0],
        manifest,
        NoLandMasks(),
        MarineValues(),
        tmp_path,
        False,
    )
    by_id = {metric["metricId"]: metric for metric in metrics}

    assert set(loaded_value_layers) == {"marine_ecosystems"}
    assert by_id["ecosystem_coverage"]["status"] == "not_applicable"
    assert by_id["species_richness_mammals"]["status"] == "not_applicable"
    assert by_id["coral_reef_coverage"]["status"] == "ready"
    assert by_id["marine_mangrove_coverage"]["status"] == "ready"
    assert by_id["seagrass_coverage"]["status"] == "ready"
    assert by_id["conservation_goals_met"]["status"] == "ready"
    assert by_id["priority_area_in_region"]["status"] == "ready"
    assert by_id["national_contribution"]["status"] == "ready"


def test_marine_subnational_preload_skips_all_land_layers(tmp_path: Path):
    manifest = _manifest([_solution("marine", "marine", domain="marine")])
    mask_calls: list[str] = []
    value_calls: list[str] = []

    class TrackingMasks:
        def get(self, layer_id, *args, **kwargs):
            mask_calls.append(layer_id)
            return np.zeros((2, 2), dtype=bool)

    class TrackingValues:
        def get(self, layer_id, *args, **kwargs):
            value_calls.append(layer_id)
            return np.zeros((2, 2), dtype=np.float64)

    masks = pipeline._preload_layer_masks(
        _raster(),
        manifest,
        TrackingMasks(),
        tmp_path,
        False,
        "marine",
    )
    values = pipeline._preload_layer_values(
        _raster(),
        manifest,
        TrackingValues(),
        tmp_path,
        False,
        "marine",
    )

    assert masks == {}
    assert mask_calls == []
    assert set(values) == {"marine_ecosystems"}
    assert value_calls == ["marine_ecosystems"]


def test_process_solution_skips_species_prepass_for_marine(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    solution = _solution("marine", "marine", domain="marine")
    manifest = _manifest([solution])
    raster = _raster()
    written_documents: list[dict] = []

    monkeypatch.setattr(
        pipeline,
        "cached_download",
        lambda *args, **kwargs: SimpleNamespace(
            path=tmp_path / "marine.tif",
            sha256="a" * 64,
        ),
    )
    monkeypatch.setattr(pipeline, "read_solution_raster", lambda path: raster)
    monkeypatch.setattr(
        pipeline,
        "_build_metrics",
        lambda *args, **kwargs: [
            {
                "metricId": definition.metric_id,
                "value": (
                    1.0
                    if (
                        "marine" in definition.applicable_domains
                        and definition.kind != "aoi_percent"
                    )
                    else None
                ),
                "status": (
                    "ready"
                    if (
                        "marine" in definition.applicable_domains
                        and definition.kind != "aoi_percent"
                    )
                    else "not_applicable"
                ),
                "unit": definition.unit,
                "source": (
                    "test"
                    if (
                        "marine" in definition.applicable_domains
                        and definition.kind != "aoi_percent"
                    )
                    else "n/a"
                ),
                "notes": None,
                "labelKey": definition.label_key,
                "formatHint": definition.format_hint,
            }
            for definition in pipeline.computable_metrics()
        ],
    )
    monkeypatch.setattr(
        pipeline,
        "_process_species_for_solution",
        lambda *args, **kwargs: pytest.fail("marine species pre-pass ran"),
    )

    def write_solution_cache(_output_dir, _solution_id, document):
        written_documents.append(document)
        path = tmp_path / "marine.metrics.json"
        path.write_text(json.dumps(document), encoding="utf-8")
        return path

    monkeypatch.setattr(pipeline, "write_solution_cache", write_solution_cache)

    result = pipeline._process_solution(
        solution=solution,
        manifest=manifest,
        cache_dir=tmp_path,
        output_dir=tmp_path,
        force_download=False,
        layer_cache=pipeline._LayerMaskCache(),
        value_cache=pipeline._LayerValueCache(),
        boundary_mask_cache=SimpleNamespace(),
        boundaries_by_level={},
        national_only=True,
        species_records=[SimpleNamespace()],
        species_pool_sizes=SimpleNamespace(),
        boundary_grid_cache=None,
    )

    assert result["speciesProcessed"] == 0
    assert written_documents[0]["metricsProvenance"]["solutionDomain"] == "marine"
    assert written_documents[0]["metricsProvenance"]["catalogSignature"].startswith(
        "metrics-catalog-v4:"
    )
