# Branch 0: Foundation

> **Purpose:** Scaffolding, shared services, layout shell, and type contracts that all parallel branches depend on.
> **Git Branch:** `foundation`
> **Prerequisite:** None — this runs first.
> **Must complete before:** Branches 1, 2, 3 begin.

---

## Quick Task Summary

| ID | Status | Last Updated | Task Description | Notes |
|----|--------|-------------|------------------|-------|
| FND-01 | ⚪ Not Started | — | Scaffold Angular 17+ project with standalone components | `ng new eco-plan`, path aliases, verify `ng serve` |
| FND-02 | ⚪ Not Started | — | Install + configure ArcGIS Maps SDK for Angular | Asset copying, verify blank MapView renders |
| FND-03 | ⚪ Not Started | — | Configure Tailwind CSS + design tokens | Colors, spacing, typography, conservation palette |
| FND-04 | ⚪ Not Started | — | Define core TypeScript models | Solution, Metric, Layer, AOI, UserTier interfaces |
| FND-05 | ⚪ Not Started | — | Implement AppStateService with Angular signals | The signal contract — see table below |
| FND-06 | ⚪ Not Started | — | Build three-pane layout shell | Responsive grid, collapsible sidebars, resize handles |
| FND-07 | ⚪ Not Started | — | Set up i18n with ngx-translate | Spanish default, English secondary, `\| translate` pipe |
| FND-08 | ⚪ Not Started | — | API service + HTTP interceptor with mock responses | Typed methods matching MDD API endpoints |
| FND-09 | ⚪ Not Started | — | Auth service skeleton | Token storage, tier guards, default Tier 1 |
| FND-10 | ⚪ Not Started | — | Build shared UI primitives | stat-card, progress-bar, badge, panel-container |
| FND-11 | ⚪ Not Started | — | Dev tooling: ESLint, Prettier, Git hooks | Consistent code style across all branches |

---

## Signal Contract (Defined in FND-05)

These signals are the communication layer between branches. Each parallel branch reads/writes specific signals **without modifying AppStateService**.

| Signal | Type | Written By | Read By |
|--------|------|-----------|---------|
| `activeSolution$` | `Signal<Solution \| null>` | Branch 2 (Controls) | Branch 1 (Map), Branch 3 (Analysis) |
| `selectedAOI$` | `Signal<AOI \| null>` | Branch 1 (Map) | Branch 3 (Analysis) |
| `visibleLayers$` | `Signal<LayerConfig[]>` | Branch 2 (Controls) | Branch 1 (Map) |
| `comparisonSolution$` | `Signal<Solution \| null>` | Branch 2 (Controls) | Branch 1 (Map), Branch 3 (Analysis) |
| `rightSidebarMode$` | `Signal<'welcome' \| 'overview' \| 'aoi' \| 'comparison'>` | Branches 1, 2, 3 | Branch 3 (Analysis) |
| `userTier$` | `Signal<1 \| 2 \| 3>` | Auth Service | All branches |
| `mapExtent$` | `Signal<Extent \| null>` | Branch 1 (Map) | Branch 1 (Comparison sync) |

Computed signals: `hasActiveSolution`, `isComparing`, `canAccessTier2`
Update methods: `loadSolution()`, `clearSolution()`, `selectAOI()`, `clearAOI()`, `toggleLayer()`, `setRightSidebarMode()`

> **Rule:** If a parallel branch needs a new signal, it gets added at the next merge checkpoint — never mid-checkpoint.

---

## File Map

```
src/app/
├── core/
│   ├── models/
│   │   ├── solution.model.ts       # ~50 lines
│   │   ├── metric.model.ts         # ~80 lines
│   │   ├── layer.model.ts          # ~60 lines
│   │   └── aoi.model.ts            # ~40 lines
│   ├── services/
│   │   ├── app-state.service.ts    # ~200 lines — THE signal hub
│   │   ├── api.service.ts          # ~200 lines
│   │   ├── auth.service.ts         # ~120 lines
│   │   └── mock-data.service.ts    # ~250 lines
│   ├── layout/
│   │   ├── app-shell/              # ~150 lines — CSS grid wrapper
│   │   ├── header/                 # ~100 lines — nav, language toggle, auth
│   │   └── resize-handle/          # ~80 lines
│   ├── i18n/
│   │   ├── es.json
│   │   └── en.json
│   └── shared/
│       ├── stat-card/              # ~80 lines
│       ├── progress-bar/           # ~60 lines
│       ├── badge/                  # ~40 lines
│       └── panel-container/        # ~80 lines
```

---

## Task Details

### FND-01: Scaffold Angular 17+ Project
- `ng new eco-plan --standalone --style=scss --ssr=false`
- Configure `tsconfig.json` path aliases: `@core/*`, `@features/*`, `@shared/*`
- Set up folder skeleton: `src/app/core/`, `src/app/features/`, `src/app/core/shared/`
- Verify: `ng serve` runs, app loads in browser

### FND-02: ArcGIS Maps SDK for Angular
- Install `@arcgis/map-components` and `@arcgis/core`
- Configure asset copying in `angular.json`
- Add CSS imports for ArcGIS widgets
- Verify: a blank MapView renders in the center panel without errors

### FND-03: Tailwind CSS + Design Tokens
- Install Tailwind CSS, configure with Angular's build system
- Define custom theme: conservation palette (greens, blues, earth tones), Colombia-appropriate accents
- Typography scale, spacing scale, border-radius tokens
- Ensure Tailwind classes work in component templates

### FND-04: Core TypeScript Models
- `Solution`: id, name, description, matchPercentage, metadata, geometryUrl, metrics
- `Metric`: id, name, value, unit, category, visualizationType, description
- `LayerConfig`: id, name, type (vector/raster), category, visible, opacity, symbology
- `AOI`: id, name, type (municipality/department/SIRAP), geometryUrl
- `UserTier`: enum — Public = 1, DecisionMaker = 2, Manager = 3
- Keep interfaces lean — add fields as branches need them

### FND-05: AppStateService (Signals)
- All signals from the Signal Contract table above
- Computed signals: `hasActiveSolution`, `isComparing`, `canAccessTier2`
- Update methods with clear names: `loadSolution(s)`, `selectAOI(a)`, `toggleLayer(id)`
- Unit test: signal updates propagate correctly

### FND-06: Three-Pane Layout Shell
- CSS Grid: `[sidebar-left] [center] [sidebar-right]`
- Left sidebar: collapsible, default ~320px
- Right sidebar: collapsible, default ~380px
- Center: flex-grow, fills remaining space
- Resize handles between panes (drag to resize)
- Mobile breakpoint: sidebars become slide-out drawers
- Each pane slot is a simple container — branches fill them via content projection or child routes

### FND-07: i18n Setup
- Install `@ngx-translate/core` + `@ngx-translate/http-loader`
- Create `es.json` and `en.json` with initial strings (app title, common labels, button text)
- Language toggle button in header component
- All template text uses `| translate` pipe

### FND-08: API Service + Mock Interceptor
- Typed methods matching MDD API endpoints:
  - `getSolution(id)`, `getSolutionMetrics(id)`, `getAOIMetrics(solutionId, aoiId)`
  - `compareSolutions(id1, id2)`, `getLayers()`, `getLayerStats(id)`
  - `findMatchingSolutions(targets)` — for nearest-neighbor search
- HTTP interceptor returns mock JSON during development
- Mock data follows TypeScript model shapes from FND-04

### FND-09: Auth Service Skeleton
- Token storage in localStorage with 7-day TTL
- `login()`, `logout()`, `getCurrentTier()`, `isAuthenticated()` methods
- Angular route guard for Tier 2+ features
- Default to Tier 1 (public) when not authenticated
- Auth state reflected in `userTier$` signal

### FND-10: Shared UI Primitives
- `StatCardComponent`: label, value, unit, optional icon, optional trend indicator
- `ProgressBarComponent`: value, max, label, color theming
- `BadgeComponent`: text, variant (success/warning/info/neutral)
- `PanelContainerComponent`: title, collapsible, header action buttons
- All accept i18n translation keys
- All have descriptive `id` attributes on root elements

### FND-11: Dev Tooling
- ESLint with `@angular-eslint/recommended`
- Prettier with consistent config
- Husky pre-commit hook: lint-staged (lint + format changed files)
- `.editorconfig` for tabs/spaces consistency

---

## Merge Criteria

Before declaring Foundation complete:

- [ ] `ng serve` compiles and runs without errors
- [ ] ArcGIS basemap renders in center panel
- [ ] Three-pane layout is responsive (desktop + mobile)
- [ ] AppStateService compiles with all signals defined
- [ ] Mock API returns typed data for all endpoint methods
- [ ] Language toggle switches between ES/EN
- [ ] Shared UI components render correctly in isolation
- [ ] Linting passes with zero errors

---

*Last updated: March 3, 2026*
