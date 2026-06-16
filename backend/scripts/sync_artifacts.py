from __future__ import annotations

import argparse
import json
import os
from datetime import UTC, datetime
from pathlib import Path

DEFAULT_PREFIXES = [
    "inputs/costs/",
    "inputs/features/",
    "inputs/includes/",
]


def build_manifest(prefixes: list[str]) -> dict[str, object]:
    return {
        "artifact_version": "dry-run",
        "schema_version": "metrics-artifact-manifest/v1",
        "created_at": datetime.now(UTC).isoformat(),
        "checksum": {
            "algorithm": "none",
            "value": "not-computed-dry-run",
        },
        "source_manifest": {
            "store_name": "decision-making-tool-blob",
            "public_host": "https://aagibolq28slyfof.public.blob.vercel-storage.com",
            "planned_prefixes": prefixes,
        },
        "files": [],
        "notes": "Skeleton manifest only. No heavy artifacts are downloaded by this script.",
    }


def validate_manifest_metadata(manifest: dict[str, object]) -> None:
    required_fields = {
        "artifact_version",
        "schema_version",
        "created_at",
        "checksum",
        "source_manifest",
    }
    missing_fields = sorted(required_fields - manifest.keys())
    if missing_fields:
        raise ValueError(
            f"Manifest metadata is missing required fields: {', '.join(missing_fields)}."
        )

    checksum = manifest.get("checksum")
    if not isinstance(checksum, dict) or not checksum.get("algorithm") or not checksum.get("value"):
        raise ValueError("Manifest metadata checksum must include algorithm and value.")

    if not isinstance(manifest.get("source_manifest"), dict):
        raise ValueError("Manifest metadata source_manifest must be an object.")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Plan Vercel Blob artifact sync without downloading heavy data."
    )
    parser.add_argument(
        "--prefix",
        action="append",
        dest="prefixes",
        help="Blob prefix to include in the planned sync. Can be repeated.",
    )
    parser.add_argument(
        "--artifact-dir",
        default="runtime-artifacts",
        help="Directory where lightweight manifest metadata should be written.",
    )
    parser.add_argument(
        "--write-manifest",
        action="store_true",
        help="Write a lightweight dry-run manifest.json file.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    prefixes = args.prefixes or DEFAULT_PREFIXES
    token_present = bool(os.getenv("BLOB_READ_WRITE_TOKEN"))

    print("Vercel Blob artifact sync skeleton")
    print(f"BLOB_READ_WRITE_TOKEN present: {token_present}")
    print("Planned source prefixes:")
    for prefix in prefixes:
        print(f"- {prefix}")

    if not args.write_manifest:
        print("Dry run only. Use --write-manifest to write lightweight metadata.")
        return 0

    artifact_dir = Path(args.artifact_dir)
    artifact_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = artifact_dir / "manifest.json"
    manifest = build_manifest(prefixes)
    validate_manifest_metadata(manifest)
    manifest_path.write_text(
        json.dumps(manifest, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"Wrote lightweight manifest metadata to {manifest_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
