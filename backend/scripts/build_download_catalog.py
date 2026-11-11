"""Build the Blob URL Signing Service download catalog from the latest published manifests.

Reads the catalog release index the production web app loads, downloads every manifest it lists,
and writes an object map that DMT_DOWNLOAD_CATALOG_PATH can point at:
{"objects": {"<object key>": {"sirap_id": "<region>" | null}}}.

Tags come from app.downloads.catalog.index_catalog_document, the same code the service runs.
A file used only by one region's layers or solutions that those rules miss is added with that
region. The build fails when such a file carries a national or other-region tag, so a wrong tag
can never open a regional file to every user.

This script only reads manifests and writes a local file. On the Metrics API VM:
    docker compose -f backend/docker-compose.yml run --rm --no-deps backend \
        python -m scripts.build_download_catalog
From the repository root: npm run downloads:build-catalog
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.request
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

BACKEND_ROOT = Path(__file__).resolve().parents[1]
REPOSITORY_ROOT = BACKEND_ROOT.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.downloads.access import CONFLICTING_SIRAP  # noqa: E402
from app.downloads.catalog import index_catalog_document  # noqa: E402
from app.downloads.object_names import object_name_from_reference  # noqa: E402

RUNTIME_MANIFEST_CONSTANTS = REPOSITORY_ROOT / "frontend" / "shared" / "runtime-manifest.constants.mjs"
# Used when the frontend constants file is absent, as in the backend Docker image.
FALLBACK_RELEASE_INDEX_URL = (
    "https://aagibolq28slyfof.public.blob.vercel-storage.com/catalog-releases/3.7.1/catalog-release-index.json"
)
CATALOG_FILE_NAME = "download-catalog.json"
CATALOG_FORMAT = "download-catalog-object-map-v1"
# Shared Colombia-wide assets that regional solutions load. The service keeps them national.
COLOMBIA_WIDE_FIELDS = frozenset({"mecNationalDenominator", "speciesGoalsCatalog", "speciesGoalsTargetOverlay"})


def default_output_path() -> Path:
    return Path(os.getenv("DMT_ARTIFACT_DIR", str(BACKEND_ROOT / "runtime-artifacts"))) / CATALOG_FILE_NAME


def default_release_index_url() -> str:
    """The web app's RUNTIME_CATALOG_RELEASE_INDEX_BLOB_URL, read from its shared constants file."""
    if not RUNTIME_MANIFEST_CONSTANTS.exists():
        return FALLBACK_RELEASE_INDEX_URL
    text = RUNTIME_MANIFEST_CONSTANTS.read_text(encoding="utf-8")
    host = re.search(r"PUBLIC_BLOB_HOST\s*=\s*'([^']+)'", text)
    pathname = re.search(r"RUNTIME_CATALOG_RELEASE_INDEX_PATHNAME\s*=\s*'([^']+)'", text)
    if host is None or pathname is None:
        raise SystemExit(f"Could not read the release index address from {RUNTIME_MANIFEST_CONSTANTS}.")
    return f"{host.group(1).rstrip('/')}/{pathname.group(1)}"


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--release-index-url",
        help="Catalog release index to read. Defaults to the one the production web app loads.",
    )
    parser.add_argument(
        "--manifest",
        action="append",
        default=[],
        help="Manifest URL (https) or local path to use instead of the release index. Repeat for each manifest.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=None,
        help=f"Output file. Defaults to $DMT_ARTIFACT_DIR/{CATALOG_FILE_NAME}.",
    )
    return parser.parse_args(argv)


def fetch_json(url: str) -> dict[str, Any]:
    separator = "&" if "?" in url else "?"
    with urllib.request.urlopen(f"{url}{separator}v={int(time.time() * 1000)}", timeout=300) as response:
        document = json.load(response)
    if not isinstance(document, dict):
        raise SystemExit(f"{url} is not a JSON object.")
    return document


def read_manifest(source: str) -> dict[str, Any]:
    if source.startswith("https://"):
        return fetch_json(source)
    document = json.loads(Path(source).read_text(encoding="utf-8"))
    if not isinstance(document, dict):
        raise SystemExit(f"{source} is not a JSON object.")
    return document


def load_manifests(args: argparse.Namespace) -> tuple[str | None, list[tuple[str, dict[str, Any]]]]:
    if args.manifest:
        return None, [(source, read_manifest(source)) for source in args.manifest]
    index_url = args.release_index_url or default_release_index_url()
    index = fetch_json(index_url)
    batches = index.get("batches")
    urls = [batch["manifestUrl"] for batch in batches or [] if isinstance(batch, dict) and batch.get("manifestUrl")]
    if not urls:
        raise SystemExit(f"{index_url} lists no manifests.")
    return index_url, [(url, fetch_json(url)) for url in urls]


def build_object_map(manifests: list[dict[str, Any]]) -> dict[str, str | None]:
    """Index every layer and solution of every manifest together, so cross-manifest rows merge like one file."""
    combined: dict[str, list[Any]] = {"layers": [], "solutions": []}
    for manifest in manifests:
        for field in combined:
            records = manifest.get(field)
            if isinstance(records, list):
                combined[field].extend(records)
    return index_catalog_document(combined)


def regional_only_references(manifests: list[dict[str, Any]]) -> dict[str, str]:
    """Every file key that records of exactly one region reference, and no national record does.

    Walks every string in each record, not only the fields the service reads, so a reference under
    a new field name still has to be tagged.
    """
    regions_by_key: dict[str, set[str]] = {}
    national_keys: set[str] = set()
    for manifest in manifests:
        for field, value in manifest.items():
            if field in ("layers", "solutions") and isinstance(value, list):
                for record in value:
                    sirap_id = record.get("sirapId") if isinstance(record, dict) else None
                    sirap_id = sirap_id.strip() if isinstance(sirap_id, str) else ""
                    for key, colombia_wide in _references(record, "", False):
                        if not sirap_id:
                            national_keys.add(key)
                        elif not colombia_wide:
                            regions_by_key.setdefault(key, set()).add(sirap_id)
            else:
                national_keys.update(key for key, _ in _references(value, field, False))
    return {
        key: next(iter(regions))
        for key, regions in regions_by_key.items()
        if len(regions) == 1 and key not in national_keys
    }


def _references(node: Any, field: str, colombia_wide: bool) -> list[tuple[str, bool]]:
    found: list[tuple[str, bool]] = []
    if isinstance(node, str):
        key = object_name_from_reference(node)
        if key is not None and ("://" in node or (field.endswith("Path") and "/" in node)):
            found.append((key, colombia_wide))
    elif isinstance(node, list):
        for item in node:
            found.extend(_references(item, field, colombia_wide))
    elif isinstance(node, dict):
        for child_field, child in node.items():
            found.extend(_references(child, child_field, colombia_wide or child_field in COLOMBIA_WIDE_FIELDS))
    return found


def summarize(objects: dict[str, str | None]) -> str:
    counts = Counter(
        "conflicting" if sirap_id == CONFLICTING_SIRAP else (sirap_id or "national") for sirap_id in objects.values()
    )
    parts = [f"{label}={counts[label]}" for label in sorted(counts)]
    return f"objects={len(objects)} " + " ".join(parts)


def write_catalog(document: dict[str, Any], output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    # The service reloads on mtime, so replace the file in one step.
    temporary = output.with_name(output.name + ".tmp")
    temporary.write_text(json.dumps(document, indent=1) + "\n", encoding="utf-8")
    os.replace(temporary, output)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    output = args.output or default_output_path()
    index_url, named_manifests = load_manifests(args)
    manifests = [document for _, document in named_manifests]
    objects = build_object_map(manifests)
    if not objects:
        print("[download-catalog] no object keys found; nothing written", file=sys.stderr)
        return 1

    gaps = []
    added = []
    for key, sirap_id in sorted(regional_only_references(manifests).items()):
        if key not in objects:
            objects[key] = sirap_id
            added.append(key)
        tag = objects[key]
        if tag != sirap_id:
            shown = "conflicting regions" if tag == CONFLICTING_SIRAP else (tag or "national")
            gaps.append(f"{key}: expected {sirap_id}, catalog has {shown}")
    if gaps:
        print(f"{len(gaps)} regional-only files are not tagged with their region:", file=sys.stderr)
        for gap in gaps[:20]:
            print(f"  {gap}", file=sys.stderr)
        return 1

    if added:
        print(f"Added {len(added)} regional-only files the service's field rules do not reach:", file=sys.stderr)
        for key in added[:20]:
            print(f"  {key}: {objects[key]}", file=sys.stderr)
    conflicting = sorted(key for key, tag in objects.items() if tag == CONFLICTING_SIRAP)
    if conflicting:
        print(f"{len(conflicting)} keys have conflicting regions and are left out:", file=sys.stderr)
        for key in conflicting[:20]:
            print(f"  {key}", file=sys.stderr)

    document = {
        "format": CATALOG_FORMAT,
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "releaseIndexUrl": index_url,
        "sources": [name for name, _ in named_manifests],
        # A conflicting key is left out, so the service refuses it instead of treating it as national.
        "objects": {key: {"sirap_id": tag} for key, tag in sorted(objects.items()) if tag != CONFLICTING_SIRAP},
    }
    write_catalog(document, output)
    print(f"[download-catalog] wrote {output}: {summarize(objects)}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
