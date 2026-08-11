[← Back to Data Operations](./README.md)

# Metrics and runtime artifacts

## When to use this runbook

Use this runbook when a solution, shared calculation layer, metric definition, known boundary, solution summary, or runtime manifest changes. It covers the lifecycle from local generation through inspection, dry-run, publication, remote verification, manifest refresh, and FastAPI artifact restart.

Known AOIs read precomputed per-solution caches. User-drawn custom AOIs do not: FastAPI calculates them from read-only runtime rasters and species matrices loaded at startup. Treat these as two release surfaces that must remain scientifically consistent.

## Roles and prerequisites

- **Data/metrics owner:** approves calculation inputs, metric semantics, expected solution/AOI scope, and scientific spot checks.
- **Operator:** selects scope, generates artifacts, reviews reports, publishes only validated output, refreshes the manifest, and verifies runtime readiness.
- **Backend operator:** builds runtime artifacts on the metrics host and recreates the FastAPI container.
- **Developer/reviewer:** required for metric-definition changes, MEC/goal manual publishing, arbitrary-AOI category-mask decisions, and any failed contract.
- Run commands from the repository root unless a step says otherwise.
- Create and activate the Python environment:

```bash
python3 -m venv data/metrics/python/.venv
source data/metrics/python/.venv/bin/activate
pip install -r data/metrics/python/requirements.txt
```

- Confirm `BLOB_READ_WRITE_TOKEN` is present in `.env.local` before publishing. Never print or document its value.
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

For an immutable complete release, add `--release-id <release-id>`. The release contract currently requires exactly 108 selected solutions and every pinned boundary source.

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

Before publication, either publish every complete worker report or merge their cache entries and report into one reviewed output. **Manual/incomplete:** no dedicated merge command exists. Do not claim a complete release until the union is checked for missing/duplicate solution IDs and inspected as one release set.

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

For a release ID, final conversion requires 108 verbose inputs. Explicit partial releases require both `--release-selection <selection.json>` and `--partial-release`; the selection contract must declare the complete catalog and exact subset.

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

For an immutable MEC v2 release, use `--release-id <release-id>`. A full release requires 104 land solutions and all six geography levels. Partial release generation must use a fail-closed `--release-partition` descriptor; final partition reports can be reconciled with repeated `--reconcile-partition-report`.

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
npm --prefix frontend run generate:layer-manifest
npm --prefix frontend run validate:layer-manifest
npm --prefix frontend run test:layer-manifest
npm --prefix frontend run publish:layer-manifest
```

Review solution reconciliation before publishing. Confirm each affected solution points to the intended immutable or approved paths through `precomputedMetricUrls`, including `compactCache`, goals, and all six MEC geography URLs where applicable.

### 10. Build FastAPI runtime artifacts

Run on the metrics host after any manifest or source-raster change that affects live custom-AOI calculations:

```bash
backend/.venv/bin/python backend/scripts/build_runtime_artifact.py \
  --manifest-url <approved-manifest-url>
```

Use `--force` when source bytes changed at an existing URL. Optional `--artifact-dir` changes the output location. `--solution-id` selects only the sample solution recorded for provenance; the current builder’s calculation rasters are manifest/shared sources, not a per-solution runtime set.

The builder writes a gitignored `backend/runtime-artifacts/manifest.json`, a reference raster, metric rasters, and species matrices. Review file checksums, sizes, metric coverage, source manifest URL, and missing-layer warnings before restart.

### 11. Rebuild, restart, and prove readiness

```bash
DMT_ARTIFACT_REQUIRED=true \
  docker compose -f backend/docker-compose.yml up -d --build --force-recreate

docker compose -f backend/docker-compose.yml logs --tail=100 backend

curl http://127.0.0.1:8000/health
curl http://127.0.0.1:8000/ready
```

`/health` proves only that the process is alive. `/ready` proves required read-only artifacts loaded and validated. Do not return the service to traffic when readiness fails.

### 12. Test known/custom parity and arbitrary polygons

1. Refresh the browser so in-session manifest, species, and MEC caches are discarded.
2. Test one known AOI from every affected geography against its precomputed metrics.
3. Draw a custom polygon matching a known boundary and compare results within documented rasterization/selection rules.
4. Test small, multipart, edge-of-grid, and no-overlap arbitrary polygons.
5. Monitor backend logs for category-mask, species-matrix, grid, and artifact errors.

**Production defect — engineering fix required:** `build_custom_aoi_raster()` replaces the reference raster's `selected_mask` with the polygon mask but retains the reference raster's pre-existing and new-Prioritizr category masks. For an arbitrary polygon whose selected cells do not exactly equal the union of those retained masks, `SolutionRaster` validation is likely to raise `Solution selected_mask must equal the union of values 1 and 2.` during raster construction. The request therefore fails before metric calculation; this is not merely an unverified category breakdown. Do not claim production support for arbitrary custom AOIs until the implementation clips or rebuilds all category masks consistently and a production-path regression test covers non-matching polygons.

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
- [ ] Custom-AOI category masks are fixed to match the polygon selection, and a production-path non-matching-polygon regression test passes.
- [ ] Prior publish reports, manifest archive, metrics outputs, and runtime artifacts remain available.

## Rollback

1. Stop publication or remove the release from traffic when any artifact family disagrees.
2. Restore the prior runtime manifest:

```bash
npm --prefix frontend run rollback:layer-manifest
```

3. Republish the retained prior regular/compact generation directories and reports, or restore the prior immutable release references. There is no automatic metrics archive.
4. Restore prior MEC and goal objects and URLs through the same reviewed manual process used to publish them.
5. Rebuild the previous known-good FastAPI artifact set and recreate the container:

```bash
DMT_ARTIFACT_REQUIRED=true \
  docker compose -f backend/docker-compose.yml up -d --build --force-recreate
```

6. Verify remote checksums, browser loading, known/custom parity, logs, and `/ready` before restoring traffic.

## Limitations and escalation

- There is no regular-pipeline selector for one AOI; use one complete solution or all solutions.
- Chunk output merging is manual.
- MEC upload/manifest wiring and conservation-goal publication are manual/incomplete.
- Metrics overwrites have no automatic archive; immutable releases or retained local reports are required for reliable rollback.
- Python dependencies use minimum-version ranges rather than a reproducible lock.
- Custom-AOI category-mask handling requires a production code fix and arbitrary-polygon regression coverage; the current path is likely to reject non-matching polygons before calculation.
- Custom-AOI species support must be verified on the target VM; do not infer support from known-AOI species caches.
- Manifest live-metric URLs and sparse-builder output naming conventions may not match. Verify the actual production artifact format before relying on `compressedDataForLiveMetricsUrl`.
- No tested Blob disaster-recovery workflow is documented. Escalate storage loss rather than improvising destructive restoration.
