[← Back to handoff overview](../README.md)

# FAQ and common problems

> **Audience:** GTIC (Grupo de Tecnologías de Información y Comunicaciones) operators.  
> **Status: repository-derived.** Answers and incidents below are taken from the current handoff and READMEs. This page does not invent outages, Common Vulnerabilities and Exposures (CVE) identifiers, or production user counts.

This file covers two reception items: frequently asked questions, and common problems with what to do. Entity stores are in [`data-model.md`](./data-model.md).

---

## Frequently asked questions

### 1. What is this product?

The Decision Making Tool is a browser-based conservation-planning application for Colombia. People compare **precomputed** conservation solutions on a map, inspect indicators for known administrative or conservation areas, and request live metrics when they draw a custom area of interest (AOI). The browser never runs Prioritizr (the offline optimization solver) and never generates a new optimization solution.

See [`architecture.md`](../architecture.md#system-purpose) and the [repository `README.md`](../../../../../README.md).

### 2. Where is it hosted?

The **active** production path is:

| Piece | Host / location (as documented) |
| --- | --- |
| Web application | Angular single-page application on **Vercel**. As of 7 September 2026 the live app responded at `decision-making-tool-tau.vercel.app`. The frontend is not Dockerized on Vercel. |
| Intended custom domain | `decision-making-support-tool.xyz` — **HTTP 404 when last probed** (one GET). Confirm DNS before treating it as the production URL. |
| Geospatial assets | Public-read **Vercel Blob** (`https://aagibolq28slyfof.public.blob.vercel-storage.com`) |
| Identity | Firebase project `dises-decision-making-tool` (public client fields in `frontend/src/environments/environment.production.ts`) |
| Custom-area API | FastAPI on a **separate VM**, Docker Compose, port **8000**. Documented public hostname: `https://api.decision-making-support-tool.xyz` |
| Self-host path | Root Docker Compose: frontend **8080**, backend **8000** |

Platform ownership (Vercel project settings, VM, DNS, TLS) still needs Parques confirmation. See [`architecture.md`](../architecture.md#architecture-decisions-requiring-validation).

### 3. How does login work?

**Identity** is Firebase Authentication with **Google** sign-in. **Authorization** is Cloud Firestore (`users/{uid}`). A person can sign in and still be pending until a super-admin approves `accessRequests/{uid}` into an active user record.

The national product works **without** signing in (Guest). Google is required to request and use SIRAP (Sistema Regional de Áreas Protegidas) scopes and to save named scenarios.

Authorized domains must include `localhost` and the live frontend host. A missing domain looks like a broken login. See [`cybersecurity.md`](../cybersecurity.md#firebase-project-transfer-checklist) and [`usability-testing.md`](../usability-testing.md#guest-finder-and-empty-state-quirks-testers-will-hit).

### 4. Why are some layers public?

Published geospatial assets and generated outputs are **publicly readable by URL**. Writes are protected (Firebase token, Firestore role, deployment flags). Reads are protected only by being unlisted, not by an application access check.

This is a **policy decision for Parques** (SEC-01), not a misconfigured bucket that the app accidentally left open. See [`cybersecurity.md`](../cybersecurity.md#findings-and-risk-register).

### 5. How does a custom AOI differ from a known AOI?

| | Known AOI | Custom (drawn) AOI |
| --- | --- | --- |
| What the user selects | National, department, municipality, SIRAP, RUNAP (Registro Único Nacional de Áreas Protegidas), or OMEC (Otras Medidas de Conservación) | A polygon or multipolygon the user draws |
| Where numbers come from | **Precomputed** JSON on Vercel Blob (`precomputedMetricUrls`) | **Live** FastAPI: `POST /metrics/custom-polygon` or `POST /area-profile/custom-polygon` |
| Registration | Published boundary catalogs | Not registered as a catalog geography |
| Species detail | Blob shards where published | Optional queued species-coverage job on the VM |

See [`managing-aois.md`](../data-operations/managing-aois.md) and [`architecture.md`](../architecture.md#core-user-workflow).

### 6. Which Docker ports does an operator use?

| Surface | Port | Notes |
| --- | --- | --- |
| Frontend container | **8080** | Serves the SPA; proxies `/metrics-api/` to the backend. Open `http://localhost:8080/`. |
| Backend container | **8000** | Custom-AOI math. `GET /health` and `GET /ready`. |
| UI-only `yarn start` | **4200** | Known-AOI numbers from Blob. Custom polygons go to the **remote** metrics API unless the proxy is pointed at a local backend. |

Firebase Auth is tied to the hostname `localhost`. See the [repository `README.md`](../../../../../README.md#two-containers) and [`backend/README.md`](../../../../../backend/README.md).

### 7. What is the difference between hydrate and publish?

They are **two jobs**. Mixing them up is the most common operator confusion.

- **Hydrate** fills the backend volume with rasters and species matrices so custom polygons can be scored. First run is about 15–25 minutes. Command: `docker compose run --rm --build backend hydrate`, then `docker compose up --build`. Pointer: `MANIFEST_BLOB_URL` / `DMT_MANIFEST_URL` (the hydrate layer manifest).
- **Publish** computes and uploads **known-AOI** metric files and the catalogs the SPA reads. Needs a Blob write token in `.env.local` (never print the value). Pointer: `CATALOG_RELEASE_INDEX_BLOB_URL` (the tiny catalog-release index).

New dashboard numbers with the same custom-AOI grid: change the **frontend** pointer and rebuild; skip hydrate if `hydrationPackage` inputs did not change. New custom-AOI rasters: change the **hydrate** pointer and re-run hydrate.

See [repository `README.md`](../../../../../README.md) sections 1–2 and [`metrics-and-artifacts.md`](../data-operations/metrics-and-artifacts.md).

### 8. Spanish or English?

Production default language is **Spanish** (`defaultLanguage: 'es'` in `environment.production.ts`). The UI has English and Spanish copy (`frontend/public/i18n/en.json`, `es.json`). UAT plans expect testers to switch language without losing workflow state. Formal Spanish user manuals are still a documented gap (REQ-16).

See [`usability-testing.md`](../usability-testing.md) and [`adding-or-enabling-metrics.md`](../data-operations/adding-or-enabling-metrics.md).

### 9. Which SIRAP regions exist?

The product mentions eight SIRAP labels. **Only Orinoquía and Eje Cafetero currently have published catalog/access data.** Firestore rules accept only `orinoquia` and `eje-cafetero`. Published SIRAP scenarios: 56 (40 Eje Cafetero, 16 Orinoquía).

Regional admins can grant or revoke those two regions; they cannot approve brand-new Firebase accounts. See [`cybersecurity.md`](../cybersecurity.md#7-sirap-regional-admins-versus-global-admin) and [`usability-testing.md`](../usability-testing.md#uat-accounts-and-roles).

### 10. Where does the source code live?

Working source is this Git repository:

- Remote: `https://github.com/DISES-CI-UCSB/decision-making-tool.git`
- Active tree: `frontend/` (Angular), `backend/` (FastAPI), `data/` (metrics pipeline), `docs/` (this handoff)
- Archived, **not** production: `legacy-r-shiny-app/`

The repository contains web, API, and pipeline code plus outputs. Reproducible national Prioritizr execution code, repository license, and formal “open source” status are still open handoff decisions (REQ-18, DEL-04). Do not call the repo open source until Parques approves a license.

See [`requirements-traceability.md`](../requirements-traceability.md) and [`architecture.md`](../architecture.md).

### 11. How does the SPA find the metrics API in production?

Production `environment.production.ts` sets `metricsApiBaseUrl` to the same-origin path `/metrics-api`. Vercel rewrites that path to the FastAPI service. Self-hosted Compose does the same proxy from port 8080. If frontend and backend are split, set `METRICS_API_UPSTREAM` or bake `METRICS_API_BASE_URL` and allow the origin in `DMT_CORS_ORIGINS`.

See [repository `README.md`](../../../../../README.md#two-containers) and [`architecture.md`](../architecture.md#runtime-and-deployment-requirements).

---

## Common problems and solutions

Each item is a **shipped or measured** fact from the repo, not a hypothetical.

### `/ready` returns HTTP 503

**Symptom.** `curl http://localhost:8000/ready` (or `/metrics-api/ready`) returns 503. `/health` may still be 200.

**Cause.** Readiness fails when required **national** runtime artifacts are missing or invalid, or when the detailed-species worker is down. The usual first-boot cause is that **hydrate was not run**, so the volume is empty. `DMT_ARTIFACT_REQUIRED=true` on the VM makes missing artifacts a hard 503. Missing SIRAP regional artifacts are listed in the payload and currently do **not** fail `/ready`.

**What to do.**

1. Run `docker compose run --rm --build backend hydrate` (about 15–25 minutes the first time).
2. Start or recreate: `docker compose up --build` (VM: `DMT_ARTIFACT_REQUIRED=true docker compose -f backend/docker-compose.yml up -d --build --force-recreate`).
3. Recheck `GET /ready`.

[Repository `README.md`](../../../../../README.md#1-spin-up-the-app) · [`backend/README.md`](../../../../../backend/README.md#hydrate-runtime-artifacts) · [`architecture.md`](../architecture.md#operational-health-and-recovery) · [`metrics-and-artifacts.md`](../data-operations/metrics-and-artifacts.md)

### Firebase login fails on `127.0.0.1`

**Symptom.** Google sign-in fails when the app is opened as `http://127.0.0.1:8080` (or another `127.0.0.1` port). The same build works on `localhost`.

**Cause.** Firebase Auth is authorized for the hostname `localhost`, not `127.0.0.1`. The two are different origins.

**What to do.** Open `http://localhost:8080/` (or `http://localhost:4200/` for `yarn start`). Keep `localhost` on the Firebase authorized-domains list.

[Repository `README.md`](../../../../../README.md#1-spin-up-the-app) · [`cybersecurity.md`](../cybersecurity.md#3-confirm-authorized-domains)

### Custom domain `decision-making-support-tool.xyz` returns 404

**Symptom.** A browser GET to `https://decision-making-support-tool.xyz` (bare domain, no `api.`) returns 404.

**Cause.** When last probed (performance notes, 7 September 2026, **one GET**), that hostname did not serve the Angular app. It is **not** the metrics API. The live Vercel host that responded was `decision-making-tool-tau.vercel.app`. The API hostname documented separately is `https://api.decision-making-support-tool.xyz`.

**What to do.** Use the confirmed Vercel URL until DNS actually serves the SPA. Do not add a 404 host to Firebase authorized domains. Confirm production domain as an architecture decision.

[`architecture.md`](../architecture.md#architecture-decisions-requiring-validation) · [`performance-results-2026-09-07.md`](../performance-results-2026-09-07.md)

### Known-AOI land-use bars are empty on GTIC production catalog 3.0.5

**Symptom.** Department, municipality, SIRAP, RUNAP, or OMEC dashboards show empty land-use bars (“not available yet”). Drawn custom polygons show live Corine Land Cover (CLC) bars.

**Cause.** GTIC production compact metrics (`catalog-releases/3.0.5` → `manifest/manifest.json`) still lack `land_use_*_pct_of_aoi`. This is a **catalog content** gap, not a crashed API. This branch’s `catalog-releases/3.0.6` land-use-aoi-TEST index can fill those bars locally; it is **not** the GTIC 3.0.5 publish.

**What to do.** Do not fail GTIC user-acceptance testing for empty known-AOI land-use on 3.0.5. Do not treat a local 3.0.6 test pointer as production. A future official catalog must publish those compact fields if known-AOI bars are required.

[`usability-testing.md`](../usability-testing.md#guest-finder-and-empty-state-quirks-testers-will-hit) · [`adding-solutions.md`](../data-operations/adding-solutions.md#incremental-metric-backfill)

### Email login does nothing useful

**Symptom.** Testers who avoid Google use the email sign-in or email “request access” UI and get a dead path.

**Cause.** **Email login and email request-access are interface demos.** They are not connected to Firebase. Production identity is Google.

**What to do.** Use Google sign-in. Treat a dead email path as expected, not a production authentication outage. The Google service also has a stub fallback used only when Firebase is **disabled** — that is not the production path.

[`usability-testing.md`](../usability-testing.md#guest-finder-and-empty-state-quirks-testers-will-hit) · [`cybersecurity.md`](../cybersecurity.md#controls-confirmed-in-the-repository)

### Browser reports a CORS error talking to the metrics API

**Symptom.** The browser blocks `POST` / `GET` to the FastAPI origin with a Cross-Origin Resource Sharing (CORS) error.

**Cause.** `DMT_CORS_ORIGINS` adds extra allowed frontend origins. Defaults already include localhost / `127.0.0.1` on ports `4200`, `4300`, `4301`, `8080`, and `8084`. **Production and preview hosts are not allowed unless listed.** Same-origin `/metrics-api` on Vercel or Compose avoids this; a split frontend origin does not.

**What to do.** Add the exact browser origin to `DMT_CORS_ORIGINS` (comma-separated) on the backend, or keep the same-origin proxy. Do not put credential values in tickets.

[`backend/README.md`](../../../../../backend/README.md#environment-variables) · [repository `README.md`](../../../../../README.md#two-containers)

### HTTP 429 on expensive custom-polygon POSTs

**Symptom.** `POST /metrics/custom-polygon` or `POST /area-profile/custom-polygon` returns **429** with `Retry-After`. Job status GET/DELETE, `/health`, and `/ready` still work.

**Cause.** In-process rate limit per client IP: `DMT_RATE_LIMIT_PER_MINUTE` (default **30**). Set to `0` to disable. This is separate from the species **queue** limit below.

**What to do.** Wait for `Retry-After`. Reduce request rate. Confirm the limiter is intended for that host before raising or disabling it.

[`backend/README.md`](../../../../../backend/README.md#environment-variables)

### Species job queue is full (also HTTP 429)

**Symptom.** `POST /area-profile/custom-polygon/species-coverage/jobs` returns **429** with `Retry-After`, `temporarily_overloaded`, or “Detailed species processing is at capacity.”

**Cause.** One background worker; **at most 10 queued** jobs. Further unique POSTs are refused. A measured burst of 20 unique jobs accepted 12 and refused 8 (7 September 2026). Identical completed work can be reused (HTTP 200) and does not take a new slot.

**What to do.** Poll existing job IDs; retry after `Retry-After`; cancel queued work if appropriate (`DELETE …/jobs/{job_id}`). Do not treat this as a Blob outage. Known-AOI species tables still load from public Blob JSON.

[`architecture.md`](../architecture.md#custom-area-fastapi-surface) · [`performance-results-2026-09-07.md`](../performance-results-2026-09-07.md)

---

## Related pages

- Data model: [`data-model.md`](./data-model.md)
- Spin-up and catalog pointers: [repository `README.md`](../../../../../README.md)
- Operator index: [`data-operations/README.md`](../data-operations/README.md)
- Publish / rollback: [`publishing-and-rollback.md`](../data-operations/publishing-and-rollback.md)
- Firebase transfer: [`cybersecurity.md`](../cybersecurity.md#firebase-project-transfer-checklist)
