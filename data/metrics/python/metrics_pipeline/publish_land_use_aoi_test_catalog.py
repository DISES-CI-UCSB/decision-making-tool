"""Publish a TEST land-use-of-AOI catalog to Vercel Blob.

Hard bans (enforced before every put):
- Do not write manifest/manifest.json
- Do not write catalog-releases/3.0.5/ (production index)
- Do not write catalog-releases/3.0.5/*.json without the -land-use-aoi-test suffix
- Do not write releases/solutions-v3-0-0/ or catalog-releases/3.0.5/ compact/release prefixes
- Do not pass --force
- Do not upload verbose *.metrics.json
- Never print BLOB_READ_WRITE_TOKEN

Test prefixes only:
- releases/catalog-v3-0-5-land-use-aoi-test/
- catalog-releases/3.0.5-land-use-aoi-test/
- releases/sirap-2026-09-02-v6-land-use-aoi-test/

catalogVersion stays 3.0.5 because the app requires /^\\d+\\.\\d+\\.\\d+$/.
releaseId and blob paths carry the test identity.

Usage (repo root):

    python data/metrics/python/metrics_pipeline/publish_land_use_aoi_test_catalog.py
    python data/metrics/python/metrics_pipeline/publish_land_use_aoi_test_catalog.py --dry-run
    python data/metrics/python/metrics_pipeline/publish_land_use_aoi_test_catalog.py --manifests-only
    python data/metrics/python/metrics_pipeline/publish_land_use_aoi_test_catalog.py --sirap
    python data/metrics/python/metrics_pipeline/publish_land_use_aoi_test_catalog.py --sirap --dry-run
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

PUBLIC_BLOB_HOST = "https://aagibolq28slyfof.public.blob.vercel-storage.com"
BLOB_TOKEN_ENV_VAR = "BLOB_READ_WRITE_TOKEN"
LIVE_NATIONAL_MANIFEST_URL = f"{PUBLIC_BLOB_HOST}/manifest/manifest.json"
LIVE_CATALOG_INDEX_URL = (
    f"{PUBLIC_BLOB_HOST}/catalog-releases/3.0.5/catalog-release-index.json"
)
LIVE_SIRAP_MANIFEST_URL = (
    f"{PUBLIC_BLOB_HOST}/releases/sirap-2026-09-02-v6/manifest.json"
)

TEST_RELEASE_ID = "catalog-v3-0-5-land-use-aoi-test"
TEST_CATALOG_VERSION = "3.0.5"
TEST_COMPACT_PREFIX = "releases/catalog-v3-0-5-land-use-aoi-test/regular/compact"
TEST_NATIONAL_MANIFEST_PATH = (
    "releases/catalog-v3-0-5-land-use-aoi-test/manifest.json"
)
TEST_CATALOG_INDEX_PATH = (
    "catalog-releases/3.0.5-land-use-aoi-test/catalog-release-index.json"
)
TEST_SIRAP_PREFIX = "releases/sirap-2026-09-02-v6-land-use-aoi-test/"
TEST_SIRAP_COMPACT_PREFIX = TEST_SIRAP_PREFIX + "regular/compact/cache"
TEST_SIRAP_MANIFEST_PATH = TEST_SIRAP_PREFIX + "manifest.json"

ALLOWED_PREFIXES = (
    "releases/catalog-v3-0-5-land-use-aoi-test/",
    "catalog-releases/3.0.5-land-use-aoi-test/",
    TEST_SIRAP_PREFIX,
)
DENIED_EXACT_PATHS = frozenset(
    {
        "manifest/manifest.json",
        "catalog-releases/3.0.5/catalog-release-index.json",
    }
)
DENIED_PREFIXES = (
    "manifest/",
    "catalog-releases/3.0.5/",
    "catalog-releases/3.0.4/",
    "catalog-releases/3.0.3/",
    "catalog-releases/3.0.2/",
    "catalog-releases/3.0.1/",
    "releases/solutions-v3-0-0/",
    "releases/solutions-v3-0-1/",
    "releases/sirap-2026-09-02-v6/",
)

LOCAL_COMPACT_REL = (
    "data/metrics/generated/releases/solutions-v3-0-1-20260903-land-use-class-remap"
    "/blob-publish/compact-cache"
)
WORK_REL = (
    "data/metrics/generated/releases/solutions-v3-0-1-20260903-land-use-class-remap"
    "/blob-publish"
)
SIRAP_LOCAL_COMPACT_REL = (
    "data/metrics/generated/releases/sirap-2026-09-02-v6-land-use-of-aoi"
    "/regular/compact/cache"
)
SIRAP_WORK_REL = (
    "data/metrics/generated/releases/sirap-2026-09-02-v6-land-use-of-aoi/blob-publish"
)


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def find_repo_root() -> Path:
    current = Path(__file__).resolve()
    for candidate in [current, *current.parents]:
        if (candidate / ".git").exists():
            return candidate
    raise RuntimeError("could not find repo root")


def load_token(repo_root: Path) -> str:
    for filename in (".env.local", ".env.production.local", ".env"):
        path = repo_root / filename
        if not path.exists():
            continue
        for line in path.read_text(encoding="utf-8").splitlines():
            stripped = line.strip()
            if stripped.startswith("#") or "=" not in stripped:
                continue
            name, _, value = stripped.partition("=")
            if name.strip() != BLOB_TOKEN_ENV_VAR:
                continue
            value = value.strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                value = value[1:-1]
            if value:
                return value
    raise RuntimeError(f"{BLOB_TOKEN_ENV_VAR} is missing from .env.local")


def _redact(text: str, token: str) -> str:
    if not token:
        return text
    return text.replace(token, "[redacted]")


def assert_test_blob_path(blob_path: str) -> None:
    if blob_path in DENIED_EXACT_PATHS:
        raise RuntimeError(f"refusing production path: {blob_path}")
    if any(blob_path == prefix.rstrip("/") or blob_path.startswith(prefix) for prefix in DENIED_PREFIXES):
        raise RuntimeError(f"refusing production prefix path: {blob_path}")
    if not blob_path.startswith(ALLOWED_PREFIXES):
        raise RuntimeError(f"refusing path outside test prefixes: {blob_path}")
    if blob_path.endswith(".metrics.json") and not blob_path.endswith(
        ".metrics.compact.json"
    ):
        raise RuntimeError(f"refusing verbose metrics upload: {blob_path}")
    if "--force" in blob_path:
        raise RuntimeError("refusing path that looks like a force flag")


def public_url(blob_path: str) -> str:
    return f"{PUBLIC_BLOB_HOST}/{blob_path}"


def compact_blob_path(solution_id: str) -> str:
    return f"{TEST_COMPACT_PREFIX}/{solution_id}.metrics.compact.json"


def sirap_compact_blob_path(solution_id: str) -> str:
    path = f"{TEST_SIRAP_COMPACT_PREFIX}/{solution_id}.metrics.compact.json"
    if path.startswith("releases/sirap-2026-09-02-v6/") and not path.startswith(TEST_SIRAP_PREFIX):
        raise RuntimeError(f"refusing live SIRAP compact path: {path}")
    return path


def remote_exists(url: str) -> bool:
    request = urllib.request.Request(url, method="HEAD", headers={"User-Agent": "dises-test-catalog-publisher/1"})
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return 200 <= response.status < 300
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            return False
        raise


def fetch_json(url: str) -> dict:
    request = urllib.request.Request(url, headers={"User-Agent": "dises-test-catalog-publisher/1"})
    with urllib.request.urlopen(request, timeout=180) as response:
        return json.loads(response.read().decode("utf-8"))


def delete_test_blob(token: str, blob_path: str) -> None:
    """Delete a test-prefix blob so a later put can replace it without --force."""
    assert_test_blob_path(blob_path)
    command = [
        "vercel",
        "blob",
        "del",
        blob_path,
        "--rw-token",
        token,
        "--no-color",
    ]
    if "--force" in command:
        raise RuntimeError("internal error: --force must never be passed")
    completed = subprocess.run(command, check=False, capture_output=True, text=True)
    output = _redact(f"{completed.stdout}\n{completed.stderr}", token).strip()
    if completed.returncode != 0:
        raise RuntimeError(output or f"vercel blob del failed with code {completed.returncode}")


def put_blob(
    token: str,
    local_path: Path,
    blob_path: str,
    *,
    cache_control_max_age: int | None = None,
) -> str:
    assert_test_blob_path(blob_path)
    # Do NOT pass --add-random-suffix. The Vercel CLI treats any provided
    # value, including "false", as truthy and appends a suffix.
    command = [
        "vercel",
        "blob",
        "put",
        str(local_path),
        "--pathname",
        blob_path,
        "--rw-token",
        token,
        "--content-type",
        "application/json",
        "--no-color",
    ]
    if cache_control_max_age is not None:
        command.extend(["--cache-control-max-age", str(cache_control_max_age)])
    if "--force" in command:
        raise RuntimeError("internal error: --force must never be passed")
    completed = subprocess.run(command, check=False, capture_output=True, text=True)
    output = _redact(f"{completed.stdout}\n{completed.stderr}", token).strip()
    if completed.returncode != 0:
        raise RuntimeError(output or f"vercel blob put failed with code {completed.returncode}")
    uploaded_url = None
    for token_like in output.split():
        if token_like.startswith("https://"):
            uploaded_url = token_like.rstrip(".,;")
            break
    expected_url = public_url(blob_path)
    if uploaded_url and uploaded_url.rstrip("/") != expected_url:
        raise RuntimeError(
            f"upload landed on unexpected URL (possible random suffix): {uploaded_url}"
        )
    return uploaded_url or expected_url


def local_compact_files(repo_root: Path) -> dict[str, Path]:
    cache_dir = repo_root / LOCAL_COMPACT_REL
    files = sorted(cache_dir.glob("*.metrics.compact.json"))
    mapping: dict[str, Path] = {}
    for path in files:
        if path.name.endswith(".metrics.json") and not path.name.endswith(
            ".metrics.compact.json"
        ):
            raise RuntimeError(f"refusing verbose metrics file: {path}")
        solution_id = path.name.removesuffix(".metrics.compact.json")
        mapping[solution_id] = path
    land_ids = [sid for sid in mapping if not sid.startswith("marine_")]
    marine_ids = [sid for sid in mapping if sid.startswith("marine_")]
    if len(land_ids) != 168 or len(marine_ids) != 4:
        raise RuntimeError(
            "expected 168 land + 4 marine compact files, "
            f"found land={len(land_ids)} marine={len(marine_ids)}"
        )
    return mapping


def rewrite_national_manifest(
    live_manifest: dict,
    land_ids: set[str],
) -> dict:
    solutions = live_manifest.get("solutions")
    if not isinstance(solutions, list) or len(solutions) != 172:
        raise RuntimeError(
            f"live national manifest must have 172 solutions, found {len(solutions or [])}"
        )
    rewritten_land = 0
    rewritten_marine = 0
    for solution in solutions:
        solution_id = str(solution.get("id") or "")
        domain = str(solution.get("domain") or "")
        urls = solution.get("precomputedMetricUrls")
        if not isinstance(urls, dict):
            raise RuntimeError(f"{solution_id} missing precomputedMetricUrls")
        if solution_id not in land_ids:
            raise RuntimeError(f"{solution_id} missing from remapped compact staging cache")
        if domain not in {"land", "marine"}:
            raise RuntimeError(f"{solution_id} has unexpected domain={domain}")
        urls["compactCache"] = public_url(compact_blob_path(solution_id))
        if domain == "land":
            rewritten_land += 1
        else:
            rewritten_marine += 1
    if rewritten_land != 168 or rewritten_marine != 4:
        raise RuntimeError(
            f"rewrite counts unexpected: land={rewritten_land} marine={rewritten_marine}"
        )
    return live_manifest


def local_sirap_compact_files(repo_root: Path) -> dict[str, Path]:
    cache_dir = repo_root / SIRAP_LOCAL_COMPACT_REL
    files = sorted(cache_dir.glob("*.metrics.compact.json"))
    mapping: dict[str, Path] = {}
    for path in files:
        if path.name.endswith(".metrics.json") and not path.name.endswith(
            ".metrics.compact.json"
        ):
            raise RuntimeError(f"refusing verbose metrics file: {path}")
        solution_id = path.name.removesuffix(".metrics.compact.json")
        mapping[solution_id] = path
    if len(mapping) != 56:
        raise RuntimeError(f"expected 56 SIRAP compact files, found {len(mapping)}")
    return mapping


def rewrite_sirap_manifest(
    live_manifest: dict,
    compact_ids: set[str],
) -> dict:
    solutions = live_manifest.get("solutions")
    if not isinstance(solutions, list) or len(solutions) != 56:
        raise RuntimeError(
            f"live SIRAP manifest must have 56 solutions, found {len(solutions or [])}"
        )
    rewritten = 0
    for solution in solutions:
        solution_id = str(solution.get("id") or "")
        urls = solution.get("precomputedMetricUrls")
        if not isinstance(urls, dict):
            raise RuntimeError(f"{solution_id} missing precomputedMetricUrls")
        if solution_id not in compact_ids:
            raise RuntimeError(f"{solution_id} missing from SIRAP of-AOI compact cache")
        live_url = urls.get("compactCache")
        if not isinstance(live_url, str) or "/releases/sirap-2026-09-02-v6/" not in live_url:
            raise RuntimeError(f"{solution_id} live compactCache is not on the live SIRAP prefix")
        urls["compactCache"] = public_url(sirap_compact_blob_path(solution_id))
        rewritten += 1
    if rewritten != 56:
        raise RuntimeError(f"SIRAP compactCache rewrite count unexpected: {rewritten}")
    return live_manifest


def wait_until_missing(url: str, *, timeout_seconds: float = 90.0) -> None:
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        if not remote_exists(url):
            return
        time.sleep(2)
    raise RuntimeError(f"public URL still exists after delete wait: {url}")


def wait_for_test_index_sirap_batch(*, timeout_seconds: float = 90.0) -> dict:
    expected = public_url(TEST_SIRAP_MANIFEST_PATH)
    deadline = time.time() + timeout_seconds
    last_url = None
    last_error = None
    while time.time() < deadline:
        try:
            index = fetch_json(public_url(TEST_CATALOG_INDEX_PATH))
            last_url = ((index.get("batches") or [None, {}])[1] or {}).get("manifestUrl")
            if last_url == expected:
                return index
        except Exception as exc:  # noqa: BLE001 - retry CDN lag
            last_error = exc
        time.sleep(2)
    raise RuntimeError(
        "test index SIRAP batch did not update to the test manifest; "
        f"lastUrl={last_url} lastError={last_error}"
    )


def replace_test_index(token: str, local_path: Path) -> str:
    """Replace the test catalog index after the public cache drops the old object."""

    url = public_url(TEST_CATALOG_INDEX_PATH)
    if remote_exists(url):
        delete_test_blob(token, TEST_CATALOG_INDEX_PATH)
        wait_until_missing(url)
    return put_blob(
        token,
        local_path,
        TEST_CATALOG_INDEX_PATH,
        cache_control_max_age=60,
    )


def patch_test_index_sirap_batch(index: dict) -> dict:
    batches = index.get("batches")
    if not isinstance(batches, list) or len(batches) != 2:
        raise RuntimeError("test catalog index must have national + SIRAP batches")
    national = batches[0]
    sirap = batches[1]
    if national.get("id") != "national":
        raise RuntimeError(f"unexpected first batch id: {national.get('id')}")
    if sirap.get("id") != "sirap-2026-09-02-v6":
        raise RuntimeError(f"unexpected SIRAP batch id: {sirap.get('id')}")
    national_url = str(national.get("manifestUrl") or "")
    if not national_url.endswith("/releases/catalog-v3-0-5-land-use-aoi-test/manifest.json"):
        raise RuntimeError(
            "refusing to patch index whose national batch is not the test national manifest"
        )
    sirap["manifestUrl"] = public_url(TEST_SIRAP_MANIFEST_PATH)
    index["generatedAt"] = _utc_now_iso()
    return index


def upload_one_sirap_compact(
    token: str,
    solution_id: str,
    local_path: Path,
    *,
    dry_run: bool,
) -> tuple[str, str, int]:
    blob_path = sirap_compact_blob_path(solution_id)
    assert_test_blob_path(blob_path)
    url = public_url(blob_path)
    size = local_path.stat().st_size
    existed = remote_exists(url)
    if dry_run:
        return solution_id, "would-replace" if existed else "would-upload", size
    if existed:
        delete_test_blob(token, blob_path)
    put_blob(token, local_path, blob_path)
    return solution_id, "replaced" if existed else "uploaded", size


def build_test_index() -> dict:
    return {
        "format": "runtime-catalog-release-v1",
        "catalogVersion": TEST_CATALOG_VERSION,
        "releaseId": TEST_RELEASE_ID,
        "generatedAt": _utc_now_iso(),
        "expectedSolutionCount": 228,
        "batches": [
            {
                "id": "national",
                "manifestUrl": public_url(TEST_NATIONAL_MANIFEST_PATH),
                "expectedSolutionCount": 172,
            },
            {
                "id": "sirap-2026-09-02-v6",
                "manifestUrl": public_url(TEST_SIRAP_MANIFEST_PATH),
                "expectedSolutionCount": 56,
            },
        ],
    }


def upload_one_compact(
    token: str,
    solution_id: str,
    local_path: Path,
    *,
    dry_run: bool,
) -> tuple[str, str, int]:
    blob_path = compact_blob_path(solution_id)
    assert_test_blob_path(blob_path)
    url = public_url(blob_path)
    size = local_path.stat().st_size
    existed = remote_exists(url)
    if dry_run:
        return solution_id, "would-replace" if existed else "would-upload", size
    if existed:
        delete_test_blob(token, blob_path)
    put_blob(token, local_path, blob_path)
    return solution_id, "replaced" if existed else "uploaded", size


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--manifests-only",
        action="store_true",
        help="Skip compact uploads; write and upload test manifest + index only.",
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=4,
        help="Parallel compact uploads (default 4).",
    )
    parser.add_argument(
        "--sirap",
        action="store_true",
        help=(
            "Publish SIRAP of-AOI compact to releases/sirap-2026-09-02-v6-land-use-aoi-test/ "
            "and point only the test catalog index SIRAP batch at the cloned test manifest."
        ),
    )
    return parser.parse_args()


def publish_sirap(args: argparse.Namespace) -> int:
    repo_root = find_repo_root()
    work_dir = repo_root / SIRAP_WORK_REL
    work_dir.mkdir(parents=True, exist_ok=True)

    token = None
    if args.dry_run:
        try:
            load_token(repo_root)
            print("[sirap-land-use-aoi-test] BLOB_READ_WRITE_TOKEN present: True")
        except RuntimeError:
            print("[sirap-land-use-aoi-test] BLOB_READ_WRITE_TOKEN present: False")
    else:
        token = load_token(repo_root)
        print("[sirap-land-use-aoi-test] BLOB_READ_WRITE_TOKEN present: True")

    live_index = fetch_json(LIVE_CATALOG_INDEX_URL)
    live_national_url = live_index["batches"][0]["manifestUrl"]
    if not live_national_url.endswith("/manifest/manifest.json"):
        raise RuntimeError(
            f"live 3.0.5 national batch is not manifest/manifest.json: {live_national_url}"
        )
    live_sirap_url = live_index["batches"][1]["manifestUrl"]
    if live_sirap_url != LIVE_SIRAP_MANIFEST_URL:
        raise RuntimeError(
            f"live 3.0.5 SIRAP batch is not the live SIRAP manifest: {live_sirap_url}"
        )
    print(f"[sirap-land-use-aoi-test] live 3.0.5 index still points at {live_national_url}")
    print(f"[sirap-land-use-aoi-test] live 3.0.5 SIRAP batch still points at {live_sirap_url}")

    compact_files = local_sirap_compact_files(repo_root)
    live_manifest_path = work_dir / "live-sirap-manifest.copy.json"
    if not live_manifest_path.exists():
        print("[sirap-land-use-aoi-test] downloading live SIRAP manifest copy")
        request = urllib.request.Request(
            LIVE_SIRAP_MANIFEST_URL,
            headers={"User-Agent": "dises-test-catalog-publisher/1"},
        )
        with urllib.request.urlopen(request, timeout=180) as response:
            live_manifest_path.write_bytes(response.read())
    live_manifest = json.loads(live_manifest_path.read_text(encoding="utf-8"))
    test_manifest = rewrite_sirap_manifest(live_manifest, set(compact_files))
    test_manifest_path = work_dir / "test-sirap-manifest.json"
    test_manifest_path.write_text(
        json.dumps(test_manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    current_test_index = fetch_json(public_url(TEST_CATALOG_INDEX_PATH))
    test_index = patch_test_index_sirap_batch(current_test_index)
    test_index_path = work_dir / "test-catalog-release-index.json"
    test_index_path.write_text(
        json.dumps(test_index, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"[sirap-land-use-aoi-test] wrote {test_manifest_path}")
    print(f"[sirap-land-use-aoi-test] wrote {test_index_path}")

    uploaded = 0
    skipped = 0
    failed: list[str] = []
    if not args.manifests_only:
        started = time.time()
        items = list(compact_files.items())
        print(
            f"[sirap-land-use-aoi-test] compact upload plan: {len(items)} files, "
            f"workers={args.workers}, dry_run={args.dry_run}",
            flush=True,
        )
        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            futures = {
                pool.submit(
                    upload_one_sirap_compact,
                    token or "",
                    solution_id,
                    local_path,
                    dry_run=args.dry_run,
                ): solution_id
                for solution_id, local_path in items
            }
            done = 0
            for future in as_completed(futures):
                done += 1
                try:
                    solution_id, action, size = future.result()
                    if action in {"uploaded", "replaced", "would-upload", "would-replace"}:
                        uploaded += 1
                    else:
                        skipped += 1
                    print(
                        f"[sirap-land-use-aoi-test] {done}/{len(items)} {action} "
                        f"{solution_id} ({size:,} B)",
                        flush=True,
                    )
                except Exception as exc:  # noqa: BLE001 - surface worker failures
                    solution_id = futures[future]
                    failed.append(f"{solution_id}: {exc}")
                    print(
                        f"[sirap-land-use-aoi-test] {done}/{len(items)} FAILED {solution_id}: {exc}",
                        file=sys.stderr,
                        flush=True,
                    )
        elapsed = time.time() - started
        print(
            f"[sirap-land-use-aoi-test] compact done in {elapsed/60:.1f} min "
            f"uploaded={uploaded} skipped={skipped} failed={len(failed)}",
            flush=True,
        )
        if failed:
            return 1

    if args.dry_run:
        print("[sirap-land-use-aoi-test] dry-run: skipping manifest/index upload")
        return 0

    assert token is not None
    print("[sirap-land-use-aoi-test] uploading test SIRAP manifest", flush=True)
    if remote_exists(public_url(TEST_SIRAP_MANIFEST_PATH)):
        delete_test_blob(token, TEST_SIRAP_MANIFEST_PATH)
    put_blob(token, test_manifest_path, TEST_SIRAP_MANIFEST_PATH)
    print("[sirap-land-use-aoi-test] uploading test catalog-release-index", flush=True)
    replace_test_index(token, test_index_path)

    live_index_after = fetch_json(LIVE_CATALOG_INDEX_URL)
    live_national_after = live_index_after["batches"][0]["manifestUrl"]
    live_sirap_after = live_index_after["batches"][1]["manifestUrl"]
    if not live_national_after.endswith("/manifest/manifest.json"):
        raise RuntimeError("live 3.0.5 index no longer points at manifest/manifest.json")
    if live_sirap_after != LIVE_SIRAP_MANIFEST_URL:
        raise RuntimeError("live 3.0.5 SIRAP batch no longer points at the live SIRAP manifest")
    test_index_after = wait_for_test_index_sirap_batch()
    print(
        "[sirap-land-use-aoi-test] confirmed live catalog-releases/3.0.5 still points at "
        "manifest/manifest.json and live SIRAP"
    )
    print(f"[sirap-land-use-aoi-test] test index: {public_url(TEST_CATALOG_INDEX_PATH)}")
    print(f"[sirap-land-use-aoi-test] test SIRAP manifest: {public_url(TEST_SIRAP_MANIFEST_PATH)}")
    print(f"[sirap-land-use-aoi-test] compact uploaded={uploaded} skipped={skipped}")
    return 0


def main() -> int:
    args = parse_args()
    if args.sirap:
        return publish_sirap(args)
    repo_root = find_repo_root()
    work_dir = repo_root / WORK_REL
    work_dir.mkdir(parents=True, exist_ok=True)

    token = None
    if args.dry_run:
        try:
            load_token(repo_root)
            print("[land-use-aoi-test] BLOB_READ_WRITE_TOKEN present: True")
        except RuntimeError:
            print("[land-use-aoi-test] BLOB_READ_WRITE_TOKEN present: False")
    else:
        token = load_token(repo_root)
        print("[land-use-aoi-test] BLOB_READ_WRITE_TOKEN present: True")

    live_index = fetch_json(LIVE_CATALOG_INDEX_URL)
    live_national_url = live_index["batches"][0]["manifestUrl"]
    if not live_national_url.endswith("/manifest/manifest.json"):
        raise RuntimeError(
            f"live 3.0.5 national batch is not manifest/manifest.json: {live_national_url}"
        )
    print(f"[land-use-aoi-test] live 3.0.5 index still points at {live_national_url}")

    compact_files = local_compact_files(repo_root)
    live_manifest_path = work_dir / "live-national-manifest.copy.json"
    if not live_manifest_path.exists():
        print("[land-use-aoi-test] downloading live national manifest copy")
        request = urllib.request.Request(
            LIVE_NATIONAL_MANIFEST_URL,
            headers={"User-Agent": "dises-test-catalog-publisher/1"},
        )
        with urllib.request.urlopen(request, timeout=180) as response:
            live_manifest_path.write_bytes(response.read())
    live_manifest = json.loads(live_manifest_path.read_text(encoding="utf-8"))
    test_manifest = rewrite_national_manifest(live_manifest, set(compact_files))
    test_manifest_path = work_dir / "test-national-manifest.json"
    test_manifest_path.write_text(
        json.dumps(test_manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    test_index = build_test_index()
    test_index_path = work_dir / "test-catalog-release-index.json"
    test_index_path.write_text(
        json.dumps(test_index, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"[land-use-aoi-test] wrote {test_manifest_path}")
    print(f"[land-use-aoi-test] wrote {test_index_path}")

    uploaded = 0
    skipped = 0
    failed: list[str] = []
    if not args.manifests_only:
        started = time.time()
        items = list(compact_files.items())
        print(
            f"[land-use-aoi-test] compact upload plan: {len(items)} files, "
            f"workers={args.workers}, dry_run={args.dry_run}",
            flush=True,
        )
        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            futures = {
                pool.submit(
                    upload_one_compact,
                    token or "",
                    solution_id,
                    local_path,
                    dry_run=args.dry_run,
                ): solution_id
                for solution_id, local_path in items
            }
            done = 0
            for future in as_completed(futures):
                done += 1
                try:
                    solution_id, action, size = future.result()
                    if action in {"skipped-exists"}:
                        skipped += 1
                    elif action in {"uploaded", "replaced", "would-upload", "would-replace"}:
                        uploaded += 1
                    print(
                        f"[land-use-aoi-test] {done}/{len(items)} {action} "
                        f"{solution_id} ({size:,} B)",
                        flush=True,
                    )
                except Exception as exc:  # noqa: BLE001 - surface worker failures
                    solution_id = futures[future]
                    failed.append(f"{solution_id}: {exc}")
                    print(
                        f"[land-use-aoi-test] {done}/{len(items)} FAILED {solution_id}: {exc}",
                        file=sys.stderr,
                        flush=True,
                    )
        elapsed = time.time() - started
        print(
            f"[land-use-aoi-test] compact done in {elapsed/60:.1f} min "
            f"uploaded={uploaded} skipped={skipped} failed={len(failed)}",
            flush=True,
        )
        if failed:
            return 1

    if args.dry_run:
        print("[land-use-aoi-test] dry-run: skipping manifest/index upload")
        return 0

    assert token is not None
    print("[land-use-aoi-test] uploading test national manifest", flush=True)
    if remote_exists(public_url(TEST_NATIONAL_MANIFEST_PATH)):
        delete_test_blob(token, TEST_NATIONAL_MANIFEST_PATH)
    put_blob(token, test_manifest_path, TEST_NATIONAL_MANIFEST_PATH)
    print("[land-use-aoi-test] uploading test catalog-release-index", flush=True)
    if remote_exists(public_url(TEST_CATALOG_INDEX_PATH)):
        delete_test_blob(token, TEST_CATALOG_INDEX_PATH)
    put_blob(token, test_index_path, TEST_CATALOG_INDEX_PATH)

    live_index_after = fetch_json(LIVE_CATALOG_INDEX_URL)
    live_national_after = live_index_after["batches"][0]["manifestUrl"]
    if not live_national_after.endswith("/manifest/manifest.json"):
        raise RuntimeError("live 3.0.5 index no longer points at manifest/manifest.json")
    print(
        "[land-use-aoi-test] confirmed live catalog-releases/3.0.5 still points at "
        "manifest/manifest.json"
    )
    print(f"[land-use-aoi-test] test index: {public_url(TEST_CATALOG_INDEX_PATH)}")
    print(f"[land-use-aoi-test] test national manifest: {public_url(TEST_NATIONAL_MANIFEST_PATH)}")
    print(f"[land-use-aoi-test] compact uploaded={uploaded} skipped={skipped}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("[land-use-aoi-test] interrupted", file=sys.stderr)
        raise SystemExit(130)
