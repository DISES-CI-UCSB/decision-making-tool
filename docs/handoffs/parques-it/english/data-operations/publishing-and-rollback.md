[← Back to Data Operations](./README.md)

# Publishing and Rollback

> **Audience:** Data publishers and pipeline operators releasing validated data products or restoring a known-good release.
>
> Commands marked **supported** are present in this repository. Steps marked **manual** have no dedicated repository automation and require an approved Blob/host procedure plus a recorded pathname, checksum, operator, and timestamp.

Run commands from the repository root unless a procedure says otherwise. Never place environment-variable values in documentation or command output.

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
| Runtime layer manifest    | Local `frontend/public/data/layer-manifest/manifest.json`; live `manifest/manifest.json`                  | App layers, categories, solutions, rendering, metric URLs, and species-manifest pointer | Dedicated publish and rollback commands; previous live version is archived under `manifest/archive/`                   |
| Species manifest          | Local `frontend/public/data/layer-manifest/species.manifest.json`; live `manifests/species.manifest.json` | Secondary catalog for individual species                                                | Generation publishes by default when a token is available and archives the previous version under `manifests/archive/` |
| Backend artifact manifest | VM-local `backend/runtime-artifacts/manifest.json`                                                        | FastAPI readiness and custom-AOI raster/species inputs                                  | Built on the metrics host; not a browser manifest and not published by the frontend scripts                            |
| Deploy asset manifest     | `frontend/scripts/data-deploy/manifest.json`                                                              | Build-time validation of assets copied into `frontend/public/`                          | Used by frontend build tooling; not the runtime layer catalog                                                          |

Do not replace one manifest with another or infer application visibility from the existence of a deploy/backend manifest.

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
| Species manifest            | `manifests/species.manifest.json`                                                                           |
| Species manifest archives   | `manifests/archive/species.manifest.<timestamp>.json`                                                       |
| Feature inputs              | `inputs/features/`                                                                                          |
| Species inputs              | `inputs/features/species/`                                                                                  |
| Cost inputs                 | `inputs/costs/`                                                                                             |
| Include inputs              | `inputs/includes/`                                                                                          |
| National solutions          | `solutions/nacional/`                                                                                       |
| Solution COGs               | Use each upload report's `expectedBlobPath`; do not invent a parallel prefix                                |
| Default precomputed metrics | `metrics/cache/<solution-id>.metrics.json`                                                                  |
| Versioned metrics           | Use the release configuration selected by `--release-id`                                                    |
| Boundaries                  | Existing registered boundary pathname; preserve the URL contract unless a reviewed change updates consumers |

There is no scanned `inputs/excludes/` workflow. The metadata contract supports `excludes[]`, but exclude rasters and Finder controls are not operator-ready.

## Procedure 1: Generate, test, validate, and publish the runtime manifest

1. Generate the local manifest and reconciliation reports (**supported**):

   ```bash
   npm --prefix frontend run generate:layer-manifest
   ```

2. Review all three reconciliation reports listed above (**manual review**).
3. Run schema validation and manifest tests (**supported**):

   ```bash
   npm --prefix frontend run validate:layer-manifest
   npm --prefix frontend run test:layer-manifest
   ```

   Set `CHECK_REMOTE_DISPLAY_URLS=true` for the validator to probe remote display URLs; the default validation does not make those remote requests.

4. Confirm every URL points to an already-published asset (**manual review**). In particular:
   - `compressedDataForLiveMetricsUrl` may be generated as `metrics/live/{id}.bin.gz`, while sparse builders publish `*.sparse.gz` beside source inputs. Verify the production format and URL.
   - Production metrics should have explicit, versioned `precomputedMetricUrls`; the frontend has a hardcoded staging fallback for `solutions/nick-runs/...`.
5. Publish the validated local manifest (**supported**):

   ```bash
   npm --prefix frontend run publish:layer-manifest
   ```

   The command archives the current live manifest before replacing `manifest/manifest.json`.

6. Record the archive pathname printed by the command, the new manifest URL, local commit/reference, operator, and timestamp (**manual**).

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

   This uses the normal runtime-manifest publisher, so the prior live manifest is archived.

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

7. Regenerate, validate, and publish the runtime manifest if metric URLs changed (**supported**):

   ```bash
   npm --prefix frontend run generate:layer-manifest
   npm --prefix frontend run validate:layer-manifest
   npm --prefix frontend run test:layer-manifest
   npm --prefix frontend run publish:layer-manifest
   ```

8. Verify one national result and one known AOI from every affected geography against scientific expectations (**manual**).

The publisher overwrites with `--force`; long-lived Blob cache headers can therefore serve old bytes at an unchanged URL. Prefer `--release-id` during generation and immutable release paths. If source raster bytes changed, regenerate with `--no-cache`; if calculation outputs must be recomputed, use `--force`. Those flags address different caches.

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

2. Review the numbered archive list and choose the known-good entry (**manual decision**).
3. Republish that archive (**supported**):

   ```bash
   npm --prefix frontend run rollback:layer-manifest -- --use <index|pathname|url>
   ```

4. Refresh the browser and repeat affected post-publish checks.

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

1. Select the prior manifest URL/source set and rebuild it into the VM artifact directory (**supported builder**):

   ```bash
   backend/.venv/bin/python backend/scripts/build_runtime_artifact.py
   ```

   Use the supported `--manifest-url`, `--solution-id`, `--artifact-dir`, or `--force` options when required by the recorded release.

2. Recreate the service with required artifacts (**supported**):

   ```bash
   DMT_ARTIFACT_REQUIRED=true \
     docker compose -f backend/docker-compose.yml up -d --build --force-recreate
   ```

3. Inspect logs and readiness (**supported**):

   ```bash
   docker compose -f backend/docker-compose.yml logs --tail=100 backend
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
| Manifest editor                    | `ENABLE_MANIFEST_EDITOR`, `ENABLE_MANIFEST_EDITOR_WRITES`                                                                                                                                                                                                                                     |
| Firebase client                    | `FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_PROJECT_ID`, `FIREBASE_STORAGE_BUCKET`, `FIREBASE_MESSAGING_SENDER_ID`, `FIREBASE_APP_ID`, `FIREBASE_MEASUREMENT_ID`                                                                                                                    |

## Current automation gaps

- Generic assets and most boundaries lack dedicated upload automation.
- The verified generator CSV and two human-readable snapshots can drift.
- Exclude-layer storage, registration, and Finder behavior are not implemented as an operator workflow.
- Compressed live-metric manifest URLs and sparse-builder output conventions do not clearly match.
- The frontend has a hardcoded staging compact-metric fallback.
- Metrics overwrites are not automatically archived.
- Species rollback, boundary rollback, and backend artifact rollback require manual release records.
- Blob/Firestore disaster recovery is neither automated nor tested.
