# Branch 3: Analysis Dashboards

> **Purpose:** Everything in the right sidebar — Welcome panel, Solution Overview, AOI Dashboard (35 metrics), Scenario Comparison.
> **Git Branch:** `feat/analysis-dashboards`
> **Prerequisite:** Foundation branch merged to `main`.
> **File Boundary:** `src/app/features/analysis/**` — no other branch touches this folder.

---

## Quick Task Summary

| ID | Status | Last Updated | Task Description | Notes |
|----|--------|-------------|------------------|-------|
| | | | **── Checkpoint 1: Skeleton ──** | |
| ANL-01 | ⚪ Not Started | — | Right sidebar container with panel switching | Driven by `rightSidebarMode$` signal |
| ANL-02 | ⚪ Not Started | — | Welcome panel (bilingual onboarding content) | Shows when no solution is active |
| ANL-03 | 🔶 Stretch | — | Panel transition animations | Fade/slide between panels |
| | | | **── Checkpoint 2: Solution Flow ──** | |
| ANL-04 | ⚪ Not Started | — | [Design] Solution Overview metric layout + hierarchy | 10 metrics: grouping, card sizes, visual weight |
| ANL-05 | ⚪ Not Started | — | Solution Overview container component | Subscribes to `activeSolution$`, fetches metrics |
| ANL-06 | ⚪ Not Started | — | Conservation Goals + National Contribution metrics | #1 (count/%) and #17 (% of Colombia) — headline stats |
| ANL-07 | ⚪ Not Started | — | Species & Biodiversity summary metrics | #2 Species Groups Protected, #3 Threatened Species |
| ANL-08 | ⚪ Not Started | — | Ecosystem + Carbon + Socio-Economic cards | #4, #5, #9 — mid-tier stats |
| ANL-09 | ⚪ Not Started | — | Conditional metrics with "data pending" state | #6 Water, #8 Ag Cost, #13 Conflict — show if available |
| ANL-10 | 🔶 Stretch | — | "View details" expand toggle per metric | Inline expansion with additional context |
| | | | **── Checkpoint 3: Regional Analysis ──** | |
| ANL-11 | ⚪ Not Started | — | [Design] AOI Dashboard section layout + chart selections | 35 metrics across 8 sections — visual hierarchy |
| ANL-12 | ⚪ Not Started | — | AOI Dashboard container (collapsible section architecture) | Subscribes to `selectedAOI$`, fetches AOI metrics |
| ANL-13 | ⚪ Not Started | — | Regional Conservation section | #18 Priority Area, #19 % of Region (+ RUNAP comparison) |
| ANL-14 | ⚪ Not Started | — | Biodiversity section | #21–#28: 5 richness bars + threatened/endemic badges |
| ANL-15 | ⚪ Not Started | — | Ecosystem section | #29–#33: donut chart for 5 ecosystem types |
| ANL-16 | ⚪ Not Started | — | Carbon & Ecosystem Services section | #39–#44: carbon breakdown + water capacity |
| ANL-17 | ⚪ Not Started | — | Socio-Economic section | #51–#55, #57: land use donut + cost stat + conflict |
| ANL-18 | ⚪ Not Started | — | Cultural/Ethnic + Protection Status sections | #59, #60, #63, #64, #66: 5 metrics across 2 sections |
| ANL-19 | 🔶 Stretch | — | "No data" states + collapsible section animations | Graceful handling when metrics unavailable |
| | | | **── Checkpoint 4: Comparison & Polish ──** | |
| ANL-20 | ⚪ Not Started | — | Scenario Comparison container | Subscribes to `comparisonSolution$`, fetches comparison data |
| ANL-21 | ⚪ Not Started | — | Agreement/Unique area metrics | #70 Agreement, #71 Unique A, #72 Unique B |
| ANL-22 | ⚪ Not Started | — | Comparison color coding in stat cards | Green (agreement), orange (A only), blue (B only) |
| ANL-23 | 🔶 Stretch | — | Report preview pane stub | In-app preview of what PDF report would look like |

---

## Signal Contract

| Signal | Direction | Usage |
|--------|-----------|-------|
| `activeSolution$` | **Read** | When solution loads → switch to Overview, show metrics |
| `selectedAOI$` | **Read** | When AOI selected → switch to AOI Dashboard, show regional metrics |
| `comparisonSolution$` | **Read** | When set → enable Scenario Comparison panel |
| `rightSidebarMode$` | **Read** | Determines which panel to display |
| `userTier$` | **Read** | Gate Tier 2 features (Comparison panel) |

> This branch is a **pure consumer** — it only reads shared signals, never writes them.

---

## File Map

```
src/app/features/analysis/
├── panel-switcher/
│   ├── panel-switcher.component.ts     # ~120 lines — routes to correct panel
│   └── panel-switcher.component.html   # ~30 lines
├── welcome-panel/
│   ├── welcome-panel.component.ts      # ~100 lines
│   └── welcome-panel.component.html    # ~80 lines — bilingual onboarding
├── solution-overview/
│   ├── overview-container.component.ts     # ~250 lines — fetches + orchestrates
│   ├── overview-container.component.html   # ~60 lines
│   ├── goals-summary.component.ts          # ~150 lines — #1 + #17
│   ├── species-summary.component.ts        # ~150 lines — #2 + #3
│   ├── environment-cards.component.ts      # ~200 lines — #4, #5, #9
│   └── conditional-metrics.component.ts    # ~150 lines — #6, #8, #13
├── aoi-dashboard/
│   ├── dashboard-container.component.ts    # ~250 lines — fetches + section layout
│   ├── dashboard-container.component.html  # ~80 lines
│   ├── regional-conservation.component.ts  # ~150 lines — #18, #19
│   ├── biodiversity-section.component.ts   # ~300 lines — #21–#28
│   ├── ecosystem-section.component.ts      # ~200 lines — #29–#33
│   ├── carbon-section.component.ts         # ~200 lines — #39–#44
│   ├── socio-economic-section.component.ts # ~250 lines — #51–#57
│   └── cultural-protection.component.ts    # ~200 lines — #59–#66
├── scenario-comparison/
│   ├── comparison-container.component.ts   # ~200 lines
│   ├── comparison-container.component.html # ~50 lines
│   └── agreement-metrics.component.ts      # ~150 lines — #70–#72
└── shared-charts/
    ├── donut-chart.component.ts            # ~200 lines
    ├── bar-chart.component.ts              # ~200 lines
    ├── gauge-chart.component.ts            # ~150 lines
    └── chart-utils.ts                      # ~80 lines — color palettes, formatters
```

---

## Checkpoint Details

### Checkpoint 1: Skeleton

**Goal:** Right sidebar renders, switches between panels based on `rightSidebarMode$`, and shows a Welcome panel.

**ANL-01: Right sidebar container with panel switching**
- Create `PanelSwitcherComponent` in `features/analysis/panel-switcher/`
- Subscribe to `rightSidebarMode$` signal
- Conditionally render the correct panel: welcome | overview | aoi | comparison
- Use `@switch` or `ngSwitch` — no lazy routing needed (it's a sidebar, not pages)
- Root element: `id="right-sidebar-panel-switcher"`

**ANL-02: Welcome panel**
- Shows when `rightSidebarMode$ === 'welcome'` (default state, no solution loaded)
- Content: app title, brief description, "Get Started" CTA pointing to Solution Finder
- Bilingual: all text via `| translate` pipe
- Optional: illustration or icon set showing the workflow steps

### Checkpoint 2: Solution Flow

**Goal:** When a solution is loaded (via Branch 2), the right sidebar shows the Solution Overview with 10 metrics.

**ANL-04: [Design] Solution Overview metric layout + hierarchy**
- Output: `docs/design-decisions/solution-overview-layout.md`
- Decide: Which metrics are "headline" (large cards) vs. "supporting" (smaller)?
  - Suggested headlines: #1 Conservation Goals Met, #17 National Contribution
  - Suggested mid-tier: #2 Species Groups, #3 Threatened Species, #4 Ecosystem Coverage, #5 Carbon
  - Suggested secondary: #9 Affected Agricultural Area
  - Conditional: #6 Water, #8 Ag Cost, #13 Conflict
- Decide: Card layout (2-column grid? stacked? mixed sizes?)
- Decide: Visualization per metric (checkmarks for #1, progress bar for #17, stat cards for others)
- ASCII mockup of the panel
- Archive after ANL-05 through ANL-09 are implemented

**ANL-05: Solution Overview container**
- Subscribes to `activeSolution$`
- When solution present → calls `api.getSolutionMetrics(solutionId)`
- Passes metric data down to child components
- Shows loading skeleton while fetching
- Root element: `id="solution-overview-panel"`

**ANL-06: Conservation Goals + National Contribution**
- #1: Conservation Goals Met — count, percentage, visual checkmarks (✓/✗) for each goal
- #17: National Contribution — progress bar showing % of Colombia's territory
- Both displayed prominently as "headline" metrics at top of panel

**ANL-07: Species & Biodiversity summary**
- #2: Species Groups Protected — fraction display (e.g., "8 of 10") with progress bar
- #3: Threatened Species Secured — badge with count, red/amber/green based on coverage

**ANL-08: Ecosystem + Carbon + Socio-Economic cards**
- #4: Ecosystem Coverage — bar chart by ecosystem type (km² and %)
- #5: Carbon Storage Capacity — stat card with large number (tCO2e)
- #9: Affected Agricultural Area — stat card (km² and %)

**ANL-09: Conditional metrics**
- #6 Water Regulation, #8 Agricultural Opportunity Cost, #13 Conflict Zone Overlap
- Show only if data is available (API returns non-null)
- If unavailable: show "Datos pendientes" / "Data pending" placeholder
- MDD marks these as "Maybe" — design for graceful absence

### Checkpoint 3: Regional Analysis

**Goal:** When a user clicks an AOI on the map, the right sidebar shows the AOI Dashboard with up to 35 metrics organized in collapsible sections.

**ANL-11: [Design] AOI Dashboard section layout + chart selections**
- Output: `docs/design-decisions/aoi-dashboard-layout.md`
- Decide: Section order (Regional first? Biodiversity first?)
  - Suggested: Regional → Biodiversity → Ecosystems → Carbon → Socio-Economic → Cultural → Protection
- Decide: Which sections start expanded vs. collapsed
- Decide: Chart type per section:
  - Biodiversity → grouped bar chart (5 species + 3 stats)
  - Ecosystems → donut chart
  - Carbon → stacked stat cards
  - Land Use → donut chart
  - Others → stat cards + progress bars
- Decide: Marine section (#34–#38) — include with "future data" placeholder?
- ASCII mockup of the panel
- Archive after ANL-12 through ANL-18 are implemented

**ANL-12: AOI Dashboard container**
- Subscribes to `selectedAOI$`
- When AOI present → calls `api.getAOIMetrics(solutionId, aoiId)`
- Renders collapsible section containers, passes metrics to section components
- Header shows AOI name + type (Municipality / Department / SIRAP)
- Shows loading skeleton while fetching

**ANL-13: Regional Conservation section**
- #18: Priority Area in Region (km²) — progress bar
- #19: Priority Area % of Region — progress bar with RUNAP comparison (how much is above existing protection)

**ANL-14: Biodiversity section**
- #21–#25: Species Richness per taxa — grouped bar chart (Mammals, Birds, Amphibians, Reptiles, Plants)
- #26: Threatened Species Count — badge with red highlight
- #27: Endemic Species Count — badge
- #28: % of National Species Total — stat with comparison context

**ANL-15: Ecosystem section**
- #29–#33: Coverage by ecosystem type — donut chart with legend
- Segments: Cloud Forest, Páramo, Dry Forest, Wetlands, Other
- Show km² and % in tooltip/legend

**ANL-16: Carbon & Ecosystem Services section**
- #39: Total Carbon Biomass — headline stat card
- #40: Above-ground Carbon — breakdown stat
- #41: Soil Organic Carbon — breakdown stat
- #43: % of National Carbon — stat with RUNAP comparison
- #44: Water Regulation Capacity — gauge or stat card (format TBD by Mesa)

**ANL-17: Socio-Economic section**
- #51–#54: Land Use breakdown — donut chart (Forest, Pasture, Crops, Other)
- #55: Agricultural Opportunity Cost — conditional stat card (COP/USD)
- #57: Historical Conflict Zone Overlap — conditional stat card

**ANL-18: Cultural/Ethnic + Protection Status sections**
- Cultural/Ethnic:
  - #59: Indigenous Reservations Area (km²)
  - #60: Community Councils Area (km²)
- Protection Status:
  - #63: Total Protected Area in AOI (km² and %)
  - #64: % Overlap with National Parks
  - #66: % Overlap with Indigenous Territories

### Checkpoint 4: Comparison & Polish

**Goal:** Scenario Comparison panel works. Charts polished. Ready for Mesa demo.

**ANL-20: Scenario Comparison container**
- Only visible when `rightSidebarMode$ === 'comparison'` and `canAccessTier2`
- Subscribes to `comparisonSolution$`
- Calls `api.compareSolutions(id1, id2)` → gets agreement/conflict data

**ANL-21: Agreement/Unique area metrics**
- #70: Agreement Area (km²) — Scenario A ∩ B
- #71: Unique to Scenario A (km²) — A minus B
- #72: Unique to Scenario B (km²) — B minus A
- Display as stat cards with clear labels

**ANL-22: Comparison color coding**
- Agreement → green card/badge
- Unique to A → orange card/badge
- Unique to B → blue card/badge
- Colors match the map overlay colors (from Branch 1) — coordinate at merge checkpoint

---

## Charting Library Note

This branch needs a charting library for donut charts, bar charts, and gauges. Recommended options (decide during CP2 design task):

- **ngx-echarts** (Apache ECharts) — full-featured, good Angular bindings
- **ngx-charts** (Swimlane) — Angular-native, simpler API
- **Chart.js + ng2-charts** — lightweight, widely used

Whichever is chosen, wrap in the `shared-charts/` components so chart library is encapsulated.

---

## Integration Fix Slots

| ID | Status | Last Updated | Fix Description | Discovered At |
|----|--------|-------------|-----------------|---------------|
| ANL-FIX-01 | — | — | *(reserved for Checkpoint 1 fixes)* | — |
| ANL-FIX-02 | — | — | *(reserved for Checkpoint 2 fixes)* | — |
| ANL-FIX-03 | — | — | *(reserved for Checkpoint 3 fixes)* | — |
| ANL-FIX-04 | — | — | *(reserved for Checkpoint 4 fixes)* | — |

---

*Last updated: March 3, 2026*
