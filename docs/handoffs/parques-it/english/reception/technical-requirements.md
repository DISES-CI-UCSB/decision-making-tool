[← Back to handoff overview](../README.md)

# Technical Requirements Manual

**Cite this file on PNNC form E3-FO-35 as the Technical Requirements Manual (baseline).**

Audience: GTIC (Grupo de Tecnologías de Información y Comunicaciones) at PNNC (Parques Nacionales Naturales de Colombia). This page is the reception-checklist baseline: system name, status, users, layers, and connectivity. It is not a substitute for the architecture, cybersecurity, or performance documents.

For component diagrams, runtime configuration, FastAPI routes, and open infrastructure decisions, use [`architecture.md`](../architecture.md).

> **Status:** repository-derived, 18 September 2026. Production DNS ownership, Vercel project settings, and metrics-VM ownership still need Parques confirmation (see [`architecture.md`](../architecture.md#architecture-decisions-requiring-validation)). This file is the REQ-15 language-and-package baseline. It is not a complete operations manual: backup, restore, troubleshooting, and upgrade procedures are still scattered or missing.

---

## 1. Purpose

Give GTIC a single citable technical-requirements statement for software reception form E3-FO-35.

This baseline records what the deployed Decision Making Tool is today: names, status, user types, layered software, hardware, connectivity, and non-functional honesty. Depth, runbooks, and evidence live in the linked handoff pages. Do not treat this page as a frozen release package or as an ANS (Acuerdo de Nivel de Servicio / service-level agreement).

---

## 2. Application name and brief functionality

| Field | Value |
| --- | --- |
| Repository / engineering name | Decision Making Tool |
| Spanish product title (header `appTitle`) | Priorizando la Naturaleza |
| English product title (header `appTitle`) | Prioritizing Nature |
| Shipped product brand | EcoPlan (header/about logo; live Vercel document title observed as EcoPlan on 7 Sep 2026) |
| npm package | `eco-plan` `0.1.0` — package version, not an approved institutional release identity |
| Receiving institution | PNNC, via GTIC |

The application is a browser-based conservation-planning tool for Colombia. A user opens a Web SPA (single-page application), chooses among **precomputed** conservation solutions (national and SIRAP — Sistema Regional de Áreas Protegidas), visualizes them with contextual layers on an Esri ArcGIS map, inspects precomputed indicators for known administrative or conservation areas, and can request live metrics when they draw a custom AOI (area of interest). Optimization runs offline. The browser never runs Prioritizr or generates new optimization solutions.

The archived R/Shiny and Node/PostgreSQL implementation under `legacy-r-shiny-app/` is **not** part of the current production runtime.

---

## 3. Application status

**Deployed and in active use on public hosts. Not a frozen release candidate.**

| Checkpoint | Status |
| --- | --- |
| Live frontend | `https://decision-making-tool-tau.vercel.app` responded HTTP 200 on 7 Sep 2026 |
| Live metrics API | `https://api.decision-making-support-tool.xyz` served `/health`, `/ready`, and custom-polygon routes on 7 Sep 2026 |
| Approved release identity (commit, version tag, freeze date, change control) | Missing (REQ-01) |
| User Acceptance Testing (UAT) | Planned after a stable freeze; not executed ([`usability-testing.md`](../usability-testing.md)) |
| Formal load / stress / saturation / soak tests | Planned; not executed ([`performance-testing.md`](../performance-testing.md)) |
| Client-side samples | Exist (7 Sep 2026); they are not a saturation study |

Do not describe this build as the final reception version.

---

## 4. Concurrent users

**UNKNOWN.** There is no approved concurrent-user forecast, transaction mix, or peak-session figure for the current Angular / FastAPI stack.

Do **not** reuse the 2025 GTIC R/Shiny observation of three users (or 6 cores / 16 GB) as a requirement or capacity claim for this system.

What has been measured (7 Sep 2026, not a certified capacity rating):

- Species-coverage jobs are a **one-worker queue** with about **10 queued slots**. Twenty unique jobs at once produced **12 accepted** and **8 HTTP 429** refusals (`temporarily_overloaded`). That is a queue-depth limit, not a “supported user count.”
- There is no user research on how often people will draw custom AOIs. Known-solution coverage is public Blob JSON and does not use that queue.
- Frontend HTML load test: 10,000 GETs of the SPA shell in ~60 s, all HTTP 200. That is repeated document fetches, not 10,000 concurrent map users, and not a Vercel saturation test.

GTIC should treat concurrent-user capacity as **unrated** until Parques approves a forecast and formal load tests are run.

---

## 5. User / entity characterization

**Client type:** Web SPA in a modern browser (Canvas and WebGL). There is no installed desktop client and no native mobile app.

Identity is Firebase Authentication (Google sign-in). Authorization is Cloud Firestore on project `dises-decision-making-tool`. Signing in does not by itself grant SIRAP or admin privileges. TOTP (Time-based One-Time Password) multi-factor enrollment is required in-app once the user’s tier is Decision Maker or higher.

Five product roles (same set UAT will use):

| Role | How it is recognized | What they can do | What they cannot do |
| --- | --- | --- | --- |
| Guest | Not signed in | National Finder, map, AOI, and analysis | Save named scenarios; see SIRAP catalogs; open admin |
| Signed-in user | Google account, no SIRAP grant | Guest capabilities plus save / rename / recall / remove named solutions (maximum 12) in Firestore | See SIRAP catalogs; open admin |
| SIRAP user | `allowedSirapIds` has Orinoquía and/or Eje Cafetero | SIRAP solutions for granted region(s), plus signed-in saves | Open admin; use regions that were not granted |
| SIRAP regional admin | `administeredSirapIds` set, and not super-admin | Approve, deny, or revoke SIRAP **data** access for assigned region(s) only | Approve new Google/Firebase accounts; appoint other SIRAP admins; set global tier or super-admin flags |
| Super-admin | `isSuperAdmin` (also `isAdmin` / `role: admin` in Firestore) | Approve new accounts; set tier 2 vs 3; assign regional admins; grant any SIRAP data access | — |

Eight SIRAP labels exist in the product. **Only Orinoquía and Eje Cafetero currently have published catalog/access data.** Firestore rules accept only those two region IDs.

Entity using the system: conservation planners and decision makers (public guests plus approved staff). There is no documented integration with a PNNC institutional identity provider. Whether Google sign-in is acceptable is an open Parques decision.

---

## 6. Context: actors and trust boundaries

Actors and the trust boundary they sit on:

| Actor | Trust boundary |
| --- | --- |
| User browser | Untrusted client. Talks HTTPS to the SPA host, Firebase/Google identity, Firestore, public Blob URLs, ArcGIS / CDN dependencies, and (for drawn AOIs) the metrics API via the Vercel `/metrics-api` rewrite or the API origin. |
| Vercel (Angular SPA) | Presentation host. Serves static files. Rewrites `/metrics-api/*` to `https://api.decision-making-support-tool.xyz`. |
| Firebase Authentication | Identity provider (Google sign-in). Auth host: `dises-decision-making-tool.firebaseapp.com`. |
| Cloud Firestore | Authorization and user records (`users`, `accessRequests`, SIRAP grants, saved scenarios). |
| Vercel Blob | Public-read object storage for manifests, rasters, solutions, and precomputed metrics. Reads are reachable without application authentication. |
| Metrics VM (FastAPI) | Custom-AOI compute. No application authentication or production rate-limit evidence on the custom-polygon path. Species jobs: 1 worker, ~10 queued, then HTTP 429. |

Writes (role changes, leftover publisher flags) are protected more strongly than reads. Parques must decide whether public-read geospatial assets and an unauthenticated metrics API are acceptable. Detail: [`cybersecurity.md`](../cybersecurity.md).

---

## 7. Presentation / application / data layers

Versions below are **declared** in the repository (caret/range allowed unless noted). Yarn has a lockfile. Python requirements use minimum versions, not a lockfile. Do not treat undeclared patch numbers as pinned.

### Presentation layer (Web SPA)

| Field | Value |
| --- | --- |
| Software | Angular 21 (`@angular/core` `^21.2.0`; `@angular/animations` `^21.2.1`), Angular CLI / build `^21.2.0` |
| Language | TypeScript `~5.9.2` |
| Maps | Esri ArcGIS Maps SDK for JavaScript — `@arcgis/core` and `@arcgis/map-components` `^5.0.9` |
| Identity client | Firebase JS SDK `^12.13.0` |
| CSS | Tailwind CSS `^4.2.1` |
| Toolchain | Node.js 22 (CI and frontend Docker build image `node:22-bookworm-slim`); Yarn `4.18.0` (declared `packageManager`) |
| Production host | Vercel static SPA. **Not Dockerized in production.** Requires HTTPS and SPA fallback to `index.html` (`frontend/vercel.json`). |
| Optional self-host | `nginx:1.27-alpine` container, port **8080**, proxies `/metrics-api/` to the backend. Used by root `docker-compose.yml`, not the current Vercel production path. |
| Local UI-only | `yarn start` → `ng serve` on port **4200** |
| Manufacturer | Angular: Google LLC. ArcGIS: Esri. Hosting: Vercel Inc. nginx (self-host only): F5 / nginx. Node.js: OpenJS Foundation. |

Special requirements: modern browser with Canvas and WebGL; outbound HTTPS to the app, Blob host, Firebase/Google, ArcGIS dependencies, and the metrics API.

### Application layer (custom-area compute)

| Field | Value |
| --- | --- |
| Software | FastAPI `>=0.111`, Uvicorn `>=0.30`, Pydantic `>=2.7`, NumPy `>=1.26`, Rasterio `>=1.3` |
| Language / runtime | Python. Container image `python:3.11-slim`. CI tests Python 3.11 and 3.12. **Do not treat 3.12 as the verified container runtime.** |
| Process | One Uvicorn worker (`uvicorn app.main:app --host 0.0.0.0 --port 8000`) |
| Port | **8000** (container and current VM Compose publish) |
| Packaging | Docker + Docker Compose on a separate metrics VM |
| Manufacturer | FastAPI / Uvicorn: open-source (Encode / FastAPI project). Language: Python Software Foundation. Containers: Docker Inc. |

Special requirements: HTTPS route to port 8000; read-only national (and optional SIRAP) runtime-artifact volume; writable SQLite job-queue volume; outbound HTTPS when hydrating artifacts from Blob.

### Data layer

| Store | Software | Role | Manufacturer |
| --- | --- | --- | --- |
| Runtime catalog and assets | Vercel Blob (public-read) | Manifests, Cloud Optimized GeoTIFFs, solution rasters, precomputed metric JSON | Vercel Inc. |
| Identity | Firebase Authentication | Google sign-in | Google LLC |
| Authorization / user data | Cloud Firestore | Tiers, SIRAP grants, access requests, saved scenarios | Google LLC |
| Job state | SQLite on the metrics VM | Species-coverage queue (`DMT_CUSTOM_POLYGON_JOB_DB`) | Public-domain SQLite |
| Custom-AOI rasters | Local volume on the metrics VM | National + optional SIRAP artifact bundles | Operator-managed files (not a separate DBMS product) |

There is no application-owned PostgreSQL (or other) database in the current production path.

---

## 8. Hardware by layer

| Layer | Hardware | Notes |
| --- | --- | --- |
| Presentation | None dedicated. Vercel serves static files. | Self-host nginx on 8080 is optional and lightweight. Client hardware is a modern browser workstation or laptop. |
| Application (metrics VM) | **Do not size below about 8 GB RAM.** Planning start from the 7 Sep 2026 samples: **4 vCPU / 8 GB RAM / ≥20 GB artifact disk**, one Uvicorn worker. If several people draw AOIs: **8 vCPU / 16 GB** is the cautious next step. | `/ready` already reported ~2.4 GB species memmap plus 16 rasters. Host RAM and container stats were **not** measured over SSH. This is planning guidance, not a certified spec. |
| Data — Firestore / Firebase | Google-managed | No PNNC-owned database server. |
| Data — Vercel Blob | Vercel-managed object storage | Measured inventory **18 Sep 2026: 364 GiB / 52,347 files**. About **350 GiB** is historical `releases/`. A current working set is still **tens of GiB** (one solutions release about **75–83 GiB**). |

Do not write storage as “1–2 GB.” That was an earlier planning estimate. The live inventory and the Storage row in [`architecture.md`](../architecture.md) are **364 GiB**.

---

## 9. Internet connectivity

**Public IP: YES for both layers** that GTIC typically records on E3-FO-35 — the presentation host (Vercel) and the application host (metrics VM). Vercel Blob is also on the public internet.

| Site | DNS name | Observed (7 Sep 2026) | Publish? |
| --- | --- | --- | --- |
| Frontend (current live) | `decision-making-tool-tau.vercel.app` | HTTP 200, title EcoPlan | Yes — current production SPA |
| Metrics API | `api.decision-making-support-tool.xyz` | Health, ready, custom-polygon, area-profile, species jobs | Yes — current production API |
| Intended bare custom domain | `decision-making-support-tool.xyz` | HTTP 404 (one GET). **Not** the backend. | Not until DNS actually serves the app |
| Public Blob | `aagibolq28slyfof.public.blob.vercel-storage.com` | Object GETs | Public asset host (already published) |
| Firebase Auth defaults | `dises-decision-making-tool.firebaseapp.com`, `dises-decision-making-tool.web.app` | Identity hosts | Keep on the Firebase authorized-domain list |
| SPA rewrite (not a second API) | `decision-making-tool-tau.vercel.app/metrics-api/*` | `/health` HTTP 200; custom-polygon was not exercised through this rewrite in the 7 Sep sample | Same-origin convenience path only |

**DNS administrator: TBD.** No Parques or Spatial Lab DNS owner is recorded in this handoff. Confirm Vercel project DNS, the `decision-making-support-tool.xyz` zone, and metrics-VM TLS/DNS before treating any custom domain as production.

Client outbound HTTPS is required to the rows above plus Google identity and Esri/ArcGIS (and related CDN) origins.

---

## 10. Non-functional status

Honest reception answers. “Partial” means a control or integration exists but is incomplete for institutional acceptance.

| Topic | Status | Evidence |
| --- | --- | --- |
| Authentication / authorization | **Partial** | Google sign-in + Firestore roles + in-app TOTP for Decision Maker and above. Metrics API has no application authentication. Institutional SSO is an open Parques decision. Privileged writes are server-checked; most geospatial **reads** are public-by-URL. |
| Backup | **No** | No Blob backup automation, no scheduled Firestore export owner, no documented restore drill. Manifest publication archives the previous manifest (rollback of the active manifest only). |
| Disaster recovery | **No** | No RTO / RPO, no tested DR procedure, no ANS (REQ-14). No centralized error reporting, uptime monitor, log shipping, or alerting found in the active repository. |
| Interoperability | **Partial** | Runtime interop is Vercel + Firebase/Firestore + Vercel Blob + Esri ArcGIS + the FastAPI metrics host. **No documented interoperability with PNNC institutional systems** (identity, network, records, monitoring) — REQ-05 still needs a Parques inventory and tests. |

---

## 11. Pointers

| Need | Document |
| --- | --- |
| System picture, components, ports, configuration categories, FastAPI surface | [`architecture.md`](../architecture.md) |
| Trust boundaries, controls, risk register, Firebase transfer checklist | [`cybersecurity.md`](../cybersecurity.md) |
| Load / stress / saturation / soak **plan** and current evidence gaps | [`performance-testing.md`](../performance-testing.md) |
| Measured client-side samples (7 Sep 2026) | [`performance-results-2026-09-07.md`](../performance-results-2026-09-07.md) |
| UAT / usability plan (not yet executed) | [`usability-testing.md`](../usability-testing.md) |
| Requirement-by-requirement GTIC coverage (including REQ-15) | [`requirements-traceability.md`](../requirements-traceability.md) |
| Package index | [`README.md`](../README.md) |
