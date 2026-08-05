import io
import threading
from concurrent.futures import ThreadPoolExecutor

from local_io import cached_download, expected_cache_blob_path, expected_cache_public_url


def test_expected_cache_blob_path_defaults_to_production_prefix():
    assert expected_cache_blob_path("demo-solution") == "metrics/cache/demo-solution.metrics.json"


def test_expected_cache_blob_path_accepts_staging_prefix():
    assert (
        expected_cache_blob_path(
            "demo-solution",
            cache_blob_directory="/metrics/nick-runs/2026-05-27/cache/",
        )
        == "metrics/nick-runs/2026-05-27/cache/demo-solution.metrics.json"
    )


def test_expected_cache_public_url_uses_staging_prefix():
    assert (
        expected_cache_public_url(
            "https://example.test/",
            "demo-solution",
            cache_blob_directory="metrics/nick-runs/2026-05-27/cache",
        )
        == "https://example.test/metrics/nick-runs/2026-05-27/cache/demo-solution.metrics.json"
    )


def test_cached_download_is_safe_under_concurrency(tmp_path, monkeypatch):
    calls = 0
    calls_lock = threading.Lock()

    class Response(io.BytesIO):
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            self.close()

    def fake_urlopen(_request, timeout):
        nonlocal calls
        assert timeout == 120
        with calls_lock:
            calls += 1
        return Response(b"coherent-download")

    monkeypatch.setattr("local_io.urllib.request.urlopen", fake_urlopen)
    with ThreadPoolExecutor(max_workers=4) as executor:
        results = list(
            executor.map(
                lambda _: cached_download(
                    "https://example.test/input.tif",
                    tmp_path,
                ),
                range(4),
            )
        )

    assert calls == 1
    assert len({result.sha256 for result in results}) == 1
    assert results[0].path.read_bytes() == b"coherent-download"
