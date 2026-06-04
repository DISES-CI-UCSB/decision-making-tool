# Backend Metrics API

This is the Chat #1 foundation for the DISES Decision Making Tool backend metrics API. It provides a Dockerized FastAPI service skeleton, health/readiness checks, a typed custom polygon metrics endpoint contract, and lightweight runtime artifact metadata tooling. It intentionally does not implement the full metric engine.

No secrets, local `.env` files, heavy rasters, generated caches, or packaged metric artifacts should be committed. Runtime artifacts belong in `backend/runtime-artifacts/` locally or in a mounted directory configured by environment variables.

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

Stop the service with:

```bash
docker compose -f backend/docker-compose.yml down
```

## Environment Variables

- `DMT_ARTIFACT_DIR`: Directory containing runtime artifacts. Defaults to `runtime-artifacts`.
- `DMT_ARTIFACT_MANIFEST`: Manifest path. Defaults to `${DMT_ARTIFACT_DIR}/manifest.json`.
- `DMT_ARTIFACT_REQUIRED`: Set to `true` when the API should fail readiness if the manifest is missing or invalid. Defaults to `false` for local skeleton development.
- `DMT_ARTIFACT_SCHEMA_VERSION`: Expected manifest schema version. Defaults to `metrics-artifact-manifest/v1`.
- `BLOB_READ_WRITE_TOKEN`: Required for future real Vercel Blob sync work. The skeleton script only checks whether it is present and never prints the value.

## Endpoints

- `GET /health`: Process-alive check. Returns `200` when the app is running.
- `GET /ready`: Artifact-aware readiness check. In no-artifact development mode, missing artifacts return `200` with `available=false`. When `DMT_ARTIFACT_REQUIRED=true`, missing or invalid artifacts return `503`.
- `POST /metrics/custom-polygon`: Typed custom polygon metrics contract stub. It returns `503` if artifacts are unavailable and `501` once artifacts are available because real metric calculation is deferred to later chats.


## Shared Metric Adapters

Backend metric adapters live in `app/metric_adapters.py` and import calculator functions plus catalog entries from the existing precompute pipeline under `data/metrics/python/metrics_pipeline`. The backend should wrap those shared functions instead of duplicating metric formulas or metric definitions.

The first shared path covers the pure area metrics: `priority_area_in_region` (#18) and `national_contribution` (#17). Current tests use tiny JSON fixtures only; future custom polygon work should extend these parity tests before adding real polygon/raster artifact execution. The Docker image copies the tracked pipeline source into the image and points `DMT_METRICS_PIPELINE_PATH` at that copy so runtime imports use the same source modules.

## Artifact Sync Skeleton

The skeleton can list planned Blob prefixes and optionally write lightweight manifest metadata only. It does not download heavy data.

```bash
cd backend
python -m scripts.sync_artifacts
python -m scripts.sync_artifacts --write-manifest
```

The script reports whether `BLOB_READ_WRITE_TOKEN` is present as `true` or `false`; it must never print the token value. See `artifacts/README.md` and `artifacts/manifest.schema.json` for the runtime artifact contract.
