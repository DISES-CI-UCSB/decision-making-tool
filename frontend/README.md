# Decision Making Tool — Frontend

Spanish version: [README_ES.md](README_ES.md).

The Decision Making Tool is a spatial conservation prioritization platform for Colombia. People compare conservation solutions on a map. This repository is the Angular web app.

Dashboard numbers for **known** areas (national, departments, municipalities, and so on) are **precomputed** and read straight from public Vercel Blob (public object storage). When someone **draws a custom polygon**, the app asks the Metrics API (backend repository) to calculate those metrics live.

## Directory structure

| Folder | Purpose |
| --- | --- |
| `src/` | Application code |
| `public/` | Static assets served by Angular |
| `public/data/layer-manifest/` | Development-only copy of the published Blob layer manifest (ignored by Git) |
| `scripts/manifest/` | Downloads and checks that local preview copy |
| `scripts/config/` | Writes the production environment file from build-time variables |
| `docker/`, `Dockerfile`, `docker-compose.yml` | The frontend container (nginx serving the built app) |
| `feature-tests/` | Feature Behavior Tests, test runner, and test catalog (own `package.json`) |
| `docs/` | Product design docs, mockup notes, and team feedback |
| `firestore.rules`, `firebase.json` | Firestore security rules and their emulator config |
| `.husky/` | Git pre-commit hook (lint-staged) |

## Architecture

The app is an Angular single-page app (SPA — the whole UI runs as one page that swaps content in and out, no full reloads). It has three moving parts:

- **App shell** (`app.html`, `app-shell.ts`) — a resizable three-column layout: left sidebar, center map, right sidebar. One root component (`App`) assembles it and owns modals (welcome screen, Solution Finder).
- **Feature areas**, each its own folder under `src/app/features/`:
  - `solution-finder/` — the guided questionnaire that matches user answers to one of ~170 pre-built conservation scenarios.
  - `left-sidebar/` — toggles for reference layers (ecosystems, species, costs, boundaries).
  - `map/` — the ArcGIS map itself: rendering solution rasters, drawing custom AOIs (Areas of Interest), admin boundary clicks.
  - `analysis/` — the right sidebar's Overview / AOI / Comparison tabs and their metrics.
  - `auth/` — Firebase login, tier gating, SIRAP (Sistema Regional de Áreas Protegidas) access requests.
- **Shared state** — one injectable service, `AppStateService` (`core/services/app-state.service.ts`), holds cross-cutting state (active solution, selected AOI, right-sidebar mode) using Angular signals (a reactive value container, similar to an Observable but simpler to read). Every panel reads from and writes to this one service instead of talking to each other directly — that's what keeps three independent UI panels in sync.

**Data flow mirrors the precomputed-vs-live split:** known-AOI numbers and layer definitions come from versioned JSON manifests on Vercel Blob; solution rasters are ArcGIS `ImageryTileLayer`s built from COG (Cloud Optimized GeoTIFF) files; custom-polygon metrics go through the Metrics API.

Stack: Angular (standalone components, no legacy NgModules), Tailwind CSS, ArcGIS Maps SDK for JavaScript, ngx-translate for English/Spanish i18n, Firebase Auth.

## Run locally

The project uses Yarn 4 via Corepack. If you only have npm installed, run `corepack enable` first.

```bash
yarn install
yarn start
```

Open `http://localhost:4200/`. Firebase Auth is tied to `localhost`; `127.0.0.1` will fail login.

`yarn start` downloads the published layer manifest into `public/data/layer-manifest/` when the development environment uses the local copy, then runs `ng serve`. Custom polygons go through `proxy.conf.json` to the **remote** Metrics API (`https://api.decision-making-support-tool.xyz`), so you can draw areas without running the backend. To hit a local backend instead, point that proxy (or `metricsApiBaseUrl`) at it.

## Configuration

Copy `.env.example` → `.env` (Docker) or `.env.production.local` (`yarn build:vercel`). Every value is optional; empty values keep the committed production Firebase config and catalog defaults.

**Which catalog the app shows** is one pointer: `CATALOG_RELEASE_INDEX_BLOB_URL` for Docker and Vercel builds, and `catalogReleaseIndexBlobUrl` in `src/environments/environment.ts` for `yarn start`. Keep the two in sync unless you are deliberately previewing another catalog. The backend repository publishes the catalogs and explains how they fit together ("What 'the catalog' is" in its README).

**Known exception:** if a catalog release introduces a layer ID the left sidebar hasn't seen before, also update `LAYER_ID_SYNONYM_GROUPS` in `src/app/features/left-sidebar/map-layers-panel/map-layers-panel.utils.ts`. That alias table is hardcoded, not manifest-driven.

## Tests

```bash
yarn lint
yarn test                    # unit tests (Vitest)
yarn test:manifest-preview   # local preview manifest scripts
yarn test:firestore-rules    # needs Java for the Firestore emulator
```

Feature Behavior Tests live in `feature-tests/`, with their own dependencies:

```bash
cd feature-tests
npm ci
npm run test:view-test-catalog   # browse every test and its latest result
npm run test:gate                # full release gate
```

A few download tests start a local Metrics API. They expect the backend checkout next to this folder at `../backend` (set `DMT_TEST_BACKEND_DIR` otherwise) and read its service-account keys from that checkout's `secrets/` folder.

## Build

```bash
yarn build:vercel
```

This writes the production environment file from build-time variables, then runs `ng build` into `dist/eco-plan/browser/`. `METRICS_API_BASE_URL` points custom-polygon requests at the Metrics API. If it is omitted, production uses the same-origin `/metrics-api` path, which Vercel rewrites and the Docker image proxies.

## Docker

```bash
docker compose up --build
```

Or without Compose:

```bash
docker build -t dmt-frontend .
docker run --rm -p 8080:8080 -e METRICS_API_UPSTREAM=http://host.docker.internal:8000 dmt-frontend
```

Open `http://localhost:8080/`. nginx serves the app and proxies `/metrics-api/` to `METRICS_API_UPSTREAM` (this one can change without rebuilding). Its default, `http://backend:8000`, only resolves on a Compose network that also runs the backend; otherwise set it to the backend's URL. Firebase and manifest URLs are build-time args read from `.env`.

The Docker image disables the Vercel-only manifest editor (`ENABLE_MANIFEST_EDITOR=false`).

## Deployment

Vercel auto-deploys this folder on push (`vercel.json`, `.vercelignore`). The Docker image above is the self-host path.

```bash
docker build --platform linux/amd64 -t dmt-frontend:amd64 .
```

## Git hooks

Run `yarn prepare` once after cloning to install the pre-commit hook, which runs lint-staged on changed files.
