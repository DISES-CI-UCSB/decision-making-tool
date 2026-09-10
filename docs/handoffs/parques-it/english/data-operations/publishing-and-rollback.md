[← Back to Data Operations](./README.md)

# Publishing and Rollback

> **Audience:** Data publishers and pipeline operators releasing validated data products or restoring a known-good release.
>
> Commands marked **supported** are present in this repository. Steps marked **manual** have no dedicated repository automation and require an approved Blob/host procedure plus a recorded pathname, checksum, operator, and timestamp.

Run commands from the repository root unless a procedure says otherwise. Never place environment-variable values in documentation or command output. Authoritative CLI text is [frontend/layer-manifest/README.md](../../../../../frontend/layer-manifest/README.md) and [data/metrics/README.md](../../../../../data/metrics/README.md). National/marine catalog promotion is this runbook; SIRAP regional catalogs (`releases/sirap-…/`) use a separate pipeline.

## Start here

- Publish a national/marine catalog or routing change now: [Procedure 1: Generate, test, validate, and publish the runtime manifest](#procedure-1-generate-test-validate-and-publish-the-runtime-manifest). `--catalog`, `--confirm-release`, and `--expected-live-sha256` are required; there is no `--skip-archive`.
- Publish species now: [Procedure 2: Generate and publish the species manifest](#procedure-2-generate-and-publish-the-species-manifest).
- Publish solution COGs now: [Procedure 3: Publish solution COG references](#procedure-3-publish-solution-cog-references).
- Publish metrics now: [Procedure 4: Inspect, publish, and verify metrics](#procedure-4-inspect-publish-and-verify-metrics).
- Publish generic rasters or most boundaries now: [Procedure 5: Publish generic assets and boundaries](#procedure-5-publish-generic-assets-and-boundaries).
- Verify now: [Post-publish checks](#post-publish-checks) and [How published assets become visible](#how-published-assets-become-visible).
- Rollback now: [Rollback playbooks](#rollback-playbooks).
- SIRAP regional catalogs (`releases/sirap-…/`) use a separate pipeline; do not use Procedure 1 for them.

## Before any publish

1. Identify the target environment, public URL or Blob pathname, consumers, and scientific reviewer.
2. Retain the source files, generation directory, reports, checksums, and the exact known-good rollback reference.
3. Confirm `BLOB_READ_WRITE_TOKEN` is present without printing it.
4. Prefer an immutable release pathname for metrics and other long-cache artifacts.
5. Generate, test, validate, and inspect before a write.
6. Publish data assets before any manifest that references them.

## The four manifests

| Manifest                  | Canonical location                                                                                        | Operator purpose                                                                        | Publication behavior                                                                                                   |
| ------------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Runtime layer manifest    | Local `frontend/public/data/layer-manifest/manifest.json`; live `manifest/manifest.json`                  | National/marine app layers, categories, solutions, rendering, metric URLs, and species-manifest pointer | Gated publish (`--catalog`, `--confirm-release`, `--expected-live-sha256`); previous live pointer is archived; revisions at `manifest/releases/{releaseId}/revisions/` |
| Species manifest          | Local `frontend/public/data/layer-manifest/species.manifest.json`; live `manifests/species.manifest.json` | Secondary catalog for individual species                                                | Generation publishes by default when a token is available and archives the previous version under `manifests/archive/` |
| Backend artifact manifest | VM-local `backend/runtime-artifacts/manifest.json`                                                        | FastAPI readiness and custom-AOI raster/species inputs                                  | Built on the metrics host; not a browser manifest and not published by the frontend scripts                            |
| Deploy asset manifest     | `frontend/scripts/data-deploy/manifest.json`                                                              | Build-time validation of assets copied into `frontend/public/`                          | Used by frontend build tooling; not the runtime layer catalog                                                          |

The live app loads two catalog batches: national `manifest/manifest.json` plus a SIRAP release manifest at `releases/sirap-…/manifest.json` (see `frontend/layer-manifest/catalog-releases/`). Do not replace one batch with the other. Do not infer application visibility from a deploy/backend manifest.

## Registries and reconciliation

The runtime generator reads the verified CSV:

```text
data/Capas de entrada _ Input Layers - Capas de entrada requeridas (2).csv
```

These are human-readable snapshots, not generator inputs:

```text
data/input_layers_in_use.csv
data/input_layers_required.csv
```

Keep all three aligned, but treat the verified CSV as the generator registry and Blob as the availability record. Multiple-registry drift is a known incident risk.

Generation writes:

```text
development-artifacts/layer-manifest/reports/reconciliation-report.json
development-artifacts/layer-manifest/reports/category-mapping-report.json
development-artifacts/layer-manifest/reports/solutions-reconciliation-report.json
```

Review missing/unexpected assets, category mismatches, skipped solutions, and unmatched raster/metadata pairs. Do not publish until every difference is explained.

## Blob path conventions

| Asset                       | Established pathname or prefix                                                                              |
| --------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Runtime layer manifest      | `manifest/manifest.json`                                                                                    |
| Runtime manifest archives   | `manifest/archive/manifest.<timestamp>.json`                                                                |
| Runtime manifest revisions  | `manifest/releases/{releaseId}/revisions/{sha256}.json`                                                     |
| Species manifest            | `manifests/species.manifest.json`                                                                           |
| Species manifest archives   | `manifests/archive/species.manifest.<timestamp>.json`                                                       |
| Feature inputs              | `inputs/features/`                                                                                          |
| Species inputs              | `inputs/features/species/`                                                                                  |
| Cost inputs                 | `inputs/costs/`                                                                                             |
| Include inputs              | `inputs/includes/`                                                                                          |
| National solutions (legacy mutable) | `solutions/nacional/` — do not use for new catalog releases                                        |
| Release solution sources    | `releases/<releaseId>/solutions/{land\|marine}/`                                                            |
| Solution COGs               | Use each upload report's `expectedBlobPath`; do not invent a parallel prefix                                |
| Release metrics             | `releases/<releaseId>/` (regular verbose/compact, goals, MEC v2)                                            |
| Legacy default metrics      | `metrics/cache/<solution-id>.metrics.json` — not the catalog-release contract                               |
| SIRAP regional catalog      | `releases/sirap-…/manifest.json` — separate pipeline, not this national publish                             |
| Boundaries                  | Existing registered boundary pathname; preserve the URL contract unless a reviewed change updates consumers |

There is no scanned `inputs/excludes/` workflow. The metadata contract supports `excludes[]`, but exclude rasters and Finder controls are not operator-ready.

## Procedure 1: Generate, test, validate, and publish the runtime manifest

National/marine solution and metric releases use gated promotion. There is no `--skip-archive`. `--catalog` is required. Copy `--expected-live-sha256` from the immediately preceding dry run. View-only PATCH layer changes use `npm --prefix frontend run catalog -- publish-patch` instead; they must not alter `solutions`.

1. Generate the local manifest from `solution-catalog-v1` (**supported**):

   ```bash
   npm --prefix frontend run generate:layer-manifest -- \
     --catalog ../path/to/solution-catalog.json
   ```

2. Review all three reconciliation reports listed above (**manual review**).
3. Run schema validation and manifest tests against the same catalog (**supported**):

   ```bash
   npm --prefix frontend run validate:layer-manifest -- \
     public/data/layer-manifest/manifest.json \
     --catalog ../path/to/solution-catalog.json
   npm --prefix frontend run test:layer-manifest
   ```

   Set `CHECK_REMOTE_DISPLAY_URLS=true` for the validator to probe remote display URLs; the default validation does not make those remote requests.

4. Confirm every URL points to an already-published asset (**manual review**). In particular:
   - Release metric URLs must sit under `releases/{releaseId}/`.
   - `compressedDataForLiveMetricsUrl` may be generated as `metrics/live/{id}.bin.gz`, while sparse builders publish `*.sparse.gz` beside source inputs. Verify the production format and URL.
   - Production metrics should have explicit, versioned `precomputedMetricUrls`; the frontend has a hardcoded staging fallback for `solutions/nick-runs/...`.
5. Collect `metric-artifact-verification-v1` inventories from `verify_artifacts.py` (regular, compact, goals, and MEC for land). Dry-run gated publish (**supported**):

   ```bash
   npm --prefix frontend run publish:layer-manifest -- \
     --source public/data/layer-manifest/manifest.json \
     --catalog ../path/to/solution-catalog.json \
     --artifact-inventory ../path/to/regular-verification.json \
     --artifact-inventory ../path/to/compact-verification.json \
     --artifact-inventory ../path/to/goals-verification.json \
     --artifact-inventory ../path/to/mec-verification.json \
     --dry-run
   ```

6. Promote only after the dry run matches the live SHA (**supported**):

   ```bash
   npm --prefix frontend run publish:layer-manifest -- \
     --source public/data/layer-manifest/manifest.json \
     --catalog ../path/to/solution-catalog.json \
     --artifact-inventory ../path/to/regular-verification.json \
     --artifact-inventory ../path/to/compact-verification.json \
     --artifact-inventory ../path/to/goals-verification.json \
     --artifact-inventory ../path/to/mec-verification.json \
     --confirm-release <releaseId> \
     --expected-live-sha256 <digest-from-dry-run>
   ```

   The publisher writes `manifest/releases/{releaseId}/revisions/{sha256}.json`, archives the current remote pointer, then promotes with a destination-conditional put. `--dry-run` performs the same remote reads and skips every write.

7. Record the revision pathname, archive pathname, published URL, catalog file, inventories, operator, and timestamp (**manual**).

## Procedure 2: Generate and publish the species manifest

1. Ensure species TIFF uploads are complete. Upload plus manifest generation is **supported**:

   ```bash
   npm --prefix frontend run upload:species-tifs:manifest
   ```

   To generate from already-published TIFFs:

   ```bash
   npm --prefix frontend run generate:species-manifest
   ```

2. Understand the write boundary: `generate:species-manifest` writes the local file and, when `BLOB_READ_WRITE_TOKEN` is available, publishes `manifests/species.manifest.json` by default. It archives the prior live species manifest under `manifests/archive/`.
3. For a local-only generation, set `SPECIES_MANIFEST_SKIP_BLOB_UPLOAD`; partial runs using `SPECIES_MANIFEST_MAX_LAYERS` do not upload unless `SPECIES_MANIFEST_ALLOW_PARTIAL_UPLOAD` is explicitly enabled.
4. Treat any failed layer count or exit code as a failed release. Do not publish a partial catalog as production (**manual decision**).
5. Refresh the browser tab and verify species search, one binary raster, one continuous raster, and affected metrics (**manual**).

## Procedure 3: Publish solution COG references

1. Generate COGs (**supported**):

   ```bash
   python data/scripts/solutions-cog/main.py
   ```

2. Preview one upload and inspect the generated report (**supported command, manual review**):

   ```bash
   npm --prefix frontend run upload:solutions-cogs -- --dry-run --limit 1
   ```

3. Upload the COG set (**supported**):

   ```bash
   npm --prefix frontend run upload:solutions-cogs
   ```

4. Produce and validate a candidate manifest without publishing (**supported**):

   ```bash
   npm --prefix frontend run publish:solution-cog-manifest
   ```

5. Publish the candidate after review (**supported**):

   ```bash
   npm --prefix frontend run publish:solution-cog-manifest -- --publish
   ```

   This uses the gated runtime-manifest publisher, so `--catalog`, inventories, `--confirm-release`, and `--expected-live-sha256` apply. The prior live pointer is archived.

## Procedure 4: Inspect, publish, and verify metrics

1. Retain the complete generation directory and `publish-report.json`. There is no automatic metrics archive.
2. Do not treat the regular pipeline's `--validate-only` as end-to-end validation. It checks the manifest/catalog and required-layer presence, then exits before solution selection, boundary loading, source reads, and calculation. Require a real generation plus inspection.
3. Inspect generated output (**supported**):

   ```bash
   python data/metrics/python/metrics_pipeline/inspect_metrics.py \
     --output-dir data/metrics/generated/tier1
   ```

4. Preview uploads (**supported**):

   ```bash
   python data/metrics/python/metrics_pipeline/publish.py \
     --output-dir data/metrics/generated/tier1 \
     --dry-run
   ```

5. Publish after inspection passes (**supported**):

   ```bash
   python data/metrics/python/metrics_pipeline/publish.py \
     --output-dir data/metrics/generated/tier1
   ```

6. Compare remote bytes and SHA-256 with the local report and verify expected cache headers (**supported**):

   ```bash
   python data/metrics/python/metrics_pipeline/verify_artifacts.py \
     data/metrics/generated/tier1/publish-report.json
   ```

7. If metric URLs changed, regenerate and promote the runtime manifest with Procedure 1 (`--catalog`, inventories, `--dry-run`, then `--confirm-release` / `--expected-live-sha256`). Bare `publish:layer-manifest` without those flags is rejected.
8. Verify one national result and one known AOI from every affected geography against scientific expectations (**manual**).

Release metrics refuse silent overwrite: `publish.py` has no `--force`. An existing remote path is accepted only when its SHA-256 matches the local artifact. Prefer `releases/{releaseId}/` paths. If source raster bytes changed, regenerate with `--no-cache`; if calculation outputs must be recomputed, use generation `--force`. Those flags address different caches and do not authorize Blob overwrite.

## Procedure 5: Publish generic assets and boundaries

No repository command bulk-uploads generic feature, cost, include, exclude, reference, raw solution `.tif`/`.json` pairs, or most boundary files.

1. Complete the source-specific runbook and obtain scientific approval.
2. Record local path, target Blob pathname, SHA-256, operator, timestamp, and prior asset reference (**manual**).
3. Upload through the approved Vercel Blob procedure without changing the registered pathname accidentally (**manual**).
4. Verify the remote size/checksum and public readability (**manual**).
5. Update checksum pins and URL consumers in the same reviewed change when a boundary contract changes (**developer change**).
6. Run the runtime manifest procedure and all affected metric/backend procedures.

Dedicated exceptions include species uploads, solution COG uploads, RUNAP's `--upload` mode, and ecosystem classification summary publication. Do not generalize those scripts to unrelated assets.

## How published assets become visible

1. The asset must exist at the URL recorded by the relevant manifest.
2. The runtime layer manifest must admit the layer and map its category to a sidebar group.
3. A regular layer needs a usable `displayUrl` or `displayCollectionUrl`.
4. A solution needs a valid `solutions[]` entry and usable `finderInputs`; a raster alone is not enough.
5. Species require the main manifest to point to a valid secondary species manifest.
6. Known-AOI metrics require a valid `precomputedMetricUrls` entry or the legacy default contract.
7. Custom-AOI changes require rebuilt runtime artifacts and a recreated backend container.
8. Refresh the browser during verification because manifest, species, and metric data may remain in memory.

## Post-publish checks

1. Fetch the live runtime and species manifests with a cache-busting query and confirm the intended generated timestamp/content (**manual**).
2. Confirm reconciliation reports contain no unexplained missing, excluded, category, or solution rows.
3. Render one changed layer and check extent, CRS alignment, units, colors, and NoData behavior.
4. Find and render one affected solution in Solution Finder.
5. Check one known AOI from each affected geography.
6. Check one custom polygon when live inputs changed.
7. Compare a custom polygon matching a known boundary with its precomputed result under the documented scientific rules.
8. For backend changes, run (**supported on the metrics host**):

   ```bash
   curl http://127.0.0.1:8000/health
   curl http://127.0.0.1:8000/ready
   ```

   `/health` proves only that the process is alive. Do not return the service to traffic unless `/ready` succeeds when artifacts are required.

9. Record checks, results, release paths, checksums, and rollback references (**manual**).

## Rollback playbooks

Manifest rollback restores routing metadata only. It does **not** recreate asset bytes that were overwritten or deleted at the referenced path. Before restoring a manifest, verify every referenced raster, metric, sidecar, and secondary manifest still exists with the recorded checksum; restore missing or changed bytes separately from retained immutable/local copies.

### Runtime layer manifest

1. List available archives without changing live state (**supported**):

   ```bash
   npm --prefix frontend run rollback:layer-manifest
   ```

2. Review the numbered archive list and choose the known-good entry (**manual decision**). Archives without release identity are rejected.
3. Dry-run against the historical `solution-catalog-v1` for that archive (**supported**):

   ```bash
   npm --prefix frontend run rollback:layer-manifest -- \
     --use <index|pathname|url> \
     --catalog ../path/to/historical-solution-catalog.json \
     --dry-run
   ```

4. Confirm the restore (**supported**):

   ```bash
   npm --prefix frontend run rollback:layer-manifest -- \
     --use <index|pathname|url> \
     --catalog ../path/to/historical-solution-catalog.json \
     --confirm-rollback
   ```

5. Refresh the browser and repeat affected post-publish checks.

### Species manifest

1. Identify the known-good `manifests/archive/species.manifest.<timestamp>.json` from the release record (**manual**).
2. Copy that archived Blob to `manifests/species.manifest.json` using the approved Blob operation (**manual; no dedicated rollback command**).
3. Refresh the browser and verify species search/rendering. If the main runtime manifest pointer also changed, roll it back separately.

### Solution COGs

1. If only the new COG display path is bad, restore the runtime manifest archived by `publish:solution-cog-manifest -- --publish` using the runtime-manifest rollback command.
2. Confirm the retained legacy `displayUrl` renders. Re-uploading the old raster is normally unnecessary.
3. If raster bytes were overwritten at the same COG pathname, restore a retained known-good COG through the approved Blob operation (**manual**) and account for cache staleness.

### Metrics

1. Stop promotion and identify the retained known-good generation directory and its `publish-report.json` (**manual**).
2. Dry-run, republish, and verify that directory using Procedure 4 (**supported**).
3. Restore the prior runtime manifest if metric URLs changed.
4. Verify known-AOI and custom-AOI parity as applicable.

There is no automatic metrics archive. If no prior local generation directory/report or immutable release exists, rollback is not safely reproducible.

### Boundaries

1. Republish the retained prior GeoJSON at its approved pathname (**manual**).
2. Restore the matching reviewed checksum pins and any changed frontend URL configuration (**developer change**).
3. Republish affected metrics, rebuild backend artifacts if required, and rerun identify/metric checks.

### Backend runtime artifacts

1. Select the prior manifest URL/source set and rebuild it (**supported builder**). Local Docker default is flagless except `--force` when replacing existing volume files:

   ```bash
   docker compose run --rm --build backend hydrate --force
   ```

   That reads live `manifest/manifest.json` (`hydrationPackage`, EPSG:9377). Pass `--manifest-url` only when restoring a recorded prior catalog. `--production-v3` is the optional Mesa/immutable production profile, not the local default. `--aligned-cache` is optional. Do not pass `--reference-grid ecosistemas` unless you intentionally want the legacy EPSG:4326 grid.

   Host equivalent: `backend/.venv/bin/python backend/scripts/build_runtime_artifact.py`. Use `--manifest-url`, `--solution-id`, `--artifact-dir`, or `--force` when the recorded release requires them.

2. Recreate the service with required artifacts (**supported**). Local Docker:

   ```bash
   docker compose up -d --build --force-recreate
   ```

   Production VM:

   ```bash
   DMT_ARTIFACT_REQUIRED=true \
     docker compose -f backend/docker-compose.yml up -d --build --force-recreate
   ```

3. Inspect logs and readiness (**supported**):

   ```bash
   docker compose logs --tail=100 backend
   curl http://127.0.0.1:8000/ready
   ```

4. Return traffic only after readiness and a custom-polygon smoke test pass.

### Storage loss or broad corruption

Stop the release and escalate. There is no automated, tested Blob/Firestore disaster-recovery procedure; manifest archives and retained local outputs do not constitute tested DR.

## Environment variable names

Values must never appear in this guide or release logs.

| Purpose                            | Names                                                                                                                                                                                                                                                                                         |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Blob writes                        | `BLOB_READ_WRITE_TOKEN`                                                                                                                                                                                                                                                                       |
| Runtime catalog and routing        | `MANIFEST_BLOB_URL`, `BLOB_ASSET_PROXY_PATH`, `METRICS_API_BASE_URL`                                                                                                                                                                                                                          |
| Manifest validation                | `CHECK_REMOTE_DISPLAY_URLS`                                                                                                                                                                                                                                                                   |
| Backend artifacts                  | `DMT_ARTIFACT_DIR`, `DMT_ARTIFACT_MANIFEST`, `DMT_ARTIFACT_REQUIRED`, `DMT_ARTIFACT_SCHEMA_VERSION`, `DMT_METRICS_PIPELINE_PATH`                                                                                                                                                              |
| Species-TIF upload                 | `SPECIES_TIF_UPLOAD_SOURCE`, `SPECIES_TIF_BLOB_PREFIX`, `SPECIES_TIF_UPLOAD_CONCURRENCY`, `SPECIES_TIF_UPLOAD_MAX`, `SPECIES_TIF_UPLOAD_DRY_RUN`, `SPECIES_TIF_UPLOAD_RUN_SPECIES_MANIFEST`                                                                                                   |
| Species-manifest publication       | `SPECIES_MANIFEST_SKIP_BLOB_UPLOAD`, `SPECIES_MANIFEST_MAX_LAYERS`, `SPECIES_MANIFEST_ALLOW_PARTIAL_UPLOAD`, `SPECIES_MANIFEST_BLOB_PATHNAME`, `SPECIES_MANIFEST_ARCHIVE_PREFIX`, `SPECIES_MANIFEST_SKIP_ARCHIVE`                                                                             |
| Species-manifest source and tuning | `SPECIES_MANIFEST_CONCURRENCY`, `SPECIES_RASTER_SAMPLE_GRID_SIZE`, `SPECIES_MANIFEST_RASTER_READ_RETRY_ATTEMPTS`, `SPECIES_MANIFEST_BASE_REQUEST_DELAY_MS`, `SPECIES_MANIFEST_REQUEST_JITTER_MS`, `SPECIES_MANIFEST_RETRY_JITTER_MS`, `SPECIES_TAXONOMY_CSV_PATH`, `SPECIES_TAXONOMY_CSV_URL` |
| Manifest editor (retired)          | `ENABLE_MANIFEST_EDITOR`, `ENABLE_MANIFEST_EDITOR_WRITES` — retired / unused. Do not enable in production. Layer appearance in the map layers panel is the supported styling path.                                                                                                          |
| Firebase client                    | `FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_PROJECT_ID`, `FIREBASE_STORAGE_BUCKET`, `FIREBASE_MESSAGING_SENDER_ID`, `FIREBASE_APP_ID`, `FIREBASE_MEASUREMENT_ID`                                                                                                                    |

## Current automation gaps

- Generic assets and most boundaries lack dedicated upload automation.
- The verified generator CSV and two human-readable snapshots can drift.
- Exclude-layer storage, registration, and Finder behavior are not implemented as an operator workflow.
- Compressed live-metric manifest URLs and sparse-builder output conventions do not clearly match.
- The frontend has a hardcoded staging compact-metric fallback.
- Metrics overwrites are not automatically archived; release paths also refuse differing remote SHA-256.
- Species rollback, boundary rollback, and backend artifact rollback require manual release records.
- Blob/Firestore disaster recovery is neither automated nor tested.
