# Decision Making Tool

A spatial conservation prioritization platform for Colombia. People compare conservation solutions on a map.

Dashboard numbers for **known** areas (national, departments, municipalities, and so on) are **precomputed** on public Vercel Blob. When someone **draws a custom polygon**, the backend calculates those metrics live from rasters and species matrices on its local volume.

This README covers two jobs:

1. **Spin up the app** — hydrate that custom-polygon data, then start the servers.
2. **Publish new metrics** and point the app at them.

Each process opens **one URL you configured**.

## Directory structure

| Directory | Description |
|-----------|-------------|
| `frontend/` | Angular app — map, solution finder, analysis dashboards |
| `frontend/layer-manifest/` | Schema and scripts for layer manifests and catalog-release indexes |
| `backend/` | FastAPI — custom-AOI metrics from a hydrated raster volume |
| `data/` | Source layers, solution rasters, and the metrics pipeline |
| `docs/` | Design docs and Parques IT handoffs |
| `development-artifacts/` | Experiments and mockups |
| `legacy-r-shiny-app/` | Archived Shiny app |

## Frontend architecture

The frontend (`frontend/`) is an Angular single-page app (SPA — the whole UI runs as one page that swaps content in and out, no full reloads). It has three moving parts:

- **App shell** (`app.html`, `app-shell.ts`) — a resizable three-column layout: left sidebar, center map, right sidebar. One root component (`App`) assembles it and owns modals (welcome screen, Solution Finder).
- **Feature areas**, each its own folder under `features/`:
  - `solution-finder/` — the guided questionnaire that matches user answers to one of ~170 pre-built conservation scenarios.
  - `left-sidebar/` — toggles for reference layers (ecosystems, species, costs, boundaries).
  - `map/` — the ArcGIS map itself: rendering solution rasters, drawing custom AOIs, admin boundary clicks.
  - `analysis/` — the right sidebar's Overview / AOI / Comparison tabs and their metrics.
  - `auth/` — Firebase login, tier gating, SIRAP (Sistema Regional de Áreas Protegidas) access requests.
- **Shared state** — one injectable service, `AppStateService` (`core/services/app-state.service.ts`), holds cross-cutting state (active solution, selected AOI, right-sidebar mode) using Angular signals (a reactive value container, similar to an Observable but simpler to read). Every panel reads from and writes to this one service instead of talking to each other directly — that's what keeps three independent UI panels in sync.

**Data flow mirrors the precomputed-vs-live split above:** known-AOI numbers and layer definitions come from versioned JSON manifests on Vercel Blob (see "What 'the catalog' is"); solution rasters are ArcGIS `ImageryTileLayer`s built from GeoTIFF (Cloud Optimized GeoTIFF) files; custom-polygon metrics go through the FastAPI backend described below.

Stack: Angular (standalone components, no legacy NgModules), Tailwind CSS, ArcGIS Maps SDK for JavaScript, ngx-translate for English/Spanish i18n, Firebase Auth.

## Backend architecture
The backend (`backend/`) is a FastAPI (Python web framework) service with one 
job: compute conservation metrics for a **custom polygon** a user drew on the 
map. Most of what the app shows: known-AOI numbers, layer definitions, solutions comes straight from Blob-served manifests (see "What 'the catalog' is" below). To do that one job, the backend still needs to know which rasters and species matrices to load — that's what `manifest.json` tells it:

- **`manifest.json` — the registry for one catalog version.** This is the file `hydrate` reads. It lists every feature raster (land cover, protected areas, carbon, water, and so on), the species matrices, the reference grid, and checksums for **one specific catalog version** — today that's **3.7.0** (`releases/catalog-v3-7-0/manifest.json` on Vercel Blob). Bump the catalog version, and this is the file that changes: it points hydrate at a different set of layers to download. `DMT_MANIFEST_URL` (with `MANIFEST_BLOB_URL` as a fallback — see "The two pointers" above) is the env var that tells the backend which version's manifest to hydrate from.
- **Live AOI (Area of Interest) endpoints — what actually runs on a click.** Once hydrate has filled the volume from that manifest, the API can answer:
  - `POST /metrics/custom-polygon` — takes a GeoJSON polygon, rasterizes it onto the reference grid, and returns metric values (area, land cover, protected areas, carbon, water, ecosystems, and more) computed **live**, on that request.
  - `POST /area-profile/custom-polygon` plus a `species-coverage/jobs` pair — richer species/ecosystem breakdowns, run as background jobs (an on-disk SQLite queue) since they're slower than a single request-response cycle should be.
  - `GET /health` — process is alive. `GET /ready` — the loaded manifest artifact (and the species-job worker) are actually usable; returns `503` if hydrate hasn't run yet for the configured manifest.
- **Entry point:** `backend/app/main.py`. A lifespan hook calls `warmup_artifacts()` on boot, loading the hydrated rasters and species matrices into an in-memory cache (`app/artifacts.py`) so live requests don't hit disk.
- **Shared calculators, not duplicated logic:** the backend imports its metric formulas from `data/metrics/python/metrics_pipeline`, the same package the offline pipeline (section 2) uses to precompute known-AOI numbers. One codebase computes both the "already known" (precomputed, from the manifest's batch files) and the "just drawn" (live, from `/metrics/custom-polygon`) numbers.

Stack: FastAPI, Pydantic, rasterio (raster I/O), NumPy, Shapely/PyProj (geometry) via the shared metrics pipeline.

## 1. Spin up the app

You need Docker Desktop, outbound HTTPS to public Blob, and a copy of `.env.example` → `.env`. Root Compose loads `.env` and `backend/.env` (it ignores `.env.local`). Fill Firebase in `.env` if you need login.

Hydrate downloads the rasters and species matrices the backend uses to score custom polygons. Publishing new known-AOI metrics is a separate job in section 2.

```bash
# First: fill the backend volume (about 15–25 minutes the first time)
docker compose run --rm --build backend hydrate

# Then: start both containers
docker compose up --build
```

Open **http://localhost:8080/**. Firebase Auth is tied to `localhost`; `127.0.0.1` will fail login.

| Check | Meaning |
|-------|---------|
| `curl http://localhost:8000/health` | Process is up |
| `curl http://localhost:8000/ready` | Hydrate finished. **503** means the volume is empty — run hydrate first |
| `curl http://localhost:8080/metrics-api/ready` | Frontend proxy can reach that same backend |

Flagless hydrate on the root `docker-compose.yml` uses the EPSG:9377 land-solution grid. Optional hydrate flags: `--production-v3` (Mesa / immutable production build) and `--reference-grid ecosistemas` (legacy EPSG:4326). `backend/docker-compose.yml` is a backend-only Compose file with stricter Mesa runtime gates; use the root file for first boot.

**UI-only:** `cd frontend && yarn install && yarn start` → http://localhost:4200. Known-AOI numbers load from Blob. Custom polygons go through `frontend/proxy.conf.json` to the **remote** metrics API (`https://api.decision-making-support-tool.xyz`), so you can draw areas without local Docker. To hit a local backend instead, point that proxy (or `metricsApiBaseUrl`) at it.

### Two containers

| Container | Port | Job |
|-----------|------|-----|
| `frontend` | 8080 | Serves the SPA. Proxies `/metrics-api/` to the backend. |
| `backend` | 8000 | Custom-AOI math. Needs the volume hydrate filled. |

If you later run them as separate repos, set `METRICS_API_UPSTREAM` on the frontend container (nginx target; default `http://backend:8000` only works on a shared Compose network), **or** bake `METRICS_API_BASE_URL` to a full backend origin and set `DMT_CORS_ORIGINS` on the backend.

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

- A **catalog release** is the tiny index (today `catalog-releases/3.0.6/catalog-release-index.json`). It lists batch `manifestUrl`s. Current default: **two** batches, national and SIRAP. The format allows more or fewer.
- A **batch manifest** is the fat JSON: map layers, solutions, and `precomputedMetricUrls` (compact metrics, goals, MEC geography shards, species-coverage shards). Those shards are **other** JSON files. The manifest is an index of those files.
- The **live layer manifest** (`manifest/manifest.json`) is a third file. Hydrate reads it. It can include `hydrationPackage` (grid, species matrices, metric-layer paths). `generate:layer-manifest` expands that package from the hand-edited template `frontend/shared/hydration-package.json`.

You choose a version by pointing a URL at one tiny index. Committed copies live in `frontend/layer-manifest/catalog-releases/` (3.0.1–3.0.6). There is no `latest.json` that auto-tracks the newest.

Name future catalogs with a version (`3.0.7`, a date). `*-land-use-aoi-test` is a leftover path that 3.0.6 still lists. “Tested locally” means you pointed your env at a candidate URL, then made that same URL official.

### The two pointers (easy to mix up)

| Who should change | Environment variable | Default if empty | What moves |
|-------------------|----------------------|------------------|------------|
| **What the SPA shows** | `CATALOG_RELEASE_INDEX_BLOB_URL` in `.env` (Docker/Vercel build). For `yarn start`, also `catalogReleaseIndexBlobUrl` in `frontend/src/environments/environment.ts`. | `https://aagibolq28slyfof.public.blob.vercel-storage.com/catalog-releases/3.0.6/catalog-release-index.json` | Solutions, known-AOI dashboard numbers |
| **What custom polygons calculate against** | `MANIFEST_BLOB_URL` or `DMT_MANIFEST_URL` in `.env` / `backend/.env` | `https://aagibolq28slyfof.public.blob.vercel-storage.com/releases/catalog-v3-2-0/manifest.json` | Hydrate recipe (`hydrationPackage`) |

These names drifted. Mentally: first var = **frontend catalog index**, second = **hydrate layer manifest**. Bump only the pointer for the surface that changed.

- New dashboard / known-AOI numbers, same custom-AOI grid → change the **frontend** pointer, rebuild the frontend. Skip hydrate if `hydrationPackage` inputs did not change.
- New custom-AOI rasters or species matrices, same SPA catalog → change the **hydrate** pointer (or publish live `manifest/manifest.json`) and re-run hydrate.
- Official cutover of both → update both, rebuild frontend, hydrate.

Plain `yarn start` reads `environment.ts`. Keep that file in sync with the official frontend pointer unless you are deliberately previewing another catalog.

## 2. Publish new metrics

The metrics release is a sequence of related artifact builders, not one script. Python calculates the data. Node.js manifest scripts only point the app at data that has already been calculated.

### Mental model

- The unit of work is **one solution**. Unless a diagnostic flag narrows the run, each national solution output contains `national`, `departments`, `municipalities`, `siraps`, `runaps`, and `omecs`.
- A **summary metric** is one value shown on an Overview or Area of Interest panel, such as Species Groups Protected.
- **Species Coverage Breakdowns** are the per-species records shown in species popup modals.
- **Ecosystem Coverage Breakdowns** are the per-ecosystem records shown in ecosystem popup modals.
- Summary metrics and coverage breakdowns are separate artifacts. Producing a breakdown does not automatically populate its related summary metric.

National and SIRAP (Sistema Regional de Áreas Protegidas, regional) solutions use the same Python pipeline, with solution-domain and regional-packet branches inside the scripts. They are published as separate batch manifests.

### Production sequence

 | Step | Script | Output and metric ownership | Observed timing |
|------|--------|-----------------------------|-----------------|
| 1. Calculate regular detailed metrics | `main.py` | Writes one detailed metrics document per solution with general summary metrics: area and priority, land use, carbon, water, protected-area overlaps, social/governance areas, marine summaries, regular ecosystem summaries, `conservation_goals_met`, and the ten land-species summaries listed below. Passing `--skip-species` leaves those ten species summaries unfinished with `derivation_needed`. | One gold land solution, all six geographies, Apple M2 Max: **7 min 14 sec** with `--skip-species`. The production 8,300-species path is currently blocked; see the timing note below. |
| 2. Calculate Species Coverage Breakdowns | `run_species_goals_full_build.py` using `species_goals.py` | Uses Calculator A sparse matrices to write per-species coverage records for each solution and geography. These records power species popup modals. This step does **not** write the ten regular species summary metrics. | Same gold solution: about **45 sec generation + 34 sec validation**. Historical 168-solution run: about **2 hours with six workers**. |
| 3. Reconcile deferred species summaries | Complete reconciliation command does not exist yet | Required after `main.py --skip-species`. It must derive all ten summaries from validated Species Coverage Breakdowns, update detailed and compact regular outputs, and leave non-species metrics unchanged. Existing backfills restore only selected metrics and do not complete this stage. A production release must not treat skipped species as complete until this stage succeeds. | Not available until the command exists. |
| 4. Calculate Ecosystem Coverage Breakdowns | `mec_compact.py` | Writes land-only MEC (Mapa de Ecosistemas de Colombia, Colombia's ecosystem map) shards per solution and geography. These power ecosystem popup modals and are separate from the regular ecosystem summary metrics written by `main.py`. | Not benchmarked. |
| 5. Build conservation-goal breakdowns | `conservation_goals.py` | Reshapes Prioritizr summary CSV files into per-feature target, held, shortfall, and met records. It calculates display rollups such as met count, total count, percent met, feature-type groups, and species taxonomic groups; it does **not** independently recalculate held coverage from rasters. The app uses this sidecar in the Overview **Conservation target progress** widget and its breakdown modal. The separate **Targets Achieved** Overview card reads the regular `conservation_goals_met` summary written by `main.py`, which also comes from Prioritizr-derived summary values. | Not benchmarked. |
| 6. Create compact regular metrics | `compact_metrics.py` | Converts the detailed regular metrics into the smaller format loaded by the dashboards. It changes format only; it does not calculate or repair metrics. | Not benchmarked. |
| 7. Inspect, assemble, publish, and verify | `inspect_metrics.py`, `assemble_solution_release.py`, `publish.py`, `verify_artifacts.py` | Validates completed artifacts, assembles the release, uploads it to Blob, and verifies the uploaded bytes. Use `publish.py --dry-run` first. Publication requires `BLOB_READ_WRITE_TOKEN` in `.env.local`. | Depends on artifact count and network conditions; not benchmarked. |
| 8. Update app manifests | `frontend/layer-manifest/*.mjs` | Points the app at the published regular, Species Coverage Breakdown, Ecosystem Coverage Breakdown, and conservation-goal artifacts. These scripts calculate no metrics. | Not benchmarked. |

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
- **SPA / known-AOI numbers:** publish fat national and SIRAP **batch** manifests whose `precomputedMetricUrls` point at the published regular and breakdown artifacts from steps 1–6. For a new catalog version, also publish a **new tiny index** at `catalog-releases/<version>/catalog-release-index.json`. Point `CATALOG_RELEASE_INDEX_BLOB_URL` and, for an official release, `environment.ts` at it. Rebuild the frontend.
- **Custom polygons:** `yarn --cwd frontend generate:layer-manifest` refreshes `hydrationPackage` from `frontend/shared/hydration-package.json`. `publish:layer-manifest` updates live `manifest/manifest.json` — the file hydrate reads.

**Known exception:** if a release introduces a layer ID the left sidebar hasn't seen before (a new SIRAP packet's naming, for example), updating manifests alone isn't enough — the sidebar's `LAYER_ID_SYNONYM_GROUPS` (`frontend/src/app/features/left-sidebar/map-layers-panel/map-layers-panel.utils.ts`) is a hardcoded alias table, not manifest-driven, and needs a matching code change. This is a known inconsistency (the same layer gets different ID tokens from different pipeline producers) rather than intended behavior.

**Rehydrate** only if custom-AOI inputs changed (`docker compose run --rm --build backend hydrate`, then `docker compose up -d --build --force-recreate`).

Prefer **new Blob paths** (a new release prefix and tiny index) when numbers change. Metric JSON is cached for a long time, so overwriting the same URL can leave browsers on old bytes. A hard refresh is only a maybe.

A normal release uses the steps above. `publish_land_use_aoi_test_catalog.py` is an old one-off that writes `*-land-use-aoi-test` prefixes on purpose — don't confuse it with the real pipeline.

Full command syntax and flags for every script above: `docs/handoffs/parques-it/english/data-operations/metrics-and-artifacts.md`.

## Deployment

Vercel still auto-deploys the frontend on push. Docker above is the self-host path (both containers).

```bash
docker build -f backend/Dockerfile -t dmt-backend .
docker build --platform linux/amd64 -f backend/Dockerfile -t dmt-backend:amd64 .
docker build -f frontend/Dockerfile -t dmt-frontend .
docker build --platform linux/amd64 -f frontend/Dockerfile -t dmt-frontend:amd64 .
```

CI builds both images on `ubuntu-latest` (x86) and smokes `/health` plus `/ready` against a tiny fixture.

## Key technologies

- **Frontend**: Angular, TypeScript, Tailwind CSS, ArcGIS Maps SDK
- **Backend**: FastAPI, Python
- **Maps**: @arcgis/core, @arcgis/map-components
- **Data**: GeoTIFF rasters, CSV metadata, i18n (English/Spanish)
- **Deploy**: Vercel (frontend), Docker Compose (self-hosted frontend + backend)
