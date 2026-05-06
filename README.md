# Decision Making Tool

A spatial conservation prioritization platform for Colombia, enabling stakeholders to visualize and compare conservation planning scenarios using an interactive map interface.

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

## Key Technologies

- **Frontend**: Angular, TypeScript, Tailwind CSS, ArcGIS Maps SDK
- **Maps**: @arcgis/core, @arcgis/map-components
- **Data**: GeoTIFF rasters, CSV metadata, i18n (English/Spanish)
- **Deploy**: Vercel
