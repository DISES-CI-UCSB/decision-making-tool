import copy
import hashlib

import numpy as np
import pytest

import main as pipeline
from blob_manifest import (
    ManifestError,
    ResolvedManifest,
    regional_packet_identity,
    resolve_solution_layer,
)
from boundaries.boundary_topology import ExclusiveBoundaryIndex
from metrics_contract import PROVENANCE_KEY, build_metrics_provenance, provenance_issues
from solution_input_signature import canonical_sha256
from sirap_packet import (
    read_summary,
    regional_species_accumulator,
    regional_species_richness,
)
from sparse.format import SparseMetadata, SpeciesMatrixEntry, encode_species_matrix
from species_target_policy import SpeciesTargetPolicy
from helpers import raster_from_fixture
from metric_definitions import computable_metrics
from calculators.species import SpeciesPoolSizes, SpeciesScopeCounts, SpeciesScopeMetrics


def _sirap_solution(region_id: str = "eje-cafetero") -> dict:
    return {
        "id": f"{region_id}-solution",
        "scope": "sirap",
        "sirapId": region_id,
        "regionalInputPacket": {
            "format": "sirap-metric-input-packet-v1",
            "regionId": region_id,
            "grid": {"sha256": "a" * 64},
            "authoritativeSummary": {
                "url": "https://packets.test/summary.csv",
                "sha256": "b" * 64,
                "schema": "prioritizr-summary-v1",
            },
            "layers": {
                "wetlands": {
                    "url": "https://packets.test/humedales_EC.tif",
                    "sha256": "c" * 64,
                    "rendering": {"valueType": "binary", "selectedValue": 1},
                }
            },
            "species": {
                "universePolicy": "regional-summary",
                "matrices": [
                    {
                        "taxonomicClass": "Plantae",
                        "format": "smsp-v1",
                        "url": "https://packets.test/plants.smsp.gz",
                        "sha256": "d" * 64,
                        "gridSha256": "a" * 64,
                    }
                ],
            },
        },
    }


@pytest.fixture
def manifest() -> ResolvedManifest:
    return ResolvedManifest(
        url="https://manifest.test/manifest.json",
        raw={},
        public_blob_host="https://manifest.test",
        layers_by_id={
            "wetlands": {
                "id": "wetlands",
                "displayUrl": "https://national.test/wetlands.tif",
            }
        },
        national_solutions=[],
    )


def test_sirap_wetlands_binding_overrides_national_layer(manifest: ResolvedManifest):
    binding = resolve_solution_layer(manifest, _sirap_solution(), "wetlands")

    assert binding["url"].endswith("/humedales_EC.tif")
    assert binding["sha256"] == "c" * 64


def test_sirap_missing_layer_fails_closed_without_national_fallback(
    manifest: ResolvedManifest,
):
    with pytest.raises(ManifestError, match="national sources are forbidden"):
        resolve_solution_layer(manifest, _sirap_solution(), "carbon")


def test_national_solution_keeps_manifest_layer_resolution(manifest: ResolvedManifest):
    binding = resolve_solution_layer(manifest, {"id": "national"}, "wetlands")

    assert binding["displayUrl"] == "https://national.test/wetlands.tif"


def test_sirap_known_missing_inputs_are_explicitly_blocked():
    overrides = pipeline._sirap_missing_input_metric_overrides()

    expected_ids = {
        "species_groups_protected",
        "threatened_species_secured",
        "carbon_storage_biomass",
        "agricultural_area",
        "national_contribution",
        "threatened_species_count",
        "species_pct_of_national",
        "mangrove_coverage",
        "carbon_biomass_total",
        "soil_organic_carbon",
        "carbon_pct_of_national",
        "land_use_forests_and_semi_natural_areas_pct",
        "land_use_agricultural_areas_pct",
        "land_use_artificial_surfaces_pct",
        "land_use_wetlands_pct",
        "land_use_water_bodies_pct",
        "national_parks_pct",
    }

    assert set(overrides) == expected_ids
    assert all(metric["status"] == "blocked" for metric in overrides.values())
    assert all(metric["value"] is None for metric in overrides.values())
    assert all(
        metric["source"] == "regionalInputPacket.missingInputAuthority"
        for metric in overrides.values()
    )
    assert all(metric["notes"] for metric in overrides.values())


def test_complete_regional_smsp_keeps_all_richness_metrics_ready():
    counts = SpeciesScopeCounts(
        by_bucket={
            "mammals": 11,
            "birds": 22,
            "amphibians": 33,
            "reptiles": 44,
            "plants": 55,
        }
    )
    metrics = SpeciesScopeMetrics.from_counts(
        counts,
        SpeciesPoolSizes(
            by_bucket={
                "mammals": 256,
                "birds": 1552,
                "amphibians": 184,
                "reptiles": 160,
                "plants": 6148,
            },
            total_non_fish=8300,
            threatened_total=213,
        ),
    )
    richness_definitions = [
        definition
        for definition in computable_metrics()
        if definition.kind == "species_richness"
    ]

    results = [
        pipeline._compute_species_metric(
            definition,
            metrics,
            SpeciesTargetPolicy("scalar", 17.0, {}, None),
        )
        for definition in richness_definitions
    ]

    assert [result["status"] for result in results] == ["ready"] * 5
    assert [result["value"] for result in results] == [11, 22, 33, 44, 55]


def test_packet_identity_changes_with_region_grid_or_layer_checksum():
    eje = _sirap_solution("eje-cafetero")
    orinoquia = copy.deepcopy(eje)
    orinoquia["sirapId"] = "orinoquia"
    orinoquia["regionalInputPacket"]["regionId"] = "orinoquia"
    orinoquia["regionalInputPacket"]["grid"]["sha256"] = "e" * 64
    orinoquia["regionalInputPacket"]["layers"]["wetlands"]["sha256"] = "f" * 64

    assert canonical_sha256(regional_packet_identity(eje)) != canonical_sha256(
        regional_packet_identity(orinoquia)
    )


def test_sirap_provenance_omits_unused_national_species_csv():
    provenance = build_metrics_provenance(
        "land",
        regional_packet=True,
        species_csv_url="https://national.test/species.csv",
    )

    assert provenance["generationConfig"]["regionalPacket"] is True
    assert provenance["generationConfig"]["speciesCsvUrl"] is None
    assert provenance_issues({PROVENANCE_KEY: provenance}) == []


def test_national_only_provenance_keeps_national_sources():
    provenance = build_metrics_provenance(
        "land",
        national_only=True,
        species_csv_url="https://national.test/species.csv",
    )

    assert provenance["generationConfig"]["regionalPacket"] is False
    assert provenance["generationConfig"]["speciesCsvUrl"] == "https://national.test/species.csv"
    assert provenance["boundaryProvenance"]["sources"]
    assert provenance_issues({PROVENANCE_KEY: provenance}) == []


def test_packet_summary_is_parsed_from_its_pinned_csv(tmp_path):
    summary = tmp_path / "summary.csv"
    summary.write_text(
        "feature,met,relative_target\nwetlands,TRUE,0.7\nforest,FALSE,0.5\nposthoc,NA,NA\n",
        encoding="utf-8",
    )
    binding = {
        "url": summary.as_uri(),
        "sha256": hashlib.sha256(summary.read_bytes()).hexdigest(),
    }

    parsed, download = read_summary(binding, tmp_path / "cache", force=False)

    assert parsed.targets_met_pct == 50
    assert download.sha256 == binding["sha256"]


def test_packet_summary_rejects_checksum_mismatch(tmp_path):
    summary = tmp_path / "summary.csv"
    summary.write_text("feature,met,relative_target\nwetlands,TRUE,0.7\n", encoding="utf-8")

    with pytest.raises(Exception, match="checksum mismatch"):
        read_summary({"url": summary.as_uri(), "sha256": "0" * 64}, tmp_path, force=False)


def test_packet_smsp_counts_declared_class_and_leaves_missing_class_absent(tmp_path):
    raster = raster_from_fixture(
        {"shape": [2, 2], "pixel_area_km2": 1, "selected": [[True, False], [False, True]], "valid": [[True, True], [True, True]]}
    )
    metadata = SparseMetadata(
        width=2,
        height=2,
        x_origin=0,
        y_origin=2,
        x_scale=1,
        y_scale=-1,
        nodata=None,
        crs="EPSG:32618",
        count=1,
        transform=(1, 0, 0, 0, -1, 2),
    )
    encoded = encode_species_matrix(
        [
            SpeciesMatrixEntry(
                name="Unspecified mammal",
                iucn="",
                csv_class="Mammalia",
                cell_ids=np.array([0], dtype=np.uint32),
                metadata=metadata,
            )
        ]
    )
    matrix = tmp_path / "mammals.smsp.gz"
    matrix.write_bytes(encoded)
    binding = {
        "taxonomicClass": "Mammalia",
        "format": "smsp-v1",
        "url": matrix.as_uri(),
        "sha256": hashlib.sha256(encoded).hexdigest(),
        "gridSha256": "a" * 64,
    }

    counts, provenance = regional_species_richness(
        [binding], raster, "a" * 64, tmp_path / "cache", force=False
    )

    assert counts["mammals"] == 1
    assert counts["plants"] == 0
    assert provenance == [
        {
            "taxonomicClass": "Mammalia",
            "url": matrix.as_uri(),
            "sha256": binding["sha256"],
        }
    ]


def test_packet_smsp_fans_out_scope_presence_and_coverage(tmp_path):
    raster = raster_from_fixture(
        {
            "shape": [2, 2],
            "pixel_area_km2": 1,
            "selected": [[True, False], [False, True]],
            "valid": [[True, True], [True, True]],
        }
    )
    metadata = SparseMetadata(
        width=2,
        height=2,
        x_origin=0,
        y_origin=2,
        x_scale=1,
        y_scale=-1,
        nodata=None,
        crs="EPSG:32618",
        count=1,
        transform=(1, 0, 0, 0, -1, 2),
    )
    encoded = encode_species_matrix(
        [
            SpeciesMatrixEntry(
                name="Test species",
                iucn="EN",
                csv_class="Mammalia",
                cell_ids=np.array([0, 1], dtype=np.uint32),
                metadata=metadata,
            )
        ]
    )
    matrix = tmp_path / "mammals.smsp.gz"
    matrix.write_bytes(encoded)
    binding = {
        "taxonomicClass": "Mammalia",
        "format": "smsp-v1",
        "url": matrix.as_uri(),
        "sha256": hashlib.sha256(encoded).hexdigest(),
        "gridSha256": "a" * 64,
    }
    owners = np.array([0, 1, 0, 1], dtype=np.int32)
    boundary_index = ExclusiveBoundaryIndex(
        level="departments",
        boundary_ids=("left", "right"),
        boundary_names=("Left", "Right"),
        boundary_provenance=(),
        total_claims=4,
        claimed_pixels=4,
        overlap_pixels=0,
        max_multiplicity=1,
        estimated_bytes=owners.nbytes,
        estimated_peak_build_bytes=owners.nbytes,
        flat=owners,
    )

    accumulator, _ = regional_species_accumulator(
        [binding],
        raster,
        "a" * 64,
        {"departments": boundary_index},
        tmp_path / "cache",
        force=False,
        target_policy=SpeciesTargetPolicy("scalar", 50.0, {}, None),
    )

    assert accumulator.national.by_bucket["mammals"] == 1
    assert accumulator.sub["departments"][0].by_bucket["mammals"] == 1
    assert accumulator.sub["departments"][1].by_bucket["mammals"] == 0
    assert accumulator.sub["departments"][0].threatened_secured == 1
    assert accumulator.sub["departments"][0].coverage_by_bucket["mammals"].met == 1


def test_packet_smsp_rejects_checksum_mismatch(tmp_path):
    raster = raster_from_fixture(
        {
            "shape": [2, 2],
            "pixel_area_km2": 1,
            "selected": [[True, False], [False, True]],
            "valid": [[True, True], [True, True]],
        }
    )
    metadata = SparseMetadata(
        width=2,
        height=2,
        x_origin=0,
        y_origin=2,
        x_scale=1,
        y_scale=-1,
        nodata=None,
        crs="EPSG:32618",
        count=1,
        transform=(1, 0, 0, 0, -1, 2),
    )
    matrix = tmp_path / "mammals.smsp.gz"
    matrix.write_bytes(
        encode_species_matrix(
            [
                SpeciesMatrixEntry(
                    name="Unspecified mammal",
                    iucn="",
                    csv_class="Mammalia",
                    cell_ids=np.array([0], dtype=np.uint32),
                    metadata=metadata,
                )
            ]
        )
    )

    with pytest.raises(Exception, match="checksum mismatch"):
        regional_species_richness(
            [
                {
                    "taxonomicClass": "Mammalia",
                    "format": "smsp-v1",
                    "url": matrix.as_uri(),
                    "sha256": "0" * 64,
                    "gridSha256": "a" * 64,
                }
            ],
            raster,
            "a" * 64,
            tmp_path / "cache",
            force=False,
        )
