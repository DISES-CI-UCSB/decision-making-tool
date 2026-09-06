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
from solution_domain import normalize_domain, solution_domain


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
    if scope == "sirap":
        solution["sirapId"] = "orinoquia"
        solution["regionalInputPacket"] = {
            "format": "sirap-metric-input-packet-v1",
            "regionId": "orinoquia",
            "grid": {"sha256": "a" * 64},
            "authoritativeSummary": {
                "url": "https://example.test/orinoquia-summary.csv",
                "sha256": "b" * 64,
                "schema": "prioritizr-summary-v1",
            },
            "layers": {
                "wetlands": {
                    "url": "https://example.test/humedales-orinoquia.tif",
                    "sha256": "c" * 64,
                }
            },
            "species": {
                "universePolicy": "regional-summary",
                "matrices": [
                    {
                        "taxonomicClass": "Amphibia",
                        "format": "smsp-v1",
                        "url": "https://example.test/amphibia-orinoquia.smsp.gz",
                        "sha256": "d" * 64,
                        "gridSha256": "a" * 64,
                    }
                ],
            },
        }
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


def test_manifest_batch_includes_national_sirap_and_marine_solutions():
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
        "regional",
    ]
    assert [row["id"] for row in manifest.national_solutions] == [
        "legacy-land",
        "regional",
    ]
    assert [row["id"] for row in pipeline._select_solutions(manifest, None, None)] == [
        "legacy-land",
        "marine",
        "regional",
    ]


def test_manifest_rejects_unknown_batch_domain():
    with pytest.raises(ManifestError, match="Unknown solution domain"):
        _manifest([_solution("unknown", "nacional", domain="freshwater")])


def test_manifest_requires_sirap_id_for_regional_solutions():
    solution = _solution("regional", "sirap", domain="land")
    solution.pop("sirapId")

    with pytest.raises(ManifestError, match="sirapId"):
        _manifest([solution])


def test_manifest_requires_packet_bound_regional_sources():
    solution = _solution("regional", "sirap", domain="land")
    solution.pop("regionalInputPacket")

    with pytest.raises(ManifestError, match="regionalInputPacket"):
        _manifest([solution])


def test_manifest_rejects_sirap_packet_with_mismatched_region():
    solution = _solution("regional", "sirap", domain="land")
    solution["regionalInputPacket"]["regionId"] = "eje-cafetero"

    with pytest.raises(ManifestError, match="does not match sirapId"):
        _manifest([solution])


def test_sirap_is_a_scope_not_a_metric_domain():
    with pytest.raises(ValueError, match="Unknown solution domain"):
        normalize_domain("sirap")


def test_sirap_execution_requires_grouped_boundary_fanout():
    solution = _solution("regional", "sirap", domain="land")

    with pytest.raises(ValueError, match="METRICS_BOUNDARY_FANOUT=grouped"):
        pipeline._validate_sirap_execution_mode(
            [solution],
            national_only=False,
            boundary_fanout_mode="legacy",
        )


def test_sirap_execution_rejects_national_only_mode():
    solution = _solution("regional", "sirap", domain="land")

    with pytest.raises(ValueError, match="--national-only"):
        pipeline._validate_sirap_execution_mode(
            [solution],
            national_only=True,
            boundary_fanout_mode="grouped",
        )


def test_sirap_execution_accepts_grouped_regional_mode():
    solution = _solution("regional", "sirap", domain="land")

    pipeline._validate_sirap_execution_mode(
        [solution],
        national_only=False,
        boundary_fanout_mode="grouped",
    )


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
        ({"id": "sirap", "scope": "sirap"}, "land"),
        ({"id": "marine", "domain": "marine"}, "marine"),
    ],
)
def test_solution_domain_normalizes_supported_values(solution, expected):
    assert solution_domain(solution) == expected


def test_marine_metric_dispatch_loads_coberturas_and_marine_values(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    manifest = _manifest([_solution("marine", "marine", domain="marine")])
    loaded_value_layers: list[str] = []

    coberturas_ids = {
        "coberturas_artificial_surfaces",
        "coberturas_agricultural_areas",
        "coberturas_forests_and_semi_natural_areas",
        "coberturas_wetlands",
        "coberturas_water_bodies",
    }
    # Selected cells are [[True, False], [True, True]]. Forest overlap on those
    # three cells must produce a real percentage, not a forced 0 / N/A.
    forest_mask = np.array([[True, False], [True, True]], dtype=bool)

    class CoberturasAndMarineMasks:
        def get(self, layer_id, *args, **kwargs):
            if layer_id == "coberturas_forests_and_semi_natural_areas":
                return forest_mask
            if layer_id in coberturas_ids:
                return np.zeros((2, 2), dtype=bool)
            raise AssertionError(f"marine dispatch attempted to load a land mask: {layer_id}")

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
        CoberturasAndMarineMasks(),
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
    assert by_id["land_use_forests_and_semi_natural_areas_pct"]["status"] == "ready"
    assert by_id["land_use_forests_and_semi_natural_areas_pct"]["value"] == 100
    for land_use_id in (
        "land_use_artificial_surfaces_pct",
        "land_use_agricultural_areas_pct",
        "land_use_wetlands_pct",
        "land_use_water_bodies_pct",
    ):
        assert by_id[land_use_id]["status"] == "ready"
        assert by_id[land_use_id]["value"] == 0


def test_marine_subnational_preload_loads_coberturas_and_marine_values(tmp_path: Path):
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
        manifest.batch_solutions[0],
        manifest,
        TrackingMasks(),
        tmp_path,
        False,
        "marine",
    )
    values = pipeline._preload_layer_values(
        _raster(),
        manifest.batch_solutions[0],
        manifest,
        TrackingValues(),
        tmp_path,
        False,
        "marine",
    )

    coberturas_ids = {
        "coberturas_artificial_surfaces",
        "coberturas_agricultural_areas",
        "coberturas_forests_and_semi_natural_areas",
        "coberturas_wetlands",
        "coberturas_water_bodies",
    }
    assert set(masks) == coberturas_ids
    assert set(mask_calls) == coberturas_ids
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
