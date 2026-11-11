"""Build the Download Catalog file for the Blob URL Signing Service.

Merges published layer manifests into one object map that
DMT_DOWNLOAD_CATALOG_PATH can point at. A key tagged with a SIRAP region in any
manifest stays restricted.

Intended invoke on the Metrics API VM:
    docker compose -f backend/docker-compose.yml run --rm --no-deps backend \
        python -m scripts.build_download_catalog
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.request
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.downloads.access import CONFLICTING_SIRAP  # noqa: E402
from app.downloads.catalog import index_catalog_document  # noqa: E402

PUBLIC_RELEASES_URL = "https://aagibolq28slyfof.public.blob.vercel-storage.com/releases"
# The release tests expect a catalog built from exactly these two manifests.
DEFAULT_MANIFEST_SOURCES = (
    f"{PUBLIC_RELEASES_URL}/catalog-v3-7-1/manifest.json",
    f"{PUBLIC_RELEASES_URL}/sirap-2026-09-09-v7-endemic/manifest.json",
)
CATALOG_FILE_NAME = "download-catalog.json"


def default_output_path() -> Path:
    return Path(os.getenv("DMT_ARTIFACT_DIR", "runtime-artifacts")) / CATALOG_FILE_NAME


def read_manifest(source: str) -> dict[str, object]:
    if source.startswith("https://"):
        with urllib.request.urlopen(source, timeout=300) as response:
            document = json.load(response)
    else:
        document = json.loads(Path(source).read_text(encoding="utf-8"))
    if not isinstance(document, dict):
        raise ValueError(f"{source} is not a JSON object.")
    return document


def build_catalog_index(manifests: list[dict[str, object]]) -> dict[str, str | None]:
    merged: dict[str, list[object]] = {"layers": [], "solutions": []}
    for manifest in manifests:
        for section in ("layers", "solutions"):
            records = manifest.get(section)
            if isinstance(records, list):
                merged[section].extend(records)
    return index_catalog_document(merged)


def write_catalog(index: dict[str, str | None], output: Path, sources: list[str]) -> None:
    document = {
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "sources": sources,
        "objects": {name: {"sirap_id": index[name]} for name in sorted(index)},
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    # The service reloads on mtime, so replace the file in one step.
    temporary = output.with_name(output.name + ".tmp")
    temporary.write_text(json.dumps(document, indent=1) + "\n", encoding="utf-8")
    os.replace(temporary, output)


def summarize(index: dict[str, str | None]) -> str:
    counts = Counter(
        "conflicting" if sirap_id == CONFLICTING_SIRAP else (sirap_id or "national")
        for sirap_id in index.values()
    )
    parts = [f"{label}={counts[label]}" for label in sorted(counts)]
    return f"objects={len(index)} " + " ".join(parts)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--manifest",
        action="append",
        dest="manifests",
        help="Manifest URL (https) or local path. Repeat for each manifest. "
        "Defaults to the national 3.7.1 and SIRAP v7-endemic manifests.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=None,
        help=f"Output file. Defaults to $DMT_ARTIFACT_DIR/{CATALOG_FILE_NAME}.",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    sources = list(args.manifests or DEFAULT_MANIFEST_SOURCES)
    output = args.output or default_output_path()
    manifests = []
    for source in sources:
        print(f"[download-catalog] reading {source}", flush=True)
        manifests.append(read_manifest(source))
    index = build_catalog_index(manifests)
    if not index:
        print("[download-catalog] no object keys found; nothing written", file=sys.stderr)
        return 1
    write_catalog(index, output, sources)
    print(f"[download-catalog] wrote {output}: {summarize(index)}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
