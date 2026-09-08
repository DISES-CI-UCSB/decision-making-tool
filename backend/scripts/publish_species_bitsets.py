"""Publish prebuilt species bitsets so hydrate can download instead of rebuilding.

Reads the national and SIRAP kits already in the Docker volume, uploads
``species.cells.bits`` plus ``species.cells.json`` for each kit, then writes
``runtime-artifacts/species-bitsets/index.json``.

Does not overwrite ``releases/sirap-2026-09-02-v6/manifest.json``.
Never prints ``BLOB_READ_WRITE_TOKEN``.
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

BACKEND_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_ROOT.parent
METRICS_PIPELINE = REPO_ROOT / "data" / "metrics" / "python" / "metrics_pipeline"
for _import_root in (BACKEND_ROOT, METRICS_PIPELINE):
    if str(_import_root) not in sys.path:
        sys.path.insert(0, str(_import_root))

from sparse.vercel_blob import (  # noqa: E402
    BlobError,
    load_token_from_env_file,
    public_url_for,
    upload_blob,
)

from scripts.species_bitset_cache import (  # noqa: E402
    DEFAULT_INDEX_PATHNAME,
    SUPPORTED_KIT_IDS,
    build_index_document,
    file_ref,
    kit_blob_pathnames,
    read_bitset_sidecar_header,
)

DEFAULT_CONTAINER = "decision-making-tool-backend-1"
CONTAINER_KITS: dict[str, tuple[str, str]] = {
    "national": (
        "/backend/runtime-artifacts/sources/species-bitset/species.cells.bits",
        "/backend/runtime-artifacts/sources/species-bitset/species.cells.json",
    ),
    "orinoquia": (
        "/backend/runtime-artifacts/sirap/orinoquia/sources/species-bitset/species.cells.bits",
        "/backend/runtime-artifacts/sirap/orinoquia/sources/species-bitset/species.cells.json",
    ),
    "eje-cafetero": (
        "/backend/runtime-artifacts/sirap/eje-cafetero/sources/species-bitset/species.cells.bits",
        "/backend/runtime-artifacts/sirap/eje-cafetero/sources/species-bitset/species.cells.json",
    ),
}
CONTAINER_MANIFESTS: dict[str, str] = {
    "national": "/backend/runtime-artifacts/manifest.json",
    "orinoquia": "/backend/runtime-artifacts/sirap/orinoquia/manifest.json",
    "eje-cafetero": "/backend/runtime-artifacts/sirap/eje-cafetero/manifest.json",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--container", default=DEFAULT_CONTAINER)
    parser.add_argument(
        "--staging-dir",
        type=Path,
        default=Path("/tmp/dmt-species-bitsets"),
    )
    parser.add_argument(
        "--kits",
        nargs="+",
        default=list(SUPPORTED_KIT_IDS),
        choices=list(SUPPORTED_KIT_IDS),
    )
    parser.add_argument(
        "--skip-data",
        action="store_true",
        help="Publish metadata + index only (debug).",
    )
    return parser.parse_args()


def _run(args: list[str]) -> None:
    completed = subprocess.run(args, check=False)
    if completed.returncode != 0:
        raise SystemExit(f"command failed ({completed.returncode}): {args[0]}")


def _docker_cp(container: str, source: str, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    _run(["docker", "cp", f"{container}:{source}", str(destination)])


def _container_json(container: str, path: str) -> dict[str, Any]:
    completed = subprocess.run(
        ["docker", "exec", container, "python", "-c", f"import json; print(json.dumps(json.load(open({path!r}))))"],
        check=False,
        capture_output=True,
        text=True,
    )
    if completed.returncode != 0:
        raise SystemExit(
            completed.stderr.strip() or f"failed to read {path} from {container}"
        )
    payload = json.loads(completed.stdout)
    if not isinstance(payload, dict):
        raise SystemExit(f"{path} was not a JSON object")
    return payload


def _manifest_bitset(manifest: dict[str, Any]) -> dict[str, Any]:
    bitset = manifest.get("species_bitset")
    if not isinstance(bitset, dict):
        raise SystemExit("runtime manifest is missing species_bitset")
    return bitset


def _checksum_size(entry: dict[str, Any]) -> tuple[str, int]:
    checksum = entry.get("checksum")
    value = checksum.get("value") if isinstance(checksum, dict) else None
    size_bytes = entry.get("size_bytes")
    if not isinstance(value, str) or len(value) != 64:
        raise SystemExit("species_bitset checksum is missing")
    if not isinstance(size_bytes, int) or size_bytes <= 0:
        raise SystemExit("species_bitset size_bytes is missing")
    return value, size_bytes


def publish_kit(
    *,
    kit_id: str,
    container: str,
    staging_dir: Path,
    token: str,
    skip_data: bool,
) -> dict[str, Any]:
    data_src, metadata_src = CONTAINER_KITS[kit_id]
    manifest = _container_json(container, CONTAINER_MANIFESTS[kit_id])
    bitset = _manifest_bitset(manifest)
    data_sha, data_size = _checksum_size(bitset["data"])
    metadata_sha, metadata_size = _checksum_size(bitset["metadata"])
    pathnames = kit_blob_pathnames(kit_id)

    metadata_local = staging_dir / kit_id / "species.cells.json"
    print(f"[bitset-publish] {kit_id} metadata {metadata_size} bytes", flush=True)
    _docker_cp(container, metadata_src, metadata_local)
    if metadata_local.stat().st_size != metadata_size:
        raise SystemExit(f"{kit_id} metadata size mismatch after docker cp")
    upload_blob(metadata_local, pathnames["metadata"], token=token)

    if skip_data:
        data_ref = file_ref(pathname=pathnames["data"], sha256=data_sha, size_bytes=data_size)
    else:
        data_local = staging_dir / kit_id / "species.cells.bits"
        print(f"[bitset-publish] {kit_id} data {data_size} bytes (copy + upload)", flush=True)
        _docker_cp(container, data_src, data_local)
        if data_local.stat().st_size != data_size:
            raise SystemExit(f"{kit_id} data size mismatch after docker cp")
        upload_blob(data_local, pathnames["data"], token=token)
        data_local.unlink()
        data_ref = file_ref(pathname=pathnames["data"], sha256=data_sha, size_bytes=data_size)

    header = read_bitset_sidecar_header(metadata_local)
    return {
        "kit_id": kit_id,
        "format": header["format"],
        "species_count": header["species_count"],
        "bytes_per_cell": header["bytes_per_cell"],
        "grid": header["grid"],
        "data": data_ref,
        "metadata": file_ref(
            pathname=pathnames["metadata"],
            sha256=metadata_sha,
            size_bytes=metadata_size,
        ),
    }


def main() -> None:
    args = parse_args()
    token = load_token_from_env_file(REPO_ROOT / ".env.local")
    print(f"BLOB_READ_WRITE_TOKEN present: {bool(token)}", flush=True)
    args.staging_dir.mkdir(parents=True, exist_ok=True)
    kit_order = ("eje-cafetero", "orinoquia", "national")
    kits: dict[str, Any] = {}
    for kit_id in kit_order:
        if kit_id not in args.kits:
            continue
        kits[kit_id] = publish_kit(
            kit_id=kit_id,
            container=args.container,
            staging_dir=args.staging_dir,
            token=token,
            skip_data=args.skip_data,
        )
    index = build_index_document(
        kits,
        created_at=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    )
    index_path = args.staging_dir / "index.json"
    index_path.write_text(json.dumps(index, indent=2) + "\n", encoding="utf-8")
    upload_blob(index_path, DEFAULT_INDEX_PATHNAME, token=token)
    print(f"[bitset-publish] index {public_url_for(DEFAULT_INDEX_PATHNAME)}", flush=True)
    for kit_id, entry in kits.items():
        print(
            f"[bitset-publish] {kit_id} species={entry['species_count']} "
            f"data={entry['data']['size_bytes']}",
            flush=True,
        )
    shutil.rmtree(args.staging_dir, ignore_errors=True)


if __name__ == "__main__":
    try:
        main()
    except BlobError as exc:
        raise SystemExit(str(exc)) from exc
