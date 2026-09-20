[← Back to handoff overview](../README.md)

# Installation and Configuration Manual

Cite this file on PNNC (Parques Nacionales Naturales de Colombia) form E3-FO-35 as the Installation/Configuration Manual.

This page is repository-derived. It does not invent licenses, service-level agreements, or tests that have not been run. Platform ownership (Vercel project settings, DNS, metrics VM) still needs confirmation in [architecture.md](../architecture.md#architecture-decisions-requiring-validation).

## Purpose and audience

This manual tells GTIC (Grupo de Tecnologías de Información y Comunicaciones) how to install, configure, verify, and roll back the Decision Making Tool.

Use it to stand up a local Docker pair, run a UI-only frontend, or recognize the production hosts that exist today. Functional user manuals, ANS (Acuerdo de Nivel de Servicio) terms, and a formal security-test package are not this document. Those remain open in [requirements-traceability.md](../requirements-traceability.md).

Authoritative command text lives in the [repository README](../../../../../README.md), [frontend/README.md](../../../../../frontend/README.md), and [backend/README.md](../../../../../backend/README.md). System picture: [architecture.md](../architecture.md).

## What gets installed

Four pieces make the running system. Only the first two can be installed on a GTIC host. Firebase and Vercel Blob are managed SaaS (software as a service) that the app calls over HTTPS.

| Piece | What it is | Where it runs | Operator action |
| --- | --- | --- | --- |
| Angular SPA (single-page application) | Map, solution finder, dashboards, sign-in UI | Local: Docker nginx on port 8080, or `yarn start` on port 4200. Production: Vercel static hosting. | Build and serve. Production is not the Docker image. |
| FastAPI metrics API | Live metrics, area profiles, and species-coverage jobs for drawn custom AOIs (areas of interest) | Local: Docker on port 8000. Production: Docker Compose on a separate VM (virtual machine). | Hydrate the raster volume, then run the container. |
| Firebase Authentication and Firestore | Google sign-in, access requests, approved-user tiers | Google Cloud project `dises-decision-making-tool` | Configure client keys and authorized domains. Nothing is installed on the app VM. See [cybersecurity.md](../cybersecurity.md#firebase-project-transfer-checklist). |
| Vercel Blob | Public manifests, GeoTIFFs, boundaries, solutions, precomputed metrics | Store `decision-making-tool-blob` at `https://aagibolq28slyfof.public.blob.vercel-storage.com` | Point catalog/hydrate URLs at published paths. A write token is for publishing, not first boot. |

Known administrative AOIs read precomputed JSON from Blob. Drawn custom polygons call the FastAPI service, which reads rasters from its local volume. Optimization (Prioritizr) is offline and is not installed with this app. The archived stack under `legacy-r-shiny-app/` is out of scope.

Self-host Docker (both containers) is documented in the [repository README](../../../../../README.md). Production today keeps the SPA on Vercel and only the metrics API in Docker. [architecture.md](../architecture.md) states that production fact.

## Minimum vs recommended hardware

Planning figures, not a certified spec. Host RAM and container stats on the live VM were not measured. Source: [performance-results-2026-09-07.md](../performance-results-2026-09-07.md#hardware-and-software-recommendation).

Do not reuse 2025 R/Shiny sizing. Those numbers described a different stack.

| Role | Minimum (planning start) | Recommended if several people draw AOIs | Notes |
| --- | --- | --- | --- |
| Metrics VM (FastAPI + Docker) | 4 vCPU, ≥8 GB RAM, ≥20 GB artifact disk, one Uvicorn worker | 8 vCPU / 16 GB RAM, same disk class | Do not size below about 8 GB RAM. `/ready` already holds ~2.4 GB species memmap plus 16 rasters, plus OS/Docker/Uvicorn. Image is `python:3.11-slim`. |
| Frontend production host | None on a GTIC VM | Stay on Vercel until a self-host decision is made | Production SPA is static files on Vercel. The Docker frontend image is the self-host path. |
| Operator workstation (UI-only `yarn start`) | Node 22 + Yarn 4; enough RAM for `ng serve` | Same, plus Docker Desktop if you also hydrate locally | First hydrate is about 15–25 minutes and needs outbound HTTPS to public Blob. |
| End-user client | Modern browser with Canvas and WebGL | Same | Outbound HTTPS to the SPA, Blob, Firebase/Google, ArcGIS dependencies, and the metrics API. |

Blob object storage is **364 GiB** measured 18 Sep 2026 (52,347 files; about 350 GiB is historical `releases/`). That is not the metrics-VM disk floor. See [architecture.md](../architecture.md#runtime-and-deployment-requirements) and [system-administration.md](./system-administration.md#hardware-sizing).

Species-coverage jobs are a one-worker queue (about 10 queued slots). Twenty unique jobs at once produced HTTP 429s in the 7 September 2026 probe. There is no user research yet on how often people draw custom AOIs.

## Prerequisites

| Prerequisite | Why | Evidence |
| --- | --- | --- |
| Docker and Docker Compose | Local/self-host and the metrics VM | Root [docker-compose.yml](../../../../../docker-compose.yml); [backend/docker-compose.yml](../../../../../backend/docker-compose.yml) for backend-only VM ops |
| Node.js 22 | Frontend image and CI toolchain | [frontend/Dockerfile](../../../../../frontend/Dockerfile) (`node:22-bookworm-slim`); [architecture.md](../architecture.md#runtime-and-deployment-requirements) |
| Yarn 4.18.0 via Corepack | Frontend install and `yarn start` | `packageManager` in [frontend/package.json](../../../../../frontend/package.json); [frontend/README.md](../../../../../frontend/README.md) |
| Python 3.11 in the container | FastAPI image | [backend/Dockerfile](../../../../../backend/Dockerfile) (`python:3.11-slim`). CI also tests 3.12. Do not treat 3.12 as the verified container runtime until the Dockerfile matches. |
| Outbound HTTPS | Hydrate, Blob GETs, Firebase, ArcGIS, production API | [repository README](../../../../../README.md); [architecture.md](../architecture.md#runtime-and-deployment-requirements) |
| Copy of [`.env.example`](../../../../../.env.example) → `.env` | Compose and frontend build args | Root Compose loads `.env` and `backend/.env`. It ignores `.env.local`. Fill Firebase in `.env` if you need login. |

A host Python venv is optional. Hydrate runs inside the backend image. `backend/docker-compose.yml` is a backend-only file with stricter Mesa runtime gates; use the root Compose file for first boot.

## Environment variables

Names only. Never print, paste, or log values. Copy from [`.env.example`](../../../../../.env.example) and, on a backend-only VM, [backend/.env.example](../../../../../backend/.env.example). Full category list: [architecture.md](../architecture.md#configuration-categories). Publish/rollback names: [publishing-and-rollback.md](../data-operations/publishing-and-rollback.md#environment-variable-names).

Two pointers are easy to mix up. Set both explicitly. Committed defaults differ across README, Compose, and `.env.example` comments (catalog 3.0.5 / 3.0.6 / 3.3.0 / 3.6.0 appear in different files).

| Who should change | Variable | What it points at |
| --- | --- | --- |
| What the SPA shows | `CATALOG_RELEASE_INDEX_BLOB_URL` | Tiny catalog-release index (solutions and known-AOI numbers). For `yarn start`, also `catalogReleaseIndexBlobUrl` in `frontend/src/environments/environment.ts`. |
| What custom polygons calculate against | `MANIFEST_BLOB_URL` or `DMT_MANIFEST_URL` | Hydrate layer manifest (`hydrationPackage`) |

### Frontend / Firebase (build-time on Docker and Vercel)

| Name | Role |
| --- | --- |
| `FIREBASE_API_KEY` | Firebase web client |
| `FIREBASE_AUTH_DOMAIN` | Firebase web client |
| `FIREBASE_PROJECT_ID` | Firebase web client |
| `FIREBASE_STORAGE_BUCKET` | Firebase web client |
| `FIREBASE_MESSAGING_SENDER_ID` | Firebase web client |
| `FIREBASE_APP_ID` | Firebase web client |
| `FIREBASE_MEASUREMENT_ID` | Optional Analytics measurement id |
| `ACCESS_REQUEST_NOTIFICATION_EMAIL` | Optional access-request notification |
| `GOOGLE_CLIENT_ID` | Optional Google client id |
| `SIRAP_MANIFEST_BLOB_URL` | Optional SIRAP (Sistema Regional de Áreas Protegidas) batch override |
| `BLOB_ASSET_PROXY_PATH` | Optional Blob proxy hook; no complete institutional proxy implementation was found |
| `METRICS_API_BASE_URL` | Browser path or origin for custom-polygon calls. Compose bakes `/metrics-api`. |
| `ENABLE_MANIFEST_EDITOR` | Retired in-app editor. Docker sets `false`. Do not enable in production. |
| `METRICS_API_UPSTREAM` | Frontend-container nginx target for `/metrics-api/` (runtime; default `http://backend:8000`) |

### Backend runtime

| Name | Role |
| --- | --- |
| `DMT_ARTIFACT_DIR` | National runtime-artifact directory |
| `DMT_ARTIFACT_MANIFEST` | Artifact manifest path |
| `DMT_SIRAP_ARTIFACT_ROOT` | SIRAP regional artifact root |
| `DMT_SPECIES_BITSET_INDEX_URL` | Public species-bitset index URL |
| `DMT_ARTIFACT_REQUIRED` | `true` fails `/ready` when artifacts are missing (Compose default) |
| `DMT_MESA_COVERAGE_REQUIRED` | Mesa coverage gate (Compose default `false`) |
| `DMT_EXPECTED_COVERAGE_RELEASE_ID` | Optional coverage-contract pin |
| `DMT_EXPECTED_COVERAGE_CONTRACT_SHA256` | Optional coverage-contract pin |
| `DMT_SOLUTION_CACHE_DIR` | Solution cache directory |
| `DMT_CUSTOM_POLYGON_JOB_DB` | SQLite path for species-coverage jobs |
| `DMT_OPS_TOKEN` | Internal ops probe. Not a GTIC user-facing feature. |
| `DMT_CORS_ORIGINS` | Extra CORS (Cross-Origin Resource Sharing) origins. Production hosts must be listed. |
| `DMT_MAX_POLYGON_VERTICES` | Vertex cap (default `5000`) |
| `DMT_MAX_POLYGON_AREA_KM2` | Area cap (default `2200000`) |
| `DMT_RATE_LIMIT_PER_MINUTE` | In-process cap on expensive POSTs (default `30`; `0` disables) |
| `DMT_ARTIFACT_SCHEMA_VERSION` | Expected artifact schema (backend default `metrics-artifact-manifest/v1`) |
| `DMT_METRICS_PIPELINE_PATH` | Shared pipeline path (image sets `/metrics_pipeline`) |
| `DMT_RELEASE_SPECS_DIR` | Release-spec path (image sets `/data/metrics/release-specs`) |
| `BLOB_READ_WRITE_TOKEN` | Blob writes. Hydrate only needs outbound HTTPS to public Blob. Never print the value. |

If the containers later run on separate networks, set `METRICS_API_UPSTREAM` on the frontend container, or bake `METRICS_API_BASE_URL` to a full backend origin and set `DMT_CORS_ORIGINS` on the backend.

## Local Docker install

Work from the repository root. First-time hydrate fills the backend volume (about 15–25 minutes).

1. Copy [`.env.example`](../../../../../.env.example) to `.env`. Fill Firebase names if you need login. Root Compose does not read `.env.local`.
2. Hydrate, then start both services:

```bash
docker compose run --rm --build backend hydrate
docker compose up --build
```

3. Open **http://localhost:8080/**. Firebase Auth is tied to `localhost`. **http://127.0.0.1:8080/** will fail login.

Flagless hydrate on the root [docker-compose.yml](../../../../../docker-compose.yml) uses the EPSG:9377 land-solution grid. Optional flags: `--production-v3` (Mesa / immutable production build) and `--reference-grid ecosistemas` (legacy EPSG:4326). Extra flags pass through to `backend/scripts/build_runtime_artifact.py`.

| Check | Meaning |
| --- | --- |
| `curl http://localhost:8000/health` | Backend process is up |
| `curl http://localhost:8000/ready` | Hydrate finished. HTTP 503 means the volume is empty — run hydrate first |
| `curl http://localhost:8080/health` | Frontend nginx is up |
| `curl http://localhost:8080/metrics-api/ready` | Frontend proxy can reach that same backend |

| Container | Port | Job |
| --- | --- | --- |
| `frontend` | 8080 | Serves the SPA. Proxies `/metrics-api/` to the backend. |
| `backend` | 8000 | Custom-AOI math. Needs the hydrated volume. |

Root Compose mounts named volumes `backend-artifacts` and `backend-cache`. The frontend image disables the Vercel-only manifest editor. Standalone image builds and the x86 CI smoke of `/health` plus `/ready` against a tiny fixture are in the [repository README](../../../../../README.md#deployment).

Backend-only VM shortcut (after hydrate):

```bash
DMT_ARTIFACT_REQUIRED=true docker compose -f backend/docker-compose.yml up -d --build --force-recreate
```

Useful ops: `docker compose ps`, `docker compose logs --tail=100 backend`, `docker compose restart backend`. Details: [backend/README.md](../../../../../backend/README.md#vm-deployment-smoke-operations).

## UI-only frontend

Use this when you only need the map and known-AOI dashboards, without local rasters.

```bash
cd frontend
corepack enable
yarn install
yarn start
```

Open **http://localhost:4200/**. `yarn start` syncs local solution and boundary assets, then runs `ng serve` with [frontend/proxy.conf.json](../../../../../frontend/proxy.conf.json).

Known-AOI numbers load from public Blob. Custom polygons go through that proxy to the **remote** metrics API (`https://api.decision-making-support-tool.xyz`). You can draw areas without local Docker.

To hit a local backend instead, point `frontend/proxy.conf.json` or `metricsApiBaseUrl` at it. Keep `environment.ts` in sync with the official catalog pointer unless you are deliberately previewing another catalog.

## Production shape today

Observed hosts as of 7 September 2026. Confirm Vercel project settings, DNS, and VM ownership before treating this as a GTIC-owned topology.

| Role | URL or id | Observed |
| --- | --- | --- |
| Frontend (Vercel) | `https://decision-making-tool-tau.vercel.app` | HTTP 200, title EcoPlan |
| Metrics API | `https://api.decision-making-support-tool.xyz` | `/health`, `/ready`, custom-polygon, area-profile, species jobs |
| Same-origin rewrite | `https://decision-making-tool-tau.vercel.app/metrics-api/health` | HTTP 200. Health only through this rewrite in the 7 Sep 2026 probe; do not treat it as the custom-polygon path. |
| Public Blob host | `https://aagibolq28slyfof.public.blob.vercel-storage.com` | Object GETs and coverage JSON |
| Firebase project | `dises-decision-making-tool` | Auth host `dises-decision-making-tool.firebaseapp.com` |
| Bare domain (not the API) | `https://decision-making-support-tool.xyz` | HTTP 404. One GET. |
| Intended custom domain | See [architecture.md](../architecture.md#architecture-decisions-requiring-validation) | 404 when last probed (7 Sep 2026) |

Vercel auto-deploys the frontend on push. [frontend/vercel.json](../../../../../frontend/vercel.json) rewrites `/metrics-api/:path*` to the HTTPS backend and falls back other routes to `index.html`. Production `METRICS_API_BASE_URL`, if omitted, defaults to that same-origin rewrite.

The live SPA loads a catalog-release index, then national and SIRAP batch manifests. Which index is official is a pointer decision (`CATALOG_RELEASE_INDEX_BLOB_URL`), not a second install. Architecture notes GTIC production `catalog-releases/3.0.5` and that this branch may point at a later index. Set the variable; do not assume Compose and README defaults match.

## Uninstall / rollback

### Local Docker

Stop the pair:

```bash
docker compose down
```

Remove the hydrated artifacts and job cache (this deletes custom-AOI rasters and the SQLite job database):

```bash
docker compose down --volumes
```

Named volumes are `backend-artifacts` and `backend-cache`. Backend-only Compose bind-mounts `backend/runtime-artifacts` and `backend/runtime-cache` instead; delete those directories only if you intend to discard the VM artifact copy.

### Vercel frontend

Redeploy a known-good commit. Vercel still auto-deploys the frontend on push. There is no separate uninstall step for the SaaS project in this repository.

### Published catalog / hydrate recipe

Manifest rollback restores routing metadata only. It does not recreate overwritten Blob bytes. Follow [publishing-and-rollback.md](../data-operations/publishing-and-rollback.md#rollback-playbooks). After a hydrate-input change, rebuild the volume (`docker compose run --rm --build backend hydrate --force`) and recreate the backend.

There is no automated, tested Blob/Firestore disaster-recovery procedure.

## Verification checklist after install

| # | Check | Pass |
| --- | --- | --- |
| 1 | `.env` exists; no token values appear in logs or this folder | Names only |
| 2 | `curl` backend `/health` → HTTP 200 | Process is up |
| 3 | `curl` backend `/ready` → HTTP 200 when `DMT_ARTIFACT_REQUIRED=true` | Volume hydrated; 503 means run hydrate |
| 4 | Docker pair: `curl http://localhost:8080/metrics-api/ready` → HTTP 200 | nginx proxy reaches the backend |
| 5 | Open `http://localhost:8080/` (Docker) or `http://localhost:4200/` (`yarn start`) | SPA shell loads |
| 6 | Sign-in uses `localhost`, not `127.0.0.1` | Firebase login can succeed |
| 7 | Known department/municipality dashboard numbers appear | Catalog index and Blob GETs work |
| 8 | Draw a small custom polygon only after `/ready` is 200 (Docker) | Live metrics path works. UI-only `yarn start` hits the **remote** API unless you changed the proxy. |
| 9 | Production smoke (if you are checking live hosts) | Frontend `/` and API `/health` plus `/ready` as in [performance-results-2026-09-07.md](../performance-results-2026-09-07.md) |

`/health` proves only that the process is alive. Do not return a metrics host to traffic until `/ready` succeeds when artifacts are required. Missing SIRAP regional artifacts are listed in the readiness payload and currently do not fail `/ready`. `/ready` does fail when required national artifacts are invalid or the detailed-species worker is down.

## Open gaps

| Gap | What that means for GTIC |
| --- | --- |
| No formal staging environment | There is no separate, owned staging stack. Catalog “tested locally” means an operator pointed env URLs at a candidate index. REQ-08 still asks for staging end-to-end tests. |
| Metrics VM owner pending | DNS, TLS renewal, OS patching, firewall, scaling, and artifact rebuilds have no assigned owner. Confirm before calling the current VM a GTIC service. |
| Custom domain last probed 404 | As of 7 September 2026 the Vercel app responded; the intended custom domain was 404. Bare `https://decision-making-support-tool.xyz` was also 404 and is not the API. |
| No centralized monitoring | No uptime monitor, log shipping, or alerting configuration was found in the active repository. |
| No tested disaster recovery | Blob backup automation, scheduled Firestore exports, RTO/RPO, and a tested DR procedure have no owner. |
| Catalog pointer drift | README, Compose, Dockerfile, and architecture cite different default catalog-release versions. Set `CATALOG_RELEASE_INDEX_BLOB_URL` explicitly for any official cutover. |
| Python 3.11 vs 3.12 | The container is 3.11. CI tests 3.11 and 3.12. Align before treating 3.12 as production. |
| No ANS / license / completed reception tests in this file | Do not infer SLAs, an approved license, or a finished UAT (User Acceptance Testing) campaign from this manual. |
