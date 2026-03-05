# Branch 1: Map & Spatial Engine

> **Purpose:** Everything inside the center panel — ArcGIS map, layer rendering, spatial interactions, comparison view.
> **Git Branch:** `feat/map-spatial`
> **Prerequisite:** Foundation branch merged to `main`.
> **File Boundary:** `src/app/features/map/**` — no other branch touches this folder.

---

## Quick Task Summary

| ID | Status | Last Updated | Task Description | Notes |
|----|--------|-------------|------------------|-------|
| | | | **── Checkpoint 1: Skeleton ──** | |
| MAP-01 | ⚪ Not Started | — | ArcGIS MapView with Colombia extent + basemap | CRS: Web Mercator display |
| MAP-02 | ⚪ Not Started | — | Basic layer infrastructure (add/remove/reorder) | Service that manages FeatureLayers + TileLayers |
| MAP-03 | ⚪ Not Started | — | Zoom controls, scale bar, attribution | Standard map chrome |
| MAP-04 | 🔶 Stretch | — | Coordinate display widget | Shows lat/lng on hover |
| | | | **── Checkpoint 2: Solution Flow ──** | |
| MAP-05 | ⚪ Not Started | — | [Design] Solution visualization style | Colors, opacity, planning unit rendering approach |
| MAP-06 | ⚪ Not Started | — | Render solution layer from `activeSolution$` | Subscribe → fetch geometry → add layer |
| MAP-07 | ⚪ Not Started | — | Solution legend component | Dynamic based on loaded solution |
| MAP-08 | 🔶 Stretch | — | Hover popup for planning unit info | Show unit ID + basic stats on hover |
| | | | **── Checkpoint 3: Regional Analysis ──** | |
| MAP-09 | ⚪ Not Started | — | [Design] AOI selection interaction model | Click feedback, highlight behavior, deselection UX |
| MAP-10 | ⚪ Not Started | — | Click-to-identify handler | Hit test admin boundaries → write `selectedAOI$` |
| MAP-11 | ⚪ Not Started | — | Highlight selected AOI | Outline + semi-transparent fill |
| MAP-12 | ⚪ Not Started | — | Respond to `visibleLayers$` signal | Toggle layer visibility as controls change |
| MAP-13 | 🔶 Stretch | — | Administrative boundary labels | Municipality/Department names on map |
| | | | **── Checkpoint 4: Comparison & Polish ──** | |
| MAP-14 | ⚪ Not Started | — | [Design] Side-by-side comparison layout | Sync behavior, divider, labeling |
| MAP-15 | ⚪ Not Started | — | Dual MapView with synchronized extent | Pan/zoom one → other follows via `mapExtent$` |
| MAP-16 | ⚪ Not Started | — | Symbology editor (color picker, opacity slider) | Live update without reload — stakeholder requirement |
| MAP-17 | ⚪ Not Started | — | Protected Areas as vector layer | Must be vector, not raster — explicit stakeholder requirement |
| MAP-18 | 🔶 Stretch | — | Map screenshot export (PNG/JPG) | Uses ArcGIS `MapView.takeScreenshot()` |

---

## Signal Contract

| Signal | Direction | Usage |
|--------|-----------|-------|
| `activeSolution$` | **Read** | When solution loads → render solution layer on map |
| `comparisonSolution$` | **Read** | When set → activate side-by-side comparison view |
| `visibleLayers$` | **Read** | When changed → toggle layer visibility |
| `selectedAOI$` | **Write** | When user clicks region → identify AOI → write signal |
| `mapExtent$` | **Write** | When user pans/zooms → sync comparison map |
| `rightSidebarMode$` | **Write** | When AOI selected → set to `'aoi'` |

---

## File Map

```
src/app/features/map/
├── map-view/
│   ├── map-view.component.ts       # ~400 lines — main ArcGIS MapView
│   ├── map-view.component.html     # ~50 lines
│   └── map-view.component.scss     # ~80 lines
├── layer-renderer/
│   ├── layer-renderer.service.ts   # ~300 lines — create/manage layers
│   └── layer-factory.ts            # ~200 lines — type → ArcGIS layer class
├── symbology-editor/
│   ├── symbology-editor.component.ts   # ~250 lines
│   └── symbology-editor.component.html # ~80 lines
├── aoi-selector/
│   ├── aoi-selector.service.ts     # ~200 lines — click → identify → signal
│   └── aoi-highlight.ts            # ~100 lines — highlight graphic
├── comparison-view/
│   ├── comparison-view.component.ts    # ~300 lines — dual map container
│   └── comparison-view.component.html  # ~60 lines
├── legend/
│   ├── legend.component.ts         # ~150 lines
│   └── legend.component.html       # ~50 lines
└── services/
    └── map-config.service.ts       # ~100 lines — basemap, CRS, extent defaults
```

---

## Checkpoint Details

### Checkpoint 1: Skeleton

**Goal:** Colombia basemap renders in the center panel. Layer infrastructure exists but nothing loaded yet.

**MAP-01: ArcGIS MapView with Colombia extent + basemap**
- Create `MapViewComponent` in `features/map/map-view/`
- Initialize ArcGIS MapView targeting a container `div` with `id="map-view-container"`
- Set initial extent to Colombia bounds (approx. -82 to -66 lon, -5 to 13 lat)
- Basemap: `"topo-vector"` or `"satellite"` (configurable via service)
- CRS: Web Mercator (EPSG:3857) for display; data in MAGNA-SIRGAS (EPSG:4686)

**MAP-02: Basic layer infrastructure**
- Create `LayerRendererService` — manages adding/removing/reordering layers on the map
- Create `layerFactory()` — given a `LayerConfig`, returns the appropriate ArcGIS layer type
- Support: `FeatureLayer`, `TileLayer`, `ImageryTileLayer`, `GraphicsLayer`

**MAP-03: Zoom controls, scale bar, attribution**
- Add standard ArcGIS widgets: Zoom, ScaleBar, Attribution
- Position widgets in corners that don't conflict with sidebar edges

### Checkpoint 2: Solution Flow

**Goal:** When `activeSolution$` changes, the solution renders on the map as a visible layer.

**MAP-05: [Design] Solution visualization style**
- Output: `docs/design-decisions/map-solution-viz.md`
- Decide: How are planning units rendered? (raster tile vs. vector polygons)
- Decide: Color scheme for selected vs. unselected units
- Decide: Opacity defaults, outline behavior
- Consider: Performance at full Colombia extent (~100k+ planning units?)
- Archive after MAP-06 is implemented

**MAP-06: Render solution layer from `activeSolution$`**
- Subscribe to `activeSolution$` in MapViewComponent
- When solution loads: fetch geometry (URL from solution metadata), create layer, add to map
- When solution clears: remove layer
- Apply visualization style from MAP-05 design

**MAP-07: Solution legend component**
- Floating legend panel over the map (bottom-left or top-right)
- Shows: solution name, color key, "selected" vs. "not selected" labels
- Updates when solution changes

### Checkpoint 3: Regional Analysis

**Goal:** User clicks a region on the map → AOI is identified → sidebar shows AOI Dashboard.

**MAP-09: [Design] AOI selection interaction model**
- Output: `docs/design-decisions/map-aoi-interaction.md`
- Decide: Click vs. click-and-hold? Single-click or confirmation?
- Decide: Hover feedback (highlight boundary on hover before click?)
- Decide: How to deselect (click elsewhere? X button? both?)
- Decide: What happens when clicking inside an already-selected AOI?
- Consider: Nested boundaries (municipality inside department inside SIRAP)
- Archive after MAP-10/MAP-11 are implemented

**MAP-10: Click-to-identify handler**
- On map click → hit test against administrative boundary layers
- Determine which AOI was clicked (municipality > department > SIRAP hierarchy)
- Write `selectedAOI$` signal with identified AOI data
- Set `rightSidebarMode$` to `'aoi'`

**MAP-11: Highlight selected AOI**
- Add a highlight graphic (outline + semi-transparent fill) around selected AOI
- Remove previous highlight when new AOI selected or deselected
- Use a dedicated `GraphicsLayer` so it doesn't interfere with data layers

**MAP-12: Respond to `visibleLayers$` signal**
- Subscribe to `visibleLayers$` — when layer visibility toggled in left sidebar, show/hide on map
- Handle opacity changes from the same signal
- Maintain layer order from the config

### Checkpoint 4: Comparison & Polish

**Goal:** Side-by-side comparison view works. Symbology editing works live. Protected Areas render as vectors.

**MAP-14: [Design] Side-by-side comparison layout**
- Output: `docs/design-decisions/map-comparison-layout.md`
- Decide: Horizontal split vs. swipe divider vs. toggle?
- Decide: How to label Scenario A vs. Scenario B?
- Decide: Synchronized zoom/pan behavior
- Archive after MAP-15 is implemented

**MAP-15: Dual MapView with synchronized extent**
- When `comparisonSolution$` is set → split center panel into two MapViews
- Scenario A (left) = `activeSolution$`, Scenario B (right) = `comparisonSolution$`
- Sync: pan/zoom one → other follows (use `mapExtent$` signal or view watcher)
- When comparison cleared → return to single map

**MAP-16: Symbology editor**
- Color picker (hue, saturation, lightness) for solution layer
- Opacity slider (0–100%)
- Apply changes live without page reload — explicit stakeholder requirement
- Persists user preferences per session

**MAP-17: Protected Areas as vector layer**
- Render Protected Areas and OMECs as `FeatureLayer` (vector polygons)
- Must NOT be raster — explicit stakeholder requirement (see MDD)
- Style: outline with semi-transparent fill, distinct from solution layer
- Support: National Parks, Indigenous Territories, OMECs as separate sublayers

---

## Integration Fix Slots

> These rows are populated during merge checkpoint testing. Leave empty until then.

| ID | Status | Last Updated | Fix Description | Discovered At |
|----|--------|-------------|-----------------|---------------|
| MAP-FIX-01 | — | — | *(reserved for Checkpoint 1 fixes)* | — |
| MAP-FIX-02 | — | — | *(reserved for Checkpoint 2 fixes)* | — |
| MAP-FIX-03 | — | — | *(reserved for Checkpoint 3 fixes)* | — |
| MAP-FIX-04 | — | — | *(reserved for Checkpoint 4 fixes)* | — |

---

*Last updated: March 3, 2026*
