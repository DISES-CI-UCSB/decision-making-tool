# Master Design Document — Implementation Reference

> **Purpose:** Coding-focused distillation of the full [MASTER_DESIGN_DOCUMENT.md](./MASTER_DESIGN_DOCUMENT.md).
> Strips out stakeholder context, discussion history, and review notes — keeps only what an AI or developer needs to plan and implement.

---

## Product Vision

**ECO-PLAN Decision Support Tool** — interactive conservation planning app for Colombia (terrestrial + marine).

**Model:** "Pre-calculated Exploration" — users define priorities → system matches best pre-calculated scenario from a library via nearest-neighbor search.

**Scope:** Colombia's complete territory including EEZ and territorial waters.

---

## User Tiers & Permissions

| Tier | Role | Auth | Key Capabilities |
|------|------|------|------------------|
| **1** | Open User (Public) | None | Solution Finder (checkbox matrix), Map, AOI Dashboard, Basic PDF Report |
| **2** | Decision Maker (Planner) | Login (7-day persistent session) | All Tier 1 + Scenario Comparison, Custom Data Upload (vector/raster/draw), Advanced Thematic Reports, Data Export (Shapefile/GeoTIFF/PNG) |
| **3** | Manager (Admin) | Admin Dashboard | Run Configuration, Species Group Fragmentation, Data Layer Management, Queue Management, Publishing |

**Note:** Tier 3 functionality is acknowledged but will be managed by the Mesa — no separate UI design needed.

---

## Core Workflows

### 1. Discovery Workflow (Tiers 1 & 2)
1. **Solution Finder** → User sets targets (discrete %) and constraints (include/exclude toggles). *(No weight sliders — decision made 1/12/2026)*
2. **Instant Match** → Nearest-neighbor search against pre-calculated library → Top N matches with "Match %" badges
3. **Apply Solution** → Load onto map. Match quality indicator shown.
4. **Local Analysis** → Click region → AOI Dashboard in right sidebar

### 2. Analysis Workflow (Tier 2 Only)
1. Select Baseline + Comparison scenarios
2. Difference Map: Agreement (green) / Conflict (orange/blue) / Connectivity (purple)
3. Export thematic reports + spatial data

### 3. Environmental Offset Use Case (Tiers 2 & 3) *[Flagged for Potential Removal]*
Specialized workflow for offset planning — ecological equivalence analysis via Trade-off and Territorial Planning reports.

---

## UI Layout (Three-Pane + Modal)

| Pane | Purpose | Key Components |
|------|---------|----------------|
| **Left Sidebar** | Control what's on the map | Solution Selector, Layer Visibility Manager, Symbology Controls, Export/Report Buttons |
| **Center Panel** | Interactive map | Single Map (default) or Side-by-Side Comparison (Tier 2). Vector rendering required for Protected Areas/OMECs. |
| **Right Sidebar** | Analysis & insights | Solution Overview Panel, AOI Dashboard, Scenario Comparison Panel, Welcome Panel |
| **Modal** | Solution discovery | Solution Finder ("Selection Grid"), Perspective Selection |

**Right Sidebar Display Modes:**
1. **Solution Overview** — When solution loaded, no region selected
2. **AOI Dashboard** — When user clicks a Municipality/Department/SIRAP
3. **Scenario Comparison** — Tier 2, when comparing two solutions
4. **Welcome Panel** — No solution active

---

## Finalized Metrics (from CSV review)

### Solution Overview Panel (10 metrics: 7 Approved, 3 Conditional)

| # | Metric | Units | Verdict | Key Notes |
|---|--------|-------|---------|-----------|
| 1 | Conservation Goals Met | Count & % | **Yes** | Clear quantitative targets needed |
| 2 | Species Groups Protected | Count | **Yes** | |
| 3 | Threatened Species Secured | Count | **Yes** | Data available via RIJ matrix column sums + rredlist |
| 4 | Ecosystem Coverage | km² & % | **Yes** | |
| 5 | Carbon Storage Capacity | tCO2e | **Yes** | |
| 6 | Water Regulation Services | m³ or index | **Maybe** | Check with Mesa for data |
| 8 | Agricultural Opportunity Cost | COP & USD | **Maybe** | Already used as cost in runs — TBD if also shown as output |
| 9 | Affected Agricultural Area | km² & % | **Yes** | |
| 13 | Conflict Zone Overlap | km² | **Maybe** | coco-muertes layer exists but cost is small; use as output stat |
| 17 | National Contribution | % of Colombia | **Yes** | Include what's added on top of existing protection |

**Removed:** #7 Connectivity Index, #10 Human Footprint Overlap, #11 Development Restriction Area, #12 Economic Impact, #14 Land Dispute Overlap, #15 Goal Achievement Quality, #16 Match Quality

### AOI Dashboard (35 finalized metrics)

**Regional Conservation:**
- #18 Priority Area in Region (km²) — **Yes**
- #19 Priority Area % of Region — **Yes** (add RUNAP comparison)

**Biodiversity (8 metrics, all Yes):**
- #21-25 Species Richness (Mammals, Birds, Amphibians, Reptiles, Plants)
- #26 Threatened Species Count
- #27 Endemic Species Count
- #28 % of National Species Total

**Ecosystems (5 metrics, all Yes):**
- #29-33 Ecosystem Coverage (Cloud Forest, Paramo, Dry Forest, Wetlands, Other)

**Marine & Coastal (5 metrics, all Maybe):**
- #34 MPA Overlap, #35 Coral Reef, #36 Mangrove, #37 Seagrass, #38 % in EEZ
- *Not currently running marine solutions — future work*

**Ecosystem Services (5 metrics):**
- #39 Total Carbon Biomass — **Yes**
- #40 Above-ground Carbon — **Yes**
- #41 Soil Organic Carbon — **Yes**
- #43 % of National Carbon — **Yes** (add RUNAP comparison)
- #44 Water Regulation Capacity — **Yes** (ask Mesa about data format)

**Socio-Economic (6 metrics):**
- #51-54 Land Use breakdown (Forest, Pasture, Crops, Other) — all **Yes**
- #55 Agricultural Opportunity Cost — **Maybe** (check with Mesa)
- #57 Historical Conflict Zone Overlap — **Maybe** (use as post-hoc stat)

**Cultural & Ethnic (2 metrics, all Yes):**
- #59 Indigenous Territories Area
- #60 Community Councils Area

**Protection Status (3 metrics, all Yes):**
- #63 Total Protected Area in AOI
- #64 % Overlap with National Parks
- #66 % Overlap with Indigenous Territories

**Removed:** HF Distribution (5 metrics), Average Carbon Density, Downstream Beneficiaries, % of Region in Agriculture, Social Conflict Risk Level, Consultation Requirement Flag/Area, % Overlap with OMECs, Coverage Gap, Synergy Score, Regional Significance Classification

### Scenario Comparison Panel (3 metrics, all Yes)

| # | Metric | Calculation |
|---|--------|-------------|
| 70 | Agreement Area (km²) | Scenario A ∩ Scenario B |
| 71 | Unique to Scenario A (km²) | Scenario A - Scenario B |
| 72 | Unique to Scenario B (km²) | Scenario B - Scenario A |

**Removed:** Connectivity/Synergy Zones

---

## Reports (Tier 2)

| Report | Status | Unique Metrics |
|--------|--------|---------------|
| ~~Trade-off Analysis Report~~ | ~~Removed~~ | ~~0~~ |
| Ecosystem Assessment Report | Suggested | 2 (#74 Ecosystem Protection Gap, #77 Marine Ecosystem Representation Index) |
| Connectivity Report | Suggested | 3 (Pinch Points, Corridor Restoration, Connectivity Score) |
| Species Conservation Report | Suggested | 2 (#82 Protection % by IUCN Threat, #83 Endemic Protection Achievement) |
| Territorial Planning Report | Suggested | 2 (#87 Distribution by Jurisdiction, #88 Production Area Change) |
| Ethnic Territory Consultation Report | Suggested | 2 (#90 FPIC Risk Score, #91 Protection in Ethnic Territories) |

**All reports:** PDF + in-app Page View. Must include bilingual support (Spanish default / English), methodology appendix, full data citations.

---

## Data Layer Categories

| Category | Layer Count | Status |
|----------|------------|--------|
| System-Generated (Prioritizr) | 4 | ✅ All available |
| Biodiversity & Species | 7 | ❓ All unknown |
| Ecosystem & Environmental | 8 | ❓ All unknown |
| Marine & Coastal | 5 | ❓ All unknown |
| Socio-Economic & Land Use | 6 | ❌ 1 missing, ❓ 5 unknown |
| Conflict & Security | 3 | ❓ All unknown |
| Protected Areas | 4 | ⚠️ 1 outdated (OMECs 2020), ❓ 3 unknown |
| Cultural & Ethnic | 4 | ❌ 1 missing (sacred sites), ❓ 3 unknown |
| Administrative & Planning | 8 | ❓ All unknown |
| **TOTAL** | **49** | **4 ✅, 1 ⚠️, 2 ❌, 42 ❓** |

**BLOCKER:** 42 of 49 layers unverified. Must resolve before Sprint 1.

---

## Key Technical Requirements

- **CRS:** MAGNA-SIRGAS (EPSG:4686) primary; WGS84 export option; Web Mercator for display
- **Auth:** Token-based, 7-day persistent sessions, PNNC protocol compatibility
- **Language:** Spanish (default) + English. All UI, reports, exports bilingual
- **Performance:** Progressive tile loading, lazy loading, gzip/brotli compression, connection quality indicator
- **Protected Areas:** Must render as **vectors** (not rasters) — explicit stakeholder requirement
- **Symbology:** Live color/transparency editing without reload
- **Exports:** Shapefile, GeoJSON, GeoPackage, GeoTIFF, PNG/JPG (150/300 DPI), PDF reports

---

## API Endpoints (Preliminary)

| Endpoint | Purpose |
|----------|---------|
| `GET /solutions/{id}` | Full solution details (geometry, metadata, metrics) |
| `GET /solutions/{id}/metrics` | All metrics for a solution |
| `GET /solutions/{id}/aoi/{aoi_id}` | Metrics filtered to AOI |
| `GET /solutions/compare/{id1}/{id2}` | Agreement/conflict areas + comparative metrics |
| `GET /layers` | Available data layers with metadata |
| `GET /layers/{id}/stats` | Summary statistics for a layer |

---

## Glossary (Key Terms)

| Term | Definition |
|------|-----------|
| **Planning Unit** | Fundamental spatial unit (grid cell/polygon) for analysis |
| **Theme** | Conservation feature to protect (e.g., "Cloud Forest") with a Goal (target %) |
| **Weight** | Cost/benefit layer with importance factor (-100 to +100) |
| **Include** | Area that MUST be in the solution (e.g., existing parks) |
| **Exclude** | Area that MUST NOT be in the solution (e.g., urban centers) |
| **Solution** | A single pre-calculated result (selected Planning Units) |
| **Minimum Set** | Optimization that minimizes cost while meeting all goals |
| **Minimum Shortfall** | Optimization that maximizes goal achievement within budget |
| **Boundary Penalty** | Penalty on solution perimeter to encourage compact shapes |

---

*Last updated: March 3, 2026*
*Source: Finalized Google Doc review + DISES Metrics CSV*
