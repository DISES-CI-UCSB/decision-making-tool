# Decision Making Tool — Backend

Spanish version: [README_ES.md](README_ES.md).

The Decision Making Tool is a spatial conservation prioritization platform for Colombia. People compare conservation solutions on a map. This repository holds everything behind the web app:

- the **Metrics API** container, which calculates metrics live for a polygon someone draws and signs download URLs;
- the **metrics pipeline**, which precomputes the numbers for known areas and publishes them to Vercel Blob (public object storage);
- the **layer-manifest tooling**, which publishes the JSON indexes that point the web app at those files.

The web app itself lives in the frontend repository. It reads precomputed numbers straight from Blob and calls this API only for custom polygons.

No secrets, local `.env` files, heavy rasters, generated caches, or packaged production metric artifacts should be committed. Runtime artifacts belong in `runtime-artifacts/` locally or in a mounted directory configured by environment variables.

## Directory structure

| Directory | Description |
|-----------|-------------|
| `app/` | FastAPI application — custom-polygon metrics, species jobs, Blob URL Signing Service |
| `scripts/` | Hydrate, runtime-artifact builders, download-catalog builder, publishing helpers |
| `tests/` | API tests (`pytest`) |
| `docker/`, `Dockerfile`, `docker-compose.yml` | The Metrics API container |
| `artifacts/` | Runtime-artifact contract and the tiny committed test fixture |
| `data/metrics/python/` | The metrics pipeline (`metrics_pipeline/`), its tests, and its own `requirements.txt` |
| `data/metrics/fixtures/`, `data/metrics/release-specs/` | Pipeline fixtures and release contracts |
| `data/scripts/` | One-off data-preparation scripts |
| `layer-manifest/` | Node.js tooling that builds, publishes, and rolls back layer manifests and catalog-release indexes |
| `docs/` | Architecture, glossary, findings, and the Parques IT handoff (`docs/handoffs/parques-it/`, English and Spanish) |
| `runtime-artifacts/`, `runtime-cache/`, `secrets/` | Local-only; ignored by Git and Docker |

## Architecture

The Metrics API is a FastAPI (Python web framework) service with one main job: compute conservation metrics for a **custom polygon** a user drew on the map. Most of what the app shows — known-AOI (Area of Interest) numbers, layer definitions, solutions — comes straight from Blob-served manifests (see "What 'the catalog' is" below). To do that one job, the API still needs to know which rasters and species matrices to load — that's what `manifest.json` tells it:

- **`manifest.json` — the registry for one catalog version.** This is the file `hydrate` reads. It lists every feature raster (land cover, protected areas, carbon, water, and so on), the species matrices, the reference grid, and checksums for **one specific catalog version** — today that's **3.7.0** (`releases/catalog-v3-7-0/manifest.json` on Vercel Blob). Bump the catalog version, and this is the file that changes: it points hydrate at a different set of layers to download. `DMT_MANIFEST_URL` (with `MANIFEST_BLOB_URL` as a fallback — see "The two pointers" below) tells the API which version's manifest to hydrate from.
- **Live AOI endpoints — what actually runs on a click.** Once hydrate has filled the volume from that manifest, the API can answer:
  - `POST /metrics/custom-polygon` — takes a GeoJSON polygon, rasterizes it onto the reference grid, and returns metric values (area, land cover, protected areas, carbon, water, ecosystems, and more) computed **live**, on that request.
  - `POST /area-profile/custom-polygon` plus a `species-coverage/jobs` pair — richer species/ecosystem breakdowns, run as background jobs (an on-disk SQLite queue) since they're slower than a single request-response cycle should be.
  - `GET /health` — process is alive. `GET /ready` — the loaded manifest artifact (and the species-job worker) are actually usable; returns `503` if hydrate hasn't run yet for the configured manifest.
- **Entry point:** `app/main.py`. A lifespan hook calls `warmup_artifacts()` on boot, loading the hydrated rasters and species matrices into an in-memory cache (`app/artifacts.py`) so live requests don't hit disk.
- **Shared calculators, not duplicated logic:** the API imports its metric formulas from `data/metrics/python/metrics_pipeline`, the same package the offline pipeline (section 2) uses to precompute known-AOI numbers. One codebase computes both the "already known" (precomputed) and the "just drawn" (live) numbers.

Stack: FastAPI, Pydantic, rasterio (raster I/O), NumPy, Shapely/PyProj (geometry) via the shared metrics pipeline. Release tooling: Node.js 22.

## 1. Run the API

You need Docker, outbound HTTPS to public Blob, and a copy of `.env.example` → `.env`. Compose loads `.env` (it ignores `.env.local`). Service-account key files go in `secrets/` (see "Endpoints" below).

Hydrate downloads the rasters and species matrices the API uses to score custom polygons. Publishing new known-AOI metrics is a separate job in section 2.

```bash
# First: fill the artifact volume (about 15–25 minutes the first time)
docker compose run --rm --build backend hydrate

# Then: start the API
docker compose up -d --build
```

| Check | Meaning |
|-------|---------|
| `curl http://localhost:8000/health` | Process is up |
| `curl http://localhost:8000/ready` | Hydrate finished. **503** means the volume is empty — run hydrate first |

Flagless hydrate uses the EPSG:9377 land-solution grid. Optional hydrate flags: `--production-v3` (Mesa / immutable production build) and `--reference-grid ecosistemas` (legacy EPSG:4326).

**Connecting the frontend:** the frontend is a static site built with `METRICS_API_BASE_URL` set to this API's full origin. Browsers then call this API directly, so list the frontend's origin in `DMT_CORS_ORIGINS` here (for the test environment: `DMT_CORS_ORIGINS=https://test-priorizandolanaturaleza.parquesnacionales.gov.co`).

Hydrate only needs outbound HTTPS to public Blob. A write token is for publishing later.

## What “the catalog” is

People say “catalog” for three different files.

```
Tiny catalog-release index          ← frontend starts here
        │
        ├── national manifest.json  ← layers + 172 solutions + URLs to metric JSON
        └── SIRAP manifest.json     ← 56 regional solutions + URLs to metric JSON
```

SIRAP is Sistema Regional de Áreas Protegidas.

- A **catalog release** is the tiny index (for example `catalog-releases/3.7.1/catalog-release-index.json`). It lists batch `manifestUrl`s. Current default: **two** batches, national and SIRAP. The format allows more or fewer.
- A **batch manifest** is the fat JSON: map layers, solutions, and `precomputedMetricUrls` (compact metrics, goals, MEC geography shards, species-coverage shards). Those shards are **other** JSON files. The manifest is an index of those files.
- The **live layer manifest** (`manifest/manifest.json`) is a third file. Hydrate reads it. It can include `hydrationPackage` (grid, species matrices, metric-layer paths). `npm run generate:layer-manifest` expands that package from the hand-edited template `layer-manifest/shared/hydration-package.json`.

You choose a version by pointing a URL at one tiny index. Committed copies live in `layer-manifest/catalog-releases/`. There is no `latest.json` that auto-tracks the newest.

Name future catalogs with a version (`3.7.2`, a date). “Tested locally” means you pointed your env at a candidate URL, then made that same URL official.

### The two pointers (easy to mix up)

| Who should change | Environment variable | What moves |
|-------------------|----------------------|------------|
| **What the web app shows** | Frontend repository: `CATALOG_RELEASE_INDEX_BLOB_URL` (Docker/Vercel build) and `catalogReleaseIndexBlobUrl` in `src/environments/environment.ts` (`yarn start`) | Solutions, known-AOI dashboard numbers |
| **What custom polygons calculate against** | This repository: `MANIFEST_BLOB_URL` or `DMT_MANIFEST_URL` in `.env` | Hydrate recipe (`hydrationPackage`) |

These names drifted. Mentally: first var = **frontend catalog index**, second = **hydrate layer manifest**. Bump only the pointer for the surface that changed.

- New dashboard / known-AOI numbers, same custom-AOI grid → change the **frontend** pointer, rebuild the frontend. Skip hydrate if `hydrationPackage` inputs did not change.
- New custom-AOI rasters or species matrices, same web-app catalog → change the **hydrate** pointer (or publish live `manifest/manifest.json`) and re-run hydrate.
- Official cutover of both → update both, rebuild frontend, hydrate.

## 2. Publish new metrics

The metrics release is a sequence of related artifact builders, not one script. Python calculates the data. Node.js manifest scripts only point the app at data that has already been calculated.

One-time setup on the machine that publishes:

```bash
# Metrics pipeline (Python)
cd data/metrics/python
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cd ../../..

# Layer-manifest tooling (Node.js 22)
npm ci
```

Publishing needs `BLOB_READ_WRITE_TOKEN` in `.env.local` in this folder (see `.env.example`). Scripts report only whether the token is present, never its value.

### Mental model

- The unit of work is **one solution**. Unless a diagnostic flag narrows the run, each national solution output contains `national`, `departments`, `municipalities`, `siraps`, `runaps`, and `omecs`.
- A **summary metric** is one value shown on an Overview or Area of Interest panel, such as Species Groups Protected.
- **Species Coverage Breakdowns** are the per-species records shown in species popup modals.
- **Ecosystem Coverage Breakdowns** are the per-ecosystem records shown in ecosystem popup modals.
- Summary metrics and coverage breakdowns are separate artifacts. Producing a breakdown does not automatically populate its related summary metric.

National and SIRAP (regional) solutions use the same Python pipeline, with solution-domain and regional-packet branches inside the scripts. They are published as separate batch manifests.

### Production sequence

| Step | Script | Output and metric ownership | Observed timing |
|------|--------|-----------------------------|-----------------|
| 1. Calculate regular detailed metrics | `main.py` | Writes one detailed metrics document per solution with general summary metrics: area and priority, land use, carbon, water, protected-area overlaps, social/governance areas, marine summaries, regular ecosystem summaries, `conservation_goals_met`, and the ten land-species summaries listed below. Passing `--skip-species` leaves those ten species summaries unfinished with `derivation_needed`. | One gold land solution, all six geographies, Apple M2 Max: **7 min 14 sec** with `--skip-species`. The production 8,300-species path is currently blocked; see the timing note below. |
| 2. Calculate Species Coverage Breakdowns | `run_species_goals_full_build.py` using `species_goals.py` | Uses Calculator A sparse matrices to write per-species coverage records for each solution and geography. These records power species popup modals. This step does **not** write the ten regular species summary metrics. | Same gold solution: about **45 sec generation + 34 sec validation**. Historical 168-solution run: about **2 hours with six workers**. |
| 3. Reconcile deferred species summaries | Complete reconciliation command does not exist yet | Required after `main.py --skip-species`. It must derive all ten summaries from validated Species Coverage Breakdowns, update detailed and compact regular outputs, and leave non-species metrics unchanged. Existing backfills restore only selected metrics and do not complete this stage. A production release must not treat skipped species as complete until this stage succeeds. | Not available until the command exists. |
| 4. Calculate Ecosystem Coverage Breakdowns | `mec_compact.py` | Writes land-only MEC (Mapa de Ecosistemas de Colombia, Colombia's ecosystem map) shards per solution and geography. These power ecosystem popup modals and are separate from the regular ecosystem summary metrics written by `main.py`. | Not benchmarked. |
| 5. Build conservation-goal breakdowns | `conservation_goals.py` | Reshapes Prioritizr summary CSV files into per-feature target, held, shortfall, and met records. It calculates display rollups such as met count, total count, percent met, feature-type groups, and species taxonomic groups; it does **not** independently recalculate held coverage from rasters. The app uses this sidecar in the Overview **Conservation target progress** widget and its breakdown modal. The separate **Targets Achieved** Overview card reads the regular `conservation_goals_met` summary written by `main.py`, which also comes from Prioritizr-derived summary values. | Not benchmarked. |
| 6. Create compact regular metrics | `compact_metrics.py` | Converts the detailed regular metrics into the smaller format loaded by the dashboards. It changes format only; it does not calculate or repair metrics. | Not benchmarked. |
| 7. Inspect, assemble, publish, and verify | `inspect_metrics.py`, `assemble_solution_release.py`, `publish.py`, `verify_artifacts.py` | Validates completed artifacts, assembles the release, uploads it to Blob, and verifies the uploaded bytes. Use `publish.py --dry-run` first. | Depends on artifact count and network conditions; not benchmarked. |
| 8. Update app manifests | `layer-manifest/*.mjs` (`npm run …` scripts in `package.json`) | Points the app at the published regular, Species Coverage Breakdown, Ecosystem Coverage Breakdown, and conservation-goal artifacts. These scripts calculate no metrics. | Not benchmarked. |

Rehydrate only when custom-AOI inputs changed.

Timing note (measured 2026-09-23): the Step 1 benchmark used
`eco17_estr17_serv17_esprep17_runap_iheh2022` across national, departments,
municipalities, SIRAPs, RUNAPs, and OMECs. The current production 8,300-species
path spent **2 hr 35 min** in cold input alignment, then failed before metric
calculation because two MAXENT GeoTIFFs were missing and eight downloads timed
out. A performance-only run excluding the two missing species completed in
**13 min 30 sec** on a warm cache (**9 min 6 sec** per-solution, including
**4 min 16 sec** of species work). That 8,298-species result is not valid
catalog 3.7.0 science and must not be published.

### The ten land-species summary metrics

`main.py` calculates these during its regular species pass. They are the complete set that a future skip-species reconciliation command must restore:

| Metric ID | Metric key |
|-----------|------------|
| 2 | `species_groups_protected` |
| 3 | `threatened_species_secured` |
| 21 | `species_richness_mammals` |
| 22 | `species_richness_birds` |
| 23 | `species_richness_amphibians` |
| 24 | `species_richness_reptiles` |
| 25 | `species_richness_plants` |
| 26 | `threatened_species_count` |
| 27 | `endemic_species_count` |
| 28 | `species_pct_of_national` |

The machine-readable registry remains `data/metrics/python/metrics_pipeline/metric_definitions.py`. Keep documentation and validation synchronized with `species_metric_ids()` instead of creating an independent metric list in new code.

### Calculator and backfill boundaries

- The regular species pass in `main.py` uses the GeoTIFF overlap calculator and writes all ten summaries directly.
- Calculator A in `species_goals.py` uses sparse matrices and writes Species Coverage Breakdowns. Catalog 3.7.0 used this path after running `main.py --skip-species`.
- `backfill_endemic_species_count.py` restores metric 27 only.
- `backfill_threatened_species_secured.py` restores metric 3 by default. Its broader option also restores metrics 26 and 27; it still omits metric 2, metrics 21–25, and metric 28.
- No current script reconciles all ten summaries. A skipped-species output is a partial product, even if its existing inspections pass.

### Incremental runs

- `main.py` can select solutions and split solution work across chunks. Each selected solution still contains all enabled geography levels.
- `--national-only`, `--skip-species`, and `--skip-species-boundary-level` create intentionally partial or diagnostic outputs. Do not publish those outputs as complete releases without the required follow-up calculation and reconciliation.
- `compact_metrics.py` converts the selected detailed publish report; it does not independently select or calculate metrics.
- `mec_compact.py` supports solution and geography-level selection for Ecosystem Coverage Breakdowns.
- Metric-specific `backfill_*.py` scripts are repair tools, not a substitute for production completeness validation.

**Update the manifests** (two separate surfaces, both need updating):
- **Web app / known-AOI numbers:** publish fat national and SIRAP **batch** manifests whose `precomputedMetricUrls` point at the published regular and breakdown artifacts from steps 1–6. For a new catalog version, also publish a **new tiny index** at `catalog-releases/<version>/catalog-release-index.json`. Then point the frontend's catalog pointer at it and rebuild the frontend.
- **Custom polygons:** `npm run generate:layer-manifest` refreshes `hydrationPackage` from `layer-manifest/shared/hydration-package.json`. `npm run publish:layer-manifest` updates live `manifest/manifest.json` — the file hydrate reads.

A few manifest scripts also read or write the frontend checkout (the local preview manifest and the left sidebar's layer list). They expect it next to this folder at `../frontend`; set `DMT_FRONTEND_DIR` when it lives elsewhere.

**Known exception:** if a release introduces a layer ID the left sidebar hasn't seen before (a new SIRAP packet's naming, for example), updating manifests alone isn't enough — the sidebar's `LAYER_ID_SYNONYM_GROUPS` (frontend repository, `src/app/features/left-sidebar/map-layers-panel/map-layers-panel.utils.ts`) is a hardcoded alias table, not manifest-driven, and needs a matching code change.

**Rehydrate** only if custom-AOI inputs changed (`docker compose run --rm --build backend hydrate`, then `docker compose up -d --build --force-recreate`).

Prefer **new Blob paths** (a new release prefix and tiny index) when numbers change. Metric JSON is cached for a long time, so overwriting the same URL can leave browsers on old bytes.

A normal release uses the steps above. `publish_land_use_aoi_test_catalog.py` is an old one-off that writes `*-land-use-aoi-test` prefixes on purpose — don't confuse it with the real pipeline.

Full command syntax and flags for every script above: [`docs/handoffs/parques-it/english/data-operations/metrics-and-artifacts.md`](docs/handoffs/parques-it/english/data-operations/metrics-and-artifacts.md).

## Tests

```bash
python -m pytest                                  # API
(cd data/metrics/python && python -m pytest)      # metrics pipeline
npm run check:layer-manifest                      # layer-manifest tooling
```

## Deployment

```bash
docker build -t dmt-backend .
docker build --platform linux/amd64 -t dmt-backend:amd64 .
```

The build context is this folder. The image contains the API, the metrics pipeline package, and the release-spec contracts; production rasters are hydrated into a mounted volume at runtime.

## Local Setup (without Docker)

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt -r data/metrics/python/requirements.txt
pytest
uvicorn app.main:app --reload
```

The API will be available at `http://127.0.0.1:8000`.

## Tiny Artifact Smoke

A small human-readable artifact fixture lives at `artifacts/fixtures/tiny-area/`. It contains a `manifest.json` plus `area-grid.json` with four cells, a fixed `pixel_area_km2`, and selected/valid flags. This fixture is safe to commit because it is JSON test data, not a raster, vector, cache, or production artifact.

Run the backend against the tiny artifact locally:

```bash
DMT_ARTIFACT_REQUIRED=true DMT_ARTIFACT_DIR=artifacts/fixtures/tiny-area DMT_ARTIFACT_MANIFEST=artifacts/fixtures/tiny-area/manifest.json uvicorn app.main:app --reload
```

Smoke check readiness and the representative custom polygon path:

```bash
curl http://127.0.0.1:8000/ready
curl -X POST http://127.0.0.1:8000/metrics/custom-polygon \
  -H 'content-type: application/json' \
  -d '{"geometry":{"type":"Polygon","coordinates":[[[0,0],[2,0],[2,1],[0,1],[0,0]]]},"metrics":["area"]}'
```

The sample polygon covers two valid fixture cells. One is selected, so the response should include `priority_area_in_region: 1.5` and `national_contribution: 50.0`, along with warmup/request timing metadata.

## Docker Setup

```bash
docker compose build
docker compose up
```

Smoke check:

```bash
curl http://127.0.0.1:8000/health
curl http://127.0.0.1:8000/ready
```

Run Docker Compose against the tiny artifact fixture copied into the image:

```bash
DMT_ARTIFACT_REQUIRED=true DMT_ARTIFACT_DIR=/backend/artifacts/fixtures/tiny-area DMT_ARTIFACT_MANIFEST=/backend/artifacts/fixtures/tiny-area/manifest.json DMT_MESA_COVERAGE_REQUIRED=false docker compose up --build
```

Stop the service with:

```bash
docker compose down
```

## Hydrate runtime artifacts

Production rasters are not baked into the image. From a machine that can reach public Vercel Blob, fill the mounted artifact volume:

```bash
docker compose run --rm --build backend hydrate
```

The image already knows which public blob URLs to download. Extra flags pass through to `scripts/build_runtime_artifact.py` (`--force`, `--manifest-url`, `--production-v3`, and so on). Then start the API:

```bash
docker compose up -d
curl http://127.0.0.1:8000/ready
```

A host Python venv is no longer required for hydration. The host-side command below still works if you prefer it.

## VM Deployment Smoke Operations

The current VM deployment runs the backend Compose service on public port `8000`. Hydrate the ignored real raster runtime artifact first, then recreate the service with artifact loading required:

```bash
docker compose run --rm --build backend hydrate
# Optional host-side equivalent:
# .venv/bin/python scripts/build_runtime_artifact.py
DMT_ARTIFACT_REQUIRED=true docker compose up -d --build --force-recreate
```

The artifact builder downloads public Vercel Blob rasters into `runtime-artifacts/sources/` and writes `runtime-artifacts/manifest.json` with file checksums, source URLs, reference grid metadata, and metric coverage. This directory is ignored by Git and must not be committed.

Useful operations:

```bash
docker compose ps
docker compose logs --tail=100 backend
docker compose restart backend
docker stats --no-stream backend-backend-1
```

Repeat the fixture smoke checks from the VM with:

```bash
curl http://127.0.0.1:8000/health
curl http://127.0.0.1:8000/ready
curl -X POST http://127.0.0.1:8000/metrics/custom-polygon \
  -H 'content-type: application/json' \
  -d '{"geometry":{"type":"Polygon","coordinates":[[[0,0],[2,0],[2,1],[0,1],[0,0]]]},"metrics":["area"]}'
```

Chat #4 VM fixture benchmark on 2026-06-04 after rebuilding commit `3101d003`:

- Forced recreate to ready: 2.565 seconds; artifact warmup reported by `/ready`: 0.471 ms.
- Warm valid polygon request latency samples: 2.546, 2.475, 2.582, 2.500, 2.838, 2.565, 2.508, 3.477, 3.131, and 3.482 ms.
- Docker stats snapshot: CPU 0.19%; memory 47.59 MiB / 7.756 GiB, 0.60%.
- Expected valid response summary: `status=ok`, `priority_area_in_region=1.5`, `national_contribution=50.0`, and `matched_cell_count=2`.
- Expected invalid geometry behavior: `422` with `status=invalid_request` and message `geometry type must be Polygon or MultiPolygon.`

## Environment Variables

- `DMT_ARTIFACT_DIR`: Directory containing runtime artifacts. Defaults to `runtime-artifacts` locally and `/backend/runtime-artifacts` in Docker Compose.
- `DMT_ARTIFACT_MANIFEST`: Manifest path. Defaults to `${DMT_ARTIFACT_DIR}/manifest.json`.
- `DMT_ARTIFACT_REQUIRED`: Set to `true` when the API should fail readiness if runtime artifacts are missing or invalid. Defaults to `false` for local development without artifacts.
- `DMT_ARTIFACT_SCHEMA_VERSION`: Expected manifest schema version. Defaults to `metrics-artifact-manifest/v1`.
- `DMT_METRICS_PIPELINE_PATH`: Path to the shared metrics pipeline. Docker sets this to `/metrics_pipeline`.
- `DMT_RELEASE_SPECS_DIR`: Path to release-spec JSON contracts. Docker sets this to `/data/metrics/release-specs`.
- `DMT_CORS_ORIGINS`: Extra comma-separated frontend origins allowed by CORS, in addition to the localhost and 127.0.0.1 defaults (`:4200`, `:4300`, `:4301`, `:8080`, `:8084`). Production and preview hosts are not allowed unless listed here.
- `DMT_MAX_POLYGON_VERTICES`: Maximum vertices across every ring in a custom-AOI geometry. Defaults to `5000`. Oversized geometry returns `422` with `too_many_vertices` before raster work starts.
- `DMT_MAX_POLYGON_AREA_KM2`: Maximum geodesic area in km². Defaults to `2200000` (Colombia land plus maritime EEZ, with a small buffer). Oversized geometry returns `422` with `area_exceeds_national_territory`.
- `DMT_RATE_LIMIT_PER_MINUTE`: In-process request cap per client IP on expensive custom-polygon POSTs. Defaults to `30`. Set to `0` to disable. Exceeding the cap returns `429` with `Retry-After`. Job status GET/DELETE, `/health`, and `/ready` are not limited.
- `MANIFEST_BLOB_URL` / `DMT_MANIFEST_URL`: Optional override for the hydrate recipe's source layer manifest.
- `BLOB_READ_WRITE_TOKEN`: Required for future real Vercel Blob sync work. The skeleton script only checks whether it is present and never prints the value.

## Endpoints

- `GET /health`: Process-alive check. Returns `200` when the app is running.
- `GET /ready`: Artifact-aware readiness check. In no-artifact development mode, missing artifacts return `200` with `available=false`. When `DMT_ARTIFACT_REQUIRED=true`, missing or invalid runtime artifacts return `503`; readiness returns `200` only after the selected artifact loads.
- `POST /metrics/custom-polygon`: Accepts GeoJSON `Polygon` or `MultiPolygon` geometry. Vertex and area caps are applied before raster work. This route shares the application-layer rate limiter with the other expensive custom-polygon POSTs. With the tiny fixture it supports the area metric pair (`area`, `priority_area_in_region`, `national_contribution`). With the real raster artifact it rasterizes the AOI on the Colombia reference grid and supports implemented Tier 1 area, binary overlap, percent overlap, land-cover, protected-area, water, and carbon metrics. Response metadata includes warmup/request timing, selected/processed cell counts, layer usage, and metric coverage/unavailable reasons.
- `POST /downloads/signed-url`: Issues a short-lived Google Cloud Storage (GCS) V4 signed GET URL for one catalog object. Send `Authorization: Bearer <Firebase ID token>` and `{"object_name":"<blob pathname>"}`. The object must appear in the download catalog. An active `users/{uid}` record is required. Objects with no SIRAP (Sistema Regional de Áreas Protegidas) id are national. Objects tagged `orinoquia` or `eje-cafetero` also require authenticator (TOTP) sign-in and that region in the user's grant; `super-admin` may download both. Missing configuration returns `503` with reason `broker_not_configured` and does not affect the polygon routes. A failure to fetch Google's token certificates returns `503` with reason `token_certs_unavailable`. The token check also asks Firebase Authentication whether the session is still live: a token issued before the account's sessions were ended (for example, when 2-step verification is removed) returns `401` with reason `session_revoked`, a disabled Firebase account returns `401` with reason `account_disabled`, and a failed lookup returns `503` with reason `session_check_failed`. An accepted token is remembered for `DMT_AUTH_CACHE_TTL_SECONDS` (default 5 minutes), so these refusals take effect within that time; Firestore grant and status changes take effect within `DMT_ACCESS_ALLOW_TTL_SECONDS` (default 2 minutes).

Blob URL Signing Service settings live in `.env.example`. `DMT_GCS_SIGNED_URL_TTL_SECONDS` is capped at 7 days. `DMT_DOWNLOAD_CATALOG_PATH` points at either a published layer manifest or a JSON object map (`{"objects":{"releases/example.tif":{"sirap_id":null}}}`). `npm run downloads:build-catalog` (`scripts/build_download_catalog.py`) rebuilds that object map from every manifest in the web app's catalog release index and fails if a file used only by one region would not carry that region's tag; copying the result to the VM stays a manual step. Firebase and GCS use separate service accounts because they are different Google Cloud projects. The response is `Cache-Control: no-store`. Token checks, user records, allow/deny decisions, and signed URLs are cached in process.

Both service-account keys are read-only files: Compose mounts `secrets/` (ignored by Git and Docker) at `/run/secrets/dmt`, and `DMT_FIREBASE_SERVICE_ACCOUNT_FILE` / `DMT_GCS_SERVICE_ACCOUNT_FILE` point at them. A key file wins over the deprecated inline `FIREBASE_SERVICE_ACCOUNT_JSON` / `DMT_GCS_SERVICE_ACCOUNT_JSON`. Build the Download Catalog from the national and SIRAP manifests with:

```bash
docker compose run --rm backend python -m scripts.build_download_catalog
```

Fresh-VM setup, least-privilege keys, rotation, uptime alerting, and the release-gate check are in the [Metrics API VM runbook](docs/handoffs/parques-it/english/reception/metrics-api-vm-runbook.md).

## Shared Metric Adapters

Backend metric adapters live in `app/metric_adapters.py` and import calculator functions plus catalog entries from the existing precompute pipeline under `data/metrics/python/metrics_pipeline`. The backend should wrap those shared functions instead of duplicating metric formulas or metric definitions.

The custom polygon path keeps the tiny fixture behavior for tests, and uses real raster artifacts when `reference_raster_path` is present in the manifest. The real path builds a `SolutionRaster` from the drawn AOI mask and calls the shared area, overlap, land-cover, protected-area, water, and carbon calculators rather than duplicating formulas. Species metrics are feasible next with a dedicated live species accumulator artifact; solution metadata metrics and pairwise comparison metrics are not direct custom-polygon calculations.

## Artifact Sync Skeleton

The skeleton can list planned Blob prefixes and optionally write lightweight manifest metadata only. It does not download heavy data.

```bash
python -m scripts.sync_artifacts
python -m scripts.sync_artifacts --write-manifest
```

The script reports whether `BLOB_READ_WRITE_TOKEN` is present as `true` or `false`; it must never print the token value. See `artifacts/README.md` and `artifacts/manifest.schema.json` for the runtime artifact contract.

## Real Runtime Artifact Builder

Use `scripts/build_runtime_artifact.py` on the VM to create the live custom AOI artifact from public Blob source rasters. The builder uses the EPSG:9377 land-solution grid as the Colombia reference grid by default, reuses downloaded source files for duplicate layer views, and writes coverage groups for implemented, feasible-next, blocked, and unsuitable metrics.

The current real artifact implements 23 metric ids: `priority_area_in_region`, `national_contribution`, `priority_area_pct_of_region`, ecosystem overlaps, land-cover percentages/area, protected-area overlaps, social/governance overlaps, water regulation metrics, and carbon weighted metrics. It intentionally leaves species metrics for a later species accumulator artifact, leaves manifest-only solution metadata unavailable for arbitrary polygons, and leaves pairwise comparison metrics out of the live custom polygon path.
