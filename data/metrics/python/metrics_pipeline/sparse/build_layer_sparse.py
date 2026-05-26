"""CLI: detect, build, and upload ``.sparse.gz`` sidecars for non-species layers.

The non-species layer set is small (12 entries today) so the CLI runs in
under a minute end-to-end.  By default it:

1. Fetches the live Vercel manifest to resolve up-to-date layer URLs.
2. Lists existing ``.sparse.gz`` blobs under each layer's directory and
   subtracts to find the missing ones.
3. Downloads each missing source ``.tif`` (using the pipeline's existing
   ``cached_download`` so re-runs are fast), encodes the sparse artifact,
   writes it to ``data/metrics/cache/sparse/layers/`` locally.
4. Uploads each new sidecar to its ``inputs/<...>/<stem>.sparse.gz`` path
   on Vercel Blob.

Examples::

    # Dry-run: report what's missing, build nothing
    python -m metrics_pipeline.sparse.build_layer_sparse --dry-run

    # Build local-only (verify files before upload)
    python -m metrics_pipeline.sparse.build_layer_sparse --no-upload

    # Build + upload everything (default)
    python -m metrics_pipeline.sparse.build_layer_sparse

    # Force-rebuild and overwrite a single layer
    python -m metrics_pipeline.sparse.build_layer_sparse --only paramos --force

The ``--force`` flag bypasses the existence check and re-uploads even if
a ``.sparse.gz`` is already on Vercel.  Useful when the encoder logic
changes.
"""

from __future__ import annotations

import argparse
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

# Add metrics_pipeline/ to sys.path so siblings-of-main (blob_manifest,
# local_io) can be imported directly, the same way main.py and the other
# pipeline scripts do.
_PIPELINE_ROOT = Path(__file__).resolve().parent.parent
if str(_PIPELINE_ROOT) not in sys.path:
    sys.path.insert(0, str(_PIPELINE_ROOT))

from blob_manifest import (  # noqa: E402
    DEFAULT_MANIFEST_URL,
    ManifestError,
    fetch_manifest,
)
from local_io import cached_download  # noqa: E402

from sparse.format import encode_sparse_artifact  # noqa: E402
from sparse.layer_inputs import (  # noqa: E402
    SparseLayerInput,
    filter_inputs,
    resolve_sparse_layer_inputs,
)
from sparse.tif_io import encode_tif_to_artifact, parse_layer_type  # noqa: E402
from sparse.vercel_blob import (  # noqa: E402
    BlobError,
    list_blobs,
    load_token_from_env_file,
    public_url_for,
    upload_blob,
)

DEFAULT_LOCAL_CACHE = Path("data/metrics/cache/sparse/layers")
DEFAULT_TIF_CACHE = Path("data/metrics/cache/tier1")


@dataclass
class LayerBuildResult:
    layer: SparseLayerInput
    status: str  # "skipped" | "built" | "uploaded" | "error"
    occupied: int = 0
    src_bytes: int = 0
    dst_bytes: int = 0
    local_path: Path | None = None
    public_url: str | None = None
    error: str | None = None


@dataclass
class LayerBuildReport:
    started_at: float
    items: list[LayerBuildResult] = field(default_factory=list)

    def add(self, item: LayerBuildResult) -> None:
        self.items.append(item)


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--manifest-url", default=DEFAULT_MANIFEST_URL,
        help="Vercel manifest URL.",
    )
    parser.add_argument(
        "--cache-dir", type=Path, default=DEFAULT_TIF_CACHE,
        help="Local TIF download cache (re-uses tier1 cache by default).",
    )
    parser.add_argument(
        "--local-output-dir", type=Path, default=DEFAULT_LOCAL_CACHE,
        help="Where to write generated .sparse.gz files locally.",
    )
    parser.add_argument(
        "--only", nargs="+", default=None,
        help="Only process these layer ids (e.g. paramos coberturas).",
    )
    parser.add_argument(
        "--skip", nargs="+", default=None,
        help="Skip these layer ids.",
    )
    parser.add_argument(
        "--force", action="store_true",
        help="Re-encode and re-upload even if a .sparse.gz already exists.",
    )
    parser.add_argument(
        "--no-upload", action="store_true",
        help="Generate locally only; do not call vercel blob put.",
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Report what would be done; build and upload nothing.",
    )
    return parser.parse_args(argv)


def _existing_sparse_paths(inputs: list[SparseLayerInput], token: str) -> set[str]:
    """Return the set of sparse pathnames that already exist on Vercel.

    Lists the parent directories of each layer (deduplicated) and gathers
    every ``.sparse.gz`` entry seen.  This is one CLI call per directory,
    typically 4–5 calls for the 12 layers.
    """
    parent_prefixes = sorted({_parent_prefix(item.sparse_pathname) for item in inputs})
    existing: set[str] = set()
    for prefix in parent_prefixes:
        try:
            entries = list_blobs(prefix, token=token, limit=1000)
        except BlobError as exc:
            print(
                f"[layer-sparse] WARNING: could not list '{prefix}': {exc}",
                file=sys.stderr,
            )
            continue
        for entry in entries:
            if entry.pathname.endswith(".sparse.gz"):
                existing.add(entry.pathname)
    return existing


def _parent_prefix(pathname: str) -> str:
    if "/" not in pathname:
        return ""
    return pathname.rsplit("/", 1)[0] + "/"


def _print_plan(items: list[LayerBuildResult]) -> None:
    width = max((len(item.layer.layer_id) for item in items), default=10)
    for item in items:
        marker = {"built": "WILL BUILD", "skipped": "skip", "uploaded": "uploaded"}.get(
            item.status, item.status
        )
        print(
            f"[layer-sparse]   {marker:>10}  "
            f"{item.layer.layer_id.ljust(width)}  "
            f"{item.layer.layer_type:>11}  "
            f"{item.layer.sparse_pathname}"
        )


def _print_summary(report: LayerBuildReport, *, mode: str) -> None:
    by_status: dict[str, int] = {}
    for item in report.items:
        by_status[item.status] = by_status.get(item.status, 0) + 1

    elapsed = time.time() - report.started_at
    print(f"[layer-sparse] {mode} complete in {elapsed:.1f}s")
    print(f"[layer-sparse] status counts: {by_status}")

    total_src = sum(item.src_bytes for item in report.items if item.src_bytes)
    total_dst = sum(item.dst_bytes for item in report.items if item.dst_bytes)
    if total_src:
        ratio = total_dst / total_src if total_src else 0.0
        print(
            f"[layer-sparse] total source: {total_src:,} B   "
            f"sparse: {total_dst:,} B   ratio: {ratio:.3f}"
        )

    for item in report.items:
        if item.error:
            print(f"[layer-sparse]   ERROR {item.layer.layer_id}: {item.error}", file=sys.stderr)


def _build_one(
    layer: SparseLayerInput,
    *,
    cache_dir: Path,
    local_output_dir: Path,
) -> tuple[bytes, int, int]:
    """Encode a single layer's .sparse.gz, write locally, return (bytes, occupied, dst_size).

    The src TIF is fetched via ``cached_download`` (HTTP) using the public
    Vercel URL; that helper reuses the tier1 cache.
    """
    public_tif_url = public_url_for(layer.tif_pathname)
    download = cached_download(public_tif_url, cache_dir)
    local_tif: Path = download.path

    artifact = encode_tif_to_artifact(
        local_tif,
        layer_type=parse_layer_type(layer.layer_type),
        selected_value=layer.selected_value,
        selected_values=list(layer.selected_values) if layer.selected_values else None,
    )
    encoded = encode_sparse_artifact(artifact)

    out_path = local_output_dir / layer.sparse_pathname
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_bytes(encoded)

    src_bytes = local_tif.stat().st_size
    dst_bytes = out_path.stat().st_size
    return encoded, artifact.metadata.count, src_bytes


def _upload_one(layer: SparseLayerInput, local_path: Path, *, token: str) -> str:
    return upload_blob(local_path, layer.sparse_pathname, token=token)


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    started = time.time()

    print(f"[layer-sparse] manifest: {args.manifest_url}")
    try:
        manifest = fetch_manifest(args.manifest_url)
    except ManifestError as exc:
        print(f"[layer-sparse] ERROR: {exc}", file=sys.stderr)
        return 2

    inputs = filter_inputs(
        resolve_sparse_layer_inputs(manifest),
        only=args.only,
        skip=args.skip,
    )
    if not inputs:
        print("[layer-sparse] no layers selected; exiting", file=sys.stderr)
        return 1

    print(f"[layer-sparse] candidate layers: {len(inputs)}")

    upload_enabled = not args.no_upload and not args.dry_run
    token: str | None = None
    if upload_enabled:
        try:
            token = load_token_from_env_file(Path(".env.local"))
        except BlobError as exc:
            print(f"[layer-sparse] ERROR: {exc}", file=sys.stderr)
            return 2

    existing: set[str] = set()
    if not args.force and not args.dry_run:
        if upload_enabled:
            existing = _existing_sparse_paths(inputs, token=token)  # type: ignore[arg-type]
        else:
            # Even with --no-upload we still want to see what's already there
            # so the run report mirrors what would happen.
            try:
                discover_token = load_token_from_env_file(Path(".env.local"))
                existing = _existing_sparse_paths(inputs, token=discover_token)
            except BlobError:
                existing = set()
    elif args.dry_run:
        try:
            discover_token = load_token_from_env_file(Path(".env.local"))
            existing = _existing_sparse_paths(inputs, token=discover_token)
        except BlobError as exc:
            print(f"[layer-sparse] WARN dry-run could not list blobs: {exc}", file=sys.stderr)

    report = LayerBuildReport(started_at=started)

    for layer in inputs:
        already = layer.sparse_pathname in existing
        if already and not args.force:
            report.add(LayerBuildResult(layer=layer, status="skipped"))
            continue

        if args.dry_run:
            report.add(LayerBuildResult(layer=layer, status="built"))
            continue

        try:
            encoded, occupied, src_bytes = _build_one(
                layer,
                cache_dir=args.cache_dir,
                local_output_dir=args.local_output_dir,
            )
        except Exception as exc:
            report.add(LayerBuildResult(layer=layer, status="error", error=str(exc)))
            print(f"[layer-sparse]   ERROR build {layer.layer_id}: {exc}", file=sys.stderr)
            continue

        local_path = args.local_output_dir / layer.sparse_pathname
        dst_bytes = len(encoded)
        result = LayerBuildResult(
            layer=layer,
            status="built",
            occupied=occupied,
            src_bytes=src_bytes,
            dst_bytes=dst_bytes,
            local_path=local_path,
        )

        if upload_enabled and token:
            try:
                public_url = _upload_one(layer, local_path, token=token)
                result.status = "uploaded"
                result.public_url = public_url
                print(
                    f"[layer-sparse] uploaded {layer.layer_id:>22} "
                    f"{src_bytes:>11,} → {dst_bytes:>9,} B "
                    f"(ratio {dst_bytes / src_bytes:.3f}; cells {occupied:,}) "
                    f"→ {layer.sparse_pathname}"
                )
            except BlobError as exc:
                result.status = "error"
                result.error = f"upload failed: {exc}"
                print(
                    f"[layer-sparse]   ERROR upload {layer.layer_id}: {exc}",
                    file=sys.stderr,
                )
        else:
            print(
                f"[layer-sparse] built    {layer.layer_id:>22} "
                f"{src_bytes:>11,} → {dst_bytes:>9,} B "
                f"(ratio {dst_bytes / src_bytes:.3f}; cells {occupied:,}) "
                f"→ {local_path}"
            )

        report.add(result)

    if args.dry_run:
        _print_plan(report.items)

    mode = "dry-run" if args.dry_run else ("upload" if upload_enabled else "local-only")
    _print_summary(report, mode=mode)

    has_errors = any(item.status == "error" for item in report.items)
    return 0 if not has_errors else 1


if __name__ == "__main__":
    raise SystemExit(main())
