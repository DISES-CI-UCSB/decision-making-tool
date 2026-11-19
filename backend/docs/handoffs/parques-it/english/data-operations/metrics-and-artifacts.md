[← Back to Data Operations](./README.md)

# Metrics and runtime artifacts

## When to use this runbook

Use this runbook when a solution, shared calculation layer, metric definition, known boundary, solution summary, or runtime manifest changes. It covers the lifecycle from local generation through inspection, dry-run, publication, remote verification, manifest refresh, and FastAPI artifact restart.

Known AOIs read precomputed per-solution caches. User-drawn custom AOIs do not: FastAPI calculates them from read-only runtime rasters and species matrices loaded at startup. Treat these as two release surfaces that must remain scientifically consistent.

## Start here

- Confirm scope in the [Impact decision table](#impact-decision-table) before generating anything.
- One solution raster or metadata change: [3. Generate regular verbose metrics](#3-generate-regular-verbose-metrics) for that solution × all AOIs, then [5. Inspect, dry-run, publish, and verify regular metrics](#5-inspect-dry-run-publish-and-verify-regular-metrics) and [6. Build compact regular caches](#6-build-compact-regular-caches). Land solutions also need [7. Generate MEC geography shards](#7-generate-mec-geography-shards).
- Shared raster, calculator, metric definition, catalog-signature, or boundary change: omit `--solution-id` in step 3 (all solutions × all AOIs), then compact and any affected MEC/goals families.
- MEC-only source or taxonomy change: [7. Generate MEC geography shards](#7-generate-mec-geography-shards). Goals-only summary change: [8. Generate conservation-goal sidecars](#8-generate-conservation-goal-sidecars).
- Custom-AOI or FastAPI input change: [10. Build FastAPI runtime artifacts](#10-build-fastapi-runtime-artifacts) and [11. Rebuild, restart, and prove readiness](#11-rebuild-restart-and-prove-readiness).
- Label-only or map-only (`roleInMetricCalculation: none`): skip this runbook's generation steps.
- After artifact URLs exist: [9. Refresh and publish the runtime layer manifest](#9-refresh-and-publish-the-runtime-layer-manifest), then [12. Test known/custom parity and arbitrary polygons](#12-test-knowncustom-parity-and-arbitrary-polygons).
- Recover a bad artifact family: [Rollback](#rollback).

## Roles and prerequisites

- **Data/metrics owner:** approves calculation inputs, metric semantics, expected solution/AOI scope, and scientific spot checks.
- **Operator:** selects scope, generates artifacts, reviews reports, publishes only validated output, refreshes the manifest, and verifies runtime readiness.
- **Backend operator:** hydrates runtime artifacts (local Docker by default) and recreates the FastAPI container.
- **Developer/reviewer:** required for metric-definition changes, MEC/goal manual publishing, arbitrary-AOI category-mask decisions, and any failed contract.
- Run commands from the repository root unless a step says otherwise.
- Create and activate the Python environment for the metrics pipeline (not required for Docker hydrate):

```bash
python3 -m venv data/metrics/python/.venv
source data/metrics/python/.venv/bin/activate
pip install -r data/metrics/python/requirements.txt
```

- Confirm `BLOB_READ_WRITE_TOKEN` is present in `.env.local` before publishing. Never print or document its value. Docker Compose for local hydrate loads `.env` and `backend/.env`; it does not load `.env.local`.
- Record the exact manifest URL, prior publish reports, prior manifest archive, release ID/prefix, and current backend artifact version.
- Prefer immutable release paths. Overwriting a long-cache Blob path can leave clients on stale bytes.

## Impact decision table

Treat regular verbose, compact, MEC, goals, and custom-AOI runtime artifacts as separate release surfaces:

| Change                                                                                                          | Regular verbose metrics                                                                                                                                                                                           | Compact metrics                                                                                                     | MEC                                                                                                                                      | Goals                                                                  | Custom-AOI runtime                                                                        |
| --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| One solution raster changes                                                                                     | **That solution × all known AOIs**                                                                                                                                                                                | Rebuild from that solution's changed verbose report                                                                 | For a land solution, rebuild that solution × all six MEC geographies                                                                     | None unless its summary also changed                                   | None; the current builder does not package per-solution rasters                           |
| One solution metadata/Finder/summary changes                                                                    | **That solution × all known AOIs** only when emitted metrics or provenance change                                                                                                                                 | Rebuild if verbose changed                                                                                          | Rebuild that land solution when Finder target metadata changes its MEC benchmark                                                         | Rebuild that solution when its summary or goal inputs changed          | Rebuild only if the runtime source-manifest contract changed                              |
| Species source changes                                                                                          | **All land-domain solutions × all known AOIs**; marine outputs are unaffected by land species calculations                                                                                                        | Rebuild the affected land-solution compact outputs                                                                  | None                                                                                                                                     | Rebuild affected land-solution goals when their species lookup changes | Separately rebuild/redeploy only if the grouped runtime species matrices or index changed |
| Shared metric raster or calculator changes                                                                      | **All solutions in every applicable domain × all known AOIs**                                                                                                                                                     | Rebuild those solutions from regenerated verbose reports                                                            | None unless the MEC source/calculator also changed                                                                                       | None unless the goals calculator/input also changed                    | Rebuild/redeploy when FastAPI shares the changed raster or calculator                     |
| Metric definition, applicability, output schema, catalog, or catalog-signature generation configuration changes | **A full coherent regular release is safest across all solutions × all known AOIs.** These fields feed catalog signatures and provenance, so unchanged files can otherwise become stale against the new contract. | Rebuild the full compact release from the coherent verbose release                                                  | Rebuild only if the MEC contract changed                                                                                                 | Rebuild only if the goals contract changed                             | Rebuild/redeploy if FastAPI shares the changed contract                                   |
| Add/update one known boundary record                                                                            | **All solutions × all known AOIs**; regular generation has no single-AOI selector                                                                                                                                 | Rebuild all compact outputs from regenerated verbose reports                                                        | Rebuild all land solutions for the changed MEC geography; broader boundary-contract changes may require all six geographies              | None                                                                   | None for a boundary-only change                                                           |
| MEC source, taxonomy, or MEC-only calculator changes                                                            | None                                                                                                                                                                                                              | None                                                                                                                | Rebuild the applicable land solutions and MEC geographies; use MEC's solution/geography filters only for an intentionally scoped release | None                                                                   | None                                                                                      |
| Goal summary or goals-only calculator changes                                                                   | None unless the same metadata changes regular emitted output/provenance                                                                                                                                           | None unless regular verbose changed                                                                                 | None unless Finder target metadata also changed MEC                                                                                      | Rebuild the affected solution(s)                                       | None                                                                                      |
| Compact converter/format-only changes                                                                           | None                                                                                                                                                                                                              | Rebuild from the selected, already inspected verbose report; use the full verbose report for a full compact release | None                                                                                                                                     | None                                                                   | None                                                                                      |
| FastAPI-only source, matrix, index, or adapter changes                                                          | None unless known metrics share the changed source/calculator                                                                                                                                                     | None unless regular verbose changed                                                                                 | None                                                                                                                                     | None                                                                   | **Rebuild artifacts as applicable, recreate the service, and require `/ready`**           |
| Label-only or map-only change with `roleInMetricCalculation: none`                                              | None                                                                                                                                                                                                              | None                                                                                                                | None                                                                                                                                     | None                                                                   | None                                                                                      |
| Add a new known geography type                                                                                  | **Full coherent release after developer implementation**                                                                                                                                                          | Compact, MEC, manifest, and frontend contracts must explicitly support it                                           | Developer-defined                                                                                                                        | Developer-defined                                                      | Explicit design decision required                                                         |

Scope terms in this runbook are precise:

- **Solution selection** is the regular pipeline's only production content selector. Pass one or more repeatable `--solution-id` values; each resulting file still contains national plus every loaded department, municipality, SIRAP, RUNAP, and OMEC.
- **All AOIs** means regenerate the complete geography catalog inside each affected solution. The regular pipeline has no single-AOI selector.
- **All solutions** means omit `--solution-id`; this is mandatory for shared inputs, calculation contracts, and boundary changes.
- The regular pipeline has no metric, geography-level, or individual-AOI selector. `--limit`, chunking, `--national-only`, and species-skip flags are smoke-test, partitioning, or diagnostic controls; they do not create a complete narrowed production artifact by metric or AOI.
- MEC is separate and supports repeatable `--solution-id` and `--geography-level` filters. Goals support repeatable `--solution-id`. Compact conversion has no independent solution/geography calculator selector: it converts the entries in the selected verbose `publish-report.json`.

## Supported steps and commands

### 1. Choose a clean output and cache strategy

Use a new output directory for a release or retain the previous directory intact for rollback. The generator resumes from valid existing solution files unless `--force` is used.

Cache flags are not interchangeable:

| Flag                                               | Use it when                                                                         | What it does not do                                               |
| -------------------------------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `--force`                                          | Output must be recomputed after changed inputs or calculation logic                 | Does not force source downloads                                   |
| `--no-cache`                                       | A remote raster, species CSV, or boundary was replaced and local bytes may be stale | Does not by itself force an existing output file to be recomputed |
| Both                                               | Published source bytes and derived outputs changed                                  | —                                                                 |
| Neither                                            | Resuming an interrupted run with unchanged inputs and contracts                     | Existing valid output may be reused                               |
| `--national-only`                                  | Deliberate national-only diagnostic                                                 | Not acceptable for an AOI production release                      |
| `--skip-species` / `--skip-species-boundary-level` | Deliberate diagnostic or documented partial product                                 | Skipped species values are not a complete production release      |

Always pass the intended `--manifest-url` for staging or production. Do not let an implicit default select the release input accidentally.

### 2. Validate contracts before computation

```bash
python data/metrics/python/metrics_pipeline/main.py \
  --manifest-url <approved-manifest-url> \
  --validate-only
```

This fetches and validates the manifest, checks the catalog/required layers, and then exits **before solution selection, output setup, and boundary loading**. Missing required-layer URLs are reported as warnings, so review the output. `--validate-only` is not proof that any boundary source is available.

Boundary proof requires an actual non-`--national-only` generation. Run at least the one-solution smoke command below, confirm stdout lists every expected boundary level without boundary warnings, and review its `publish-report.json`: `boundaryErrors` must be empty and `geographyLevels` must contain `national`, `departments`, `municipalities`, `siraps`, `runaps`, and `omecs`. A normal generation can continue with only the levels that loaded, so treat any missing level as a failed production smoke even if the process exits successfully. A generation using `--release-id` additionally fails closed when any pinned boundary source is unavailable.

### 3. Generate regular verbose metrics

**One changed solution, all of its AOIs**

```bash
python data/metrics/python/metrics_pipeline/main.py \
  --manifest-url <approved-manifest-url> \
  --solution-id <solution-id> \
  --output-dir data/metrics/generated/tier1-one-solution \
  --cache-dir data/metrics/cache/tier1 \
  --force
```

Add `--no-cache` if that solution’s remote raster bytes were replaced.

**All solutions and all AOIs**

```bash
python data/metrics/python/metrics_pipeline/main.py \
  --manifest-url <approved-manifest-url> \
  --output-dir data/metrics/generated/tier1 \
  --cache-dir data/metrics/cache/tier1 \
  --force
```

For an immutable complete release, add `--release-id <release-id>`. Use the catalog-declared counts rather than a hardcoded 108. GTIC production `catalog-releases/3.0.5` is 172 national + 56 SIRAP (228 combined). This branch may use `catalog-releases/3.0.6` as a local land-use-aoi-TEST index with the same counts; do not call 3.0.6 GTIC production. Pin every required boundary source.

### 4. Run a chunked batch

Use chunking only to partition solutions. Each worker receives all AOIs for its assigned solutions.

```bash
python data/metrics/python/metrics_pipeline/main.py \
  --manifest-url <approved-manifest-url> \
  --chunk-count 3 \
  --chunk-index 0 \
  --output-dir data/metrics/generated/tier1-worker-0 \
  --cache-dir data/metrics/cache/tier1 \
  --force
```

Repeat with zero-based indexes `1` and `2`, using a different output directory for each worker. Workers may share the download cache but must not share an output directory.

Before publication, either publish every complete worker report or merge worker outputs with `merge_release_workers.py` (see [data/metrics/README.md](../../../../../data/metrics/README.md)). Do not claim a complete release until the union is checked for missing/duplicate solution IDs and inspected as one release set.

### 5. Inspect, dry-run, publish, and verify regular metrics

```bash
python data/metrics/python/metrics_pipeline/inspect_metrics.py \
  --output-dir data/metrics/generated/tier1
```

For a one-solution output, optionally repeat `--solution-id` to constrain inspection.

```bash
python data/metrics/python/metrics_pipeline/publish.py \
  --output-dir data/metrics/generated/tier1 \
  --dry-run
```

Publication automatically inspects unless `--skip-inspect` is passed. Do not use `--skip-inspect` in normal operations.

```bash
python data/metrics/python/metrics_pipeline/publish.py \
  --output-dir data/metrics/generated/tier1
```

Verify local bytes against the public URL, SHA-256, content type, and one-year cache header:

```bash
python data/metrics/python/metrics_pipeline/verify_artifacts.py \
  data/metrics/generated/tier1/publish-report.json
```

The publisher overwrites target paths with `--force`; it does not automatically archive previous metrics. Retain the prior local generation/report or use an immutable release prefix before publishing.

### 6. Build compact regular caches

Compact artifacts are derived from inspected verbose outputs; they are not a separate calculation.

```bash
python data/metrics/python/metrics_pipeline/compact_metrics.py \
  --input-dir data/metrics/generated/tier1 \
  --output-dir data/metrics/generated/tier1-compact \
  --release-id <release-id>
```

For a release ID, final conversion requires the catalog-declared verbose inputs (172 national for GTIC production `catalog-releases/3.0.5`; 228 combined with 56 SIRAP; this-branch `catalog-releases/3.0.6` test uses the same counts). Explicit partial releases require both `--release-selection <selection.json>` and `--partial-release`; the selection contract must declare the complete catalog and exact subset.

Inspect, dry-run, publish, and verify the compact output using the same tools:

```bash
python data/metrics/python/metrics_pipeline/inspect_metrics.py \
  --output-dir data/metrics/generated/tier1-compact

python data/metrics/python/metrics_pipeline/publish.py \
  --output-dir data/metrics/generated/tier1-compact \
  --dry-run

python data/metrics/python/metrics_pipeline/publish.py \
  --output-dir data/metrics/generated/tier1-compact

python data/metrics/python/metrics_pipeline/verify_artifacts.py \
  data/metrics/generated/tier1-compact/publish-report.json
```

### 7. Generate MEC geography shards

MEC output is separate, resumable per solution/geography, and supports exactly:
`national`, `departments`, `municipalities`, `siraps`, `runaps`, and `omecs`.

Validate the default five-view composite source:

```bash
python data/metrics/python/metrics_pipeline/mec_compact.py \
  --manifest-url <approved-manifest-url> \
  --validate-only
```

Generate one solution/geography for a smoke test:

```bash
python data/metrics/python/metrics_pipeline/mec_compact.py \
  --manifest-url <approved-manifest-url> \
  --solution-id <solution-id> \
  --geography-level departments
```

Omit both filters for all land solutions and all six levels. Use `--force` to regenerate valid existing shards and `--no-cache` to refresh downloaded source bytes.

For an immutable MEC v2 release, use `--release-id <release-id>`. A full release requires the catalog-declared land count (`expectedLandSolutionCount`, currently 168 in GTIC production catalog 3.0.5: 172 national = 168 land + 4 marine; this-branch 3.0.6 test uses the same counts) and all six geography levels. Marine has no MEC. Partial release generation must use a fail-closed `--release-partition` descriptor; final partition reports can be reconciled with repeated `--reconcile-partition-report`.

**Manual/incomplete publication:** `mec_compact.py` never uploads. The repository has no dedicated MEC publisher/wiring command. A developer-reviewed process must upload exactly the report’s `expectedBlobPath` values, verify remote bytes, and confirm that the manifest’s `mecV2ByGeography` URLs cover all six levels. Do not feed MEC reports to the regular publisher unless that compatibility is separately tested and approved.

### 8. Generate conservation-goal sidecars

Goals are solution-level artifacts derived from Prioritizr summary CSVs.

```bash
python data/metrics/python/metrics_pipeline/conservation_goals.py \
  --manifest-url <approved-manifest-url> \
  --output-dir data/metrics/generated/goals
```

For one changed solution, add `--solution-id <solution-id>`. Use `--force-download` if summary/species CSV bytes changed.

Review `goals-publish-report.json` for failures, row counts, source URLs, and expected paths.

**Manual/incomplete publication:** no dedicated goals publisher or verifier is wired. Upload and manifest wiring require developer review. Do not describe generation alone as a published goals release.

### 9. Refresh and publish the runtime layer manifest

After regular compact, MEC, or goals URLs are available:

```bash
yarn --cwd frontend generate:layer-manifest
yarn --cwd frontend validate:layer-manifest
yarn --cwd frontend test:layer-manifest
yarn --cwd frontend publish:layer-manifest
```

Review solution reconciliation before publishing. Confirm each affected solution points to the intended immutable or approved paths through `precomputedMetricUrls`, including `compactCache`, goals, and all six MEC geography URLs where applicable.

### 10. Build FastAPI runtime artifacts

After any manifest or source-raster change that affects live custom-AOI calculations, fill the mounted artifact volume from a machine that can reach public Vercel Blob.

**Local Docker default — no flags.** From the repository root:

```bash
docker compose run --rm --build backend hydrate
```

That command reads the live catalog at `https://aagibolq28slyfof.public.blob.vercel-storage.com/manifest/manifest.json` (override with `MANIFEST_BLOB_URL` or `DMT_MANIFEST_URL` in `.env` / `backend/.env`). The catalog’s `hydrationPackage` is the recipe: EPSG:9377 land-solution grid, 1353×1838. Hydrate does **not** use `catalog-releases/3.0.6`.

Hydrate is incremental and skips files already in the `backend-artifacts` volume. If that volume previously held EPSG:4326 / `ecosistemas` artifacts, wipe the volume or pass `--force` so the 9377 recipe is rebuilt:

```bash
docker compose run --rm --build backend hydrate --force
```

The package names the national 9377 species bitset kit `national-land-solution`. That kit is not yet on the published bitset index, so hydrate CPU-rebuilds it. Do not use kit id `national` for 9377; that Blob file is the legacy EPSG:4326 kit.

Optional flags (append after `hydrate`; none are required for the latest 9377 recipe):

| Flag | When to use it |
| --- | --- |
| `--aligned-cache <metrics-pipeline-cache>` | Optional. Reuse a metrics-pipeline aligned TIFF cache. Without it, layers are warped onto the 9377 pin during hydrate. |
| `--reference-grid ecosistemas` | Opt-in legacy EPSG:4326 ecosystem grid. Not the local default. |
| `--manifest-url <url>` | Override the live catalog. |
| `--force` | Re-download and rebuild existing files (also required after a 4326 volume). |

A host venv is not required. The equivalent host command is also flagless:

```bash
backend/.venv/bin/python backend/scripts/build_runtime_artifact.py
```

**Optional production profile (`--production-v3`).** This is a separate fail-closed Mesa / immutable production build, not the local Docker default:

```bash
docker compose run --rm --build backend hydrate --production-v3
```

`--production-v3` selects the EPSG:9377 land-solution grid, pins the `solutions-v3-0-0` coverage-parity contract, reads each land solution’s exact ecosystem and species rows from its immutable goals document, and writes an immutable release. Every land solution must contain all 417 ecosystems; species goal-row counts remain solution-specific, while the runtime species index and golden-master solution must contain the approved 7,980-species universe. `--aligned-cache` remains optional on this profile. Optional `--artifact-dir` changes the output location.

Before activating a `--production-v3` release, verify it:

```bash
backend/.venv/bin/python backend/scripts/verify_runtime_release.py \
  <runtime-artifact-release-directory> \
  --require-mesa-v3
```

The verifier rejects missing Mesa metadata, a stale release or contract checksum, a mismatched grid fingerprint, incomplete source bindings, any solution without all 417 ecosystems, or a runtime/golden-master species universe other than 7,980.

### 11. Rebuild, restart, and prove readiness

**Local Docker** uses the root Compose file. Artifacts are required; the V3 Mesa bundle is not:

```bash
docker compose up -d --build --force-recreate

docker compose logs --tail=100 backend

curl http://127.0.0.1:8000/health
curl http://127.0.0.1:8000/ready
```

**Production VM** uses `backend/docker-compose.yml`, which defaults to requiring artifacts, the V3 Mesa bundle, release ID `solutions-v3-0-0`, and the pinned parity-contract checksum:

```bash
DMT_ARTIFACT_MANIFEST=<runtime-artifact-release-directory>/manifest.json \
  docker compose -f backend/docker-compose.yml up -d --build --force-recreate

docker compose -f backend/docker-compose.yml logs --tail=100 backend

curl http://127.0.0.1:8000/health
curl http://127.0.0.1:8000/ready
```

`/health` proves only that the process is alive. `/ready` proves those read-only artifacts loaded and validated. Do not return the service to traffic when readiness fails.

### 12. Test known/custom parity and arbitrary polygons

1. Refresh the browser so in-session manifest, species, and MEC caches are discarded.
2. Test one known AOI from every affected geography against its precomputed metrics.
3. Draw a custom polygon matching a known boundary and compare results within documented rasterization/selection rules.
4. Test small, multipart, edge-of-grid, and no-overlap arbitrary polygons.
5. Monitor backend logs for category-mask, species-matrix, grid, and artifact errors.

`build_custom_aoi_raster()` rebuilds all category masks consistently for the drawn polygon: the selected cells become the new-Prioritizr mask and the pre-existing mask is empty. The grid-path regression tests cover arbitrary WGS84 and pre-projected polygons; continue the production checks above for rasterization parity and edge cases.

## Downstream effects

- Regular verbose output is the source for compact conversion; publishing only one format can leave the app on mismatched generations.
- A boundary change changes every solution document because names, IDs, and metrics are embedded by geography.
- MEC artifacts are separately partitioned and lazy-loaded; regular cache success does not prove MEC completeness.
- Goal sidecars depend on solution summary CSVs and are not AOI metrics.
- The manifest is the routing layer for frontend artifact URLs. Publishing bytes without refreshing/wiring the manifest can leave artifacts unreachable.
- FastAPI artifacts are loaded at process startup and mounted read-only. Rebuilding files without recreating the container leaves the old set in memory.
- Browser loaders may retain manifest/species/MEC data for the session; refresh during verification.

## Verification checklist

- [ ] Scope decision records the selected solution set; every selected solution includes all known AOIs.
- [ ] Approved manifest URL and immutable release/prefix are recorded.
- [ ] `--validate-only` completes; required-layer warnings were reviewed, and it was not used as boundary proof.
- [ ] A non-national actual-generation smoke lists every boundary level; its report has empty `boundaryErrors` and all six expected `geographyLevels`.
- [ ] `--force` and `--no-cache` were used according to output and download staleness.
- [ ] Generation report has the expected solution count, geography levels, catalog signature, and zero failures.
- [ ] Chunk unions have no missing or duplicate solution IDs.
- [ ] `inspect_metrics.py` succeeds before every regular/compact publish.
- [ ] Dry-run paths and counts match the intended environment.
- [ ] Remote regular/compact artifacts match local byte counts and SHA-256 values and have expected content/cache headers.
- [ ] MEC report has the expected solution × selected-geography artifact count and zero failures; a full release includes all six geographies.
- [ ] Manual MEC and goals uploads were independently verified and their manifest URLs resolve.
- [ ] Manifest validation/tests and solution reconciliation pass.
- [ ] One changed and one unchanged solution load regular, compact, MEC, and goals data as applicable.
- [ ] Runtime artifact manifest checksums and metric coverage were reviewed.
- [ ] FastAPI logs show successful artifact loading; `/health` and `/ready` both pass.
- [ ] Known-AOI and equivalent custom-polygon values are scientifically consistent.
- [ ] Custom-AOI category masks match the polygon selection, and the arbitrary-polygon grid-path regression tests pass.
- [ ] Prior publish reports, manifest archive, metrics outputs, and runtime artifacts remain available.

## Rollback

1. Stop publication or remove the release from traffic when any artifact family disagrees.
2. Restore the prior runtime manifest:

```bash
yarn --cwd frontend rollback:layer-manifest
```

3. Republish the retained prior regular/compact generation directories and reports, or restore the prior immutable release references. There is no automatic metrics archive.
4. Restore prior MEC and goal objects and URLs through the same reviewed manual process used to publish them.
5. Rebuild the previous known-good FastAPI artifact set and recreate the container. Local Docker:

```bash
docker compose run --rm --build backend hydrate --force
docker compose up -d --build --force-recreate
```

Pass `--manifest-url` when restoring a recorded prior catalog. If the volume still holds a different grid (for example EPSG:4326), wipe `backend-artifacts` or keep `--force`. Production VM:

```bash
DMT_ARTIFACT_REQUIRED=true \
  docker compose -f backend/docker-compose.yml up -d --build --force-recreate
```

6. Verify remote checksums, browser loading, known/custom parity, logs, and `/ready` before restoring traffic.

## Limitations and escalation

- There is no regular-pipeline selector for one AOI; use one complete solution or all solutions.
- Chunk output merging uses `merge_release_workers.py`; inspect the union before claiming a complete release.
- MEC upload/manifest wiring and conservation-goal publication are manual/incomplete.
- Metrics overwrites have no automatic archive; immutable releases or retained local reports are required for reliable rollback.
- Python dependencies use minimum-version ranges rather than a reproducible lock.
- Custom-AOI species support must be verified on the target VM; do not infer support from known-AOI species caches.
- Manifest live-metric URLs and sparse-builder output naming conventions may not match. Verify the actual production artifact format before relying on `compressedDataForLiveMetricsUrl`.
- No tested Blob disaster-recovery workflow is documented. Escalate storage loss rather than improvising destructive restoration.
