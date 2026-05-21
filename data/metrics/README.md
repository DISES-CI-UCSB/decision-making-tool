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

The staged sidecar path mirrors the Vercel Blob layout. A separate publish
step (T7) uploads sidecars using `vercel blob put` with `BLOB_READ_WRITE_TOKEN`.

## Relationship to data/scripts/tier1-metrics/

`data/scripts/tier1-metrics/` is the predecessor location. Its files have been
copied here as part of T1. That directory will be removed once the migration
is confirmed working.

## Pipeline roadmap (task tracker)

See the [Notion implementation plan](https://www.notion.so/3671237a5ea380d6a26fd09d78a92364)
for the full task list (T1–T9).
