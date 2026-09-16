"""National-only calculator-A rebuild invoke-path guards."""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

BUILD_SCRIPT = Path(__file__).resolve().parents[1] / "run_species_goals_full_build.py"
REQUIRED = [
    "--output-root",
    "--cache-dir",
    "--release-cache",
    "--species-csv",
    "--species-exception",
    "--solution-catalog",
]


def _full_build():
    spec = importlib.util.spec_from_file_location(
        "run_species_goals_full_build", BUILD_SCRIPT
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def _required_paths(tmp_path: Path) -> list[str]:
    argv: list[str] = []
    for flag in REQUIRED:
        argv.extend([flag, str(tmp_path / flag.removeprefix("--"))])
    return argv


def test_skip_published_fingerprint_requires_flag_and_known_inventory(monkeypatch):
    module = _full_build()
    local = {"availableExpected": 8300, "excluded": 0}
    published = {"availableExpected": 8298, "excluded": 2}
    assert (
        module._skip_published_target_policy_fingerprint(
            local_provenance=local,
            published_provenance=published,
            national_only=False,
        )
        is False
    )
    monkeypatch.setenv("METRICS_SPECIES_GOALS_SKIP_PUBLISHED_FINGERPRINT", "1")
    assert (
        module._skip_published_target_policy_fingerprint(
            local_provenance=local,
            published_provenance=published,
            national_only=False,
        )
        is True
    )
    assert (
        module._skip_published_target_policy_fingerprint(
            local_provenance=local,
            published_provenance=published,
            national_only=True,
        )
        is True
    )
    assert (
        module._skip_published_target_policy_fingerprint(
            local_provenance=local,
            published_provenance={"availableExpected": 8290, "excluded": 10},
            national_only=False,
        )
        is False
    )


def test_target_policy_full_geo_raises_unless_skip_flag(monkeypatch, tmp_path: Path):
    module = _full_build()
    solution_id = "eco17_estr17_esprep17_runap_iheh2022"
    goals_path = tmp_path / "goals.json"
    goals_path.write_text(
        json.dumps(
            {
                "solutionId": solution_id,
                "targetContext": {
                    "targetFeatureSet": "species",
                    "finderTargetPercent": 17,
                    "structuredTargets": {"sourceEvaluation": "final_summary_csv"},
                },
            }
        ),
        encoding="utf-8",
    )
    published = {
        "metricsProvenance": {
            "speciesTargetPolicy": {"availableExpected": 8298, "excluded": 2},
            "inputAlignment": {"sha256": "a" * 64},
        }
    }
    monkeypatch.setattr(
        module,
        "cached_download",
        lambda *_args, **_kwargs: SimpleNamespace(path=goals_path),
    )
    monkeypatch.setattr(
        module,
        "resolve_species_target_policy",
        lambda *_args, **_kwargs: SimpleNamespace(
            provenance={"availableExpected": 8300, "excluded": 0}
        ),
    )
    monkeypatch.setattr(
        module, "_published_document", lambda *_args, **_kwargs: (published, "sha")
    )

    monkeypatch.delenv("METRICS_SPECIES_GOALS_SKIP_PUBLISHED_FINGERPRINT", raising=False)
    with pytest.raises(ValueError, match="target provenance mismatch"):
        module._target_policy(
            solution_id, tmp_path, [], [], national_only=False
        )

    monkeypatch.setenv("METRICS_SPECIES_GOALS_SKIP_PUBLISHED_FINGERPRINT", "1")
    module._target_policy(solution_id, tmp_path, [], [], national_only=False)
    module._target_policy(solution_id, tmp_path, [], [], national_only=True)

    other = {
        "metricsProvenance": {
            "speciesTargetPolicy": {"availableExpected": 8290, "excluded": 10},
            "inputAlignment": {"sha256": "a" * 64},
        }
    }
    monkeypatch.setattr(
        module, "_published_document", lambda *_args, **_kwargs: (other, "sha")
    )
    with pytest.raises(ValueError, match="target provenance mismatch"):
        module._target_policy(solution_id, tmp_path, [], [], national_only=False)


def test_national_only_active_levels_skip_aoi_partitions(monkeypatch):
    module = _full_build()
    monkeypatch.setenv("METRICS_SPECIES_GOALS_NATIONAL_ONLY", "1")
    assert module._active_geography_levels() == ("national",)
    monkeypatch.setenv("METRICS_SPECIES_GOALS_NATIONAL_ONLY", "0")
    assert module._active_geography_levels() == module.GEOGRAPHY_LEVELS


def test_national_only_defaults_to_six_workers_and_rejects_full_geo_override():
    module = _full_build()
    assert module._resolve_worker_count(national_only=True, requested=None) == 6
    assert module._resolve_worker_count(national_only=True, requested=6) == 6
    assert module._resolve_worker_count(national_only=False, requested=None) == 3
    with pytest.raises(ValueError, match="exactly 3 workers"):
        module._resolve_worker_count(national_only=False, requested=6)
    with pytest.raises(ValueError, match="between 1 and 8"):
        module._resolve_worker_count(national_only=True, requested=9)


def test_parse_args_allows_six_workers_only_with_national_only(tmp_path: Path):
    module = _full_build()
    required = _required_paths(tmp_path)
    parsed = module._parse_args([*required, "--national-only", "--workers", "6"])
    assert parsed.national_only is True
    assert parsed.workers == 6
    with pytest.raises(SystemExit):
        module._parse_args([*required, "--workers", "6"])


def test_smsp_paths_reject_split_plant_and_stub_amphibian_cache(
    tmp_path: Path, monkeypatch
):
    module = _full_build()
    cache = tmp_path / "species"
    cache.mkdir()
    for stem in ("amphibians", "birds", "mammals", "plants", "plants-1", "reptiles"):
        (cache / f"{stem}.smtx.gz").write_bytes(b"x")
    monkeypatch.setattr(module, "DEFAULT_SMSP_DIR", cache)
    with pytest.raises(ValueError, match="species-goals-calculator-a"):
        module._species_goals_matrix_paths()


def test_full_geo_worker_scores_from_smsp_without_maxent_tiffs():
    module = _full_build()
    source = Path(module.__file__).read_text(encoding="utf-8")
    assert "record_species_goals_from_smsp(" in source
    assert "_process_species_for_solution(" not in source
    assert "require MAXENT TIFFs" in source


def test_smsp_paths_accept_calculator_a_stems(tmp_path: Path, monkeypatch):
    module = _full_build()
    cache = tmp_path / "species-goals-calculator-a"
    cache.mkdir()
    for stem in ("amphibians", "birds", "mammals", "plants", "reptiles"):
        (cache / f"{stem}.smtx.gz").write_bytes(b"x")
    monkeypatch.setattr(module, "DEFAULT_SMSP_DIR", cache)
    paths = module._species_goals_matrix_paths()
    assert [path.name.removesuffix(".smtx.gz") for path in paths] == [
        "amphibians",
        "birds",
        "mammals",
        "plants",
        "reptiles",
    ]
