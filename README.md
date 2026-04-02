# Decision Making Tool

A spatial conservation prioritization platform for Colombia, enabling stakeholders to visualize and compare conservation planning scenarios using an interactive map interface.

## Directory Structure

| Directory | Description |
|-----------|-------------|
| `frontend/` | Angular web application — ArcGIS map, solution finder, analysis dashboards |
| `data/` | Geospatial data layers, solution rasters, and deploy assets |
| `docs/` | Design docs, branch plans, and team feedback |
| `mockups/` | HTML/CSS UI mockups and prototypes |
| `Archive/` | Legacy code (Shiny app, Node server, Azure deploy, R processing scripts) |

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
