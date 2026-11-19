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
  aligned/<key-prefix>/<key>.tif
                               ← content-addressed rasters on the solution grid
  aligned/<key-prefix>/<key>.json
                               ← source/grid/policy/tool provenance and QA
  species-overlap/<key-prefix>/<key>.npz
                               ← sparse exact species overlap areas
  species-overlap/<key-prefix>/<key>.json
                               ← source/grid/algorithm/tool provenance and QA
```

Cached multi-geography outputs land in `generated/tier1/cache/*.metrics.json`.
The raw download cache and derived alignment cache are deliberately separate.
Alignment keys bind the source SHA-256, source and target grid fingerprints,
policy/geometry precision, and Rasterio/GDAL/PROJ/GEOS/Shapely/exactextract
versions. Binary and categorical non-species inputs use nearest-neighbor
resampling, and biomass/carbon density layers use nodata-aware area averaging.
Species ranges use exact projected source-cell union intersection with the
EPSG:9377 target grid. Full target cells are run-length encoded; only fractional
boundary cells store float64 areas. Binary value enforcement applies only to binary policies. Categorical
policies require finite integer classes and preserve the source taxonomy;
continuous policies reject non-finite data outside their declared nodata.
Every metric layer must be explicitly classified; unknown policies,
failed species reads, corrupt aligned artifacts, or incomplete required metrics
stop preflight or solution writing rather than producing ready zero values.
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

The pipeline resumes with `--cache-policy use-cache` (the default). A calculated
output is reused only when its solution basename and raster SHA-256 match and its
metric catalog, generation configuration, release, and pinned boundary provenance
remain valid. Alignment grid/policy/cache-inventory signatures and complete
species expected/aligned/processed counts must also match; blocked or incomplete
required layer/species metrics are never resumed. Use `--cache-policy recompute-all` to ignore calculated outputs and
safely rebuild the selected release; `--no-cache` only refreshes downloads.

The active contracts are metrics schema/catalog v3, alignment manifest/inventory
v3, solution input signature v3, species exact-overlap v1, and MEC generation
signature v3. Species inputs must declare nodata 255 and contain only 0/1 data
values. Source area must match authoritative metadata within max(1 km², 1%).
Overlap fractions must be finite and within [0,1], areas must be positive and no
larger than a physical target cell, and total intersection area must match
projected source geometry within max(0.2 m², 2e-9 relative), plus geometry
precision × target-cell width (0.01 m² on the release grid). Positive-area
presence uses a 1e-10 m² epsilon tied to 0.01 mm geometry precision. Source cells
outside the target extent are counted; any unexplained loss is fatal. Nearest
species artifacts are never adopted by the v3 policy.
The `solutions-v0-1-0-20260804` and `solutions-v0-2-0-20260805` releases are
bound to release-specific contracts under `data/metrics/release-specs/`. They
exclude exactly two approved `upstream_source_missing` rasters and report
species-derived finite values as `partial`. No wildcard skip is allowed. After
the authoritative files are received, they and their source checksums must be
introduced in the first subsequent patch release (expected `0.2.1`). Only
affected species-derived metrics and signatures may be invalidated when
provenance isolation makes that safe; otherwise all species-derived metrics and
signatures are invalidated fail-closed. Any other unavailable or invalid species
input remains fatal. Stale interrupted exact-overlap temporary
files are removed after one hour only when the corresponding per-key write lock
can be acquired without waiting; complete cache pairs and active writes are not
touched.
`METRICS_ALIGNMENT_PREFLIGHT_WORKERS` controls parallel validation (default 8).
`METRICS_ALIGNED_CACHE_MAX_GB` bounds aligned files (default 50 GB),
`METRICS_LAYER_LRU_MAX_ITEMS` bounds each in-memory layer cache (default 4), and
download/alignment lock timeouts default to 120 seconds.

Immutable releases use a sorted `solution-catalog-v1` JSON contract. It declares an
independent semantic `catalogVersion` (including `0.x.y`), `releaseId`,
`expectedSolutionCount`, `expectedLandSolutionCount`,
`expectedMarineSolutionCount`, and each solution's `solutionId`,
`solutionBasename`, `domain`, and required `rasterSha256`. Raster locations stay
in the manifest; release runs verify their bytes against the catalog. Commands
derive fail-closed counts from this contract rather than fixed 108/104 constants.
`solutionBasename` is always the complete raster filename with the exact lowercase
`.tif` extension. `solutionId` must match `^[a-z0-9]+(?:[_-][a-z0-9]+)*$`;
slashes and spaces are rejected rather than sanitized.

The canonical contract is flat—do not replace the three count fields with an
`expectedCounts` object, and do not omit `rasterSha256`:

```json
{
  "format": "solution-catalog-v1",
  "catalogVersion": "0.1.0",
  "releaseId": "release-id",
  "expectedSolutionCount": 1,
  "expectedLandSolutionCount": 1,
  "expectedMarineSolutionCount": 0,
  "solutions": [
    {
      "solutionId": "solution-id",
      "solutionBasename": "raster-basename.tif",
      "domain": "land",
      "rasterSha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    }
  ]
}
```

`data/metrics/fixtures/solution-catalog-v1.json` is the shared cross-runtime
fixture for Python and frontend validators.

Preflight a new release and compare it with an optional baseline without running
metrics:

```bash
python data/metrics/python/metrics_pipeline/plan_solution_release.py \
    --catalog path/to/new-solution-catalog.json \
    --baseline-catalog path/to/previous-solution-catalog.json \
    --output data/metrics/generated/releases/new-release/release-plan.json
```

The deterministic plan compares required raster identity and canonical
`solution-input-signature-v3` inventories. Generate an inventory with
`main.py --write-input-signatures-only`, then pass current and baseline inventories
to `plan_solution_release.py`. Reuse requires exact basename, domain, raster SHA,
and input-signature equality; missing signatures fail closed to `recompute`.

Checksum-pinned solution source plans are uploaded separately. The source
uploader defaults to a read-only dry run, verifies every local file before any
write, resumes from remote byte identity, and refuses to overwrite differing
immutable bytes:

```bash
python data/metrics/python/metrics_pipeline/upload_solution_sources.py \
    data/metrics/generated/releases/<releaseId>/source-upload/upload-plan.json

python data/metrics/python/metrics_pipeline/upload_solution_sources.py \
    data/metrics/generated/releases/<releaseId>/source-upload/upload-plan.json \
    --execute
```

Progress is atomically journaled beside the plan as
`upload-dry-run-report.json` or `upload-report.json`. Upload mode requires
`BLOB_READ_WRITE_TOKEN`; the token is never included in reports or console
output. Release plans accept only
`releases/<releaseId>/solutions/{land|marine}/...` destinations, never mutable
legacy `solutions/nacional/` paths.

Passing the plan to `main.py`, `mec_compact.py`, or `conservation_goals.py` runs
only IDs marked `recompute` and asserts the planned count. Reused artifacts are
assembled separately; plan execution does not silently copy them. The plan's
`cachePolicy` is authoritative: `recompute-all` disables resume in regular,
compact, goals, and MEC generation regardless of CLI defaults. Output defaults
under `data/metrics/generated/releases/<releaseId>/` and is bound to the catalog
checksum, preventing a directory from being rebound to another release.
Release goals are written to `releases/<releaseId>/goals/<solutionId>.goals.json`,
matching the frontend `precomputedMetricUrls.goals` contract.

After recomputed artifacts exist, assemble catalog-declared reuse from a
checksum-pinned baseline inventory:

```bash
python data/metrics/python/metrics_pipeline/assemble_solution_release.py \
    --catalog path/to/solution-catalog.json \
    --release-plan path/to/release-plan.json \
    --baseline-inventory path/to/baseline/release-artifact-inventory.json \
    --baseline-root path/to/baseline/release
```

Assembly verifies every baseline source checksum, rebinds release/catalog
provenance without recalculating metrics, rejects differing destination bytes,
and emits `release-artifact-inventory.json`, `release-publish-summary.json`, and
a complete `publish-report.json`. Publishing never uses `--force`: an existing
remote path is accepted only when its bytes have the same SHA-256.

Calculation never publishes or promotes a release. Inspect first, then invoke
`publish.py` as a separate explicit action.

The one-solution scientific smoke includes species and all geography levels. It
uses a dedicated output directory and intentionally omits `--release-plan`
because a complete release plan cannot be narrowed to one ID:

```bash
python data/metrics/python/metrics_pipeline/main.py \
    --manifest-url "file://$PWD/$RELEASE_ROOT/preflight/manifest.json" \
    --release-id "$RELEASE_ID" \
    --solution-catalog "$RELEASE_ROOT/solution-catalog.json" \
    --species-exception-contract \
      "data/metrics/release-specs/$RELEASE_ID/species-exception.json" \
    --solution-id eco17_estr17_esprep17_runap_omec_iheh2030 \
    --cache-dir "data/metrics/cache/releases/$RELEASE_ID" \
    --output-dir "$RELEASE_ROOT/smoke/scientific/regular/verbose"
```

For a cheap structural-only check, use a different output directory and add
both `--skip-species` and `--national-only`. Such output is incomplete by design
and must never be assembled or published as release science.

Use zero-based chunk flags to split selected solutions across machines or terminals:

```bash
RELEASE_ID=solutions-v0-2-0-20260805
RELEASE_ROOT="data/metrics/generated/releases/$RELEASE_ID"
SHARED_CACHE="data/metrics/cache/releases/$RELEASE_ID"

python data/metrics/python/metrics_pipeline/main.py \
    --manifest-url "file://$PWD/$RELEASE_ROOT/preflight/manifest.json" \
    --release-id "$RELEASE_ID" \
    --solution-catalog "$RELEASE_ROOT/solution-catalog.json" \
    --release-plan "$RELEASE_ROOT/release-plan.json" \
    --species-exception-contract \
      "data/metrics/release-specs/$RELEASE_ID/species-exception.json" \
    --cache-dir "$SHARED_CACHE" \
    --chunk-count 3 \
    --chunk-index 0 \
    --output-dir "$RELEASE_ROOT/workers/regular-0"

python data/metrics/python/metrics_pipeline/main.py \
    --manifest-url "file://$PWD/$RELEASE_ROOT/preflight/manifest.json" \
    --release-id "$RELEASE_ID" \
    --solution-catalog "$RELEASE_ROOT/solution-catalog.json" \
    --release-plan "$RELEASE_ROOT/release-plan.json" \
    --species-exception-contract \
      "data/metrics/release-specs/$RELEASE_ID/species-exception.json" \
    --cache-dir "$SHARED_CACHE" \
    --chunk-count 3 \
    --chunk-index 1 \
    --output-dir "$RELEASE_ROOT/workers/regular-1"

python data/metrics/python/metrics_pipeline/main.py \
    --manifest-url "file://$PWD/$RELEASE_ROOT/preflight/manifest.json" \
    --release-id "$RELEASE_ID" \
    --solution-catalog "$RELEASE_ROOT/solution-catalog.json" \
    --release-plan "$RELEASE_ROOT/release-plan.json" \
    --species-exception-contract \
      "data/metrics/release-specs/$RELEASE_ID/species-exception.json" \
    --cache-dir "$SHARED_CACHE" \
    --chunk-count 3 \
    --chunk-index 2 \
    --output-dir "$RELEASE_ROOT/workers/regular-2"

python data/metrics/python/metrics_pipeline/merge_release_workers.py \
    --catalog "$RELEASE_ROOT/solution-catalog.json" \
    --release-plan "$RELEASE_ROOT/release-plan.json" \
    --worker-output "$RELEASE_ROOT/workers/regular-0" \
    --worker-output "$RELEASE_ROOT/workers/regular-1" \
    --worker-output "$RELEASE_ROOT/workers/regular-2" \
    --output-dir "$RELEASE_ROOT/regular/verbose"
```

Each worker should use a separate `--output-dir`. Workers may share `--cache-dir`;
downloads and aligned TIF/manifest pairs use per-key locks, under-lock rechecks,
fsync, and atomic renames. Incomplete pairs are never accepted, and eviction
removes only complete unlocked pairs not pinned by the current run.
The merge command requires every declared chunk exactly once, rejects overlap,
missing solutions, generation-contract drift, catalog/provenance mismatches, and
differing destination bytes before emitting the canonical combined publish
report.
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
