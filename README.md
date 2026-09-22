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

The backend (`backend/`) is a FastAPI (Python web framework) service with one job: compute conservation metrics for a **custom polygon** a user drew on the map.

- **`manifest.json` — the registry for one catalog version.** This is the file `hydrate` reads. It lists every feature raster (land cover, protected areas, carbon, water, and so on), the species matrices, the reference grid, and checksums for **one specific catalog version** — today that's **3.7.0** (`releases/catalog-v3-7-0/manifest.json` on Vercel Blob). Bump the catalog version, and this is the file that changes: it points hydrate at a different set of layers to download. `DMT_MANIFEST_URL` (with `MANIFEST_BLOB_URL` as a fallback — see "The two pointers" above) is the env var that tells the backend which version's manifest to hydrate from. It does not ship Colombia's multi-GB rasters inside the Docker image — that's what hydrate downloads into a mounted volume (`runtime-artifacts/`) using this manifest as its shopping list.
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

**This is many scripts, not one script.** All of them live in `data/metrics/python/metrics_pipeline/` (venv in `data/metrics/python/.venv`) unless noted. Each owns one chunk of the output; none of them talk to the app directly — that's the separate "update the manifests" step at the end.

**National and SIRAP (regional) solutions run through the same scripts**, not separate ones. Every script below branches internally on `solution.scope == "sirap"` — SIRAP solutions read different regional-packet rasters and a different land-cover encoding, but it's the same Python file and the same command. The two catalogs (national ~172 solutions, SIRAP ~56 solutions) are published as two separate **batch manifests** at the end, which is where "national" and "SIRAP" become visibly different files.

**High-level sequence:**

- **Step 1 — Calculate general metrics.** Area, land cover, carbon, water, protected areas, marine ecosystems, species summary counts. Does **not** include ecosystem coverage, conservation goals, or per-species breakdowns — those are separate steps below.
- **Step 2 — Validate and upload step 1's output.** Nothing new computed here, just checked and pushed to Blob.
- **Step 3 — Shrink step 1's output into the compact format.** This compact file, not the verbose one, is what the dashboards actually load.
- **Step 4 — Validate and upload step 3's compact output.** Same check-and-push as step 2, on the smaller files.
- **Step 5 — Calculate ecosystem coverage (MEC).** A separate, land-only calculation; uploaded by hand, not by the publish script.
- **Step 6 — Calculate conservation goal rollups.** Target/held/shortfall numbers from Prioritizr summaries; also uploaded by hand.
- **Step 7 — Calculate per-species coverage breakdowns.** The slowest step, which is why it's often split off and run separately (see `--skip-species` below).
- **Update the manifests.** Point the app's manifests at everything steps 1–7 produced. Nothing is calculated here — this is the "make it visible" step.
- **Rehydrate**, only if custom-AOI inputs changed.

| Step | Script | What it computes | Category it owns |
|------|--------|-------------------|-------------------|
| 1 | `main.py` | Per-solution, per-geography metrics: area, land cover, carbon, water, protected areas, marine ecosystems, species summary counts. This is the core calculator — the one people mean when they say "run the pipeline." | General dashboard metrics |
| 2 | `inspect_metrics.py` → `publish.py` (`--dry-run` first) → `verify_artifacts.py` | Validate the local output against a contract, upload it to Blob, then verify the uploaded bytes match. Publishing needs a Blob write token in `.env.local`. | Upload/verify step for step 1's output |
| 3 | `compact_metrics.py` | Converts step 1's verbose output into the smaller "compact" format — **this is what the dashboards actually load**, not the verbose files. | Compact wire format |
| 4 | Same inspect → publish → verify pass, run again on the compact files from step 3. | | |
| 5 | `mec_compact.py` | MEC (Mapa de Ecosistemas de Colombia — Colombia's ecosystem map) coverage shards, per solution per geography level. Land solutions only; writes local files, **uploaded by hand**, no auto-publish. | Ecosystem coverage |
| 6 | `conservation_goals.py` | Reads each solution's Prioritizr summary CSV and rolls it up into target/held/shortfall numbers. Writes local files, **uploaded by hand**. | Conservation goals |
| 7 | `species_goals.py` (used via `main.py --species-goals-*` flags, or standalone through `run_species_goals_full_build.py`) | Per-species coverage breakdowns, per solution per geography. | Species breakdowns |

**Why it's split this way:** each of these is a genuinely different, expensive computation (species coverage in particular is slow), so splitting them lets you re-run just the piece that changed instead of recomputing everything. `data/metrics/generated/releases/catalog-v3-7-0/_notes/skip_species_regular_main.py` is a real example of that from the 3.7.0 release — a wrapper that ran `main.py` with `--skip-species` overnight to get regular metrics out fast, with species backfilled separately afterward.

**Incremental / backfill flags** (this is what most of the "am I missing a step" confusion comes from): `main.py`, `compact_metrics.py`, and `mec_compact.py` all accept `--solution-id` (repeatable, run just one or a few solutions), `--cache-policy use-cache` (default — skip anything already computed) vs `--cache-policy recompute-all` (force everything), and `--chunk-count`/`--chunk-index` to split a run across workers. There are also standalone `backfill_*.py` scripts (e.g. `backfill_endemic_species_count.py`, `backfill_threatened_species_secured.py`) that patch **one specific metric** across existing output without re-running the full pipeline — reach for these instead of a full re-run when only one number is wrong.

**Update the manifests** (two separate surfaces, both need updating):
- **SPA / known-AOI numbers:** publish fat national and SIRAP **batch** manifests whose `precomputedMetricUrls` point at the new files from steps 3–7. For a new catalog version, also publish a **new tiny index** at `catalog-releases/<version>/catalog-release-index.json`. Point `CATALOG_RELEASE_INDEX_BLOB_URL` and, for an official release, `environment.ts` at it. Rebuild the frontend.
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
