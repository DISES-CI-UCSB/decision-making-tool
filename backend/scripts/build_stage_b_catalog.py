"""Publish the Stage B Runtime Catalog release: Stage A with no Vercel Blob addresses.

Stage A (catalog-releases/3.7.1-test-site-stage-a) still names public files by
their Vercel Blob address, and the web app swaps the host at request time.
Stage B moves the data itself: every public Vercel Blob address in the release
graph becomes its public file bucket address.

Release graph: the Stage A catalog release index, the batch manifests it lists,
and every JSON file those reference on the public host, followed transitively.
A JSON file is rewritten only when it holds a Vercel address or references a
rewritten JSON file. Its copy goes to a new path whose parent folder gets the
"-stage-b" suffix ("-stage-a" folders become "-stage-b"); its referrer points
at the new path. Unchanged files keep their original address, now on the
bucket. manifest/manifest.json is rewritten the same way into
manifest-stage-b/manifest.json for the backend hydrate.

Rewrites are text substitutions inside JSON strings, so every other byte of a
file is unchanged. Object names are urllib.parse.unquote of the URL path, the
rule used by copy_public_files_to_public_bucket.py. Query strings and fragments
are kept.

Nothing is overwritten or deleted: uploads use if_generation_match=0, and a
target that already exists is accepted only when its MD5 matches.

Every referenced JSON file is downloaded once and scanned; results and the
files that need rewriting are cached in --work-dir, so a real run after a dry
run does not download them again.

Requires google-cloud-storage (not in backend/.venv):
    python3 -m venv /tmp/gcsvenv && /tmp/gcsvenv/bin/pip install google-cloud-storage
Usage:
    /tmp/gcsvenv/bin/python backend/scripts/build_stage_b_catalog.py \
        --credentials <service-account-key.json> [--dry-run]
"""

from __future__ import annotations

import argparse
import base64
import gzip
import hashlib
import json
import os
import re
import sys
import threading
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import unquote

import requests
from google.api_core.exceptions import PreconditionFailed, RetryError
from google.cloud import storage

VERCEL_HOST = "https://aagibolq28slyfof.public.blob.vercel-storage.com"
PUBLIC_BUCKET = "pnn-priorizando-la-naturaleza-public"
PUBLIC_BASE = f"https://storage.googleapis.com/{PUBLIC_BUCKET}"
PRIVATE_BASE = "https://storage.googleapis.com/pnn-priorizando-la-naturaleza/"
STAGE_A_INDEX_KEY = "catalog-releases/3.7.1-test-site-stage-a/catalog-release-index.json"
RUNTIME_MANIFEST_KEY = "manifest/manifest.json"
STAGE_B_RELEASE_ID = "catalog-v3-7-1-test-site-stage-b"
SUFFIX = "stage-b"
VERCEL_MARKERS = (b"vercel-storage.com", b"aagibolq28slyfof")
CACHE_CONTROL = "public, max-age=3600"
WORKERS = 8
UPLOAD_WORKERS = 4  # 80-94 MB metrics files time out when too many share the uplink
UPLOAD_ATTEMPTS = 4
UPLOAD_CHUNK_BYTES = 16 * 1024 * 1024

# A public file address on either host. It stops at the end of the JSON string.
PUBLIC_URL_PATTERN = re.compile(
    r"(?:https://aagibolq28slyfof\.public\.blob\.vercel-storage\.com"
    r"|https://storage\.googleapis\.com/pnn-priorizando-la-naturaleza-public)"
    r"(?=[/\"?#])[^\"\\\s]*"
)


@dataclass
class ScannedDocument:
    key: str
    generation: int
    has_vercel_refs: bool
    json_children: list[str] = field(default_factory=list)
    missing_json_children: list[str] = field(default_factory=list)


class StageBError(Exception):
    pass


def object_key_of(url: str) -> str:
    """Object name of a public address on either host, without query or fragment."""
    host = VERCEL_HOST if url.startswith(VERCEL_HOST) else PUBLIC_BASE
    path = re.split(r"[?#]", url[len(host) :], maxsplit=1)[0]
    return unquote(path.lstrip("/"))


def stage_b_key(key: str) -> str:
    """releases/x/manifest.json -> releases/x-stage-b/manifest.json; '-stage-a' folders become '-stage-b'."""
    parts = key.split("/")
    folder = parts[-2]
    parts[-2] = folder[: -len("-stage-a")] + "-" + SUFFIX if folder.endswith("-stage-a") else f"{folder}-{SUFFIX}"
    return "/".join(parts)


def is_whole_json_string(text: str, match: re.Match[str]) -> bool:
    return text[match.start() - 1 : match.start()] == '"' and text[match.end() : match.end() + 1] == '"'


def referenced_json_keys(text: str) -> list[str]:
    keys = []
    for match in PUBLIC_URL_PATTERN.finditer(text):
        if is_whole_json_string(text, match) and object_key_of(match.group(0)).endswith(".json"):
            keys.append(object_key_of(match.group(0)))
    return sorted(set(keys))


class Bucket:
    """One storage client per thread over the public file bucket."""

    def __init__(self, credentials: Path):
        self.credentials = credentials
        self.local = threading.local()

    def get(self) -> storage.Bucket:
        if not hasattr(self.local, "bucket"):
            client = storage.Client.from_service_account_json(str(self.credentials))
            self.local.bucket = client.bucket(PUBLIC_BUCKET)
        return self.local.bucket


class DocumentStore:
    """Downloads and scans source JSON files; caches results and rewrite candidates in work_dir."""

    def __init__(self, bucket: Bucket, listing: dict[str, int], work_dir: Path):
        self.bucket = bucket
        self.listing = listing
        self.docs_dir = work_dir / "docs"
        self.docs_dir.mkdir(parents=True, exist_ok=True)
        self.scan_path = work_dir / "scan.json"
        self.scans: dict[str, ScannedDocument] = {}
        if self.scan_path.exists():
            for key, value in json.loads(self.scan_path.read_text()).items():
                self.scans[key] = ScannedDocument(**value)
        self.lock = threading.Lock()
        self.downloaded_bytes = 0

    def cached_text_path(self, key: str) -> Path:
        return self.docs_dir / (hashlib.sha1(key.encode()).hexdigest() + ".json.gz")

    def scan(self, key: str) -> ScannedDocument:
        blob = self.bucket.get().get_blob(key)
        if blob is None:
            raise StageBError(f"{key} is not in the public bucket.")
        cached = self.scans.get(key)
        if cached and cached.generation == blob.generation:
            needs_text = cached.has_vercel_refs or cached.json_children
            if not needs_text or self.cached_text_path(key).exists():
                return cached
        raw = blob.download_as_bytes(if_generation_match=blob.generation, timeout=600)
        with self.lock:
            self.downloaded_bytes += len(raw)
        has_vercel_refs = any(marker in raw for marker in VERCEL_MARKERS)
        children: list[str] = []
        if has_vercel_refs or PUBLIC_BASE.encode() in raw:
            children = referenced_json_keys(raw.decode("utf-8"))
        document = ScannedDocument(
            key=key,
            generation=blob.generation,
            has_vercel_refs=has_vercel_refs,
            json_children=[child for child in children if child in self.listing],
            missing_json_children=[child for child in children if child not in self.listing],
        )
        if document.has_vercel_refs or document.json_children:
            self.cached_text_path(key).write_bytes(gzip.compress(raw, compresslevel=1))
        with self.lock:
            self.scans[key] = document
        return document

    def text(self, key: str) -> str:
        return gzip.decompress(self.cached_text_path(key).read_bytes()).decode("utf-8")

    def save(self) -> None:
        self.scan_path.write_text(json.dumps({key: asdict(doc) for key, doc in self.scans.items()}))


def crawl(store: DocumentStore, roots: list[str]) -> dict[str, ScannedDocument]:
    """Scans the roots and every JSON file they reference, level by level."""
    seen: dict[str, ScannedDocument] = {}
    frontier = list(roots)
    level = 0
    with ThreadPoolExecutor(WORKERS) as pool:
        while frontier:
            started = time.time()
            futures = [pool.submit(store.scan, key) for key in frontier]
            for done, future in enumerate(as_completed(futures), start=1):
                document = future.result()
                seen[document.key] = document
                if done % 100 == 0:
                    store.save()
                    print(
                        f"    {done}/{len(frontier)} scanned, {store.downloaded_bytes / 1e9:.1f} GB downloaded",
                        flush=True,
                    )
            store.save()
            print(
                f"  level {level}: scanned {len(frontier)} files in {time.time() - started:.0f}s "
                f"(downloaded so far {store.downloaded_bytes / 1e9:.1f} GB)",
                flush=True,
            )
            frontier = sorted(
                {child for doc in seen.values() for child in doc.json_children if child not in seen}
            )
            level += 1
    return seen


def plan_new_keys(documents: dict[str, ScannedDocument]) -> dict[str, str]:
    """Maps each JSON file that must change to its Stage B path, children before parents."""
    new_keys: dict[str, str] = {}
    state: dict[str, str] = {}

    def changes(key: str) -> bool:
        if state.get(key) == "done":
            return key in new_keys
        if state.get(key) == "visiting":
            print(f"  warning: reference cycle through {key}; the cycle keeps its original address")
            return False
        state[key] = "visiting"
        document = documents[key]
        child_changes = [changes(child) for child in document.json_children]
        if document.has_vercel_refs or any(child_changes):
            target = stage_b_key(key)
            if target in documents:
                raise StageBError(f"Stage B path {target} is itself part of the release graph.")
            new_keys[key] = target
        state[key] = "done"
        return key in new_keys

    for key in documents:
        changes(key)
    duplicates = [target for target, count in Counter(new_keys.values()).items() if count > 1]
    if duplicates:
        raise StageBError(f"Two files map to the same Stage B path, for example {duplicates[0]}.")
    return new_keys


def reachable(documents: dict[str, ScannedDocument], root: str) -> set[str]:
    found, stack = set(), [root]
    while stack:
        key = stack.pop()
        if key not in found:
            found.add(key)
            stack.extend(documents[key].json_children)
    return found


def rewrite_text(text: str, new_keys: dict[str, str], counts: Counter) -> str:
    """Moves every Vercel address to the bucket and points references at rewritten JSON files."""

    def replace(match: re.Match[str]) -> str:
        url = match.group(0)
        if text[match.end() : match.end() + 1] == "\\":
            raise StageBError(f"Escaped character inside {url[:120]}; refusing a text rewrite.")
        from_vercel = url.startswith(VERCEL_HOST)
        path_and_query = url[len(VERCEL_HOST if from_vercel else PUBLIC_BASE) :]
        query_start = re.search(r"[?#]", path_and_query)
        cut = query_start.start() if query_start else len(path_and_query)
        path, query_and_fragment = path_and_query[:cut], path_and_query[cut:]
        if is_whole_json_string(text, match) and object_key_of(url) in new_keys:
            path = "/" + stage_b_key(path.lstrip("/"))
            counts["json references repointed"] += 1
        if from_vercel:
            counts["vercel addresses moved"] += 1
        return f"{PUBLIC_BASE}{path}{query_and_fragment}"

    return PUBLIC_URL_PATTERN.sub(replace, text)


def verify_text(
    key: str,
    source: str,
    output: str,
    listing: dict[str, int],
    new_targets: set[str],
    prefixes: set[str],
) -> list[str]:
    """Returns problems: Vercel residue, changed private address count, or public objects that do not exist."""
    problems = []
    encoded = output.encode("utf-8")
    if any(marker in encoded for marker in VERCEL_MARKERS):
        problems.append(f"{key}: Vercel address remains")
    if source.count(PRIVATE_BASE) != output.count(PRIVATE_BASE):
        problems.append(f"{key}: private bucket address count changed")
    for match in PUBLIC_URL_PATTERN.finditer(output):
        object_key = object_key_of(match.group(0))
        if not object_key:
            continue
        if object_key.endswith("/"):
            if object_key not in prefixes:
                problems.append(f"{key}: missing prefix {object_key}")
        elif object_key not in listing and object_key not in new_targets:
            problems.append(f"{key}: missing object {object_key}")
    try:
        json.loads(output)
    except json.JSONDecodeError as error:
        problems.append(f"{key}: output is not valid JSON ({error})")
    return problems


def finish_release_index(text: str, rewritten_file_count: int) -> str:
    index = json.loads(text)
    index["releaseId"] = STAGE_B_RELEASE_ID
    index["generatedAt"] = datetime.now(timezone.utc).isoformat()
    index["stageB"] = {"publicBucket": PUBLIC_BUCKET, "rewrittenFileCount": rewritten_file_count}
    return json.dumps(index, indent=2) + "\n"


def upload(bucket: Bucket, target: str, data: bytes) -> str:
    """Creates target without overwriting; an existing target must already hold the same bytes.

    A failed attempt leaves no object (uploads are atomic), so it is retried; a retry that finds the
    object already written by the failed attempt is accepted through the MD5 check.
    """
    md5 = base64.b64encode(hashlib.md5(data).digest()).decode()
    existing = bucket.get().get_blob(target)
    if existing is not None:
        if existing.md5_hash == md5:
            return "already present"
        raise StageBError(f"{target} already exists with different content; refusing to overwrite.")
    for attempt in range(1, UPLOAD_ATTEMPTS + 1):
        blob = bucket.get().blob(target, chunk_size=UPLOAD_CHUNK_BYTES)
        blob.cache_control = CACHE_CONTROL
        try:
            blob.upload_from_string(
                data, content_type="application/json", if_generation_match=0, timeout=900
            )
            return "uploaded"
        except PreconditionFailed:
            existing = bucket.get().get_blob(target)
            if existing is not None and existing.md5_hash == md5:
                return "already present"
            raise StageBError(f"{target} already exists with different content; refusing to overwrite.")
        except (ConnectionError, RetryError, requests.exceptions.ConnectionError) as error:
            if attempt == UPLOAD_ATTEMPTS:
                raise
            print(f"  retrying {target} after {type(error).__name__} (attempt {attempt})", flush=True)
            time.sleep(10 * attempt)
    raise AssertionError("unreachable")


def list_public_bucket(bucket: Bucket) -> dict[str, int]:
    return {blob.name: blob.size for blob in bucket.get().client.list_blobs(PUBLIC_BUCKET)}


def directory_prefixes(listing: dict[str, int]) -> set[str]:
    prefixes = set()
    for name in listing:
        parts = name.split("/")[:-1]
        for depth in range(1, len(parts) + 1):
            prefixes.add("/".join(parts[:depth]) + "/")
    return prefixes


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument(
        "--credentials",
        type=Path,
        default=os.environ.get("GOOGLE_APPLICATION_CREDENTIALS"),
        help="Service account key with object create/get on the public bucket.",
    )
    parser.add_argument("--work-dir", type=Path, default=Path("/tmp/dmt-stage-b"))
    parser.add_argument("--dry-run", action="store_true", help="Scan, rewrite, and verify without uploading.")
    parser.add_argument(
        "--allow-missing-objects",
        action="store_true",
        help=(
            "Report, without blocking, public addresses whose object is not in the bucket. Use only after "
            "checking that the web app never fetches those fields (provenance, packet manifests, bitset index)."
        ),
    )
    args = parser.parse_args()
    if not args.credentials or not Path(args.credentials).exists():
        parser.error("--credentials (or GOOGLE_APPLICATION_CREDENTIALS) must name an existing key file.")
    args.work_dir.mkdir(parents=True, exist_ok=True)

    bucket = Bucket(Path(args.credentials))
    print("Listing the public bucket...", flush=True)
    listing = list_public_bucket(bucket)
    prefixes = directory_prefixes(listing)
    print(f"  {len(listing)} objects")

    store = DocumentStore(bucket, listing, args.work_dir)
    print("Scanning the release graph and manifest/manifest.json...", flush=True)
    documents = crawl(store, [STAGE_A_INDEX_KEY, RUNTIME_MANIFEST_KEY])
    new_keys = plan_new_keys(documents)
    release_graph = reachable(documents, STAGE_A_INDEX_KEY)
    if STAGE_A_INDEX_KEY not in new_keys or RUNTIME_MANIFEST_KEY not in new_keys:
        raise StageBError("The release index and manifest/manifest.json must both change.")
    new_targets = set(new_keys.values())

    # Children first, so a referrer never names a file that is not uploaded yet; the index goes last.
    upload_order = [key for key in new_keys if key != STAGE_A_INDEX_KEY] + [STAGE_A_INDEX_KEY]
    rewritten_in_release = len([key for key in new_keys if key in release_graph]) - 1

    def build(key: str, counts: Counter) -> tuple[str, str]:
        source = store.text(key)
        output = rewrite_text(source, new_keys, counts)
        if key == STAGE_A_INDEX_KEY:
            output = finish_release_index(output, rewritten_in_release)
        return source, output

    print(f"Rewriting and verifying {len(upload_order)} files...", flush=True)
    counts_by_key: dict[str, Counter] = {}
    release_problems: list[str] = []
    release_missing: list[str] = []
    manifest_only_problems: list[str] = []

    def rewrite_and_verify(key: str) -> tuple[str, Counter, list[str]]:
        counts: Counter = Counter()
        source, output = build(key, counts)
        return key, counts, verify_text(key, source, output, listing, new_targets, prefixes)

    with ThreadPoolExecutor(WORKERS) as pool:
        for key, counts, problems in pool.map(rewrite_and_verify, upload_order):
            counts_by_key[key] = counts
            if key not in release_graph:
                manifest_only_problems.extend(problems)
                continue
            for problem in problems:
                (release_missing if ": missing " in problem else release_problems).append(problem)
    if not args.allow_missing_objects:
        release_problems.extend(release_missing)

    total = sum(counts_by_key.values(), Counter())
    missing_in_runtime_manifest = [p for p in manifest_only_problems if ": missing " in p]
    distinct_release_missing = sorted({problem.rsplit(" ", 1)[-1] for problem in release_missing})
    summary = {
        "graphFilesScanned": len(documents),
        "releaseGraphFiles": len(release_graph),
        "filesRewritten": len(new_keys),
        "releaseGraphFilesRewritten": rewritten_in_release + 1,
        "vercelAddressesMoved": total["vercel addresses moved"],
        "jsonReferencesRepointed": total["json references repointed"],
        "gigabytesDownloadedThisRun": round(store.downloaded_bytes / 1e9, 2),
        "targetsAlreadyInBucket": len([target for target in new_targets if target in listing]),
        "releaseGraphProblems": len(release_problems),
        "releaseGraphMissingObjects": len(distinct_release_missing),
        "releaseGraphMissingObjectsByFolder": Counter(
            name.rsplit("/", 1)[0] for name in distinct_release_missing
        ).most_common(),
        "runtimeManifestOnlyProblems": len(manifest_only_problems),
        "runtimeManifestMissingJsonChildren": sorted(
            {child for key in documents if key not in release_graph for child in documents[key].missing_json_children}
        )[:10],
        "newPathsByFolder": Counter(target.rsplit("/", 1)[0] for target in new_targets).most_common(),
        "releaseIndexUrl": f"{PUBLIC_BASE}/{new_keys[STAGE_A_INDEX_KEY]}",
        "runtimeManifestUrl": f"{PUBLIC_BASE}/{new_keys[RUNTIME_MANIFEST_KEY]}",
    }
    (args.work_dir / "plan.json").write_text(
        json.dumps(
            {
                "summary": summary,
                "newKeys": new_keys,
                "releaseProblems": release_problems,
                "releaseMissingObjects": distinct_release_missing,
                "releaseMissingReferences": release_missing,
                "runtimeManifestProblems": manifest_only_problems,
            },
            indent=2,
        )
    )
    print(json.dumps(summary, indent=2))
    for problem in release_problems[:20]:
        print(f"  RELEASE PROBLEM {problem}")
    if missing_in_runtime_manifest:
        print(
            f"  note: manifest-stage-b names {len(missing_in_runtime_manifest)} public objects that are not in the "
            f"bucket (see {args.work_dir / 'plan.json'})"
        )
    if release_problems:
        print("Release graph failed verification; nothing uploaded.")
        return 1
    if args.dry_run:
        print("Dry run: nothing uploaded.")
        return 0

    print(f"Uploading {len(upload_order)} files (new paths only)...", flush=True)
    results: Counter = Counter()
    children = upload_order[:-1]

    def build_and_upload(key: str) -> str:
        _, output = build(key, Counter())
        return upload(bucket, new_keys[key], output.encode("utf-8"))

    started = time.time()
    with ThreadPoolExecutor(UPLOAD_WORKERS) as pool:
        for done, result in enumerate(pool.map(build_and_upload, children), start=1):
            results[result] += 1
            if done % 100 == 0:
                print(f"  {done}/{len(children)} in {time.time() - started:.0f}s", flush=True)
    results[build_and_upload(STAGE_A_INDEX_KEY)] += 1
    print(f"Upload results: {dict(results)}")
    print(f"Catalog release index: {summary['releaseIndexUrl']}")
    print(f"Runtime manifest for the backend hydrate: {summary['runtimeManifestUrl']}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except StageBError as error:
        print(f"error: {error}", file=sys.stderr)
        sys.exit(1)
