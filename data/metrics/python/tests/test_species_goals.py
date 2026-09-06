import hashlib
import json
import sqlite3
from pathlib import Path

import numpy as np
import pytest
from calculators.species import SpeciesAccumulator
from repair_species_goals_targets import (
    load_summary_targets,
    repair_compact_document,
)
from species_data import SpeciesPoolSizes, SpeciesRecord
from species_goals import (
    FLAG_CONFIGURED_TARGET_MET,
    FLAG_MET_17,
    FLAG_MET_30,
    FLAG_NO_RANGE,
    FLAG_TARGET_CONFIGURED,
    FLAG_UNAVAILABLE,
    ProvenanceMismatchError,
    SpeciesGoalsPipeline,
    build_catalog,
    canonical_sha256,
    catalog_path,
    compact_partition_path,
    partition_is_resumable,
    validate_compact,
    write_release_inventory,
)
from species_target_policy import SpeciesTargetPolicy

SHA_A = "a" * 64
SHA_B = "b" * 64


def _species(name: str, range_km2: float | None = 1.0) -> SpeciesRecord:
    return SpeciesRecord(name, "Aves", "EN", range_km2, "birds", True)


def _catalog(
    records: list[SpeciesRecord], unavailable: set[str] | None = None
) -> dict:
    unavailable = unavailable or set()
    return build_catalog(
        records,
        unavailable_species_ids=unavailable,
        provenance={
            "releaseId": "fixture-release",
            "speciesCsvSha256": SHA_A,
            "exceptionSourceSha256": SHA_B if unavailable else None,
            "exceptionPolicySha256": SHA_B if unavailable else None,
            "exceptionBindingSha256": SHA_B if unavailable else None,
            "inventory": {
                "catalogTotal": len(records),
                "unavailable": len(unavailable),
                "zeroRange": sum(
                    record.range_km2 == 0
                    and record.filename_stem.lower() not in unavailable
                    for record in records
                ),
            },
        },
    )


def _pipeline(
    catalog: dict,
    tmp_path: Path,
    *,
    raster_sha256: str = SHA_A,
    policy: SpeciesTargetPolicy | None = None,
    active_levels: set[str] | None = None,
    primary_geography_level: str = "national",
) -> SpeciesGoalsPipeline:
    return SpeciesGoalsPipeline(
        catalog,
        solution_id="fixture-solution",
        target_policy=policy
        or SpeciesTargetPolicy("scalar", 30.0, {}, None),
        provenance={
            "releaseId": "fixture-release",
            "speciesCsvSha256": SHA_A,
            "exceptionSourceSha256": catalog["provenance"][
                "exceptionSourceSha256"
            ],
            "exceptionPolicySha256": catalog["provenance"][
                "exceptionPolicySha256"
            ],
            "exceptionBindingSha256": catalog["provenance"][
                "exceptionBindingSha256"
            ],
            "exactOverlapAlgorithmVersion": "fixture-exact-v1",
            "exactOverlapPolicySha256": SHA_A,
            "targetGridSha256": SHA_A,
            "speciesAlignmentInventorySha256": SHA_A,
            "solutionRasterSha256": raster_sha256,
            "targetPolicySha256": SHA_A,
            "boundaryProvenanceSha256": SHA_B,
            "catalogSha256": catalog["catalogSha256"],
        },
        spool_dir=tmp_path / "spool",
        active_levels=active_levels,
        primary_geography_level=primary_geography_level,
    )


def test_national_dense_rows_encode_unavailable_no_range_and_threshold_flags(
    tmp_path: Path,
):
    records = [_species("Available"), _species("No range", 0), _species("Unavailable")]
    catalog = _catalog(records, {"unavailable"})
    pipeline = _pipeline(catalog, tmp_path)
    pipeline.record_national(records[0], 400_000, 1_000_000)
    pipeline.record_national(records[1], 0, 0)

    document = pipeline.build_partition(
        geography_level="national",
        scope_catalog=[["colombia", "Colombia"]],
        generated_at="2026-08-08T00:00:00+00:00",
    )

    rows = {catalog["rows"][row[1]][1]: row for row in document["rows"]}
    assert rows["Unavailable"][2:] == [
        None,
        None,
        None,
        None,
        None,
        FLAG_UNAVAILABLE,
    ]
    assert rows["No range"][7] == FLAG_NO_RANGE | FLAG_TARGET_CONFIGURED
    assert rows["Available"][7] == (
        FLAG_TARGET_CONFIGURED
        | FLAG_MET_17
        | FLAG_MET_30
        | FLAG_CONFIGURED_TARGET_MET
    )
    validate_compact(document, catalog=catalog)


def test_sirap_primary_scope_uses_regional_sparse_partition(tmp_path: Path):
    records = [_species("Regional species"), _species("Outside region", 0)]
    catalog = _catalog(records)
    pipeline = _pipeline(
        catalog,
        tmp_path,
        active_levels={"siraps"},
        primary_geography_level="siraps",
    )
    pipeline.record_national(
        records[0],
        400_000,
        1_000_000,
        pre_existing_area_m2=100_000,
        new_prioritizr_area_m2=300_000,
    )
    pipeline.record_national(records[1], 0, 0)

    document = pipeline.build_partition(
        geography_level="siraps",
        scope_catalog=[["eje-cafetero", "Eje Cafetero"]],
    )

    assert document["encoding"] == "sparse-no-range-omitted"
    assert document["scopeCatalog"] == [["eje-cafetero", "Eje Cafetero"]]
    assert len(document["rows"]) == 1
    assert document["rows"][0][2:6] == [1.0, 0.4, 0.1, 0.3]
    assert document["rows"][0][7] & FLAG_MET_30


def test_per_species_configured_target_and_subnational_sparse_encoding(tmp_path: Path):
    records = [_species("Low target"), _species("High target")]
    catalog = _catalog(records)
    policy = SpeciesTargetPolicy(
        "per_species",
        None,
        {"low_target": 20.0, "high_target": 80.0},
        {"source": "fixture"},
    )
    pipeline = _pipeline(catalog, tmp_path, policy=policy)
    pipeline.record_sub_level(
        records[0],
        "departments",
        np.array([50.0, 0.0]),
        np.array([100.0, 0.0]),
    )
    pipeline.record_sub_level(
        records[1],
        "departments",
        np.array([50.0, 0.0]),
        np.array([100.0, 0.0]),
    )

    document = pipeline.build_partition(
        geography_level="departments",
        scope_catalog=[["05", "Antioquia"], ["08", "Atlántico"]],
    )

    assert len(document["rows"]) == 2
    assert {row[0] for row in document["rows"]} == {0}
    rows_by_target = {row[6]: row for row in document["rows"]}
    low = rows_by_target[20.0]
    high = rows_by_target[80.0]
    assert low[6] == 20.0
    assert low[7] & FLAG_CONFIGURED_TARGET_MET
    assert high[6] == 80.0
    assert not high[7] & FLAG_CONFIGURED_TARGET_MET


def test_serialized_measures_preserve_additivity_and_omit_rounded_zero_ranges(
    tmp_path: Path,
):
    records = [_species("Rounded"), _species("Rounded zero")]
    catalog = _catalog(records)
    pipeline = _pipeline(catalog, tmp_path)
    pipeline.record_sub_level(
        records[0],
        "departments",
        np.array([1.2]),
        np.array([1.4]),
        pre_existing_per_boundary=np.array([0.6]),
        new_prioritizr_per_boundary=np.array([0.6]),
    )
    pipeline.record_sub_level(
        records[1],
        "departments",
        np.array([0.0]),
        np.array([0.4]),
    )

    document = pipeline.build_partition(
        geography_level="departments",
        scope_catalog=[["05", "Antioquia"]],
    )

    assert len(document["rows"]) == 1
    row = document["rows"][0]
    assert row[2:6] == [0.000002, 0.000002, 0.000001, 0.000001]
    validate_compact(document, catalog=catalog)


def test_accumulator_streams_exact_observations_to_pipeline(tmp_path: Path):
    record = _species("Streamed")
    catalog = _catalog([record])
    pipeline = _pipeline(catalog, tmp_path)
    accumulator = SpeciesAccumulator(
        target_pct=30,
        pool_sizes=SpeciesPoolSizes(
            total_non_fish=1,
            threatened_total=1,
            by_bucket={
                "mammals": 0,
                "birds": 1,
                "amphibians": 0,
                "reptiles": 0,
                "plants": 0,
            },
        ),
        detail_sink=pipeline,
    )
    accumulator.init_sub({"departments": 1})
    accumulator.record_species_national(record, 25.0, 100.0)
    accumulator.record_species_sub_level(
        record, "departments", np.array([25.0]), np.array([100.0])
    )

    national = pipeline.build_partition(
        geography_level="national",
        scope_catalog=[["colombia", "Colombia"]],
    )
    departments = pipeline.build_partition(
        geography_level="departments",
        scope_catalog=[["05", "Antioquia"]],
    )
    assert national["rows"][0][2:4] == [0.0001, 0.000025]
    assert departments["rows"][0][2:4] == [0.0001, 0.000025]


def test_buffered_chunk_rolls_back_partial_executemany_and_replays_idempotently(
    tmp_path: Path,
):
    records = [_species("First"), _species("Second")]
    pipeline = _pipeline(_catalog(records), tmp_path)
    connection = pipeline._connection

    class PartialExecutemanyFailure:
        def execute(self, *args, **kwargs):
            return connection.execute(*args, **kwargs)

        def executemany(self, statement, rows):
            connection.execute(statement, rows[0])
            raise sqlite3.OperationalError("injected partial executemany failure")

        def __getattr__(self, name):
            return getattr(connection, name)

    pipeline._connection = PartialExecutemanyFailure()
    chunk_args = (
        records,
        np.array([10.0, 20.0]),
        np.array([100.0, 100.0]),
        np.array([0.0, 0.0]),
        np.array([10.0, 20.0]),
        {},
    )

    with pytest.raises(sqlite3.OperationalError, match="injected partial"):
        pipeline.record_species_chunk(*chunk_args)
    assert connection.execute("SELECT COUNT(*) FROM observations").fetchone()[0] == 0

    pipeline._connection = connection
    pipeline.record_species_chunk(*chunk_args)
    pipeline.record_species_chunk(*chunk_args)
    rows = connection.execute(
        """
        SELECT species_index, selected_area_m2
        FROM observations
        ORDER BY species_index
        """
    ).fetchall()
    assert rows == [(0, 10.0), (1, 20.0)]


def test_pipeline_post_close_cleanup_failure_is_not_retried(
    monkeypatch,
    tmp_path: Path,
):
    record = _species("Close once")
    pipeline = _pipeline(_catalog([record]), tmp_path)
    pipeline.record_national(record, 10.0, 100.0)
    original_unlink = Path.unlink
    unlink_calls = 0

    def fail_spool_unlink(path, *args, **kwargs):
        nonlocal unlink_calls
        if path == pipeline.spool_path:
            unlink_calls += 1
            raise RuntimeError("injected post-close cleanup failure")
        return original_unlink(path, *args, **kwargs)

    with monkeypatch.context() as context:
        context.setattr(Path, "unlink", fail_spool_unlink)
        with pytest.raises(RuntimeError, match="post-close cleanup failure"):
            pipeline.close()
        pipeline.close()

    assert pipeline.closed
    assert unlink_calls == 1
    original_unlink(pipeline.spool_path, missing_ok=True)


def test_completed_partition_resumes_and_rejects_provenance_mismatch(tmp_path: Path):
    record = _species("Resume")
    catalog = _catalog([record])
    path = tmp_path / "fixture.species-goals.compact.json"
    first = _pipeline(catalog, tmp_path)
    first.record_national(record, 30, 100)

    written, resumed = first.write_partition(
        path,
        geography_level="national",
        scope_catalog=[["colombia", "Colombia"]],
        generated_at="2026-08-08T00:00:00+00:00",
    )
    assert not resumed
    assert json.loads(path.read_text()) == written

    replay, resumed = first.write_partition(
        path,
        geography_level="national",
        scope_catalog=[["colombia", "Colombia"]],
        generated_at="2026-08-09T00:00:00+00:00",
    )
    assert resumed
    assert replay == written

    changed = _pipeline(catalog, tmp_path / "changed", raster_sha256=SHA_B)
    changed.record_national(record, 30, 100)
    with pytest.raises(ProvenanceMismatchError, match="provenance"):
        changed.write_partition(
            path,
            geography_level="national",
            scope_catalog=[["colombia", "Colombia"]],
        )


def test_release_inventory_invariants_cover_8300_species():
    records = [
        _species(f"Species {index}", 0 if index < 166 else 1)
        for index in range(8_300)
    ]
    unavailable = {
        records[-1].filename_stem.lower(),
        records[-2].filename_stem.lower(),
    }
    catalog = _catalog(records, unavailable)

    assert catalog["provenance"]["inventory"] == {
        "catalogTotal": 8_300,
        "unavailable": 2,
        "zeroRange": 166,
    }


def test_streaming_resume_rejects_tamper_interruption_and_missing_shard(
    tmp_path: Path,
):
    record = _species("Streaming")
    catalog = _catalog([record])
    pipeline = _pipeline(catalog, tmp_path)
    pipeline.record_national(record, 30, 100)
    path = compact_partition_path(tmp_path / "release", "fixture-solution", "national")

    assert not pipeline.write_partition_streaming(
        path,
        geography_level="national",
        scope_catalog=[["colombia", "Colombia"]],
    )
    streamed = json.loads(path.read_text(encoding="utf-8"))
    validate_compact(streamed, catalog=catalog)
    assert partition_is_resumable(
        path,
        catalog=catalog,
        expected_solution_id="fixture-solution",
        expected_level="national",
        expected_catalog_sha256=catalog["catalogSha256"],
        expected_provenance=pipeline.provenance,
    )
    assert pipeline.write_partition_streaming(
        path,
        geography_level="national",
        scope_catalog=[["colombia", "Colombia"]],
    )

    path.write_text(path.read_text() + " ", encoding="utf-8")
    assert not partition_is_resumable(
        path,
        catalog=catalog,
        expected_solution_id="fixture-solution",
        expected_level="national",
        expected_catalog_sha256=catalog["catalogSha256"],
        expected_provenance=pipeline.provenance,
    )
    assert not pipeline.write_partition_streaming(
        path,
        geography_level="national",
        scope_catalog=[["colombia", "Colombia"]],
    )
    semantically_invalid = json.loads(path.read_text(encoding="utf-8"))
    semantically_invalid["rows"][0][7] &= ~FLAG_MET_30
    body = {
        key: value
        for key, value in semantically_invalid.items()
        if key != "completion"
    }
    semantically_invalid["completion"]["payloadSha256"] = canonical_sha256(body)
    encoded = json.dumps(
        semantically_invalid,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    )
    path.write_text(encoded, encoding="utf-8")
    completion_path = path.with_name(f"{path.name}.complete.json")
    completion = json.loads(completion_path.read_text(encoding="utf-8"))
    completion["payloadSha256"] = semantically_invalid["completion"]["payloadSha256"]
    completion["artifactSha256"] = hashlib.sha256(encoded.encode("utf-8")).hexdigest()
    completion_path.write_text(
        json.dumps(
            completion,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
            allow_nan=False,
        ),
        encoding="utf-8",
    )
    assert not partition_is_resumable(
        path,
        catalog=catalog,
        expected_solution_id="fixture-solution",
        expected_level="national",
        expected_catalog_sha256=catalog["catalogSha256"],
        expected_provenance=pipeline.provenance,
    )

    interrupted = compact_partition_path(
        tmp_path / "interrupted", "fixture-solution", "departments"
    )
    interrupted.parent.mkdir(parents=True)
    interrupted.write_text('{"format":"species-goals-compact-v1"', encoding="utf-8")
    assert not partition_is_resumable(
        interrupted,
        catalog=catalog,
        expected_solution_id="fixture-solution",
        expected_level="departments",
        expected_catalog_sha256=catalog["catalogSha256"],
        expected_provenance=pipeline.provenance,
    )
    missing = compact_partition_path(
        tmp_path / "missing", "fixture-solution", "municipalities"
    )
    assert not partition_is_resumable(
        missing,
        catalog=catalog,
        expected_solution_id="fixture-solution",
        expected_level="municipalities",
        expected_catalog_sha256=catalog["catalogSha256"],
        expected_provenance=pipeline.provenance,
    )


def test_contract_paths_and_semantic_tamper_are_fail_closed(tmp_path: Path):
    release_contract = json.loads(
        (
            Path(__file__).resolve().parents[4]
            / "frontend/layer-manifest/release-contract.json"
        ).read_text(encoding="utf-8")
    )
    assert release_contract["speciesGoalsCatalogDirectory"] == str(
        catalog_path(Path()).parent
    )
    assert release_contract["speciesGoalsCompactDirectory"] == str(
        compact_partition_path(Path(), "solution", "runaps").parents[1]
    )
    assert catalog_path(tmp_path) == (
        tmp_path / "species-goals/catalog/v1/catalog.json"
    )
    assert compact_partition_path(tmp_path, "solution", "runaps") == (
        tmp_path
        / "species-goals/compact/v1/solution/runaps.species-goals.compact.json"
    )

    record = _species("Tamper")
    catalog = _catalog([record])
    pipeline = _pipeline(catalog, tmp_path)
    pipeline.record_national(record, 40, 100)
    document = pipeline.build_partition(
        geography_level="national",
        scope_catalog=[["colombia", "Colombia"]],
    )
    document["rows"][0][7] &= ~FLAG_MET_30
    body = {key: value for key, value in document.items() if key != "completion"}
    document["completion"]["payloadSha256"] = canonical_sha256(body)

    with pytest.raises(ValueError, match="30 percent"):
        validate_compact(document, catalog=catalog)
    with pytest.raises(ProvenanceMismatchError, match="stale"):
        validate_compact(
            pipeline.build_partition(
                geography_level="national",
                scope_catalog=[["colombia", "Colombia"]],
            ),
            catalog=catalog,
            expected_release_id="stale-release",
        )


def test_release_inventory_includes_only_complete_validated_solutions(tmp_path: Path):
    records = [
        _species(f"Species {index}", 0 if index < 166 else 1)
        for index in range(8_300)
    ]
    unavailable = {
        records[-1].filename_stem.lower(),
        records[-2].filename_stem.lower(),
    }
    catalog = _catalog(records, unavailable)
    assert catalog["provenance"]["inventory"] == {
        "catalogTotal": 8_300,
        "unavailable": 2,
        "zeroRange": 166,
    }
    record = records[166]
    pipeline = _pipeline(catalog, tmp_path)
    pipeline.record_national(record, 30, 100)
    for level in ("departments", "municipalities", "siraps", "runaps", "omecs"):
        pipeline.record_sub_level(
            record,
            level,
            np.array([30.0]),
            np.array([100.0]),
        )
    for level in ("national", "departments", "municipalities", "siraps", "runaps", "omecs"):
        path = compact_partition_path(tmp_path, "fixture-solution", level)
        pipeline.write_partition_streaming(
            path,
            geography_level=level,
            scope_catalog=(
                [["colombia", "Colombia"]]
                if level == "national"
                else [["scope-1", "Scope 1"]]
            ),
        )
        document = json.loads(path.read_text(encoding="utf-8"))
        validate_compact(document, catalog=catalog)
        assert partition_is_resumable(
            path,
            catalog=catalog,
            expected_solution_id="fixture-solution",
            expected_level=level,
            expected_catalog_sha256=catalog["catalogSha256"],
            expected_provenance=pipeline.provenance,
        )

    inventory = write_release_inventory(
        tmp_path,
        release_id="fixture-release",
        catalog=catalog,
        expected_provenance_by_solution={
            "fixture-solution": pipeline.provenance,
            "missing-solution": pipeline.provenance,
        },
    )

    assert list(inventory["solutions"]) == ["fixture-solution"]


def test_metadata_repair_preserves_areas_and_reference_flags_for_all_scopes(
    tmp_path: Path,
):
    records = [_species("Configured"), _species("Absent"), _species("Zero range", 0)]
    catalog = _catalog(records)
    pipeline = _pipeline(
        catalog,
        tmp_path,
        policy=SpeciesTargetPolicy("scalar", 30.0, {}, None),
    )
    pipeline.record_national(
        records[0],
        40,
        100,
        pre_existing_area_m2=30,
        new_prioritizr_area_m2=10,
    )
    pipeline.record_national(records[1], 10, 100)
    pipeline.record_national(records[2], 0, 0)
    pipeline.record_sub_level(
        records[0],
        "departments",
        np.array([10.0]),
        np.array([100.0]),
        pre_existing_per_boundary=np.array([4.0]),
        new_prioritizr_per_boundary=np.array([6.0]),
    )
    targets = {"configured": 20.0, "zero_range": 0.0}
    national_met = {"configured": True, "zero_range": None}

    national = pipeline.build_partition(
        geography_level="national",
        scope_catalog=[["colombia", "Colombia"]],
    )
    repaired_national = repair_compact_document(
        national,
        catalog=catalog,
        targets_by_feature_id=targets,
        national_met_by_feature_id=national_met,
        target_policy_sha256=SHA_B,
        generated_at="2026-08-10T00:00:00+00:00",
    )
    departments = pipeline.build_partition(
        geography_level="departments",
        scope_catalog=[["05", "Antioquia"]],
    )
    repaired_departments = repair_compact_document(
        departments,
        catalog=catalog,
        targets_by_feature_id=targets,
        national_met_by_feature_id={"configured": True},
        target_policy_sha256=SHA_B,
    )

    assert [row[:6] for row in repaired_national["rows"]] == [
        row[:6] for row in national["rows"]
    ]
    national_by_name = {
        catalog["rows"][row[1]][1]: row for row in repaired_national["rows"]
    }
    assert national_by_name["Configured"][6] == 20.0
    assert national_by_name["Configured"][7] & FLAG_CONFIGURED_TARGET_MET
    assert national_by_name["Absent"][6] is None
    assert not national_by_name["Absent"][7] & FLAG_TARGET_CONFIGURED
    assert national_by_name["Zero range"][6] == 0.0
    assert national_by_name["Zero range"][7] == FLAG_NO_RANGE | FLAG_TARGET_CONFIGURED
    assert repaired_departments["rows"][0][6] == 20.0
    assert not repaired_departments["rows"][0][7] & FLAG_CONFIGURED_TARGET_MET
    for original, repaired in zip(national["rows"], repaired_national["rows"]):
        assert original[7] & (FLAG_MET_17 | FLAG_MET_30) == repaired[7] & (
            FLAG_MET_17 | FLAG_MET_30
        )
    assert repaired_national["provenance"]["targetPolicySha256"] == SHA_B
    validate_compact(repaired_national, catalog=catalog)
    validate_compact(repaired_departments, catalog=catalog)


def test_metadata_repair_keeps_exact_compact_status_when_summary_met_differs(
    tmp_path: Path,
):
    record = _species("Configured")
    catalog = _catalog([record])
    pipeline = _pipeline(catalog, tmp_path)
    pipeline.record_national(record, 10, 100)
    document = pipeline.build_partition(
        geography_level="national",
        scope_catalog=[["colombia", "Colombia"]],
    )

    repaired = repair_compact_document(
        document,
        catalog=catalog,
        targets_by_feature_id={"configured": 20.0},
        national_met_by_feature_id={"configured": True},
        target_policy_sha256=SHA_B,
    )

    assert repaired["rows"][0][6] == 20.0
    assert not repaired["rows"][0][7] & FLAG_CONFIGURED_TARGET_MET
    validate_compact(repaired, catalog=catalog)


def test_metadata_repair_leaves_summary_target_unavailable_in_compact(
    tmp_path: Path,
):
    record = _species("Unavailable")
    catalog = _catalog([record], unavailable={"unavailable"})
    pipeline = _pipeline(catalog, tmp_path)
    document = pipeline.build_partition(
        geography_level="national",
        scope_catalog=[["colombia", "Colombia"]],
    )

    repaired = repair_compact_document(
        document,
        catalog=catalog,
        targets_by_feature_id={"unavailable": 80.0},
        national_met_by_feature_id={"unavailable": True},
        target_policy_sha256=SHA_B,
    )

    assert repaired["rows"][0][6] is None
    assert repaired["rows"][0][7] == FLAG_UNAVAILABLE
    validate_compact(repaired, catalog=catalog)


def test_summary_target_loader_keeps_post_hoc_unknown_and_explicit_zero(
    tmp_path: Path,
):
    summary = tmp_path / "summary.csv"
    summary.write_text(
        "feature,feature_type,relative_target,relative_held,met,evaluated\n"
        "Configured,species,0.17,0.2,TRUE,prioritizr_model\n"
        "Zero range,species,0,NA,NA,post-hoc\n",
        encoding="utf-8",
    )

    targets, met = load_summary_targets(summary)

    assert targets == {"configured": 17.0, "zero_range": 0.0}
    assert met == {"configured": True, "zero_range": None}
