from __future__ import annotations

import io
import json
import zipfile
from pathlib import Path
from typing import Any

import numpy as np
import pytest

from scripts.build_species_matrices_from_overlap import (
    CACHE_POSITIVE_AREA_EPSILON_M2,
    ConversionError,
    convert,
    grid_from_target_grid,
    index_overlap_cache,
    load_species_exception,
    read_overlap_cells,
    resolve_available_records,
)
from sparse.format import decode_species_matrix_bytes

CELL_AREA_M2 = 1_000_000.0
GRID_WIDTH = 5
GRID_HEIGHT = 4
GRID_SHAPE = (GRID_HEIGHT, GRID_WIDTH)
TARGET_GRID: dict[str, Any] = {
    "crs": "EPSG:9377",
    "height": GRID_HEIGHT,
    "transform": [1000.0, 0.0, 4331309.911856957, 0.0, -1000.0, 2933186.9308051495],
    "width": GRID_WIDTH,
}
OTHER_TARGET_GRID: dict[str, Any] = {**TARGET_GRID, "width": GRID_WIDTH + 1}

CATALOGUE = [
    ("Alpha one", "Mammalia", "LC", 2.0),
    ("Beta two", "Aves", "EN", 3.0),
    ("Gamma three", "Magnoliopsida", "VU", 1.0),
    ("Delta four", "Magnoliopsida", "NA", 4.0),
    ("Epsilon five", "Amphibia", "LC", 1.0),
    ("Zeta six", "Squamata", "CR", 2.0),
]
EXCLUDED_NAME = "Delta four"


def _write_npz(path: Path, **arrays: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(path, mode="w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name in sorted(arrays):
            buffer = io.BytesIO()
            np.lib.format.write_array(buffer, np.asarray(arrays[name]), allow_pickle=False)
            archive.writestr(f"{name}.npy", buffer.getvalue())


def write_overlap(
    cache_dir: Path,
    key: str,
    blob_filename: str,
    *,
    full_runs: list[tuple[int, int]] | None = None,
    partial: list[tuple[int, float]] | None = None,
    target_grid: dict[str, Any] | None = None,
    authoritative_area_km2: float | None = None,
) -> None:
    """Write a synthetic overlap artifact plus the manifest the converter reads."""
    full_runs = full_runs or []
    partial = partial or []
    grid = target_grid or TARGET_GRID
    directory = cache_dir / key[:2]
    _write_npz(
        directory / f"{key}.npz",
        full_run_starts=np.asarray([s for s, _ in full_runs], dtype=np.int64),
        full_run_lengths=np.asarray([n for _, n in full_runs], dtype=np.int64),
        partial_flat_indices=np.asarray([i for i, _ in partial], dtype=np.int64),
        partial_areas_m2=np.asarray([a for _, a in partial], dtype=np.float64),
        target_shape=np.asarray([grid["height"], grid["width"]], dtype=np.int64),
    )
    full_cells = sum(n for _, n in full_runs)
    exact_area_m2 = full_cells * CELL_AREA_M2 + sum(a for _, a in partial)
    manifest = {
        "format": "species-exact-overlap-v1",
        "sourceUrl": f"https://example.invalid/inputs/features/species/{blob_filename}",
        "targetGrid": grid,
        "targetGridSha256": f"sha-{grid['width']}x{grid['height']}",
        "authoritativeAreaKm2": authoritative_area_km2,
        "qa": {
            "positiveTargetCellCount": full_cells + len(partial),
            "intersectedAreaKm2": exact_area_m2 / 1_000_000.0,
        },
    }
    (directory / f"{key}.json").write_text(json.dumps(manifest), encoding="utf-8")


def write_species_csv(path: Path) -> Path:
    lines = ["scientific_name,class,iucn_status,range_km2"]
    lines += [f"{name},{cls},{iucn},{area}" for name, cls, iucn, area in CATALOGUE]
    lines.append("Some fish,Actinopteri,LC,9.0")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return path


def exception_document(excluded: list[str] | None = None) -> dict[str, Any]:
    excluded = excluded if excluded is not None else [EXCLUDED_NAME]
    entries = []
    for name in sorted(excluded):
        record = next(item for item in CATALOGUE if item[0] == name)
        entries.append(
            {
                "filename": f"{name.replace(' ', '_')}_10_MAXENT.tif",
                "scientificName": name,
                "metadataCsvRow": 1,
                "metadata": {
                    "class": record[1],
                    "iucnStatus": record[2],
                    "rangeKm2": record[3],
                },
            }
        )
    return {
        "format": "release-species-exception-v1",
        "reason": "upstream_source_missing",
        "policyId": "test-policy-v1",
        "releaseId": "test-release",
        "catalogVersion": "0.0.0",
        "approval": {"approved": True, "approvedAt": "2026-08-07", "context": "test"},
        "patchResolution": {"required": True, "wildcardSkipAllowed": False},
        "inventory": {
            "catalogTotal": len(CATALOGUE),
            "availableExpected": len(CATALOGUE) - len(entries),
            "excluded": len(entries),
        },
        "excludedSpecies": entries,
    }


def write_exception(path: Path, document: dict[str, Any] | None = None) -> Path:
    path.write_text(json.dumps(document or exception_document()), encoding="utf-8")
    return path


def build_standard_cache(cache_dir: Path) -> None:
    """One species per taxonomic group; the excluded plant has no cache entry."""
    write_overlap(
        cache_dir,
        "aa" + "0" * 62,
        "Alpha_one_10_MAXENT.tif",
        full_runs=[(0, 2)],
        partial=[(7, 250_000.0)],
        authoritative_area_km2=2.25,
    )
    write_overlap(
        cache_dir,
        "bb" + "0" * 62,
        "Beta_two_10_MAXENT.tif",
        full_runs=[(10, 3)],
        authoritative_area_km2=3.0,
    )
    write_overlap(
        cache_dir,
        "cc" + "0" * 62,
        "Gamma_three_10_MAXENT.tif",
        partial=[(4, 900_000.0), (19, 100_000.0)],
        authoritative_area_km2=1.0,
    )
    write_overlap(
        cache_dir,
        "e5" + "0" * 62,
        "Epsilon_five_10_MAXENT.tif",
        full_runs=[(5, 1)],
        authoritative_area_km2=1.0,
    )
    write_overlap(
        cache_dir,
        "z6" + "0" * 62,
        "Zeta_six_10_MAXENT.tif",
        full_runs=[(14, 2)],
        authoritative_area_km2=2.0,
    )


def run_convert(
    tmp_path: Path,
    *,
    cache_dir: Path | None = None,
    exception_path: Path | None = None,
    species_csv: Path | None = None,
    **overrides: Any,
) -> dict[str, Any]:
    if cache_dir is None:
        cache_dir = tmp_path / "species-overlap"
        build_standard_cache(cache_dir)
    if exception_path is None:
        exception_path = write_exception(tmp_path / "species-exception.json")
    if species_csv is None:
        species_csv = write_species_csv(tmp_path / "species.csv")
    kwargs: dict[str, Any] = {
        "cache_dir": cache_dir,
        "exception_path": exception_path,
        "species_csv": species_csv,
        "output_dir": tmp_path / "matrices",
        "min_overlap_m2": CACHE_POSITIVE_AREA_EPSILON_M2,
        "groups": ("mammals", "birds", "amphibians", "reptiles", "plants", "threatened"),
    }
    kwargs.update(overrides)
    return convert(**kwargs)


def test_synthetic_overlap_round_trips_into_group_matrices(tmp_path: Path) -> None:
    report = run_convert(tmp_path)

    assert report["species_available"] == 5
    matrices = tmp_path / "matrices"
    decoded = decode_species_matrix_bytes((matrices / "species_mammals.smtx.gz").read_bytes())

    assert decoded.grid_raw == {
        "width": GRID_WIDTH,
        "height": GRID_HEIGHT,
        "xOrigin": 4331309.911856957,
        "yOrigin": 2933186.9308051495,
        "xScale": 1000.0,
        "yScale": -1000.0,
        "nodata": 255.0,
        "crs": "EPSG:9377",
    }
    assert [entry.name for entry in decoded.entries] == ["Alpha one"]
    entry = decoded.entries[0]
    assert entry.cell_ids.dtype == np.uint32
    assert entry.cell_ids.tolist() == [0, 1, 7]
    assert entry.iucn == "LC"
    assert entry.csv_class == "Mammalia"


def test_group_membership_and_threatened_union(tmp_path: Path) -> None:
    report = run_convert(tmp_path)
    matrices = tmp_path / "matrices"

    def names(group: str) -> list[str]:
        blob = (matrices / f"species_{group}.smtx.gz").read_bytes()
        return [entry.name for entry in decode_species_matrix_bytes(blob).entries]

    assert names("mammals") == ["Alpha one"]
    assert names("birds") == ["Beta two"]
    assert names("plants") == ["Gamma three"]
    assert names("amphibians") == ["Epsilon five"]
    assert names("reptiles") == ["Zeta six"]
    assert names("threatened") == ["Beta two", "Gamma three", "Zeta six"]
    assert report["groups"]["threatened"]["species_count"] == 3
    assert report["groups"]["plants"]["cell_references"] == 2


def test_zero_cell_species_is_preserved_as_an_empty_entry(tmp_path: Path) -> None:
    cache_dir = tmp_path / "species-overlap"
    build_standard_cache(cache_dir)
    # Replace the mammal with a genuinely empty range.
    write_overlap(cache_dir, "aa" + "0" * 62, "Alpha_one_10_MAXENT.tif", authoritative_area_km2=0.0)

    run_convert(tmp_path, cache_dir=cache_dir)

    blob = (tmp_path / "matrices" / "species_mammals.smtx.gz").read_bytes()
    decoded = decode_species_matrix_bytes(blob)
    assert decoded.entries[0].cell_ids.size == 0


def test_repeated_runs_are_byte_identical(tmp_path: Path) -> None:
    run_convert(tmp_path, output_dir=tmp_path / "first")
    run_convert(tmp_path, output_dir=tmp_path / "second")

    for group in ("mammals", "birds", "amphibians", "reptiles", "plants", "threatened"):
        name = f"species_{group}.smtx.gz"
        assert (tmp_path / "first" / name).read_bytes() == (tmp_path / "second" / name).read_bytes()


@pytest.mark.parametrize(
    ("threshold_m2", "expected_cells"),
    [
        (CACHE_POSITIVE_AREA_EPSILON_M2, [0, 1, 7]),
        (249_999.0, [0, 1, 7]),
        (250_000.0, [0, 1]),
        (250_001.0, [0, 1]),
    ],
)
def test_threshold_is_strictly_greater_than_boundary(
    tmp_path: Path, threshold_m2: float, expected_cells: list[int]
) -> None:
    cache_dir = tmp_path / "species-overlap"
    build_standard_cache(cache_dir)

    cells, exact_area_km2 = read_overlap_cells(
        cache_dir / "aa" / ("aa" + "0" * 62 + ".npz"),
        grid_shape=GRID_SHAPE,
        min_overlap_m2=threshold_m2,
        cell_area_m2=CELL_AREA_M2,
    )

    assert cells.tolist() == expected_cells
    assert exact_area_km2 == pytest.approx(2.25)


def test_default_threshold_keeps_every_cell_the_cache_recorded(tmp_path: Path) -> None:
    cache_dir = tmp_path / "species-overlap"
    write_overlap(
        cache_dir,
        "dd" + "0" * 62,
        "Alpha_one_10_MAXENT.tif",
        partial=[(3, 1e-9), (8, 2e-10)],
    )

    cells, _ = read_overlap_cells(
        cache_dir / "dd" / ("dd" + "0" * 62 + ".npz"),
        grid_shape=GRID_SHAPE,
        min_overlap_m2=CACHE_POSITIVE_AREA_EPSILON_M2,
        cell_area_m2=CELL_AREA_M2,
    )

    assert cells.tolist() == [3, 8]


def test_sub_epsilon_area_is_rejected(tmp_path: Path) -> None:
    cache_dir = tmp_path / "species-overlap"
    write_overlap(
        cache_dir,
        "ee" + "0" * 62,
        "Alpha_one_10_MAXENT.tif",
        partial=[(3, CACHE_POSITIVE_AREA_EPSILON_M2 / 2)],
    )

    with pytest.raises(ConversionError, match="sub-epsilon"):
        read_overlap_cells(
            cache_dir / "ee" / ("ee" + "0" * 62 + ".npz"),
            grid_shape=GRID_SHAPE,
            min_overlap_m2=CACHE_POSITIVE_AREA_EPSILON_M2,
            cell_area_m2=CELL_AREA_M2,
        )


def test_mixed_target_grids_fail_closed(tmp_path: Path) -> None:
    cache_dir = tmp_path / "species-overlap"
    build_standard_cache(cache_dir)
    write_overlap(
        cache_dir,
        "bb" + "0" * 62,
        "Beta_two_10_MAXENT.tif",
        full_runs=[(10, 3)],
        target_grid=OTHER_TARGET_GRID,
        authoritative_area_km2=3.0,
    )

    with pytest.raises(ConversionError, match="refusing to mix grids"):
        index_overlap_cache(cache_dir)


def test_artifact_grid_shape_mismatch_fails_closed(tmp_path: Path) -> None:
    cache_dir = tmp_path / "species-overlap"
    write_overlap(cache_dir, "ff" + "0" * 62, "Alpha_one_10_MAXENT.tif", full_runs=[(0, 2)])

    with pytest.raises(ConversionError, match="expected"):
        read_overlap_cells(
            cache_dir / "ff" / ("ff" + "0" * 62 + ".npz"),
            grid_shape=(GRID_HEIGHT + 1, GRID_WIDTH),
            min_overlap_m2=CACHE_POSITIVE_AREA_EPSILON_M2,
            cell_area_m2=CELL_AREA_M2,
        )


def test_rotated_target_grid_is_rejected() -> None:
    rotated = {**TARGET_GRID, "transform": [1000.0, 5.0, 0.0, 0.0, -1000.0, 0.0]}

    with pytest.raises(ConversionError, match="north-up"):
        grid_from_target_grid(rotated)


def test_missing_species_outside_the_exception_fails_closed(tmp_path: Path) -> None:
    cache_dir = tmp_path / "species-overlap"
    build_standard_cache(cache_dir)
    for suffix in (".npz", ".json"):
        (cache_dir / "bb" / ("bb" + "0" * 62 + suffix)).unlink()

    with pytest.raises(ConversionError, match="not covered by the exception"):
        run_convert(tmp_path, cache_dir=cache_dir)


def test_exception_covers_the_absent_species(tmp_path: Path) -> None:
    report = run_convert(tmp_path)

    assert report["species_exception"]["excluded"] == ["Delta_four_10_MAXENT.tif"]
    blob = (tmp_path / "matrices" / "species_plants.smtx.gz").read_bytes()
    assert [entry.name for entry in decode_species_matrix_bytes(blob).entries] == ["Gamma three"]


def test_cache_species_outside_the_catalogue_fails_closed(tmp_path: Path) -> None:
    cache_dir = tmp_path / "species-overlap"
    build_standard_cache(cache_dir)
    write_overlap(cache_dir, "9a" + "0" * 62, "Unknown_species_10_MAXENT.tif", full_runs=[(0, 1)])

    with pytest.raises(ConversionError, match="outside the catalogue"):
        run_convert(tmp_path, cache_dir=cache_dir)


def test_exception_metadata_drift_fails_closed(tmp_path: Path) -> None:
    document = exception_document()
    document["excludedSpecies"][0]["metadata"]["rangeKm2"] = 999.0

    with pytest.raises(ConversionError, match="metadata drifted"):
        run_convert(
            tmp_path,
            exception_path=write_exception(tmp_path / "drifted.json", document),
        )


def test_exception_permitting_wildcard_skip_is_rejected(tmp_path: Path) -> None:
    document = exception_document()
    document["patchResolution"]["wildcardSkipAllowed"] = True
    path = write_exception(tmp_path / "wildcard.json", document)

    with pytest.raises(ConversionError, match="wildcard"):
        load_species_exception(path)


def test_unapproved_exception_is_rejected(tmp_path: Path) -> None:
    document = exception_document()
    document["approval"]["approved"] = False
    path = write_exception(tmp_path / "unapproved.json", document)

    with pytest.raises(ConversionError, match="approval"):
        load_species_exception(path)


def test_inconsistent_inventory_is_rejected(tmp_path: Path) -> None:
    document = exception_document()
    document["inventory"]["availableExpected"] = 99
    path = write_exception(tmp_path / "inconsistent.json", document)

    with pytest.raises(ConversionError, match="self-consistent"):
        load_species_exception(path)


def test_unsorted_exception_filenames_are_rejected(tmp_path: Path) -> None:
    document = exception_document(excluded=["Gamma three", "Delta four"])
    document["excludedSpecies"].reverse()
    path = write_exception(tmp_path / "unsorted.json", document)

    with pytest.raises(ConversionError, match="unique and sorted"):
        load_species_exception(path)


def test_pinned_inventory_totals_reject_a_tampered_contract(tmp_path: Path) -> None:
    document = exception_document(excluded=["Gamma three", "Delta four"])
    path = write_exception(tmp_path / "widened.json", document)
    exception = load_species_exception(path)
    records = _catalogue_records(tmp_path)

    with pytest.raises(ConversionError, match="pinned"):
        resolve_available_records(
            records,
            exception,
            ["Alpha_one_10_MAXENT.tif", "Beta_two_10_MAXENT.tif"],
            expect_available=len(CATALOGUE) - 1,
        )


def test_unmapped_taxonomic_class_fails_closed(tmp_path: Path) -> None:
    csv_path = tmp_path / "species.csv"
    rows = [
        f"{name},{'Insecta' if name == 'Gamma three' else cls},{iucn},{area}"
        for name, cls, iucn, area in CATALOGUE
    ]
    csv_path.write_text(
        "scientific_name,class,iucn_status,range_km2\n" + "\n".join(rows) + "\n",
        encoding="utf-8",
    )

    with pytest.raises(ConversionError, match="no taxonomic group"):
        run_convert(tmp_path, species_csv=csv_path)


def _catalogue_records(tmp_path: Path):
    from species_data import load_species_records

    return load_species_records(write_species_csv(tmp_path / "catalogue.csv"))
