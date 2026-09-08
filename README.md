# Decision Making Tool

A spatial conservation prioritization platform for Colombia, enabling stakeholders to visualize and compare conservation planning solutions using an interactive map interface.

## Directory Structure

| Directory | Description |
|-----------|-------------|
| `frontend/` | Active Angular web application — ArcGIS map, solution finder, analysis dashboards |
| `frontend/layer-manifest/` | Committed schema, template, and validation tooling for the Blob-backed layer manifest |
| `data/` | Local geospatial source/provenance files, solution rasters, and layer registries |
| `docs/` | Current design docs, branch plans, task trackers, and team feedback |
| `development-artifacts/` | Non-runtime work products such as exploratory experiments and UI mockups |
| `legacy-r-shiny-app/` | Archived R/Shiny app and associated legacy analysis/server/deploy code, no longer in active use |

Vercel Blob is becoming the runtime source for published geospatial layer assets. During development, the latest layer manifest may be refreshed into `frontend/public/data/layer-manifest/manifest.json`, but that generated file is intentionally ignored.

## Quick Start

```bash
cd frontend
npm install
npm start        # ng serve → http://localhost:4200
```

## Docker

Vercel still auto-deploys the frontend. Docker is the self-host path for both servers.

```bash
# 1. Fill backend runtime rasters (needs outbound HTTPS to public Blob)
docker compose run --rm --build backend hydrate

# 2. Start frontend (http://localhost:8080) and backend (http://localhost:8000)
docker compose up --build
```

`GET /health` is process liveness. `GET /ready` is artifact readiness — it stays 503 until hydrate has written `runtime-artifacts/manifest.json`.

Copy `.env.example` to `.env` for names of Firebase and API variables. Do not commit values. Backend-only Compose remains at `backend/docker-compose.yml`.

To confirm both chip architectures after Docker Desktop is running:

```bash
docker build -f backend/Dockerfile -t dmt-backend .
docker build --platform linux/amd64 -f backend/Dockerfile -t dmt-backend:amd64 .
docker build -f frontend/Dockerfile -t dmt-frontend .
docker build --platform linux/amd64 -f frontend/Dockerfile -t dmt-frontend:amd64 .
```

CI builds both images on `ubuntu-latest` (x86) and smokes backend `/health` plus `/ready` against the tiny fixture.

## Key Technologies

- **Frontend**: Angular, TypeScript, Tailwind CSS, ArcGIS Maps SDK
- **Maps**: @arcgis/core, @arcgis/map-components
- **Data**: GeoTIFF rasters, CSV metadata, i18n (English/Spanish)
- **Deploy**: Vercel
