import copy
import json
from pathlib import Path
from types import SimpleNamespace

import main as pipeline
import metrics_candidate as candidate
import numpy as np
from blob_manifest import ResolvedManifest
from local_io import CachedDownload
from raster_metrics import RasterFingerprint
from species_data import SpeciesRecord
from species_solution_batch import BatchRunStats, CategoryMatrix, ExactOverlapInput
from species_target_policy import SpeciesTargetPolicy


def _fingerprint():
    return RasterFingerprint(
        width=2,
        height=2,
        transform=(1.0, 0.0, 0.0, 0.0, -1.0, 2.0),
        crs="EPSG:9377",
    )


def _canonical_document(document):
    value = copy.deepcopy(document)
    value.pop("generatedAt", None)
    value.pop("speciesExecution", None)
    return value


def test_main_fixture_orchestrates_independent_and_guarded_microbatch(
    monkeypatch,
    tmp_path,
):
    solution_ids = ["solution-c", "solution-a", "solution-b"]
    solutions = [
        {
            "id": solution_id,
            "domain": "land",
            "rasterFile": f"{solution_id}.tif",
        }
        for solution_id in solution_ids
    ]
    manifest = ResolvedManifest(
        url="fixture://manifest",
        raw={"generatedAt": "fixture"},
        public_blob_host="https://example.test",
        layers_by_id={},
        national_solutions=solutions,
        batch_solutions=solutions,
    )
    record = SpeciesRecord(
        scientific_name="Species one",
        csv_class="Mammalia",
        iucn_status="VU",
        range_km2=1.0,
        bucket="mammals",
        threatened=True,
    )
    fingerprint = _fingerprint()
    downloads = {}
    for index, solution_id in enumerate(solution_ids):
        path = tmp_path / f"{solution_id}.tif"
        path.write_bytes(bytes([index]))
        downloads[solution_id] = CachedDownload(
            url=f"fixture://{solution_id}",
            path=path,
            sha256=str(index + 1) * 64,
            bytes=1,
        )
    species_path = tmp_path / "species.csv"
    species_path.write_text("fixture", encoding="utf-8")
    species_download = CachedDownload(
        url="fixture://species",
        path=species_path,
        sha256="a" * 64,
        bytes=7,
    )
    overlap_path = tmp_path / "overlap.npz"
    overlap_path.write_bytes(b"fixture")
    overlap_input = ExactOverlapInput(
        path=overlap_path,
        expected_sha256="b" * 64,
        expected_bytes=7,
    )
    alignment = {
        "format": "metrics-alignment-inventory-v4",
        "domains": {
            "land": {
                "domain": "land",
                "alignedInputs": 1,
                "expectedAlignedInputs": 1,
                "targetGridSha256": "c" * 64,
                "sha256": "d" * 64,
            }
        },
        "cacheStorage": {
            "completePairBytes": 0,
            "estimatedReleaseBytes": 0,
            "configuredMaxBytes": 1,
        },
    }
    reports = {}
    processed = []
    batch_calls = []
    fail_on_finalize = set()
    identity_drift = {}

    monkeypatch.setattr(pipeline, "fetch_manifest", lambda _url: manifest)
    monkeypatch.setattr(pipeline, "_validate_required_layers", lambda _manifest: [])
    monkeypatch.setattr(
        pipeline,
        "_preflight_solution_rasters",
        lambda *_args, **_kwargs: (downloads, []),
    )
    monkeypatch.setattr(
        pipeline,
        "cached_download",
        lambda *_args, **_kwargs: species_download,
    )
    monkeypatch.setattr(pipeline, "load_species_records", lambda _path: [record])
    monkeypatch.setattr(
        pipeline,
        "resolve_species_target_policy",
        lambda *_args, **_kwargs: SpeciesTargetPolicy(
            "scalar",
            30.0,
            {},
            {"kind": "scalar"},
        ),
    )
    monkeypatch.setattr(
        pipeline,
        "_preflight_aligned_inputs",
        lambda *_args, **_kwargs: (object(), alignment, []),
    )
    monkeypatch.setattr(pipeline, "_LayerMaskCache", lambda _cache: object())
    monkeypatch.setattr(pipeline, "_LayerValueCache", lambda _cache: object())
    monkeypatch.setattr(
        pipeline,
        "read_solution_raster",
        lambda _path: SimpleNamespace(fingerprint=fingerprint),
    )
    monkeypatch.setattr(
        pipeline,
        "discover_exact_overlap_inventory",
        lambda *_args, **_kwargs: (
            [overlap_input],
            {
                "inventorySha256": "e" * 64,
                "speciesCount": 1,
                "entriesSha256": "f" * 64,
            },
        ),
    )

    def load_matrix(paths):
        columns = len(paths)
        values = np.arange(4 * columns, dtype=np.uint8).reshape(4, columns) % 3
        return CategoryMatrix(values=values, fingerprint=fingerprint)

    monkeypatch.setattr(pipeline, "load_category_matrix", load_matrix)
    monkeypatch.setattr(
        pipeline,
        "_alignment_provenance_for_solution",
        lambda *_args: {
            "domain": "land",
            "targetGridSha256": "c" * 64,
            "sha256": "d" * 64,
        },
    )
    monkeypatch.setattr(
        pipeline,
        "build_metrics_provenance",
        lambda *_args, species_execution=None, **_kwargs: {
            "inputAlignment": {"sha256": "d" * 64},
            "boundaryProvenance": {"sha256": "0" * 64},
            "generationConfig": {"speciesExecution": species_execution},
        },
    )
    monkeypatch.setattr(
        pipeline,
        "_solution_source_identity",
        lambda *_args, **_kwargs: {},
    )
    monkeypatch.setattr(
        pipeline,
        "build_solution_input_signature",
        lambda **_kwargs: {"sha256": "1" * 64},
    )
    monkeypatch.setattr(
        pipeline,
        "_promote_resumable_candidate",
        lambda **_kwargs: (_ for _ in ()).throw(
            AssertionError("candidate reuse must remain disabled")
        ),
    )

    def process_batch(**kwargs):
        batch_calls.append(
            {
                "columns": kwargs["categories"].shape[1],
                "active": [
                    accumulator is not None for accumulator in kwargs["accumulators"]
                ],
            }
        )
        return BatchRunStats(
            species_processed=1,
            npz_opens=1,
            npz_bytes=7,
            exact_read_seconds=0.0,
            evaluation_seconds=0.0,
            accumulator_seconds=0.0,
        )

    monkeypatch.setattr(pipeline, "process_exact_species_batch", process_batch)

    def process_solution(**kwargs):
        solution_id = kwargs["solution"]["id"]
        processed.append(solution_id)
        if identity_drift:
            expected_execution = kwargs["species_execution"]
            actual_execution = {**expected_execution, **identity_drift}
            binding = candidate.CandidateBinding(
                release_id=None,
                catalog_binding=None,
                solution_id=solution_id,
                solution_domain="land",
                raster_basename=f"{solution_id}.tif",
                raster_sha256=downloads[solution_id].sha256,
                solution_input_signature={"sha256": "1" * 64},
                metrics_schema_version=4,
                catalog_signature="fixture",
                species_target_policy=None,
                boundary_fanout=pipeline.boundary_fanout_identity("grouped"),
                species_execution=expected_execution,
            )
            document = {
                "solutionId": solution_id,
                "solutionRaster": {
                    "solutionBasename": f"{solution_id}.tif",
                    "sha256": downloads[solution_id].sha256,
                },
                "solutionInputSignature": {"sha256": "1" * 64},
                "solutionCatalogBinding": None,
                "metricsProvenance": {
                    "schemaVersion": 4,
                    "solutionDomain": "land",
                    "catalogSignature": "fixture",
                    "releaseId": None,
                    "speciesTargetPolicy": None,
                    "generationConfig": {
                        "boundaryFanout": pipeline.boundary_fanout_identity("grouped"),
                        "speciesExecution": actual_execution,
                    },
                },
            }
            path = candidate.write_metrics_candidate(
                kwargs["output_dir"],
                binding,
                document,
            )
            verified, issues = candidate.read_verified_candidate(
                kwargs["output_dir"],
                binding,
            )
            assert verified is None
            assert issues == [
                "candidate payload metrics provenance speciesExecution mismatch"
            ]
            raise pipeline.MetricsCandidateValidationError(path, issues)
        if solution_id in fail_on_finalize:
            raise RuntimeError("sink close failed")
        document = {
            "solutionId": solution_id,
            "generatedAt": "runtime",
            "speciesExecution": kwargs["species_execution"],
            "details": {"speciesProcessed": 1, "value": 42},
        }
        (kwargs["output_dir"] / "cache").mkdir(parents=True, exist_ok=True)
        (kwargs["output_dir"] / "cache" / f"{solution_id}.metrics.json").write_text(
            json.dumps(document),
            encoding="utf-8",
        )
        return {
            "solutionId": solution_id,
            "cachePath": f"cache/{solution_id}.metrics.json",
            "geographyLevels": ["national"],
        }

    monkeypatch.setattr(pipeline, "_process_solution", process_solution)

    def write_report(output_dir, report):
        reports[Path(output_dir).name] = copy.deepcopy(report)
        path = Path(output_dir) / "publish-report.json"
        path.write_text(json.dumps(report), encoding="utf-8")
        return path

    monkeypatch.setattr(pipeline, "write_publish_report", write_report)

    def run(mode, output_name, *, fanout):
        monkeypatch.setenv("METRICS_SPECIES_EXECUTION", mode)
        monkeypatch.setenv("METRICS_BOUNDARY_FANOUT", fanout)
        if mode == "solution-microbatch-v1":
            monkeypatch.setenv("METRICS_SPECIES_BATCH_SIZE", "2")
        return pipeline.main(
            [
                "--national-only",
                "--cache-policy",
                "recompute-all",
                "--cache-dir",
                str(tmp_path / "cache"),
                "--output-dir",
                str(tmp_path / output_name),
            ]
        )

    monkeypatch.setenv("METRICS_SPECIES_EXECUTION", "solution-microbatch-v1")
    monkeypatch.setenv("METRICS_BOUNDARY_FANOUT", "grouped")
    assert pipeline.main(["--national-only"]) == 2
    monkeypatch.setenv("METRICS_BOUNDARY_FANOUT", "legacy")
    assert (
        pipeline.main(["--national-only", "--cache-policy", "recompute-all"]) == 2
    )

    assert run("independent", "independent", fanout="legacy") == 0
    independent_order = processed.copy()
    processed.clear()
    assert run("solution-microbatch-v1", "microbatch", fanout="grouped") == 0

    assert independent_order == solution_ids
    assert processed == solution_ids
    assert batch_calls == [
        {"columns": 2, "active": [True, True]},
        {"columns": 1, "active": [True]},
    ]
    microbatch_report = reports["microbatch"]
    assert not microbatch_report["resumeEnabled"]
    assert [
        batch["orderedSolutionIds"]
        for batch in microbatch_report["speciesExecution"]["batches"]
    ] == [solution_ids[:2], solution_ids[2:]]
    for ordinal, batch_ids in enumerate((solution_ids[:2], solution_ids[2:])):
        for solution_id in batch_ids:
            document = json.loads(
                (
                    tmp_path
                    / "microbatch"
                    / "cache"
                    / f"{solution_id}.metrics.json"
                ).read_text(encoding="utf-8")
            )
            execution = document["speciesExecution"]
            assert execution["batchOrdinal"] == ordinal
            assert execution["batchSize"] == 2
            assert execution["actualBatchSize"] == len(batch_ids)
            assert execution["orderedSolutionIds"] == batch_ids
            independent_document = json.loads(
                (
                    tmp_path
                    / "independent"
                    / "cache"
                    / f"{solution_id}.metrics.json"
                ).read_text(encoding="utf-8")
            )
            assert _canonical_document(document) == _canonical_document(
                independent_document
            )

    processed.clear()
    fail_on_finalize.add("solution-a")
    assert run("solution-microbatch-v1", "close-failure", fanout="grouped") == 1
    assert processed == solution_ids
    close_report = reports["close-failure"]
    assert [entry["solutionId"] for entry in close_report["entries"]] == [
        "solution-c",
        "solution-b",
    ]
    assert [failure["solutionId"] for failure in close_report["failures"]] == [
        "solution-a"
    ]

    fail_on_finalize.clear()
    for field, changed_value in (
        ("orderedSolutionIds", list(reversed(solution_ids[:2]))),
        ("batchOrdinal", 99),
        ("batchSize", 99),
        ("actualBatchSize", 99),
    ):
        processed.clear()
        identity_drift[field] = changed_value
        output_name = f"identity-drift-{field}"
        assert run("solution-microbatch-v1", output_name, fanout="grouped") == 1
        assert processed == solution_ids
        drift_report = reports[output_name]
        assert [failure["solutionId"] for failure in drift_report["failures"]] == (
            solution_ids
        )
        assert all(
            failure["validationIssues"]
            == ["candidate payload metrics provenance speciesExecution mismatch"]
            for failure in drift_report["failures"]
        )
        identity_drift.clear()
