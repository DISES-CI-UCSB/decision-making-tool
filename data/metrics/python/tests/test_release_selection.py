from __future__ import annotations

import hashlib
import json

import pytest

from release_selection import (
    RELEASE_PARTITION_FORMAT,
    ReleaseSelectionError,
    build_release_partition_descriptor,
    full_release_selection,
    load_release_partition,
    reconcile_release_reports,
    validate_release_entries,
)

RELEASE_ID = "test-release"
BLOB_DIRECTORY = f"releases/{RELEASE_ID}/mec/v2"
LEVELS = (
    "national",
    "departments",
    "municipalities",
    "siraps",
    "runaps",
    "omecs",
)
LAND_IDS = tuple(f"land-{index:03d}" for index in range(104))
SHUFFLED_LAND_IDS = (*LAND_IDS[1::2], *LAND_IDS[::2])
KNOWN_IDS = (*LAND_IDS, "marine-000")


def _descriptor(solution_ids, *, index, count=2, artifact_count=None):
    return {
        "format": RELEASE_PARTITION_FORMAT,
        "releaseId": RELEASE_ID,
        "partitionIndex": index,
        "partitionCount": count,
        "expectedArtifactCount": (
            len(solution_ids) * len(LEVELS)
            if artifact_count is None
            else artifact_count
        ),
        "solutionIds": list(solution_ids),
    }


def _load(tmp_path, descriptor, *, land_ids=LAND_IDS, known_ids=KNOWN_IDS):
    path = tmp_path / f"partition-{descriptor.get('partitionIndex', 'bad')}.json"
    path.write_text(json.dumps(descriptor), encoding="utf-8")
    return load_release_partition(
        path,
        release_id=RELEASE_ID,
        known_solution_ids=known_ids,
        land_solution_ids=land_ids,
        artifact_levels=LEVELS,
    )


def _entries(solution_ids):
    return [
        {
            "solutionId": solution_id,
            "geographyLevel": level,
            "expectedBlobPath": (
                f"{BLOB_DIRECTORY}/{solution_id}/{level}.mec.compact.json"
            ),
            "expectedPublicUrl": (
                "https://example.test/"
                f"{BLOB_DIRECTORY}/{solution_id}/{level}.mec.compact.json"
            ),
        }
        for solution_id in solution_ids
        for level in LEVELS
    ]


def _partition_report(selection):
    return {
        "releaseSelection": selection.to_report(),
        "blobDirectory": BLOB_DIRECTORY,
        "entries": _entries(selection.solution_ids),
        "failures": [],
    }


def _descriptor_hash(descriptor):
    return hashlib.sha256(
        json.dumps(
            descriptor,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    ).hexdigest()


def test_valid_even_and_odd_52_solution_partitions(tmp_path):
    even = _load(tmp_path, _descriptor(LAND_IDS[::2], index=0))
    odd = _load(tmp_path, _descriptor(LAND_IDS[1::2], index=1))

    assert len(even.solution_ids) == len(odd.solution_ids) == 52
    assert even.expected_artifact_count == odd.expected_artifact_count == 312
    assert even.descriptor_sha256 != odd.descriptor_sha256
    assert even.to_report()["releaseId"] == RELEASE_ID
    assert even.to_report()["partitionIndex"] == 0
    assert even.to_report()["partitionCount"] == 2


def test_shuffled_manifest_order_produces_stable_even_odd_descriptors_and_hashes(
    tmp_path,
):
    sorted_even = build_release_partition_descriptor(
        release_id=RELEASE_ID,
        land_solution_ids=LAND_IDS,
        partition_index=0,
        partition_count=2,
        artifact_levels=LEVELS,
    )
    shuffled_even = build_release_partition_descriptor(
        release_id=RELEASE_ID,
        land_solution_ids=SHUFFLED_LAND_IDS,
        partition_index=0,
        partition_count=2,
        artifact_levels=LEVELS,
    )
    sorted_odd = build_release_partition_descriptor(
        release_id=RELEASE_ID,
        land_solution_ids=LAND_IDS,
        partition_index=1,
        partition_count=2,
        artifact_levels=LEVELS,
    )
    shuffled_odd = build_release_partition_descriptor(
        release_id=RELEASE_ID,
        land_solution_ids=SHUFFLED_LAND_IDS,
        partition_index=1,
        partition_count=2,
        artifact_levels=LEVELS,
    )

    assert shuffled_even == sorted_even
    assert shuffled_odd == sorted_odd
    assert sorted_even["solutionIds"] == list(LAND_IDS[::2])
    assert sorted_odd["solutionIds"] == list(LAND_IDS[1::2])
    even = _load(
        tmp_path,
        shuffled_even,
        land_ids=SHUFFLED_LAND_IDS,
        known_ids=(*SHUFFLED_LAND_IDS, "marine-000"),
    )
    stable_even = _load(tmp_path, sorted_even)
    assert even.descriptor_sha256 == stable_even.descriptor_sha256


@pytest.mark.parametrize(
    ("mutate", "message"),
    [
        (lambda value: value.update(solutionIds=[]), "non-empty"),
        (
            lambda value: value.update(solutionIds=[LAND_IDS[0], LAND_IDS[0]]),
            "duplicate",
        ),
        (
            lambda value: value.update(solutionIds=[*LAND_IDS[::2], "unknown"]),
            "unknown",
        ),
        (
            lambda value: value.update(solutionIds=[*LAND_IDS[::2], "marine-000"]),
            "non-land",
        ),
        (
            lambda value: value.update(solutionIds=list(reversed(LAND_IDS[::2]))),
            "lexically sorted",
        ),
        (
            lambda value: value.update(solutionIds=list(LAND_IDS[::2][:-1])),
            "lexically sorted",
        ),
        (lambda value: value.update(expectedArtifactCount=311), "must equal"),
        (lambda value: value.pop("solutionIds"), "non-empty"),
    ],
)
def test_partition_descriptor_rejects_invalid_missing_or_duplicate_ids(
    tmp_path, mutate, message
):
    descriptor = _descriptor(LAND_IDS[::2], index=0)
    mutate(descriptor)

    with pytest.raises(ReleaseSelectionError, match=message):
        _load(tmp_path, descriptor)


def test_release_output_must_exactly_match_all_six_levels(tmp_path):
    selection = _load(tmp_path, _descriptor(LAND_IDS[::2], index=0))
    entries = _entries(selection.solution_ids)

    validate_release_entries(
        entries,
        selection=selection,
        artifact_levels=LEVELS,
    )
    with pytest.raises(ReleaseSelectionError, match="exactly match"):
        validate_release_entries(
            entries[:-1],
            selection=selection,
            artifact_levels=LEVELS,
        )
    with pytest.raises(ReleaseSelectionError, match="duplicate"):
        validate_release_entries(
            [*entries, entries[0]],
            selection=selection,
            artifact_levels=LEVELS,
        )


def test_full_release_still_requires_104_solutions_and_624_artifacts():
    selection = full_release_selection(
        release_id=RELEASE_ID,
        land_solution_ids=SHUFFLED_LAND_IDS,
        expected_solution_count=104,
        artifact_levels=LEVELS,
    )

    assert selection.expected_artifact_count == 624
    assert selection.solution_ids == LAND_IDS
    validate_release_entries(
        _entries(LAND_IDS),
        selection=selection,
        artifact_levels=LEVELS,
    )
    with pytest.raises(ReleaseSelectionError, match="exactly 104"):
        full_release_selection(
            release_id=RELEASE_ID,
            land_solution_ids=LAND_IDS[:-1],
            expected_solution_count=104,
            artifact_levels=LEVELS,
        )
    with pytest.raises(ReleaseSelectionError, match="duplicate"):
        full_release_selection(
            release_id=RELEASE_ID,
            land_solution_ids=(*LAND_IDS[:-1], LAND_IDS[0]),
            expected_solution_count=104,
            artifact_levels=LEVELS,
        )


def test_final_reconciliation_requires_disjoint_exact_104_and_624_union(tmp_path):
    even = _load(tmp_path, _descriptor(LAND_IDS[::2], index=0))
    odd = _load(tmp_path, _descriptor(LAND_IDS[1::2], index=1))

    result = reconcile_release_reports(
        [_partition_report(even), _partition_report(odd)],
        release_id=RELEASE_ID,
        land_solution_ids=SHUFFLED_LAND_IDS,
        artifact_levels=LEVELS,
        expected_solution_count=104,
        expected_blob_directory=BLOB_DIRECTORY,
    )

    assert result["ok"] is True
    assert result["solutionCount"] == 104
    assert result["artifactCount"] == 624


def test_final_reconciliation_rejects_overlap_missing_and_tampering(tmp_path):
    even = _load(tmp_path, _descriptor(LAND_IDS[::2], index=0))
    odd = _load(tmp_path, _descriptor(LAND_IDS[1::2], index=1))

    overlap_report = _partition_report(odd)
    overlap_report["releaseSelection"]["solutionIds"][0] = LAND_IDS[0]
    with pytest.raises(ReleaseSelectionError, match="descriptorSha256"):
        reconcile_release_reports(
            [_partition_report(even), overlap_report],
            release_id=RELEASE_ID,
            land_solution_ids=LAND_IDS,
            artifact_levels=LEVELS,
            expected_solution_count=104,
        )

    missing_report = _partition_report(odd)
    missing_report["releaseSelection"]["solutionIds"].pop()
    missing_report["releaseSelection"]["expectedArtifactCount"] -= len(LEVELS)
    missing_report["entries"] = missing_report["entries"][:-len(LEVELS)]
    with pytest.raises(ReleaseSelectionError, match="descriptorSha256"):
        reconcile_release_reports(
            [_partition_report(even), missing_report],
            release_id=RELEASE_ID,
            land_solution_ids=LAND_IDS,
            artifact_levels=LEVELS,
            expected_solution_count=104,
        )


def test_final_reconciliation_rejects_overlapping_valid_descriptors(tmp_path):
    first = _load(tmp_path, _descriptor(LAND_IDS[::2], index=0))
    second = _load(tmp_path, _descriptor(LAND_IDS[1::2], index=1))
    second_report = _partition_report(second)
    second_ids = [LAND_IDS[0], *LAND_IDS[1::2][1:]]
    second_report["releaseSelection"]["solutionIds"] = second_ids
    descriptor = _descriptor(second_ids, index=1)
    second_report["releaseSelection"]["descriptorSha256"] = _descriptor_hash(descriptor)
    second_report["entries"] = _entries(second_ids)

    with pytest.raises(ReleaseSelectionError, match="overlap"):
        reconcile_release_reports(
            [_partition_report(first), second_report],
            release_id=RELEASE_ID,
            land_solution_ids=LAND_IDS,
            artifact_levels=LEVELS,
            expected_solution_count=104,
        )


def test_final_reconciliation_rejects_incomplete_union(tmp_path):
    even = _load(tmp_path, _descriptor(LAND_IDS[::2], index=0))
    odd = _load(tmp_path, _descriptor(LAND_IDS[1::2], index=1))
    odd_report = _partition_report(odd)
    incomplete_ids = list(LAND_IDS[1::2][:-1])
    descriptor = _descriptor(incomplete_ids, index=1)
    odd_report["releaseSelection"].update(
        {
            "solutionIds": incomplete_ids,
            "expectedSolutionCount": len(incomplete_ids),
            "expectedArtifactCount": len(incomplete_ids) * len(LEVELS),
            "descriptorSha256": _descriptor_hash(descriptor),
        }
    )
    odd_report["entries"] = _entries(incomplete_ids)

    with pytest.raises(ReleaseSelectionError, match="union"):
        reconcile_release_reports(
            [_partition_report(even), odd_report],
            release_id=RELEASE_ID,
            land_solution_ids=LAND_IDS,
            artifact_levels=LEVELS,
            expected_solution_count=104,
        )


def test_final_reconciliation_rejects_nonrelease_url_prefix(tmp_path):
    even = _load(tmp_path, _descriptor(LAND_IDS[::2], index=0))
    odd = _load(tmp_path, _descriptor(LAND_IDS[1::2], index=1))
    odd_report = _partition_report(odd)
    odd_report["blobDirectory"] = "metrics/mec-cache"

    with pytest.raises(ReleaseSelectionError, match="release prefix"):
        reconcile_release_reports(
            [_partition_report(even), odd_report],
            release_id=RELEASE_ID,
            land_solution_ids=LAND_IDS,
            artifact_levels=LEVELS,
            expected_solution_count=104,
            expected_blob_directory=BLOB_DIRECTORY,
        )
