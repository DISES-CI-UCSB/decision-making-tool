"""A `--reference-grid land-solution` build must produce a loadable artifact.

Two published inputs were missing without a single failing test, because nothing
asserted that a 9377 build loads. The builder resolves the ecosystem bundle and
the species matrices per reference grid, so this fixture publishes *both* grids
at their real URLs: EPSG:4326 objects at the legacy pathnames the deployed
backend still rebuilds from, and EPSG:9377 objects at the `land-solution-9377/`
pathnames. A builder that reaches for the 4326 objects therefore fails here the
same way it failed in production — the ecosystem raster does not align with the
reference grid, and the species bitset falls back to cell-count range areas.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
from pathlib import Path

import numpy as np
import pytest
import rasterio
from affine import Affine

from app.artifacts import ArtifactValidationError, load_runtime_artifact
from app.config import Settings
from blob_manifest import ResolvedManifest
from coverage_parity_contract import CoverageParityContract, load_coverage_parity_contract
from mec_compact import COMPOSITE_PROVENANCE_FORMAT, COMPOSITE_TUPLE_FIELDS
from scripts import build_runtime_artifact as builder
from scripts.aligned_cache import (
    ALIGNMENT_MANIFEST_FORMAT,
    RESAMPLING_BY_LAYER_CLASS,
    grid_descriptor,
    read_fingerprint,
    sha256_file,
)
from scripts.land_solution_inputs import (
    ECOSYSTEM_BLOB_PATHS,
    ReferenceRasterPin,
    public_url,
    species_matrix_blob_path,
)
from sparse.format import SparseMetadata, SpeciesMatrixEntry, encode_species_matrix

PUBLIC_BLOB_HOST = builder.PUBLIC_BLOB_HOST
PARITY_CONTRACT_PATH = (
    Path(__file__).resolve().parents[2]
    / "data/metrics/release-specs/solutions-v3-0-0/coverage-parity-contract.json"
)

# Origin and 1000 m cells of the real v0.2 land solution grid, cropped to 3x2.
LAND_GRID = Affine(1000.0, 0.0, 4331309.911856957, 0.0, -999.9999999999999, 2933186.9308051495)
WGS84_GRID = Affine(0.00833333333333333, 0.0, -79.18333333333334, 0.0, -0.00833333333333333, 12.65)

MEC_VALUES = np.array([[1, 2, 1], [2, 0, 1]], dtype=np.uint16)
MEC_VALID_CELLS = int((MEC_VALUES != 0).sum())
MEC_CROSSWALK = (
    "rasterValue,tipoEcosistema,biomeFamily,broadBiomeContext,"
    "biomeRegion,broadEcosystem,detailedEcosystem\n"
    "1,Bosque,Orobioma,Contexto bosque,Orobioma Región,Bosque,Bosque húmedo\n"
    "2,Sabana,Orobioma,Contexto sabana,Orobioma Región,Sabana,Sabana seca\n"
)

MANIFEST_LAYER_IDS = (
    "paramos",
    "bosque_seco",
    "wetlands",
    "mangroves",
    "resguardos",
    "comunidades",
)


def write_raster(
    path: Path,
    data: np.ndarray,
    *,
    crs: str,
    transform: Affine,
    nodata: float,
) -> Path:
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
        nodata=nodata,
    ) as dataset:
        dataset.write(data, 1)
    return path


def write_mec_bundle(directory: Path, *, crs: str, transform: Affine) -> dict[str, Path]:
    """Write a composite MEC bundle whose provenance matches its own outputs."""
    raster = write_raster(
        directory / "mec.tif",
        MEC_VALUES,
        crs=crs,
        transform=transform,
        nodata=0,
    )
    crosswalk = directory / "mec.csv"
    crosswalk.write_text(MEC_CROSSWALK, encoding="utf-8")
    crosswalk_sha256 = sha256_file(crosswalk)
    provenance = directory / "mec.provenance.json"
    provenance.write_text(
        json.dumps(
            {
                "format": COMPOSITE_PROVENANCE_FORMAT,
                "generatedAt": "2026-08-07T00:00:00Z",
                "source": {"publisher": "IDEAM"},
                "catalog": {
                    "rowCount": 2,
                    "crosswalkSha256": crosswalk_sha256,
                    "crosswalkSignature": "fixture",
                    "tupleFields": list(COMPOSITE_TUPLE_FIELDS),
                },
                "outputs": {
                    "compositeRaster": {"sha256": sha256_file(raster)},
                    "crosswalk": {"sha256": crosswalk_sha256},
                },
                "rasterization": {"dtype": "uint16", "nodata": 0},
                "grid": {"fingerprintSha256": "fixture"},
            }
        ),
        encoding="utf-8",
    )
    return {"raster": raster, "crosswalk": crosswalk, "provenance": provenance}


def write_species_matrix(
    path: Path,
    *,
    group: str,
    grid: Affine,
    crs: str,
    area_km2: float | None,
) -> Path:
    """One species per group. `area_km2` is what makes the bitset exact-area."""
    path.parent.mkdir(parents=True, exist_ok=True)
    metadata = SparseMetadata(
        width=3,
        height=2,
        x_origin=grid.c,
        y_origin=grid.f,
        x_scale=grid.a,
        y_scale=grid.e,
        nodata=255,
        crs=crs,
        count=2,
    )
    entry = SpeciesMatrixEntry(
        name=f"Fixture {group}",
        iucn="LC",
        csv_class=group.capitalize(),
        cell_ids=np.asarray([0, 1], dtype=np.uint32),
        metadata=metadata,
        area_km2=area_km2,
    )
    path.write_bytes(encode_species_matrix([entry]))
    return path


def write_aligned_cache(cache_dir: Path, specs: list[builder.LayerSpec], reference: Path) -> None:
    """Stand in for the metrics pipeline's aligned cache, sidecars and all."""
    descriptor = grid_descriptor(read_fingerprint(reference))
    root = cache_dir / "aligned"
    for url, layer_class in sorted({(spec.url, spec.alignment_class) for spec in specs}):
        cache_key = hashlib.sha256(f"{url}|{layer_class}".encode()).hexdigest()
        directory = root / cache_key[:2]
        density = layer_class == "fraction_or_density"
        aligned = write_raster(
            directory / f"{cache_key}.tif",
            np.full((2, 3), 12.5, dtype=np.float32) if density else np.ones((2, 3), dtype=np.uint8),
            crs="EPSG:9377",
            transform=LAND_GRID,
            nodata=-9999.0 if density else 255,
        )
        (directory / f"{cache_key}.json").write_text(
            json.dumps(
                {
                    "format": ALIGNMENT_MANIFEST_FORMAT,
                    "cacheKey": cache_key,
                    "sourceUrl": url,
                    "sourceSha256": hashlib.sha256(url.encode()).hexdigest(),
                    "alignedSha256": sha256_file(aligned),
                    "targetGrid": descriptor,
                    "policy": {
                        "layer_class": layer_class,
                        "resampling": RESAMPLING_BY_LAYER_CLASS[layer_class],
                    },
                }
            ),
            encoding="utf-8",
        )


def fake_manifest() -> ResolvedManifest:
    layers_by_id = {
        layer_id: {
            "id": layer_id,
            "displayUrl": f"{PUBLIC_BLOB_HOST}/inputs/features/{layer_id}.tif",
            "rendering": {"valueType": "binary", "selectedValue": 1},
        }
        for layer_id in MANIFEST_LAYER_IDS
    }
    return ResolvedManifest(
        url="https://example.invalid/manifest.json",
        raw={},
        public_blob_host=PUBLIC_BLOB_HOST,
        layers_by_id=layers_by_id,
        national_solutions=[
            {
                "id": "eco17_estr17_esprep17_runap_iheh2022",
                "name": "Fixture land solution",
                "displayUrl": f"{PUBLIC_BLOB_HOST}/solutions/fixture.tif",
                "blobPath": "solutions/fixture.tif",
                "coverage": [
                    {
                        "feature": "Forest",
                        "type": "ecosystem",
                        "class": None,
                        "relativeTarget": 0.5,
                        "evaluated": "post-hoc",
                    },
                    {
                        "feature": "Fixture mammals",
                        "type": "species",
                        "class": "Mammalia",
                        "relativeTarget": 0.5,
                        "evaluated": "prioritizr_model",
                    },
                ],
            }
        ],
    )


def test_v3_parity_contract_selects_mesa_runtime_inputs() -> None:
    contract = load_coverage_parity_contract(PARITY_CONTRACT_PATH)

    layers = builder.build_layer_specs({}, "land-solution", contract)
    mesa_layer = next(
        layer
        for layer in layers
        if layer.layer_id == builder.MESA_ECOSYSTEM_LAYER_ID
    )
    assert mesa_layer.url == contract.document["ecosystems"]["raster"]["url"]

    matrices = builder.build_species_matrix_specs("land-solution", contract)
    expected_urls = {
        entry["group"]: entry["url"]
        for entry in contract.document["species"]["runtimeBundles"]
    }
    assert {
        matrix.group: matrix.url
        for matrix in matrices
        if matrix.group != "threatened"
    } == expected_urls


def test_runtime_artifact_preserves_each_corine_level_1_land_use_class() -> None:
    layers = {
        layer.layer_id: layer
        for layer in builder.build_layer_specs({}, "land-solution")
        if layer.layer_id.startswith("coberturas_")
    }

    expected_land_use_layers = {
        "coberturas_artificial_surfaces": (
            1,
            "land_use_artificial_surfaces_pct",
        ),
        "coberturas_agricultural_areas": (
            2,
            "land_use_agricultural_areas_pct",
        ),
        "coberturas_forests_and_semi_natural_areas": (
            3,
            "land_use_forests_and_semi_natural_areas_pct",
        ),
        "coberturas_wetlands": (4, "land_use_wetlands_pct"),
        "coberturas_water_bodies": (5, "land_use_water_bodies_pct"),
        "coberturas_agriculture": (2, "agricultural_area"),
    }

    assert set(layers) == set(expected_land_use_layers)
    for layer_id, (selected_value, metric_id) in expected_land_use_layers.items():
        layer = layers[layer_id]
        assert layer.rendering["selectedValue"] == selected_value
        assert layer.metric_ids == (metric_id,)


def test_v3_target_bundle_is_extracted_from_release_goals(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    goals = tmp_path / "fixture.goals.json"
    goals.write_text(
        json.dumps(
            {
                "solutionId": "fixture-solution",
                "features": {
                    "ecosystems": [
                        {
                            "featureName": "Forest",
                            "relativeTarget": 0.17,
                            "evaluationSource": "prioritizr_model",
                        },
                        {
                            "featureName": "Wetland",
                            "relativeTarget": 0.17,
                            "evaluationSource": "post_hoc",
                        },
                    ],
                    "species": [
                        {
                            "featureName": name,
                            "relativeTarget": 0.30,
                            "evaluationSource": "prioritizr_model",
                            "taxonClass": "Aves",
                        }
                        for name in ("Bird one", "Bird two", "Bird three")
                    ],
                },
            }
        ),
        encoding="utf-8",
    )
    contract = CoverageParityContract(
        path=tmp_path / "contract.json",
        document={
            "ecosystems": {"featureCount": 2},
            "species": {"summaryFeatureCount": 3},
            "goldenMaster": {"solutionId": "fixture-solution"},
        },
    )
    monkeypatch.setattr(
        builder,
        "download_source",
        lambda url, target, force: builder.DownloadedSource(
            goals,
            sha256_file(goals),
            goals.stat().st_size,
        ),
    )

    targets, bindings = builder._goals_targets_from_release(
        [
            {
                "id": "fixture-solution",
                "finderInputs": {"domain": "land"},
                "precomputedMetricUrls": {"goals": "https://example.test/goals.json"},
            }
        ],
        tmp_path / "scratch",
        force=False,
        parity_contract=contract,
    )

    assert len(targets["fixture-solution"]) == 5
    assert targets["fixture-solution"][0]["feature_type"] == "ecosystem"
    assert targets["fixture-solution"][-1]["class"] == "Aves"
    assert bindings["fixture-solution"]["ecosystem_feature_count"] == 2
    assert bindings["fixture-solution"]["species_feature_count"] == 3


def test_v3_target_bundle_accepts_zero_species_non_golden_solution(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    targets, bindings = _extract_goals_fixture(
        tmp_path,
        monkeypatch,
        ecosystems=[
            {"featureName": "Forest", "relativeTarget": 0.0},
            {"featureName": "Wetland", "relativeTarget": 1.0},
        ],
        species=[],
        golden_solution_id="another-solution",
    )

    assert len(targets["fixture-solution"]) == 2
    assert bindings["fixture-solution"]["ecosystem_feature_count"] == 2
    assert bindings["fixture-solution"]["species_feature_count"] == 0


@pytest.mark.parametrize(
    "ecosystems",
    [
        [
            {"featureName": "Dry forest", "relativeTarget": 0.17},
            {"featureName": " DRY_forest ", "relativeTarget": 0.17},
        ],
        [
            {"featureName": "Forest", "relativeTarget": 0.17},
            {"featureName": " \t ", "relativeTarget": 0.17},
        ],
        [
            {"featureName": "Forest", "relativeTarget": float("nan")},
            {"featureName": "Wetland", "relativeTarget": 0.17},
        ],
        [
            {"featureName": "Forest", "relativeTarget": float("inf")},
            {"featureName": "Wetland", "relativeTarget": 0.17},
        ],
        [
            {"featureName": "Forest", "relativeTarget": -0.1},
            {"featureName": "Wetland", "relativeTarget": 0.17},
        ],
        [
            {"featureName": "Forest", "relativeTarget": 1.1},
            {"featureName": "Wetland", "relativeTarget": 0.17},
        ],
    ],
)
def test_v3_target_bundle_rejects_invalid_ecosystem_rows(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    ecosystems: list[dict[str, object]],
) -> None:
    with pytest.raises(SystemExit, match="conservation goals are invalid"):
        _extract_goals_fixture(
            tmp_path,
            monkeypatch,
            ecosystems=ecosystems,
            species=[],
            golden_solution_id="another-solution",
        )


def test_v3_target_bundle_rejects_duplicate_species_names(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with pytest.raises(SystemExit, match="duplicate normalized feature"):
        _extract_goals_fixture(
            tmp_path,
            monkeypatch,
            ecosystems=[
                {"featureName": "Forest", "relativeTarget": 0.17},
                {"featureName": "Wetland", "relativeTarget": 0.17},
            ],
            species=[
                {"featureName": "Panthera onca", "relativeTarget": 0.3},
                {"featureName": " PANTHERA_onca ", "relativeTarget": 0.3},
            ],
            golden_solution_id="another-solution",
        )


def _extract_goals_fixture(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    *,
    ecosystems: list[dict[str, object]],
    species: list[dict[str, object]],
    golden_solution_id: str,
) -> tuple[dict[str, list[dict]], dict[str, dict]]:
    goals = tmp_path / "fixture.goals.json"
    goals.write_text(
        json.dumps(
            {
                "solutionId": "fixture-solution",
                "features": {
                    "ecosystems": ecosystems,
                    "species": species,
                },
            }
        ),
        encoding="utf-8",
    )
    contract = CoverageParityContract(
        path=tmp_path / "contract.json",
        document={
            "ecosystems": {"featureCount": len(ecosystems)},
            "species": {"summaryFeatureCount": 7_980},
            "goldenMaster": {"solutionId": golden_solution_id},
        },
    )
    monkeypatch.setattr(
        builder,
        "download_source",
        lambda url, target, force: builder.DownloadedSource(
            goals,
            sha256_file(goals),
            goals.stat().st_size,
        ),
    )
    return builder._goals_targets_from_release(
        [
            {
                "id": "fixture-solution",
                "finderInputs": {"domain": "land"},
                "precomputedMetricUrls": {"goals": "https://example.test/goals.json"},
            }
        ],
        tmp_path / "scratch",
        force=False,
        parity_contract=contract,
    )


def publish_both_grids(sources: Path) -> tuple[dict[str, Path], Path]:
    """Map every published URL the builder may reach to a local stand-in."""
    published: dict[str, Path] = {}

    land_bundle = write_mec_bundle(
        sources / "ecosystems-9377",
        crs="EPSG:9377",
        transform=LAND_GRID,
    )
    legacy_bundle = write_mec_bundle(
        sources / "ecosystems-4326",
        crs="EPSG:4326",
        transform=WGS84_GRID,
    )
    for grid_name, bundle in (
        ("land-solution", land_bundle),
        ("ecosistemas", legacy_bundle),
    ):
        for name, url in builder.ECOSYSTEM_SOURCE_URLS_BY_GRID[grid_name].items():
            published[url] = bundle[name]

    for grid_name, grid, crs, area_km2 in (
        ("land-solution", LAND_GRID, "EPSG:9377", 1.75),
        ("ecosistemas", WGS84_GRID, "EPSG:4326", None),
    ):
        url_for = builder.SPECIES_MATRIX_URL_BUILDERS[grid_name]
        for group in builder.SPECIES_MATRIX_GROUPS:
            published[url_for(group)] = write_species_matrix(
                sources / f"species-{crs.replace(':', '')}" / f"species_{group}.smtx.gz",
                group=group,
                grid=grid,
                crs=crs,
                area_km2=area_km2,
            )

    catalog = sources / "mesa-ecosystems.csv"
    catalog.write_text(
        "biome,biome_id\nForest,1\nWetland,2\n",
        encoding="utf-8",
    )
    published[builder.MESA_ECOSYSTEM_CATALOG_URL] = catalog
    return published, land_bundle["raster"]


def pin_for(reference: Path) -> ReferenceRasterPin:
    """The tiny artifact pins its own reference raster, exactly as production does."""
    return ReferenceRasterPin(
        blob_path=ECOSYSTEM_BLOB_PATHS["raster"],
        sha256=sha256_file(reference),
        size_bytes=reference.stat().st_size,
        crs="EPSG:9377",
        width=3,
        height=2,
        transform=tuple(LAND_GRID)[:6],
        valid_cell_count=MEC_VALID_CELLS,
        rationale="Tiny aligned MEC composite standing in for the national land domain.",
    )


def parity_contract_for(reference: Path) -> CoverageParityContract:
    document = copy.deepcopy(
        load_coverage_parity_contract(PARITY_CONTRACT_PATH).document
    )
    document["releaseId"] = "solutions-v3-test"
    document["grid"].update(
        {
            "crs": "EPSG:9377",
            "width": 3,
            "height": 2,
            "transform": list(tuple(LAND_GRID)[:6]),
            "validPlanningCellCount": MEC_VALID_CELLS,
        }
    )
    document["grid"]["template"] = {
        "logicalPath": "mesa/template-test.tif",
        "sha256": sha256_file(reference),
        "url": "https://example.test/releases/solutions-v3-test/template.tif",
    }
    return CoverageParityContract(path=PARITY_CONTRACT_PATH, document=document)


def test_parity_reference_grid_uses_verified_contract_provenance(tmp_path: Path) -> None:
    _, reference = publish_both_grids(tmp_path / "published")
    contract = parity_contract_for(reference)
    downloaded = builder.DownloadedSource(
        path=reference,
        sha256=sha256_file(reference),
        bytes=reference.stat().st_size,
    )

    resolved = builder.resolve_reference_grid(
        builder.REFERENCE_GRIDS["land-solution"],
        contract.document["grid"]["template"]["url"],
        downloaded,
        read_fingerprint(reference),
        contract,
    )

    metadata = resolved.manifest_metadata()
    assert metadata["pin"]["release_id"] == "solutions-v3-test"
    assert metadata["pin"]["valid_cell_count"] == MEC_VALID_CELLS
    assert metadata["pin"]["valid_cell_count"] != (
        builder.LAND_SOLUTION_REFERENCE_PIN.valid_cell_count
    )
    assert metadata["pin"]["sha256"] == downloaded.sha256
    assert metadata["width"] == 3
    assert metadata["height"] == 2
    assert metadata["crs"] == "EPSG:9377"
    assert metadata["transform"] == list(tuple(LAND_GRID)[:6])
    assert resolved.parity_contract_grid() == {
        "crs": metadata["crs"],
        "width": metadata["width"],
        "height": metadata["height"],
        "transform": metadata["transform"],
        "valid_planning_cell_count": metadata["pin"]["valid_cell_count"],
        "template_sha256": metadata["pin"]["sha256"],
    }


@pytest.mark.parametrize(
    ("field", "expected_error"),
    [
        ("sha256", "template SHA-256"),
        ("crs", "CRS"),
        ("width", "width"),
        ("height", "height"),
        ("transform", "transform"),
        ("validPlanningCellCount", "valid planning-cell count"),
    ],
)
def test_parity_reference_grid_rejects_contract_raster_mismatch(
    tmp_path: Path,
    field: str,
    expected_error: str,
) -> None:
    _, reference = publish_both_grids(tmp_path / "published")
    contract = parity_contract_for(reference)
    if field == "sha256":
        contract.document["grid"]["template"]["sha256"] = "0" * 64
    elif field == "crs":
        contract.document["grid"]["crs"] = "EPSG:4326"
    elif field == "transform":
        contract.document["grid"]["transform"][0] = 999.0
    else:
        contract.document["grid"][field] += 1
    downloaded = builder.DownloadedSource(
        path=reference,
        sha256=sha256_file(reference),
        bytes=reference.stat().st_size,
    )

    with pytest.raises(SystemExit, match=expected_error):
        builder.resolve_reference_grid(
            builder.REFERENCE_GRIDS["land-solution"],
            contract.document["grid"]["template"]["url"],
            downloaded,
            read_fingerprint(reference),
            contract,
        )


def test_legacy_land_reference_grid_preserves_land_pin(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _, reference = publish_both_grids(tmp_path / "published")
    pin = pin_for(reference)
    monkeypatch.setattr(builder, "LAND_SOLUTION_REFERENCE_PIN", pin)
    downloaded = builder.DownloadedSource(
        path=reference,
        sha256=sha256_file(reference),
        bytes=reference.stat().st_size,
    )

    resolved = builder.resolve_reference_grid(
        builder.REFERENCE_GRIDS["land-solution"],
        pin.url,
        downloaded,
        read_fingerprint(reference),
        None,
    )

    assert resolved.release_id is None
    assert resolved.manifest_metadata()["pin"] == builder.reference_raster_pin(
        "land-solution"
    )


def build_tiny_land_solution_artifact(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> Path:
    """Run the real builder against local stand-ins for every published object."""
    manifest = fake_manifest()
    published, reference = publish_both_grids(tmp_path / "published")
    pin = pin_for(reference)

    cache_dir = tmp_path / "metrics-cache"
    write_aligned_cache(cache_dir, builder.build_layer_specs(manifest.layers_by_id), reference)

    def fake_download(url: str, target: Path, *, force: bool) -> builder.DownloadedSource:
        source = published.get(url)
        if source is None:
            raise AssertionError(f"Build reached an unpublished object: {url}")
        return builder.copy_source(source, target)

    artifact_root = tmp_path / "runtime-artifacts"
    monkeypatch.setattr(builder, "fetch_manifest", lambda url: manifest)
    monkeypatch.setattr(builder, "download_source", fake_download)
    monkeypatch.setattr(builder, "LAND_SOLUTION_REFERENCE_PIN", pin)
    monkeypatch.setattr(
        builder,
        "parse_args",
        lambda: argparse.Namespace(
            artifact_dir=artifact_root,
            manifest_url=manifest.url,
            solution_id=None,
            force=False,
            immutable_release=True,
            reference_grid="land-solution",
            reference_raster=pin.url,
            aligned_cache=cache_dir,
        ),
    )

    builder.main()

    releases = sorted((artifact_root / "releases").iterdir())
    assert len(releases) == 1, releases
    return releases[0]


def test_land_solution_build_produces_a_loadable_artifact(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    release_dir = build_tiny_land_solution_artifact(tmp_path, monkeypatch)
    manifest = json.loads((release_dir / "manifest.json").read_text(encoding="utf-8"))

    artifact, state = load_runtime_artifact(
        Settings(
            artifact_dir=release_dir,
            artifact_manifest_path=release_dir / "manifest.json",
            artifact_required=True,
            artifact_schema_version="metrics-artifact-manifest/v1",
            solution_cache_dir=tmp_path / "solution-cache",
        )
    )
    try:
        assert state.warmup_status == "ready"
        assert state.metadata["reference_raster"]["crs"] == "EPSG:9377"
        # Gap 1: warmup used to abort here because the packaged MEC bundle was 4326.
        assert state.metadata["ecosystem_inventory"]["status"] == "ready"
        assert state.metadata["ecosystem_inventory"]["view_ids"] == [
            "biomeFamily",
            "broadBiomeContext",
            "biomeRegion",
            "broadEcosystem",
            "detailedEcosystem",
        ]
        # Gap 2: only the 9377 matrices carry area_km2, so this pins the grid too.
        assert state.metadata["species_index"]["status"] == "ready"
        assert state.metadata["species_index"]["range_area_source"] == "matrix-exact-area"
        assert artifact.ecosystem_inventory is not None
        assert artifact.mesa_coverage is not None
        assert artifact.mesa_coverage.species_target(
            "eco17_estr17_esprep17_runap_iheh2022",
            "Fixture mammals",
        ) == pytest.approx(0.5)
        assert artifact.solution_registry is not None
    finally:
        artifact.close()

    assert manifest["reference_grid"]["name"] == "land-solution"
    assert manifest["reference_grid"]["crs"] == "EPSG:9377"
    assert manifest["reference_grid"]["pin"]["valid_cell_count"] == MEC_VALID_CELLS
    assert manifest["ecosystem_inventory"]["raster"]["source_url"] == public_url(
        ECOSYSTEM_BLOB_PATHS["raster"]
    )
    assert [entry["source_url"] for entry in manifest["species_matrices"]] == [
        public_url(species_matrix_blob_path(group)) for group in builder.SPECIES_MATRIX_GROUPS
    ]
    assert manifest["mesa_coverage"]["grid"] == "EPSG:9377"
    assert manifest["mesa_coverage"]["ecosystems"]["raster_layer_id"] == (
        builder.ECOSYSTEM_LAYER_ID
    )


def test_production_runtime_rejects_land_artifact_without_v3_contract(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    release_dir = build_tiny_land_solution_artifact(tmp_path, monkeypatch)

    with pytest.raises(
        ArtifactValidationError,
        match="declare its parity contract",
    ):
        load_runtime_artifact(
            Settings(
                artifact_dir=release_dir,
                artifact_manifest_path=release_dir / "manifest.json",
                artifact_required=True,
                artifact_schema_version="metrics-artifact-manifest/v1",
                mesa_coverage_required=True,
                expected_coverage_release_id="solutions-v3-0-0",
                solution_cache_dir=tmp_path / "solution-cache",
            )
        )


def test_land_solution_pin_rejects_a_drifted_reference_raster(tmp_path: Path) -> None:
    """The land domain denominator cannot drift silently between builds."""
    published, reference = publish_both_grids(tmp_path / "published")
    assert published
    drifted = write_raster(
        tmp_path / "drifted.tif",
        np.ones((2, 3), dtype=np.uint16),
        crs="EPSG:9377",
        transform=LAND_GRID,
        nodata=0,
    )

    pin = pin_for(reference)
    pin.verify(reference, sha256=sha256_file(reference))
    with pytest.raises(builder.ReferenceRasterPinError, match="sha256"):
        pin.verify(drifted, sha256=sha256_file(drifted))


def test_legacy_4326_grid_still_resolves_its_own_published_objects() -> None:
    """The deployed backend rebuilds from these exact pathnames; leave them alone."""
    legacy_ecosystems = set(builder.ECOSYSTEM_SOURCE_URLS_BY_GRID["ecosistemas"].values())
    land_ecosystems = set(builder.ECOSYSTEM_SOURCE_URLS_BY_GRID["land-solution"].values())
    legacy_species = {spec.url for spec in builder.build_species_matrix_specs("ecosistemas")}
    land_species = {spec.url for spec in builder.build_species_matrix_specs("land-solution")}

    assert legacy_ecosystems == {
        public_url(f"inputs/features/ecosystems/ecosistemas_IDEAM_MEC_2024{suffix}")
        for suffix in (".tif", ".provenance.json")
    } | {public_url("inputs/features/ecosystems/ecosistemas_IDs_IDEAM_MEC_2024.csv")}
    assert legacy_species == {
        public_url(f"inputs/features/species-sparse/species_{group}.smtx.gz")
        for group in builder.SPECIES_MATRIX_GROUPS
    }
    assert not legacy_ecosystems & land_ecosystems
    assert not legacy_species & land_species
