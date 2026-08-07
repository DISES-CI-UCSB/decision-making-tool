# v0.2 Solution Release Operations Log

This append-oriented log records operational work for the v0.2 solution release:
what ran, why it ran, how long it took, its outcome, and lessons for later
release work. Entries should be preserved as durable release history rather
than rewritten as a task tracker.

All dates and times are US Eastern. Timelines distinguish single command runs
from periods containing multiple commands, investigation, or corrections.

## Cold frozen-v3 signature and inventory rebuild

- **What:** Rebuilt proof-of-input and provenance identities, not metrics.
- **Why:** The provenance/signature contract changed to v3, and the approved
  two-species exception needed to be bound into the frozen artifacts. Existing
  signatures could not certify the new frozen inputs.
- **How:** Inspected the exact solution rasters, 8,298 available species
  rasters, other metric layers, canonical grid and alignment policy, catalog,
  and approved exception. The process validated and cached aligned inputs,
  checksummed them, and combined the results into deterministic per-solution
  signatures and the release inventory.
- **Why it took about two hours:** The cost was cold geospatial I/O and
  validation across thousands of rasters, not SHA computation. Later warm
  full-land repeats took 3–5 minutes, while comparisons took under one minute.

## Timeline

### Wednesday, August 5, 2026

- **10:02:45–10:03:10 AM (25s):** Validated the frozen release's exact species
  inputs.
- **10:03:57–10:07:19 AM (3m22s):** Validated all species on the land grid.
- **10:09:11 AM–11:58:23 AM (1h49m12s):** Completed final frozen species
  validation.
- **11:59:05 AM–12:03:23 PM (4m18s):** Repeated frozen species validation with
  warm caches.
- **12:37:40–12:41:54 PM (4m14s):** Replayed validation only against warm
  caches.
- **12:48:09–2:44:48 PM (1h56m39s):** Regenerated the frozen v3 release
  signatures.
- **2:44:55–2:46:51 PM (1m56s):** Bound the approved species exception into
  the frozen v3 artifacts.
- **3:45:32–4:06:47 PM (21m16s):** Uploaded 344 immutable source artifacts.
- **4:07–4:38 PM:** Ran scientific smoke tests and made corrections through
  multiple commands and review steps; this was not one continuous command.
- **8:47:34–8:49:30 PM (1m56s):** Generated regular metrics for all four marine
  solutions with zero failures.
- **8:49:50 PM–Thursday 8:28:25 AM (11h38m35s):** Ran the initial two-worker
  terrestrial regular-metrics pass. It retained 96 canonical caches and
  rejected 72 under the then-incomplete species-target validation.

### Thursday, August 6, 2026

- **8:39–9:56 AM:** Performed dual-reference and per-species smoke
  certification through multiple commands.
- **9:09:06–9:13:26 AM (4m20s):** Generated a representative scalar input
  signature.
- **9:13:51–9:16:52 AM (3m01s):** Generated current signatures only for all
  land solutions.
- **9:58:32–10:03:55 AM (5m24s):** Generated full-land signatures as cache
  proof.
- **10:04:09–10:04:55 AM (46s):** Verified scalar worker signatures.
- **10:22:39–10:23:15 AM (36s):** Compared existing worker signatures.
- **10:40:38 AM–3:43:36 PM (5h03m):** Resumed the remaining 72 terrestrial
  regular metrics using cache, with zero failures.
- **3:43–3:48 PM (~5m):** Merged 172 regular metric documents and corrected
  domain validation.
- **4:02–4:03 PM (~1m):** Generated 172 conservation-goal sidecars. They were
  later regenerated after the binding fix in another run of about one minute.
- **4:19:47–4:30:32 PM (10m45s):** Compacted 15,076,636,845 bytes to
  3,901,777,940 bytes, a 0.2588 ratio.
- **4:31:11–5:39:21 PM (1h08m10s):** Started MEC v2 generation for 168 land
  solutions across six geographies, totaling 1,008 detailed artifacts. An
  internet outage stopped the run after 31 solutions and 186 artifacts. The
  completed artifacts remained cached.
- **10:58:40 PM–Friday 3:58:13 AM (4h59m33s):** Confirmed Blob connectivity
  and resumed MEC v2 from solution 32 without recalculating the 186 cached
  artifacts. The resumed run completed all 1,008 MEC artifacts with zero
  failures.

### Friday, August 7, 2026

- **10:29:52–10:31:27 AM (1m35s):** Regenerated all 172 conservation-goal
  sidecars after the feature-type classification fix, with zero failures. The
  run reused the already-cached summary CSVs, so the cost was parsing the
  480 MB preflight manifest rather than downloading sources.
- **10:31–10:34 AM:** Confirmed every regenerated document satisfies the goals
  completeness contract and inspected before/after classification counts.
- **10:34:38–10:41:48 AM (7m10s):** Uploaded 172 corrected goal sidecars
  (126,363,256 bytes) to the new `goals/v2` immutable directory with zero
  failures. The already-published `goals/` directory was left untouched.
- **10:42:00–10:43:15 AM (1m15s):** Verified all 172 published artifacts
  remotely; every checksum, content type, and cache header matched.
- **10:42:50 AM (~2s):** Rebuilt the local compact runtime manifest. Only the
  172 `precomputedMetricUrls.goals` values changed.

## Artifact taxonomy

- **Signatures and provenance identities:** Deterministic evidence describing
  exactly which source inputs, policies, catalog state, and approved exceptions
  a solution release used. They certify inputs; they are not metric results.
- **Regular verbose metric documents:** Full standard metric outputs for each
  solution, retaining detailed values and supporting metadata.
- **Compact metrics:** Size-reduced representations of regular metrics intended
  for efficient delivery and consumption.
- **Conservation-goal sidecars:** Separate artifacts that bind
  conservation-goal information to the corresponding solution outputs.
- **MEC v2 detailed ecosystem sidecars:** Geography-specific detailed ecosystem
  artifacts generated for each land solution under the MEC v2 contract.

## Operational lessons

- Cold validation time is dominated by opening, aligning, and validating
  thousands of geospatial rasters. Warm caches make signature regeneration and
  comparison dramatically faster.
- Validation rules must be complete before distributed metric runs begin;
  incomplete species-target validation caused 72 otherwise resumable land
  outputs to be rejected.
- Approved exceptions must be bound into provenance artifacts before dependent
  sidecars are finalized, or those sidecars require regeneration.
- Status language must remain precise: say **all regular metric documents
  complete** until MEC generation and release packaging are also finished.
- A renamed upstream column can pass every structural contract while silently
  emptying a semantic one. Diagnostics that count raw source values are what
  make that visible, so they must read the source through the same helper the
  classifier uses.
- Artifact URLs frozen into the preflight manifest cannot be corrected without
  regenerating a 480 MB input, so the runtime manifest builder now rebinds them
  from the release contract at build time.

## Conservation-goal feature-type regression and goals/v2 republish

- **What:** Repaired conservation-goal feature classification for the v0.2
  release and republished all 172 goal sidecars to a new immutable directory.
  Metrics, compact metrics, and MEC artifacts were not affected or reissued.
- **Why:** The v0.2 summary CSVs renamed the feature-type column from `type`
  to `feature_type` and introduced the two-word value `strategic ecosystem`.
  The classifier only read `type`, so every land feature fell through to
  `other`: species, ecosystem, and strategic-ecosystem rollups were all zero,
  the Conservation Target Progress widget reported that no target was
  configured, and no species goal detail was ever computed.
- **How:** One shared helper now resolves the declared type from whichever
  column a CSV carries, so the `rawTypeCounts` diagnostic and the classifier
  cannot disagree. A declared type is authoritative; the
  `STRATEGIC_ECOSYSTEM_FEATURES` name lookup remains the fallback that keeps
  the older `type`-column exports classifying exactly as before. Land
  summaries that declare neither column now raise instead of yielding an
  all-`other` document. Marine summaries carry no feature-type column at all,
  so the marine domain short-circuit is still required and stayed in place.
- **Outcome:** Across the 172 documents, species rows went from 0 to 122,246
  and ecosystem rows from 297 to 41,877, leaving 270 `other` rows that are
  fully accounted for: 192 declared `ecosystem service` and 78 taxon-class
  representation rows that upstream marks `NA`. Strategic ecosystems held at
  494 because the name fallback had always caught them.
- **Where:** Corrected sidecars live at
  `releases/solutions-v0-2-0-20260805/goals/v2/`, added to the release contract
  alongside the existing `mec/v2` precedent. The original `goals/` directory
  remains published and byte-identical, and production still serves the
  108-solution `sirap-polygon-v2-20260727` release.
- **Residual data gap:** 3,791 species rows declare the taxon classes
  `Magnoliopsida_1` and `Magnoliopsida_2`, which the class-to-group table does
  not recognise. Those rows count toward species and IUCN totals but are absent
  from the plants taxon rollup. This is an upstream class-naming question, not
  a classification defect, and was deliberately left unchanged.

## Backend custom-AOI artifact cutover runbook for solutions-v0-2-0-20260805

Prepared Friday, August 7, 2026, 11:00 AM–12:00 PM Eastern. Investigation only;
nothing in this section has been executed. The live VM service was read but not
restarted, rebuilt, or reconfigured, and `manifest/manifest.json` on Blob was
not touched.

- **What:** A measured, copy-pasteable procedure for moving the custom-AOI
  backend on `107.170.64.162` from the 104-solution artifact
  `colombia-custom-aoi-v1-20260730T195223Z` to a new artifact built against the
  172-solution `solutions-v0-2-0-20260805` runtime manifest.
- **Why:** `backend/scripts/build_runtime_artifact.py` bakes the valid solution
  registry into the runtime artifact at build time and the backend loads it
  once at process startup. Building the backend artifact against a **staged**
  manifest URL before the production manifest pointer is flipped removes the
  window in which `POST /area-profile/custom-polygon` would answer
  `solution_not_registered` for a solution the frontend already offers.
- **Baseline captured before any change:** `GET /ready` reports
  `artifact_version: colombia-custom-aoi-v1-20260730T195223Z`, `manifest_path:
  /backend/runtime-artifacts/releases/colombia-custom-aoi-v1-20260730T195223Z/manifest.json`,
  `registered_solution_count: 104`, `warmup_ms: 15294`, 15 raster layers, and 6
  species matrices. A 493 km² test polygon near Bogotá returns HTTP 200 with no
  `solution_id` (576 selected cells) and HTTP 400
  `solution_not_registered:eco17_runap_omec_iheh2022` with the new id.

### Blocking prerequisite: the v0.2 land rasters are on a different grid

This is the most important finding and it gates the whole cutover. Registration
is not the only check the backend performs. `RuntimeSolutionRegistry.load`
compares each solution raster's fingerprint against the reference grid and
raises `solution_raster_grid_mismatch`, which
`backend/app/main.py` maps to HTTP **503**, not 400.

- Reference grid (`inputs/features/ecosystems/ecosistemas.tif`, unchanged
  between the production and candidate manifests): 1497 × 2069, EPSG:4326,
  30 arc-second cells.
- Production `sirap-polygon-v2-20260727` land rasters under
  `solutions/nick-runs/2026-05-27/`: 1497 × 2069, EPSG:4326. They match.
- Candidate `solutions-v0-2-0-20260805` land rasters under
  `releases/solutions-v0-2-0-20260805/solutions/land/`: 1353 × 1838,
  EPSG:9377, 1000 m cells. Verified on three separate rasters
  (`Eco17+RUNAP+OMEC_IHEH2022.tif`, `Eco17+Estr17+EspRep17+RUNAP_IHEH2022.tif`,
  `Eco30+RUNAP+OMEC_IHEH2030.tif`); the mismatch is systematic, not a one-off.
- A folded listing of `releases/solutions-v0-2-0-20260805/solutions/` contains
  only `land/` and `marine/`. No reprojected EPSG:4326 variant is published.

Consequence: performing this cutover as written raises
`registered_solution_count` from 104 to 168 and changes the failure for a v0.2
solution id from HTTP 400 `solution_not_registered` to HTTP 503
`solution_raster_grid_mismatch`. It does **not** produce HTTP 200. Reaching 200
requires publishing EPSG:4326 / 1497 × 2069 copies of the 168 land rasters and
rebinding `displayUrl` to them, or re-basing the entire backend reference grid
(15 layers plus the species bitset) onto EPSG:9377. The first is the tractable
option and is a separate work item. Stage 2 below is a hard gate that fails
loudly on this condition rather than discovering it after a restart.

### Measured rebuild cost

- **Sources the builder downloads:** 21 unique URLs totaling **236,467,452
  bytes (236.5 MB)**, every one confirmed HTTP 200 by `curl -sSI`. Broken down:
  12 raster layer files at 70,986,299 bytes, 6 species sparse matrices at
  164,157,942 bytes (of which `species_plants.smtx.gz` alone is 126,093,151),
  and the 3-file MEC ecosystem bundle at 1,323,211 bytes. Fifteen raster layer
  specs collapse to twelve downloads because `ecosistemas` is reused as the
  reference grid, `boundaries/coberturas.tif` serves three layer views, and
  `inputs/includes/runap_protected_areas.tif` serves two.
- **Nothing is reused under `--immutable-release`:** `download_source` returns
  early only when `target.exists()`, and with `--immutable-release` the build
  writes into a brand-new `.{version}.partial` directory, so `sources_dir` is
  empty and all 21 files are fetched. The 3 MEC files are fetched with
  `force=True` regardless of that.
- **Species bitset is the dominant cost, not the network.**
  `build_species_bitset` allocates a `(2,922,377 × 1038)` uint8 memmap,
  zero-fills it, then performs 8,298 fancy-indexed OR passes over it — one per
  species — before flushing. `ceil(8298 / 8) = 1038` bytes per cell gives
  exactly 3,033,427,326 bytes, matching the file on disk byte for byte. The
  aggregate manifest checksum then reads all 3.03 GB back through SHA-256.
- **Empirical anchor:** file mtimes inside the existing
  `colombia-custom-aoi-v1-20260730T195223Z` release show a complete
  `--immutable-release` build on the development laptop taking **1m46s**:
  19 s of downloads plus hashing, 85 s of bitset construction, and 2 s for the
  MEC bundle, the 3 GB aggregate hash, and the manifest write.
- **VM estimate: 4 to 10 minutes**, expect roughly 5. Network portion assumes
  50–200 Mbit/s effective from the Blob CDN to the droplet, giving 9–38 s for
  236.5 MB; budget 15–60 s across 21 separate TLS fetches. Bitset construction
  is memory- and disk-bound and the droplet has 7.756 GiB RAM, so the 3 GB
  memmap stays resident but must still flush to slower block storage; at 2–5×
  the laptop it lands at 3–7 minutes. Hashing 3.27 GB adds 5–20 s. Treat 20
  minutes as the point to investigate rather than keep waiting. The observed
  15.3 s `warmup_ms` measures artifact **load**, not build, and is not a useful
  proxy for either.
- **Disk:** each immutable release costs about 3.3 GB, 3.03 GB of which is the
  bitset. Keeping the old release for rollback means needing roughly 6.6 GB
  total.

### Chosen rebuild path: A, `--immutable-release`

Option B, an in-place build into `runtime-artifacts/manifest.json`, is rejected.

- It is barely faster. Reusing a populated `runtime-artifacts/sources/` skips
  only the download phase, which is 19 s of a 106 s build. Reused files are
  still SHA-256'd, the MEC bundle is re-downloaded unconditionally, and
  `build_species_bitset` has no skip path at all, so the 3 GB rebuild that
  dominates the runtime happens either way. The shared `sources/` tree has no
  `species-bitset/` subdirectory to reuse in the first place.
- It is not safe. `download_source(force=False)` silently pairs whatever
  happens to be on disk with a fresh manifest and records only the checksum of
  what it found, so a stale source is baked in undetected. The builder's own
  comment above the MEC loop names this hazard. It also writes non-atomically
  with no prior copy to revert to.
- It would not even be picked up. The live process reads
  `DMT_ARTIFACT_MANIFEST`, currently pointing under `releases/`, so an in-place
  build still requires an environment change to activate — the same step as
  option A, minus the rollback safety.

Option A writes into `.{version}.partial` and only renames it into
`releases/{version}/` after the manifest is written, so a failed or
interrupted build cannot corrupt anything the live process reads.

### Activation mechanism

There is no symlink, no `latest` pointer, and no activation script anywhere in
the repository; a search for `immutable` matches only the builder's own
argparse definition, and `backend/README.md` documents solely the
non-immutable flow. Activation is exactly two things:

1. `backend/app/config.py` reads `DMT_ARTIFACT_MANIFEST`, defaulting to
   `${DMT_ARTIFACT_DIR}/manifest.json`, and `backend/docker-compose.yml` passes
   it through as `${DMT_ARTIFACT_MANIFEST:-/backend/runtime-artifacts/manifest.json}`.
   Because the live service reports a `releases/...` path, that variable is
   already being supplied from outside Compose — either from `backend/.env`,
   which Compose auto-loads from the compose file's own directory, or inline on
   the last `up`. Stage 0 determines which.
2. The container must be **recreated**, not restarted. `docker compose restart`
   reuses the container's baked-in environment and would silently keep loading
   the old artifact. `docker compose up -d --force-recreate` re-reads Compose
   and the environment.

`./runtime-artifacts` is a read-only bind mount rather than a baked image
layer, so a new `releases/<version>/` directory created on the host is visible
inside the container immediately. The build must run on the host, not in the
container, because the mount is `:ro`.

### The VM does not need a `git pull`

The backend source is unchanged by this release and the image is not rebuilt,
so no `--build` flag appears anywhere below. On the host side, the builder
imports five modules from the metrics pipeline. Diffed against the release
worktree: `solution_domain.py` and `sparse/species_bitset.py` are identical;
`blob_manifest.py` differs only by an added `file://` branch and a
`solution_blob_basename` extension change, neither of which the builder's HTTPS
path touches; `species_data.py` only adds an unused function; and
`metric_definitions.py` changes one `source_note` string. The older
`blob_manifest.py` was run directly against the candidate manifest and resolved
exactly 168 land solutions, so the deployed pipeline parses the new release
correctly as-is. Stage 2 re-proves this on the VM itself, which is the check
that actually matters since the VM's commit is not known from here.

### Stage 0 — Discover the deployment and record the baseline

Run on the VM. Every later stage reuses these variables, so stay in one shell.

```bash
ssh root@107.170.64.162

CONTAINER="$(docker ps --filter publish=8000 --format '{{.Names}}' | head -1)"
COMPOSE_DIR="$(docker inspect "$CONTAINER" \
  --format '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}')"
REPO_ROOT="$(dirname "$COMPOSE_DIR")"
COMPOSE_FILE="$COMPOSE_DIR/docker-compose.yml"
echo "container=$CONTAINER compose_dir=$COMPOSE_DIR repo_root=$REPO_ROOT"

# How is DMT_ARTIFACT_MANIFEST currently supplied? Only artifact vars are shown
# so that DMT_OPS_TOKEN is never printed.
docker inspect "$CONTAINER" --format '{{range .Config.Env}}{{println .}}{{end}}' \
  | grep '^DMT_ARTIFACT'
grep '^DMT_ARTIFACT' "$COMPOSE_DIR/.env" 2>/dev/null \
  || echo 'no backend/.env; the value was passed inline on the last up'

cd "$REPO_ROOT"
git rev-parse --short HEAD && git status --short | head
df -h "$COMPOSE_DIR"          # need ~3.3 GB free, ~6.6 GB to keep both releases
ls -1d "$COMPOSE_DIR"/runtime-artifacts/releases/*/
curl -sS http://127.0.0.1:8000/ready | head -c 400; echo
```

Expected: the inspect output contains
`DMT_ARTIFACT_MANIFEST=/backend/runtime-artifacts/releases/colombia-custom-aoi-v1-20260730T195223Z/manifest.json`
and `DMT_ARTIFACT_REQUIRED=true`, and the releases listing contains that one
directory. Stop and reassess if free space is under 4 GB.

### Stage 1 — Publish the candidate manifest to a staged Blob path

Run on the development machine in the release worktree, not on the VM. The
staged path is `manifest/candidates/solutions-v0-2-0-20260805.manifest.json`,
which is currently empty and is not read by any deployed client. Production
`manifest/manifest.json` is never an argument here.

`frontend/layer-manifest/publish-manifest.mjs` accepts `--target`, but it is
the wrong tool for staging: it also writes an immutable
`manifest/releases/<releaseId>/revisions/<sha256>.json` blob as a side effect,
demands `--catalog`, `--artifact-inventory`, and
`--confirm-create-first-pointer`, and uses `allowOverwrite: false`, so a
regenerated candidate could not replace a stale staged copy. The Vercel CLI
does the staging in one idempotent command.

```bash
cd /Users/woverbyethompson/Documents/SpatialLab/DISES/branch-1/decision-making-tool-solution-release

npm --prefix frontend run generate:release-layer-manifest

set -a && source .env.local && set +a
vercel blob put frontend/public/data/layer-manifest/manifest.json \
  --rw-token "$BLOB_READ_WRITE_TOKEN" \
  --pathname manifest/candidates/solutions-v0-2-0-20260805.manifest.json \
  --content-type application/json \
  --cache-control-max-age 60 \
  --force
```

Confirm the staged copy is byte-identical to the local build and that the
production pointer is untouched:

```bash
STAGED_URL=https://aagibolq28slyfof.public.blob.vercel-storage.com/manifest/candidates/solutions-v0-2-0-20260805.manifest.json

curl -sS "$STAGED_URL?v=$(date +%s)" | shasum -a 256
shasum -a 256 frontend/public/data/layer-manifest/manifest.json

curl -sSI https://aagibolq28slyfof.public.blob.vercel-storage.com/manifest/manifest.json \
  | grep -i -E '^(HTTP|last-modified|etag)'
```

The two hashes must match. The production manifest's `last-modified` must be
unchanged from before this stage.

### Stage 2 — Preflight the staged manifest on the VM (hard gate)

Run on the VM, in the shell from Stage 0. This parses the staged URL with the
VM's own pipeline code and checks the grid contract that the runtime registry
will enforce. Do not proceed to Stage 3 unless the last line reads
`PREFLIGHT OK`.

```bash
cd "$REPO_ROOT"
STAGED_URL=https://aagibolq28slyfof.public.blob.vercel-storage.com/manifest/candidates/solutions-v0-2-0-20260805.manifest.json

STAGED_URL="$STAGED_URL" backend/.venv/bin/python - <<'PY'
import os, pathlib, sys, tempfile, urllib.request
sys.path.insert(0, str(pathlib.Path("data/metrics/python/metrics_pipeline").resolve()))
import rasterio
from blob_manifest import fetch_manifest
from raster_metrics import RasterFingerprint, read_solution_raster

manifest = fetch_manifest(os.environ["STAGED_URL"])
land = manifest.national_solutions
print("public_blob_host        :", manifest.public_blob_host)
print("land solutions to register:", len(land))
print("land + marine in manifest :", len(manifest.batch_solutions))
assert len(land) == 168, "expected 168 land solutions"

reference = manifest.layers_by_id["ecosistemas"]["displayUrl"]
for layer_id in ("ecosistemas", "paramos", "bosque_seco", "wetlands",
                 "mangroves", "resguardos", "comunidades"):
    assert manifest.layers_by_id.get(layer_id, {}).get("displayUrl"), layer_id
print("all builder layers present: yes")

work = pathlib.Path(tempfile.mkdtemp())
urllib.request.urlretrieve(reference, work / "reference.tif")
with rasterio.open(work / "reference.tif") as dataset:
    t = dataset.transform
    grid = RasterFingerprint(
        width=dataset.width, height=dataset.height,
        transform=(t.a, t.b, t.c, t.d, t.e, t.f),
        crs=str(dataset.crs) if dataset.crs else None,
    )
print("reference grid          :", grid.width, grid.height, grid.crs)

bad = []
for solution in land[:5]:
    target = work / "solution.tif"
    urllib.request.urlretrieve(solution["displayUrl"], target)
    raster = read_solution_raster(target)
    ok = raster.fingerprint.matches(grid)
    print(f"  {solution['id'][:44]:<44} {raster.fingerprint.width}x"
          f"{raster.fingerprint.height} {raster.fingerprint.crs} match={ok}")
    if not ok:
        bad.append(solution["id"])
if bad:
    raise SystemExit(
        "PREFLIGHT FAILED: solution rasters do not match the reference grid. "
        "Registering them would turn HTTP 400 solution_not_registered into "
        "HTTP 503 solution_raster_grid_mismatch. Publish EPSG:4326 1497x2069 "
        "rasters and rebind displayUrl before cutting over."
    )
print("PREFLIGHT OK")
PY
```

As of August 7 this gate **fails**, for the reason given in the blocking
prerequisite above. That is the correct outcome and the cutover should stop
here until reprojected land rasters exist.

### Stage 3 — Build the new immutable release

Run on the VM. Nothing here touches the running service.

```bash
cd "$REPO_ROOT"
time backend/.venv/bin/python backend/scripts/build_runtime_artifact.py \
  --immutable-release \
  --manifest-url "$STAGED_URL"
```

Expect `Release built but not activated.` followed by `Wrote runtime artifact
manifest: .../releases/colombia-custom-aoi-v1-<timestamp>/manifest.json`, and
`Downloaded/reused files: 23`. Then capture and inspect the new release before
activating anything:

```bash
NEW_VERSION="$(ls -1dt "$COMPOSE_DIR"/runtime-artifacts/releases/*/ \
  | head -1 | xargs basename)"
NEW_MANIFEST_HOST="$COMPOSE_DIR/runtime-artifacts/releases/$NEW_VERSION/manifest.json"
NEW_MANIFEST_CONTAINER="/backend/runtime-artifacts/releases/$NEW_VERSION/manifest.json"
echo "$NEW_VERSION"

NEW_MANIFEST_HOST="$NEW_MANIFEST_HOST" backend/.venv/bin/python - <<'PY'
import json, os
manifest = json.load(open(os.environ["NEW_MANIFEST_HOST"]))
print("artifact_version :", manifest["artifact_version"])
print("solution_rasters :", len(manifest["solution_rasters"]))
print("raster_layers    :", len(manifest["raster_layers"]))
print("species_matrices :", len(manifest["species_matrices"]))
print("source manifest  :", manifest["source_manifest"]["url"])
assert len(manifest["solution_rasters"]) == 168
assert len(manifest["raster_layers"]) == 15
PY

du -sh "$COMPOSE_DIR/runtime-artifacts/releases/$NEW_VERSION"
```

The source manifest URL must be the staged candidate URL, not
`manifest/manifest.json`. If it is the production URL, the `--manifest-url`
argument was dropped; delete the release directory and rebuild.

### Stage 4 — Activate and recreate the container

Run on the VM. This rewrites only the two artifact variables in
`backend/.env`, preserving anything else in that file, and keeps a timestamped
backup.

```bash
cd "$COMPOSE_DIR"
touch .env
cp .env ".env.bak.$(date -u +%Y%m%dT%H%M%SZ)"

grep -v -E '^(DMT_ARTIFACT_MANIFEST|DMT_ARTIFACT_REQUIRED)=' .env > .env.next
printf 'DMT_ARTIFACT_REQUIRED=true\nDMT_ARTIFACT_MANIFEST=%s\n' \
  "$NEW_MANIFEST_CONTAINER" >> .env.next
mv .env.next .env
grep '^DMT_ARTIFACT' .env

docker compose -f "$COMPOSE_FILE" up -d --force-recreate
```

No `--build`. The image is unchanged and rebuilding it would add several
minutes and a new failure surface for no benefit.

### Stage 5 — Verify

Run on the VM. Warmup measured 15.3 s on the current artifact and will be
similar or slightly longer with 168 registry entries, so poll rather than
querying once.

```bash
for attempt in $(seq 1 24); do
  code="$(curl -sS -o /tmp/ready.json -w '%{http_code}' http://127.0.0.1:8000/ready || true)"
  echo "attempt $attempt: HTTP $code"
  [ "$code" = "200" ] && break
  sleep 5
done

backend/.venv/bin/python - <<'PY'
import json
state = json.load(open("/tmp/ready.json"))["artifact_state"]
print("artifact_version :", state["artifact_version"])
print("manifest_path    :", state["manifest_path"])
print("warmup_ms        :", state["warmup_ms"])
registry = state["metadata"]["solution_registry"]
print("registered_solution_count:", registry["registered_solution_count"])
assert registry["registered_solution_count"] == 168, "expected 168"
print("READY OK")
PY
```

Then the request that motivated the whole cutover. It currently returns HTTP
400 `solution_not_registered:eco17_runap_omec_iheh2022`; after a correct
cutover it must return HTTP 200. The first call for any solution downloads and
caches its raster, because the registry cache key includes the artifact
version, so allow a few seconds.

```bash
curl -sS -o /tmp/profile.json -w 'HTTP %{http_code}  %{time_total}s\n' \
  -X POST http://127.0.0.1:8000/area-profile/custom-polygon \
  -H 'content-type: application/json' \
  -d '{"geometry":{"type":"Polygon","coordinates":[[[-74.10,4.50],[-73.90,4.50],[-73.90,4.70],[-74.10,4.70],[-74.10,4.50]]]},"sections":["species","ecosystems"],"solution_id":"eco17_runap_omec_iheh2022"}'
head -c 500 /tmp/profile.json; echo
```

Read the failure modes precisely. HTTP 400 `solution_not_registered` means the
artifact was built against the production manifest rather than the staged one.
HTTP 503 `solution_raster_grid_mismatch` means the Stage 2 gate was skipped and
the reprojection prerequisite is still outstanding. HTTP 503
`solution_raster_download_failed` means the raster URL is unreachable from the
VM. Finally confirm the public route:

```bash
curl -sS https://api.decision-making-support-tool.xyz/ready \
  | head -c 200; echo
```

### Stage 6 — Roll back

The previous release directory is never touched by a new build. `main()` only
creates `releases/<new-version>/` by renaming its own `.partial` directory, and
nothing in the builder deletes or rewrites older releases, so
`colombia-custom-aoi-v1-20260730T195223Z` remains byte-identical on disk.
Rollback is an environment change plus a recreate, roughly 30 seconds to a
ready service.

```bash
cd "$COMPOSE_DIR"
grep -v -E '^DMT_ARTIFACT_MANIFEST=' .env > .env.next
echo 'DMT_ARTIFACT_MANIFEST=/backend/runtime-artifacts/releases/colombia-custom-aoi-v1-20260730T195223Z/manifest.json' >> .env.next
mv .env.next .env
docker compose -f "$COMPOSE_FILE" up -d --force-recreate

sleep 25
curl -sS http://127.0.0.1:8000/ready \
  | grep -o '"registered_solution_count": *[0-9]*'
```

Expect `104`. No Blob state needs reverting: production
`manifest/manifest.json` is never modified by this procedure, so the frontend
continues serving `sirap-polygon-v2-20260727` throughout and is unaffected by
a backend rollback.

### Stage 7 — Cleanup, only after a successful soak

Deleting the old release forfeits the cheap rollback, so leave it in place
until the new artifact has served real traffic for at least a day.

```bash
rm -rf "$COMPOSE_DIR/runtime-artifacts/releases/colombia-custom-aoi-v1-20260730T195223Z"
find "$COMPOSE_DIR/runtime-cache/solutions" -type f -mtime +7 -delete
```

- **Operational lessons from preparing this runbook:** Registration and
  usability are separate contracts. Counting registry entries would have
  reported a clean 168-solution cutover while every request still failed, so
  the grid fingerprint the runtime enforces has to be asserted in preflight
  against the same reference raster the artifact will load. Build cost is also
  worth measuring rather than assuming: the network is 236 MB and under a
  minute, while the 3.03 GB species bitset is roughly 80% of the wall clock,
  which is exactly why the "faster" in-place build saves almost nothing and
  gives up atomic swap and rollback to do it.

## Conservation-goal taxon classification and goals/v3 republish

Friday, August 7, 2026, 11:05 AM–11:35 AM Eastern. This closes the residual
data gap recorded against `goals/v2` earlier the same day. Metrics, compact
metrics, and MEC artifacts were not affected or reissued, and production still
serves the 108-solution `sirap-polygon-v2-20260727` release.

- **What:** Resolved each species row's taxon group from the authoritative
  species catalog instead of the summary CSV's `class` string, and republished
  all 172 goal sidecars to a new immutable `goals/v3` directory.
- **Why:** The v0.2 summary CSVs report the plant class in solver batches named
  `Magnoliopsida_1` and `Magnoliopsida_2`. Those names are batching artifacts
  with no taxonomic meaning, but the class-to-group table only knew
  `Magnoliopsida`, so 3,791 species rows across 96 of the 169 terrestrial
  summaries counted toward species and IUCN totals while vanishing from the
  Plants rollup.
- **How:** The species catalog is now authoritative for taxonomy. Every species
  row already looked up its catalog record for IUCN status, so
  `GoalSpeciesRecord` gained a `taxon_group` resolved at catalog load time and
  the classifier reads it from there. The CSV `class` remains the fallback for
  rows with no catalog match, with any trailing `_<digits>` batch suffix
  stripped so the fallback is correct too. The single class-to-bucket table now
  lives in `species_taxonomy`, which has no geospatial imports, and
  `species_data`, `summary_species_coverage`, `calculators/species`, and
  `conservation_goals` all consume it rather than keeping private copies.
- **Outcome:** Zero unresolved taxon rows remain across all 172 documents. The
  Plants rollup rose from 103,056 to 106,847 species rows, exactly the 2,615
  `Magnoliopsida_1` plus 1,176 `Magnoliopsida_2` rows that had been dropped.
  Total species rows, IUCN totals, and every non-plant taxon are unchanged.
  Marine documents are byte-identical apart from `generatedAt`.
- **Where:** Corrected sidecars live at
  `releases/solutions-v0-2-0-20260805/goals/v3/`. The published `goals/` and
  `goals/v2` directories were left untouched and `goals/v2` is now orphaned,
  which is expected.

### Tier-1 species metrics were confirmed unaffected before publishing

`species_groups_protected` and `threatened_species_secured` never read the
summary CSV in this pipeline. `summary_species_coverage` is reachable only
through `_compute_metadata_coverage`, which fires only for metric kind
`metadata_coverage`; no definition in `metric_definitions` declares that kind,
and the only declaration anywhere is in the unrelated legacy
`data/scripts/tier1-metrics` tree. The live metrics come from
`calculators/species`, which buckets by `SpeciesRecord.bucket` off the catalog.
Scanning all 172 published verbose documents found zero metrics sourced from a
summary CSV; every species metric reports
`csv:biomod_spp_ranges_updatedIUCN+raster:species_ranges`,
`manifest:finderInputs.structuredTargets`, `raster:boundary_mask`, or `n/a`.
The duplicated table in `summary_species_coverage` was therefore dead rather
than wrong; it was folded into the shared module but its CSV reading and
`type`-only column filter were deliberately left alone.

### Contract key naming

A third goals version made `goalsV2Directory` an actively misleading key name.
The key is now version-agnostic and its **value** carries the version:
`goalsCurrentDirectory: "goals/v3"`, with `goals_current_directory` on
`ReleaseConfig`. All four resolving surfaces moved together — `release_config`,
`prepare_solution_release`, `assemble_solution_release`, and
`lib/metric-urls.mjs` — and the Python/JSON parity test still asserts they
agree. `goalsDirectory` still names the original `goals` directory and the
legacy non-release `metrics/goals` fallback is unchanged, so production keeps
resolving what it resolves today. `mecV2Directory` was left as-is: renaming it
is pure churn while only one MEC version exists.

### Fail-closed guard

A land summary is now rejected outright when more than 2% of its species rows
resolve to no taxon group, naming the offending classes in the error. The
defect peaked at 10.46% of species rows in a single solution, so this
threshold would have stopped it, while leaving room for genuine one-off
stragglers. A new `diagnostics.rawTaxonClassCounts` records the unmodified
class strings per document so the next upstream rename is visible in the
artifact itself rather than only in a rollup that quietly shrinks. The existing
`rollups.species.ignoredSpeciesRowCount` remains the unresolved count.

### Timeline

- **11:05–11:20 AM (~15m):** Verified the defect, proved Tier-1 unaffected
  across all 172 verbose documents, and made the code changes.
- **11:20:57–11:21:08 AM (11s):** Regenerated all 172 goal sidecars with zero
  failures against warm summary-CSV caches.
- **11:21–11:22 AM (~1m):** Confirmed zero unresolved rows, checked all 172
  against the goals completeness contract, and reconciled the Plants counts for
  `eco17_estr17_esprep17_runap_iheh2022` (776 to 806) and the worst-affected
  `eco17_estr30_serv30_esprep17_runap_omec_iheh2030` (174 to 199) against plant
  row counts read straight from the raw CSVs.
- **11:22:15–11:29:07 AM (6m52s):** Uploaded 172 goal sidecars (126,425,199
  bytes) to `goals/v3` with zero failures.
- **11:29:47–11:31:04 AM (1m17s):** Verified all 172 published artifacts
  remotely; every checksum, content type, and cache header matched.
- **11:31:59 AM (~2s):** Rebuilt the local runtime manifest. Only the 172
  `precomputedMetricUrls.goals` values changed; `cache`, `compactCache`, and
  `mecV2ByGeography` stayed byte-identical, as did every top-level field.
- **Tests:** 477 passed and 1 skipped in the Python suite; 101 passed in the
  frontend layer-manifest suite.

- **Operational lessons:** Solver output is not a taxonomy source. When a
  pipeline already loads an authoritative record for a row, deriving every
  attribute it can supply from that record — rather than from a parallel string
  column in the same CSV — removes the whole class of drift instead of patching
  one instance of it. A rollup that silently shrinks is also the worst failure
  shape available, because totals still reconcile: the row counts, IUCN
  breakdown, and completeness contract all passed while a third of the plants
  were missing from their group. Counting raw source values per document and
  refusing to emit past a tolerance is what converts that into a loud failure.
  Finally, a key named after a version number guarantees a rename on the next
  version; naming the key for its role and letting the value carry the version
  keeps the next republish to a one-line contract change.

## Cross-runtime catalog hash parity and the first clean promotion dry run

Friday, August 7, 2026, 11:38 AM–12:20 PM Eastern. The release promotion tool
rejected every Python publish report for `solutions-v0-2-0-20260805` because
Python and JavaScript computed the solution catalog's identity SHA-256
differently. Fixing that let the dry run reach code that had never executed for
this release, which surfaced two further contract defects. The dry run now
passes end to end. Production still serves `sirap-polygon-v2-20260727`; no real
promotion was run.

- **What:** `solutionCatalogSha256` in `lib/solution-catalog.mjs` rebuilt the
  hashed document from a hand-maintained field allowlist that omitted the
  top-level `speciesException` block. Python hashes `SolutionCatalog.to_dict()`,
  which includes it. Python produced
  `58224b786298a9e3ab514c07f5519e2991f58c0ba2b519b0ce6836094b6713d7`;
  JavaScript produced
  `582b8200c71ab268a0f01620384a586a6e595b09863a441956b2c3e918bd361c`, which is
  exactly the Python digest with `speciesException` removed.
- **Why it stayed hidden:** The allowlist was almost certainly never updated
  when the species exception landed mid-project, and nothing forced the two
  runtimes to agree. Python's value was already baked into 19 publish reports
  across every artifact type and into `solutionCatalogBinding.catalogSha256` on
  1,533 published artifacts, all at immutable Blob paths, so the divergence was
  two days old before anyone ran the promotion tool. No test computed the digest
  on both sides, and `validateSolutionCatalog` rejected neither unknown keys nor
  the missing field, so the drift was silent in both directions.
- **How:** Python is authoritative and its digest is unrewritable, so
  JavaScript moved to match it. The projection was kept rather than replaced by
  a wholesale hash of the parsed file, because Python's own hash is a
  projection: its frozen dataclass drops any key the contract does not name, so
  hashing the file wholesale would have made JavaScript follow the file while
  Python follows the dataclass and reintroduced divergence on the next stray
  key. What was removed instead is the silence. `canonicalSolutionCatalogDocument`
  is now a single named mirror of `to_dict()`, and `validateSolutionCatalog`
  rejects unknown keys at the top level, inside `solutions[]`, and inside
  `speciesException`, so the next field added to the contract fails loudly on
  the JavaScript side instead of quietly dropping out of the digest.
- **Outcome:** Byte-exact agreement on the real release catalog and on a
  five-shape parity fixture. The dry run reports `validated release
  solutions-v0-2-0-20260805 (catalog 0.2.0)` and would promote revision
  `84adc7b0dd1324b3e70516e276108491f22215120283866374dc01185280898c`.
- **Where:** `frontend/layer-manifest/lib/solution-catalog.mjs`,
  `lib/artifact-documents.mjs`, `lib/release-artifacts.mjs`, and the new
  fixture `data/metrics/fixtures/solution-catalog-hash-parity.json`.

### Species metrics are not applicable to marine solutions

With the catalog check passing, the dry run reached `validateSpeciesMetricPolicy`
and rejected the four marine solutions for reporting
`species_groups_protected` as `not_applicable`. That status is correct: every
species-kind `MetricDefinition` in Python declares `applicable_domains =
{"land"}` because the BioModelos ranges are terrestrial, and Python's own
contract check *requires* `not_applicable` off-domain. The JavaScript validator
carried a parallel `SPECIES_METRIC_IDS` list with no domain dimension at all, so
it forbade the only status Python permits. It now reads
`metricsProvenance.solutionDomain` and requires `not_applicable` for marine
while keeping the existing land rules, which makes the marine path stricter
rather than looser. All 168 land solutions report `partial` under the species
exception and all 4 marine report `not_applicable`; both are now enforced.

### Python floats cannot survive a JSON.parse round trip

The next failure was `metricsProvenanceSha256 must match metricsProvenance` on a
land artifact whose stored digest Python reproduced exactly. The two canonical
strings differed by precisely 1,000 characters: Python writes float zeros as
`0.0`, and `JSON.parse` collapses that to the number `0`, which `JSON.stringify`
renders as `0`. The affected fields were `conservationDeltaM2`,
`intersectedAreaKm2`, and `sourceAreaKm2` in the per-species matching inventory,
and 168 of 172 compact artifacts carried at least one. This check had therefore
never passed for this release; it was simply unreachable behind the catalog
failure. JavaScript numbers have no integer/float tag, so no amount of
formatting logic can recover the distinction after parsing — the only faithful
route is the document's original number literals. `parseWithNumberLiterals` uses
the Node 22 `JSON.parse` source-text reviver to preserve any literal whose
spelling differs from JavaScript's rendering, and the canonicalizer emits that
literal verbatim. It is applied only to the compact provenance digest: boundary
provenance sources contain no floats, and MEC and goals documents carry no such
digest. Wrapping only the literals that actually differ, and only for compact
documents, kept the dry run at about four minutes.

### Audit of other cross-runtime canonical hashes

Every other place both runtimes canonicalize and hash the same structure was
checked for the same allowlist-drift hazard. The catalog digest was the only
one, because the others recompute wholesale over the structure embedded in the
document they are validating: `metricsProvenanceSha256` hashes the document's
own `metricsProvenance`, and `boundaryProvenance.sha256` hashes the document's
own `sources`. If Python adds a field there, both the structure and its digest
move together and JavaScript still agrees, so those are drift-immune by
construction. `solutionInputSignature` and the `metrics-catalog-v4`
`catalogSignature` are computed only in Python and compared as opaque strings in
JavaScript, so they cannot diverge either. Two real gaps were fixed: the
JavaScript `solutionCatalogBinding` validator ignored the `speciesException`
that Python's `catalog_binding()` includes and requires by exact equality, so it
would have accepted a binding that Python rejects; it now enforces the exact key
set and cross-checks the exception against the catalog. Three latent risks were
left alone and are recorded here. Python's `_canonical_sha256` is copied into
roughly a dozen modules and reimplemented inline a fourth time in
`prepare_solution_release`, all currently identical. Python's
`load_solution_catalog` still accepts unknown top-level and per-solution keys
and silently drops them, so JavaScript is now the stricter of the two. And
Python would accept `8300.0` where it expects `8300`, since `8300.0 == 8300`,
which JavaScript cannot detect after parsing; Python writes these values, so the
exposure is theoretical.

### Timeline

- **11:38–11:50 AM (~12m):** Reproduced both digests, confirmed 19 reports pin
  the Python value, and audited both runtimes for the same hazard.
- **11:50 AM–12:05 PM (~15m):** Fixed the projection, added strict unknown-key
  rejection, generated the five-shape parity fixture from Python, and wired
  parity assertions into both suites.
- **12:05–12:20 PM (~15m):** Worked the dry run through the marine domain
  defect and the float-literal defect to a clean pass in 3m56s.
- **Tests:** 484 passed and 1 skipped in the Python suite; 118 passed in the
  frontend layer-manifest suite.

- **Operational lessons:** A hash is a contract between two programs, and the
  only reliable way to keep two implementations of it honest is to make them
  assert against the same pinned values in CI. Neither runtime rejecting unknown
  keys is what turned a one-field omission into a silent two-day divergence: a
  projection that drops what it does not recognize will always fail quietly, so
  it has to be paired with validation that refuses what it does not recognize.
  It is also worth noticing when a validator has never actually run. Two of the
  three defects here were not regressions; they were checks that had been
  failing since the day they were written and were masked by an earlier failure,
  which is the normal shape of a fail-closed pipeline whose first gate is broken.
  Finally, `JSON.parse` is lossy in a way that matters for cross-language
  digests: `0.0` and `0` are the same JavaScript number, so any digest agreement
  with Python over float-bearing data has to be computed from the source text.

## Fixed-AOI metric completeness audit for solutions-v0-2-0-20260805

Read-only audit answering whether every solution, every fixed administrative
geography, and every rendered metric carries a value in the staged 0.2.0
release, ahead of the production cutover decision. Nothing was regenerated,
republished, or promoted; the audit read the local cached artifacts under
`data/metrics/generated/releases/solutions-v0-2-0-20260805/` and decoded the
compact documents through `compact_metrics.to_verbose_document`, which is the
same index-expansion the Angular reader performs in
`cached-metrics.utils.ts::expandCompactMetricsDocument`.

The matrix is 172 solutions x 3,642 scopes x 36 computable metrics =
22,551,264 cells. Scope counts per solution are identical everywhere and match
`EXPECTED_BOUNDARY_COUNTS`: 1 national, 33 departments, 1,105 municipalities,
10 SIRAPs, 1,879 RUNAPs, 614 OMECs. Only four statuses appear anywhere in the
release — `ready` 8,978,576 (39.81%), `empty` 7,411,566 (32.87%), `partial`
3,512,412 (15.58%), `not_applicable` 2,648,710 (11.75%). No `blocked`,
`pending`, or `derivation_needed` cell exists. Every cell classified into an
expected bucket and the buckets sum exactly to the matrix total; there were
zero unexplained cells, zero metrics absent from a document that the contract
expects, and zero solutions with any issue from
`regular_artifact_completeness_issues`. Coverage is exact: 172/172 compact,
168/168 land MEC directories each holding all six level files, 172/172 goals
v3, no missing ids and no extras against the catalog.

The expected-gap categories were confirmed rather than assumed. All 235,754
`empty` cells are backed by a `solution-raster-scope-state-v1` block with
`classification: empty` and `solutionValidCellCount: 0`; no scope anywhere in
the release is missing scope-state evidence, so every empty is a proven empty
rather than a silent hole. The bulk of these are the four marine solutions,
which support only 98–103 of 3,642 boundaries each because Colombia's inland
departments and municipalities do not intersect a marine grid; land solutions
support 2,232–2,372 boundaries. Marine species metrics are `not_applicable` in
all 131,112 applicable cells, consistent with `applicable_domains = {"land"}`.
The dual-threshold policy affects exactly 24 solutions — the `eco{17,30}` x
`estr{none,17,30}` x `runap` x `omec?` x `iheh{2022,2030}` family with no
species target — contributing 109,870 `partial`/null cells across
`species_groups_protected` and `threatened_species_secured`. In every one of
those cells the structured detail really is present: a `thresholdOutcomes` pair
at `targetPercent` 17.0 and 30.0, each with a finite value and, for the group
metric, a full `summary` plus per-taxon `groups` breakdown. The data behind the
unbuilt "Additional Outcomes" UI is intact. The signed two-species exception is
uniform across all 168 land solutions at 8,298 of 8,300 with
`missingUnexpected: 0`.

Two things worth separating for anyone reading a blank cell. Zero is not
absence: 331,354 `ecosystem_coverage_dry_forest` cells and 376,705
`mangrove_coverage` cells hold a real measured 0 km², and the pipeline's choice
to make `empty` mean `null` rather than `0` is what keeps those distinguishable.
And `partial` is not blank in the data: 3,402,542 of the 3,512,412 `partial`
cells carry a real finite value and differ from `ready` only in that the
species pool was 8,298 instead of 8,300.

That last point is where the audit found its one real problem, and it is in the
frontend rather than the data. The signed species exception moves all nine
species metrics from `ready` to `partial` in every non-empty scope of every land
solution — the audit measured 0 `ready` and 390,268 `partial` cells for each of
them. `metric-presentation.utils.ts::isDisplayableMetricValue` was written to
accept `partial`, and the AOI value renderers use it, so
`threatened_species_count` and `species_pct_of_national` display correctly with
the "Partial value: 2 approved species sources unavailable" note. But three
other paths still gate on `status === 'ready'` and will therefore discard values
that are present: `panel-switcher.ts::buildOverviewMetricDisplayEntries` (the
`realValueAvailable` check), which makes the Overview "Species Groups Protected"
and "Threatened Species Secured" cards render `--` with the unavailable tooltip
for all 168 land solutions, not just the 24 dual-threshold ones;
`aoiBiodiversityBars`, whose `hasCachedSpecies` probe can never be satisfied, so
the five species-richness bars fall through to dummy data when
`fillDummyAoiMetrics` is on and to blank bars when it is off; and
`buildMetricValueCsvRow`, which exports all nine species metrics as "value
unavailable". This was established by reading the code and the measured
statuses, not by exercising the running app, so it should be confirmed in the
dev preview before a ticket is written. It does not block the data cutover —
no artifact needs to change — but it will make a reviewer see far more species
blanks than the release notes predict.

The goals v3 sidecars are internally consistent and coherent with Tier-1. All
172 pass: `byTaxa` partitions the species feature rows exactly, with per-group
totals and met counts matching the rows carrying that `taxonGroup`, which is
what `overviewGoalsTaxaRows` depends on after the taxon-resolution fix. There
are zero unresolved-taxon rows and zero species rows unmatched against the
species catalog anywhere in the release, so the `Magnoliopsida_1`/`_2` batching
that motivated preferring the catalog over the solver's `class` column is fully
absorbed. No `byTaxa` group falls outside the five Tier-1 buckets, and no goals
taxon bucket targets more species than the Tier-1 modeled pool contains for that
bucket. Tier-1 `conservation_goals_met` and goals `summary.pctMet` agree on all
172 solutions (both 100.0, zero mismatches beyond 0.05pp), which matters because
`getGoalsAchievedPercent` prefers the Tier-1 metric and silently falls back to
the goals value. The target-policy split is also coherent from both sides: the
24 `dual_reference` solutions are exactly the ones whose goals documents carry
no species entry in `relativeTargetsByType`, and no non-dual land solution has
zero species goal features.

- **Verdict:** the fixed-AOI data is complete and internally consistent; every
  blank is explained, and the only follow-up is a frontend readiness predicate
  that treats a valued `partial` metric as unavailable.
- **Operational lessons:** a status vocabulary is a contract with the UI as much
  as with the pipeline, and widening it — here by introducing `partial` for an
  approved partial-input run — is a breaking change for every consumer that
  spelled its readiness check inline. One shared predicate existed and was
  correct; the defect is entirely in the three call sites that never adopted it.
  It is also worth auditing what renders rather than only what validates: the
  publish gate passed all 172 documents, and it was right to, because the data
  is correct. The gap only becomes visible when the audit asks what the reader
  does with a status rather than whether the writer was allowed to emit it.
