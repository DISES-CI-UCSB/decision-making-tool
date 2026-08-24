import hashlib
import sqlite3

import numpy as np
import pytest
from boundaries.boundary_topology import OverlapBoundaryIndex
from calculators.species import SpeciesAccumulator
from raster_metrics import RasterFingerprint
from species_data import SpeciesRecord, compute_pool_sizes
from species_goals import SpeciesGoalsPipeline, build_catalog
from species_overlap import SpeciesOverlap
from species_solution_batch import (
    ExactOverlapInput,
    SpeciesSolutionBatchCancelled,
    SpeciesSolutionBatchError,
    process_exact_species_batch,
)
from species_solution_buffered import process_exact_species_batch_buffered
from species_target_policy import SpeciesTargetPolicy


def _fingerprint() -> RasterFingerprint:
    return RasterFingerprint(
        width=6,
        height=2,
        transform=(1.0, 0.0, 0.0, 0.0, -1.0, 2.0),
        crs="EPSG:9377",
    )


def _records(count: int = 5) -> list[SpeciesRecord]:
    buckets = ("mammals", "birds", "amphibians", "reptiles", "plants")
    classes = ("Mammalia", "Aves", "Amphibia", "Reptilia", "Magnoliopsida")
    return [
        SpeciesRecord(
            scientific_name=f"Species {index}",
            csv_class=classes[index % len(classes)],
            iucn_status=("VU", "LC", "", "XX", "CR")[index % 5],
            range_km2=1.0,
            bucket=buckets[index % len(buckets)],
            threatened=index % 2 == 0,
        )
        for index in range(count)
    ]


def _index() -> OverlapBoundaryIndex:
    owner_lists = (
        (0,),
        (0, 1),
        (1,),
        (),
        (2,),
        (1, 2),
        (0,),
        (2,),
        (0, 2),
        (1,),
        (),
        (0, 1, 2),
    )
    offsets = np.zeros(len(owner_lists) + 1, dtype=np.int64)
    offsets[1:] = np.cumsum([len(owners) for owners in owner_lists])
    owners = np.asarray([owner for values in owner_lists for owner in values], dtype=np.int32)
    return OverlapBoundaryIndex(
        level="random",
        boundary_ids=("0", "1", "2"),
        boundary_names=("0", "1", "2"),
        boundary_provenance=(),
        total_claims=int(owners.size),
        claimed_pixels=sum(bool(values) for values in owner_lists),
        overlap_pixels=sum(len(values) > 1 for values in owner_lists),
        max_multiplicity=3,
        estimated_bytes=offsets.nbytes + owners.nbytes,
        estimated_peak_build_bytes=offsets.nbytes + owners.nbytes,
        offsets=offsets,
        boundary_indices=owners,
    )


def _overlaps(count: int) -> list[SpeciesOverlap]:
    rng = np.random.default_rng(20260820)
    values = []
    for index in range(count):
        size = 0 if index == count - 1 else 3 + index
        flat = np.sort(rng.choice(12, size=size, replace=False)).astype(np.int64)
        values.append(
            SpeciesOverlap(
                flat_indices=flat,
                areas_m2=rng.uniform(0.01, 4.0, size=size).astype(np.float64),
            )
        )
    return values


def _policies(records: list[SpeciesRecord]) -> list[SpeciesTargetPolicy]:
    return [
        SpeciesTargetPolicy("scalar", 30.0, {}, {"kind": "scalar"}),
        SpeciesTargetPolicy(
            "per_species",
            None,
            {
                record.scientific_name.lower().replace(" ", "_"): 20.0 + index
                for index, record in enumerate(records[:-1])
            },
            {"kind": "per_species"},
        ),
        SpeciesTargetPolicy(
            "dual_reference",
            None,
            {},
            {"kind": "dual_reference"},
        ),
    ]


def _accumulators(
    records: list[SpeciesRecord],
    policies: list[SpeciesTargetPolicy],
    sinks=None,
) -> list[SpeciesAccumulator]:
    pool = compute_pool_sizes(records)
    values = [
        SpeciesAccumulator(
            target_pct=policy.scalar_target_pct,
            pool_sizes=pool,
            target_policy=policy,
            species_expected=len(records),
            detail_sink=None if sinks is None else sinks[index],
        )
        for index, policy in enumerate(policies)
    ]
    for value in values:
        value.init_sub({"random": 3})
    return values


@pytest.mark.parametrize("chunk_size", [1, 2, 4, 128])
def test_buffered_chunks_match_v1_for_all_target_policies(tmp_path, chunk_size):
    records = _records()
    policies = _policies(records)
    overlaps = _overlaps(len(records))
    paths = [tmp_path / f"{index}.npz" for index in range(len(records))]
    for path in paths:
        path.write_bytes(b"x")
    by_name = {path.name: overlap for path, overlap in zip(paths, overlaps, strict=True)}
    categories = np.random.default_rng(9).integers(
        0, 3, size=(12, len(policies)), dtype=np.uint8
    )
    expected = _accumulators(records, policies)
    observed = _accumulators(records, policies)

    process_exact_species_batch(
        species_records=records,
        overlap_paths=paths,
        categories=categories,
        fingerprint=_fingerprint(),
        boundary_indexes={"random": _index()},
        accumulators=expected,
        overlap_loader=lambda path, _fingerprint: by_name[path.name],
    )
    stats = process_exact_species_batch_buffered(
        species_records=records,
        overlap_paths=paths,
        categories=categories,
        fingerprint=_fingerprint(),
        boundary_indexes={"random": _index()},
        accumulators=observed,
        species_chunk_size=chunk_size,
        overlap_loader=lambda path, _fingerprint: by_name[path.name],
    )

    assert stats.species_processed == len(records)
    assert stats.solution_failures == ()
    for left, right in zip(expected, observed, strict=True):
        assert left.national == right.national
        assert left.sub == right.sub
        assert left.species_processed == right.species_processed
        assert left.species_with_range == right.species_with_range


def test_buffered_detail_flush_preserves_canonical_order(tmp_path):
    records = _records(3)
    overlaps = _overlaps(3)
    paths = [tmp_path / f"{index}.npz" for index in range(3)]
    for path in paths:
        path.write_bytes(b"x")
    by_name = {path.name: overlap for path, overlap in zip(paths, overlaps, strict=True)}

    class Sink:
        def __init__(self):
            self.rows = []

        def record_species_chunk(
            self,
            species,
            national_selected,
            national_total,
            national_pre_existing,
            national_new,
            boundaries,
        ):
            self.rows.extend(("national", value.scientific_name, 0) for value in species)
            for level, channels in boundaries.items():
                for row, value in enumerate(species):
                    self.rows.extend(
                        (level, value.scientific_name, int(scope))
                        for scope in np.flatnonzero(channels[1][row] > 0)
                    )

    sink = Sink()
    accumulators = _accumulators(records, [_policies(records)[0]], [sink])
    process_exact_species_batch_buffered(
        species_records=records,
        overlap_paths=paths,
        categories=np.ones((12, 1), dtype=np.uint8),
        fingerprint=_fingerprint(),
        boundary_indexes={"random": _index()},
        accumulators=accumulators,
        species_chunk_size=2,
        overlap_loader=lambda path, _fingerprint: by_name[path.name],
    )

    assert sink.rows[:2] == [
        ("national", "Species 0", 0),
        ("national", "Species 1", 0),
    ]
    assert sink.rows[-1] == ("national", "Species 2", 0)


def test_buffered_flush_failure_isolates_member_and_keeps_sibling(tmp_path):
    records = _records(3)
    paths = [tmp_path / f"{index}.npz" for index in range(3)]
    for path in paths:
        path.write_bytes(b"x")

    class Sink:
        def __init__(self, fail=False):
            self.fail = fail

        def record_species_chunk(self, *_args):
            if self.fail:
                raise RuntimeError("flush failed")

    policies = _policies(records)[:2]
    accumulators = _accumulators(records, policies, [Sink(True), Sink()])
    stats = process_exact_species_batch_buffered(
        species_records=records,
        overlap_paths=paths,
        categories=np.ones((12, 2), dtype=np.uint8),
        fingerprint=_fingerprint(),
        boundary_indexes={"random": _index()},
        accumulators=accumulators,
        species_chunk_size=2,
        overlap_loader=lambda *_args: SpeciesOverlap(
            flat_indices=np.array([0, 1], dtype=np.int64),
            areas_m2=np.array([1.0, 2.0], dtype=np.float64),
        ),
    )

    assert len(stats.solution_failures) == 1
    assert stats.solution_failures[0].solution_index == 0
    assert accumulators[0].species_processed == 0
    assert accumulators[1].species_processed == 3


def test_production_sqlite_chunk_failure_isolates_member_and_finalizes_sibling(
    tmp_path,
):
    records = _records(3)
    policy = _policies(records)[0]
    catalog = build_catalog(
        records,
        provenance={
            "releaseId": "fixture-release",
            "speciesCsvSha256": "a" * 64,
            "exceptionSourceSha256": None,
            "exceptionPolicySha256": None,
            "exceptionBindingSha256": None,
            "inventory": {
                "catalogTotal": len(records),
                "unavailable": 0,
                "zeroRange": 0,
            },
        },
    )
    provenance = {
        "releaseId": "fixture-release",
        "speciesCsvSha256": "a" * 64,
        "exceptionSourceSha256": None,
        "exceptionPolicySha256": None,
        "exceptionBindingSha256": None,
        "exactOverlapAlgorithmVersion": "fixture-v1",
        "exactOverlapPolicySha256": "b" * 64,
        "targetGridSha256": "c" * 64,
        "speciesAlignmentInventorySha256": "d" * 64,
        "solutionRasterSha256": "e" * 64,
        "targetPolicySha256": "f" * 64,
        "boundaryProvenanceSha256": "1" * 64,
        "catalogSha256": catalog["catalogSha256"],
    }

    def pipeline_for(solution_id):
        return SpeciesGoalsPipeline(
            catalog,
            solution_id=solution_id,
            target_policy=policy,
            provenance=provenance,
            spool_dir=tmp_path / "spool",
            active_levels={"national"},
        )

    faulty = pipeline_for("faulty")
    healthy = pipeline_for("healthy")
    faulty_connection = faulty._connection

    class PartialExecutemanyFailure:
        def execute(self, *args, **kwargs):
            return faulty_connection.execute(*args, **kwargs)

        def executemany(self, statement, rows):
            faulty_connection.execute(statement, rows[0])
            raise sqlite3.OperationalError("injected partial executemany failure")

        def __getattr__(self, name):
            return getattr(faulty_connection, name)

    faulty._connection = PartialExecutemanyFailure()
    accumulators = _accumulators(records, [policy, policy], [faulty, healthy])
    paths = [tmp_path / f"{index}.npz" for index in range(len(records))]
    for path in paths:
        path.write_bytes(b"x")

    stats = process_exact_species_batch_buffered(
        species_records=records,
        overlap_paths=paths,
        categories=np.ones((12, 2), dtype=np.uint8),
        fingerprint=_fingerprint(),
        boundary_indexes={"random": _index()},
        accumulators=accumulators,
        species_chunk_size=3,
        overlap_loader=lambda *_args: SpeciesOverlap(
            flat_indices=np.array([0, 1], dtype=np.int64),
            areas_m2=np.array([1.0, 2.0], dtype=np.float64),
        ),
    )

    assert [failure.solution_index for failure in stats.solution_failures] == [0]
    assert faulty_connection.execute(
        "SELECT COUNT(*) FROM observations"
    ).fetchone()[0] == 0
    document = healthy.build_partition(
        geography_level="national",
        scope_catalog=[["colombia", "Colombia"]],
    )
    assert [row[1] for row in document["rows"]] == [0, 1, 2]
    healthy.close()
    assert healthy.closed
    faulty._connection = faulty_connection
    faulty.close()


def test_buffered_rehashes_inputs_and_flushes_before_cancellation(tmp_path):
    records = _records(2)
    artifact = tmp_path / "overlap.npz"
    original = b"verified"
    artifact.write_bytes(original)
    exact = ExactOverlapInput(
        path=artifact,
        expected_sha256=hashlib.sha256(original).hexdigest(),
        expected_bytes=len(original),
    )
    accumulator = _accumulators(records, _policies(records)[:1])[0]
    checks = iter((False, True))

    with pytest.raises(SpeciesSolutionBatchCancelled, match="index 1"):
        process_exact_species_batch_buffered(
            species_records=records,
            overlap_paths=[exact, exact],
            categories=np.ones((12, 1), dtype=np.uint8),
            fingerprint=_fingerprint(),
            boundary_indexes={"random": _index()},
            accumulators=[accumulator],
            species_chunk_size=8,
            cancel_check=lambda: next(checks),
            overlap_loader=lambda *_args: SpeciesOverlap(
                flat_indices=np.array([0], dtype=np.int64),
                areas_m2=np.array([1.0], dtype=np.float64),
            ),
        )
    assert accumulator.species_processed == 1

    artifact.write_bytes(b"corrupt!")
    with pytest.raises(SpeciesSolutionBatchError, match="changed after discovery"):
        process_exact_species_batch_buffered(
            species_records=records[:1],
            overlap_paths=[exact],
            categories=np.ones((12, 1), dtype=np.uint8),
            fingerprint=_fingerprint(),
            boundary_indexes={},
            accumulators=[_accumulators(records[:1], _policies(records[:1])[:1])[0]],
        )
