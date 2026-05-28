from local_io import expected_cache_blob_path, expected_cache_public_url


def test_expected_cache_blob_path_defaults_to_production_prefix():
    assert expected_cache_blob_path("demo solution") == "metrics/cache/demo_solution.metrics.json"


def test_expected_cache_blob_path_accepts_staging_prefix():
    assert (
        expected_cache_blob_path(
            "demo solution",
            cache_blob_directory="/metrics/nick-runs/2026-05-27/cache/",
        )
        == "metrics/nick-runs/2026-05-27/cache/demo_solution.metrics.json"
    )


def test_expected_cache_public_url_uses_staging_prefix():
    assert (
        expected_cache_public_url(
            "https://example.test/",
            "demo solution",
            cache_blob_directory="metrics/nick-runs/2026-05-27/cache",
        )
        == "https://example.test/metrics/nick-runs/2026-05-27/cache/demo_solution.metrics.json"
    )
