"""Pipeline artifacts must be byte-identical on Windows and macOS.

Text-mode writes translate "\\n" to os.linesep unless newline="\\n" is pinned,
which would change artifact checksums on Windows. Each test writes through the
real helper into tmp_path and inspects the raw bytes.
"""

from __future__ import annotations

import ast
import hashlib
import importlib.util
import json
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

import backfill_land_use_of_aoi
import conservation_goals
import local_io
import mec_compact
import mesa_ecosystem_coverage
import metrics_candidate
import plan_solution_release
import prepare_regular_metrics_patch_release
import prepare_solution_release
import regenerate_frozen_signatures
import solution_catalog
import species_goals
import strategic_ecosystem_outcomes
from compact_metrics import convert_publish_report
from test_compact_metrics import _verbose_doc

PYTHON_ROOT = Path(__file__).resolve().parents[1]

MULTILINE_DOCUMENT = {
    "format": "line-ending-fixture-v1",
    "name": "Bogotá",
    "nested": {"values": [1, 2, 3], "label": "páramo"},
}


def _assert_lf_only(path: Path) -> bytes:
    raw = path.read_bytes()
    assert b"\r" not in raw, f"{path.name} contains carriage returns"
    assert raw.endswith(b"\n")
    return raw


def _load_script(relative_path: str, module_name: str, monkeypatch: pytest.MonkeyPatch):
    spec = importlib.util.spec_from_file_location(module_name, PYTHON_ROOT / relative_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    monkeypatch.setitem(sys.modules, module_name, module)
    spec.loader.exec_module(module)
    return module


def test_compact_metrics_artifact_hash_matches_lf_bytes(tmp_path: Path):
    input_dir = tmp_path / "generated" / "verbose"
    input_cache = input_dir / "cache"
    input_cache.mkdir(parents=True)
    verbose_path = input_cache / "demo_solution.metrics.json"
    verbose_path.write_text(json.dumps(_verbose_doc()), encoding="utf-8")
    (input_dir / "publish-report.json").write_text(
        json.dumps({
            "publicBlobHost": "https://example.test",
            "entries": [{
                "solutionId": "demo_solution",
                "cachePath": str(verbose_path.relative_to(tmp_path)),
            }],
        }),
        encoding="utf-8",
    )

    report = convert_publish_report(
        input_dir=input_dir,
        output_dir=tmp_path / "generated" / "compact",
        repo_root=tmp_path,
        cache_blob_directory="metrics/staged/compact",
    )

    entry = report["entries"][0]
    raw = _assert_lf_only(tmp_path / entry["cachePath"])
    assert entry["artifactSha256"] == hashlib.sha256(raw).hexdigest()


def test_conservation_goals_json_writer_emits_lf_only(tmp_path: Path):
    target = tmp_path / "goals.json"
    conservation_goals._write_json_atomic(target, MULTILINE_DOCUMENT)
    _assert_lf_only(target)


def test_local_io_cache_report_sidecar_and_example_writers_emit_lf_only(tmp_path: Path):
    written = [
        local_io.write_solution_cache(tmp_path, "demo_solution", MULTILINE_DOCUMENT),
        local_io.write_publish_report(tmp_path, MULTILINE_DOCUMENT),
        local_io.write_solution_sidecar(tmp_path, "demo_solution.tif", MULTILINE_DOCUMENT),
        local_io.write_example_output(
            tmp_path / "examples",
            "demo_solution",
            [{"metricId": "national_contribution", "value": 1.0}],
            "2026-10-21T00:00:00Z",
        ),
    ]
    for path in written:
        _assert_lf_only(path)


def test_metrics_candidate_json_writer_emits_lf_only(tmp_path: Path):
    target = tmp_path / "candidate.json"
    metrics_candidate._write_json_atomic(target, MULTILINE_DOCUMENT)
    _assert_lf_only(target)


def test_mec_compact_artifact_and_report_writers_emit_lf_only(tmp_path: Path):
    artifact = tmp_path / "national.mec.compact.json"
    mec_compact._write_minified_json(artifact, MULTILINE_DOCUMENT)
    report = mec_compact._write_report(tmp_path, MULTILINE_DOCUMENT)
    _assert_lf_only(artifact)
    _assert_lf_only(report)


def test_regular_patch_release_json_writer_emits_lf_only(tmp_path: Path):
    pretty = tmp_path / "pretty.json"
    compact = tmp_path / "compact.json"
    prepare_regular_metrics_patch_release._atomic_json(pretty, MULTILINE_DOCUMENT)
    prepare_regular_metrics_patch_release._atomic_json(compact, MULTILINE_DOCUMENT, compact=True)
    _assert_lf_only(pretty)
    _assert_lf_only(compact)


def test_solution_release_json_writer_emits_lf_only_and_accepts_rerun(tmp_path: Path):
    target = tmp_path / "catalog.json"
    prepare_solution_release._write_json(target, MULTILINE_DOCUMENT)
    prepare_solution_release._write_json(target, MULTILINE_DOCUMENT)
    raw = _assert_lf_only(target)
    expected = json.dumps(MULTILINE_DOCUMENT, indent=2, ensure_ascii=False, sort_keys=True) + "\n"
    assert raw == expected.encode("utf-8")


def test_release_bookkeeping_writers_emit_lf_only(tmp_path: Path):
    catalog = SimpleNamespace(release_id="test-release", catalog_version="0.1.0", sha256="a" * 64)
    marker = solution_catalog.bind_release_output(tmp_path / "bound", catalog=catalog, component="regular")
    plan = tmp_path / "plan.json"
    plan_solution_release.write_release_plan(plan, MULTILINE_DOCUMENT)
    signatures = tmp_path / "signatures.json"
    regenerate_frozen_signatures._write_json_atomic(signatures, MULTILINE_DOCUMENT)
    for path in (marker, plan, signatures):
        _assert_lf_only(path)


def test_outcome_coverage_and_backfill_writers_emit_lf_only(tmp_path: Path):
    outcomes = tmp_path / "outcomes.json"
    strategic_ecosystem_outcomes.write_json(outcomes, MULTILINE_DOCUMENT)
    coverage = tmp_path / "coverage.json"
    mesa_ecosystem_coverage.write_document(
        coverage, {**MULTILINE_DOCUMENT, "format": mesa_ecosystem_coverage.FORMAT}
    )
    backfill = tmp_path / "backfill.json"
    backfill_land_use_of_aoi.dump_metric_document(backfill, MULTILINE_DOCUMENT, compact=False)
    for path in (outcomes, coverage, backfill):
        _assert_lf_only(path)


def test_species_goals_completion_writer_emits_no_carriage_returns(tmp_path: Path):
    target = tmp_path / "goals.complete.json"
    species_goals._atomic_json_write(target, MULTILINE_DOCUMENT)
    assert b"\r" not in target.read_bytes()


def test_sirap_mesa_coverage_runner_atomic_writer_emits_lf_only(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    runner = _load_script(
        "scripts/run_sirap_mesa_ecosystem_coverage.py", "run_sirap_mesa_lf", monkeypatch
    )
    target = tmp_path / "STATUS.json"
    runner.atomic_write_json(target, MULTILINE_DOCUMENT, pretty=True)
    _assert_lf_only(target)


INLINE_CLI_WRITE_MODULES = (
    "metrics_pipeline/compact_metrics.py",
    "metrics_pipeline/main.py",
    "metrics_pipeline/mec_national_denominator.py",
    "metrics_pipeline/validation/validate_weighted_integration_ab.py",
    "sirap_release/main.py",
    "sirap_release/prepare_packet_manifest.py",
)


def _is_text_write_call(call: ast.Call) -> bool:
    function = call.func
    name = function.attr if isinstance(function, ast.Attribute) else getattr(function, "id", "")
    if name == "write_text":
        return True
    if name not in {"open", "fdopen"}:
        return False
    mode_arguments = [arg for arg in call.args if isinstance(arg, ast.Constant)]
    mode_arguments += [kw.value for kw in call.keywords if kw.arg == "mode"]
    return any(
        isinstance(mode, ast.Constant)
        and isinstance(mode.value, str)
        and "w" in mode.value
        and "b" not in mode.value
        for mode in mode_arguments
    )


def _pins_lf_newline(call: ast.Call) -> bool:
    return any(
        kw.arg == "newline" and isinstance(kw.value, ast.Constant) and kw.value.value == "\n"
        for kw in call.keywords
    )


def test_release_cli_inline_text_writes_pin_lf_newlines():
    unpinned = []
    for relative_path in INLINE_CLI_WRITE_MODULES:
        tree = ast.parse((PYTHON_ROOT / relative_path).read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, ast.Call) and _is_text_write_call(node) and not _pins_lf_newline(node):
                unpinned.append(f"{relative_path}:{node.lineno}")
    assert unpinned == []
