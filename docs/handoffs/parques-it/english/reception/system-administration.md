[← Back to handoff overview](../README.md)

# System Administration Manual

> **Status: repository-derived operating picture for PNNC form E3-FO-35.** Spatial Lab still runs production today. Firebase project Owner transfer to PNNC-GTIC (Grupo de Tecnologías de Información y Comunicaciones at Parques Nacionales Naturales de Colombia) is pending. This page does not claim completed backups, monitoring, SLAs, or penetration tests.

Cite this file on E3-FO-35 as the System Administration Manual. For the form’s hardware-sizing study pointer, use [Hardware sizing](#hardware-sizing). For service accounts and in-app roles, use [`service-users-and-permissions.md`](./service-users-and-permissions.md).

## Purpose and audience

GTIC operators use this page to see who runs each layer, what day-2 work looks like, and which runbooks to open next. It is an operations index, not a copy of the data-publication procedures.

Related pages:

- Architecture and runtime surface: [`architecture.md`](../architecture.md)
- Firebase Owner transfer and security decisions: [`cybersecurity.md`](../cybersecurity.md)
- Data-change runbook index: [`data-operations/README.md`](../data-operations/README.md)
- Client-side measurements used for VM planning: [`performance-results-2026-09-07.md`](../performance-results-2026-09-07.md)

## Who operates what today

Two ownership layers exist, and Parques needs both before Spatial Lab steps down: Google Cloud / Firebase **project Owner**, and the in-app **super-admin** stored on `users/{uid}`. See the [Firebase project transfer checklist](../cybersecurity.md#firebase-project-transfer-checklist).

| Layer | What it is | Who operates it today | Pending PNNC-GTIC transfer |
| --- | --- | --- | --- |
| Angular SPA (single-page application) | Static frontend on Vercel | Spatial Lab Vercel project. Live host as of 7 Sep 2026: `https://decision-making-tool-tau.vercel.app`. The intended custom domain returned 404 when last probed. | Confirm whether Vercel remains the approved production host, and who owns the project, domains, and build env. |
| Vercel Blob | Public-read geospatial assets, catalogs, and generated outputs. Store name `decision-making-tool-blob`. | Spatial Lab holds `BLOB_READ_WRITE_TOKEN` and publishes releases. | Token custody, rotation, and whether public-read remains acceptable (SEC-01). |
| Firebase Authentication + Cloud Firestore | Google sign-in identity; Firestore authorization records. Project ID `dises-decision-making-tool`. | Spatial Lab still has project Owner. In-app super-admins approve accounts. | Owner, billing, authorized domains, Admin credentials, and in-app super-admins — checklist in [`cybersecurity.md`](../cybersecurity.md#firebase-project-transfer-checklist). |
| Custom-area metrics VM | FastAPI (Python web API) in Docker Compose behind Caddy TLS (Transport Layer Security). Live host: `https://api.decision-making-support-tool.xyz`. | Spatial Lab operates the VM and hydrate/recreate cycle. | DNS, Caddy certificate renewal, OS patching, firewall, scaling, and artifact rebuilds are **TBD** with PNNC. |
| Offline pipelines | Prioritizr solutions, Cloud Optimized GeoTIFFs, manifests, precomputed metrics | Spatial Lab / science publishers. Not an end-user runtime. | Assign data-publisher and scientific-reviewer roles after handoff. |
| Archived R/Shiny stack | `legacy-r-shiny-app/` | Not part of the current production path. | Formally exclude it from reception, or treat it as a separate maintenance surface. |

Do not treat leftover Spatial Lab logins as the recovery plan after step-down.

## Day-2 operations

### Vercel deploy

The frontend is a static Angular SPA. It is not Dockerized. CI uses Node.js 22; `frontend/package.json` declares Yarn 4.18.0. Production build is `yarn build:vercel` from `frontend/`.

Day-2 work on this layer:

- Deploy from the approved release commit through the Vercel project.
- Keep SPA fallback routing to `index.html`.
- Keep build-time environment variable **names** in a vault (see [`service-users-and-permissions.md`](./service-users-and-permissions.md)). Never paste values into tickets.
- Confirm authorized Firebase domains still match the live frontend host after any domain change.

The leftover Vercel serverless publisher (`frontend/api/dev/manifest-style-publish.ts`) is retired. Layer appearance in the map layers panel is the supported styling path. Do not use that endpoint as a GTIC workflow.

### Metrics VM

Docker Compose runs one Uvicorn worker (`python:3.11-slim` image). Compose exposes the API on port 8000. Caddy terminates TLS in front of that process on the live host. Caddy configuration is not in this repository.

| Check or action | What it means |
| --- | --- |
| `GET /health` | Process liveness. HTTP 200 means the process is up. |
| `GET /ready` | Readiness. HTTP 503 when required **national** runtime artifacts are missing or invalid, or when the detailed-species worker is down. Missing SIRAP (Sistema Regional de Áreas Protegidas) regional artifacts are listed in the payload and currently do **not** fail `/ready`. |
| Hydrate | `docker compose run --rm --build backend hydrate` (from the repo root or `backend/docker-compose.yml`). Downloads public Blob rasters into the mounted artifact volume. Then recreate the service with artifact loading required and re-check `/ready`. |
| TLS via Caddy | Certificate issuance and renewal for `api.decision-making-support-tool.xyz`. Owner of Caddy and OS patching is **TBD** with PNNC. |
| Species-coverage queue | One background worker, about 10 queued jobs, then HTTP 429. Internal ops probe `GET /ops/custom-polygon` is gated by `DMT_OPS_TOKEN` and is not a product UI. |

Treat `/health` as process health only. Required backend artifacts are safe for traffic only when `/ready` succeeds. Rebuild runtime artifacts after relevant raster or manifest changes, or live custom-area results can drift from precomputed Blob metrics.

### Firebase Console

Identity is Firebase Authentication (Google sign-in). Authorization is Cloud Firestore. Signing in does not grant Decision Maker, Manager, or admin privileges.

Day-2 Console work (project Owner):

- Authentication → authorized domains
- Firestore data and `firestore.rules` deploys
- Billing and IAM (Identity and Access Management)
- User approval is an **in-app super-admin** task; regional SIRAP admins cannot create new Firebase accounts

Until the [transfer checklist](../cybersecurity.md#firebase-project-transfer-checklist) is finished, Spatial Lab remains the project Owner. Scheduled Firestore exports and Authentication user exports are **not** enabled in any documented procedure.

### Blob publish

Writes to Vercel Blob require `BLOB_READ_WRITE_TOKEN`. Reads of published objects are public by URL.

Day-2 publish work is the data-operations runbooks, not this page. Manifest publication archives the previous runtime or species manifest so an operator can roll the **pointer** back. Metrics overwrites have no automatic archive.

## Data operations runbooks

Open the index, then only the matching runbook. Do not copy those procedures here.

| Need | Start here |
| --- | --- |
| Choose the smallest safe data-change path | [`data-operations/README.md`](../data-operations/README.md) |
| Add or replace a national/marine solution | [`adding-solutions.md`](../data-operations/adding-solutions.md) |
| SIRAP regional catalogs (56 scenarios: 40 Eje Cafetero, 16 Orinoquía) | [SIRAP Regional Solutions](https://docs.google.com/document/d/1mThmI_KmTT8kE2s02s_ymhdHL-BUxyIl8lxuwXJ76aM/edit?tab=t.oqw67lnj8o9t) — do not use the national adding-solutions runbook |
| Feature, cost, include, reference, or species layer | [`managing-layers.md`](../data-operations/managing-layers.md) |
| Known AOI (Area of Interest) boundaries | [`managing-aois.md`](../data-operations/managing-aois.md) |
| New or newly enabled metric | [`adding-or-enabling-metrics.md`](../data-operations/adding-or-enabling-metrics.md) |
| Known-AOI metrics, compact metrics, sparse inputs, custom-AOI artifacts | [`metrics-and-artifacts.md`](../data-operations/metrics-and-artifacts.md) |
| Publish, verify, or roll back a release | [`publishing-and-rollback.md`](../data-operations/publishing-and-rollback.md) |

Assign data-publisher, pipeline-operator, application-developer, and scientific-reviewer roles before any Blob write. A file upload is only storage until catalogs, manifests, metric artifacts, and backend runtime artifacts agree.

## Backup and disaster recovery

Current, documented state:

| Asset | What exists today | What does not exist |
| --- | --- | --- |
| Runtime layer manifest | Publish archives the previous live pointer (`manifest/archive/…` and revision paths). A rollback script can restore an archived version. | Archive of a pointer is not a full Blob restore. |
| Species manifest | Previous version archived under `manifests/archive/`. | Same limit: catalog pointer only. |
| Metrics artifacts | Prefer immutable, versioned paths. | No automatic metrics archive. Overwriting long-cache paths can leave clients on stale bytes. |
| Vercel Blob store (364 GiB measured 18 Sep 2026) | Public objects remain until overwritten or deleted. | No automated Blob backup. No tested restore. |
| Cloud Firestore (users, requests, saved scenarios) | Live database only. | No scheduled managed export, no documented point-in-time recovery, no restore drill. |
| Firebase Authentication users | Live identity store. | No documented user export. |
| Metrics VM artifacts / job SQLite | Recreatable by hydrate from public Blob, plus a writable job-queue volume. | No documented host-disk backup. |

RTO (Recovery Time Objective) and RPO (Recovery Point Objective) are **undefined**. ANS (Acuerdo de Nivel de Servicio) documents are a GTIC gap (REQ-14). A release archive is not a complete disaster-recovery plan.

Before Spatial Lab steps down, Parques should complete the backup hygiene in [cybersecurity checklist §8](../cybersecurity.md#firebase-project-transfer-checklist): scheduled Firestore exports to a private Parques bucket (include `savedSolutionScenarios`), confirm point-in-time recovery if RPO requires it, and test a restore into a non-production project if policy requires it. Store exports in a private bucket — not in public Vercel Blob.

## Monitoring and alerting

No centralized error reporting, uptime monitor, log shipping, or alerting configuration is documented in the repository.

Operators can still probe:

- Frontend HTTP from the Vercel host
- `GET /health` and `GET /ready` on the metrics VM
- Vercel and Firebase Console dashboards (platform defaults; not a Parques-owned alert policy)

Budget-alert recipients on the Firebase billing account still need a Parques cost center after transfer. There is no documented on-call roster.

## Hardware sizing

This section is the E3-FO-35 “Hardware sizing study” pointer. Figures are **planning guidance** from [`performance-results-2026-09-07.md`](../performance-results-2026-09-07.md) plus a Blob inventory on 18 Sep 2026. They are not a certified spec. Host RAM and container stats were not measured on the VM. Firebase load, quota, and saturation tests have not been run.

| Layer | What to size | Planning figure | Notes |
| --- | --- | --- | --- |
| Presentation (Vercel SPA) | No application VM | Managed HTTPS static hosting | 10,000 HTML GETs in 60.1 s all HTTP 200 (~166/s). Load test of the shell, not a Vercel saturation test and not 10,000 map users. |
| Identity / authorization | No server disk | Managed Firebase / Firestore | Small access records. No Firebase capacity study. |
| Object storage (Vercel Blob) | Object-store capacity, not a database disk | **364 GiB** across 52,347 files, measured 18 Sep 2026 | GiB means gibibyte (1024³ bytes). About 350 GiB sits in historical `releases/` snapshots; a current working set is still tens of GiB (one solutions release is about 75–83 GiB). Architecture’s earlier ~1–2 GB line was a planning estimate, not this inventory. |
| Metrics VM (custom AOI) | Host class for Docker + artifacts | Start at **4 vCPU / 8 GB RAM / ≥20 GB artifact disk**, one Uvicorn worker | `/ready` already holds ~2.4 GB species memmap plus 16 rasters. Do not size below about 8 GB RAM. If several people draw AOIs: **8 vCPU / 16 GB**. Species queue refused at 20 unique jobs at once (12 accepted, 8× HTTP 429). |
| Client workstation | Modern browser with Canvas and WebGL | Not sized here | Probe laptop for the 7 Sep 2026 run was a 32 GB M2 Max MacBook; that is the measurement client, not a user requirement. |

Do not reuse the 2025 GTIC R/Shiny figures (6 cores / 16 GB / 3 users). Those describe the archived stack.

Custom-AOI compute is the limiter when someone draws a polygon. Known-solution coverage tables are public Blob JSON and were cheap from the probe laptop. There is no user research yet on how often custom drawing will be used.

## Incident contacts

**TBD with PNNC.** No institutional on-call list, severity matrix, or escalation path is recorded in this repository.

Until the Firebase step-down checks pass, Spatial Lab remains a break-glass contact for a short agreed window, then that window closes. After transfer, leftover Spatial Lab Owner accounts must be downgraded or removed (never remove the last Owner) and Admin / Blob credentials Spatial Lab held must be rotated.

## Open gaps

1. Firebase project Owner, billing, authorized domains, and in-app super-admins are not yet transferred to PNNC-GTIC.
2. No automated Vercel Blob backup; no scheduled Firestore export; no tested restore; RTO/RPO undefined.
3. No documented monitoring, log shipping, or alerting.
4. Metrics VM OS patching, Caddy renewal, DNS, firewall, and scaling owners are TBD with PNNC.
5. No ANS / SLA, no incident-response runbook, no vulnerability-scan or penetration-test evidence (REQ-09, REQ-14, SEC-05).
6. Public unauthenticated reads of Blob assets and the unauthenticated metrics API remain open policy questions (SEC-01, SEC-02).
7. Vercel as an approved production platform, WAF (Web Application Firewall), custom domain, and security-header baseline for the metrics host are still institutional decisions.
8. Formal UAT (User Acceptance Testing) and a frozen release identity are planned, not executed.
