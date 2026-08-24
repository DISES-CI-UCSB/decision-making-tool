from __future__ import annotations

import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import main as pipeline
import metrics_candidate as candidate
import pytest
from assemble_solution_release import _local_relative_path
from blob_manifest import ResolvedManifest
from compact_metrics import _validate_release_verbose_document
from local_io import cache_solution_path
from merge_release_workers import _resolve_worker_cache_path
from publish import _load_report_entries
from solution_catalog import SolutionCatalog, SolutionCatalogEntry


def _binding(**changes) -> candidate.CandidateBinding:
    values = {
        "release_id": "v0.2",
        "catalog_binding": {
            "format": "solution-catalog-binding-v1",
            "releaseId": "v0.2",
            "catalogVersion": "0.2",
            "catalogSha256": "a" * 64,
        },
        "solution_id": "fixture-land",
        "solution_domain": "land",
        "raster_basename": "fixture-land.tif",
        "raster_sha256": "b" * 64,
        "solution_input_signature": {
            "format": "solution-input-signature-v3",
            "sha256": "c" * 64,
        },
        "metrics_schema_version": 4,
        "catalog_signature": "metrics-catalog-v4:" + "d" * 64,
        "species_target_policy": None,
        "boundary_fanout": pipeline.boundary_fanout_identity("legacy"),
        "weighted_boundary_execution": pipeline.weighted_execution_identity(
            "scalar"
        ),
    }
    values.update(changes)
    return candidate.CandidateBinding(**values)


def _payload(*, policy=None, status="ready", empty=False) -> dict:
    return {
        "solutionId": "fixture-land",
        "generatedAt": "2026-08-06T12:00:00Z",
        "solutionRaster": {
            "solutionBasename": "fixture-land.tif",
            "sha256": "b" * 64,
        },
        "solutionInputSignature": _binding().solution_input_signature,
        "solutionCatalogBinding": _binding().catalog_binding,
        "metricsProvenance": {
            "schemaVersion": 4,
            "solutionDomain": "land",
            "catalogSignature": "metrics-catalog-v4:" + "d" * 64,
            "releaseId": "v0.2",
            "speciesTargetPolicy": policy,
            "generationConfig": {
                "boundaryFanout": pipeline.boundary_fanout_identity("legacy"),
                "weightedBoundaryExecution": pipeline.weighted_execution_identity(
                    "scalar"
                ),
            },
        },
        "fixtureState": {
            "metricStatus": status,
            "scopeClassification": "empty" if empty else "supported",
        },
        "geographies": {"national": {"colombia": {"metrics": []}}},
    }


def _solution_and_manifest():
    solution = {
        "id": "fixture-land",
        "domain": "land",
        "displayUrl": "https://example.test/fixture-land.tif",
    }
    manifest = ResolvedManifest(
        url="https://example.test/manifest.json",
        raw={},
        public_blob_host="https://example.test",
        layers_by_id={},
        national_solutions=[solution],
        batch_solutions=[solution],
    )
    return solution, manifest


def _promote_candidate(tmp_path: Path):
    solution, manifest = _solution_and_manifest()
    return pipeline._promote_resumable_candidate(
        solution=solution,
        manifest=manifest,
        output_dir=tmp_path,
        cache_blob_directory="metrics/cache",
        binding=_binding(),
        national_only=False,
        skip_species=False,
        skip_species_boundary_levels=set(),
        species_csv_url="https://example.test/species.csv",
        species_exception_binding=None,
        species_target_policy=None,
    )


@pytest.mark.parametrize(
    ("policy", "status", "empty"),
    [
        (None, "ready", False),
        ({"format": "species-target-policy-v1", "kind": "per_species"}, "ready", False),
        (
            {"format": "species-target-policy-v1", "kind": "dual_reference"},
            "partial",
            False,
        ),
        (None, "empty", True),
    ],
    ids=["scalar", "per-species", "dual-reference-partial", "proven-empty"],
)
def test_candidate_round_trips_metric_fixture_variants(
    tmp_path: Path,
    policy: dict | None,
    status: str,
    empty: bool,
):
    binding = _binding(species_target_policy=policy)
    payload = _payload(policy=policy, status=status, empty=empty)

    path = candidate.write_metrics_candidate(tmp_path, binding, payload)
    verified, issues = candidate.read_verified_candidate(tmp_path, binding)

    assert issues == []
    assert verified is not None
    assert verified.payload == payload
    assert path.parent.name == "quarantine"
    assert verified.envelope["publishable"] is False
    assert verified.envelope["complete"] is False
    assert verified.envelope["validation"] == {"state": "pending", "issues": []}


def test_candidate_rejects_weighted_execution_identity_drift(tmp_path: Path):
    candidate.write_metrics_candidate(tmp_path, _binding(), _payload())
    drifted = _binding(
        weighted_boundary_execution=pipeline.weighted_execution_identity(
            "grouped-weighted-v1"
        )
    )

    verified, issues = candidate.read_verified_candidate(tmp_path, drifted)

    assert verified is None
    assert "candidate metricsContract binding mismatch" in issues


@pytest.mark.parametrize(
    ("candidate_mode", "requested_mode"),
    [
        ("scalar", "grouped-weighted-v1"),
        ("grouped-weighted-v1", "scalar"),
    ],
)
def test_candidate_promotion_orchestration_rejects_other_weighted_mode(
    tmp_path: Path,
    candidate_mode: str,
    requested_mode: str,
):
    candidate_identity = pipeline.weighted_execution_identity(candidate_mode)
    requested_identity = pipeline.weighted_execution_identity(requested_mode)
    candidate_binding = _binding(weighted_boundary_execution=candidate_identity)
    payload = _payload()
    payload["metricsProvenance"]["generationConfig"][
        "weightedBoundaryExecution"
    ] = candidate_identity
    candidate.write_metrics_candidate(tmp_path, candidate_binding, payload)
    solution, manifest = _solution_and_manifest()

    entry = pipeline._promote_resumable_candidate(
        solution=solution,
        manifest=manifest,
        output_dir=tmp_path,
        cache_blob_directory="metrics/cache",
        binding=_binding(weighted_boundary_execution=requested_identity),
        national_only=False,
        skip_species=False,
        skip_species_boundary_levels=set(),
        species_csv_url="https://example.test/species.csv",
        species_exception_binding=None,
        species_target_policy=None,
        boundary_fanout_mode="grouped",
        weighted_boundary_fanout_mode=requested_mode,
    )

    assert entry is None
    assert not cache_solution_path(tmp_path, "fixture-land").exists()


def test_validation_failure_writes_full_candidate_and_all_diagnostics(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    payload = _payload()
    issues = ["first issue", "second issue"]
    monkeypatch.setattr(
        pipeline,
        "regular_artifact_completeness_issues",
        lambda *_args, **_kwargs: issues,
    )

    with pytest.raises(pipeline.MetricsCandidateValidationError) as raised:
        pipeline._finalize_solution_document(
            output_dir=tmp_path,
            solution_id="fixture-land",
            binding=_binding(),
            document=payload,
            national_only=False,
            domain="land",
            skip_species=False,
        )

    raw = json.loads(raised.value.candidate_path.read_text(encoding="utf-8"))
    assert raw["payload"] == payload
    assert raw["complete"] is False
    assert raw["validation"] == {"state": "failed", "issues": issues}
    assert not cache_solution_path(tmp_path, "fixture-land").exists()


def test_interrupted_atomic_write_preserves_previous_candidate(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    binding = _binding()
    target = candidate.write_metrics_candidate(
        tmp_path, binding, _payload(status="ready")
    )
    previous = target.read_bytes()
    original_replace = Path.replace

    def interrupted_replace(path: Path, destination: Path):
        if destination == target:
            raise OSError("simulated interruption")
        return original_replace(path, destination)

    monkeypatch.setattr(Path, "replace", interrupted_replace)
    with pytest.raises(OSError, match="simulated interruption"):
        candidate.write_metrics_candidate(
            tmp_path,
            binding,
            _payload(status="partial"),
        )

    assert target.read_bytes() == previous
    assert not list(target.parent.glob(f".{target.name}.*.tmp"))


def test_tampered_payload_is_rejected_without_deleting_evidence(tmp_path: Path):
    binding = _binding()
    path = candidate.write_metrics_candidate(tmp_path, binding, _payload())
    raw = json.loads(path.read_text(encoding="utf-8"))
    raw["payload"]["fixtureState"]["metricStatus"] = "tampered"
    path.write_text(json.dumps(raw), encoding="utf-8")

    verified, issues = candidate.read_verified_candidate(tmp_path, binding)

    assert verified is None
    assert "candidate payload checksum mismatch" in issues


def test_candidate_rejects_payload_species_execution_mutation(tmp_path: Path):
    execution = {
        "requestedMode": "solution-microbatch-v1",
        "effectiveMode": "solution-microbatch-v1",
        "algorithmVersion": "solution-microbatch-exact-npz-v1",
        "batchSize": 8,
        "batchOrdinal": 0,
        "orderedSolutionIds": ["fixture-land"],
        "bindingSha256": "e" * 64,
    }
    binding = _binding(species_execution=execution)
    payload = _payload()
    payload["metricsProvenance"]["generationConfig"]["speciesExecution"] = execution
    path = candidate.write_metrics_candidate(tmp_path, binding, payload)
    raw = json.loads(path.read_text(encoding="utf-8"))
    raw["payload"]["metricsProvenance"]["generationConfig"]["speciesExecution"][
        "batchOrdinal"
    ] = 1
    raw["payloadSha256"] = candidate.payload_sha256(raw["payload"])
    path.write_text(json.dumps(raw), encoding="utf-8")

    verified, issues = candidate.read_verified_candidate(tmp_path, binding)

    assert verified is None
    assert "candidate payload metrics provenance speciesExecution mismatch" in issues
    assert path.exists()


def test_rechecks_payload_bindings_even_with_recomputed_checksum(tmp_path: Path):
    binding = _binding()
    path = candidate.write_metrics_candidate(tmp_path, binding, _payload())
    raw = json.loads(path.read_text(encoding="utf-8"))
    raw["payload"]["solutionId"] = "other-solution"
    raw["payloadSha256"] = candidate.payload_sha256(raw["payload"])
    path.write_text(json.dumps(raw), encoding="utf-8")

    verified, issues = candidate.read_verified_candidate(tmp_path, binding)

    assert verified is None
    assert "candidate payload solution id mismatch" in issues
    assert path.exists()


@pytest.mark.parametrize(
    "changed_binding",
    [
        _binding(release_id="v0.3"),
        _binding(
            catalog_binding={**_binding().catalog_binding, "catalogSha256": "e" * 64}
        ),
        _binding(raster_sha256="e" * 64),
        _binding(
            solution_input_signature={
                "format": "solution-input-signature-v3",
                "sha256": "e" * 64,
            }
        ),
        _binding(metrics_schema_version=5),
        _binding(catalog_signature="metrics-catalog-v5:" + "e" * 64),
        _binding(
            species_target_policy={
                "format": "species-target-policy-v1",
                "kind": "per_species",
            }
        ),
        _binding(boundary_fanout=pipeline.boundary_fanout_identity("grouped")),
        _binding(
            boundary_fanout={
                **pipeline.boundary_fanout_identity("legacy"),
                "algorithmVersion": "boundary-fanout-dense-mask-v2",
            }
        ),
        _binding(
            species_execution={
                "requestedMode": "solution-microbatch-v1",
                "effectiveMode": "solution-microbatch-v1",
                "algorithmVersion": "solution-microbatch-exact-npz-v1",
                "batchSize": 8,
                "batchOrdinal": 1,
            }
        ),
    ],
    ids=[
        "release",
        "catalog",
        "raster",
        "input-signature",
        "schema",
        "metric-catalog",
        "target-policy",
        "boundary-fanout",
        "boundary-fanout-algorithm",
        "species-execution",
    ],
)
def test_stale_scientific_or_computation_binding_forces_recompute(
    tmp_path: Path,
    changed_binding: candidate.CandidateBinding,
):
    original = _binding()
    path = candidate.write_metrics_candidate(tmp_path, original, _payload())

    verified, issues = candidate.read_verified_candidate(tmp_path, changed_binding)

    assert verified is None
    assert issues
    assert path.exists()


def test_stale_validator_contract_forces_recompute_without_deletion(tmp_path: Path):
    binding = _binding()
    path = candidate.write_metrics_candidate(tmp_path, binding, _payload())
    raw = json.loads(path.read_text(encoding="utf-8"))
    raw["validationContractVersion"] = "regular-metrics-validation-v0"
    path.write_text(json.dumps(raw), encoding="utf-8")

    verified, issues = candidate.read_verified_candidate(tmp_path, binding)

    assert verified is None
    assert "candidate validation contract mismatch" in issues
    assert path.exists()


def test_recompute_archives_incompatible_candidate_evidence(tmp_path: Path):
    stale_binding = _binding(release_id="v0.1")
    stale_payload = _payload()
    stale_payload["metricsProvenance"]["releaseId"] = "v0.1"
    path = candidate.write_metrics_candidate(tmp_path, stale_binding, stale_payload)
    stale_bytes = path.read_bytes()

    candidate.write_metrics_candidate(tmp_path, _binding(), _payload())

    archived = list((path.parent / "archive").glob("*.metrics.candidate.json"))
    assert len(archived) == 1
    assert archived[0].read_bytes() == stale_bytes
    verified, issues = candidate.read_verified_candidate(tmp_path, _binding())
    assert issues == []
    assert verified is not None


def test_valid_revalidation_promotes_without_computation(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    binding = _binding()
    payload = _payload()
    candidate.write_metrics_candidate(
        tmp_path,
        binding,
        payload,
        validation_state="failed",
        validation_issues=["old validator issue"],
    )
    monkeypatch.setattr(
        pipeline,
        "regular_artifact_completeness_issues",
        lambda *_args, **_kwargs: [],
    )
    monkeypatch.setattr(
        pipeline,
        "_resume_entry_for_existing_cache",
        lambda *_args, **_kwargs: None,
    )
    monkeypatch.setattr(
        pipeline,
        "_resume_entry_for_document",
        lambda *_args, **_kwargs: {
            "solutionId": "fixture-land",
            "cachePath": str(cache_solution_path(tmp_path, "fixture-land")),
            "resumeSkipped": True,
        },
    )

    entry = _promote_candidate(tmp_path)

    assert entry["candidatePromoted"] is True
    assert (
        json.loads(cache_solution_path(tmp_path, "fixture-land").read_text()) == payload
    )
    assert not candidate.candidate_path(tmp_path, "fixture-land").exists()


def test_forced_canonical_validation_failure_never_writes_final(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    candidate_path = candidate.write_metrics_candidate(
        tmp_path,
        _binding(),
        _payload(),
    )
    monkeypatch.setattr(
        pipeline,
        "_resume_entry_for_existing_cache",
        lambda *_args, **_kwargs: None,
    )
    monkeypatch.setattr(
        pipeline,
        "regular_artifact_completeness_issues",
        lambda *_args, **_kwargs: [],
    )
    monkeypatch.setattr(
        pipeline,
        "_resume_entry_for_document",
        lambda *_args, **_kwargs: None,
    )
    monkeypatch.setattr(
        pipeline,
        "promote_metrics_candidate",
        lambda *_args, **_kwargs: pytest.fail("atomic promotion was invoked"),
    )

    assert _promote_candidate(tmp_path) is None
    assert not cache_solution_path(tmp_path, "fixture-land").exists()
    assert candidate_path.exists()
    retained = json.loads(candidate_path.read_text(encoding="utf-8"))
    assert retained["validation"] == {
        "state": "failed",
        "issues": ["candidate failed canonical in-memory resume validation"],
    }


def test_normal_final_cache_first_resume_never_overwrites_with_candidate(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    candidate_path = candidate.write_metrics_candidate(
        tmp_path,
        _binding(),
        _payload(status="candidate"),
    )
    final_path = cache_solution_path(tmp_path, "fixture-land")
    final_path.parent.mkdir(parents=True)
    final_path.write_bytes(b'{"existing":"valid"}')
    existing_bytes = final_path.read_bytes()
    existing_entry = {
        "solutionId": "fixture-land",
        "cachePath": str(final_path),
        "resumeSkipped": True,
    }
    monkeypatch.setattr(
        pipeline,
        "_resume_entry_for_existing_cache",
        lambda *_args, **_kwargs: existing_entry,
    )
    monkeypatch.setattr(
        pipeline,
        "read_verified_candidate",
        lambda *_args, **_kwargs: pytest.fail("candidate was inspected"),
    )

    assert _promote_candidate(tmp_path) is existing_entry
    assert final_path.read_bytes() == existing_bytes
    assert candidate_path.exists()


def test_failure_immediately_before_atomic_promotion_preserves_quarantine(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    candidate_path = candidate.write_metrics_candidate(
        tmp_path,
        _binding(),
        _payload(),
    )
    monkeypatch.setattr(
        pipeline,
        "_resume_entry_for_existing_cache",
        lambda *_args, **_kwargs: None,
    )
    monkeypatch.setattr(
        pipeline,
        "regular_artifact_completeness_issues",
        lambda *_args, **_kwargs: [],
    )
    monkeypatch.setattr(
        pipeline,
        "_resume_entry_for_document",
        lambda *_args, **_kwargs: {
            "solutionId": "fixture-land",
            "cachePath": str(cache_solution_path(tmp_path, "fixture-land")),
        },
    )
    monkeypatch.setattr(
        pipeline,
        "promote_metrics_candidate",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            RuntimeError("simulated pre-promotion crash")
        ),
    )

    with pytest.raises(RuntimeError, match="pre-promotion crash"):
        _promote_candidate(tmp_path)
    assert not cache_solution_path(tmp_path, "fixture-land").exists()
    assert candidate_path.exists()


def test_concurrent_atomic_promotions_write_exact_payload_once_safely(
    tmp_path: Path,
):
    binding = _binding()
    payload = _payload()
    candidate_path = candidate.write_metrics_candidate(tmp_path, binding, payload)
    final_path = cache_solution_path(tmp_path, "fixture-land")

    with ThreadPoolExecutor(max_workers=8) as executor:
        list(
            executor.map(
                lambda _index: candidate.promote_metrics_candidate(
                    tmp_path,
                    binding,
                    payload,
                    final_path,
                ),
                range(8),
            )
        )

    assert json.loads(final_path.read_text(encoding="utf-8")) == payload
    assert not candidate_path.exists()


def test_successful_generation_removes_matching_candidate(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setattr(
        pipeline,
        "regular_artifact_completeness_issues",
        lambda *_args, **_kwargs: [],
    )

    final_path = pipeline._finalize_solution_document(
        output_dir=tmp_path,
        solution_id="fixture-land",
        binding=_binding(),
        document=_payload(),
        national_only=False,
        domain="land",
        skip_species=False,
    )

    assert final_path == cache_solution_path(tmp_path, "fixture-land")
    assert final_path.exists()
    assert not candidate.candidate_path(tmp_path, "fixture-land").exists()


def test_concurrent_duplicate_candidate_writes_remain_coherent(tmp_path: Path):
    binding = _binding()
    payloads = [_payload(status=f"state-{index}") for index in range(8)]

    with ThreadPoolExecutor(max_workers=8) as executor:
        list(
            executor.map(
                lambda payload: candidate.write_metrics_candidate(
                    tmp_path,
                    binding,
                    payload,
                ),
                payloads,
            )
        )

    verified, issues = candidate.read_verified_candidate(tmp_path, binding)
    assert issues == []
    assert verified is not None
    assert verified.payload in payloads


@pytest.mark.parametrize(
    "solution_id", ["../escape", "nested/id", "/absolute", "bad id"]
)
def test_candidate_path_rejects_traversal(solution_id: str, tmp_path: Path):
    with pytest.raises(ValueError, match="unsafe solution id"):
        candidate.candidate_path(tmp_path, solution_id)


def test_quarantine_path_cannot_be_worker_cache_path(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    repo = tmp_path / "repo"
    worker = repo / "worker"
    quarantine = candidate.candidate_path(worker, "fixture-land")
    quarantine.parent.mkdir(parents=True)
    quarantine.write_text("{}", encoding="utf-8")
    monkeypatch.chdir(repo)

    with pytest.raises(ValueError, match="worker cachePath does not match"):
        _resolve_worker_cache_path(
            worker,
            solution_id="fixture-land",
            cache_path=quarantine.relative_to(repo).as_posix(),
        )


def test_candidate_envelope_cannot_supply_canonical_cache_path(tmp_path: Path):
    binding = _binding()
    path = candidate.write_metrics_candidate(tmp_path, binding, _payload())
    envelope = json.loads(path.read_text(encoding="utf-8"))

    assert "cachePath" not in envelope
    assert path.parent != cache_solution_path(tmp_path, "fixture-land").parent
    assert path.suffixes[-3:] == [".metrics", ".candidate", ".json"]


def test_quarantine_is_rejected_by_compaction_and_assembly_discovery(
    tmp_path: Path,
):
    binding = _binding()
    path = candidate.write_metrics_candidate(tmp_path, binding, _payload())
    envelope = json.loads(path.read_text(encoding="utf-8"))
    catalog = SolutionCatalog(
        catalog_version="0.2",
        release_id="v0.2",
        expected_total_count=1,
        expected_land_count=1,
        expected_marine_count=0,
        solutions=(
            SolutionCatalogEntry(
                solution_id="fixture-land",
                solution_basename="fixture-land.tif",
                domain="land",
                raster_sha256="b" * 64,
            ),
        ),
        source_path=tmp_path / "catalog.json",
    )

    with pytest.raises(ValueError, match="solutionId mismatch"):
        _validate_release_verbose_document(
            envelope,
            catalog=catalog,
            solution_id="fixture-land",
        )
    assert _local_relative_path(
        "regularVerbose",
        "fixture-land",
        None,
    ) == Path("regular/verbose/cache/fixture-land.metrics.json")


def test_failed_candidate_report_cannot_publish(tmp_path: Path):
    report_path = tmp_path / "publish-report.json"
    report_path.write_text(
        json.dumps(
            {
                "entries": [],
                "failures": [
                    {
                        "solutionId": "fixture-land",
                        "candidatePath": str(
                            candidate.candidate_path(tmp_path, "fixture-land")
                        ),
                    }
                ],
            }
        ),
        encoding="utf-8",
    )

    with pytest.raises(RuntimeError, match="generation failures"):
        _load_report_entries(report_path)
