# Ecosystems Classification Visualization — Plan

The Ecosystems layer is uniquely harder than every other layer in the app: it carries several nested classification systems with wildly different cardinalities (from 8 Biome Families up to 430 IAvH Biome-Region Classes), and the 430 IAvH classes are the actual units the conservation solution was optimized over. That creates a real tension — we cannot dump 430 swatches into the legend or read 430 colors off the map, yet those 430 classes matter analytically because users will ask "were natural savannas included in the solution run?". This document captures the agreed design direction and the deferred work so we can pick it back up later.

For the immediate merge to `main` we intentionally shipped only the minimum needed to answer that core question honestly: the rich info modal already lists all classification levels with source links, and it shows a small "Considered in scenario" badge next to the IAvH Biome-Region Class (430) entry when Ecosystems is included in the active run. The full "symbolize + filter/highlight" interaction described below is deferred — the previously-prototyped "Highlight values" control was removed to keep the merge small and unambiguous.

We also decided, for this merge, to **show only Biome Family (8) on the map** and remove the "View by" classification dropdown entirely (from both the selected-layer row and the available-layers row). The IAvH 430 map view was producing no meaningful visual change (its 430 colors were lightness variants of the 8 family hues) and a confusing dense legend, so it is gone for now; the 430 classes remain fully documented and are "Considered in scenario"–badged in the info modal only when Ecosystems is included in the active run. The `?` info button now lives on the opacity row. Because the map view is locked to Biome Family, the legend automatically shows a clean 8-family swatch set (the dense "430 IAvH classes" summary path no longer triggers). Real per-class visual differentiation for 430 is deferred to ECO-1/ECO-3/ECO-6 below.

## Task Summary

| ID | Status | Last Updated | Task Description | Notes |
|---|---|---|---|---|
| ECO-0 | Done | 2026-06-26 | Reword jargon copy ("raster stores IAvH class IDs") to plain language; add "Considered in scenario" badge to the IAvH 430 row in the info modal | Shipped in this merge. Resolves the "were natural savannas in the run?" question at a basic level. |
| ECO-0b | Done | 2026-06-26 | Remove the prototype "Highlight values" control (querying/filtering deferred) | Reverted UI, signals, per-class alpha plumbing, legend highlight summary, and i18n keys. |
| ECO-0c | Done | 2026-06-26 | Lock the map to Biome Family (8); remove the "View by" dropdown; move `?` to the opacity row | Removes the meaningless 430 map view + dense legend for now. Legend auto-shows clean 8-family swatches. Deleted dead dropdown TS + orphaned i18n keys. |
| ECO-0d | Done | 2026-07-20 | Honest labeling: Selected Layers + master legend show "Ecosystems (Biome Family)"; info modal tags Biome Family as "Visualized on map," always tags IAvH 430 as "Not visualized," and tags it "Considered in scenario" only when Ecosystems is included in the active run | Clarifies map symbology vs run inputs without reintroducing View-by / Highlight controls. |
| ECO-1 | Not started | 2026-06-26 | Adopt the "Symbolize → Filter" conceptual model (parent/child, not rivals) | "Symbolize by" picks one level = how the whole layer is colored. "Highlight values" emphasizes a subset within the active level. |
| ECO-2 | Not started | 2026-06-26 | Move heavy controls out of the draggable row into a non-blocking anchored panel | Row returns to a clean peer; one "Symbology & filter" button opens an anchored panel (NOT a modal — must keep the map visible). |
| ECO-3 | Not started | 2026-06-26 | Fix the high-cardinality (430) legend pattern | Show "IAvH Biome-Region Class · 430 classes", an 8-family color band, and a "Browse classes" link to the modal. When a highlight is active, legend flips to show only highlighted values + "N other classes dimmed". Kill the dangling non-clickable "42 polygons". |
| ECO-4 | Not started | 2026-06-26 | Re-implement search → highlight (filter values within the active level) | Reuse per-class alpha to fade non-selected classes. Chips clear when the symbolize level changes. This is the app's first true "query/filter a layer" interaction. |
| ECO-5 | Not started | 2026-06-26 | Switch highlight/legend stats from "polygons" to km² and % of mapped area | Map is a raster, so "polygons" is the wrong unit. Keep polygon counts only inside the modal, labeled "source polygons". |
| ECO-6 | Not started | 2026-06-26 | Two-tier "Symbolize by" menu: exact-renderable vs reference-only levels | On the map: Biome Family (8), IAvH 430. Reference-only (disabled + "Reference" badge → open modal): Broad Ecosystem Type (28), Detailed Ecosystem Type (87), Transformation grade. |
| ECO-7 | Not started (Phase 2, data) | 2026-06-26 | Derive categorical rasters/masks for Broad/Detailed Ecosystem Type + Transformation grade | Unlocks promoting reference-only levels to selectable "on the map". Separate data-pipeline task. |
| ECO-8 | Open question | 2026-06-26 | Confirm the published classification summary includes the IAvH 430 section | Gates whether 430-view highlights can show real km² in Phase 1. Check the published Blob `ecosystem-classification-summary.json`. |

## Background and constraints

- **Data source:** Colombia's official MEC 2024 ecosystem map (IDEAM / Humboldt-IAvH). Mental model: one national jigsaw of non-overlapping polygons; each polygon carries several attributes at different granularities that do NOT form a clean parent-child tree.
- **Classification levels (label → approx # of values):** Biome Family → 8; Broad Biome Context → 7; IAvH Biome-Region Class → 430 (used by the optimizer); Broad Ecosystem Type / `ecos_sintesis` → 28; Detailed Ecosystem Type / `ecos_general` → 87; Transformation grade / `gra_trans` → small set.
- **Rendering reality:** the map data is a raster (`ecosistemas.tif`) whose cell values ARE the IAvH class IDs (1..430). So we can render exactly two levels from this single raster: Biome Family (8) (by grouping IDs into families) and IAvH 430. Other levels need separately-derived categorical rasters/masks (future). Full vector GeoJSON of ~460k polygons is too heavy for the browser — not pursuing the vector route. The renderer supports optional per-class alpha (fade non-selected, keep selected vivid).
- **Users:** conservation planners / decision-makers, mixed GIS literacy, bilingual (EN/ES). Desktop-first but must not break at smaller widths.

## The key reframe

Stop treating "430 unique colors on the map" as the goal — that is what makes everything feel broken (today the 430 colors are lightness variations within each of the 8 family hues, so the 430 view looks like the 8 families). Instead:

- **8 Biome Families = the readable symbology** (the choropleth you actually look at).
- **430 IAvH classes = the queryable/analytical layer** — reached by search → highlight, an honest legend count, and the info modal. This is exactly what answers "were natural savannas included in the solution?": search "savanna", highlight it, and the map shows where it is — rather than trying to read it off a 430-color map. The 430 stay fully present and explorable; we just don't pretend a 430-swatch choropleth is useful.

## Design principles applied

- **Hick's Law / progressive disclosure:** don't stack View-by + info + highlight inside the draggable row; reveal complexity on demand via an anchored panel.
- **Visibility of system status + honesty:** clearly distinguish levels the raster renders exactly vs levels that need future derived rasters; never imply exact map highlighting for unsupported levels.
- **Match between system and real world:** use km² / % of mapped area for a raster, not "polygons".
- **Non-blocking interaction:** use an anchored panel, not a modal, so the user can watch the map change while filtering.

## Risks / notes

- The "Symbolize by" vs "Highlight values" distinction must be reinforced with microcopy ("Highlight values within IAvH Biome-Region Class") or it will re-collide conceptually.
- Pulling the source ArcGIS layer's built-in per-class palette is worth exploring as a nicer source of hues for the highlighted subset, but it does not change the conclusion — 430 legend-able colors are not viable.
- Keep the Ecosystems row a peer in the draggable Selected Layers list throughout.
