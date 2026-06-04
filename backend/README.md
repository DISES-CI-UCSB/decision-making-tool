# Backend Metrics API

This backend serves the DISES Decision Making Tool metrics API. It now includes startup/runtime artifact warmup plus a fixture-scale custom polygon area path for Chat #3 smoke testing. The production metric engine is still expected to expand from the same artifact contract rather than committing heavy generated data.

No secrets, local `.env` files, heavy rasters, generated caches, or packaged production metric artifacts should be committed. Runtime artifacts belong in `backend/runtime-artifacts/` locally or in a mounted directory configured by environment variables.

## Local Setup

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
pytest
uvicorn app.main:app --reload
```

The API will be available at `http://127.0.0.1:8000`.

## Tiny Artifact Smoke

A small human-readable artifact fixture lives at `backend/artifacts/fixtures/tiny-area/`. It contains a `manifest.json` plus `area-grid.json` with four cells, a fixed `pixel_area_km2`, and selected/valid flags. This fixture is safe to commit because it is JSON test data, not a raster, vector, cache, or production artifact.

Run the backend against the tiny artifact locally:

```bash
cd backend
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

From the repo root:

```bash
docker compose -f backend/docker-compose.yml build
docker compose -f backend/docker-compose.yml up
```

Smoke check:

```bash
curl http://127.0.0.1:8000/health
curl http://127.0.0.1:8000/ready
```

Run Docker Compose against the tiny artifact fixture copied into the image:

```bash
DMT_ARTIFACT_REQUIRED=true DMT_ARTIFACT_DIR=/backend/artifacts/fixtures/tiny-area DMT_ARTIFACT_MANIFEST=/backend/artifacts/fixtures/tiny-area/manifest.json docker compose -f backend/docker-compose.yml up --build
```

Stop the service with:

```bash
docker compose -f backend/docker-compose.yml down
```

## VM Deployment Smoke Operations

The current VM deployment runs the backend Compose service on public port `8000` with the committed tiny area fixture. From the repo root on the VM, rebuild and recreate the service from the current branch with:

```bash
docker compose -f backend/docker-compose.yml build backend
DMT_ARTIFACT_REQUIRED=true DMT_ARTIFACT_DIR=/backend/artifacts/fixtures/tiny-area DMT_ARTIFACT_MANIFEST=/backend/artifacts/fixtures/tiny-area/manifest.json docker compose -f backend/docker-compose.yml up -d --force-recreate backend
```

Useful operations:

```bash
docker compose -f backend/docker-compose.yml ps
docker compose -f backend/docker-compose.yml logs --tail=100 backend
docker compose -f backend/docker-compose.yml restart backend
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
- `BLOB_READ_WRITE_TOKEN`: Required for future real Vercel Blob sync work. The skeleton script only checks whether it is present and never prints the value.

## Endpoints

- `GET /health`: Process-alive check. Returns `200` when the app is running.
- `GET /ready`: Artifact-aware readiness check. In no-artifact development mode, missing artifacts return `200` with `available=false`. When `DMT_ARTIFACT_REQUIRED=true`, missing or invalid runtime artifacts return `503`; readiness returns `200` only after the selected artifact loads.
- `POST /metrics/custom-polygon`: Calculates representative area metrics from the loaded tiny artifact. It accepts GeoJSON `Polygon` or `MultiPolygon` geometry and supports `area`, `priority_area_in_region`, and `national_contribution` for this smoke path.

## Shared Metric Adapters

Backend metric adapters live in `app/metric_adapters.py` and import calculator functions plus catalog entries from the existing precompute pipeline under `data/metrics/python/metrics_pipeline`. The backend should wrap those shared functions instead of duplicating metric formulas or metric definitions.

The current custom polygon path maps fixture cells into in-memory selected/valid masks and then calls the shared area adapter for `priority_area_in_region` (#18) and `national_contribution` (#17). Production artifact work should replace the tiny JSON grid with real spatial artifact loading while preserving the warmup/readiness contract and shared calculator reuse.

## Artifact Sync Skeleton

The skeleton can list planned Blob prefixes and optionally write lightweight manifest metadata only. It does not download heavy data.

```bash
cd backend
python -m scripts.sync_artifacts
python -m scripts.sync_artifacts --write-manifest
```

The script reports whether `BLOB_READ_WRITE_TOKEN` is present as `true` or `false`; it must never print the token value. See `artifacts/README.md` and `artifacts/manifest.schema.json` for the runtime artifact contract.
