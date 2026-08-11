[← Back to Data Operations](./README.md)

# Managing known AOIs and boundaries

## When to use this runbook

Use this runbook when adding or correcting a department, municipality, SIRAP, RUNAP, or OMEC record, or when replacing one of those published boundary collections. It also explains why adding a brand-new geography type is a developer project rather than an upload task.

Do not use this workflow for a user-drawn polygon. A custom AOI is sent to the FastAPI service and calculated from runtime raster artifacts; it is not registered in the known-AOI boundary catalogs or precomputed cache.

## Roles and prerequisites

- **Data steward:** approves source, license, stable IDs, names, geometry, and whether a change is an addition or correction.
- **Operator:** builds or receives the complete replacement GeoJSON, runs validation, coordinates the controlled Blob upload, generates metrics, and verifies the release.
- **Developer/reviewer:** updates fail-closed pins and code contracts. This role is mandatory for a new geography type and strongly recommended for every boundary replacement.
- Work from the repository root with the metrics virtual environment installed.
- Confirm `BLOB_READ_WRITE_TOKEN` is present in `.env.local` before publishing. Never print, paste, or record its value.
- Record the current public URL, source SHA-256, manifest archive reference, metrics publish reports, and backend artifact version before making a change.
- Prefer a new immutable Blob pathname for every boundary release. A successful upload is not approval to reference or expose the new boundary.

## Impact decision table

| Change                                                  | Operator support                              | Boundary contract                                                     | Metrics scope                                                        | Frontend/manifest consequence                                                              |
| ------------------------------------------------------- | --------------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Add or update one department                            | **Manual/developer-assisted**                 | Replace the complete departments GeoJSON; update all affected pins    | **All solutions and all known AOIs in each output**                  | Existing type and URL can remain; catalog/name/ID changes affect identify and cache lookup |
| Add or update one municipality                          | **Manual/developer-assisted**                 | Replace the complete municipalities GeoJSON; update all affected pins | **All solutions and all known AOIs in each output**                  | Same as departments                                                                        |
| Add or update one SIRAP                                 | **Manual/developer-assisted**                 | Replace the complete merged source; update catalog and geometry pins  | **All solutions and all known AOIs**                                 | Combined identify layer and manifest boundary entry must still resolve the same IDs        |
| Add or update one RUNAP area                            | Build/upload script supported                 | Rebuild complete identify collection; update complete pins            | **All solutions and all known AOIs**                                 | RUNAP identify/hover selection and cached `runaps` key must agree                          |
| Add or update one OMEC area                             | **Manual/incomplete**                         | Replace complete identify collection; update complete pins            | **All solutions and all known AOIs**                                 | OMEC identify/hover selection and cached `omecs` key must agree                            |
| Rename only, while retaining the stable ID and geometry | Partly manual                                 | Catalog checksum and source checksum still change                     | **All solutions** because names are embedded in every solution cache | Identify label and cached label must be released together                                  |
| Add a brand-new geography type                          | **Not operator-supported — developer change** | Add a new source specification and tests                              | **All solutions and all AOIs** after implementation                  | Add AOI model, identify, manifest role, cache lookup, UI/UAT, and backend decisions        |
| User draws a custom polygon                             | Existing application workflow                 | No known-boundary pin or catalog entry                                | No precomputed rebuild                                               | FastAPI computes it from runtime artifacts; see the metrics/artifacts runbook              |

The regular metrics pipeline writes one document per solution containing every geography and AOI. It has `--solution-id`, but no single-boundary selector. Therefore, any boundary record, name, geometry, stable ID, source URL, or pin change requires every solution to be regenerated with the complete current AOI catalog, even when calculated values appear unchanged.

## Supported steps and commands

### 1. Classify and stage the change

1. Confirm whether this is:
   - a record addition or correction inside an existing geography; or
   - a new geography type with a new application meaning.
2. Preserve stable IDs. Never recycle an existing ID for a different place.
3. Record source, license, extraction date, CRS, ID/name fields, feature count, geometry repair steps, and the prior published checksum.
4. Build into a new local file. Do not overwrite the known-good local or public source until validation is complete.

Current contracts are:

| App type     | Metrics key      | Public source                                              | Required identity                                                            |
| ------------ | ---------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Department   | `departments`    | `boundaries/igac_departments_detailed.geojson`             | `boundary_id`, `boundary_name`; source fields include `DeCodigo`, `DeNombre` |
| Municipality | `municipalities` | `boundaries/igac_municipalities_detailed.geojson`          | `boundary_id`, `boundary_name`; source fields include `MpCodigo`, `MpNombre` |
| SIRAP        | `siraps`         | `inputs/boundaries/sirap/siraps_merged_polygon_v2.geojson` | `sirap_id`, `sirap_name`, `sirap_kind`, `source_file`                        |
| RUNAP        | `runaps`         | `inputs/includes/runap_identify.geojson`                   | `runap_id`, `runap_name`, `runap_category`, `runap_status`                   |
| OMEC         | `omecs`          | `inputs/includes/omecs_identify.geojson`                   | `SITE_ID`, `NAME`, `DESIG`, `STATUS`, `GOV_TYPE`                             |

### 2. Build the complete boundary collection

Use the workflow for the affected geography:

**Departments and municipalities — manual/developer-assisted**

There is no dedicated repository builder or generic boundary uploader. Produce the complete detailed GeoJSON at the established pathname. Preserve the established identity fields and approved CRS.

**SIRAP — fixed repair/migration only, manual publish**

```bash
python3 data/scripts/sirap/main.py
```

This command is not a general builder for arbitrary new or changed SIRAP content. It downloads one fixed source URL, requires that source's hard-coded SHA-256, and reproducibly repairs that existing ten-feature collection into the pinned polygon-only v2 release. Use it only to reproduce that migration. A new SIRAP source or catalog requires a reviewed developer-assisted transformation and new contracts. Review the generated GeoJSON and matching provenance/metadata JSON under `data/boundaries/sirap/`; the script does not upload them.

**RUNAP — supported build and optional upload**

```bash
python3 data/scripts/runap/main.py \
  --output data/inputs/includes/runap_identify.geojson
```

Run the upload only after local review:

```bash
python3 data/scripts/runap/main.py \
  --output data/inputs/includes/runap_identify.geojson \
  --upload
```

**OMEC — manual/incomplete**

No dedicated OMEC rebuild command exists. Rebuilding and publishing `omecs_identify.geojson` requires a reviewed, developer-assisted process. Stop and escalate if the source-to-contract transformation is not already documented for the dataset being delivered.

### 3. Validate geometry and update fail-closed pins

The metrics loader rejects unexpected source bytes, CRS, ID/name fields, required fields, feature count, catalog, geometry collection, representative geometries, duplicate IDs, and invalid geometries. SIRAP also requires polygonal geometry and its merged-feature behavior.

Calculate and record the whole-file checksum without exposing credentials:

```bash
shasum -a 256 <candidate-boundary.geojson>
```

**Developer-reviewed step:** update the affected `BOUNDARY_SOURCE_SPECS` entry in `data/metrics/python/metrics_pipeline/boundaries/boundary_loader.py`, including:

- `expected_sha256` and cache filename;
- `expected_feature_count`;
- `expected_catalog_sha256`;
- `expected_geometry_collection_sha256`;
- representative geometry hashes when a representative changed;
- CRS, field, or behavior contracts only when intentionally approved.

There is no operator CLI that safely rewrites these pins. Do not weaken or bypass a failed check to make a new file load.

Run the boundary loader unit and contract tests:

```bash
python -m pytest data/metrics/python/tests/test_boundary_loader.py
```

The regular pipeline's `--validate-only` mode does **not** load, download, or validate boundary sources. It fetches the manifest, validates the solution/required-layer catalog, checks whether required layer URLs resolve, and exits before boundary loading:

```bash
python data/metrics/python/metrics_pipeline/main.py \
  --manifest-url <approved-manifest-url> \
  --validate-only
```

Validate the actual public bytes against every reviewed pin with the opt-in public-source test:

```bash
VALIDATE_BOUNDARY_SOURCES=1 \
  python -m pytest \
  data/metrics/python/tests/test_boundary_loader.py \
  -k public_boundary_snapshots
```

Then run an actual one-solution generation into a clean smoke-test output/cache. This exercises boundary download, pin validation, geometry loading, and metric calculation; `--validate-only` cannot substitute for it:

```bash
python data/metrics/python/metrics_pipeline/main.py \
  --manifest-url <approved-manifest-url> \
  --solution-id <known-solution-id> \
  --output-dir data/metrics/generated/boundary-smoke \
  --cache-dir data/metrics/cache/boundary-smoke \
  --force \
  --no-cache
```

A non-release generation reports boundary failures as warnings and may continue with missing geography levels. The smoke passes only when `publish-report.json` has an empty `boundaryErrors` object and the generated solution contains national plus every expected boundary level: `departments`, `municipalities`, `siraps`, `runaps`, and `omecs`.

### 4. Stage and promote the boundary safely

For departments, municipalities, SIRAP, and OMEC, publication is a **controlled manual Blob operation**; no generic repository upload command exists. RUNAP's `--upload` command writes its configured pathname, so treat it as a mutable-path publication unless that implementation is reviewed and changed.

The boundary URL and its fail-closed pins are one contract. Changed pins cannot validate the old bytes at a mutable URL, and new bytes at that URL cannot load under the old pins. Do not deploy either half independently.

**Preferred immutable-path sequence**

1. Upload the complete candidate GeoJSON to a new immutable staged pathname; do not overwrite or delete the prior object.
2. Review a code change that updates the affected `BoundarySourceSpec` URL, cache filename, and all approved pins to that exact staged object.
3. Run the public-source boundary test and actual generation smoke above in an environment using the reviewed code. Require zero `boundaryErrors` and all expected geography levels.
4. Generate, inspect, and publish the complete all-solutions/all-AOIs artifact release using [Metrics and runtime artifacts](./metrics-and-artifacts.md).
5. Coordinate the code deployment, metrics/manifest references, frontend identify configuration, and traffic cutover so users cannot mix old and new boundary contracts.
6. Retain the prior immutable boundary, code/pins, manifest archive, metric artifacts, and reports for rollback.

**If the boundary URL must remain mutable**

There is no atomic repository or Blob mechanism that swaps the mutable bytes and deployed pins together. Schedule coordinated downtime or isolate release traffic, retain both the prior bytes and prior code/pins, replace the bytes, deploy the matching pins, run the public-source test and actual generation smoke, publish the complete artifact release, and restore traffic only after end-to-end verification. If any step fails, restore the prior bytes and prior code/pins while traffic remains isolated.

### 5. Refresh the runtime manifest when its boundary contract changes

If the URL, boundary manifest entry, label, category, or calculation role changed, regenerate and validate:

```bash
npm --prefix frontend run generate:layer-manifest
npm --prefix frontend run validate:layer-manifest
npm --prefix frontend run test:layer-manifest
```

Review the reconciliation reports under `development-artifacts/layer-manifest/reports/`, then publish:

```bash
npm --prefix frontend run publish:layer-manifest
```

Even when the URL is unchanged, verify that the frontend identify configuration still reads the published ID/name fields. Departments, municipalities, and SIRAP are configured in `admin-boundary.service.ts`; RUNAP and OMEC are integrated through the map identify flow and supplemental hover layers.

### 6. Recalculate every solution against the complete AOI catalog

Do not use `--solution-id` for a boundary record change. Generate every solution and force replacement of existing solution output:

```bash
python data/metrics/python/metrics_pipeline/main.py \
  --output-dir data/metrics/generated/tier1 \
  --cache-dir data/metrics/cache/tier1 \
  --force
```

If the published boundary bytes replaced an existing URL and a stale download may exist, also add `--no-cache`. `--force` recomputes output; `--no-cache` re-downloads source rasters and boundaries.

Follow [Metrics and runtime artifacts](./metrics-and-artifacts.md) for the production generation, inspection, dry-run, publication, remote verification, derived compact/MEC artifact, and rollback procedure. The core regular-artifact commands are:

```bash
python data/metrics/python/metrics_pipeline/inspect_metrics.py \
  --output-dir data/metrics/generated/tier1

python data/metrics/python/metrics_pipeline/publish.py \
  --output-dir data/metrics/generated/tier1 \
  --dry-run

python data/metrics/python/metrics_pipeline/publish.py \
  --output-dir data/metrics/generated/tier1

python data/metrics/python/metrics_pipeline/verify_artifacts.py \
  data/metrics/generated/tier1/publish-report.json
```

If compact or MEC artifacts are enabled in the target manifest, regenerate and republish their affected all-solution/all-geography sets as described there.

### 7. Rebuild live custom-AOI artifacts when shared inputs changed

A boundary-only catalog change does not itself alter custom polygons. If the same release also changed a calculation raster or manifest source used by FastAPI, rebuild and restart the backend using [Metrics and runtime artifacts](./metrics-and-artifacts.md). Do not assume precomputed known-AOI publication updates a running backend.

### 8. Adding a brand-new geography type — developer project

**Manual/incomplete workflow:** do not begin with an upload. Create a reviewed implementation plan covering:

1. frontend `AoiType`, selection state, visibility controls, labels, and known-AOI cache-key normalization;
2. map identify source, layer ownership, ID/name fields, highlighting, and whole-feature/component behavior;
3. a new pipeline geography key and `BoundarySourceSpec`;
4. fail-closed checksum, CRS, feature-count, required-field, catalog, geometry-collection, and representative-geometry tests;
5. manifest schema/data role and any boundary entry;
6. regular compact cache, MEC shard, and conservation-goal applicability;
7. FastAPI behavior: known precomputed lookup, custom-polygon calculation, or both;
8. all-solution metric generation, frontend tests, metric parity tests, and UAT.

Only after those contracts are merged and tested should operators publish the boundary and run a complete release.

## Downstream effects

- A record ID becomes the join key among identify results, `geographies.<level>`, UI labels, compact artifacts, and MEC scope catalogs. Changing it can make existing URLs or bookmarks resolve to no metrics.
- A boundary source replacement invalidates whole-file, catalog, geometry-collection, and possibly representative-geometry pins.
- Names are embedded in each solution’s precomputed document; a rename is a metrics release, not only a map-label change.
- SIRAP uses whole merged features for analytical selection. Departments and municipalities may select a clicked geometry component in the UI, while precomputed metrics are tied to the registered boundary feature; test parity deliberately.
- RUNAP and OMEC identify layers also support map hover/selection behavior. A valid metrics catalog does not prove frontend hit-testing works.
- Manifest publication controls discoverability and metric URLs. Uploading boundary bytes alone does not update frontend metadata or caches.
- Custom AOIs remain separate: they are arbitrary polygons calculated by FastAPI and are not added to these catalogs.

## Verification checklist

- [ ] Source, license, date, CRS, transformation, and approver are recorded.
- [ ] Every ID is non-empty, unique, stable, and uses the expected field.
- [ ] Every name and required property is present.
- [ ] Geometry is valid; SIRAP contains only approved polygon types and merged features.
- [ ] Whole-file, feature-count, catalog, geometry-collection, and representative pins were reviewed.
- [ ] `test_boundary_loader.py` passes, including the opt-in public-source test against the reviewed URL and pins.
- [ ] `main.py --validate-only` passes for manifest and required-layer catalog validation only; it is not recorded as boundary evidence.
- [ ] Actual one-solution generation uses fresh downloads, reports no `boundaryErrors`, and contains every expected geography level.
- [ ] Immutable candidate URL, matching reviewed code/pins, smoke evidence, and coordinated cutover are recorded; or mutable-path downtime/traffic isolation is explicitly approved.
- [ ] Manifest validation/tests pass and reconciliation reports have no unexpected exclusions.
- [ ] The affected layer renders and identifies the new/updated record in the browser.
- [ ] The selected frontend AOI ID exactly matches the metrics geography key and record ID.
- [ ] All solutions were regenerated; the publish report contains no failures or unexpected resume skips.
- [ ] Remote artifact byte counts and SHA-256 values match the local publish report.
- [ ] One changed AOI and one unchanged AOI in every affected geography return plausible metrics.
- [ ] A custom polygon still works when shared live-calculation inputs changed, and backend `/ready` remains healthy.
- [ ] The prior boundary bytes/URL, code and pins, manifest archive, metrics artifacts, and reports remain available for rollback.

## Rollback

Use [Metrics and runtime artifacts](./metrics-and-artifacts.md) for artifact-family rollback details. Boundary rollback must restore matching bytes, URL, code, and pins as one coordinated contract:

1. Stop further publication and remove the application from release traffic if identify, boundary loading, or metrics disagree.
2. For the preferred immutable release, redeploy the prior reviewed code/pins that reference the retained prior immutable boundary. Do not overwrite the failed candidate merely to imitate rollback.
3. For a forced mutable pathname, keep traffic isolated while restoring the prior bytes and prior code/pins. Neither side is safe to expose alone, and no atomic swap mechanism exists.
4. Restore the prior runtime manifest:

```bash
npm --prefix frontend run rollback:layer-manifest
```

5. Republish the retained prior metrics generation directory and report, or restore its immutable references, following the metrics/artifacts runbook. Metrics have no automatic archive; rollback is only possible if the prior local outputs or immutable release remain available.
6. If shared FastAPI inputs changed, rebuild the previous known-good runtime artifact set and force-recreate the container.
7. Repeat the public-source boundary test, an actual generation smoke with zero boundary errors/all expected levels, identify checks, known-AOI metric checks, remote checksums, and readiness checks before restoring traffic.

## Limitations and escalation

- Generic department, municipality, SIRAP, OMEC, and boundary uploads are not automated.
- The SIRAP script reproduces one checksum-pinned polygon repair; it is not a general SIRAP ingestion or catalog builder.
- OMEC has no dedicated rebuild workflow. Escalate to the data developer.
- Pin calculation/update is not an operator command. Escalate rather than bypassing fail-closed checks.
- A single AOI cannot be regenerated independently; the output unit is one complete solution document.
- Adding a geography type requires coordinated application, pipeline, manifest, artifact, and test changes.
- Mutable boundary replacement and code/pin deployment have no atomic cutover mechanism; require immutable URLs or coordinated traffic isolation.
- There is no automatic metrics archive or tested Blob disaster-recovery process. Require retained immutable releases or local reports before publishing.
- Escalate any mismatch among identify IDs, catalog IDs, geometry-selection behavior, manifest roles, and precomputed keys; these are contract failures, not browser-cache issues.
