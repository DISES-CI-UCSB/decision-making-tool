from pathlib import Path

import pytest

from compact_metrics import (
    expected_compact_blob_path,
    expected_compact_public_url,
)
from conservation_goals import (
    expected_goals_blob_path,
    expected_goals_public_url,
    goals_output_path,
)
from local_io import (
    cache_solution_path,
    expected_cache_blob_path,
    expected_cache_public_url,
)
from path_contracts import safe_solution_id


SOLUTION_ID = "demo-solution_one"
SAFE_SOLUTION_ID = SOLUTION_ID


def test_safe_solution_id_preserves_canonical_identifier():
    assert safe_solution_id(SOLUTION_ID) == SAFE_SOLUTION_ID


@pytest.mark.parametrize(
    "solution_id",
    (
        "",
        "../escape",
        "demo/escape",
        "demo escape",
        "demo\\escape",
        ".hidden",
        "demo\nid",
        "demo@id",
        "Demo",
        "demo.id",
        "demo+id",
        "demo(id)",
        "_demo",
        "demo-",
        "demo__id",
        "demo--id",
        "demo_-id",
        "demo-_id",
    ),
)
def test_safe_solution_id_rejects_unsafe_values(solution_id: str):
    with pytest.raises(ValueError, match="unsafe solution id"):
        safe_solution_id(solution_id)


def test_cache_paths_share_safe_solution_id_contract():
    output_dir = Path("generated")

    assert cache_solution_path(output_dir, SOLUTION_ID) == (
        output_dir / "cache" / f"{SAFE_SOLUTION_ID}.metrics.json"
    )
    assert expected_cache_blob_path(SOLUTION_ID) == (
        f"metrics/cache/{SAFE_SOLUTION_ID}.metrics.json"
    )
    assert expected_cache_public_url("https://example.test/", SOLUTION_ID) == (
        f"https://example.test/metrics/cache/{SAFE_SOLUTION_ID}.metrics.json"
    )


def test_compact_paths_share_safe_solution_id_contract():
    assert expected_compact_blob_path(SOLUTION_ID) == (
        "metrics/nick-runs/2026-05-27/compact-cache/"
        f"{SAFE_SOLUTION_ID}.metrics.compact.json"
    )
    assert expected_compact_public_url("https://example.test/", SOLUTION_ID) == (
        "https://example.test/metrics/nick-runs/2026-05-27/compact-cache/"
        f"{SAFE_SOLUTION_ID}.metrics.compact.json"
    )


def test_goals_paths_share_safe_solution_id_contract():
    output_dir = Path("generated")

    assert goals_output_path(output_dir, SOLUTION_ID) == (
        output_dir / "cache" / f"{SAFE_SOLUTION_ID}.goals.json"
    )
    assert expected_goals_blob_path(SOLUTION_ID) == (
        f"metrics/goals/{SAFE_SOLUTION_ID}.goals.json"
    )
    assert expected_goals_public_url("https://example.test/", SOLUTION_ID) == (
        f"https://example.test/metrics/goals/{SAFE_SOLUTION_ID}.goals.json"
    )


def test_custom_blob_directories_and_hosts_are_normalized_consistently():
    assert expected_cache_blob_path(
        SOLUTION_ID,
        cache_blob_directory="/staged/cache/",
    ) == f"staged/cache/{SAFE_SOLUTION_ID}.metrics.json"
    assert expected_compact_blob_path(
        SOLUTION_ID,
        cache_blob_directory="/staged/compact/",
    ) == f"staged/compact/{SAFE_SOLUTION_ID}.metrics.compact.json"
    assert expected_goals_blob_path(
        SOLUTION_ID,
        goals_blob_directory="/staged/goals/",
    ) == f"staged/goals/{SAFE_SOLUTION_ID}.goals.json"
