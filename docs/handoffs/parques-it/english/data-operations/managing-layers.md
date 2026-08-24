[← Back to Data Operations](./README.md)

# Managing Layers

## Purpose and when to use

Use this runbook to add, replace, or update feature, cost, include, map-only reference, or species layers. It separates a layer's solver, map, precomputed-metric, and custom-AOI roles so operators perform only the downstream work the change actually requires.

Do not use this runbook to add excludes. Although solution metadata has `excludes[]`, the repository has no canonical exclude folder, scanned Blob prefix, upload workflow, or tested Finder control. Excludes are not operator-ready.

## Roles and prerequisites

- **Release operator:** controls Blob writes, registry changes, generated reports, and manifest publication.
- **Data owner or analyst:** approves scientific meaning, values, units, CRS, resolution, NoData, provenance, and role classification.
- **Reviewer:** checks reconciliation, rendering, labels, metrics, and rollback evidence.
- **Developer:** is required for a new metric definition, solver/Finder behavior, map category, custom-AOI artifact input, rendering override, or exclude behavior. Use [Adding or enabling metrics](./adding-or-enabling-metrics.md) for metric contracts.
- **Backend owner:** rebuilds and restarts custom-AOI artifacts when an existing backend input changes.

Before starting:

1. Work from the repository root and confirm the target environment.
2. Confirm `BLOB_READ_WRITE_TOKEN` is present in `.env.local`. Never print, paste, or record its value.
3. Record the current manifest archive reference and the current asset URL, byte count, checksum, metadata, and downstream artifacts.
4. Identify the stable conceptual layer ID; do not use a temporary filename as identity.
5. Record source, license, dates, contact, CRS, resolution, extent, units, value meanings, NoData, transformations, and SHA-256.
6. Have the data owner and developer classify every applicable role before uploading.

## Impact decision table

| Role or change                 | Typical examples                                   | Manifest/map work                                                                                     | Known-AOI metrics                                                   | Custom-AOI artifacts                                                             | Solver consequences                                         |
| ------------------------------ | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Solver-only                    | Cost surface, optimization feature, forced include | Register only if it must also appear in the app; current generator cannot cleanly express solver-only | None unless separately used by a metric                             | None unless separately included in the backend builder's approved input list     | Future optimization runs must be rerun outside the browser  |
| Map-only                       | Context overlay or external reference service      | Asset/reference, registry, category, rendering, manifest                                              | None                                                                | None                                                                             | None                                                        |
| Precomputed-metric input       | Raster named by the metrics catalog                | Asset, registry/manifest if catalog-resolved                                                          | Recompute every affected solution across all known AOIs             | Only if also a custom-AOI input                                                  | None unless also solver input                               |
| Custom-AOI input               | Layer in `build_runtime_artifact.py`               | Usually required                                                                                      | Only if also a precomputed input                                    | Rebuild artifact and recreate backend                                            | None unless also solver input                               |
| Species display collection     | Individual species TIFs                            | Species manifest, then main manifest pointer                                                          | Recompute affected solution caches when species metrics must change | Separate species matrices are required; display TIF upload alone is insufficient | Conditional                                                 |
| Label or metadata only         | Bilingual name, description, provenance            | Regenerate and publish manifest/metadata                                                              | None if scientific contract and bytes are unchanged                 | None                                                                             | None                                                        |
| Replacement bytes at same path | Corrected raster                                   | Refresh manifest/rendering and verify cache behavior                                                  | Recompute all affected solutions with fresh downloads               | Rebuild if included in the backend builder's approved input list                 | Rerun future solver products if source affects optimization |

Roles are additive. For example, an include may be solver input, map display, and precomputed overlap input at the same time; apply every corresponding column.

## Procedure

### 1. Classify the layer and stop on unsupported cases

Write down whether the layer is:

- **feature:** optimization target and/or thematic raster;
- **cost:** optimization cost surface;
- **include:** area forced into optimization;
- **map-only reference:** displayed for context but not calculated;
- **precomputed-metric input:** read by the Python metric catalog for known AOIs;
- **custom-AOI input:** packaged by the backend runtime artifact builder;
- **species:** an individual species distribution in the secondary species catalog.

Stop for developer review if the layer introduces a new metric, Finder control, category, rendering meaning, custom-AOI input, or exclude. Uploading a file does not implement any of those behaviors. For a genuinely new metric or an existing metric being enabled for another domain, continue with [Adding or enabling metrics](./adding-or-enabling-metrics.md); this runbook remains the source-layer operation.

### Visualization-only procedure (map display only)

Use this procedure when users need a layer in the left map-layers panel for visual comparison or context, but the layer must not drive solution selection, costs, includes/excludes, known-AOI metrics, browser live metrics, or custom-AOI metrics. “Feature” or “cost” may describe the subject matter or source folder; it does not by itself require an analytical role. The runtime manifest supports this separation, and the sidebar displays a layer from its display URL and category independently of its metric role.

The current CSV generator does **not** support this as an operator-only workflow: it infers a feature, cost, or include `dataRole` and assigns every non-boundary row `roleInMetricCalculation: data_used_for_live_metric_calculation`. A release operator must therefore obtain a developer-reviewed manifest correction or generator override before publication. Do not publish the generator's uncorrected output as visualization-only.

1. **Approve the display-only scope.** Record the stable layer ID, source, license, CRS, extent, resolution, values/classes, NoData, labels, category, rendering, and owner. Record explicitly that the layer is excluded from solver, Finder, metric, sparse-artifact, and backend-artifact inputs.
2. **Publish the display artifact.** For an ordinary GeoTIFF, use the controlled manual Blob operation in step 3. For a supported HTTP service, retain the approved HTTPS service URL. The registry's `storage_location` plus `filename` must resolve to that exact display asset, and `data_format` must be a format recognized by the generator.
3. **Register it for display.** Add the verified CSV row described in step 2 with a stable `layer_id`, bilingual labels, description, category-driving groups, source/license fields, storage fields, and `in_use_now: TRUE`. This flag means “include in the runtime layer catalog”; it does not prove or configure analytical use.
4. **Correct the generated release candidate.** After generation, require these manifest values:
   - `dataRole`: `reference_layer` for a pure context/reference layer; a semantic role such as `feature_layer` or `cost_layer` is schema-valid only when reviewers need that classification and still set the metric role to `none`;
   - `roleInMetricCalculation`: `none`;
   - `displayUrl`: the exact reachable raster or supported service URL;
   - `compressedDataForLiveMetricsUrl`: `null`;
   - `precomputedMetricUrls`: `{}`;
   - `category`: an existing mapped sidebar category;
   - stable `id`, `spanishLabel`, `englishLabel`, `description`, `tooltip`, `metadataUrl`, and scientifically correct `rendering`.

   The manifest schema and frontend model support `reference_layer` plus `none`; `land_cover` in `frontend/layer-manifest/manifest.example.json` is the concrete contract example. The current generator will overwrite this correction on regeneration, so preserve the reviewed candidate and repeat the correction or implement an approved generator override before every later publication.
5. **Keep it out of analysis wiring.** Do not add the layer ID to solution metadata `input_layer_ids.features`, `.cost`, `.includes`, or `.excludes`; Python metric definitions or calculators; browser sparse-builder allowlists; backend `build_runtime_artifact.py` inputs; or Finder controls. Do not create or claim live/precomputed metric artifacts for it.
6. **Validate before publication.** Run the manifest validation and tests against the corrected candidate, inspect the three reconciliation reports, and confirm the candidate still has `roleInMetricCalculation: none`, a null live-metric URL, and an empty precomputed URL map. In the app, verify the layer appears under the intended left-panel category, toggles and renders correctly, and does not appear as a Finder choice or change solution, known-AOI, or custom-AOI results.
7. **Publish and verify the visible result.** Follow step 7 using the corrected, validated candidate. After a full browser refresh, the only intended user-visible change is a new optional map layer with the approved label, category, tooltip, legend/rendering, and opacity behavior.
8. **Rollback if any contract check fails.** Run `npm --prefix frontend run rollback:layer-manifest` to restore the archived manifest, restore or retain the prior registry row, and remove or quarantine the newly uploaded asset through the approved Blob process. Refresh the app and confirm the layer is absent and analysis results remain unchanged.

Individual species layers are different: the standard species uploader and secondary-manifest generator expose TIFs from the shared species prefix, and the known-AOI pipeline can also read species TIFs when metrics are recomputed. A display upload does not rebuild metrics or custom-AOI matrices, but the documented standard species workflow cannot guarantee that the file will remain visualization-only in future analytical rebuilds. Obtain developer and data-owner review for a separate contract before promising a visualization-only species layer.

### 2. Prepare the canonical source and registry row

For ordinary solver inputs, use the appropriate canonical repository area:

```text
data/inputs/features/
data/inputs/costs/
data/inputs/includes/
```

Update the verified registry the generator actually reads:

```text
data/Capas de entrada _ Input Layers - Capas de entrada requeridas (2).csv
```

Set a stable `layer_id`; bilingual `layer_name` lines; plain-language `layer_description`; `layer_group`; `model_group`; source and license fields; `filename`; `storage_type`; exact `storage_location`; `data_format`; and deliberate `in_use_now`. Use `notes` for internal detail.

The files `data/input_layers_in_use.csv` and `data/input_layers_required.csv` are documentation snapshots, not generator inputs. Keep them aligned only through the repository's reviewed documentation process; do not mistake them for runtime registration.

For an HTTP map-only service, `storage_location` may be the full supported URL and the format must be one the generator recognizes. Confirm that the existing sidebar has a category mapping before release.

### 3. Publish ordinary assets through a controlled manual operation

There is no repository upload command for generic feature, cost, include, or map-only assets. Use the approved manual Vercel Blob process. The final pathname must exactly match the verified registry's `storage_location` plus `filename`.

Preserve this evidence:

- local file and final Blob pathname or approved external URL;
- before/after SHA-256 and byte count for replacements;
- operator, reviewer, UTC timestamp, and environment;
- Blob response/inventory evidence and whether an existing path was overwritten;
- retained prior asset or immutable rollback pathname.

Do not invent a shell upload command or expose a token. For replacements, prefer a staged immutable pathname until validation if the release design permits it; mutable URLs can remain cached.

### 4. Handle species through the supported workflow

The species uploader has a machine-specific default source path. Always set the source explicitly, dry-run first, and keep the standard Blob prefix unless an approved migration says otherwise:

```bash
SPECIES_TIF_UPLOAD_SOURCE=<approved-local-species-directory> \
SPECIES_TIF_UPLOAD_DRY_RUN=1 \
npm --prefix frontend run upload:species-tifs

SPECIES_TIF_UPLOAD_SOURCE=<approved-local-species-directory> \
npm --prefix frontend run upload:species-tifs

npm --prefix frontend run generate:species-manifest
```

`generate:species-manifest` scans the published species prefix, builds the secondary manifest, archives the previous remote species manifest, and publishes unless configured to skip upload. The combined command is supported when its defaults and environment are already reviewed:

```bash
SPECIES_TIF_UPLOAD_SOURCE=<approved-local-species-directory> \
npm --prefix frontend run upload:species-tifs:manifest
```

If species precomputed metrics must change, recompute the affected solution IDs. If custom-AOI species metrics must change, escalate: the backend expects prebuilt `inputs/features/species-sparse/species_<group>.smtx.gz` matrices, which this display upload does not build.

### 5. Generate and inspect the runtime layer manifest

Run:

```bash
npm --prefix frontend run generate:layer-manifest
npm --prefix frontend run validate:layer-manifest
npm --prefix frontend run test:layer-manifest
```

Review:

```text
development-artifacts/layer-manifest/reports/reconciliation-report.json
development-artifacts/layer-manifest/reports/category-mapping-report.json
development-artifacts/layer-manifest/reports/solutions-reconciliation-report.json
```

Confirm the row is included, its asset is matched, no unrelated asset disappeared, the category maps to the sidebar, rendering inference is scientifically correct, and labels and URLs are correct.

Important contract check: the generator currently infers every non-boundary registry row as `data_used_for_live_metric_calculation`; it has no operator-editable role column for a true map-only or solver-only layer. It also emits `metrics/live/<id>.bin.gz`, while the supported sparse builder writes selected `*.sparse.gz` files beside inputs. Do not publish a misleading role or compressed URL. Escalate for a generator override or schema change when the generated contract does not match actual use.

### 6. Perform only the role-dependent downstream work

#### Solver-only feature, cost, or include

No repository command turns an uploaded input into a new solution. Record that optimization must be rerun in the approved external solver workflow. Do not rebuild metrics or backend artifacts unless the layer also has those roles.

#### Map-only reference

No metrics or backend rebuild is required. Verify only registration, category, labels, rendering, map behavior, and accessibility. Because the current generator cannot explicitly emit `roleInMetricCalculation: none`, obtain developer correction before publishing if it labels the reference as a calculation input.

#### Precomputed-metric input

A new layer is not calculated merely because it is in the manifest. It must already be named in `data/metrics/python/metrics_pipeline/metric_definitions.py` and supported by a calculator. Follow [Adding or enabling metrics](./adding-or-enabling-metrics.md) for new definitions, calculators, domain applicability, frontend presentation, and custom-AOI support.

For a replacement of an existing metric input, identify all affected solution IDs, then run each explicit selection in one batch:

```bash
python data/metrics/python/metrics_pipeline/main.py \
  --manifest-url <live-or-staging-manifest-url> \
  --solution-id <affected-solution-id-1> \
  --solution-id <affected-solution-id-2> \
  --output-dir data/metrics/generated/<release-directory> \
  --cache-dir data/metrics/cache/tier1 \
  --force \
  --no-cache

python data/metrics/python/metrics_pipeline/inspect_metrics.py \
  --output-dir data/metrics/generated/<release-directory>

python data/metrics/python/metrics_pipeline/publish.py \
  --output-dir data/metrics/generated/<release-directory> \
  --dry-run

python data/metrics/python/metrics_pipeline/publish.py \
  --output-dir data/metrics/generated/<release-directory>

python data/metrics/python/metrics_pipeline/verify_artifacts.py \
  data/metrics/generated/<release-directory>/publish-report.json
```

Do not run all solutions blindly. Derive the affected set from the metric catalog and scientific dependency, then verify the publish report contains exactly that set and all applicable known-AOI geographies.

#### Browser live sparse input

Only a fixed catalog of current layers is supported by the sparse builder. Check that the ID resolves before using:

```bash
cd data/metrics/python
python -m metrics_pipeline.sparse.build_layer_sparse \
  --only <supported-layer-id> \
  --dry-run

python -m metrics_pipeline.sparse.build_layer_sparse \
  --only <supported-layer-id> \
  --no-upload

python -m metrics_pipeline.sparse.build_layer_sparse \
  --only <supported-layer-id> \
  --force
```

Return to the repository root after running it. If the dry run says no layer is selected, adding support is developer work; do not claim the layer has a live artifact.

#### Custom-AOI input

The backend builder uses a hardcoded approved input list plus species matrix URLs; manifest registration alone does not add a layer. For a changed input already included in that list, run on the metrics host:

```bash
backend/.venv/bin/python backend/scripts/build_runtime_artifact.py --force

DMT_ARTIFACT_REQUIRED=true \
  docker compose -f backend/docker-compose.yml up -d --build --force-recreate

docker compose -f backend/docker-compose.yml logs --tail=100 backend
curl http://127.0.0.1:8000/health
curl http://127.0.0.1:8000/ready
```

`/health` only proves the process is running. Do not restore traffic until `/ready` confirms the required artifact loaded. A new custom-AOI layer requires the builder, metric catalog/adapters, tests, and request contract changes documented in [Adding or enabling metrics](./adding-or-enabling-metrics.md).

### 7. Publish the final manifest

After all applicable artifacts are ready:

```bash
npm --prefix frontend run generate:layer-manifest
npm --prefix frontend run validate:layer-manifest
npm --prefix frontend run test:layer-manifest
npm --prefix frontend run publish:layer-manifest
```

Publication archives the previous runtime manifest under `manifest/archive/`. Record that archive reference. Refresh the browser before verification because the running app may retain manifest and species data.

### 8. Record the release

Retain role classification, approvals, source and remote checksums, registry diff, reconciliation reports, metric reports when applicable, backend artifact identity/readiness when applicable, species manifest archive when applicable, runtime manifest archive, operator/reviewer names, timestamps, and rollback references.

## Downstream effects

- **Feature, cost, and include:** may affect future solver outputs; upload does not trigger optimization.
- **Map-only:** affects catalog, rendering, and UI only when its role is represented honestly.
- **Precomputed metrics:** one changed input can affect many solutions and every known AOI for those solutions.
- **Custom AOI:** uses only the backend runtime artifact's fixed inputs; a manifest layer is not automatically available.
- **Species:** individual map layers live in a secondary manifest; known-AOI calculations read species TIFs, while custom AOIs require separate grouped sparse matrices.
- **Labels and metadata:** registry fields regenerate compact UI content, while `metadataUrl` points to `metadata/<id>.metadata.json`; generic metadata publication has no dedicated repository command.
- **Replacement assets:** mutable-path replacement risks stale browser, pipeline download, metrics, and backend startup caches.

## Verification checklist

- [ ] The stable ID, scientific role(s), owner, provenance, CRS, resolution, values, units, and NoData are approved.
- [ ] The registry row points to the exact published asset or supported external service and has deliberate `in_use_now`.
- [ ] Reconciliation reports show no unexpected missing, extra, excluded, or recategorized entries.
- [ ] Generated `dataRole`, `roleInMetricCalculation`, display URL, compressed URL, metadata URL, category, labels, and rendering match reality.
- [ ] The map shows correct extent, values/classes, opacity behavior, NoData, labels, and category.
- [ ] Solver-only changes are handed off for a new optimization run; no false claim of generated solutions is recorded.
- [ ] Precomputed reports contain exactly the affected solution IDs and all applicable known-AOI levels, with remote hashes verified.
- [ ] Custom-AOI changes pass `/ready` and a representative polygon only when a backend artifact rebuild was required.
- [ ] Species search and rendering work after a full browser refresh; taxonomy and failed-layer counts were reviewed.
- [ ] Replacement checks prove the app and pipelines read the new checksum, not cached prior bytes.
- [ ] No secret value appears in logs, evidence, documentation, or tickets.

## Rollback

1. Stop publication or remove the release from traffic; preserve failure evidence.
2. Restore the prior runtime manifest:

   ```bash
   npm --prefix frontend run rollback:layer-manifest
   ```

3. Restore the prior asset through the approved controlled Blob process, or restore the registry URL to the retained immutable asset.
4. For bad metrics, republish the retained prior generation directory; metric artifacts have no automatic archive.
5. For custom-AOI failures, rebuild the previous known-good artifact set, force-recreate the container, and require `/ready`.
6. For species failures, restore the archived species manifest and prior TIF set through the controlled process; then refresh the browser.
7. Repeat reconciliation, map, metric, and readiness checks appropriate to the layer's roles.

## Limitations and escalation

- Generic feature, cost, include, reference, and metadata uploads have no repository automation.
- Excludes are not operator-ready: no canonical folder, scanned prefix, upload script, Finder wiring, or tested calculation path exists.
- The verified generator CSV and the two human-readable snapshot CSVs can drift.
- The generator cannot reliably distinguish solver-only, map-only, precomputed-metric, and custom-AOI roles from registry fields.
- Generated `metrics/live/<id>.bin.gz` URLs do not match the supported sparse builder's `*.sparse.gz` convention.
- Sparse browser inputs and backend custom-AOI inputs are hardcoded allowlists; new layers require development.
- Bilingual labels and tooltips are split between the registry and code overrides.
- Category creation, new metric semantics, Finder controls, and new rendering rules require code and tests.
- The species uploader's built-in default source is machine-specific; always provide an approved explicit source.
- Display species uploads do not create the grouped custom-AOI species matrices.
- Mutable metric paths, pipeline caches, browser memory, and startup-loaded backend artifacts can serve stale data.
- No tested end-to-end Blob disaster-recovery process exists. Escalate storage loss, unclear checksums, or missing rollback assets immediately.
