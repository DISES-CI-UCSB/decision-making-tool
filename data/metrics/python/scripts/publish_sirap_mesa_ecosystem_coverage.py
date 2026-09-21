"""Upload SIRAP Mesa compact shards and patch live manifest URLs only.

doNotRetarget: the only live-manifest mutation is adding
precomputedMetricUrls.mesaEcosystemByGeography. Rasters, goals, MEC, and
species URLs stay untouched.

STATUS.json tracks compute, not upload. Upload resume is a public HEAD skip
plus a local publish/ scan. A solution is never manifest-patched until all
six compact files exist locally. The patched object always includes all six
RuntimeSolutionMecGeographyUrls keys.

Examples (from the repository root):

    data/metrics/python/.venv/bin/python \\
      data/metrics/python/scripts/publish_sirap_mesa_ecosystem_coverage.py --dry-run

    data/metrics/python/.venv/bin/python \\
      data/metrics/python/scripts/publish_sirap_mesa_ecosystem_coverage.py --upload

    data/metrics/python/.venv/bin/python \\
      data/metrics/python/scripts/publish_sirap_mesa_ecosystem_coverage.py --manifest

    data/metrics/python/.venv/bin/python \\
      data/metrics/python/scripts/publish_sirap_mesa_ecosystem_coverage.py --all
"""

from __future__ import annotations

import argparse
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

REPO = Path(__file__).resolve().parents[4]
RELEASE_ID = "sirap-2026-09-09-v7-endemic"
PUBLIC_BLOB_HOST = "https://aagibolq28slyfof.public.blob.vercel-storage.com"
BLOB_API_HOST = "https://blob.vercel-storage.com"
BLOB_TOKEN_ENV_VAR = "BLOB_READ_WRITE_TOKEN"
MANIFEST_BLOB_PATH = f"releases/{RELEASE_ID}/manifest.json"
MANIFEST_URL = f"{PUBLIC_BLOB_HOST}/{MANIFEST_BLOB_PATH}"
COMPACT_BLOB_PREFIX = (
    f"releases/{RELEASE_ID}/mesa-ecosystem-coverage/compact/v1"
)
DEFAULT_OUTPUT = REPO / "data/metrics/generated/local/sirap-mesa-ecosystem-coverage"
COMPACT_SUFFIX = ".mesa-ecosystem-coverage.compact.json"
GEOGRAPHY_LEVELS = (
    "national",
    "departments",
    "municipalities",
    "siraps",
    "runaps",
    "omecs",
)
USER_AGENT = "sirap-mesa-ecosystem-coverage-publish/1"
MAX_WORKERS = 3
MAX_RETRIES = 6
PROTECTED_URL_KEYS = (
    "cache",
    "compact",
    "compactCache",
    "goals",
    "mecByGeography",
    "mecNationalDenominator",
    "mecV2ByGeography",
    "speciesGoalsByGeography",
    "speciesGoalsCatalog",
    "speciesGoalsTargetOverlay",
    "strategicOutcomes",
)
UPLOAD_RESUME_MARKER = "Upload + live-manifest patch"


@dataclass(frozen=True)
class CompactShard:
    solution_id: str
    level: str
    local_path: Path

    @property
    def blob_path(self) -> str:
        return compact_blob_path(self.solution_id, self.level)

    @property
    def public_url(self) -> str:
        return public_url_for(self.blob_path)


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def log(message: str) -> None:
    print(f"{utc_now()}  {message}", flush=True)


def public_url_for(blob_path: str) -> str:
    return f"{PUBLIC_BLOB_HOST}/{blob_path.lstrip('/')}"


def compact_blob_path(solution_id: str, level: str) -> str:
    return f"{COMPACT_BLOB_PREFIX}/{solution_id}/{level}{COMPACT_SUFFIX}"


def geography_urls(solution_id: str) -> dict[str, str]:
    return {level: public_url_for(compact_blob_path(solution_id, level)) for level in GEOGRAPHY_LEVELS}


def redact(text: str, token: str) -> str:
    if not token:
        return text
    return text.replace(token, "[redacted]")


def load_token(repo_root: Path) -> str:
    env = os.environ.get(BLOB_TOKEN_ENV_VAR, "").strip()
    if env:
        return env
    env_path = repo_root / ".env.local"
    if not env_path.exists():
        raise SystemExit(f"{BLOB_TOKEN_ENV_VAR} is missing and {env_path} does not exist")
    for raw in env_path.read_text(encoding="utf-8").splitlines():
        stripped = raw.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, _, value = stripped.partition("=")
        if key.strip() != BLOB_TOKEN_ENV_VAR:
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        if value:
            return value
    raise SystemExit(f"{BLOB_TOKEN_ENV_VAR} is missing from .env.local")


def discover_shards(output_root: Path) -> list[CompactShard]:
    publish = output_root / "publish"
    shards: list[CompactShard] = []
    if not publish.is_dir():
        return shards
    for path in sorted(publish.glob(f"*/*{COMPACT_SUFFIX}")):
        level = path.name.removesuffix(COMPACT_SUFFIX)
        if level not in GEOGRAPHY_LEVELS:
            continue
        shards.append(CompactShard(solution_id=path.parent.name, level=level, local_path=path))
    return shards


def shards_by_solution(shards: list[CompactShard]) -> dict[str, dict[str, CompactShard]]:
    grouped: dict[str, dict[str, CompactShard]] = {}
    for shard in shards:
        grouped.setdefault(shard.solution_id, {})[shard.level] = shard
    return grouped


def complete_solution_ids(grouped: dict[str, dict[str, CompactShard]]) -> list[str]:
    return sorted(
        solution_id
        for solution_id, levels in grouped.items()
        if all(level in levels for level in GEOGRAPHY_LEVELS)
    )


def incomplete_solution_ids(grouped: dict[str, dict[str, CompactShard]]) -> dict[str, list[str]]:
    missing: dict[str, list[str]] = {}
    for solution_id, levels in grouped.items():
        absent = [level for level in GEOGRAPHY_LEVELS if level not in levels]
        if absent:
            missing[solution_id] = absent
    return missing


def request_json(url: str, *, timeout: int = 60) -> dict[str, Any]:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as response:
        payload = json.loads(response.read().decode("utf-8"))
    if not isinstance(payload, dict):
        raise RuntimeError(f"expected JSON object from {url}")
    return payload


def public_head_exists(url: str) -> bool:
    req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            return 200 <= int(response.status) < 300
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            return False
        raise


def sleep_backoff(attempt: int) -> None:
    time.sleep(min(2 ** attempt, 30))


def put_bytes(token: str, blob_path: str, body: bytes) -> str:
    encoded_path = urllib.parse.quote(blob_path.lstrip("/"), safe="/")
    url = f"{BLOB_API_HOST}/{encoded_path}"
    headers = {
        "Authorization": f"Bearer {token}",
        "x-api-version": "7",
        "x-add-random-suffix": "0",
        "x-vercel-blob-access": "public",
        "x-allow-overwrite": "1",
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT,
    }
    last_error: Exception | None = None
    for attempt in range(MAX_RETRIES):
        req = urllib.request.Request(url, data=body, method="PUT", headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=180) as response:
                raw = response.read().decode("utf-8")
            try:
                payload = json.loads(raw) if raw else {}
            except json.JSONDecodeError:
                payload = {}
            uploaded = ""
            if isinstance(payload, dict):
                uploaded = str(payload.get("url") or "")
            expected = public_url_for(blob_path)
            if uploaded and uploaded.rstrip("/") != expected:
                raise RuntimeError(
                    f"upload landed on unexpected URL (possible random suffix): {uploaded}"
                )
            return expected
        except urllib.error.HTTPError as exc:
            last_error = RuntimeError(
                redact(f"PUT {blob_path} failed HTTP {exc.code}: {exc.reason}", token)
            )
            if exc.code != 503 or attempt == MAX_RETRIES - 1:
                raise last_error from exc
            log(f"RETRY 503 {blob_path} attempt={attempt + 1}")
            sleep_backoff(attempt)
        except urllib.error.URLError as exc:
            last_error = RuntimeError(redact(f"PUT {blob_path} network error: {exc.reason}", token))
            if attempt == MAX_RETRIES - 1:
                raise last_error from exc
            log(f"RETRY network {blob_path} attempt={attempt + 1}")
            sleep_backoff(attempt)
    raise last_error or RuntimeError(f"PUT {blob_path} failed")


def head_exists_with_retry(url: str) -> bool:
    last_error: Exception | None = None
    for attempt in range(MAX_RETRIES):
        try:
            return public_head_exists(url)
        except urllib.error.HTTPError as exc:
            if exc.code != 503 or attempt == MAX_RETRIES - 1:
                raise
            last_error = exc
            sleep_backoff(attempt)
        except urllib.error.URLError as exc:
            last_error = exc
            if attempt == MAX_RETRIES - 1:
                raise
            sleep_backoff(attempt)
    raise last_error or RuntimeError(f"HEAD failed: {url}")


def upload_one(
    token: str,
    shard: CompactShard,
    *,
    skip_existing: bool,
) -> str:
    if skip_existing and head_exists_with_retry(shard.public_url):
        return "skipped"
    put_bytes(token, shard.blob_path, shard.local_path.read_bytes())
    return "uploaded"


def upload_shards(
    token: str,
    shards: list[CompactShard],
    *,
    workers: int,
    skip_existing: bool,
) -> dict[str, int]:
    counts = {"uploaded": 0, "skipped": 0, "failed": 0}
    if not shards:
        return counts
    worker_count = max(1, min(workers, MAX_WORKERS, len(shards)))
    log(f"upload start files={len(shards)} workers={worker_count} skipExisting={skip_existing}")
    with ThreadPoolExecutor(max_workers=worker_count) as pool:
        futures = {
            pool.submit(upload_one, token, shard, skip_existing=skip_existing): shard
            for shard in shards
        }
        for future in as_completed(futures):
            shard = futures[future]
            try:
                status = future.result()
                counts[status] += 1
                log(f"{status.upper()} {shard.solution_id} {shard.level}")
            except Exception as exc:
                counts["failed"] += 1
                log(f"ERROR {shard.solution_id} {shard.level}: {redact(str(exc), token)}")
    log(
        "upload finished "
        f"uploaded={counts['uploaded']} skipped={counts['skipped']} failed={counts['failed']}"
    )
    return counts


def assert_do_not_retarget(before: dict[str, Any], after: dict[str, Any]) -> None:
    before_keys = set(before) - {"solutions"}
    after_keys = set(after) - {"solutions"}
    if before_keys != after_keys:
        raise RuntimeError(f"doNotRetarget: top-level keys changed: {sorted(before_keys ^ after_keys)}")
    for key in before_keys:
        if before.get(key) != after.get(key):
            raise RuntimeError(f"doNotRetarget: top-level field changed: {key}")
    before_solutions = before.get("solutions")
    after_solutions = after.get("solutions")
    if not isinstance(before_solutions, list) or not isinstance(after_solutions, list):
        raise RuntimeError("doNotRetarget: solutions must remain a list")
    if len(before_solutions) != len(after_solutions):
        raise RuntimeError("doNotRetarget: solution count changed")
    for original, patched in zip(before_solutions, after_solutions, strict=True):
        if not isinstance(original, dict) or not isinstance(patched, dict):
            raise RuntimeError("doNotRetarget: solution entries must remain objects")
        if original.get("id") != patched.get("id"):
            raise RuntimeError("doNotRetarget: solution order or id changed")
        original_urls = original.get("precomputedMetricUrls")
        patched_urls = patched.get("precomputedMetricUrls")
        if not isinstance(original_urls, dict) or not isinstance(patched_urls, dict):
            raise RuntimeError(f"{original.get('id')}: precomputedMetricUrls must remain an object")
        original_copy = dict(original)
        patched_copy = dict(patched)
        original_copy.pop("precomputedMetricUrls", None)
        patched_copy.pop("precomputedMetricUrls", None)
        if original_copy != patched_copy:
            raise RuntimeError(
                f"doNotRetarget: {original.get('id')} changed a non-URL field "
                "(raster, finderInputs, metadata, or similar)"
            )
        extra = set(patched_urls) - set(original_urls) - {"mesaEcosystemByGeography"}
        missing = set(original_urls) - set(patched_urls)
        if extra or missing:
            raise RuntimeError(
                f"doNotRetarget: {original.get('id')} URL keys changed "
                f"extra={sorted(extra)} missing={sorted(missing)}"
            )
        for key in PROTECTED_URL_KEYS:
            if original_urls.get(key) != patched_urls.get(key):
                raise RuntimeError(
                    f"doNotRetarget: {original.get('id')} changed protected URL key {key}"
                )


def patch_manifest_urls(
    manifest: dict[str, Any],
    grouped: dict[str, dict[str, CompactShard]],
) -> tuple[dict[str, Any], list[str], dict[str, list[str]]]:
    patched = json.loads(json.dumps(manifest))
    solutions = patched.get("solutions")
    if not isinstance(solutions, list):
        raise RuntimeError("live manifest is missing solutions[]")
    patched_ids: list[str] = []
    refused: dict[str, list[str]] = {}
    catalog_ids: list[str] = []
    for solution in solutions:
        if not isinstance(solution, dict):
            continue
        if str(solution.get("scope") or "").strip().lower() != "sirap":
            continue
        solution_id = str(solution.get("id") or "")
        if not solution_id:
            raise RuntimeError("SIRAP solution is missing id")
        catalog_ids.append(solution_id)
        present = grouped.get(solution_id, {})
        missing = [level for level in GEOGRAPHY_LEVELS if level not in present]
        if missing:
            refused[solution_id] = missing
            continue
        urls = solution.get("precomputedMetricUrls")
        if not isinstance(urls, dict):
            raise RuntimeError(f"{solution_id} missing precomputedMetricUrls")
        urls["mesaEcosystemByGeography"] = geography_urls(solution_id)
        if set(urls["mesaEcosystemByGeography"]) != set(GEOGRAPHY_LEVELS):
            raise RuntimeError(f"{solution_id} mesaEcosystemByGeography must emit all 6 keys")
        patched_ids.append(solution_id)
    if not catalog_ids:
        raise RuntimeError("live manifest has no SIRAP solutions")
    assert_do_not_retarget(manifest, patched)
    return patched, patched_ids, refused


def put_manifest(token: str, manifest: dict[str, Any]) -> str:
    body = (json.dumps(manifest, indent=2, ensure_ascii=False) + "\n").encode("utf-8")
    return put_bytes(token, MANIFEST_BLOB_PATH, body)


def print_dry_run(shards: list[CompactShard], grouped: dict[str, dict[str, CompactShard]]) -> int:
    complete = complete_solution_ids(grouped)
    incomplete = incomplete_solution_ids(grouped)
    log(f"dry-run compact files={len(shards)}")
    log(f"dry-run solutions with any shard={len(grouped)}")
    log(f"dry-run complete 6/6 solutions={len(complete)}")
    log(f"dry-run incomplete solutions={len(incomplete)}")
    for level in GEOGRAPHY_LEVELS:
        count = sum(1 for shard in shards if shard.level == level)
        log(f"dry-run level {level}={count}")
    if incomplete:
        preview = list(incomplete.items())[:8]
        for solution_id, missing in preview:
            log(f"dry-run incomplete {solution_id} missing={','.join(missing)}")
        if len(incomplete) > 8:
            log(f"dry-run incomplete … {len(incomplete) - 8} more")
    log("dry-run token not required; no upload or manifest write")
    return 0


def run_manifest(
    token: str,
    grouped: dict[str, dict[str, CompactShard]],
    output_root: Path,
) -> int:
    live = request_json(MANIFEST_URL, timeout=120)
    if live.get("releaseId") != RELEASE_ID:
        raise RuntimeError(f"live manifest releaseId is {live.get('releaseId')!r}, expected {RELEASE_ID}")
    patched, patched_ids, refused = patch_manifest_urls(live, grouped)
    preview_path = output_root / "manifest.patched.preview.json"
    preview_path.write_text(
        json.dumps(patched, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    if refused:
        log(f"manifest refuse {len(refused)} solution(s) until all 6 local compact files exist")
        for solution_id, missing in list(refused.items())[:8]:
            log(f"manifest refuse {solution_id} missing={','.join(missing)}")
        if len(refused) > 8:
            log(f"manifest refuse … {len(refused) - 8} more")
    if not patched_ids:
        raise SystemExit("refusing manifest PUT: no solution has all 6 local compact files")
    url = put_manifest(token, patched)
    log(f"manifest patched solutions={len(patched_ids)} url={url}")
    log(f"manifest local preview {preview_path}")
    return 0 if not refused else 2


def upload_resume_section() -> str:
    python = "data/metrics/python/.venv/bin/python"
    script = "data/metrics/python/scripts/publish_sirap_mesa_ecosystem_coverage.py"
    return (
        f"{UPLOAD_RESUME_MARKER} (STATUS.json is compute-only).\n"
        "doNotRetarget: only adds precomputedMetricUrls.mesaEcosystemByGeography.\n"
        "Refuses to patch a solution until all 6 local compact files exist.\n\n"
        f"cd {REPO}\n"
        f"{python} \\\n"
        f"  {script} --dry-run\n\n"
        f"{python} \\\n"
        f"  {script} --upload\n\n"
        f"{python} \\\n"
        f"  {script} --manifest\n\n"
        f"{python} \\\n"
        f"  {script} --all\n"
    )


def append_resume_section(output_root: Path) -> None:
    path = output_root / "RESUME.txt"
    section = upload_resume_section()
    existing = path.read_text(encoding="utf-8") if path.exists() else ""
    if UPLOAD_RESUME_MARKER in existing:
        compute, _marker, _rest = existing.partition(UPLOAD_RESUME_MARKER)
        path.write_text(compute.rstrip() + "\n\n" + section, encoding="utf-8")
        return
    prefix = existing.rstrip() + "\n\n" if existing.strip() else ""
    path.write_text(prefix + section, encoding="utf-8")


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--dry-run", action="store_true", help="count local compact files; no token")
    mode.add_argument("--upload", action="store_true", help="PUT missing/new compact shards")
    mode.add_argument("--manifest", action="store_true", help="patch live SIRAP mesa URLs only")
    mode.add_argument("--all", action="store_true", help="upload then manifest")
    parser.add_argument("--output-root", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--workers", type=int, default=MAX_WORKERS)
    parser.add_argument(
        "--no-skip-existing",
        action="store_true",
        help="re-PUT shards even when public HEAD already exists",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    output_root = args.output_root if args.output_root.is_absolute() else REPO / args.output_root
    workers = max(1, min(int(args.workers), MAX_WORKERS))
    shards = discover_shards(output_root)
    grouped = shards_by_solution(shards)
    append_resume_section(output_root)

    if args.dry_run:
        return print_dry_run(shards, grouped)

    token = load_token(REPO)
    log(f"{BLOB_TOKEN_ENV_VAR} present: {bool(token)}")

    if args.upload or args.all:
        counts = upload_shards(
            token,
            shards,
            workers=workers,
            skip_existing=not args.no_skip_existing,
        )
        if counts["failed"]:
            return 1

    if args.manifest or args.all:
        return run_manifest(token, grouped, output_root)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
