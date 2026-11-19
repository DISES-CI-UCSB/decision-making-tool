[← Back to handoff overview](./README.md)

# Client-side measurements — 7 September 2026

**Probe client (this laptop, not the VM):** MacBook Pro 14-inch 2023, Apple M2 Max, arm64, 12 cores (8 performance + 4 efficiency), 32 GB RAM, macOS 15.5.

**All times are in milliseconds (ms).** Most columns are this laptop’s stopwatch (network, TLS, download, polling). **`compute_ms (ms)`** is the backend’s own figure inside the species-coverage job JSON: server compute only.

## Summary

Probe client (this laptop, not the VM): MacBook Pro 14-inch 2023, Apple M2 Max, arm64, 12 cores (8 performance + 4 efficiency), 32 GB RAM, macOS 15.5. Times are milliseconds from this laptop unless `compute_ms` (server field).

This app is a browser conservation-planning tool for Colombia: map, layers, a precomputed scenario (national or regional SIRAP), and an optional drawn custom polygon.

Paste the [Google Doc paste (Performance tab)](#google-doc-paste-performance-tab) into the Performance tab. Do not paste this Summary or the lab notebook. The sections after the paste block keep the measured tables and raw timings.

## Contents

- [What we tested](#what-we-tested)
- [What we did not test](#what-we-did-not-test)
- [Results](#results)
  - [1. Known solution — species and ecosystem (Blob)](#1-known-solution--species-and-ecosystem-blob)
  - [2. Custom polygon — ecosystem coverage](#2-custom-polygon--ecosystem-coverage)
  - [3. Custom polygon — species coverage (one at a time)](#3-custom-polygon--species-coverage-one-at-a-time)
  - [4. Custom polygon — species queue under pressure](#4-custom-polygon--species-queue-under-pressure)
  - [5. Custom polygon — area-only ramp](#5-custom-polygon--area-only-ramp)
  - [6. Frontend, Blob assets, and health](#6-frontend-blob-assets-and-health)
  - [7. What `/ready` already reports](#7-what-ready-already-reports)
- [Hardware and software recommendation](#hardware-and-software-recommendation)
- [How we measured](#how-we-measured)
- [Google Doc paste (Performance tab)](#google-doc-paste-performance-tab)

## What we tested

- **Frontend load test**: 10,000 GETs of `https://decision-making-tool-tau.vercel.app/` over ~60 s (~166/s, 50 in-flight). Then 400 GETs of `/favicon.ico`. All HTTP 200.
- **Public Blob GETs**: catalog JSON, small JSON, small TIFFs, a 2 MB slice of a ~12 MB raster, plus 6 parallel small JSON GETs.
- **Backend health**: `GET /health` and `GET /ready`.
- **Area-only custom polygons** (`POST /metrics/custom-polygon`, `metrics: ["area"]`): small Bogotá box and a 1° box, 1 / 2 / 4 / 8 concurrent.
- **One heavier metric set** on the small box (area + water + carbon), concurrency 1.
- **Known-solution species and ecosystem tables**: public Blob JSON (download only).
- **Custom-polygon ecosystem coverage** (`POST /area-profile/custom-polygon`, `sections: ["ecosystems"]`): national on a Bogotá box and SIRAP `eje-cafetero-001` on a Pereira box, one at a time; then 2 / 4 / 8 concurrent national POSTs.
- **Custom-polygon species coverage jobs** (`POST .../species-coverage/jobs`, then poll): same two solutions, one at a time.
- **Species job queue under pressure**: 5, then 10 unique jobs (all accepted); then 15 (some coalesced, no 429); then 20 unique jobs (first refusals).

## What we did not test

- SSH, Docker stats, or CPU/RAM on the VM
- Firebase
- Soak / overnight
- Saturation of the Vercel website (raising HTML rate until it failed)
- National-scale custom polygons (the custom boxes were small)
- Time to parse and render coverage tables in the browser
- 10,000 concurrent map users (the load test is repeated GETs of the HTML shell, with connection reuse)

`https://decision-making-support-tool.xyz` (bare domain, no `api.`) returned 404. That is not the backend. One GET only.

## Results

### 1. Known solution — species and ecosystem (Blob)

For a **selected national or SIRAP solution**, “View coverage breakdown” is **public Blob JSON**, not the metrics VM. Download plus TLS only. Browser parse/render was not timed.

| Scenario | Sequential download (ms) | GETs | 404s |
| --- | --- | --- | --- |
| National species | 987.3 | 5 | 2 |
| National ecosystem | 161.5 | 1 | 0 |
| SIRAP species (`eje-cafetero-001`) | 810.2 | 4 | 2 |
| SIRAP ecosystem | 367.6 | 2 | 0 |

If the SPA skipped the 404 `.complete.json` files: national species **693.2 ms** (3 GETs); national ecosystem **146.4 ms**; SIRAP species **365.9 ms** (2 GETs); SIRAP ecosystem **289.0 ms** (2 GETs).

| Object | Size | Cold (ms) | Warm (ms) | Status |
| --- | --- | --- | --- | --- |
| National catalog | 748,666 B | 224.2 | 305.4 | 200 |
| National compact | 568,687 B | 214.3 | 194.7 | 200 |
| National overlay | 603,343 B | 210.4 | 226.1 | 200 |
| National MEC | 153,104 B | 163.0 | 149.6 | 200 |
| SIRAP catalog | 748,479 B | 215.1 | 218.3 | 200 |
| SIRAP compact | 263,573 B | 150.6 | 173.7 | 200 |
| SIRAP MEC | 148,321 B | 153.5 | 158.3 | 200 |
| SIRAP denominator | 59,499 B | 138.1 | 142.6 | 200 |
| `*.complete.json` companions | — | — | — | HEAD 404 |

### 2. Custom polygon — ecosystem coverage

`POST /area-profile/custom-polygon` with `sections=["ecosystems"]`. This is **not** the Blob table above, and **not** the dashboard scalar cards.

One at a time:

| Solution | Geometry | HTTP | Latency (ms) | Size | Coverage rows | Errors |
| --- | --- | --- | --- | --- | --- | --- |
| National `eco17_estr17_esprep17_runap_iheh2022` | Bogotá | 200 | 720.95 | 254,184 B | 417 | 0 |
| SIRAP `eje-cafetero-001` | Pereira | 200 | 3,784.12 | 11,050 B | 3 | 0 |

SIRAP used artifact `eje-cafetero-custom-aoi-20260903T212016Z`. On these boxes, SIRAP was slower. The polygons are also different. We do not have host traces; do not generalize why.

Optional dashboard scalars (`POST /metrics/custom-polygon` with `ecosystem_*`, national, Bogotá): HTTP 200, **434.61 ms**, 10,849 B. Not the breakdown table.

Several at once (national, small boxes, distinct polygons). These hit **Uvicorn directly**, not the species job queue. All HTTP 200. Wait rose with N (~0.75 s → ~1.3 s → ~2.6 s). No 5xx. No timeout. Health stayed 200.

| Concurrency | n | p50 (ms) | p95 (ms) | max (ms) | Errors |
| --- | --- | --- | --- | --- | --- |
| 2 | 2 | 745.50 | 775.08 | 775.08 | 0 |
| 4 | 4 | 1,270.68 | 1,366.26 | 1,366.26 | 0 |
| 8 | 8 | 2,562.60 | 2,623.61 | 2,623.61 | 0 |

Raw (ms) — 2: 745.50, 775.08. 4: 1,353.91, 1,270.68, 1,202.82, 1,366.26. 8: 2,423.72, 2,440.81, 2,610.18, 2,562.60, 2,623.61, 2,609.57, 2,596.57, 2,461.90.

### 3. Custom polygon — species coverage (one at a time)

Create job, then poll every 1.5 s. Create returned HTTP 202. First poll was already complete.

**`compute_ms`** = what the VM says it spent computing. **Client wait** = laptop stopwatch, including the 1.5 s first poll sleep and downloading ~2.6 MB. ~1.9 s is not “the VM took 1.9 s.”

| Solution | Create (ms) | compute_ms (ms) | Client wait (ms) | Records | Result size | Errors |
| --- | --- | --- | --- | --- | --- | --- |
| National `eco17_estr17_esprep17_runap_iheh2022` | 150.96 | 208.73 | 1,931.04 | 3,634 | 2,606,329 B | 0 |
| SIRAP `eje-cafetero-001` (Pereira) | 147.41 | 406.18 | 1,920.07 | 3,967 | 2,868,692 B | 0 |

### 4. Custom polygon — species queue under pressure

Species coverage is a **one-worker queue** (about 10 queued slots, then refuse). Distinct polygons so new work would not merge with itself. Health stayed 200 after every burst. Accepted jobs all completed. No 5xx.

| Burst | Unique new jobs | Coalesced onto old jobs | Accepted (202) | Refused (429) | Max queue position | compute_ms max (ms) | Client wait max (ms) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 5 at once | 5 | 0 | 5 | 0 | 3 | 333.72 | 4,356.17 |
| 10 at once | 10 | 0 | 10 | 0 | 7 | 457.81 | 9,025.45 |
| 15 at once | 11 | 4 | 15 job ids (4 reused) | 0 | 10 | — | — |
| 20 at once | 20 | 0 | 12 | **8** | 11 | — | — |

**Failure point:** twenty unique jobs at once. Twelve were accepted; eight returned HTTP 429 with `temporarily_overloaded` / “Detailed species processing is at capacity.” That matches roughly one job running plus about ten queued. Fifteen at once did **not** refuse, because four creates reused already-finished jobs from earlier in the day and did not take new slots.

There is **no user research** yet on how often custom AOI will be used. We are not treating it as the expected everyday path (known-solution Blob coverage is the cheap, precomputed one). Report the queue limit anyway: if custom drawing becomes common, concurrent species-coverage requests will start getting 429s at this depth.

Client waits at 5 and 10 grew because of polling plus ~2.6 MB downloads — not because each job took 9 s to compute. Server `compute_ms` stayed in the hundreds of milliseconds (5-at-once p50 193.49 ms; 10-at-once p50 190.28 ms).

Burst of 5: all complete by the first poll. Burst of 10: first poll found 8 complete and 2 still queued; those 2 finished on the next poll.

Raw `compute_ms` (ms) — 5: 171.78, 244.80, 176.19, 193.49, 333.72. 10: 178.79, 173.99, 175.92, 179.07, 193.99, 266.28, 254.30, 193.32, 187.23, 457.81.

Raw client wait (ms) — 5: 2,345.68, 3,920.00, 3,222.86, 4,356.17, 2,786.40. 10: 4,655.31, 5,629.53, 2,778.73, 6,091.36, 5,204.25, 3,456.12, 9,025.45, 8,463.33, 6,534.90, 4,196.03.

### 5. Custom polygon — area-only ramp

`POST /metrics/custom-polygon` with `["area"]`. All HTTP 200. No timeout. No 5xx. Completions overlapped; these cheap calls did not look like a one-at-a-time queue. We did not find a breakpoint on this cheap path.

| Target | Concurrency | n | p50 (ms) | p95 (ms) | max (ms) | Errors |
| --- | --- | --- | --- | --- | --- | --- |
| Small AOI, area only | 1 | 1 | 143.45 | 143.45 | 143.45 | 0 |
| Small AOI, area only | 2 | 2 | 174.75 | 174.77 | 174.77 | 0 |
| Small AOI, area only | 4 | 4 | 233.45 | 254.72 | 254.72 | 0 |
| Small AOI, area only | 8 | 8 | 338.93 | 377.15 | 377.15 | 0 |
| Medium AOI, area only | 1 | 1 | 152.62 | 152.62 | 152.62 | 0 |
| Medium AOI, area only | 2 | 2 | 157.82 | 161.42 | 161.42 | 0 |
| Medium AOI, area only | 4 | 4 | 222.91 | 243.95 | 243.95 | 0 |
| Medium AOI, area only | 8 | 8 | 364.70 | 399.86 | 399.86 | 0 |

Single-user small AOI: cold **168.2 ms** / warm **145.7 ms**. Six-metric set (area + water + carbon), concurrency 1: **395.97 ms**.

Raw small (ms): 1 → 143.45; 2 → 174.77, 174.72; 4 → 222.14, 242.86, 224.04, 254.72; 8 → 366.88, 377.15, 339.00, 338.85, 376.68, 338.74, 338.65, 317.60.

Raw medium (ms): 1 → 152.62; 2 → 154.21, 161.42; 4 → 217.98, 227.84, 215.56, 243.95; 8 → 364.40, 372.37, 364.65, 364.72, 364.68, 379.92, 399.86, 364.23.

### 6. Frontend, Blob assets, and health

**Load test, not saturation.** 10,000 GETs of the HTML document (57,780 bytes; Vercel cache HIT on the smoke GET). Keep-alive on 50 connections. **166.4 requests/s.** 10,000×200. The live site handled that load. We did not keep increasing rate until Vercel failed, so this is not a saturation test. p95 **116 ms**; one request took **1.2 s**. SPA shell only — not ArcGIS, not Blob rasters, not the metrics VM.

| Target | Cold (ms) | Warm (ms) | Size | Errors |
| --- | --- | --- | --- | --- |
| Frontend `/` | 125.4 | 110.3 | — | 0 |
| Frontend CSS `styles-RERSC7W3.css` | 175.5 | 207.0 | 421,645 B | 0 |
| Frontend favicon | 88.7 | 85.9 | — | 0 |
| Frontend JS `chunk-2ZIOQQ7M.js` | 80.5 | 163.9 | 730 B | 0 |
| Blob `manifest.json` | 1,153.1 | 837.1 | 20,423,164 B | 0 |
| Blob `ecosystem-classification-summary.json` | 145.6 | 122.8 | 105,690 B | 0 |
| Blob `recarga_agua_subterranea_moderado_alto.tif` | 156.3 | 193.1 | 166,170 B | 0 |
| Blob nominated “large COG” (actually 223,195 B) | 167.2 | 171.1 | 223,195 B | 0 |
| Blob 2 MiB Range of `human_footprint_2030.tif` | 251.7 | 281.9 | 2,097,152 of 12,402,302 B | 0 |
| Backend `/health` | 174.7 | 108.4 | — | 0 |
| Backend `/ready` | 102.9 | 98.1 | — | 0 |

Warm was sometimes slower than cold. Treat as path jitter, not a cache finding. Range TTFB for the 12 MB TIFF: **96.7 ms** cold / **117.9 ms** warm.

| Target | Concurrency | n | p50 (ms) | p95 (ms) | max (ms) | Errors |
| --- | --- | --- | --- | --- | --- | --- |
| Frontend mix, 4 parallel GETs | 4 | 4 | 124.1 | 179.1 | 179.1 | 0 |
| Blob 6 parallel small JSON GETs | 6 | 6 | 190.2 | 193.0 | 193.0 | 0 |
| Frontend load test: HTML `/`, 10,000 GETs in 60.1 s | 50 in-flight | 10,000 | 46.3 | 115.5 | 1,235.0 | 0 |
| Live `/favicon.ico`, 400 GETs | 20 in-flight | 400 | 27.5 | 47.9 | 138.7 | 0 |

### 7. What `/ready` already reports

Status `ready`. Artifact `colombia-custom-aoi-v1-20260824T154254Z`. Warmup **37,631.677 ms**. Loaded `2026-09-04T18:03:31Z`. **16** raster layers. Species index: **7,980** species, **2,366.867 MB** memmap. Solution registry: 168 registered, 0 loaded. Does not report worker count.

That ~2.4 GB already in memory is the RAM floor, not the ~100–175 ms health checks.

## Hardware and software recommendation

Planning guidance from this run plus the repo. Not a certified spec. Host RAM and container stats were not measured.

- Docker Compose. The container image is `python:3.11-slim`. CI tests Python 3.11 and 3.12. Do not treat 3.12 as the verified container runtime. Dockerfile starts **one Uvicorn worker**. Local artifact disk.
- Do not size below about **8 GB RAM**. `/ready` already reports ~2.4 GB species memmap plus 16 rasters, plus OS/Docker/Uvicorn.
- Starting point matching the current observed host class: **4 vCPU / 8 GB RAM / at least 20 GB artifact disk**, one Uvicorn worker.
- If several people will draw AOIs: **8 vCPU / 16 GB** is the cautious next step. The species queue refused at **20 unique jobs at once** (12 accepted, 8×429).
- Custom AOI compute is the limiter **when someone draws a polygon**. Public Blob GETs (known-solution coverage) were cheap from this laptop. We have no research on how popular custom drawing will be; we do not assume it is the main path, but the queue limit is real if it is.
- Do not reuse the 2025 GTIC R/Shiny figures (6 cores / 16 GB / 3 users). Historical README note, not re-measured: host about 7.756 GiB, container idle about 48 MiB.

## How we measured

| Field | Value |
| --- | --- |
| Date | 7 September 2026 |
| Repo HEAD (laptop snapshot, not a proven deploy) | `3d07a9f44403d623d20b94b9dcfa06e4d09739d0` |
| Probe client (not the VM) | MacBook Pro 14-inch 2023, Apple M2 Max, arm64, 12 cores (8 performance + 4 efficiency), 32 GB RAM, macOS 15.5 |
| Tools | curl 8.7.1; Python 3.13 (`http.client` + `ThreadPoolExecutor`) |
| Abort rules | Stop if error rate > 10%, custom-polygon p95 > 30 s, or `/health` / `/ready` non-2xx. No abort. |

| Role | URL | Observed |
| --- | --- | --- |
| Frontend | https://decision-making-tool-tau.vercel.app | HTTP 200, title EcoPlan |
| Backend | https://api.decision-making-support-tool.xyz | Health, ready, custom-polygon, area-profile, species jobs |
| Public Blob | https://aagibolq28slyfof.public.blob.vercel-storage.com | Object GETs and coverage JSON |
| Bare domain (not the API) | https://decision-making-support-tool.xyz | HTTP 404. One GET. |
| Rewrite check | https://decision-making-tool-tau.vercel.app/metrics-api/health | HTTP 200. No custom-polygon through this rewrite. |

Polygons: Bogotá `[-74.10, 4.50]`–`[-73.90, 4.70]`; medium 1° `[-75, 5]`–`[-74, 6]`; Pereira `[-75.80, 4.70]`–`[-75.60, 4.90]` for SIRAP; nudged boxes for species-queue bursts.

## Google Doc paste (Performance tab)

Copy from the heading below through the end of this section. The paste includes the high-level scan plus Measured results tables. Do not paste Summary or the lab notebook.

[← Back to handoff overview](https://docs.google.com/document/d/1mThmI_KmTT8kE2s02s_ymhdHL-BUxyIl8lxuwXJ76aM/edit?tab=t.0)

## Client-side samples — 7 September 2026 (not a saturation study)

MacBook Pro 14-inch 2023, Apple M2 Max, 12 cores (8P+4E), 32 GB RAM, macOS 15.5. Times in milliseconds from this laptop unless compute_ms (server field).

### What this app is

A browser conservation-planning tool for Colombia. A person opens a map, turns layers on and off, picks a precomputed scenario (national or SIRAP (regional scenario pack)), and can optionally draw a custom AOI (a drawn polygon). This packet times **coverage files and custom-area compute**, not map tiles, ArcGIS, or sign-in.

### What we measured

- **Known-solution** Blob (public file storage) tables.
- Custom-polygon **VM**.
- Frontend **HTML load test**.
- Backend `/health` and `/ready`.

### Findings

- **Known-solution Blob:** national species ~987 ms, ecosystem ~162 ms; SIRAP species ~810 ms, ecosystem ~368 ms.
- Custom ecosystem/species: national eco ~721 ms, SIRAP eco ~3.8 s; species compute_ms ~209/~406 ms, **client wait ~1.9 s** (poll + ~2.6 MB).
- Species queue: 5 and 10 unique accepted; 20 unique → 12 accepted, **8× HTTP 429**. One worker. No research on how often people draw custom AOIs; still report the limit.
- Frontend load test: 10,000 HTML GETs in 60.1 s (~166/s) all HTTP 200 (p50 46 ms, p95 116 ms, one 1.2 s). **Not a Vercel saturation test** (we did not raise rate until it failed), not 10,000 map users. SPA shell ~58 KB.
- Area-only custom polygons **under 400 ms** at 8 concurrent.

### VM sizing (planning, not a certified spec)

`/ready` already holds ~2.4 GB species memmap plus 16 rasters. Starting point: **4 vCPU / 8 GB / ≥20 GB**. Do not go below ~8 GB. If several people draw AOIs: 8 vCPU / 16 GB. Do not reuse the 2025 R/Shiny figures (6 cores / 16 GB / 3 users). Container image `python:3.11-slim`, one Uvicorn worker.

### What this is not

- No SSH or Docker stats.
- No soak.
- No ArcGIS or map-user test.
- No national-scale custom polygons.

### Measured results

Times are this laptop’s stopwatch in milliseconds unless `compute_ms` (server field). Tables are the 7 September 2026 samples.

#### Known-solution coverage (Blob)

Public Blob JSON for a selected national or SIRAP solution, not the VM. Download only.

| Scenario | Sequential download (ms) | GETs | 404s |
| --- | --- | --- | --- |
| National species | 987.3 | 5 | 2 |
| National ecosystem | 161.5 | 1 | 0 |
| SIRAP species (`eje-cafetero-001`) | 810.2 | 4 | 2 |
| SIRAP ecosystem | 367.6 | 2 | 0 |

If the SPA skipped the 404 `.complete.json` files: national species **693.2 ms**; national ecosystem **146.4 ms**; SIRAP species **365.9 ms**; SIRAP ecosystem **289.0 ms**.

#### Custom polygon — ecosystem

`POST /area-profile/custom-polygon` with `sections=["ecosystems"]`.

| Solution | Geometry | HTTP | Latency (ms) | Size | Coverage rows | Errors |
| --- | --- | --- | --- | --- | --- | --- |
| National | Bogotá | 200 | 720.95 | 254,184 B | 417 | 0 |
| SIRAP `eje-cafetero-001` | Pereira | 200 | 3,784.12 | 11,050 B | 3 | 0 |

Concurrent national POSTs (distinct small boxes). All HTTP 200.

| Concurrency | n | p50 (ms) | p95 (ms) | max (ms) | Errors |
| --- | --- | --- | --- | --- | --- |
| 2 | 2 | 745.50 | 775.08 | 775.08 | 0 |
| 4 | 4 | 1,270.68 | 1,366.26 | 1,366.26 | 0 |
| 8 | 8 | 2,562.60 | 2,623.61 | 2,623.61 | 0 |

#### Custom polygon — species (one at a time)

`compute_ms` is the VM’s own compute figure; client wait is this laptop’s stopwatch (1.5 s first poll plus ~2.6 MB download), so ~1.9 s is not “the VM took 1.9 s.”

| Solution | Create (ms) | compute_ms (ms) | Client wait (ms) | Records | Result size | Errors |
| --- | --- | --- | --- | --- | --- | --- |
| National | 150.96 | 208.73 | 1,931.04 | 3,634 | 2,606,329 B | 0 |
| SIRAP `eje-cafetero-001` (Pereira) | 147.41 | 406.18 | 1,920.07 | 3,967 | 2,868,692 B | 0 |

#### Custom polygon — species queue

| Burst | Unique | Coalesced | Accepted | Refused |
| --- | --- | --- | --- | --- |
| 5 at once | 5 | 0 | 5 | 0 |
| 10 at once | 10 | 0 | 10 | 0 |
| 15 at once | 11 | 4 | 15 job ids (4 reused) | 0 |
| 20 at once | 20 | 0 | 12 | 8 |

| Burst | Max queue | compute_ms max | Client wait max |
| --- | --- | --- | --- |
| 5 at once | 3 | 333.72 | 4,356.17 |
| 10 at once | 7 | 457.81 | 9,025.45 |
| 15 at once | 10 | — | — |
| 20 at once | 11 | — | — |

Twenty unique jobs at once: 12 accepted, 8× HTTP 429. Fifteen did not 429 because 4 coalesced.

#### Custom polygon — area only

`POST /metrics/custom-polygon` with `["area"]`. No breakpoint on this cheap path.

| Target | Concurrency | n | p50 (ms) | p95 (ms) | max (ms) | Errors |
| --- | --- | --- | --- | --- | --- | --- |
| Small AOI, area only | 1 | 1 | 143.45 | 143.45 | 143.45 | 0 |
| Small AOI, area only | 2 | 2 | 174.75 | 174.77 | 174.77 | 0 |
| Small AOI, area only | 4 | 4 | 233.45 | 254.72 | 254.72 | 0 |
| Small AOI, area only | 8 | 8 | 338.93 | 377.15 | 377.15 | 0 |
| Medium AOI, area only | 1 | 1 | 152.62 | 152.62 | 152.62 | 0 |
| Medium AOI, area only | 2 | 2 | 157.82 | 161.42 | 161.42 | 0 |
| Medium AOI, area only | 4 | 4 | 222.91 | 243.95 | 243.95 | 0 |
| Medium AOI, area only | 8 | 8 | 364.70 | 399.86 | 399.86 | 0 |

#### Frontend HTML load test

10,000 GETs of the HTML document in 60.1 s, all HTTP 200. Not a Vercel saturation test. SPA shell ~58 KB.

| Target | Concurrency | n | p50 (ms) | p95 (ms) | max (ms) | Errors |
| --- | --- | --- | --- | --- | --- | --- |
| Frontend load test: HTML `/`, 10,000 GETs in 60.1 s | 50 in-flight | 10,000 | 46.3 | 115.5 | 1,235.0 | 0 |
| Live `/favicon.ico`, 400 GETs | 20 in-flight | 400 | 27.5 | 47.9 | 138.7 | 0 |

#### /ready

| Field | Value |
| --- | --- |
| Status | ready |
| Artifact | colombia-custom-aoi-v1-20260824T154254Z |
| Warmup (ms) | 37,631.677 |
| Rasters | 16 |
| Species count | 7,980 |
| Memmap (MB) | 2,366.867 |
| Solution registry | 168 registered, 0 loaded |

#### Hosts

| Role | URL | Observed |
| --- | --- | --- |
| Frontend | https://decision-making-tool-tau.vercel.app | HTTP 200, title EcoPlan |
| Backend | https://api.decision-making-support-tool.xyz | Health, ready, custom-polygon, area-profile, species jobs |
| Public Blob | https://aagibolq28slyfof.public.blob.vercel-storage.com | Object GETs and coverage JSON |
| Bare domain (not the API) | https://decision-making-support-tool.xyz | HTTP 404. One GET. |
| Rewrite check | https://decision-making-tool-tau.vercel.app/metrics-api/health | HTTP 200. No custom-polygon through this rewrite. |

Lab notebook: docs/handoffs/parques-it/english/performance-results-2026-09-07.md
