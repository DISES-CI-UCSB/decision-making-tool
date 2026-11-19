[← Back to Data Operations](./README.md)

# Adding and replacing solutions

## Purpose and release status

This runbook is for **national and marine** solutions only. SIRAP regional
solutions use a separate pipeline (`sirap_release/` and immutable
`releases/sirap-…/` paths). Do not follow this procedure for SIRAP catalogs.

Use this guide for either:

1. adding one new solution package; or
2. preparing a materially revised solution as a new solution package.

The operator-facing unit is **Add one new solution**. Each add includes a newly
assigned immutable solution ID, immutable source and derived artifact paths,
metadata, a manifest entry, metrics, and provenance. A material revision is
also an add: never overwrite or reuse the prior package, pathnames, or
`solution_id`. Archive the complete old package and its old ID as part of the
prior immutable catalog release, mint a new `solution_id` and artifact paths
for the revision, and publish the revision in a new catalog release.

Retiring the old revision means excluding its old ID from the new active
catalog. It does not mean deleting the old ID, package, artifacts, metadata, or
historical releases. Replacement and retirement **are supported in release
mode**. Declare the intended ID set in a `solution-catalog-v1` JSON file,
generate and validate with `--catalog`, and promote with `--confirm-release`
and `--expected-live-sha256`. When `releaseId` is set, the generator does
**not** preserve published IDs that are absent from the catalog.

The repository has no verified structured solution-lineage or supersession
field. Until one is implemented and validated, record the human-readable
relationship between old and new IDs in the existing metadata `notes` field
when approved, and in the catalog release documentation and retained operator
reports. Do not invent fields such as `supersedes`, `replaces`, or
`previous_solution_id` and assume runtime tooling will preserve or interpret
them.

Live promotion always requires a release manifest with `releaseId` plus
`--catalog`. Do not publish an incomplete candidate to `manifest/manifest.json`.
Release generation can consume a local `file://` preflight manifest, so do not
use `--skip-archive` — that flag is gone. Authoritative CLI detail lives in
[frontend/layer-manifest/README.md](../../../../../frontend/layer-manifest/README.md)
and [data/metrics/README.md](../../../../../data/metrics/README.md).

For broader artifact details, see
[Metrics and runtime artifacts](./metrics-and-artifacts.md). For publication and
recovery commands, see
[Publishing and rollback](./publishing-and-rollback.md).

## Start here

- Add one national or marine package: [Supported procedure: add one new solution](#supported-procedure-add-one-new-solution).
- Replace or retire IDs in the live catalog: [Catalog replacement or retirement](#catalog-replacement-or-retirement).
- Decide whether this is a new ID or a material revision: [Decide whether this is a new solution or a material revision](#decide-whether-this-is-a-new-solution-or-a-material-revision).
- Check current support before starting: [Scope summary](#scope-summary).
- Restore a known-good catalog: [Rollback](#rollback).
- Stop for SIRAP regional catalogs: this runbook does not apply. Use the [SIRAP Regional Solutions](https://docs.google.com/document/d/1mThmI_KmTT8kE2s02s_ymhdHL-BUxyIl8lxuwXJ76aM/edit?tab=t.oqw67lnj8o9t) Google Doc tab (56 scenarios: 40 Eje Cafetero, 16 Orinoquía).
- Incremental land-use / add-a-metric backfill: [Incremental metric backfill](#incremental-metric-backfill). `backfill_land_use_of_aoi.py` is on this branch as a developer/test path, not a frozen GTIC operator runbook. `catalog-releases/3.0.6` test is not the GTIC 3.0.5 publish.
- Before claiming a material revision replaced the old ID: [Material-revision replacement checklist](#material-revision-replacement-checklist).

## Scope summary

| Operation                                     | Current status                                    | Important constraint                                                                                                                                                         |
| --------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Add one new solution                          | Supported as a catalog release                    | Include the new immutable ID in a `solution-catalog-v1` file; stage sources under `releases/{releaseId}/solutions/{land\|marine}/`; promote with gated publish                |
| Prepare a material revision as a new solution | Supported only as the new-package add             | Never overwrite/reuse the old package or ID; mint a new ID and immutable paths, and record the old-to-new relationship in supported metadata or release documentation         |
| Replace the old revision in the active catalog | Supported in release mode                        | New catalog includes the new ID and excludes the old ID; retain the complete old release; generator does not merge undeclared published IDs when `releaseId` is set          |
| Retire a solution from the active catalog     | Supported in release mode                         | Retirement means exclusion from a new active catalog, not deleting/reusing its ID, package, metadata, artifacts, or historical releases                                      |
| Replace the complete catalog                  | Supported — `solution-catalog-v1` promotion       | Generate with `--catalog`; promote with artifact inventories, `--dry-run`, then `--confirm-release` and `--expected-live-sha256`                                             |
| Build a display COG                           | Supported only when `scope` is exactly `nacional` | The current COG selector does not process marine solutions                                                                                                                   |

## Roles and prerequisites

- **Release operator:** controls Blob writes, catalog files, artifact
  inventories, and gated manifest promotion.
- **Data owner or analyst:** approves raster values, metadata, provenance,
  Finder inputs, and scientific meaning.
- **Reviewer:** independently checks reports, URLs, Finder behavior, rendering,
  and metrics.
- **Developer/release engineer:** required for MEC/goals publication wiring
  questions, a missing staging environment, or SIRAP regional catalogs (not
  this runbook).

Before starting:

1. Work from the repository root with the Python metrics environment and
   frontend dependencies installed.
2. Confirm `BLOB_READ_WRITE_TOKEN` is present in `.env.local`. Never print,
   paste, or record its value.
3. Record the target environment, live national manifest URL, historical catalog
   JSON for rollback, and retained prior artifact reports/directories.
4. Prepare a `solution-catalog-v1` file with `releaseId`, `catalogVersion`,
   expected counts, and the exact sorted solution ID set. Paths passed to
   `yarn --cwd frontend` are relative to `frontend/`.
5. Record source, license, owner, generation time, CRS, resolution, extent,
   data type, value meanings, NoData, and SHA-256 for each source pair.

## Decide whether this is a new solution or a material revision

### New solution

A new solution receives a newly assigned immutable ID. Its complete package
includes the source raster pair, derived artifacts, metadata, manifest entry,
metrics, and provenance as applicable. These paths are not referenced by the
live catalog before gated promotion, provided the operator uses new immutable
pathnames under `releases/{releaseId}/`.

### Material revision of an existing solution

A material revision is a new solution package even when it represents the same
conceptual solution:

- Preserve the old `solution_id`, raw raster pair, COG, metrics, metadata, and
  release records as the prior immutable package.
- Mint a new `solution_id` and new immutable pathnames for every revised source
  and derived artifact. Never overwrite or reuse the old package or ID.
- Record provenance and the old-to-new relationship in the existing metadata
  `notes` field when approved, plus the catalog release documentation and
  retained operator reports. There is no verified structured lineage field.
- Publish the revised package in a new catalog release and retire the old ID by
  excluding it from that catalog. Preserve historical releases.

The add steps below prepare the new package. Active-catalog replacement is the
catalog-promotion procedure: the new catalog must include the new ID and omit
the retired ID.

## Supported procedure: add one new solution

The commands below were checked against the current repository CLIs. Replace
all placeholders and retain every generated report. Adding one ID is still a
catalog release: include it in `solution-catalog-v1` and promote that catalog.

### 1. Prepare and review the source pair

Create two same-stem files:

```text
<solution-name>.tif
<solution-name>.json
```

Use `data/solutions/metadata/example_solution_metadata.json` only as a starting
point, then compare with an admitted production sidecar. Verify:

- `id` is newly assigned, unique, immutable, and never reused.
- For a material revision, `id` differs from the archived prior
  `solution_id`.
- `run_name`, `scope`, optional `domain`, and `raster_file` describe this
  raster.
- `input_layer_ids.features`, singular `input_layer_ids.cost`, `includes`, and
  `excludes` use registered conceptual IDs.
- `evaluation` and `coverage` are present when those results exist.
- `raster_file` exactly names the paired raster.
- `notes`, when approved for operational provenance, identifies the prior ID
  and catalog release in plain language; do not invent an unsupported
  structured lineage field.

Keep `excludes` empty unless developers have implemented and tested the exclude
workflow. Do not rely on filename inference as the formal metadata contract.

### 2. Stage the raw pair under the release prefix

Do not upload to the old mutable `solutions/nacional/` or `solutions/marine/`
prefixes for a catalog release. Build a checksum-pinned source upload plan and
write to `releases/<releaseId>/solutions/{land|marine}/...` only. The uploader
defaults to a read-only dry run and refuses to overwrite differing immutable
bytes:

```bash
python data/metrics/python/metrics_pipeline/upload_solution_sources.py \
  data/metrics/generated/releases/<releaseId>/source-upload/upload-plan.json

python data/metrics/python/metrics_pipeline/upload_solution_sources.py \
  data/metrics/generated/releases/<releaseId>/source-upload/upload-plan.json \
  --execute
```

Retain:

- local and Blob pathnames;
- SHA-256 and byte count for both files;
- operator, UTC timestamp, and target environment;
- public URLs or Blob inventory evidence; and
- confirmation that no unrelated object was overwritten.

### 3. Declare the ID in solution-catalog-v1 and preflight the plan

Add the new `solutionId`, `solutionBasename` (exact lowercase `.tif`),
`domain`, and `rasterSha256` to a `solution-catalog-v1` file. Bump
`catalogVersion` (MAJOR or MINOR for solution/metric changes). Set
`expectedSolutionCount`, `expectedLandSolutionCount`, and
`expectedMarineSolutionCount` to the declared set.

```bash
python data/metrics/python/metrics_pipeline/plan_solution_release.py \
  --catalog path/to/new-solution-catalog.json \
  --baseline-catalog path/to/previous-solution-catalog.json \
  --output data/metrics/generated/releases/<releaseId>/release-plan.json
```

Generate the local release manifest against that catalog (paths are relative
to `frontend/`):

```bash
yarn --cwd frontend generate:layer-manifest \
  --catalog ../path/to/solution-catalog.json

yarn --cwd frontend validate:layer-manifest \
  public/data/layer-manifest/manifest.json \
  --catalog ../path/to/solution-catalog.json

yarn --cwd frontend test:layer-manifest
```

Review
`development-artifacts/layer-manifest/reports/solutions-reconciliation-report.json`.
The intended ID must appear once in `solutions[]`, not in `skipped` or
`unmatchedRasters`. Check `finderInputs`, `displayUrl`, `metadataUrl`,
`rendering`, and every deterministic `precomputedMetricUrls` value under
`releases/{releaseId}/`.

This candidate is evidence of the declared catalog only. IDs omitted from the
catalog are not preserved.

### 4. Keep the candidate off the live pointer

Do not target `manifest/manifest.json` until every referenced metric and COG
byte exists. Release metrics can consume a local preflight manifest:

```text
--manifest-url file://$PWD/data/metrics/generated/releases/<releaseId>/preflight/manifest.json
```

There is no `--skip-archive` flag. Gated promotion always archives the current
live pointer as part of `--confirm-release`. Publishing a half-built catalog
live is not an acceptable workaround.

### 5. Optionally build and upload a national display COG

The current COG builder includes only entries whose `scope` is exactly
`nacional`. It does not process marine solutions.

```bash
python data/scripts/solutions-cog/main.py \
  --manifest-url <candidate-manifest-url> \
  --solution-id <solution-id>

yarn --cwd frontend upload:solutions-cogs \
  --dry-run \
  --solution-id <solution-id>

yarn --cwd frontend upload:solutions-cogs \
  --solution-id <solution-id>
```

Require `data/cog/generated/publish-report.json` to report a valid COG and
`data/cog/generated/upload-report.json` to contain only the intended solution
with no failures.

### 6. Generate regular known-AOI metrics for the release

Output defaults under `data/metrics/generated/releases/<releaseId>/`, not
`metrics/cache/`. Cache under `data/metrics/cache/releases/<releaseId>/`. Pass
the catalog and release plan; see
[data/metrics/README.md](../../../../../data/metrics/README.md) for worker chunks
and `merge_release_workers.py`.

A one-solution scientific smoke may omit `--release-plan` and must never be
assembled or published as the complete release:

```bash
python data/metrics/python/metrics_pipeline/main.py \
  --manifest-url "file://$PWD/$RELEASE_ROOT/preflight/manifest.json" \
  --release-id "$RELEASE_ID" \
  --solution-catalog "$RELEASE_ROOT/solution-catalog.json" \
  --solution-id <solution-id> \
  --cache-dir "data/metrics/cache/releases/$RELEASE_ID" \
  --output-dir "$RELEASE_ROOT/smoke/scientific/regular/verbose"
```

For the catalog release itself, generate, inspect, publish, and verify. Release
metrics refuse silent overwrite: an existing remote path is accepted only when
its SHA-256 matches.

```bash
python data/metrics/python/metrics_pipeline/inspect_metrics.py \
  --output-dir data/metrics/generated/releases/<releaseId>/regular/verbose \
  --solution-id <solution-id>

python data/metrics/python/metrics_pipeline/publish.py \
  --output-dir data/metrics/generated/releases/<releaseId>/regular/verbose \
  --solution-id <solution-id> \
  --dry-run

python data/metrics/python/metrics_pipeline/publish.py \
  --output-dir data/metrics/generated/releases/<releaseId>/regular/verbose \
  --solution-id <solution-id>

python data/metrics/python/metrics_pipeline/verify_artifacts.py \
  data/metrics/generated/releases/<releaseId>/regular/verbose/publish-report.json
```

The regular output should contain national, departments, municipalities,
SIRAPs, RUNAPs, and OMECs when their pinned boundaries load and the metric
catalog says they apply. Boundary load errors are release failures.

### 7. Compact, goals, and MEC inventories

Build compact regular cache, goals, and (for land) MEC v2 against the same
catalog. Each `verify_artifacts.py` output is a `metric-artifact-verification-v1`
inventory required at promotion.

Land solutions require regular verbose/compact, goals, and all six MEC v2
artifacts. Marine solutions require regular verbose/compact and goals, with no
MEC.

After recomputed artifacts exist, assemble catalog-declared reuse from a
checksum-pinned baseline inventory with `assemble_solution_release.py`. That
assembly is **not** a finished add-one-metric path; see the backfill
section below.

### 8. Promote the catalog (gated publish)

Confirm every URL in the generated manifest already resolves to verified bytes.
Then dry-run and promote. `--catalog` is required. Each `--artifact-inventory`
must come from `verify_artifacts.py`. Copy `--expected-live-sha256` from the
dry-run output:

```bash
yarn --cwd frontend publish:layer-manifest \
  --source public/data/layer-manifest/manifest.json \
  --catalog ../path/to/solution-catalog.json \
  --artifact-inventory ../path/to/regular-verification.json \
  --artifact-inventory ../path/to/compact-verification.json \
  --artifact-inventory ../path/to/goals-verification.json \
  --artifact-inventory ../path/to/mec-verification.json \
  --dry-run

yarn --cwd frontend publish:layer-manifest \
  --source public/data/layer-manifest/manifest.json \
  --catalog ../path/to/solution-catalog.json \
  --artifact-inventory ../path/to/regular-verification.json \
  --artifact-inventory ../path/to/compact-verification.json \
  --artifact-inventory ../path/to/goals-verification.json \
  --artifact-inventory ../path/to/mec-verification.json \
  --confirm-release <releaseId> \
  --expected-live-sha256 <digest-from-dry-run>
```

The publisher writes an immutable revision at
`manifest/releases/{releaseId}/revisions/{sha256}.json`, archives the current
live pointer, then promotes with a destination-conditional put using the live
ETag. `--dry-run` performs the same remote reads and skips every write.

### 9. Verify and retain the release

- Fetch the live national manifest with a cache-busting query and verify the
  intended ID set.
- Confirm Finder inputs and labels.
- Render the raw raster and COG, if applicable.
- Test one known AOI from every applicable geography.
- Load regular, compact, MEC, and goals data as applicable.
- Verify one unchanged reused solution still loads.
- Retain raw and derived checksums, all reports, local generation directories,
  catalogs, inventories, operator/reviewer names, and UTC timestamps.
- Keep the old objects for the approved retention period. Do not delete them
  merely because a manifest archive exists.
- For a material revision, claim replacement only when the new active catalog
  excludes the old ID and the complete prior release remains retained.

## Catalog replacement or retirement

This is the live national/marine workflow. It is not waiting on a merge.

1. Freeze changes and inventory the complete live dependency graph.
2. Author a `solution-catalog-v1` file for the new `releaseId`. Include every
   ID that must stay active; omit every ID that must leave the live catalog.
3. Upload new source pairs only under
   `releases/{releaseId}/solutions/{land|marine}/`. Never overwrite an old ID
   or package.
4. Plan the release (`plan_solution_release.py`), generate metrics for IDs
   marked `recompute`, and assemble checksum-identical reuse.
5. Generate the manifest with `--catalog`. Do not merge undeclared published
   IDs.
6. Verify every candidate URL. Each `--artifact-inventory` must match catalog
   identity, URLs, byte counts, and local/remote SHA-256 values.
7. Dry-run gated publish, then promote with `--confirm-release <releaseId>` and
   `--expected-live-sha256` from that dry run.
8. Keep the complete old release for the approved retention period.
9. Verify Finder, map rendering, all known-AOI geographies, unchanged shared
   layers, and browser cache behavior.
10. Roll back with the historical catalog: `--use`, `--catalog`, `--dry-run`,
    then `--confirm-rollback`. Archives without release identity are rejected.

Manifest archives contain JSON references only. They **do not archive the
rasters, COGs, regular/compact metrics, MEC shards, goals, boundaries, or other
bytes referenced by those URLs**. A manifest archive is therefore not a
complete backup and cannot by itself guarantee rollback.

Deleting old objects while an archived or live manifest still references them
converts rollback into broken URLs. Do not delete or quarantine old catalog
assets until inventories, retention, and tested rollback all exist.

## Incremental metric backfill

Known-AOI land-use / add-a-metric backfill lives in this repo as
`data/metrics/python/metrics_pipeline/backfill_land_use_of_aoi.py`. It is a
developer/test path, not a frozen GTIC operator runbook. Do not invent a CLI
recipe here.

GTIC production (`catalog-releases/3.0.5`) compact still lacks
`land_use_*_pct_of_aoi`. Known administrative AOIs (department, municipality,
SIRAP, RUNAP, OMEC) show empty land-use bars (“not available yet”). Drawn
custom polygons already show live CLC land-use bars. Do not fail GTIC UAT for
empty known-AOI land-use on 3.0.5. This branch’s `catalog-releases/3.0.6`
(land-use-aoi-TEST) has the of-AOI fields so known-AOI bars can fill locally;
it is not the GTIC 3.0.5 publish.

Code can reuse solution-level artifacts through `plan_solution_release.py` and
`assemble_solution_release.py` when basename, domain, raster SHA, and input
signatures match. That reuse is not the same as a finished add-one-metric
procedure. Do not run this as the GTIC release path. Point developers at the
metrics README.

## Material-revision replacement checklist

- [ ] The revision has a new, never-reused `solution_id`.
- [ ] Every new raw, COG, metric, metadata, and derived-artifact pathname is
      immutable under `releases/{releaseId}/` and does not overwrite prior bytes.
- [ ] The complete prior package, old ID, metadata, checksums, and catalog
      release are retained.
- [ ] The old-to-new relationship is recorded in supported metadata or release
      documentation without inventing a structured lineage field.
- [ ] The `solution-catalog-v1` file includes the new ID, excludes the retired
      old ID, and preserves unrelated intended IDs.
- [ ] Gated publish used `--catalog`, artifact inventories, `--dry-run`, then
      `--confirm-release` and `--expected-live-sha256`.
- [ ] Rollback was rehearsed with the historical catalog and `--confirm-rollback`.

If any control is missing, stop after preparing the new package and escalate
rather than claiming replacement or retirement.

## Custom-AOI impact

Known AOIs use published per-solution caches. Custom AOIs are different: the
backend currently computes a drawn polygon against shared runtime reference and
metric layers; it does not load the selected solution raster as a
solution-specific calculation input. Adding one new solution package alone
therefore does not require a backend artifact rebuild.

If shared live inputs or the source manifest used by backend artifacts changes,
follow [Metrics and runtime artifacts](./metrics-and-artifacts.md), rebuild the
runtime artifacts, recreate the backend container, and verify `/ready`.
Arbitrary-polygon category-mask behavior remains an engineering concern; do not
claim full known/custom parity without the documented regression checks.

## Rollback

### New solution or catalog promotion

1. Stop further publication and retain failed-run evidence.
2. List manifest archives:

   ```bash
   yarn --cwd frontend rollback:layer-manifest
   ```

3. Dry-run the recorded known-good archive against its historical catalog:

   ```bash
   yarn --cwd frontend rollback:layer-manifest \
     --use <index|pathname|url> \
     --catalog ../path/to/historical-solution-catalog.json \
     --dry-run
   ```

4. Confirm the restore:

   ```bash
   yarn --cwd frontend rollback:layer-manifest \
     --use <index|pathname|url> \
     --catalog ../path/to/historical-solution-catalog.json \
     --confirm-rollback
   ```

5. Refresh the browser and repeat manifest, Finder, map, and known-AOI checks.
6. Retain the new raw and derived objects until the incident and retention
   decision are complete. Their presence is harmless when no live manifest
   references them.

### Material-revision catalog replacement

Restore the complete prior immutable catalog release, including its old
solution ID, manifest, metadata, raw rasters, COGs, regular/compact metrics, MEC,
and goals as applicable; verify remote checksums and refresh clients. The
revised package remains retained but unreferenced. If any old bytes were
overwritten or deleted, policy was violated and rollback cannot be considered
verified.

## Remaining production blockers

- Incremental land-use / add-a-metric backfill (`backfill_land_use_of_aoi.py` on
  this branch) is a developer/test path, not a frozen GTIC operator runbook.
  `catalog-releases/3.0.6` test is not the GTIC 3.0.5 publish.
- COG and some generators still prefer HTTP or `file://` manifests; never
  publish an incomplete catalog to the live pointer as staging.
- Raw solution pair upload outside `upload_solution_sources.py` remains manual
  and not transactional.
- COG generation supports only `scope: "nacional"`, not marine.
- Manifest archives do not preserve referenced bytes.
- Custom-AOI category-mask parity still requires engineering verification.
- SIRAP regional catalogs are out of scope for this runbook.
