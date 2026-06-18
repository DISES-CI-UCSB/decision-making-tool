# data/metrics/

Durable home for the DISES metric calculation pipeline. All metric code,
fixtures, tests, generated outputs, and publishing reports live here.

## Folder structure

```
data/metrics/
  README.md               ← you are here
  python/
    requirements.txt      ← pip dependencies (rasterio, numpy, …)
    metrics_pipeline/     ← runnable pipeline (currently Tier 1)
      main.py             ← CLI entry point
      metric_definitions.py
      blob_manifest.py
      raster_metrics.py
      local_io.py
      calculators/        ← (T2) one module per metric domain
      artifacts/          ← (T2) artifact-reading helpers
      boundaries/         ← (T2) boundary-mask utilities
      validation/         ← (T2) output validation helpers
    tests/                ← pytest test suite
  js/
    README.md             ← browser parity/benchmark track
    src/
    tests/
    benchmarks/
  fixtures/               ← shared language-agnostic test fixtures (JSON)
  generated/              ← gitignored; local pipeline outputs
  cache/                  ← gitignored; downloaded raster cache
```

`generated/` and `cache/` are gitignored — they hold large local artifacts.
Everything else (source, fixtures, tests, READMEs) is tracked.

## Quick start (Python pipeline)

```bash
# From the repo root, create a venv next to the pipeline source:
python3 -m venv data/metrics/python/.venv
source data/metrics/python/.venv/bin/activate
pip install -r data/metrics/python/requirements.txt

# Smoke test — process one solution:
python data/metrics/python/metrics_pipeline/main.py \
    --output-dir data/metrics/generated/tier1 \
    --cache-dir  data/metrics/cache/tier1 \
    --limit 1

# Validate manifest + required layers without computing anything:
python data/metrics/python/metrics_pipeline/main.py --validate-only
```

Full CLI flags: see `main.py --help` or the table in `python/metrics_pipeline/` once a
fuller README is added there.

## Generated output layout

```
data/metrics/generated/tier1/
  publish-report.json
  blob-staged/
    solutions/nacional/<basename>.tier1-metrics.json

data/metrics/cache/tier1/
  <sha256-fingerprint>.tif      ← downloaded + cached rasters
```

Cached multi-geography outputs land in `generated/tier1/cache/*.metrics.json`.
After local inspection, publish to Vercel with:

```bash
python data/metrics/python/metrics_pipeline/inspect_metrics.py
python data/metrics/python/metrics_pipeline/publish.py
```

Requires `BLOB_READ_WRITE_TOKEN` in `.env.local` and the Vercel CLI on PATH.
Use `publish.py --dry-run` to preview uploads without writing to Blob.

For staged solution batches, keep production metric blobs untouched by passing a
staging prefix into the generated publish report:

```bash
python data/metrics/python/metrics_pipeline/main.py \
    --manifest-url https://aagibolq28slyfof.public.blob.vercel-storage.com/manifest/staging/nick-runs-2026-05-27.json \
    --output-dir data/metrics/generated/nick-runs-2026-05-27 \
    --cache-dir data/metrics/cache/tier1 \
    --cache-blob-directory metrics/nick-runs/2026-05-27/cache \
    --limit 1
```

Verbose multi-geography metric JSON is useful for local inspection but can be
large when it includes municipalities, RUNAPs, OMECs, and SIRAPs. Convert a
validated verbose batch into compact app-readable JSON before staging upload:

```bash
python data/metrics/python/metrics_pipeline/compact_metrics.py \
    --input-dir data/metrics/generated/nick-runs-2026-05-27 \
    --output-dir data/metrics/generated/nick-runs-2026-05-27-compact \
    --cache-blob-directory metrics/nick-runs/2026-05-27/compact-cache

python data/metrics/python/metrics_pipeline/inspect_metrics.py \
    --output-dir data/metrics/generated/nick-runs-2026-05-27-compact

python data/metrics/python/metrics_pipeline/publish.py \
    --output-dir data/metrics/generated/nick-runs-2026-05-27-compact \
    --dry-run
```

The compact format stores repeated metric IDs, units, labels, statuses, sources,
and notes in catalogs, then writes each boundary metric as a short row of
catalog indexes plus the metric value. The frontend expands this wire format
back into the normal cached metrics document before analysis panels read it.

## Large solution batches

The pipeline resumes by default: if `generated/tier1/cache/<solution_id>.metrics.json`
already exists and has the expected `solutionId`/`geographies` shape, that solution is
skipped and still included in the new `publish-report.json`. Pass `--force` to recompute
existing solution cache files. `--no-cache` only refreshes downloaded raster inputs.

Use zero-based chunk flags to split selected solutions across machines or terminals:

```bash
python data/metrics/python/metrics_pipeline/main.py \
    --chunk-count 3 \
    --chunk-index 0 \
    --output-dir data/metrics/generated/tier1-worker-0

python data/metrics/python/metrics_pipeline/main.py \
    --chunk-count 3 \
    --chunk-index 1 \
    --output-dir data/metrics/generated/tier1-worker-1

python data/metrics/python/metrics_pipeline/main.py \
    --chunk-count 3 \
    --chunk-index 2 \
    --output-dir data/metrics/generated/tier1-worker-2
```

Each worker should use a separate `--output-dir`. Workers may share `--cache-dir`; the
download cache uses per-process temporary files before replacing completed downloads.
For faster RUNAP/OMEC batches, keep national and other boundary species metrics while
skipping high-cardinality fan-out:

```bash
python data/metrics/python/metrics_pipeline/main.py \
    --skip-species-boundary-level runaps \
    --skip-species-boundary-level omecs
```

To publish chunked outputs, either run `publish.py --output-dir <worker-output-dir>` for
each worker directory, or merge worker artifacts into a fresh output directory before
running the normal inspect/publish workflow. A merge is just the union of `cache/` files
plus a `publish-report.json` whose `entries` array combines each worker report; use one
worker report as the metadata base and verify with `inspect_metrics.py --output-dir` before
publishing.

## Relationship to data/scripts/tier1-metrics/

`data/scripts/tier1-metrics/` is the predecessor location. Its files have been
copied here as part of T1. That directory will be removed once the migration
is confirmed working.

## Pipeline roadmap (task tracker)

See the [Notion implementation plan](https://www.notion.so/3671237a5ea380d6a26fd09d78a92364)
for the full task list (T1–T9).
