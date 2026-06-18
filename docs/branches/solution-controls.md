# Branch 2: Solution Discovery & Controls

> **Purpose:** Everything in the left sidebar and modals — Solution Finder, layer management, solution selection, exports.
> **Git Branch:** `feat/solution-controls`
> **Prerequisite:** Foundation branch merged to `main`.
> **File Boundary:** `src/app/features/solution-finder/**` and `src/app/features/left-sidebar/**` — no other branch touches these folders.

---

## Quick Task Summary

| ID | Status | Last Updated | Task Description | Notes |
|----|--------|-------------|------------------|-------|
| | | | **── Checkpoint 1: Skeleton ──** | |
| SOL-01 | ⚪ Not Started | — | Left sidebar container with section slots | Scrollable, collapsible sections |
| SOL-02 | ⚪ Not Started | — | "Open Solution Finder" button + empty modal shell | Reusable modal overlay component |
| SOL-03 | ⚪ Not Started | — | Modal infrastructure (overlay, panel, close behavior) | Shared by Solution Finder + Perspective modals |
| SOL-04 | 🔶 Stretch | — | Sidebar collapse/expand toggle button | Collapse to icon-only rail |
| | | | **── Checkpoint 2: Solution Flow ──** | |
| SOL-05 | ⚪ Not Started | — | [Design] Solution Finder modal layout + UX flow | Checkbox matrix, target setting, results ranking |
| SOL-06 | ⚪ Not Started | — | Checkbox matrix component (themes × target %) | Core UI of the Solution Finder |
| SOL-07 | ⚪ Not Started | — | Include/Exclude toggle controls | Constraint toggles for areas |
| SOL-08 | ⚪ Not Started | — | Nearest-neighbor matching service | Search pre-calculated library → ranked matches |
| SOL-09 | ⚪ Not Started | — | Match results panel (ranked list + match % badges) | Top N matches displayed |
| SOL-10 | ⚪ Not Started | — | "Apply Solution" action | Writes `activeSolution$`, closes modal, sets sidebar mode |
| SOL-11 | 🔶 Stretch | — | Match quality indicator tooltip | Explains what match % means |
| | | | **── Checkpoint 3: Regional Analysis ──** | |
| SOL-12 | ⚪ Not Started | — | Layer visibility manager | Checklist of data layers with toggle switches |
| SOL-13 | ⚪ Not Started | — | Solution selector dropdown | Switch between previously loaded solutions |
| SOL-14 | ⚪ Not Started | — | Layer category grouping | Group by: Biodiversity, Ecosystem, Socio-Economic, etc. |
| SOL-15 | 🔶 Stretch | — | Layer search/filter input | Filter layer list by name |
| | | | **── Checkpoint 4: Comparison & Polish ──** | |
| SOL-16 | ⚪ Not Started | — | Solution comparison selector (Tier 2) | Pick Solution A + B, gated by `userTier$` |
| SOL-17 | ⚪ Not Started | — | Export trigger buttons | Wire to export service stubs (Shapefile, GeoJSON, PNG, PDF) |
| SOL-18 | ⚪ Not Started | — | [Design] Perspective selection flow | How users pick pre-set conservation perspectives |
| SOL-19 | ⚪ Not Started | — | Perspective selection modal | Pre-built target presets (e.g., "Biodiversity Focus") |
| SOL-20 | 🔶 Stretch | — | Custom data upload (Tier 2) | Vector/raster/draw upload for custom AOI |

---

## Signal Contract

| Signal | Direction | Usage |
|--------|-----------|-------|
| `activeSolution$` | **Write** | When user applies a solution → write the loaded solution |
| `visibleLayers$` | **Write** | When user toggles layers → update visibility array |
| `comparisonSolution$` | **Write** | When user selects Solution B → write comparison solution |
| `rightSidebarMode$` | **Write** | When solution applied → set to `'overview'` |
| `userTier$` | **Read** | Gate Tier 2 features (comparison, upload, export) |
| `activeSolution$` | **Read** | Show currently loaded solution info in sidebar |

---

## File Map

```
src/app/features/solution-finder/
├── finder-modal/
│   ├── finder-modal.component.ts       # ~350 lines — modal container + flow
│   └── finder-modal.component.html     # ~100 lines
├── checkbox-matrix/
│   ├── checkbox-matrix.component.ts    # ~300 lines — themes × targets grid
│   └── checkbox-matrix.component.html  # ~80 lines
├── constraint-toggles/
│   ├── constraint-toggles.component.ts # ~150 lines — include/exclude
│   └── constraint-toggles.component.html
├── match-results/
│   ├── match-results.component.ts      # ~200 lines — ranked list
│   └── match-results.component.html    # ~60 lines
└── services/
    └── matching.service.ts             # ~250 lines — nearest-neighbor logic

src/app/features/left-sidebar/
├── sidebar-container/
│   ├── sidebar-container.component.ts  # ~200 lines
│   └── sidebar-container.component.html
├── solution-selector/
│   ├── solution-selector.component.ts  # ~200 lines
│   └── solution-selector.component.html
├── layer-manager/
│   ├── layer-manager.component.ts      # ~250 lines — toggle list
│   ├── layer-manager.component.html
│   └── layer-category-group.component.ts # ~120 lines
├── export-controls/
│   ├── export-controls.component.ts    # ~150 lines
│   └── export-controls.component.html
└── perspective-selector/
    ├── perspective-modal.component.ts  # ~250 lines
    └── perspective-modal.component.html
```

---

## Checkpoint Details

### Checkpoint 1: Skeleton

**Goal:** Left sidebar renders with placeholder content. Modal opens and closes. Ready for content in CP2.

**SOL-01: Left sidebar container with section slots**
- Create `SidebarContainerComponent` in `features/left-sidebar/sidebar-container/`
- Scrollable content area with collapsible section slots
- Sections: "Active Solution" (top), "Data Layers" (middle), "Actions" (bottom)
- Each section is a placeholder `<div>` with label — branches fill in later checkpoints
- Root element: `id="left-sidebar-container"`

**SOL-02: "Open Solution Finder" button + empty modal shell**
- Primary CTA button at top of sidebar: "Buscar Solución" / "Find Solution"
- Click → opens modal (empty for now, just proves the overlay works)
- Button reads `activeSolution$` — label changes to "Change Solution" when one is loaded

**SOL-03: Modal infrastructure**
- Reusable modal component: backdrop overlay, content panel, close button, ESC to dismiss
- Supports: full-screen mode (for Solution Finder) and standard mode (for Perspective Selector)
- Accessible: focus trap, aria-modal, backdrop click to close
- Animates in/out (fade + slide)

### Checkpoint 2: Solution Flow

**Goal:** User can open Solution Finder, set targets, get matched solutions, apply one. The core "discovery workflow" works end-to-end.

**SOL-05: [Design] Solution Finder modal layout + UX flow**
- Output: `docs/design-decisions/solution-finder-ux.md`
- Decide: Step-by-step wizard vs. single scrollable page?
- Design: Checkbox matrix layout — themes as rows, target percentages as columns
- Design: How include/exclude toggles integrate (inline? separate section?)
- Design: Results display — how many matches? How is match % shown?
- Design: "Apply" button behavior — close modal? Show confirmation?
- Consider: Mobile-friendly modal at this size?
- Archive after SOL-06 through SOL-10 are implemented

**SOL-06: Checkbox matrix component**
- Grid: rows = conservation themes (from solution library metadata), columns = discrete target % options
- User checks one target per theme (e.g., "Cloud Forest: 30%")
- Themes grouped by category (Biodiversity, Ecosystems, etc.)
- Reflects MDD: "discrete %, no weight sliders" (decision made 1/12/2026)

**SOL-07: Include/Exclude toggle controls**
- List of spatial constraints (existing parks = include, urban areas = exclude)
- Toggle switch per constraint: Include / Exclude / Ignore
- Feeds into matching algorithm alongside targets

**SOL-08: Nearest-neighbor matching service**
- Given user's target selections → search pre-calculated solution library
- Calculate distance metric between user targets and each pre-calculated solution
- Return top N matches sorted by match quality (closest distance = best match)
- For V1.5: mock library with 10-20 pre-built solutions

**SOL-09: Match results panel**
- Ranked list of matched solutions
- Each shows: solution name, match % badge (e.g., "92% Match"), key parameter differences
- Click to preview (highlight in list), double-click or button to apply

**SOL-10: "Apply Solution" action**
- Write selected solution to `activeSolution$`
- Set `rightSidebarMode$` to `'overview'`
- Close modal
- Show brief toast/notification: "Solución cargada" / "Solution loaded"

### Checkpoint 3: Regional Analysis

**Goal:** User can toggle data layers on/off, switch between solutions. Left sidebar becomes a functional control panel.

**SOL-12: Layer visibility manager**
- Checklist of available data layers (from `getLayers()` API)
- Toggle switch per layer → updates `visibleLayers$` signal
- Show layer name (translated) + icon indicating type (vector/raster)
- Opacity slider per layer (expand on click)

**SOL-13: Solution selector dropdown**
- Dropdown or list showing previously loaded/applied solutions
- Click to switch active solution (writes `activeSolution$`)
- Shows match % next to each solution name
- "Clear Solution" option to return to welcome state

**SOL-14: Layer category grouping**
- Group layers under collapsible headers matching MDD categories:
  - System-Generated, Biodiversity, Ecosystem, Marine, Socio-Economic, Conflict, Protected Areas, Cultural, Administrative
- Expand/collapse per group
- "Toggle all in group" checkbox

### Checkpoint 4: Comparison & Polish

**Goal:** Tier 2 users can compare solutions, trigger exports, and use perspective presets.

**SOL-16: Solution comparison selector (Tier 2)**
- Only visible when `canAccessTier2` is true
- Two dropdowns: Solution A (baseline), Solution B (comparison)
- Selecting both → writes `comparisonSolution$` → triggers map split + comparison panel
- "Clear Comparison" button to exit comparison mode

**SOL-17: Export trigger buttons**
- Buttons grouped in "Actions" section of sidebar
- Options: Shapefile, GeoJSON, GeoPackage, GeoTIFF, PNG (150/300 DPI), PDF Report
- Click → calls export service stub (actual implementation can be a later branch)
- Tier-gated: basic exports for Tier 1, full suite for Tier 2

**SOL-18: [Design] Perspective selection flow**
- Output: `docs/design-decisions/perspective-selection-ux.md`
- Decide: What are "perspectives"? (Pre-built target presets like "Biodiversity Focus," "Carbon Priority")
- Decide: How does perspective relate to Solution Finder? (Pre-fills the matrix?)
- Archive after SOL-19 is implemented

**SOL-19: Perspective selection modal**
- Grid or list of pre-built conservation perspectives
- Each shows: name, description, icon, which themes are emphasized
- Click → pre-fills Solution Finder matrix → user can customize from there

---

## Integration Fix Slots

| ID | Status | Last Updated | Fix Description | Discovered At |
|----|--------|-------------|-----------------|---------------|
| SOL-FIX-01 | — | — | *(reserved for Checkpoint 1 fixes)* | — |
| SOL-FIX-02 | — | — | *(reserved for Checkpoint 2 fixes)* | — |
| SOL-FIX-03 | — | — | *(reserved for Checkpoint 3 fixes)* | — |
| SOL-FIX-04 | — | — | *(reserved for Checkpoint 4 fixes)* | — |

---

*Last updated: March 3, 2026*
