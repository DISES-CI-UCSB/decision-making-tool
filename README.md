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
| **What custom polygons calculate against** | `MANIFEST_BLOB_URL` or `DMT_MANIFEST_URL` in `.env` / `backend/.env` | `https://aagibolq28slyfof.public.blob.vercel-storage.com/manifest/manifest.json` | Hydrate recipe (`hydrationPackage`) |

These names drifted. Mentally: first var = **frontend catalog index**, second = **hydrate layer manifest**. Bump only the pointer for the surface that changed.

- New dashboard / known-AOI numbers, same custom-AOI grid → change the **frontend** pointer, rebuild the frontend. Skip hydrate if `hydrationPackage` inputs did not change.
- New custom-AOI rasters or species matrices, same SPA catalog → change the **hydrate** pointer (or publish live `manifest/manifest.json`) and re-run hydrate.
- Official cutover of both → update both, rebuild frontend, hydrate.

Plain `yarn start` reads `environment.ts`. Keep that file in sync with the official frontend pointer unless you are deliberately previewing another catalog.

## 2. Publish new metrics

The pipeline **computes files**. Pointing the app at them is a later step. `main.py` is the calculator.

Typical sequence (commands and flags: `docs/handoffs/parques-it/english/data-operations/metrics-and-artifacts.md`):

1. **Compute** — `data/metrics/python/metrics_pipeline/main.py` (venv in `data/metrics/python/.venv`).
2. **Inspect, dry-run, publish, verify** that verbose output with `inspect_metrics.py`, `publish.py`, `verify_artifacts.py`. Publishing needs a Blob write token in `.env.local`.
3. **Compact** — `compact_metrics.py`, then the same inspect / publish / verify pass on the compact files (these are what the dashboards load).
4. **MEC, goals, and species coverage** — `mec_compact.py`, `conservation_goals.py`, and `species_goals.py` write local files. Upload those by hand.
5. **Wire the routers** (two surfaces)
   - **SPA / known-AOI numbers:** publish fat national and SIRAP **batch** manifests whose `precomputedMetricUrls` match the new files. For a new catalog version, also publish a **new tiny index** at `catalog-releases/<version>/catalog-release-index.json` (that file lists the batches for **that** version). Point `CATALOG_RELEASE_INDEX_BLOB_URL` and, for an official release, `environment.ts` at it. Rebuild the frontend.
   - **Custom polygons:** `yarn --cwd frontend generate:layer-manifest` refreshes `hydrationPackage` from `frontend/shared/hydration-package.json`. `publish:layer-manifest` updates live `manifest/manifest.json` — the file hydrate reads.
6. **Rehydrate** only if custom-AOI inputs changed (`docker compose run --rm --build backend hydrate`, then `docker compose up -d --build --force-recreate`).

Prefer **new Blob paths** (a new release prefix and tiny index) when numbers change. Metric JSON is cached for a long time, so overwriting the same URL can leave browsers on old bytes. A hard refresh is only a maybe.

A normal release uses the steps above. `publish_land_use_aoi_test_catalog.py` is an old one-off that writes `*-land-use-aoi-test` prefixes on purpose.

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
