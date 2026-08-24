from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest
import rasterio
from affine import Affine
from fastapi.testclient import TestClient
from rasterio.warp import transform_geom

from app import main as main_module
from app.area_profile import _mesa_ecosystem_rows
from app.artifacts import (
    ArtifactState,
    ArtifactValidationError,
    RuntimeArtifact,
    _validate_required_mesa_coverage,
)
from app.config import Settings
from app.main import app
from app.metric_adapters import build_custom_aoi_raster
from app.models import MesaAoiCoverageRecord
from app.species_index import RuntimeSpeciesBitsetIndex
from app.solution_coverage import (
    CoverageSourceBinding,
    CoverageTarget,
    RuntimeMesaCoverage,
    SolutionCoverageError,
    calculate_ecosystem_aoi_coverage,
    calculate_ecosystem_national_coverage,
    load_runtime_mesa_coverage,
)
from mesa_coverage import evaluate_categorical_aoi
from raster_metrics import read_solution_raster
from app.solution_registry import RasterFingerprint

GRID = Affine(
    1000.0,
    0.0,
    4331309.911856957,
    0.0,
    -1000.0,
    2933186.9308051495,
)
SOLUTION_ID = "fixture_solution"


def _write_raster(path: Path, values: np.ndarray, *, nodata: int) -> Path:
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        width=2,
        height=2,
        count=1,
        dtype=values.dtype,
        crs="EPSG:9377",
        transform=GRID,
        nodata=nodata,
    ) as dataset:
        dataset.write(values, 1)
    return path


def _coverage_fixture(tmp_path: Path) -> tuple[RuntimeMesaCoverage, Path]:
    ecosystem_path = _write_raster(
        tmp_path / "mesa-ecosystems.tif",
        np.array([[1, 2], [1, 2]], dtype=np.uint16),
        nodata=0,
    )
    solution_path = _write_raster(
        tmp_path / "solution.tif",
        np.array([[2, 0], [1, 0]], dtype=np.uint8),
        nodata=255,
    )
    catalog_path = tmp_path / "ecosystems.csv"
    ecosystem_features = ["Forest", "Wetland"] + [
        f"Ecosystem {index}" for index in range(3, 418)
    ]
    catalog_path.write_text(
        "biome,biome_id\n"
        + "\n".join(
            f"{feature},{index}"
            for index, feature in enumerate(ecosystem_features, start=1)
        )
        + "\n",
        encoding="utf-8",
    )
    targets_path = tmp_path / "targets.json"
    targets_path.write_text(
        json.dumps(
            {
                "format": "mesa-solution-targets-v1",
                "solutions": {
                    SOLUTION_ID: [
                        {
                            "feature": feature,
                            "feature_type": "ecosystem",
                            "class": None,
                            "relative_target": 0.5,
                            "evaluated": "post-hoc",
                        }
                        for feature in ecosystem_features
                    ]
                },
                "source_bindings": {
                    SOLUTION_ID: {
                        "url": "https://example.test/fixture-goals",
                        "sha256": "a" * 64,
                        "ecosystem_feature_count": 417,
                        "species_feature_count": 0,
                    }
                },
            }
        ),
        encoding="utf-8",
    )
    return (
        load_runtime_mesa_coverage(
            ecosystem_path,
            catalog_path,
            targets_path,
            ["mammals"],
        ),
        solution_path,
    )


def test_core_national_coverage_matches_mesa_cell_counts(tmp_path: Path) -> None:
    coverage, solution_path = _coverage_fixture(tmp_path)
    assert coverage.source_bindings_by_solution[SOLUTION_ID].sha256 == "a" * 64
    rows = calculate_ecosystem_national_coverage(
        coverage,
        SOLUTION_ID,
        read_solution_raster(solution_path),
    )

    assert len(rows) == 417
    assert [
        (row.feature, row.total_amount, row.absolute_held, row.relative_held)
        for row in rows[:2]
    ] == [
        ("Forest", 2.0, 2.0, 1.0),
        ("Wetland", 2.0, 0.0, 0.0),
    ]


def test_species_target_lookup_normalizes_names_and_omits_missing_targets() -> None:
    coverage = RuntimeMesaCoverage(
        ecosystem_raster_path=Path("ecosystems.tif"),
        ecosystem_catalog_path=Path("ecosystems.csv"),
        targets_by_solution={
            SOLUTION_ID: (
                CoverageTarget(
                    feature="Forest",
                    feature_type="ecosystem",
                    feature_class=None,
                    relative_target=0.5,
                    evaluated="post-hoc",
                ),
                CoverageTarget(
                    feature="  ÁGUILA_Harpyja ",
                    feature_type="species",
                    feature_class="birds",
                    relative_target=0.25,
                    evaluated="post-hoc",
                ),
            )
        },
        source_bindings_by_solution={},
        species_groups=("birds",),
    )

    targets = coverage.species_targets_by_normalized_name(SOLUTION_ID)

    assert targets == {"águila harpyja": 0.25}
    assert targets.get("águila harpyja") == coverage.species_target(
        SOLUTION_ID,
        " águila   HARPYJA ",
    )
    assert targets.get("species absent from solution") is None


def test_species_target_lookup_rejects_duplicate_normalized_names() -> None:
    duplicate = CoverageTarget(
        feature="Species_one",
        feature_type="species",
        feature_class=None,
        relative_target=0.5,
        evaluated=None,
    )
    coverage = RuntimeMesaCoverage(
        ecosystem_raster_path=Path("ecosystems.tif"),
        ecosystem_catalog_path=Path("ecosystems.csv"),
        targets_by_solution={
            SOLUTION_ID: (
                duplicate,
                CoverageTarget(
                    feature=" species  ONE ",
                    feature_type="species",
                    feature_class=None,
                    relative_target=0.25,
                    evaluated=None,
                ),
            )
        },
        source_bindings_by_solution={},
        species_groups=("plants",),
    )

    with pytest.raises(
        SolutionCoverageError,
        match="mesa_species_target_duplicate:species one",
    ):
        coverage.species_targets_by_normalized_name(SOLUTION_ID)


def test_species_target_lookup_cooperatively_cancels_during_build() -> None:
    coverage = RuntimeMesaCoverage(
        ecosystem_raster_path=Path("ecosystems.tif"),
        ecosystem_catalog_path=Path("ecosystems.csv"),
        targets_by_solution={
            SOLUTION_ID: tuple(
                CoverageTarget(
                    feature=f"Species {index}",
                    feature_type="species",
                    feature_class=None,
                    relative_target=0.5,
                    evaluated=None,
                )
                for index in range(600)
            )
        },
        source_bindings_by_solution={},
        species_groups=("plants",),
    )
    cancellation_checks = 0

    def is_cancelled() -> bool:
        nonlocal cancellation_checks
        cancellation_checks += 1
        return cancellation_checks == 2

    with pytest.raises(SolutionCoverageError, match="species_coverage_cancelled"):
        coverage.species_targets_by_normalized_name(
            SOLUTION_ID,
            is_cancelled=is_cancelled,
        )
    assert cancellation_checks == 2


@pytest.mark.parametrize(
    "feature",
    ["For est", "for EST", "FOR_EST", " for   est ", "For_est"],
)
def test_runtime_loader_rejects_normalized_duplicate_features(
    tmp_path: Path,
    feature: str,
) -> None:
    targets_path = tmp_path / "targets.json"
    targets_path.write_text(
        json.dumps(
            {
                "format": "mesa-solution-targets-v1",
                "solutions": {
                    SOLUTION_ID: [
                        {
                            "feature": "For est",
                            "feature_type": "ecosystem",
                            "relative_target": 0.5,
                        },
                        {
                            "feature": feature,
                            "feature_type": "ecosystem",
                            "relative_target": 0.5,
                        },
                    ]
                },
            }
        ),
        encoding="utf-8",
    )

    with pytest.raises(SolutionCoverageError, match="duplicate normalized feature"):
        load_runtime_mesa_coverage(
            tmp_path / "ecosystems.tif",
            tmp_path / "ecosystems.csv",
            targets_path,
            [],
        )


@pytest.mark.parametrize("relative_target", [float("nan"), float("inf"), -0.1, 1.1])
def test_runtime_loader_rejects_invalid_targets(
    tmp_path: Path,
    relative_target: float,
) -> None:
    targets_path = tmp_path / "targets.json"
    targets_path.write_text(
        json.dumps(
            {
                "format": "mesa-solution-targets-v1",
                "solutions": {
                    SOLUTION_ID: [
                        {
                            "feature": "Forest",
                            "feature_type": "ecosystem",
                            "relative_target": relative_target,
                        }
                    ]
                },
            }
        ),
        encoding="utf-8",
    )

    with pytest.raises(SolutionCoverageError, match="relative_target"):
        load_runtime_mesa_coverage(
            tmp_path / "ecosystems.tif",
            tmp_path / "ecosystems.csv",
            targets_path,
            [],
        )


def test_boundary_coverage_preserves_both_denominators() -> None:
    ecosystems = np.array([[1, 2], [1, 2]], dtype=np.uint16)
    selected = np.array([[True, False], [True, False]])
    top_boundary = np.array([[True, True], [False, False]])

    rows = evaluate_categorical_aoi(
        category_values=ecosystems,
        selected_mask=selected,
        aoi_mask=top_boundary,
        feature_ids=[1, 2],
        feature_names=["Forest", "Wetland"],
        national_targets=[0.5, 0.5],
        pre_existing_mask=np.array([[True, False], [False, False]]),
        new_prioritizr_mask=np.array([[False, False], [True, False]]),
    )

    assert rows[0].coverage_within_aoi == pytest.approx(1.0)
    assert rows[0].contribution_to_national_coverage == pytest.approx(0.5)
    assert rows[0].contribution_to_national_target == pytest.approx(1.0)
    assert rows[0].absolute_held_aoi == (
        rows[0].absolute_pre_existing_aoi + rows[0].absolute_new_prioritizr_aoi
    )
    assert rows[0].pre_existing_coverage_within_aoi == pytest.approx(1.0)
    assert rows[0].new_prioritizr_coverage_within_aoi == pytest.approx(0.0)
    assert rows[0].share_of_national_amount == pytest.approx(0.5)
    assert rows[0].share_of_classified_aoi == pytest.approx(0.5)
    assert rows[1].coverage_within_aoi == pytest.approx(0.0)


def test_area_profile_api_matches_shared_coverage_calculation(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    coverage, solution_path = _coverage_fixture(tmp_path)
    solution = read_solution_raster(solution_path)
    polygon_9377 = {
        "type": "Polygon",
        "coordinates": [
            [
                [GRID.c, GRID.f - 1000],
                [GRID.c + 2000, GRID.f - 1000],
                [GRID.c + 2000, GRID.f],
                [GRID.c, GRID.f],
                [GRID.c, GRID.f - 1000],
            ]
        ],
    }
    geometry = transform_geom("EPSG:9377", "EPSG:4326", polygon_9377)
    artifact = RuntimeArtifact(
        manifest={},
        reference_raster_path=coverage.ecosystem_raster_path,
        mesa_coverage=coverage,
        solution_registry=SimpleNamespace(
            load=lambda _solution_id: (solution, "fixture-checksum")
        ),
    )
    state = ArtifactState(
        required=True,
        available=True,
        manifest_path="fixture-manifest.json",
        artifact_version="fixture-v3",
        message="ready",
    )
    monkeypatch.setattr(main_module, "get_artifact_state", lambda settings: state)
    monkeypatch.setattr(main_module, "get_runtime_artifact", lambda settings: artifact)

    response = TestClient(app).post(
        "/area-profile/custom-polygon",
        json={
            "geometry": geometry,
            "sections": ["ecosystems"],
            "solution_id": SOLUTION_ID,
        },
    )

    assert response.status_code == 200
    records = response.json()["sections"]["ecosystems"]["solution_coverage"]
    assert len(records) == 417
    expected = calculate_ecosystem_aoi_coverage(
        coverage,
        SOLUTION_ID,
        build_custom_aoi_raster(coverage.ecosystem_raster_path, geometry),
        solution,
    )
    assert records[0]["coverage_within_aoi"] == pytest.approx(
        expected["forest"].coverage_within_aoi
    )
    assert records[0]["contribution_to_national_target"] == pytest.approx(
        expected["forest"].contribution_to_national_target
    )
    assert records[0] == {
        "feature": "Forest",
        "total_in_aoi": 1.0,
        "national_total": 2.0,
        "classified_total_in_aoi": 2.0,
        "share_of_national_total": 0.5,
        "share_of_classified_aoi": 0.5,
        "held_in_aoi": 1.0,
        "coverage_within_aoi": 1.0,
        "pre_existing_held_in_aoi": 1.0,
        "pre_existing_coverage_within_aoi": 1.0,
        "new_prioritizr_held_in_aoi": 0.0,
        "new_prioritizr_coverage_within_aoi": 0.0,
        "contribution_to_national_coverage": 0.5,
        "pre_existing_contribution_to_national_coverage": 0.5,
        "new_prioritizr_contribution_to_national_coverage": 0.0,
        "contribution_to_national_target": 1.0,
    }
    zero_row = records[2]
    assert zero_row["total_in_aoi"] == 0
    assert zero_row["coverage_within_aoi"] is None
    assert zero_row["share_of_national_total"] is None
    assert zero_row["pre_existing_coverage_within_aoi"] is None
    with pytest.raises(ValueError, match="whole planning-cell count"):
        MesaAoiCoverageRecord.model_validate({**records[0], "total_in_aoi": 0.5})


def test_active_area_profile_fails_closed_below_417_ecosystem_rows(
    tmp_path: Path,
) -> None:
    coverage, solution_path = _coverage_fixture(tmp_path)
    coverage.targets_by_solution[SOLUTION_ID] = coverage.targets_by_solution[SOLUTION_ID][
        :-1
    ]
    solution = read_solution_raster(solution_path)

    with pytest.raises(
        SolutionCoverageError,
        match="mesa_ecosystem_coverage_incomplete:expected_417_received_416",
    ):
        _mesa_ecosystem_rows(
            SimpleNamespace(mesa_coverage=coverage),
            solution,
            solution,
            SOLUTION_ID,
        )


def test_production_validation_allows_sparse_non_golden_species_targets() -> None:
    coverage, manifest, fingerprint = _production_coverage_fixture()

    _validate_required_mesa_coverage(
        _production_settings(),
        manifest,
        coverage,
        fingerprint,
        3,
        _production_species_index(),
    )


def test_production_validation_rejects_missing_golden_solution() -> None:
    coverage, manifest, fingerprint = _production_coverage_fixture()
    manifest["mesa_coverage"]["contract"]["golden_master_solution_id"] = "missing"

    with pytest.raises(
        ArtifactValidationError, match="not present in packaged targets"
    ):
        _validate_required_mesa_coverage(
            _production_settings(),
            manifest,
            coverage,
            fingerprint,
            3,
            _production_species_index(),
        )


@pytest.mark.parametrize(
    "binding",
    [
        CoverageSourceBinding("http://example.test/goals", "a" * 64, 417, 7_980),
        CoverageSourceBinding("https://example.test/goals", "A" * 64, 417, 7_980),
        CoverageSourceBinding("https://example.test/goals", "a" * 64, 416, 7_980),
    ],
)
def test_production_validation_rejects_invalid_source_bindings(
    binding: CoverageSourceBinding,
) -> None:
    coverage, manifest, fingerprint = _production_coverage_fixture()
    coverage.source_bindings_by_solution["golden"] = binding

    with pytest.raises(
        ArtifactValidationError, match="invalid Mesa target source binding"
    ):
        _validate_required_mesa_coverage(
            _production_settings(),
            manifest,
            coverage,
            fingerprint,
            3,
            _production_species_index(),
        )


def test_production_validation_rejects_valid_cell_mismatch() -> None:
    coverage, manifest, fingerprint = _production_coverage_fixture()

    with pytest.raises(ArtifactValidationError, match="valid planning-cell count"):
        _validate_required_mesa_coverage(
            _production_settings(),
            manifest,
            coverage,
            fingerprint,
            2,
            _production_species_index(),
        )


def test_production_validation_rejects_semantic_duplicate_targets() -> None:
    coverage, manifest, fingerprint = _production_coverage_fixture()
    targets = list(coverage.targets_by_solution["sparse"])
    targets[1] = CoverageTarget(
        " ECOSYSTEM-0 ",
        "ecosystem",
        None,
        0.5,
        None,
    )
    coverage.targets_by_solution["sparse"] = tuple(targets)

    with pytest.raises(ArtifactValidationError, match="duplicate normalized feature"):
        _validate_required_mesa_coverage(
            _production_settings(),
            manifest,
            coverage,
            fingerprint,
            3,
            _production_species_index(),
        )


def test_production_validation_requires_complete_runtime_species_bitset() -> None:
    coverage, manifest, fingerprint = _production_coverage_fixture()

    with pytest.raises(ArtifactValidationError, match="species bitset"):
        _validate_required_mesa_coverage(
            _production_settings(),
            manifest,
            coverage,
            fingerprint,
            3,
            _production_species_index(species_count=7_979),
        )


def _production_coverage_fixture() -> tuple[
    RuntimeMesaCoverage,
    dict,
    RasterFingerprint,
]:
    fingerprint = RasterFingerprint(
        width=2,
        height=2,
        transform=tuple(GRID)[:6],
        crs="EPSG:9377",
    )
    ecosystems = tuple(
        CoverageTarget(f"ecosystem-{index}", "ecosystem", None, 0.5, None)
        for index in range(417)
    )
    species = tuple(
        CoverageTarget(f"species-{index}", "species", None, 0.5, None)
        for index in range(7_980)
    )
    coverage = RuntimeMesaCoverage(
        ecosystem_raster_path=Path("ecosystems.tif"),
        ecosystem_catalog_path=Path("ecosystems.csv"),
        targets_by_solution={
            "golden": ecosystems + species,
            "sparse": ecosystems + species[:1],
        },
        source_bindings_by_solution={
            "golden": CoverageSourceBinding(
                "https://example.test/golden",
                "a" * 64,
                417,
                7_980,
            ),
            "sparse": CoverageSourceBinding(
                "https://example.test/sparse",
                "b" * 64,
                417,
                1,
            ),
        },
        species_groups=("mammals",),
    )
    manifest = {
        "reference_grid": {"pin": {"valid_cell_count": 3}},
        "reference_raster_checksum": {
            "algorithm": "sha256",
            "value": "c" * 64,
        },
        "mesa_coverage": {
            "contract": {
                "format": "coverage-parity-contract-v1",
                "release_id": "solutions-v3-0-0",
                "sha256": "d" * 64,
                "ecosystem_feature_count": 417,
                "species_feature_count": 7_980,
                "golden_master_solution_id": "golden",
                "grid": {
                    "crs": fingerprint.crs,
                    "width": fingerprint.width,
                    "height": fingerprint.height,
                    "transform": list(fingerprint.transform),
                    "valid_planning_cell_count": 3,
                    "template_sha256": "c" * 64,
                },
            }
        },
    }
    return coverage, manifest, fingerprint


def _production_settings() -> Settings:
    return Settings(
        artifact_dir=Path("runtime-artifacts"),
        artifact_manifest_path=Path("runtime-artifacts/manifest.json"),
        artifact_required=True,
        artifact_schema_version="metrics-artifact-manifest/v1",
        mesa_coverage_required=True,
        expected_coverage_release_id="solutions-v3-0-0",
    )


def _production_species_index(
    species_count: int = 7_980,
) -> RuntimeSpeciesBitsetIndex:
    return RuntimeSpeciesBitsetIndex(
        metadata_document=SimpleNamespace(species_count=species_count),
        bits=np.empty((0, 0), dtype=np.uint8),
        data_path=Path("species.cells.bits"),
        metadata_path=Path("species.cells.json"),
        groups={},
    )
