# Decision Making Tool

A spatial conservation prioritization platform for Colombia, enabling stakeholders to upload, visualize, and analyze conservation planning scenarios.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         Client Browser                          │
└─────────────────────────────────────────────────────────────────┘
                                 │
                    ┌────────────┴────────────┐
                    ▼                         ▼
┌──────────────────────────────┐  ┌──────────────────────────────┐
│         shiny-app/           │  │          server/             │
│    (R Shiny Frontend)        │  │   (Node.js GraphQL API)      │
│  - Interactive maps          │  │  - User authentication       │
│  - Solution visualization    │  │  - Project/file management   │
│  - Data upload/export        │  │  - PostgreSQL via Sequelize  │
│  Port: 3838                  │  │  Port: 3001                  │
└──────────────────────────────┘  └──────────────────────────────┘
                                              │
                                              ▼
                                  ┌──────────────────────────────┐
                                  │       PostgreSQL DB          │
                                  │  - Users, Projects, Files    │
                                  │  - Solutions, Layers         │
                                  └──────────────────────────────┘
```

## Directory Structure

| Directory | Description |
|-----------|-------------|
| `shiny-app/` | R Shiny web application (wheretowork package) for map visualization, solution management, and data interaction |
| `server/` | Node.js Express + Apollo GraphQL backend for authentication, project storage, and file management |
| `Cambio_Global/` | R scripts for processing prioritization data (rij matrices, solutions) into upload-ready formats |
| `azure-deploy/` | Deployment scripts for Azure Container Registry and PostgreSQL |
| `test-app/` | Simplified test version of the Shiny app for development |

## Quick Start

### Development (Docker)
```bash
docker-compose up --build
```

### Production (Azure)
```powershell
cd azure-deploy
./deploy-to-azure.ps1
```

## Data Flow

1. **Cambio_Global/**: Run prioritization scenarios → generate solutions & rasters
2. **Processing scripts**: Extract features → create `layers.csv`, `solutions.csv`, ZIPs
3. **shiny-app**: Upload ZIPs → visualize on interactive map
4. **server**: Persist project metadata, user sessions, file references

## Key Technologies

- **Frontend**: R Shiny, Leaflet, htmlwidgets
- **Backend**: Node.js, Express, Apollo Server, GraphQL
- **Database**: PostgreSQL with Sequelize ORM
- **Processing**: R (prioritizr, raster, terra)
- **Deployment**: Docker, Azure Container Apps

