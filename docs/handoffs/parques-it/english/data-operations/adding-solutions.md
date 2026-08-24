[← Back to Data Operations](./README.md)

# Adding and replacing solutions

## Purpose and release status

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
catalog release. It does not mean deleting the old ID, package, artifacts,
metadata, or historical releases. That active-catalog replacement step is
**not operator-ready today**. The separate versioned-catalog workflow must be
merged, documented, tested, and rehearsed before handoff use. The current
manifest generator starts from the published catalog and merges discovered
solutions by ID, so IDs absent from Blob discovery remain preserved.

The repository has no verified structured solution-lineage or supersession
field. Until one is implemented and validated, record the human-readable
relationship between old and new IDs in the existing metadata `notes` field
when approved, and in the catalog release documentation and retained operator
reports. Do not invent fields such as `supersedes`, `replaces`, or
`previous_solution_id` and assume runtime tooling will preserve or interpret
them.

The supported one-solution path also depends on a non-live HTTP candidate
manifest. The COG, regular-metrics, and MEC generators fetch a manifest over
HTTP; publishing a base candidate to the production manifest first would expose
deterministic metric and COG URLs before those objects exist. Never use the live
production manifest as staging.

For broader artifact details, see
[Metrics and runtime artifacts](./metrics-and-artifacts.md). For publication and
recovery commands, see
[Publishing and rollback](./publishing-and-rollback.md).

## Scope summary

| Operation                                     | Current status                                    | Important constraint                                                                                                                                                         |
| --------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Add one new solution                          | Supported with controlled staging                 | Package includes a newly assigned immutable ID, artifact paths, metadata, manifest entry, metrics, and provenance; stage through a new, non-live HTTP candidate manifest      |
| Prepare a material revision as a new solution | Supported only as the new-package add             | Never overwrite/reuse the old package or ID; mint a new ID and immutable paths, and record the old-to-new relationship in supported metadata or release documentation         |
| Replace the old revision in the active catalog | Not operator-supported yet                       | Requires a new catalog release that includes the new ID and excludes the old ID while retaining the complete old release; the current generator preserves absent published IDs |
| Retire a solution from the active catalog     | Not operator-supported yet                        | Retirement means exclusion from a new active catalog release, not deleting/reusing its ID, package, metadata, artifacts, or historical releases                              |
| Replace the complete catalog                  | In development — not yet operator-ready           | A separate versioned-catalog replacement workflow must be merged, documented, tested, and rehearsed before handoff use                                                       |
| Build a display COG                           | Supported only when `scope` is exactly `nacional` | The current COG selector does not process marine solutions                                                                                                                   |

## Roles and prerequisites

- **Release operator:** controls Blob writes, candidate publication, and final
  manifest cutover.
- **Data owner or analyst:** approves raster values, metadata, provenance,
  Finder inputs, and scientific meaning.
- **Reviewer:** independently checks reports, URLs, Finder behavior, rendering,
  and metrics.
- **Developer/release engineer:** required for complete-catalog replacement,
  retirement, material-revision active-catalog replacement, MEC/goals
  publication, or a missing staging environment.

Before starting:

1. Work from the repository root with the Python metrics environment and
   frontend dependencies installed.
2. Confirm `BLOB_READ_WRITE_TOKEN` is present in `.env.local`. Never print,
   paste, or record its value.
3. Record the target environment, live manifest URL, exact known-good manifest
   archive, and retained prior artifact reports/directories.
4. Choose a unique candidate pathname such as
   `manifest/candidates/<release-id>.json`. It must not be
   `manifest/manifest.json`.
5. Record source, license, owner, generation time, CRS, resolution, extent,
   data type, value meanings, NoData, and SHA-256 for the source pair.

## Decide whether this is a new solution or a material revision

### New solution

A new solution receives a newly assigned immutable ID. Its complete package
includes the source raster pair, derived artifacts, metadata, manifest entry,
metrics, and provenance as applicable. These paths are not referenced by the
live catalog before final cutover, provided the operator uses new immutable
pathnames and a non-live candidate manifest.

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
  excluding it from that new active release. Preserve historical releases.

The supported procedure below can prepare and add the new package. It cannot
complete active-catalog replacement today because the generator preserves
published IDs that are absent from Blob discovery. Stop before claiming the old
ID is retired; use the separately developed versioned-catalog workflow only
after it has been merged, documented, tested, and rehearsed.

## Supported procedure: add one new solution

The commands below were checked against the current repository CLIs. Replace
all placeholders and retain every generated report.

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

### 2. Stage the raw pair

There is no repository command for uploading a raw solution TIFF and JSON
sidecar. Use the approved manual Vercel Blob procedure and put both files in the
same approved prefix, normally `solutions/nacional/` or `solutions/marine/`.
Use a new immutable pathname for every new package. Never overwrite or reuse an
existing solution pathname.

Retain:

- local and Blob pathnames;
- SHA-256 and byte count for both files;
- operator, UTC timestamp, and target environment;
- public URLs or Blob inventory evidence; and
- confirmation that no unrelated object was overwritten.

### 3. Generate and validate the local base candidate

The npm generator registers marine solutions but not national solutions. Run
the generator directly with both known prefixes:

```bash
node frontend/layer-manifest/generate-manifest.mjs \
  --register-solution-prefix solutions/nacional/ \
  --register-solution-prefix solutions/marine/

npm --prefix frontend run validate:layer-manifest
npm --prefix frontend run test:layer-manifest
```

Review
`development-artifacts/layer-manifest/reports/solutions-reconciliation-report.json`.
The intended ID must appear once in `solutions[]`, not in `skipped` or
`unmatchedRasters`. Check `finderInputs`, `displayUrl`, `metadataUrl`,
`rendering`, and every deterministic `precomputedMetricUrls` value.

This candidate still contains all previously published IDs by design. It is not
evidence that an old ID was retired or that a material revision replaced it in
the active catalog.

### 4. Publish only a non-live HTTP candidate

The downstream COG, regular-metrics, and MEC tools require HTTP input. Publish
the validated local file to a unique candidate pathname:

```bash
npm --prefix frontend run publish:layer-manifest -- \
  --source frontend/public/data/layer-manifest/manifest.json \
  --target manifest/candidates/<release-id>.json \
  --skip-archive
```

Record the URL printed by the command as `<candidate-manifest-url>`. Fetch it
with a cache-busting query and confirm it contains the intended ID.

**Do not target `manifest/manifest.json` in this step.** If policy does not
permit a non-live public candidate URL, stop. The safe alternative is production
tooling that lets every generator consume a local candidate; publishing an
incomplete base manifest live is not an acceptable workaround.

### 5. Optionally build and upload a national display COG

The current COG builder includes only entries whose `scope` is exactly
`nacional`. It does not process marine solutions.

```bash
python data/scripts/solutions-cog/main.py \
  --manifest-url <candidate-manifest-url> \
  --solution-id <solution-id>

npm --prefix frontend run upload:solutions-cogs -- \
  --dry-run \
  --solution-id <solution-id>

npm --prefix frontend run upload:solutions-cogs -- \
  --solution-id <solution-id>
```

Require `data/cog/generated/publish-report.json` to report a valid COG and
`data/cog/generated/upload-report.json` to contain only the intended solution
with no failures.

Create a local final-manifest artifact with the uploaded COG URL, but do not
publish it:

```bash
npm --prefix frontend run publish:solution-cog-manifest -- \
  --manifest-url <candidate-manifest-url>
```

The command prints the generated artifact path under
`frontend/development-artifacts/layer-manifest/publish/`. Record that path as
`<final-candidate-path>`.

For a marine solution, skip this step and use
`frontend/public/data/layer-manifest/manifest.json` as the initial
`<final-candidate-path>`.

### 6. Generate all regular known-AOI metrics for the solution

Validate against the candidate:

```bash
python data/metrics/python/metrics_pipeline/main.py \
  --manifest-url <candidate-manifest-url> \
  --solution-id <solution-id> \
  --validate-only
```

Generate every loaded applicable AOI geography. Do not pass `--national-only`:

```bash
python data/metrics/python/metrics_pipeline/main.py \
  --manifest-url <candidate-manifest-url> \
  --solution-id <solution-id> \
  --output-dir data/metrics/generated/<release-directory> \
  --cache-dir data/metrics/cache/tier1 \
  --force \
  --no-cache
```

`--force` recomputes output; `--no-cache` refreshes downloaded inputs. Do not
substitute `--limit 1`, which selects by catalog order.

Inspect, dry-run, publish, and verify:

```bash
python data/metrics/python/metrics_pipeline/inspect_metrics.py \
  --output-dir data/metrics/generated/<release-directory> \
  --solution-id <solution-id>

python data/metrics/python/metrics_pipeline/publish.py \
  --output-dir data/metrics/generated/<release-directory> \
  --solution-id <solution-id> \
  --dry-run

python data/metrics/python/metrics_pipeline/publish.py \
  --output-dir data/metrics/generated/<release-directory> \
  --solution-id <solution-id>

python data/metrics/python/metrics_pipeline/verify_artifacts.py \
  data/metrics/generated/<release-directory>/publish-report.json
```

The regular output should contain national, departments, municipalities,
SIRAPs, RUNAPs, and OMECs when their pinned boundaries load and the metric
catalog says they apply. Boundary load errors are release failures.

### 7. Build and publish the compact regular cache

Compact output is derived from the inspected regular output:

```bash
python data/metrics/python/metrics_pipeline/compact_metrics.py \
  --input-dir data/metrics/generated/<release-directory> \
  --output-dir data/metrics/generated/<release-directory>-compact

python data/metrics/python/metrics_pipeline/inspect_metrics.py \
  --output-dir data/metrics/generated/<release-directory>-compact

python data/metrics/python/metrics_pipeline/publish.py \
  --output-dir data/metrics/generated/<release-directory>-compact \
  --dry-run

python data/metrics/python/metrics_pipeline/publish.py \
  --output-dir data/metrics/generated/<release-directory>-compact

python data/metrics/python/metrics_pipeline/verify_artifacts.py \
  data/metrics/generated/<release-directory>-compact/publish-report.json
```

Do not add `--release-id` to this one-solution conversion unless a reviewed
partial-release selection contract has been prepared.

### 8. Generate MEC and goals when applicable

MEC applies to land solutions and generates six geography shards:

```bash
python data/metrics/python/metrics_pipeline/mec_compact.py \
  --manifest-url <candidate-manifest-url> \
  --solution-id <solution-id> \
  --force \
  --no-cache
```

Goals can consume the staged HTTP manifest:

```bash
python data/metrics/python/metrics_pipeline/conservation_goals.py \
  --manifest-url <candidate-manifest-url> \
  --solution-id <solution-id> \
  --output-dir data/metrics/generated/goals \
  --force-download
```

**Publication blocker:** MEC and goals generators do not upload. No dedicated,
fully verified publication and manifest-wiring workflow exists. If either
artifact is required, a developer-reviewed manual process must upload exactly
the report pathnames, verify remote bytes, and ensure the final candidate points
to them. Do not claim a complete release from generation alone.

### 9. Validate and perform the final authoritative cutover

Before cutover, confirm every URL in `<final-candidate-path>` already resolves
to verified bytes. If MEC/goals URLs were changed, update and revalidate the
candidate through a developer-reviewed process.

```bash
node frontend/layer-manifest/validate-manifest.mjs \
  <final-candidate-path>

npm --prefix frontend run test:layer-manifest

npm --prefix frontend run publish:layer-manifest -- \
  --source <final-candidate-path>
```

Only this final command may target the production default
`manifest/manifest.json`. It archives the prior live manifest, then replaces
it. Record the archive pathname and published URL.

### 10. Verify and retain the release

- Fetch the live manifest with a cache-busting query and verify one intended ID.
- Confirm Finder inputs and labels.
- Render the raw raster and COG, if applicable.
- Test one known AOI from every applicable geography.
- Load regular, compact, MEC, and goals data as applicable.
- Verify one unchanged solution still loads.
- Retain raw and derived checksums, all reports, local generation directories,
  candidate/final manifests, operator/reviewer names, and UTC timestamps.
- Keep the old objects for the approved retention period. Do not delete them
  merely because a manifest archive exists.
- For a material revision, do not claim replacement or retirement unless the
  new active release excludes the old ID and the complete prior release remains
  retained.

## Not-yet-operator-ready procedure: catalog replacement or retirement

> **Do not execute this as a production runbook yet.** The steps below define
> the target safe workflow, not functionality currently provided by the
> repository. The separately developed workflow must be merged, documented,
> tested, and rehearsed first.

A safe authoritative catalog replacement needs to:

1. Freeze changes and inventory the complete live dependency graph.
2. Archive or copy every old raw TIFF/JSON pair, COG, regular metric, compact
   metric, MEC shard, goals object, metadata file, old solution ID, release
   report, and manifest state to retained immutable locations as one prior
   catalog release.
3. Verify archive byte counts and checksums independently.
4. For every material revision, mint a new solution ID and stage its complete
   package under new immutable pathnames. Never overwrite or reuse an old ID or
   package.
5. Generate an authoritative candidate from only the declared new catalog,
   without merging undeclared published IDs.
6. Generate and verify all COGs, regular metrics, compact metrics, MEC shards,
   and goals against a non-live HTTP candidate or a local-candidate-capable
   toolchain.
7. Prove that every candidate URL resolves and that every intended retirement is
   absent from the new active catalog while its old ID, package, artifacts,
   metadata, and prior release remain intact.
8. Perform one final authoritative manifest cutover after all referenced bytes
   exist.
9. Keep the complete old release for the approved retention period.
10. Verify Finder, map rendering, all known-AOI geographies, unchanged shared
    layers, and browser cache behavior.
11. Roll back by restoring both the old manifest and every referenced old byte
    set, then repeat verification.

Manifest archives contain JSON references only. They **do not archive the
rasters, COGs, regular/compact metrics, MEC shards, goals, boundaries, or other
bytes referenced by those URLs**. A manifest archive is therefore not a
complete backup and cannot by itself guarantee rollback.

Removing old raw pairs before generation does not retire their IDs: the
solution-preservation merge keeps published entries. Deleting old objects while
an archived or live manifest still references them converts rollback into
broken URLs. Do not delete or quarantine old catalog assets until an
authoritative replacement mode, reference inventory, retention decision, and
tested rollback all exist.

## Material-revision replacement checklist

Use the supported add steps to prepare the new package, but do not complete or
claim active-catalog replacement until all controls exist:

- [ ] The revision has a new, never-reused `solution_id`.
- [ ] Every new raw, COG, metric, metadata, and derived-artifact pathname is
      immutable and does not overwrite prior bytes.
- [ ] The complete prior package, old ID, metadata, checksums, and catalog
      release are retained.
- [ ] The old-to-new relationship is recorded in supported metadata or release
      documentation without inventing a structured lineage field.
- [ ] The authoritative candidate includes the new ID, excludes the retired old
      ID, and preserves unrelated intended IDs.
- [ ] The versioned-catalog workflow and rollback have been tested with the
      complete old and new release byte sets.

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

### New solution

1. Stop further publication and retain failed-run evidence.
2. List manifest archives:

   ```bash
   npm --prefix frontend run rollback:layer-manifest
   ```

3. Select and restore the recorded known-good archive:

   ```bash
   npm --prefix frontend run rollback:layer-manifest -- \
     --use <index|pathname|url>
   ```

4. Refresh the browser and repeat manifest, Finder, map, and known-AOI checks.
5. Retain the new raw and derived objects until the incident and retention
   decision are complete. Their presence is harmless when no live manifest
   references them.

### Material-revision catalog replacement

Restore the complete prior immutable catalog release, including its old
solution ID, manifest, metadata, raw rasters, COGs, regular/compact metrics, MEC,
and goals as applicable; verify remote checksums and refresh clients. The
revised package remains retained but unreferenced. If any old bytes were
overwritten or deleted, policy was violated and rollback cannot be considered
verified.

### Complete catalog

Rollback is blocked until a complete old byte set and tested authoritative
catalog workflow exist. Do not infer recoverability from manifest archives.

## Remaining production blockers

- No authoritative solution-catalog replacement or retirement mode.
- No tested atomic catalog-wide cutover.
- The generator preserves published IDs absent from discovery, so a material
  revision can be added under a new ID but cannot yet retire/replace the old ID
  through the operator procedure.
- COG and regular/MEC generators need HTTP manifests; safe operation depends
  on a non-live candidate URL until local-candidate support is added.
- Full immutable release mode requires the complete fixed-size catalog.
- MEC and goals publication/wiring remain manual and incomplete.
- Raw solution pair upload is manual and not transactional.
- There is no automatic complete-package archive for prior catalog releases.
- COG generation supports only `scope: "nacional"`, not marine.
- Manifest archives do not preserve referenced bytes.
- Custom-AOI category-mask parity still requires engineering verification.
