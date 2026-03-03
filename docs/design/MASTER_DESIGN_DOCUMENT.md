# Conservation Decision Support Tool: Master Design Document

*Source of Truth for Application Development*

This document is the authoritative design and requirements specification for a decision support tool intended to help Colombian conservation institutions evaluate trade-offs and identify priority areas for conservation.

It translates stakeholder feedback and policy requirements into buildable system behavior.

It is not a proposal, a narrative justification, or a UI mockup set. Its primary function is to allow developers to implement the system and to allow domain experts to verify that required decision logic, data inputs, and outputs are correct.

## Document Hierarchy Legend

This document uses a consistent naming convention to clarify the hierarchy of content:

| Level | Term | Numbering | Example | Visual Cue |
|-------|------|-----------|---------|------------|
| **L1** | **Part** | 1, 2, 3, 4, 5 | Part 1: Product Vision | `# H1` + `---` divider before |
| **L2** | **Area** | 4.1, 4.2, 4.3 | Area 4.1: Layout & UI Structure | `## H2` |
| **L3** | **Component** | 4.3.1, 4.3.2 | Component 4.3.1: Solution Overview Panel | `### H3` |
| **L4** | **Section** | A, B, C, D, E, F | Section F: Regional vs. National Contribution | Bold text with bullets |
| **L5** | **Sub-section** | F.1, F.2, F.3 | Sub-section F.1: National Target Calculator | Nested bullets |
| **L6** | **Element** | a, b, c | Element F.4.a: National Scale Context | Further nested bullets |

**Navigation Tips:**
- **Parts** are the major document divisions (Product Vision, User Personas, Workflows, etc.)
- **Areas** are functional groupings within Parts
- **Components** are specific UI elements or feature modules
- **Sections** are logical groupings within a Component
- **Sub-sections** and **Elements** provide granular detail within Sections

## Review Guide: How to Review This Document

### Purpose of This Review Guide

This document is large and serves multiple functions. Not all sections require the same level of review from all readers.

This Review Guide exists to:

- Direct reviewers to the sections where their expertise is most needed
- Clarify the type of feedback requested
- Reduce unnecessary review effort
- Ensure that high-priority sections are validated first, before secondary refinement

**Note:** Reviewers are not expected to read this document end-to-end unless explicitly noted below.

---

### High-Priority Review Areas (Read First)

The following sections are **implementation-critical**. These sections define system behavior, decision logic, metrics, reports, and data requirements. Feedback on these sections should be prioritized.

| Area | Title | Primary Reviewers |
|------|-------|-------------------|
| **4.3** | **Right Sidebar Analysis Views (Right Sidebar Components)** | **All** |
| **4.4** | **Metrics Reference Tables** | **All** |
| **4.5** | **Reports** | **All** |
| 4.6 | Data Layers | Data, GIS, and Backend Contributors |
| 4.11 | Layer Registry (Data Asset Inventory) | Data, GIS, and Backend Contributors |

Once these sections are validated and stabilized, the remaining sections can be reviewed for completeness and clarity.

---

### Role-Based Review Assignments

**Amy (PI / Scientific Oversight)**

**Primary focus areas:**
- Part 1, Part 2, Part 3
- Areas 4.3, 4.4, 4.5
- Summary tables of metrics
- Report structure and decision outputs

**Review focus:**
- Are the decision-support components aligned with real conservation decision-making needs?
- Do the metrics meaningfully support trade-off evaluation?
- Are the reports sufficient for institutional and policy-facing use?
- Are any critical factors, assumptions, or decision signals missing?

**Secondary review:**
- Remaining sections can be reviewed after high-priority sections are validated.
- Detailed data-layer verification may be delegated to data or GIS specialists as appropriate.

---

**Science and Domain Experts (Conservation, Modeling, Policy)**

**Primary focus areas:**
- Areas 4.3, 4.4, 4.6, and relevant portions of 4.5

**Requested feedback:**
- Verify that the listed metrics are correct, complete, and decision-relevant
- Confirm that metric definitions and formulas are scientifically valid
- Identify missing metrics or incorrect formulations
- Flag metrics that may be misleading or redundant

**When reviewing metrics:**
- Assume metrics will be displayed primarily in the right-hand sidebar and in reports
- Focus on *what* is being calculated, not *how* it is visually presented

---

**Data, GIS, and Backend Contributors**

**Primary focus areas:**
- Areas 4.6 and 4.11

**Requested feedback:**
- Verify that required input layers exist or can be obtained
- Confirm data sources, coverage, and update status
- Identify gaps where:
  - Data is missing
  - Data is outdated
  - Data assumptions are unclear
- Flag metrics that cannot currently be computed with known data assets

This review is intended to surface feasibility issues early, before implementation.

---

### Sections Not Requiring Active Review

The following sections are included to document stakeholder requests, transparency requirements, and compliance needs. **Active review is not requested** unless errors or contradictions are noticed.

- User experience requirements
- Transparency and documentation requirements
- Stakeholder requirements and verification matrices
- Narrative background and justification sections

These sections exist for traceability and accountability and should not be treated as design debates.

---

# Part 1: Product Vision

**The ECO-PLAN Decision Support Tool** is an interactive systematic conservation planning application for Colombia. It empowers users—from the general public to regional planners—to identify and prioritize conservation areas based on biodiversity, ecosystem services, and socio-economic data across **both terrestrial and marine/oceanic components** of Colombia's territory.

The application operates on a **"Pre-calculated Exploration"** model. Instead of running complex optimizations in real-time, the system allows users to define their priorities, instantly matches them to the best-fitting pre-calculated scenario from a vast library, and provides deep analytical tools to explore that solution.

**Territorial Scope:** The tool covers Colombia's complete national territory, including:
*   **Terrestrial Component:** Continental ecosystems, protected areas, and planning regions.
*   **Marine and Oceanic Component:** Coastal zones, marine protected areas, and strategic marine ecosystems. Planning units extend to cover Colombia's Exclusive Economic Zone (EEZ) and territorial waters.

---

# Part 2: User Personas & Access Levels

The application serves three distinct user tiers.

### 2.1. Tier 1: The "Open User" (Public)
*   **Identity:** General public, non-technical stakeholders, curious citizens.
*   **Access:** Public URL, no login required.
*   **Primary Goal:** Discover conservation priorities in their municipality or region.
*   **Key Features:** 
    *   Solution Finder (Matrix of check boxes-based discovery).
    *   Interactive Map exploration.
    *   AOI (Area of Interest) Dashboard for local statistics.
    *   Basic PDF Summary Report.

### 2.2. Tier 2: The "Decision Maker" (Planner)
*   **Identity:** Regional environmental authority (SIRAPs), government planners, technical staff.
*   **Access:** Authenticated (Login required).
    *   **Session Persistence:** Login sessions must persist across browser reloads and page navigations. Users should not be forced to re-authenticate on every application reload. Implement secure token-based authentication with configurable session duration (e.g., 7-day persistent login with "Remember Me" option).
*   **Primary Goal:** Perform detailed trade-off analysis and generate technical planning inputs.
*   **Key Features:** 
    *   **All Tier 1 features.**
    *   **Scenario Comparison:** Side-by-side views and difference mapping (conflict/agreement). Comparison tools are **Tier 2-only** to provide professional-grade trade-off analysis while maintaining simplicity for public users.
    *   **Custom Data Upload:** 
        *   Upload **vector layers** (Shapefiles, GeoJSON, KML/KMZ) to overlay on the map
        *   Upload **raster layers** (GeoTIFF, IMG) for visualization
        *   **Draw custom Areas of Interest:** Interactive polygon drawing tools to define analysis boundaries
        *   Full symbology control (color, transparency, labels) for uploaded layers
    *   **Advanced Reports:** Thematic reports for Connectivity, Ecosystems, Species Conservation, and Territorial Planning.
    *   **Data Export:** 
        *   Download raw spatial data (Shapefile/GeoTIFF)
        *   Export static map images (PNG, JPG) at publication quality

### 2.3. Tier 3: The "Manager" (Admin)
*   **Identity:** Core technical team, system administrators.
*   **Access:** Admin Dashboard.
*   **Primary Goal:** Maintain the solution library and underlying data infrastructure.
*   **Key Features:** 
    *   **Run Configuration:** Define new optimization parameters with advanced capabilities:
        *   **Species Group Fragmentation:** Ability to manipulate and fragment species groups by differential attributes (endemism level, threat status, taxonomic subgroups) for fine-grained optimization control
        *   Custom weight assignment to fragmented species groups
        *   Cost layer customization and combination
    *   **Data Layer Management:**
        *   **SIRAP Data Ingestion Workflow:** Streamlined process for ingesting and validating new data layers from SIRAP members:
            *   Upload interface with format validation (Shapefile, GeoTIFF, GeoJSON)
            *   Automated quality checks (CRS validation, topology checks, attribute schema verification)
            *   Metadata entry form (source organization, date, contact, methodology)
            *   Preview and approval workflow before publishing to production
            *   Version control for layer updates
            *   **Layer Version Management:**
            *   **Update existing layers** with new data vintages (e.g., "Protected Areas 2025 update")
            *   System maintains version history showing previous vintages
            *   "Current" badge indicates the active version displayed to users
        *   **Layer Deprecation Workflow:**
            *   **Deprecate outdated layers** (e.g., "OMEC Layer 2020" when replaced by "OMEC Layer 2025")
            *   Deprecated layers are hidden from Tier 1/2 users but retained for historical reference
            *   Clear documentation of deprecation reason and replacement layer
            *   Warning notifications if existing scenarios use deprecated layers
    *   **Queue Management:** Submit and monitor backend optimization jobs.
    *   **Publishing:** Review and publish new solutions to the public library.

*Note from Amy: We are not going to design a separate user persona or different set of tool functionality for the 'Manager' role. We can acknowledge that the Mesa wants this persona, but they will be in charge of figuring out how this person operates behind the scenes. The Tier 3: The "Manager" section exists now simply as an acknowledgement of what the Mesa wants.*

---

# Part 3: Core User Workflows

### 3.1. The Discovery Workflow (Tiers 1 & 2)
*The primary interface for exploring conservation priorities using the **Solution Finder** as the central discovery tool.*

#### 3.1.1. Define Priorities (Solution Finder)
*The Solution Finder is the primary discovery tool available to all users (Tiers 1 & 2).*

1.  **Open the Solution Finder:**
    *   User clicks "Find a Solution" button to open the Solution Finder modal/panel
    *   **Optional Starting Point - Featured Scenarios:** For new users, the Solution Finder can display 3-5 "starter scenarios" as quick-launch options:
        *   "Balanced Conservation & Development"
        *   "Maximum Biodiversity Protection"
        *   "Low-Cost Conservation Strategy"
        *   "Carbon & Water Security Focus"
        *   "Cultural Heritage & Biodiversity"
    *   Users can click a featured scenario to load it immediately, OR proceed to request custom priorities (requesting custom priorities may not even get developed)

2.  **Set Conservation Targets:**
    *   User interacts with the **Solution Finder** controls:
    *   **Themes (Conservation Goals):** Sets target percentages using **discrete target options** (e.g., 17%, 30%, or custom percentage)
        *   Users may also select specific data layers and request the system to automatically calculate standardized goal percentages (e.g., "Protect 30% of selected habitats")
        *   This approach aligns with pre-calculated scenarios and international conservation targets
    *   **Weights (Cost/Benefit Layers):** Sets importance via sliders (-100 to +100)
        *   Example: "Agricultural Opportunity Cost: -80" (avoid high-cost areas)
        *   Example: "Connectivity: +60" (prefer areas that connect protected areas)
    *   **Constraints (Optional):** Toggles includes/excludes
        *   Example: "Must include existing Parks"
        *   Example: "Exclude Urban Centers >10k population"
    *   **Warning System:** If user selects conflicting or extreme combinations, system provides feedback (e.g., "These settings may result in low-quality matches or no feasible solutions")

#### 3.1.2. Instant Matching & Results
*System finds the matched, pre-calculated scenario.*

1.  **Real-Time Search:**
    *   The system performs a Nearest Neighbor search against the pre-calculated library
    *   Result list shows top N matching scenarios with "Match %" badges
    *   Preview thumbnails show spatial pattern of each result

2.  **Apply Solution:**
    *   User clicks "Apply Scenario" to load the best match onto the main map
    *   The map updates immediately to display the **"Matched Scenario"**
    *   A "Match Quality" indicator informs the user how closely this scenario fits their requests (e.g., "95% Match")
    *   If match quality is below threshold (e.g., <70%), system suggests:
        *   Closest available scenario with explanation of differences
        *   Option to submit a request for a new scenario (Tier 2 users can submit to Admin queue)

#### 3.1.3. Local Analysis (AOI)
*After a solution is loaded, users can drill down into specific regions.*

1.  **Select a Region:**
    *   User selects a region (Municipality, Department, or SIRAP) from the map or search bar
    *   The **AOI Dashboard** opens in the right sidebar, displaying specific statistics for that region (see Section 4.3.2)

2.  **Regional Context:**
    *   All regional statistics and metrics are displayed regardless of perspective choice
    *   If a perspective is selected, the narrative text will frame results accordingly, but all data remains visible

### 3.2. The Analysis Workflow (Tier 2 Only)
*Advanced tools for trade-off assessment.*

1.  **Compare Scenarios:**
    *   User selects a "Baseline" scenario (e.g., the current Best Fit).
    *   User selects a "Comparison" scenario (e.g., a different set of priorities).
    *   System renders a **Difference Map** showing:
        *   **Agreement:** Areas selected in both.
        *   **Conflict:** Areas selected in only one.
        *   **Connectivity:** Potential corridors linking priority areas.

2.  **Export & Report:**
    *   User generates a technical **Thematic Report** (PDF) for their planning process.
    *   User downloads the spatial data for use in desktop GIS software.

### 3.3. Environmental Offset & Compensation Use Case (Tiers 2 & 3) [Flagged for Potential Removal]
*Specialized workflow for environmental offset planning and mitigation calculations.*

**Purpose:** Stakeholders emphasized the tool's application for defining environmental offsets, calculating compensation importance, and determining mitigation requirements. This use case describes how planners use the tool to identify and justify conservation areas for offset purposes.

**Workflow:**

1.  **Define Offset Context:**
    *   User (Tier 2 Planner) identifies the development project requiring environmental compensation
    *   User specifies the ecosystem type(s), species habitats, or ecosystem services impacted by the project
    *   User defines the geographic region where offset areas must be located (same biogeographic unit, watershed, etc.)

2.  **Identify Candidate Offset Areas:**
    *   User explores pre-calculated conservation scenarios to identify priority areas that provide **ecological equivalence**:
        *   Same ecosystem types as impacted area
        *   Similar or higher biodiversity value
        *   Connectivity to existing protected areas
    *   User filters scenarios by relevant themes (e.g., "Cloud Forest protection", "Jaguar habitat")
    *   **AOI Dashboard** provides metrics on ecosystem representation, species coverage, and conservation value

3.  **Calculate Offset Equivalence:**
    *   User generates **Trade-off Analysis Report** for candidate offset areas, which provides:
        *   **Ecosystem Coverage:** Area (km²) of each ecosystem type in candidate zones
        *   **Species Habitat:** Threatened and endemic species with habitat in offset areas
        *   **Ecosystem Services:** Carbon storage (tCO2e), water regulation capacity
        *   **Connectivity Value:** Contribution to landscape connectivity
    *   User generates **Territorial Planning Report** to assess:
        *   Land use compatibility
        *   Agricultural opportunity cost of offset designation
        *   Jurisdictional distribution (municipalities, CARs)

4.  **Justify Offset Selection:**
    *   Reports provide auto-generated narrative text explaining:
        *   Why the selected offset area is ecologically equivalent to the impacted area
        *   The conservation gains achieved by protecting the offset area
        *   Trade-offs and opportunity costs of the offset designation
    *   User exports reports (PDF) and spatial data (Shapefile/GeoJSON) for submission to environmental authorities

5.  **Scenario Comparison for Offset Optimization (Tier 2):**
    *   User compares multiple candidate offset scenarios using the **Scenario Comparison Panel**
    *   Difference maps show which areas provide the greatest ecological equivalence
    *   Comparative metrics help justify the final offset selection

**Key Reports for Offset Planning:**
- **Trade-off Analysis Report:** Comprehensive ecological and economic justification
- **Territorial Planning Report:** Land use compatibility and administrative context
- **Ecosystem Assessment Report:** Detailed ecosystem representation analysis

---

# Part 4: Components & Functional Specifications

## Area 4.0: Components Overview & Summary

This section provides a high-level overview of all UI components in the application, making it easy to understand the system architecture and locate specific components in the detailed specifications below.

### Area 4.0.1: Components Overview & Summary

**Table A: Interactive Application Components**

These are the live UI components users interact with in the application.

| Component Name | Location | Has Metrics? | # of Metrics | Top 3-5 Key Metrics | Metrics Table |
|----------------|----------|--------------|--------------|---------------------|---------------|
| **LEFT SIDEBAR** | | | | | |
| Solution Selector | Button in Left Sidebar -> Pop-Up Modal | No | 0 | — | — |
| Layer Visibility Manager | Left Sidebar | No | 0 | — | — |
| Symbology Control Panel | Left Sidebar | No | 0 | — | — |
| Export/Report Buttons | Left Sidebar | No | 0 | — | — |
| **CENTER PANEL** | | | | | |
| Interactive Map | Center Panel | No | 0 | — | — |
| Map Controls | Center Panel | No | 0 | — | — |
| **RIGHT SIDEBAR** | | | | | |
| Solution Overview Panel | Right Sidebar | **Yes** | **10** | Conservation Goals Met, Carbon Storage Capacity, National Contribution, Agricultural Opportunity Cost, Conflict Zone Overlap | Area 4.4.1 |
| AOI Dashboard | Right Sidebar | **Yes** | **36** | Priority Area in Region, Species Richness by Taxa, Ecosystem Coverage, Total Carbon Biomass, Protected Area Overlap | Area 4.4.2 |
| Scenario Comparison Panel | Right Sidebar | **Yes** | **3** | Agreement Area (km²), Unique to Scenario A, Unique to Scenario B | Area 4.4.3 |
| Welcome Panel | Right Sidebar | No | 0 | — | — |
| **MODALS** | | | | | |
| Solution Finder Modal | Modal | No | 0 | — | — |
| Perspective Selection Modal | Modal | No | 0 | — | — |

**Interactive Components Summary:** 12 total components, 3 with metrics, **49 finalized metrics** (39 Yes + 10 Maybe) based on `DISES Metrics - Finalized Metrics.csv` (see Area 4.4 for complete metrics reference).

**Table B: Generated Reports & Documentation**

These are outputs that can be viewed in-app (Page View) and downloaded (PDF) for sharing and detailed analysis. Reports primarily **reuse metrics** from the interactive components above but may include additional unique metrics.

Jan 26th, 2026 Note: We may have one report where the user can add bundles of metrics.

| Report Name | Output Format | Metrics Source | # of Additional Unique Metrics | Section Reference |
|-------------|---------------|----------------|-------------------------------|-------------------|
| ~~Trade-off Analysis Report~~ | ~~PDF + Page View~~ | ~~Reuses Solution Overview Panel metrics~~ | ~~**0** (all metrics from 4.3.1)~~ | ~~4.5 (Report #1)~~ |
| Ecosystem Assessment Report | PDF + Page View | Reuses AOI Dashboard ecosystem metrics | **TBD** (not finalized in CSV) | 4.5 (Report #2) |
| Connectivity Report | PDF + Page View | Reuses AOI Dashboard and Scenario Comparison metrics | **TBD** (not finalized in CSV) | 4.5 (Report #3) |
| Species Conservation Report | PDF + Page View | Reuses AOI Dashboard biodiversity metrics | **TBD** (not finalized in CSV) | 4.5 (Report #4) |
| Territorial Planning Report | PDF + Page View | Reuses AOI Dashboard socio-economic metrics | **TBD** (not finalized in CSV) | 4.5 (Report #5) |
| Ethnic Territory Consultation Report | PDF + Page View | Reuses AOI Dashboard cultural metrics | **TBD** (not finalized in CSV) | 4.5 (Report #6) |

**Reports Summary:** 6 total reports, all available as both in-app Page View and downloadable PDF. As of the current finalized metrics CSV, report-specific unique metrics are **not finalized** and should be treated as TBD.

### 4.0.2. Summary Statistics of All Components, Reports,  Metrics

**Interactive Components:**
- **Total Interactive Components:** 12
- **Components with Metrics:** 3 (Solution Overview Panel, AOI Dashboard, Scenario Comparison Panel)
- **Total Finalized Metrics in Interactive App:** 49 (from CSV)
- **Most Metric-Heavy Component:** AOI Dashboard (36 metrics)

**Reports:**
- **Total Reports:** 6
- **Fully Specified Reports:** 1 (Trade-off Analysis Report)
- **Thematic Reports with Finalized Unique Metrics:** 0 (reports currently reuse finalized interactive metrics)
- **Report-Unique Metrics Status:** TBD pending future metric finalization cycle

**Total Finalized Metrics (Current Source of Truth):** 49 (39 Yes + 10 Maybe)

**Overall:**
- **Total UI Components + Reports:** 18
- **Metric Distribution:** All finalized metrics are concentrated in Right Sidebar analysis components; report-specific unique metrics are pending future definition

### 4.0.3. Key Insights for Team Review

**Where to Focus Your Review:**
1. **Right Sidebar Components (Analysis Dashboard)** - This is where all finalized metrics currently live
   - Solution Overview Panel: 10 finalized metrics (Component 4.3.1)
   - AOI Dashboard: 36 finalized metrics (Component 4.3.2)
   - Scenario Comparison Panel: 3 finalized metrics (Component 4.3.3)

2. **Reports** - Reports primarily reuse finalized metrics from the right sidebar components
   - Any report-unique metrics should be treated as proposed/TBD until they are added to the finalized metrics CSV


**Important Notes:**
- **Control and visualization components have NO metrics** - they're for user interaction and display only
- **All metrics are in the Analysis Dashboard** (Right Sidebar) - this is intentional for focused data interpretation
- **Reports reuse metrics** from interactive components - reduces duplication and ensures consistency
- **Metric tables in Sections 4.3.1 and 4.3.2** show exactly which metrics appear where (with "Also appears in:" column coming in restructure)

## Area 4.1: Layout & UI Structure
The interface follows a three-pane layout with a prominent modal workflow for solution discovery.

*   **Left Sidebar ("Control Dashboard"):**
    *   **Purpose:** Control what appears on the map. This is where users select solutions and toggle layer visibility—any changes here directly affect what is displayed in the Center Panel.
    *   **Components:**
        *   **Solution Selector:** Interface for choosing which conservation scenario to display on the map. This may include:
            *   A "Solution Finder" button that triggers the large "Selection Grid" modal.
            *   A dropdown or list showing the currently active solution (e.g., "Best Fit: 95% Match").
        *   **Layer Visibility Manager:** Toggles for map layers with advanced filtering capabilities:
            *   **Default Visible Layers:** Existing Protected Areas (APs), OMECs, and other management figures are **visible by default** on application load to provide immediate context and prevent confusion with the generated conservation solution layer.
            *   **Layer Groups:** Hierarchical organization (e.g., "Roads", "Protected Areas", "Municipal Boundaries", "Priority Conservation Areas")
            *   **Filter by Environmental Authority (CARs):** Dedicated filter to display data specific to individual Corporaciones Autónomas Regionales
            *   **Filter by Administrative Boundary:** Filter layers by Municipality, Department, or SIRAP
            *   **Search Functionality:** Quick search to find specific layers by name
        *   **Symbology Control Panel (Tier 2):**
            *   **For Active Conservation Solution:** Color picker and transparency slider
            *   **For User-Uploaded Layers:** Direct color/transparency controls accessible in the sidebar **without requiring layer deletion and reload**
            *   **Apply/Reset buttons** for symbology changes
        *   **Export/Report Buttons:** Triggers for generating PDFs or downloading data (note: these may be relocated to the right sidebar if they are better suited to the analysis workflow).

*   **Center Panel (Map):**
    *   **Purpose:** Interactive spatial visualization that reflects the user's selections from the Left Sidebar.
    *   **Display Modes:**
        *   **Single Map View (Default):** One map showing the currently selected conservation solution overlaid with visible layers (base maps, protected areas, biodiversity data, etc.).
        *   **Side-by-Side Comparison View (Tier 2):** Two maps displayed side-by-side for comparing different conservation scenarios.
    *   **Map Content:**
        *   **Conservation Solution Layer:** Visual representation of priority conservation areas (selected planning units) from the active scenario.
        *   **Base Layers:** Contextual map data such as:
            *   Administrative boundaries (Municipalities, Departments, SIRAPs)
            *   Roads and infrastructure
            *   Protected areas (existing parks and reserves - terrestrial and marine)
        *   **Thematic Data Layers:** Toggleable layers showing:
            *   **Biodiversity features:** Species habitats, ecosystem types, biomes (terrestrial and marine)
            *   **Socio-economic data:** Land use, agricultural areas, conflict zones
            *   **Environmental data:** Carbon stocks, water resources, connectivity
            *   **Ethnic and Cultural Component:** Indigenous reservations, community councils, and ethnic territories for consultation and differential prioritization
            *   **Territorial Planning Determinants:** Official land-use planning layers showing determinants and their order of prevalence
            *   **Prospective Models:** Future scenario layers showing deforestation projections, climate change impacts, transformation risks, and drivers of biodiversity loss
        *   **Management Figures Rendering Standard:**
            *   **Vector Representation Required:** Existing Protected Areas (APs), OMECs, and other management figures **must be displayed as vector shapes (polygons) rather than rasterized layers** to ensure precision and detail at regional and local scales
            *   **📋 User Requirement Origin:** This requirement directly addresses stakeholder feedback that the previous tool version displayed PAs/management figures as rasters. Users explicitly requested shapes for precision. **This fix must be maintained in the PNN technical handover documentation.**
            *   Vector rendering enables:
                *   Clean boundary visualization at any zoom level
                *   Accurate overlap analysis with conservation solutions
                *   Precise area calculations for reporting
                *   Interactive feature identification (click to see individual park details)
        *   **Difference Mapping (Comparison Mode only):** Visual overlay showing:
            *   **Agreement (Green):** Areas selected in both scenarios
            *   **Conflict (Orange/Blue):** Areas selected in only one scenario
            *   **Connectivity/Synergy (Purple):** Potential corridors linking priority areas
    *   **Essential Map Controls:**
        *   **Compass Rose (North Arrow):** Orientation indicator
        *   **Scale Bar:** Visual representation of map scale with distance units
        *   **Legend Box:** Dynamic legend showing symbology for all visible layers with clear labels
        *   **Layer Labels:** All map features must display identifying labels when visible
        *   **Coordinate Display:** Current cursor coordinates (Lat/Long or UTM)
        *   **Basemap Selector:** Toggle between different basemap styles (Satellite, Streets, Terrain, Topographic)
    *   **Symbology Controls:**
        *   **Dynamic Color/Transparency Adjustment:** Users can modify the color scheme and transparency of the active conservation solution layer and user-uploaded layers **without requiring deletion and reload**
        *   **Layer Order Management:** Ability to reorder layers in the visibility stack
    *   **Interactions:**
        *   Pan, zoom, and navigate the map
        *   Click on features to identify details
        *   Click on administrative regions (Municipality, Department, SIRAP) to trigger the AOI Dashboard in the Right Sidebar
        *   **Search for locations by name** (geocoding support)
        *   **Filter by location layers:** Apply spatial filters to show only data within specific administrative boundaries or user-defined areas
        *   **Draw Area of Interest:** Interactive drawing tools to create custom polygons for analysis
        *   **Measure Tools:** Distance and area measurement utilities

*   **Right Sidebar ("Analysis Dashboard"):**
    *   **Purpose:** Provide analysis and insights about what is currently displayed on the map. This panel responds to map interactions and displays detailed statistics, comparisons, and regional breakdowns.
    *   **Display Modes:** The right sidebar adapts based on user context and tier access. It dynamically shows one of several views:
        1. **Solution Overview Panel** (Section 4.3.1) - Default when a conservation solution is loaded/active but no specific region is selected. Shows high-level summary statistics, trade-off analysis, and national contribution.
        2. **AOI Dashboard** (Section 4.3.2) - When a user clicks on a Municipality, Department, or SIRAP on the map. Shows detailed region-specific statistics and regional vs. national contribution analysis.
        3. **Scenario Comparison Panel** (Section 4.3.3) - Tier 2 only, when comparing two solutions. Shows side-by-side analysis and difference metrics.
        4. **Welcome/Getting Started Panel** (Section 4.3.4) - When no solution is active. Guides new users to begin exploring.

## Area 4.2: Solution Finder ("Selection Grid") Modal

*NOTE: The mock-ups referenced below are AI-generated and not meant to be considered the definitive design. Discussion is ongoing.*
A large, centralized Modal interface for discovering conservation scenarios. This is separated from the sidebar to accommodate the comprehensive input options and narrative-driven exploration.

*   **UI Components (Amy note: We decided (on 1/12) that users will only be able to select targets and includes/excludes. We will get rid of the middle sliders for the weights/costs):**
    *   **Theme Goal Selectors:** 
        *   **Discrete target options** for each conservation feature (e.g., 17%, 30%, 34%, or Custom)
        *   **Layer-based calculation tool:** Users can select specific data layers and the system automatically calculates standardized goal percentages (e.g., "Protect 30% of Jaguar Habitat")
        *   Visual indicators showing alignment with international conservation targets (e.g., 30x30 initiative)
    *   **Constraint Toggles:** Binary On/Off switches for Includes (Lock-in) and Excludes (Lock-out)
    *   **Narrative Navigation:** 
        *   Guided workflows presenting scenarios organized by stakeholder narratives and use cases
        *   "Exploration Paths" to prevent users from overwhelming the system by selecting too many options at once
    *   **Result List:** Displays top N matching scenarios with "Match %" badges and brief descriptions
    *   **Preview Map:** Small preview of the selected scenario before applying it to the main map
*   **Behavior:**
    *   Inputs trigger a Nearest Neighbor search in the vector database
    *   System provides feedback if selected combination has low match quality or is outside the scenario library coverage
    *   User clicks "Apply Scenario" to load the best match onto the main Center Panel map

## Area 4.3: Right Sidebar Analysis Views (Right Sidebar Components)

At a high level, there are **three** main analysis perspectives the right sidebar is meant to serve:

1. The solution overview (the entire solution)
2. The area of interest (selected regions or custom polygons)
3. Comparison between solutions

There is also the welcome/getting started view. The following components describe how these perspectives will be served.

### Component 4.3.1: Solution Overview Panel
*Trigger: A conservation solution is loaded/active, but no specific region is selected.*

**Purpose:** Provide high-level summary statistics about the currently active conservation scenario.

**Content (Component Sections):**

*   **Section A: Scenario Identity**
    *   Solution name/ID
    *   Match quality indicator (e.g., "95% Match to your priorities")
    *   Date created or last updated
    *   **Optimization Parameters Used:**
        *   **Theme Goals (Aggregated Display):** 
            *   **Note:** If the scenario includes thousands of individual conservation features (e.g., individual species habitats), display them at an **aggregated level** to prevent overwhelming users
            *   **Aggregated Groups:** Show high-level groups with target percentages:
                *   "Mammal Species: 30% (15 of 50 species with adequate habitat protection)"
                *   "Cloud Forest Ecosystems: 32% protected (Goal: 30%)"
                *   "Threatened Amphibians: 25% (8 of 32 species adequately protected)"
            *   **Drill-Down Capability:** Users can click/expand aggregated groups to see individual species/features:
                *   Expand "Mammal Species" → See individual species list: "Jaguar: 28%", "Spectacled Bear: 35%", etc.
            *   **Display Strategy:**
                *   Primary view: Show 8-12 major conservation groups (Mammals, Birds, Ecosystems, etc.)
                *   Detailed view: Allow expansion to see hundreds or thousands of individual features
        *   **Weight Factors Applied:** Explicitly name the data layers used for each weight, not generic terms:
            *   **Correct:** "Cost: Agricultural Opportunity Cost 2021 (Factor: -80)"
            *   **Incorrect:** "Cost: Avoid High Cost (Factor: -80)"
        *   This ensures users understand exactly which layers influenced the optimization
        *   **Constraints:** List includes/excludes applied (e.g., "Included: All National Parks", "Excluded: Urban Centers >10k population")
    *   **Metadata Transparency:**
        *   Official data sources cited with full agency names and publication dates
        *   Data currency indicators (e.g., "Based on 2023 biodiversity data")
        *   Link to detailed methodology and data provenance documentation

*   **Section B: Spatial Summary**
    *   **Total Priority Area:** Area displayed with explicit units (km² and hectares) and percentage of Colombia designated for conservation
    *   **Component Breakdown:** Terrestrial vs. Marine conservation area statistics
    *   **Number of Priority Zones:** Count of discrete conservation patches/reserves
    *   **Average Patch Size:** Mean area of conservation zones (with units)
    *   **Largest Priority Zone:** Size of the biggest contiguous conservation area (with units)

*   **Section C: Conservation Achievement**
    *   **Themes (Goals):** Visual indicators showing which conservation targets are met
        *   Example: "✓ Species Protection: 32% (Goal: 30%)"
        *   Example: "✗ Wetlands: 18% (Goal: 25%)"
    *   **Goal Achievement Narrative:** Auto-generated text providing context and interpretation:
        *   **National Level:** "This scenario protects 32% of critical species habitats, exceeding the 30x30 global target and contributing to Colombia's biodiversity commitments under the Kunming-Montreal Framework."
        *   **Regional Level:** "Within Cauca Department, this solution conserves 45% of endemic bird habitats, significantly above the national average of 32%."
        *   **Trade-off Context:** "While wetland goals are unmet (-7%), this scenario prioritizes high-elevation ecosystems critical for water regulation and carbon storage."
    *   **Quick Stats Cards:** High-level metrics:
        *   Species habitats protected
        *   Carbon stored (tCO2e)
        *   Water regulation capacity

*   **Section D: Cost/Trade-off Summary**
    *   **Opportunity Cost:** Estimated economic impact (agricultural rent, development restrictions)
    *   **Human Footprint:** Average human pressure index within priority areas
    *   **Conflict Exposure:** Presence of social or land-use conflicts in priority zones

*   **Section E: Trade-off Analysis Framework (Mandatory)**
    *   **Purpose:** Explicitly show "what you are getting vs. what you are losing" to address the requirement that information must be presented with implications, not just displayed without context.
    *   **Structure:** Two-part framework with auto-generated explanatory text:
    
    *   **PART 1: GAINS (What You Get)**
        
        *   **Conservation Goals Met:** Visual checkmarks (✓) for achieved targets
            *   Number of conservation themes successfully protected (e.g., "8 of 10 species groups protected")
            *   Specific ecosystems secured (e.g., "Cloud Forest: 32% protected (Goal: 30%)")
        
        *   **Species & Biodiversity Protected:**
            *   Count of species groups with adequate habitat protection
            *   Count of threatened/endangered species with secured habitats
        
        *   **Ecosystem Services Secured:**
            *   Carbon storage capacity (tCO2e)
            *   Water regulation services (m³ or index value)
            *   Connectivity between protected areas (corridor count or connectivity index)
        
        *   **Auto-Generated Gain Summary Text:** Template-based explanatory text such as:
            *   "This scenario achieves **HIGH** biodiversity protection with **9 species groups** meeting conservation targets"
            *   "**EXCELLENT** ecosystem service provision with **2.5 billion tCO2e** carbon storage secured"
    
    *   **PART 2: LOSSES/COSTS (What You Lose)**
        
        *   **Agricultural Opportunity Cost:**
            *   Total economic value of agricultural production in priority areas (COP and USD)
            *   Area of productive agricultural land affected (km² and %)
        
        *   **Human Footprint Overlap:**
            *   Total area of priority conservation zones with moderate-to-high human pressure
            *   Percentage of solution overlapping with developed/modified landscapes
        
        *   **Development Restrictions:**
            *   Area where future development would be restricted (km²)
            *   Estimated economic impact of development constraints (currency value)
        
        *   **Conflict Exposure:**
            *   Area of priority zones overlapping with historical conflict zones (km²)
            *   Area overlapping with active land-use disputes or social conflicts
        
        *   **Auto-Generated Cost Summary Text:** Template-based explanatory text such as:
            *   "This scenario incurs **MODERATE** economic impact with **$350M USD** in agricultural opportunity cost"
            *   "**15% of priority areas** overlap with moderate-to-high human pressure zones"
            *   "Conservation priorities overlap with **8,200 km²** of historical conflict zones, requiring careful implementation planning"
    
    **Metrics Reference:** See **Area 4.4.1** for the complete Solution Overview Panel metrics table (10 finalized metrics).
    
    **Template-Based Text Generation Rules:**
    
    System must auto-generate contextual explanatory text based on the following example thresholds (***these thresholds are EXAMPLES for team discussion and refinement during implementation***):
    
    *   **Opportunity Cost Levels:**
        *   Low: < $200M USD
        *   Moderate: $200-500M USD
        *   High: > $500M USD
    *   **Human Footprint Overlap:**
        *   Low: < 30% of priority areas in moderate-high pressure zones
        *   Moderate: 30-60%
        *   High: > 60%
    *   **Goal Achievement Quality:**
        *   Excellent: > 90% of conservation targets met
        *   Good: 75-90% met
        *   Partial: 50-75% met
        *   Insufficient: < 50% met
    *   **Species Protection Extent:**
        *   High: > 8 species groups adequately protected
        *   Moderate: 5-7 groups
        *   Limited: < 5 groups
    
    **Example Integrated Trade-off Narrative:**
    *   "This scenario achieves **GOOD** biodiversity protection (**7 species groups** with adequate habitats) at **MODERATE** economic cost (**$350M** agricultural opportunity cost). While **HIGH** carbon storage is secured (**2.5B tCO2e**), implementation will require addressing **15% overlap** with human-modified landscapes and **8,200 km²** of historical conflict zones."

*   **Section F: National Contribution Calculator**
    *   **Colombia's Conservation Target Contribution:**
        *   Percentage of Colombia's territory protected by this solution (e.g., "12% of Colombia")
        *   Contribution toward national 30% target (e.g., "40% progress toward 30x30 goal")
        *   Visual progress bar showing national target progress
    *   **Auto-Generated National Context Text:**
        *   "This solution protects **12% of Colombia's territory**, contributing **40% toward the national 30% conservation target** established under the Kunming-Montreal Global Biodiversity Framework"
        *   Threshold-based significance indicators:
            *   Major Contribution: > 15% of national territory
            *   Substantial: 10-15%
            *   Moderate: 5-10%
            *   Limited: < 5%

*   **Section G: Actions**
    *   "View Full Scenario Details" button
    *   "Compare with Another Scenario" button (Tier 2)
    *   "Download Solution Data" button
    *   **"See Full Summary Report" button** (or similar Spanish equivalent: "Ver Informe Completo de Resumen"):
        *   **Workflow on Click:**
            1. **Perspective Selection Modal appears:** User is prompted to select a narrative perspective for how the report text will be framed:
                *   **Regional Planner (Planificador Regional):** Emphasizes territorial planning compatibility, municipal distributions, CAR jurisdictions
                *   **Community Leader (Líder Comunitario):** Emphasizes cultural territories, consultation requirements, local benefits
                *   **Conservationist (Conservacionista):** Emphasizes species targets, ecosystem representation, biodiversity metrics
                *   **Economist (Economista):** Emphasizes opportunity costs, development restrictions, economic impacts
                *   **Climate Advocate (Defensor Climático):** Emphasizes carbon storage, water regulation, climate resilience
            2. **Important Design Note:** The perspective selection only affects how narrative text is worded/framed. All users see the same data, metrics, charts, and statistics. The perspective choice influences which aspects are emphasized in the auto-generated explanatory text.
            3. **After perspective selection:** Full Trade-off Analysis Report page opens (see Section 4.4, Report Type #1)
            4. **Report Display:** Opens as a dedicated page view (full-screen or overlay) showing complete analysis with all charts, maps, statistics, and perspective-framed narrative text
            5. **Report Actions:**
                *   **View in-app:** Browse the full report within the application
                *   **Download as PDF:** Export the complete report with all visualizations
                *   **Change Perspective:** Re-generate the report with a different perspective (data stays the same, text framing changes)
                *   **Close/Return:** Go back to main map interface

### Component 4.3.2: AOI Dashboard (Area of Interest Analytics)
*Trigger: User clicks on a Municipality, Department, or SIRAP on the map.*

**Purpose:** Provide detailed, region-specific statistics showing how the conservation solution affects this particular area.

**Metrics Note:** This component displays **36 finalized metrics** (see Area 4.4.2 for complete list with data source and availability status). Each section below contains a mix of:
- **Metrics** (quantifiable data points) — all listed in Area 4.4.2
- **Visualizations** (charts, graphs, maps) — how metrics are displayed
- **Narrative Text** (auto-generated explanations) — contextual interpretation of metrics

If a data point is quantifiable and changes based on the selected region/scenario, it is a metric and appears in Area 4.4.2.

**Header:**
*   Region name (e.g., "Municipality of Popayán" or "Cauca Department")
*   Region type and area (km²)

**Content (Component Sections):**

*   **Section A: Regional Conservation Summary**
    *   **Priority Area in this Region:** 
        *   Area (km²) and percentage of the region designated for conservation
        *   Visual: Progress bar showing % of region included in conservation priorities
    *   **Conservation Coverage:**
        *   Number of priority zones within this region
        *   Spatial distribution (concentrated vs. dispersed)

*   **Section B: Biodiversity Metrics**
    *   **Species Richness:**
        *   Bar chart showing richness by taxonomic group (Mammals, Birds, Amphibians, Reptiles, Plants)
        *   Comparison to national average
    *   **Threatened Species:**
        *   Count of threatened/endangered species with habitats in this region
        *   Visual highlight (red badge)
        *   List of notable threatened species present
    *   **Ecosystems & Biomes:**
        *   Donut chart showing percentage coverage of different ecosystem types
        *   Examples: Cloud Forest (15%), Paramo (8%), Dry Forest (12%), Wetlands (5%)

*   **Section C: Ecosystem Services**
    *   **Carbon Storage:**
        *   Total carbon biomass in the region (tCO2e)
        *   Above-ground and below-ground (soil organic carbon)
        *   Average carbon density (tCO2e/ha)
        *   Stat card visualization
    *   **Water Regulation:**
        *   Water supply/recharge capacity index or volume (m³)
        *   Importance for downstream communities
        *   Stat card or gauge visualization

*   **Section D: Land Use & Socio-Economic Context**
    *   **Human Footprint:**
        *   Average Human Footprint Index (0-100 scale, **units and methodology clearly stated**)
        *   **Detailed Breakdown:** Percentage of planning units by Human Footprint category:
            *   "Low (0-20): 45% of area"
            *   "Moderate (21-50): 35% of area"
            *   "High (51-80): 15% of area"
            *   "Very High (81-100): 5% of area"
        *   Histogram or stacked bar chart visualization
        *   Context: Overall pressure assessment ("Low" / "Moderate" / "High")
    *   **Agricultural Context:**
        *   Agricultural Opportunity Cost: Economic value (**COP and USD with conversion date**) of agricultural production in priority areas
        *   Percentage of region used for agriculture
        *   **Land Use Type Breakdown:** Percentage of priority conservation areas by land use category:
            *   "Natural Forest: 60%"
            *   "Pasture: 25%"
            *   "Crop Agriculture: 10%"
            *   "Other: 5%"
        *   Donut or stacked chart visualization
        *   Temporal reference for data (e.g., "Based on 2021 agricultural census")
    *   **Conflict Indicators:**
        *   Presence of historical conflict zones (**date ranges clearly specified, e.g., 2016-2022**)
        *   Social conflict risk level
        *   **Data source attribution** (e.g., "UNODC Conflict Observatory")
    *   **Ethnic and Cultural Territories:**
        *   **Indigenous Reservations:** List and total area of indigenous territories within the region
        *   **Community Councils:** Afro-Colombian and ethnic community council territories
        *   **Spiritual and Cultural Significance:** Indicators of sacred sites or culturally important landscapes
        *   **Consultation Requirements:** Flagging areas requiring prior consultation under Colombian law and ILO Convention 169
        *   **Differential Prioritization Context:** Narrative explaining cultural importance for decision-making

*   **Section E: Protection Status**
    *   **Existing Protected Areas:**
        *   List of national/regional protected areas within the region
        *   Examples: "Puracé National Park", "Los Farallones Regional Park"
        *   Total area currently under formal protection
    *   **Relationship with Other Management Figures:**
        *   **Overlap Analysis:** Percentage of priority conservation areas that overlap with:
            *   National Parks and Natural Reserves
            *   Regional Protected Areas
            *   OMECs (Other Effective Area-based Conservation Measures)
            *   Private Reserves
            *   Indigenous Territories (with conservation designation)
            *   RAMSAR Sites
            *   Forest Reserves
        *   **Complementarity:** Percentage of priority areas that are currently unprotected but adjacent to existing management figures
        *   **Synergy Score:** Indicator of how well this solution complements the existing protected area system
    *   **Coverage Gap:**
        *   Percentage of priority areas NOT currently protected by any management figure
        *   "Gap" visualization showing new conservation opportunities
        *   Breakdown by gap severity (e.g., "High priority, no current protection: 15%")

*   **Section F: Regional vs. National Contribution Analysis (Mandatory)**
    
    **Purpose:** Quantify how this region contributes to national conservation goals and provide comparative context for regional decision-makers. This addresses the critical need to "correlate regional and national data to provide a reference for analysis."
    
    **Metrics Reference:** See **Area 4.4.2** for the complete AOI Dashboard metrics table (36 finalized metrics).
    
    *   **Sub-section F.1: National Target Contribution Calculator**
        *   **AOI Contribution to National 17%/30% Targets:**
            *   Calculate and display: "Priority areas in this region represent **X%** of Colombia's national conservation target"
            *   Progress indicator: "This region contributes **Y%** toward achieving the national 30% goal"
            *   Visual progress bar or gauge showing regional contribution
        *   **Auto-Generated Contribution Context:**
            *   Template-based text explaining significance based on contribution level
            *   Example thresholds (***for team discussion and refinement***):
                *   **Critical Contributor:** > 10% of national conservation target from this region
                *   **Important Contributor:** 5-10%
                *   **Moderate Contributor:** 2-5%
                *   **Minor Contributor:** < 2%
            *   Example text: "This department is a **CRITICAL** contributor to national conservation, providing **12%** of the priority areas needed to achieve Colombia's 30% protection target"
    
    *   **Sub-section F.2: Comparative Statistics Display (Example Wireframe)**
        
        **Purpose:** Show how this region's features compare to national totals. This is an **example of how the data would be displayed** in the UI; the underlying metrics are defined in Area 4.4.2.
        
        **Example Display Format:**
        
        | Feature Category | AOI Distribution | National Distribution | Regional Significance |
        |-----------------|------------------|----------------------|----------------------|
        | **Key Ecosystems** | | | |
        | Cloud Forest | 2,500 km² (15% of AOI) | 16,800 km² total | **15%** of national cloud forest in this region |
        | Paramo | 800 km² (5% of AOI) | 4,000 km² total | **20%** of national paramo in this region |
        | Wetlands | 450 km² (3% of AOI) | 9,000 km² total | **5%** of national wetlands in this region |
        | **Threatened Species** | | | |
        | Critically Endangered Species | 5 species present | 32 species nationally | **16%** of nationally CE species in this region |
        | Endemic Species | 12 species present | 180 species nationally | **7%** of national endemics in this region |
        | **Ecosystem Services** | | | |
        | Carbon Stocks | 85M tCO2e | 1.2B tCO2e nationally | **7%** of national carbon in this region |
        | Water Regulation Capacity | High (regional index) | National average | **Above average** water provision importance |
        
        *   Visual: Bar charts comparing regional vs. national percentages for key metrics
        *   Color coding: Green (above-average representation), Yellow (average), Red (below-average)
    
    *   **Sub-section F.3: AOI Content Summary**
        *   **Biodiversity within AOI:**
            *   Species richness by taxonomic group (counts and comparison to national average)
            *   Threatened species count and percentage of national total
            *   Endemic species count and percentage of national total
        *   **Ecosystem Services within AOI:**
            *   Total carbon biomass (tCO2e) and percentage of national carbon stocks
            *   Water supply/regulation capacity and downstream beneficiary populations
            *   Connectivity function (does this region serve as a corridor?)
        *   **Constraints within AOI:**
            *   Current land uses (Natural Forest %, Agriculture %, Pasture %, Urban %)
            *   Human Footprint distribution (Low/Moderate/High percentages)
            *   Existing protected area coverage (km² and % of AOI)
            *   Agricultural opportunity cost (total economic value in COP and USD)
    
    *   **Sub-section F.4: Template-Based Contextual Narrative**
        
        Auto-generated text explaining regional significance at multiple scales:
        
        *   **Element F.4.a: National Scale Context**
            *   "This region contains **15% of Colombia's cloud forest ecosystems**, making it a **CRITICAL** contributor to national cloud forest conservation goals"
            *   "With **20% of Colombia's paramo ecosystems**, this area is of **EXCEPTIONAL** importance for high-elevation biodiversity and water regulation"
            *   Threshold-based significance classification (***example values for team refinement***):
                *   **EXCEPTIONAL:** > 20% of national distribution
                *   **CRITICAL:** 10-20%
                *   **IMPORTANT:** 5-10%
                *   **MODERATE:** 2-5%
                *   **MINOR:** < 2%
        
        *   **Element F.4.b: Regional Scale Context**
            *   "Within Cauca Department, this municipality accounts for **45%** of departmental endemic bird habitats, significantly exceeding its proportional area"
            *   "This region supports **8 of Colombia's 32 threatened amphibian species** (25%), indicating exceptional amphibian diversity"
        
        *   **Element F.4.c: Connectivity & Strategic Value**
            *   "Priority areas in this region **connect two major protected area systems** (Puracé NP and Los Farallones Regional Park), serving a critical corridor function"
            *   "This area provides water regulation services to **2.5 million downstream residents** in the Cauca River basin"
        
        *   **Element F.4.d: Example Integrated Regional Narrative**
            *   "This municipality is a **CRITICAL** national contributor, containing **15% of Colombia's cloud forests** and **20% of paramo ecosystems**. It supports **8 threatened amphibian species** (25% of national total) and stores **85M tCO2e** (7% of national carbon stocks). Priority conservation areas here serve dual functions: protecting **above-average biodiversity** while maintaining **water regulation for 2.5M downstream residents**. However, implementation must address **$125M in agricultural opportunity cost** and overlap with **moderate human pressure zones** (35% of priority areas)."
    
    *   **Sub-section F.5: Key Observations**
        *   Automatically generated insights highlighting notable features
        *   Example: "High biodiversity with moderate conflict risk and exceptional water provision importance"

**Actions:**
*   "Generate Regional Report (PDF)" button
*   "Export Regional Data" button (Shapefile/GeoJSON/GeoTIFF)
*   "Export Map Image" button (PNG/JPG at user-specified resolution)
*   "Close" or "Back to Solution Overview" button

**Metadata Standards:**
*   All statistics displayed must include:
    *   **Explicit units of measurement** (km², ha, tCO2e, COP, USD, etc.)
    *   **Official data source names** with publication dates
    *   **Temporal currency** of the data (e.g., "2023 species distribution models")
    *   **Methodology references** (links to technical documentation)

### Component 4.3.3: Scenario Comparison Panel (Tier 2 Only)
*Trigger: User clicks "Compare Scenarios" and selects two solutions to compare.*

**Purpose:** Show side-by-side analysis of two different conservation scenarios to support trade-off decisions.

**Header:**
*   Scenario A name vs. Scenario B name
*   Match quality for each

**Content:**

*   **Section A: Comparative Statistics Table**
    
    **Note:** All metrics in this table are drawn from the Solution Overview Panel metrics (see Area 4.4.1) and displayed side-by-side for comparison. These are included in the master metrics table.
    
    Visual table with rows and columns:

    | Metric | Scenario A | Scenario B | Difference |
    |--------|-----------|-----------|------------|
    | **Total Priority Area (km²)** | 125,000 | 98,000 | -27,000 |
    | **% of Colombia Protected** | 12% | 9% | -3% |
    | **Species Goals Met** | 8 of 10 | 9 of 10 | +1 |
    | **Carbon Stored (tCO2e)** | 2.5B | 2.1B | -400M |
    | **Opportunity Cost (Million USD)** | 450 | 320 | -130 |
    | **Average Human Footprint** | 42 | 38 | -4 |
    | **Conflict Exposure (km²)** | 8,200 | 5,100 | -3,100 |

*   **Section B: Theme Achievement Comparison**
    *   Side-by-side goal achievement for each conservation feature
    *   Visual indicators (✓/✗) for each scenario
    *   Highlights where scenarios differ in goal achievement

*   **Section C: Spatial Overlap Analysis**
    *   **Agreement:** Area (km²) selected in BOTH scenarios (shown in green on map)
    *   **Conflict/Difference:** Area selected in only one scenario (shown in orange/blue on map)
    *   **Unique to Scenario A:** Area (km²)
    *   **Unique to Scenario B:** Area (km²)
    *   **Connectivity/Synergy Zones:** Potential corridor areas that connect priority zones (purple on map)

*   **Section D: Trade-off Narrative**
    *   Automatically generated summary text highlighting key trade-offs:
        *   "Scenario A protects more area (+27,000 km²) but has higher opportunity cost (+$130M)"
        *   "Scenario B achieves one additional species goal while reducing conflict exposure"

**Actions:**
*   "Switch Baseline/Comparison" button (swap which is A vs. B)
*   "Add Third Scenario" button (if supporting 3-way comparisons)
*   "Generate Comparison Report (PDF)" button
*   "Export Comparison Data" button (Shapefile/GeoTIFF)
*   "Export Comparison Map Image" button (PNG/JPG)
*   "Exit Comparison Mode" button

### Component 4.3.4: Welcome/Getting Started Panel
*Trigger: No solution is active (initial load or user cleared selection).*

**Purpose:** Guide new users to begin exploring.

**Content:**
*   **Welcome Message:**
    *   Brief introduction to the tool (2-3 sentences)
    *   "Get started by selecting conservation priorities using the Solution Finder"
*   **Quick Start Guide:**
    *   Step 1: Click "Find a Solution" to define your priorities (takes you to the "Solution Finder")
    *   Step 2: Explore the map to see conservation areas
    *   Step 3: Click on a region for detailed local statistics
*   **Featured Scenarios (Optional):**
    *   List of 3-5 pre-selected "starter" scenarios:
        *   "Balanced Conservation & Development"
        *   "Maximum Biodiversity Protection"
        *   "Low-Cost Conservation Strategy"
    *   Click to load and explore

**Actions:**
*   "Open Solution Finder" button (primary CTA)
*   "View Tutorial" or "Watch Demo" link (optional)

## Area 4.4: Metrics Reference Tables (for Area 4.3 Right-Sidebar Components & Area 4.5 Reports)

This section consolidates all metrics from the Right Sidebar analysis components into one reference location for easy completeness checking and team review.

**Purpose:** Provide a single source of truth for all **49 finalized metrics** tracked in the application, aligned to `DISES Metrics - Finalized Metrics.csv`. Each table shows metrics for one component, with key columns:

- **Required Input(s)**: Data layers needed to calculate this metric
- **Asset Status**: Quick indicator (✅/⚠️/❌/❓) of whether we have the required data
- **Calculation**: Formula or method to derive the metric

**⚠️ IMPORTANT — Layer Asset Details:**
For each **Required Input** listed in these tables, see the **Layer Registry (Area 4.11)** to verify:
- Whether the asset is actually available
- The actual file/asset name
- Source agency, version date, and URL

If a metric's Required Input(s) reference a layer that is ❌ Missing or ❓ Unknown in the Layer Registry, **that metric cannot be implemented** until the data gap is resolved.

**Back-End Integration Note:** See **Area 4.10** for API specifications and back-end data requirements.

### Metrics For Right Sidebar Components (in Area 4.3)

#### 4.4.1. Solution Overview Panel Metrics (Finalized)

*Component Reference: Component 4.3.1*

**Table Legend:**
- **Asset Status:** ✅ Available | ⚠️ Outdated/Issues | ❌ Missing | ❓ Unknown
- **Verdict:** `Yes` = Approved for inclusion | `Maybe` = Conditional on data/feasibility | Blank = Removed during review

| # | Metric Name | Category | Description | Units | Required Input(s) | Asset Status | Calculation | Visualization | Verdict | Also Appears In | Notes |
|---|-------------|----------|-------------|-------|-------------------|--------------|-------------|---------------|---------|-----------------|-------|
| **GAINS (Conservation Achievements)** | | | | | | | | | | | |
| 1 | Conservation Goals Met | General | Count/percentage of conservation targets achieved by the solution | Count and % | Prioritizr solution output | ✅ System-generated | `COUNT(targets where achieved >= goal) / Total targets × 100` | Visual checkmarks (✓/✗) | **Yes** | Trade-off Report, Comparison Panel | Make sure target is clear quantitatively |
| 2 | Species Groups Protected | Species/Biodiversity | Number of species groups with adequate habitat protection | Count (e.g., "8 of 10") | Prioritizr solution output | ✅ System-generated | `COUNT(species groups meeting target threshold)` | Progress bar or fraction | **Yes** | Trade-off Report | |
| 3 | Threatened Species Secured | Species/Biodiversity | Count of threatened species with habitat targets met | Count | Prioritizr output, Species distribution layers, IUCN threat status | ❓ Unknown | `COUNT(threatened species where habitat target met)` | Badge with count | **Yes** | Trade-off Report, AOI Dashboard | We do have the data. Column sums of RIJ matrix. rredlist package — we can match to species name |
| 4 | Ecosystem Coverage | Ecosystems | Area and percentage of key ecosystems within the solution | km² and % | Prioritizr output, Ecosystem type layer | ❓ Unknown | `SUM(solution area per ecosystem type)` | Bar chart by ecosystem | **Yes** | Trade-off Report, AOI Dashboard | |
| 5 | Carbon Storage Capacity | Carbon | Total carbon stored in priority areas | tCO2e | Carbon storage layer | ❓ Unknown | `SUM(carbon value × area) for solution pixels` | Stat card with large number | **Yes** | Trade-off Report, AOI Dashboard | |
| 6 | Water Regulation Services | Water | Hydrological regulation capacity of priority areas | m³ or index | Water regulation layer | ❓ Unknown | `SUM or MEAN(water regulation index) for solution` | Gauge or stat card | **Maybe** | Trade-off Report, AOI Dashboard | Depends on if we have the data and how easy this is to compute. If they have a priority layer that exists then it would just be %. Check with the Mesa; would be a comparison metric rather than a base metric |
| **LOSSES/COSTS (Trade-offs)** | | | | | | | | | | | |
| 8 | Agricultural Opportunity Cost | Land Cover/Habitat | Economic value of agricultural production foregone | COP and USD (millions) | Agricultural opportunity cost layer | ❓ Unknown | `SUM(ag cost value × area) for solution pixels` | Stat card, currency format | **Maybe** | Trade-off Report, AOI Dashboard | Net benefit is included as a cost in the runs, so they may want this included — or maybe it doesn't make sense to include it |
| 9 | Affected Agricultural Area | Land Cover/Habitat | Area of agricultural land within conservation priorities | km² and % | Land use layer | ❓ Unknown | `SUM(area where land use = agriculture) in solution` | Bar chart or map overlay | **Yes** | Trade-off Report | |
| 13 | Conflict Zone Overlap | Conflict | Priority areas intersecting historical conflict zones | km² | Conflict zones layer | ❓ Unknown | `SUM(solution area ∩ conflict zones)` | Map overlay, stat card | **Maybe** | Trade-off Report, AOI Dashboard | The only conflict zone layer we have is coco-muertes — Kevin has used for some runs (raster layer) but the cost is so small that it doesn't seem worth it. Instead of using as a cost layer, we could just include as an output stat |
| **SUMMARY METRICS** | | | | | | | | | | | |
| 17 | National Contribution | General | Percentage of Colombia's territory in priority areas | % of Colombia | Prioritizr solution output, National boundary | ✅ System-generated | `Total solution area / Colombia total area × 100` | Progress bar | **Yes** | Trade-off Report, AOI Dashboard | Should be with #1; can we also include how much is added on top of how much is already there in place? |

**Metrics Removed During Review (Previously in this table):**
- ~~#7 Connectivity Index~~ — Removed
- ~~#10 Human Footprint Overlap~~ — Removed
- ~~#11 Development Restriction Area~~ — Removed
- ~~#12 Economic Impact of Restrictions~~ — Removed (❌ NO ASSET)
- ~~#14 Land Dispute Overlap~~ — Removed
- ~~#15 Goal Achievement Quality~~ — Removed
- ~~#16 Match Quality~~ — Removed

#### 4.4.2. AOI Dashboard Metrics (Finalized)

*Component Reference: Component 4.3.2*

**Table Legend:**
- **Asset Status:** ✅ Available | ⚠️ Outdated/Issues | ❌ Missing | ❓ Unknown
- **Verdict:** `Yes` = Approved for inclusion | `Maybe` = Conditional on data/feasibility | Blank = Removed during review

| # | Metric Name | Category | Description | Units | Required Input(s) | Asset Status | Calculation | Visualization | Verdict | Also Appears In | Notes |
|---|-------------|----------|-------------|-------|-------------------|--------------|-------------|---------------|---------|-----------------|-------|
| **REGIONAL CONSERVATION** | | | | | | | | | | | |
| 18 | Priority Area in Region | General | Total area of conservation priorities within the AOI | km² | Prioritizr solution output, AOI boundary | ✅ System-generated | `SUM(solution area within AOI)` | Progress bar | **Yes** | Regional Report | |
| 19 | Priority Area % of Region | General | Percentage of AOI covered by conservation priorities | % of region | Derived from #1, AOI boundary | ✅ Calculated | `Priority area / AOI total area × 100` | Progress bar | **Yes** | Regional Report | Can we add additional on top of whatever is already protected by RUNAP? |
| **BIODIVERSITY** | | | | | | | | | | | |
| 21 | Species Richness - Mammals | Species/Biodiversity | Count of mammal species with habitat in solution area | Count | Species distribution - Mammals | ❓ Unknown | `COUNT(mammal species where habitat overlaps solution)` | Bar chart | **Yes** | Species Report | |
| 22 | Species Richness - Birds | Species/Biodiversity | Count of bird species with habitat in solution area | Count | Species distribution - Birds | ❓ Unknown | `COUNT(bird species where habitat overlaps solution)` | Bar chart | **Yes** | Species Report | |
| 23 | Species Richness - Amphibians | Species/Biodiversity | Count of amphibian species with habitat in solution area | Count | Species distribution - Amphibians | ❓ Unknown | `COUNT(amphibian species where habitat overlaps solution)` | Bar chart | **Yes** | Species Report | |
| 24 | Species Richness - Reptiles | Species/Biodiversity | Count of reptile species with habitat in solution area | Count | Species distribution - Reptiles | ❓ Unknown | `COUNT(reptile species where habitat overlaps solution)` | Bar chart | **Yes** | Species Report | |
| 25 | Species Richness - Plants | Species/Biodiversity | Count of plant species with habitat in solution area | Count | Species distribution - Plants | ❓ Unknown | `COUNT(plant species where habitat overlaps solution)` | Bar chart | **Yes** | Species Report | |
| 26 | Threatened Species Count | Species/Biodiversity | Count of IUCN threatened species in solution area | Count | Species distribution layers, IUCN threat status attribute | ❓ Unknown | `COUNT(species where IUCN status IN (CR, EN, VU) AND habitat overlaps solution)` | Badge with red highlight | **Yes** | Species Report, Solution Overview | |
| 27 | Endemic Species Count | Species/Biodiversity | Count of endemic species with habitat in solution area | Count | Species distribution layers, Endemism attribute | ❓ Unknown | `COUNT(species where endemic = TRUE AND habitat overlaps solution)` | Badge | **Yes** | Species Report | |
| 28 | % of National Species Total | Species/Biodiversity | Percentage of Colombia's total species found in AOI | % | Species distribution layers, National species totals | ❓ Unknown | `AOI species count / National species count × 100` | Stat with comparison | **Yes** | Species Report | |
| **ECOSYSTEMS** | | | | | | | | | | | |
| 29 | Ecosystem Coverage - Cloud Forest | Ecosystems | Area of cloud forest ecosystem within solution | km² and % | Ecosystem type layer | ❓ Unknown | `SUM(area where ecosystem = 'Cloud Forest') in solution` | Donut chart segment | **Yes** | Ecosystem Report | |
| 30 | Ecosystem Coverage - Paramo | Ecosystems | Area of paramo ecosystem within solution | km² and % | Ecosystem type layer | ❓ Unknown | `SUM(area where ecosystem = 'Paramo') in solution` | Donut chart segment | **Yes** | Ecosystem Report | |
| 31 | Ecosystem Coverage - Dry Forest | Ecosystems | Area of dry forest ecosystem within solution | km² and % | Ecosystem type layer | ❓ Unknown | `SUM(area where ecosystem = 'Dry Forest') in solution` | Donut chart segment | **Yes** | Ecosystem Report | |
| 32 | Ecosystem Coverage - Wetlands | Ecosystems | Area of wetland ecosystem within solution | km² and % | Ecosystem type layer | ❓ Unknown | `SUM(area where ecosystem = 'Wetlands') in solution` | Donut chart segment | **Yes** | Ecosystem Report | |
| 33 | Ecosystem Coverage - Other | Ecosystems | Area of other ecosystem types within solution | km² and % | Ecosystem type layer | ❓ Unknown | `SUM(area where ecosystem NOT IN above categories) in solution` | Donut chart segment | **Yes** | Ecosystem Report | |
| **MARINE & COASTAL ECOSYSTEMS** | | | | | | | | | | | |
| 34 | Marine Protected Area (MPA) Overlap | Marine | Area and percentage of solution overlapping existing Marine Protected Areas | km² and % | Marine Protected Areas layer (PA_MPA) | ❓ Unknown | `SUM(solution area ∩ MPAs)`; `(Solution ∩ MPAs) / Solution area × 100` | Stat card, map overlay | **Maybe** | Regional Report, Ecosystem Report | Not currently running marine protected solutions. Future work. Could add species from AquaMap data |
| 35 | Coral Reef Coverage | Marine | Area of coral reef ecosystems within marine solution areas | km² and % | Marine ecosystem type layer | ❓ Unknown | `SUM(area where ecosystem = 'Coral Reef') in solution` | Donut chart segment | **Maybe** | Ecosystem Report | |
| 36 | Mangrove Coverage | Marine | Area of mangrove ecosystems within solution | km² and % | Marine ecosystem type layer | ❓ Unknown | `SUM(area where ecosystem = 'Mangrove') in solution` | Donut chart segment | **Maybe** | Ecosystem Report | |
| 37 | Seagrass Bed Coverage | Marine | Area of seagrass bed ecosystems within solution | km² and % | Marine ecosystem type layer | ❓ Unknown | `SUM(area where ecosystem = 'Seagrass') in solution` | Donut chart segment | **Maybe** | Ecosystem Report | |
| 38 | % of Solution in EEZ | Marine | Percentage of solution within Colombia's Exclusive Economic Zone (marine areas) | % | EEZ boundary layer (ADMIN_EEZ) | ❓ Unknown | `(Solution area ∩ EEZ) / Total solution area × 100` | Stat card | **Maybe** | Regional Report | Why would they run this outside of their EEZ? |
| **ECOSYSTEM SERVICES** | | | | | | | | | | | |
| 39 | Total Carbon Biomass | Carbon | Total carbon stored in priority areas | tCO2e | Carbon storage layer (total) | ❓ Unknown | `SUM(carbon density × area) for solution pixels` | Stat card, large number | **Yes** | Solution Overview | |
| 40 | Above-ground Carbon | Carbon | Above-ground carbon biomass in priority areas | tCO2e | Above-ground carbon layer | ❓ Unknown | `SUM(above-ground carbon × area) for solution pixels` | Breakdown stat | **Yes** | Ecosystem Report | |
| 41 | Soil Organic Carbon | Carbon | Soil organic carbon in priority areas | tCO2e | Soil organic carbon layer | ❓ Unknown | `SUM(soil carbon × area) for solution pixels` | Breakdown stat | **Yes** | Ecosystem Report | |
| 43 | % of National Carbon | Carbon | Percentage of Colombia's carbon stored in AOI priorities | % | Derived from #17, National carbon total | ❓ Unknown (national total) | `AOI carbon / National carbon × 100` | Comparison stat | **Yes** | Regional Report | We could add carbon on top of what is already being stored in existing RUNAPs |
| 44 | Water Regulation Capacity | Water | Hydrological regulation service provision | m³ or index | Water regulation layer | ❓ Unknown | `SUM or MEAN(water regulation value) for solution` | Gauge | **Yes** | Solution Overview | Do we actually have m³ for this? We need something for water so lets calc amount in the solution, and also the amount above and beyond what is in RUNAP. Ask Mesa if they have this data |
| **SOCIO-ECONOMIC CONTEXT** | | | | | | | | | | | |
| 51 | Land Use - Natural Forest | Land Cover/Habitat | % of priority area that is natural forest | % | Land use layer | ❓ Unknown | `Area where land use = 'Forest' / Total solution area × 100` | Donut segment | **Yes** | Territorial Report | |
| 52 | Land Use - Pasture | Land Cover/Habitat | % of priority area that is pasture | % | Land use layer | ❓ Unknown | `Area where land use = 'Pasture' / Total solution area × 100` | Donut segment | **Yes** | Territorial Report | |
| 53 | Land Use - Crop Agriculture | Land Cover/Habitat | % of priority area that is cropland | % | Land use layer | ❓ Unknown | `Area where land use = 'Crops' / Total solution area × 100` | Donut segment | **Yes** | Territorial Report | |
| 54 | Land Use - Other | Land Cover/Habitat | % of priority area with other land uses | % | Land use layer | ❓ Unknown | `Area where land use NOT IN above / Total solution area × 100` | Donut segment | **Yes** | Territorial Report | |
| 55 | Agricultural Opportunity Cost | Land Cover/Habitat | Economic value of agricultural production foregone in AOI | COP and USD | Agricultural opportunity cost layer | ❓ Unknown | `SUM(ag cost × area) for solution pixels in AOI` | Stat card, currency | **Maybe** | Solution Overview | Check with Mesa on this one to see if they want it and have the data to compute it. If not, we drop |
| 57 | Historical Conflict Zone Overlap | Conflict | Priority area overlapping historical conflict zones | km² | Conflict zones layer | ❓ Unknown | `SUM(solution area ∩ conflict zones)` | Map overlay, stat | **Maybe** | Solution Overview | Right now being used as cost but we will try to convince them to just add post hoc. Current areas are representative enough |
| **CULTURAL & ETHNIC** | | | | | | | | | | | |
| 59 | Indigenous Territories | Cultural/Indigenous | Area of indigenous territories within priorities | km² | Indigenous territories layer | ❓ Unknown | `SUM(solution area ∩ indigenous territories)` | List + area stat | **Yes** | Ethnic Report | |
| 60 | Community Councils Area | Cultural/Indigenous | Area of Afro-Colombian community councils within priorities | km² | Community councils layer | ❓ Unknown | `SUM(solution area ∩ community councils)` | List + area stat | **Yes** | Ethnic Report | |
| **PROTECTION STATUS** | | | | | | | | | | | |
| 63 | Total Protected Area in AOI | General | Area already under formal protection in the AOI | km² and % | Protected areas layer (all categories) | ❓ Unknown | `SUM(solution area ∩ protected areas)` | Progress bar | **Yes** | Regional Report | Should be breakdown stat? |
| 64 | % Overlap with National Parks | General | % of solution overlapping National Parks | % | National parks layer | ❓ Unknown | `(Solution ∩ Parks) / Solution area × 100` | Breakdown stat | **Yes** | Regional Report | Plus what goes above and beyond the protected areas |
| 66 | % Overlap with Indigenous Territories | Cultural/Indigenous | % of solution in indigenous territories | % | Indigenous territories layer | ❓ Unknown | `(Solution ∩ Indigenous) / Solution area × 100` | Breakdown stat | **Yes** | Ethnic Report | Goes with #59 |

**Metrics Removed During Review (Previously in this table):**
- ~~#3 Number of Priority Zones~~ — Removed
- ~~#20 Average Carbon Density~~ — Removed
- ~~#23 Downstream Beneficiaries~~ — Removed
- ~~#24-28 Human Footprint Distribution (Low/Moderate/High/Very High, Average)~~ — Removed
- ~~#34 % of Region in Agriculture~~ — Removed
- ~~#36 Social Conflict Risk Level~~ — Removed
- ~~#39 Consultation Requirement Flag~~ — Removed
- ~~#40 Consultation Requirement Area~~ — Removed
- ~~#43 % Overlap with OMECs~~ — Removed
- ~~#45 Coverage Gap~~ — Removed
- ~~#46 Synergy Score~~ — Removed
- ~~#47 Regional Significance Classification~~ — Removed

#### 4.4.3. Scenario Comparison Panel Metrics (3 Finalized Metrics)

*Component Reference: Component 4.3.3*

These metrics are unique to scenario comparison and do not appear elsewhere.

**Table Legend:**
- **Asset Status:** ✅ Available | ⚠️ Outdated/Issues | ❌ Missing | ❓ Unknown
- **Verdict:** `Yes` = Approved for inclusion

| # | Metric Name | Category | Description | Units | Required Input(s) | Asset Status | Calculation | Visualization | Verdict | Also Appears In |
|---|-------------|----------|-------------|-------|-------------------|--------------|-------------|---------------|---------|-----------------|
| 70 | Agreement Area | General | Area selected in both scenarios being compared | km² | Two Prioritizr solution outputs | ✅ System-generated | `Scenario A ∩ Scenario B` | Green overlay on map, stat card | **Yes** | Comparison Report only |
| 71 | Unique to Scenario A | General | Area selected only in Scenario A (baseline) | km² | Two Prioritizr solution outputs | ✅ System-generated | `Scenario A - Scenario B` | Orange overlay on map, stat card | **Yes** | Comparison Report only |
| 72 | Unique to Scenario B | General | Area selected only in Scenario B (comparison) | km² | Two Prioritizr solution outputs | ✅ System-generated | `Scenario B - Scenario A` | Blue overlay on map, stat card | **Yes** | Comparison Report only |

**Metrics Removed During Review:**
- ~~#4 Connectivity/Synergy Zones~~ — Removed

**Note:** The Scenario Comparison Panel also displays comparative versions of metrics from the Solution Overview Panel (Goal Achievement, Carbon Storage, Opportunity Cost, etc.) in a side-by-side table format. These are not counted as unique metrics since they reuse the same data definitions.

### Metrics for the 5 Reports (in Area 4.5)

Note: All metrics for **Report #1 (Trade-off Analysis Report)** reuse the finalized Solution Overview metrics in 4.4.1.

#### 4.4.4. Ecosystem Assessment Report Metrics (Report #2)
*Component Reference: Area 4.5 (Report #2)*

Status: **No report-unique finalized metrics in current CSV source of truth.**
Use finalized AOI ecosystem metrics from 4.4.2 until a new CSV revision explicitly adds report-unique metrics.

#### 4.4.5. Connectivity Report Metrics (Report #3)
*Component Reference: Area 4.5 (Report #3)*

Status: **No report-unique finalized metrics in current CSV source of truth.**
Use finalized AOI/Comparison metrics from 4.4.2 and 4.4.3 where applicable.

#### 4.4.6. Species Conservation Report Metrics (Report #4)
*Component Reference: Area 4.5 (Report #4)*

Status: **No report-unique finalized metrics in current CSV source of truth.**
Use finalized AOI biodiversity metrics from 4.4.2 until explicitly finalized in CSV.

#### 4.4.7. Territorial Planning Report Metrics (Report #5)
*Component Reference: Area 4.5 (Report #5)*

Status: **No report-unique finalized metrics in current CSV source of truth.**
Use finalized AOI socio-economic and jurisdictional metrics from 4.4.2.

#### 4.4.8. Ethnic Territory Consultation Report Metrics (Report #6)
*Component Reference: Area 4.5 (Report #6)*

Status: **No report-unique finalized metrics in current CSV source of truth.**
Use finalized AOI cultural/territorial metrics from 4.4.2.

#### 4.4.9. Metrics Summary

**Total Finalized Metrics (CSV Source of Truth):** 49

- Solution Overview Panel: 10 metrics (7 Yes + 3 Maybe)
- AOI Dashboard: 36 metrics (29 Yes + 7 Maybe)
- Scenario Comparison Panel: 3 metrics (3 Yes)
- Report-unique finalized metrics: 0

**Metric Table Column Definitions:**

| Column | Purpose |
|--------|---------|
| **#** | Metric identifier within the component |
| **Metric Name** | Display name of the metric |
| **Description** | What the metric measures and represents |
| **Units** | Unit of measurement (km², %, count, index, etc.) |
| **Required Input(s)** | Data layers needed to calculate this metric |
| **Asset Status** | ✅ Available / ⚠️ Outdated / ❌ Missing / ❓ Unknown |
| **Calculation** | Formula or method to derive the metric |
| **Visualization** | How the metric is displayed in the UI |
| **Verdict** | Yes / Maybe per finalized CSV review |
| **Also Appears In** | Other components/reports using this metric |

**Asset Status Summary (as of document creation):**
- ✅ **Available:** System-generated outputs and derived calculations
- ⚠️ **Outdated:** OMECs layer (2020 vintage noted) — **Replacement plan required (see 4.11.6)**
- ❓ **Unknown:** Most external data layers still require verification

**🚨 CRITICAL: Data Gap Analysis Required — IMPLEMENTATION BLOCKER**
Before implementation, verify each metric's required inputs against the Layer Registry (Area 4.11). Any metric with Asset Status ❌ or ❓ cannot be implemented until the required data layer is secured.

| Blocking Issue | Affected Metrics | Action Required |
|----------------|------------------|-----------------|
| `SOCIO_ECON_MODEL` ❌ Missing | Opportunity-cost-related metrics if expanded in future revisions | Develop or acquire economic valuation model |
| `ETH_SACRED` ❌ Missing | Potential future ethnic consultation metrics | Identify data source for sacred sites |
| External layers ❓ Unknown | Multiple finalized metrics in 4.4.1 and 4.4.2 | Data Team verification sprint |

**Metric Reuse Patterns:**
- **Most Reused:** Carbon, opportunity cost, and overlap metrics appear across panels and reports
- **Component-Specific:** Comparison metrics (#70-72) are specific to 4.4.3
- **Report Coverage:** Reports currently reuse finalized right-sidebar metrics

**Team Review Checklist:**
- ☐ **Data Team:** Verify Layer Registry (Area 4.11) is complete and accurate
- ☐ **Data Team:** Update Asset Status for finalized metrics based on actual layer availability
- ☐ **Science Team:** Reconfirm `Yes` / `Maybe` verdicts in the CSV when data availability changes
- ☐ **Science Team:** Add report-unique metrics to a future CSV revision before they are treated as finalized
- ☐ Verify units are correct and consistent across all tables
- ☐ Verify no duplicate/redundant metrics

## Area 4.5: Reports (Tier 2)

Automated report generation for specific planning needs. Reports are available as interactive page views within the application and as downloadable PDFs.

**Required Report Content Standards (All Reports):**
*   **Detailed Distributions:** All reports must include percentage breakdowns of planning units by:
    *   Human Footprint value categories (Low, Moderate, High, Very High)
    *   Land use types (Natural Forest, Pasture, Agriculture, Urban, etc.)
    *   Administrative jurisdictions (Municipalities, Environmental Authorities)
    *   Relationships with existing management figures (overlap percentages)
*   **Contextual Narratives:** Auto-generated interpretive text explaining the significance of statistics at both regional and national scales
*   **Methodology Appendix:** Full documentation of data sources, dates, and calculation methods
*   **Language Support:** All reports available in Spanish (default) and English

---

### Component 4.5.1: Trade-off Analysis Report (Gains vs. Losses)
*Trigger: User clicks "Generate Trade-off Report" from Solution Overview Panel or Report menu. This report is MANDATORY for all conservation scenarios.*

**Metrics Reference:** See **Area 4.4.1** (Solution Overview Panel Metrics) — all 10 finalized metrics can be reused in this report.

**Purpose:** Provide comprehensive "what you are getting vs. what you are losing" analysis to ensure decisions are made with full understanding of implications.

**Primary Audience:** Decision-makers, regional planners, conservation program managers, stakeholders requiring formal documentation

**Key Questions Answered:**
*   What conservation goals does this scenario achieve? Which remain unmet?
*   What are the economic costs (agricultural opportunity cost, development restrictions)?
*   What implementation challenges exist (human footprint overlap, conflict zones)?
*   How does this scenario compare to national conservation targets?

**Delivery Method:**
*   **Dedicated Page View:** Opens as a full-screen or overlay page within the application for interactive browsing
*   **Downloadable PDF:** Complete report can be exported as PDF for offline use, sharing, and archival
*   Both formats contain identical content (all charts, maps, statistics, and narrative text)

**Perspective-Based Narrative Framing:**
*   User selects a perspective (Regional Planner, Community Leader, Conservationist, Economist, or Climate Advocate) when generating the report
*   **All data, metrics, charts, and statistics remain the same** regardless of perspective
*   Perspective choice only affects how the auto-generated narrative text is worded and which aspects are emphasized
*   User can regenerate the report with a different perspective to see alternative framings of the same data
*   **⚠️ VALIDATION REQUIRED:** The five predefined perspectives are a design interpretation of the stakeholder request for a "narrative of the actors." **Before implementation, verify the utility and relevance of these specific personas with the Mesa Nacional/stakeholders during design review.**

**Content (Report Sections):**

*   **Section A: GAINS (Conservation Achievements)**
    *   Complete list of all conservation goals met and unmet with explanations
    *   Detailed breakdown of species groups protected:
        *   Count by taxonomic group (Mammals, Birds, Amphibians, Reptiles, Plants)
        *   List of threatened/endangered species with secured habitats
        *   Endemic species protection achievement
    *   Ecosystem representation analysis:
        *   Area of each ecosystem type protected (km² and % of national distribution)
        *   Comparison to representation targets
        *   Ecosystem connectivity metrics
    *   Ecosystem services quantification:
        *   Total carbon storage capacity with spatial distribution maps
        *   Water regulation services with beneficiary population estimates
        *   Connectivity indices and corridor identification
    *   Statistical distributions:
        *   Percentage of priority areas by ecosystem type
        *   Percentage by protection status (new vs. existing protected areas)
        *   Spatial configuration metrics (patch count, average size, largest patch)

*   **Section B: LOSSES/COSTS (Trade-offs)**
    *   Agricultural opportunity cost breakdown:
        *   Total economic value (COP and USD with conversion date)
        *   Breakdown by agricultural type (crops, pasture, silvopasture)
        *   Spatial distribution map showing high-cost areas
        *   Affected area by land use category (km² and %)
    *   Human footprint analysis:
        *   Detailed distribution table: percentage of priority areas by Human Footprint category (Low 0-20, Moderate 21-50, High 51-80, Very High 81-100)
        *   Spatial overlap maps showing conservation priorities vs. human pressure
        *   Histogram visualization of footprint distribution
    *   Development restriction impacts:
        *   Area where future development would be constrained (km²)
        *   Economic impact estimation methodology and values
        *   Spatial distribution of restrictions by municipality/CAR
    *   Land use conflict analysis:
        *   Percentage of priority areas by current land use type
        *   Areas with competing land use demands
        *   Overlap with Territorial Planning Determinants
    *   Conflict exposure details:
        *   Area overlapping historical conflict zones (2016-2022) with maps
        *   Overlap with active land tenure disputes
        *   Social conflict risk assessment by region
    *   Relationship with existing management figures:
        *   Overlap percentages with National Parks, OMECs, private reserves, etc.
        *   Complementarity analysis (new conservation areas vs. expansions)

*   **Section C: Full Narrative Analysis**
    *   Comprehensive auto-generated text (2-3 paragraphs) synthesizing the gains and losses
    *   Explicit statement of major trade-offs: "This scenario prioritizes X at the cost of Y"
    *   Contextual explanations: WHY certain goals are met or unmet (insufficient ecosystem area vs. cost constraints vs. optimization trade-offs)
    *   Risk assessment: Implementation challenges and recommended mitigation strategies
    *   **Example Narrative:** "This conservation scenario achieves GOOD biodiversity protection (7 of 10 species groups with adequate habitats) and EXCELLENT ecosystem service provision (2.5B tCO2e carbon storage, water regulation for 8M people) at a MODERATE economic cost ($350M agricultural opportunity cost representing 12% of regional agricultural GDP). The solution prioritizes high-elevation ecosystems (cloud forests, paramo) which explain the unmet lowland wetland targets (-7% below goal). Implementation faces MODERATE challenges: 15% of priority areas overlap with human-modified landscapes requiring restoration approaches, and 8,200 km² overlap with historical conflict zones necessitating careful community engagement and consultation, particularly with 5 indigenous territories and 3 community councils within priority areas. The solution complements the existing protected area system well (35% overlap with current management figures) while identifying 65% as new priority areas filling critical conservation gaps."

*   **Section D: Visual Report Components**
    *   Side-by-side bar charts: Goals Met vs. Goals Unmet
    *   Dual-axis chart: Biodiversity gains vs. Economic costs
    *   Map series: Conservation priorities, Human pressure overlay, Conflict zone overlay, Existing protected areas overlay

---

### Component 4.5.2: Ecosystem Assessment Report
*Trigger: User clicks "Generate Ecosystem Report" from Report menu or AOI Dashboard ecosystem section.*

**Purpose:** Evaluate how well a conservation scenario represents Colombia's diverse ecosystems and identify gaps where critical habitats remain unprotected.

**Primary Audience:** Conservation scientists, environmental authorities (CARs), protected area managers

**Key Questions Answered:**
*   Which ecosystems are well-represented in this scenario? Which have protection gaps?
*   What is the condition (human footprint level) of ecosystems within priority areas?
*   How does ecosystem coverage compare to representation targets?
*   What is the relationship between priority areas and the existing protected area network?

**Content (Report Sections):**

*   **Section A: Ecosystem Representation Summary**
    *   Detailed breakdown of ecosystem representation and gaps within the AOI
    *   Percentage of each ecosystem type protected vs. unprotected
    *   Comparison to national and international representation targets (e.g., 30x30)

*   **Section B: Ecosystem Condition Analysis**
    *   Distribution across human footprint categories by ecosystem type
    *   Ecosystem health/integrity indicators where available

*   **Section C: Marine & Coastal Ecosystems** *(for coastal AOIs)*
    *   Marine ecosystem representation (coral reefs, mangroves, seagrass beds)
    *   Marine-terrestrial connectivity assessment
    *   Marine Protected Area overlap analysis

*   **Section D: Protected Area Relationship**
    *   Relationship with existing protected area system
    *   Gap analysis: ecosystems underrepresented in current protection network
    *   Complementarity assessment (new priorities vs. existing coverage)

*   **Section E: Visual Components**
    *   Ecosystem coverage donut/bar charts
    *   Map series: Ecosystem types, Protection gaps, Human footprint by ecosystem

**Metrics Reference:** Use AOI Dashboard ecosystem and marine metrics from **Area 4.4.2**. Report-unique metrics are TBD until a future CSV revision finalizes them.

---

### Component 4.5.3: Connectivity Report
*Trigger: User clicks "Generate Connectivity Report" from Report menu or AOI Dashboard connectivity section.*

**Purpose:** Analyze landscape connectivity to identify critical corridors, bottlenecks, and restoration opportunities that enable species movement and genetic flow between priority areas.

**Primary Audience:** Landscape ecologists, corridor planners, regional environmental authorities (CARs), restoration practitioners

**Key Questions Answered:**
*   Where are the critical corridors connecting priority areas?
*   What are the major bottlenecks or barriers to species movement?
*   Which areas should be prioritized for restoration to improve connectivity?
*   How does this AOI contribute to regional/national connectivity networks?

**Content (Report Sections):**

*   **Section A: Connectivity Overview**
    *   Structural connectivity assessment for the AOI
    *   Connectivity index scores and interpretation

*   **Section B: Corridor Identification**
    *   Maps of structural connectivity and critical corridors
    *   Corridor width and quality metrics

*   **Section C: Bottleneck Analysis**
    *   Identification of pinch points and bottlenecks
    *   Barrier locations and types (roads, agriculture, urban)

*   **Section D: Restoration Priorities**
    *   Priority restoration areas with area estimates (km²)
    *   Restoration feasibility by land use type
    *   Recommendations for corridor restoration

*   **Section E: Regional Context**
    *   AOI contribution to regional/national connectivity networks
    *   Connectivity metrics by land use type

*   **Section F: Visual Components**
    *   Connectivity heatmaps and corridor network maps
    *   Pinch point markers and restoration priority zones

**Metrics Reference:** Use finalized comparison metrics in **Area 4.4.3** and relevant AOI metrics in **Area 4.4.2**. Report-unique connectivity metrics are TBD until a future CSV revision finalizes them.

---

### Component 4.5.4: Species Conservation Report
*Trigger: User clicks "Generate Species Report" from Report menu or AOI Dashboard biodiversity section.*

**Purpose:** Provide species-level analysis of how well a conservation scenario protects biodiversity, with emphasis on threatened, endemic, and focal species.

**Primary Audience:** Biodiversity specialists, IUCN Red List assessors, species conservation programs, environmental impact assessors

**Key Questions Answered:**
*   How many species (by taxonomic group) have adequate habitat protected?
*   Which threatened species have secured habitats? Which remain at risk?
*   Are endemic species adequately represented in priority areas?
*   What is the habitat fragmentation status for key species groups?

**Content (Report Sections):**

*   **Section A: Species Richness Overview**
    *   Species counts by taxonomic group (Mammals, Birds, Amphibians, Reptiles, Plants)
    *   Comparison to national species totals

*   **Section B: Threatened Species Analysis**
    *   Protection achievement breakdown by IUCN threat category (CR, EN, VU)
    *   List of threatened species with secured vs. at-risk habitats
    *   Critical habitat maps for focal threatened species

*   **Section C: Endemic Species Assessment**
    *   Endemic species count and protection achievement
    *   Endemic vs. non-endemic species protection comparison

*   **Section D: Habitat Quality & Fragmentation**
    *   Habitat fragmentation metrics by taxonomic group
    *   Threat level analysis and spatial distribution

*   **Section E: Visual Components**
    *   Species richness bar charts by taxa
    *   Threatened species protection progress bars
    *   Critical habitat maps for focal species

**Metrics Reference:** Use AOI Dashboard biodiversity metrics from **Area 4.4.2**. Report-unique species metrics are TBD until a future CSV revision finalizes them.

---

### Component 4.5.5: Territorial Planning Report
*Trigger: User clicks "Generate Territorial Planning Report" from Report menu or AOI Dashboard socio-economic section.*

**Purpose:** Analyze how conservation priorities align with territorial planning frameworks, land-use regulations, and administrative jurisdictions to support multi-sectoral coordination.

**Primary Audience:** Municipal planners (POT), departmental planning offices, regional environmental authorities (CARs), MinAmbiente territorial planners

**Key Questions Answered:**
*   How do priority areas align with existing territorial planning determinants?
*   Which municipalities and CARs have the largest share of priority areas?
*   What are the land-use conflicts (agriculture, development) within priority zones?
*   What is the agricultural opportunity cost by jurisdiction?
*   How might future agricultural expansion be affected?

**Content (Report Sections):**

*   **Section A: Jurisdictional Distribution**
    *   Priority area distribution across municipalities and CARs
    *   Breakdown by department and region

*   **Section B: Planning Compatibility Assessment**
    *   Compatibility assessment with Territorial Planning Determinants
    *   Identification of conflicts with existing land-use designations

*   **Section C: Land Use Conflict Analysis**
    *   Zoning recommendations and land-use conflict analysis
    *   Areas with competing land use demands

*   **Section D: Economic Impact by Jurisdiction**
    *   Opportunity cost analysis by land use category
    *   Agricultural opportunity cost by municipality/CAR

*   **Section E: Future Scenarios**
    *   Projected agricultural expansion impacts
    *   Development restriction implications

*   **Section F: Visual Components**
    *   Choropleth maps by jurisdiction
    *   Land use conflict overlay maps
    *   Opportunity cost distribution charts

**Metrics Reference:** Use AOI Dashboard socio-economic and jurisdictional metrics from **Area 4.4.2**. Report-unique territorial planning metrics are TBD until a future CSV revision finalizes them.

---

### Component 4.5.6: Ethnic Territory Consultation Report
*Trigger: User clicks "Generate Ethnic Territory Report" from Report menu, or automatically flagged when priority areas overlap indigenous/Afro-Colombian territories.*

**Purpose:** Identify where conservation priorities intersect with indigenous reservations and Afro-Colombian community councils to ensure compliance with prior consultation requirements (Free, Prior, and Informed Consent - FPIC) under Colombian law and ILO Convention 169.

**Primary Audience:** Community liaison officers, indigenous affairs specialists, legal compliance teams, community leaders, MinInterior consultation coordinators

**Key Questions Answered:**
*   Do priority areas overlap with indigenous reservations or community councils?
*   Is prior consultation (FPIC) legally required? For which communities?
*   What is the extent (km²) of overlap with ethnic territories?
*   Are there culturally significant sites within priority areas?
*   What are the recommended next steps for community engagement?

**Content (Report Sections):**

*   **Section A: Territorial Overlap Summary**
    *   Analysis of conservation priorities intersecting with indigenous reservations
    *   Analysis of priorities intersecting with Afro-Colombian community councils
    *   Total area and percentage overlap by territory type

*   **Section B: Consultation Requirements**
    *   Consultation requirements under Colombian law and ILO Convention 169
    *   FPIC risk assessment and compliance guidance
    *   List of specific communities requiring consultation

*   **Section C: Cultural Significance Assessment**
    *   Cultural significance assessment (where data available)
    *   Sacred sites and culturally important areas within priorities

*   **Section D: Engagement Recommendations**
    *   Recommendations for community engagement
    *   Suggested consultation timeline and process
    *   Co-management opportunity identification

*   **Section E: Visual Components**
    *   Map overlays: Priority areas vs. ethnic territories
    *   Territory-by-territory breakdown tables
    *   FPIC requirement flags and alerts

**Metrics Reference:** Use AOI Dashboard cultural and overlap metrics from **Area 4.4.2**. Report-unique ethnic consultation metrics are TBD until a future CSV revision finalizes them.

## Area 4.6: Comprehensive Data Layer Specifications

**Note:** This section describes the categories and types of data layers required for the application. We will need to create an **Official Layer Inventory** document which will provide the definitive list of actual layer names, sources, vintages, and technical specifications for implementation. This section requires further specification.

The application must include the following data layers with complete metadata transparency:

#### 4.6.1. Biodiversity Layers (Terrestrial & Marine)
*   **Species Distribution Models:**
    *   Mammals, Birds, Amphibians, Reptiles, Plants (terrestrial)
    *   Marine species (fish, marine mammals, corals)
    *   Threatened/Endangered species flagged separately
    *   **Metadata Required:** Scientific names, IUCN Red List status, model date, source agency
*   **Ecosystem Types:**
    *   Terrestrial biomes (Cloud Forest, Paramo, Dry Forest, Wetlands, etc.)
    *   Marine ecosystems (Coral reefs, Mangroves, Seagrass beds, Deep-sea habitats)
    *   **Metadata Required:** Classification system used, mapping date, spatial accuracy

#### 4.6.2. Socio-Economic & Cultural Layers
*   **Ethnic and Cultural Territories:**
    *   Indigenous Reservations (Resguardos Indígenas) with legal status and dates
    *   Community Councils (Consejos Comunitarios) for Afro-Colombian communities
    *   Sacred and culturally significant sites
    *   Areas requiring prior consultation (Free, Prior, and Informed Consent)
    *   **Metadata Required:** Legal authority, recognition date, community names, consultation status
*   **Land Use & Agriculture:**
    *   Current land use classifications
    *   Agricultural opportunity cost layers (economic values in COP with currency date)
    *   Property boundaries (when available and legally permissible)
    *   **Metadata Required:** Census year, valuation methodology, data source

#### 4.6.3. Environmental Service Layers
*   **Carbon Storage:**
    *   Above-ground biomass (tC/ha)
    *   Below-ground and soil organic carbon (tC/ha)
    *   **Metadata Required:** Measurement/estimation method, year, conversion factors
*   **Water Resources:**
    *   Hydrological regulation capacity
    *   Watershed boundaries
    *   Water supply zones for communities
    *   **Metadata Required:** Hydrological model used, temporal resolution

#### 4.6.4. Territorial Planning & Administrative Layers
*   **Territorial Planning Determinants (Determinantes de Ordenamiento Territorial):**
    *   Legal land-use restrictions and requirements
    *   Order of prevalence hierarchy
    *   Zoning regulations from regional environmental authorities (CARs)
    *   **Metadata Required:** Legal basis, issuing authority, effective date
*   **Administrative Boundaries:**
    *   Municipalities, Departments, Regional Systems (SIRAPs)
    *   Marine jurisdictional boundaries (Territorial Sea, EEZ)
    *   **Metadata Required:** Administrative level, DIVIPOLA codes, legal boundaries source

#### 4.6.5. Prospective & Future Scenario Layers
*   **Deforestation Risk Models:**
    *   Future deforestation probability (short-term: 5 years, long-term: 20 years)
    *   Historical deforestation trends
    *   **Metadata Required:** Model methodology, baseline year, projection year
*   **Climate Change Projections:**
    *   Temperature and precipitation change scenarios (RCP 4.5, RCP 8.5)
    *   Sea-level rise impacts on coastal/marine areas
    *   Ecosystem vulnerability assessments
    *   **Metadata Required:** Climate model used, scenario name, projection timeframe
*   **Biodiversity Loss Drivers:**
    *   Infrastructure expansion projections (roads, energy, mining)
    *   Agricultural expansion risk zones
    *   Urbanization growth models
    *   **Metadata Required:** Data source, projection methodology, confidence intervals

#### 4.6.6. Conflict & Security Layers
*   **Historical Conflict Zones:**
    *   Armed conflict events (with date ranges, e.g., 2016-2022)
    *   Post-conflict reintegration zones
    *   **Metadata Required:** Event database source, temporal coverage, spatial accuracy
*   **Social Conflict Indicators:**
    *   Land disputes and tenure conflicts
    *   Environmental defender incidents
    *   **Metadata Required:** Source organization, temporal range, verification status

#### 4.6.7. Protected Areas & Conservation Status
*   **Existing Protected Areas:**
    *   National Parks, Regional Parks, Private Reserves
    *   Marine Protected Areas (MPAs)
    *   RAMSAR sites, UNESCO Biosphere Reserves
    *   **Metadata Required:** Protection category (IUCN), legal declaration date, management authority
*   **Conservation Gaps:**
    *   Underrepresented ecosystems
    *   Priority areas not currently protected
    *   **Metadata Required:** Gap analysis methodology, target metrics

#### 4.6.8. Infrastructure & Context Layers
*   **Transportation:**
    *   Roads (classified by type), Rivers (navigable), Airports, Ports
    *   **Metadata Required:** Infrastructure database source, update frequency
*   **Settlements & Urban Areas:**
    *   Urban centers, Rural communities
    *   Population density
    *   **Metadata Required:** Census year, definition of "urban"

## Area 4.7: Data Transparency & Usability Requirements

To ensure maximum trust and usability across all user tiers, the application must adhere to the following standards:

#### 4.7.1. Metadata Display Standards
*   **Universal Unit Clarity:** All numerical values must display units explicitly:
    *   Area: km² and/or hectares (ha)
    *   Carbon: tonnes of CO2 equivalent (tCO2e) or tonnes of Carbon (tC)
    *   Currency: Colombian Pesos (COP) with USD equivalent and conversion date
    *   Population: absolute numbers with density per km²
    *   Percentages: always with denominator context (e.g., "15% of Colombia's total area")
*   **Data Source Attribution:** Every layer and statistic must cite:
    *   Official source agency name (full name, not just acronym)
    *   Publication or last update date
    *   Temporal coverage (e.g., "Data from 2021 agricultural census")
    *   Link to methodology documentation or data portal
*   **Legend Completeness:**
    *   All map layers must have clear, labeled legends
    *   Color ramps with value ranges explicitly shown
    *   Category definitions for classified data
    *   Legend must update dynamically when layers are toggled

#### 4.7.2. Layer Management & Visualization
*   **Dynamic Symbology Editing:**
    *   Users must be able to change colors and transparency of loaded solutions and uploaded data **without re-uploading**
    *   Color palette selector with accessibility-friendly options (colorblind-safe palettes)
    *   Transparency slider (0-100%)
    *   Apply changes instantly without page reload
*   **Layer Visibility Manager:**
    *   Hierarchical layer tree with grouping (Biodiversity > Mammals > Jaguar)
    *   Search/filter functionality for finding specific layers
    *   Batch toggle (e.g., "Show all Protected Areas", "Hide all Socio-Economic layers")
    *   Layer info button (ⓘ) that opens metadata panel for that layer
*   **Map Control Completeness:**
    *   Compass rose permanently visible (or toggle-able)
    *   Scale bar with automatic unit adjustment based on zoom level
    *   Coordinate display showing current cursor position
    *   Zoom level indicator
    *   Basemap switcher with thumbnail previews

#### 4.7.3. User Data Upload & Management (Tier 2)
*   **Supported Formats:**
    *   Vector: Shapefile (.shp with all auxiliary files), GeoJSON, KML/KMZ, GeoPackage
    *   Raster: GeoTIFF, ERDAS Imagine (.img), ESRI Grid
*   **Upload Workflow:**
    *   Drag-and-drop or file browser
    *   Coordinate system auto-detection with user confirmation
    *   Preview before final load
    *   File size limits clearly communicated (e.g., "Maximum 50 MB")
*   **Drawing Tools:**
    *   Create polygons (for custom AOIs)
    *   Create lines (for corridors or routes)
    *   Create points (for specific sites)
    *   Edit vertex positions
    *   Save drawn features as new shapefile or add to analysis
*   **Data Management:**
    *   List of all uploaded/drawn layers with names and file sizes
    *   Rename, delete, or temporarily hide uploaded layers
    *   Export modified or drawn layers

#### 4.7.4. Export & Download Standards
*   **Spatial Data Export:**
    *   Conservation solutions: Shapefile, GeoJSON, GeoPackage, GeoTIFF (rasterized)
    *   Include full attribute table with metadata fields
    *   Coordinate system options: WGS84 (EPSG:4326), MAGNA-SIRGAS (EPSG:4686), Web Mercator (EPSG:3857)
*   **Map Image Export:**
    *   Formats: PNG (transparent background option), JPG
    *   Resolution options: Screen resolution, 150 DPI (print), 300 DPI (publication)
    *   Include legend, scale bar, north arrow, and attribution in exported image
    *   Optional: Add title and custom text to map layout
*   **Report Generation:**
    *   PDF format with embedded maps and charts
    *   Include full methodology appendix and data citations
    *   Accessible format (screen-reader compatible)

## Area 4.8: Critical User Experience (UX) Requirements Checklist

The following high-impact usability features are mandatory for user trust and efficiency:

#### 4.8.1. Session Management & Authentication
*   ☐ **Login Persistence:** Implement secure token-based authentication with persistent sessions (7-day default, configurable)
*   ☐ **"Remember Me" Option:** Allow users to extend session duration
*   ☐ **No Forced Re-login on Reload:** Users should remain authenticated across browser reloads and tab closures
*   ☐ **Session Timeout Warning:** Provide advance notice (5 minutes) before session expiration with option to extend

#### 4.8.1b. Language Support & Internationalization
*   ☐ **Bilingual Interface:** Application must support Spanish and English
*   ☐ **Default Language:** Spanish (Español) - primary language for Colombia
*   ☐ **Language Toggle:** Accessible language switcher in header or settings menu
*   ☐ **Complete Translation Coverage:** All UI elements, labels, buttons, narrative text, and reports must be available in both languages
*   ☐ **Language Persistence:** User's language preference is remembered across sessions
*   ☐ **PDF Export Language:** Downloaded reports respect the currently selected language

#### 4.8.1c. Low-Bandwidth & Accessibility Optimization
*   ☐ **Optimized Tile Loading:** Map tiles must use progressive loading and appropriate zoom-level caching to minimize bandwidth requirements
*   ☐ **Minimized Asynchronous Calls:** Reduce the number and frequency of API calls; batch requests where possible
*   ☐ **Lazy Loading:** Defer loading of non-critical UI components and data until needed
*   ☐ **Compressed Data Transfer:** Enable gzip/brotli compression for all API responses
*   ☐ **Offline Capability (Future):** Consider progressive web app (PWA) architecture for basic offline access to previously loaded data
*   ☐ **Connection Quality Indicator:** Display network status and provide graceful degradation messaging when connection is slow or unstable
*   ☐ **Image Optimization:** Use WebP or other optimized formats for icons and static images; lazy-load large images in reports

**📋 Rationale:** Regional users (CARs, SIRAPs, rural planners) may access the tool from areas with limited or unreliable internet connectivity. Performance optimization ensures the tool remains functional across Colombia's varied network infrastructure.

#### 4.8.2. Layer Visibility & Default States
*   ☐ **Default Visible Layers:** On application load, the following reference layers must be visible:
    *   Existing Protected Areas (National Parks, Regional Parks)
    *   OMECs (Other Effective Conservation Measures)
    *   Major Administrative Boundaries (Departments)
    *   SIRAPs (Regional Protected Area Systems)
*   ☐ **Clear Visual Distinction:** Conservation solution layer must be visually distinct from existing protected areas (use different colors/patterns)
*   ☐ **Layer Load Confirmation:** Visual feedback when layers are loading or have finished loading

#### 4.8.3. Symbology Control (No Delete-and-Reload Required)
*   ☐ **Active Solution Layer:** Users can change color and transparency without reloading the solution
*   ☐ **User-Uploaded Vector Layers:** Direct color, transparency, and outline controls in the Left Sidebar
*   ☐ **User-Uploaded Raster Layers:** Color ramp and transparency controls
*   ☐ **Apply/Reset Buttons:** Ability to preview changes before applying or reset to defaults
*   ☐ **Symbology Persistence:** User's symbology preferences are remembered during the session

#### 4.8.4. Filtering & Search Capabilities
*   ☐ **Filter by Environmental Authority (CARs):** Dedicated filter to display data by specific Corporación Autónoma Regional
*   ☐ **Filter by Administrative Boundary:** Quick filters for Municipality, Department, SIRAP
*   ☐ **Layer Search:** Text search to quickly find specific layers in the visibility manager
*   ☐ **Geocoding Search:** Location search by place name, address, or coordinates

#### 4.8.5. Optimization Parameter Transparency
*   ☐ **Explicit Layer Names in Weight Factors:** Scenario summaries must show actual layer names (e.g., "Agricultural Opportunity Cost 2021") instead of generic terms (e.g., "Cost")
*   ☐ **Goal Context Narratives:** Auto-generated text explaining the significance of percentage goals at national and regional levels
*   ☐ **Optimization Settings Display:** Full transparency on clustering parameters, budget constraints, and solver settings used

#### 4.8.6. Advanced Technical Capabilities (Tier 3)
*   ☐ **Species Group Fragmentation:** Ability to split species groups by endemism, threat status, taxonomic subgroups, or cost factors for differential optimization
*   ☐ **SIRAP Data Ingestion:** Streamlined workflow for validating and publishing new layers from regional partners with:
    *   Format validation
    *   Quality checks (CRS, topology, attributes)
    *   Metadata entry
    *   Preview and approval workflow
    *   Version control

#### 4.8.7. Report Detail Requirements
*   ☐ **Detailed Statistical Breakdowns:** All reports include:
    *   Percentage of cells by human footprint value category
    *   Land use type distributions
    *   Relationships with existing management figures (overlap analysis)
*   ☐ **Contextual Narratives:** Interpretive text explaining the "why" behind statistics
*   ☐ **Methodology Transparency:** Full appendix with data sources, dates, and calculation methods

#### 4.8.8. Analytical Output & Narrative Features
*   ☐ **Trade-off Analysis Framework:** Mandatory "Gains vs. Losses" structure in Solution Overview Panel (condensed) and Advanced Reports (detailed)
*   ☐ **Template-Based Explanatory Text Generation:** Auto-generated contextual narratives for all scenarios based on data thresholds (not AI-generated prose, but structured if-then text)
*   ☐ **National Contribution Calculator:** Display solution's contribution toward Colombia's 30% conservation target at both:
    *   Overall solution level (Solution Overview Panel)
    *   Regional level (AOI Dashboard)
*   ☐ **Regional vs. National Comparative Analysis:** Quantitative comparison showing AOI's distribution vs. national totals for:
    *   Key ecosystem types
    *   Threatened/endemic species
    *   Carbon stocks and ecosystem services
*   ☐ **Significance Classification System:** Template-based text with example thresholds for:
    *   Opportunity cost levels (Low/Moderate/High)
    *   Human footprint overlap (Low/Moderate/High)
    *   Goal achievement quality (Excellent/Good/Partial/Insufficient)
    *   Regional contribution significance (Exceptional/Critical/Important/Moderate/Minor)
*   ☐ **Goal Unmet Explanations:** When conservation goals show red (unmet), system must explain WHY:
    *   Insufficient ecosystem/feature in the territory
    *   Cost constraints preventing full protection
    *   Optimization trade-offs prioritizing other features
*   ☐ **Integrated Trade-off Narratives:** Multi-sentence auto-generated summaries synthesizing gains, losses, and implications for decision-making

## Area 4.9: Stakeholder Requirements Verification Matrix

This section provides explicit confirmation that all granular functional specifications requested by stakeholders are documented in the MDD.

#### 4.9.1. Advanced Analytical & Scenario Features (Tier 2 & 3)

| Requirement | Status | MDD Location | Implementation Notes |
|------------|--------|--------------|---------------------|
| **Species Group Fragmentation Control** | ☐ Required | Section 2.3, 3.3.1 | Tier 3 Managers can fragment species groups by endemism, threat status, taxonomic subgroups, or cost factors with independent goals and weights for each fragment |
| **Automated Goal Calculation** | ☐ Required | Section 3.1.1 | Tier 2 users can select specific data layers and request automatic calculation of standardized goal percentages (17%, 30%, etc.) |
| **Vector Rendering for Management Figures** | ☐ Required | Section 4.1 | Protected Areas, OMECs, and management figures must be displayed as vector polygons (not rasters) for precision at all scales. **⚠️ User-requested fix:** Addresses previous tool flaw where PAs were displayed as rasters. |

#### 4.9.2. User Experience & Interface Clarity

| Requirement | Status | MDD Location | Implementation Notes |
|------------|--------|--------------|---------------------|
| **Explicit Layer Names in Weight Summaries** | ☐ Required | Section 4.3.1, 4.7.5 | Scenario Overview Panel must display actual layer names (e.g., "Agricultural Opportunity Cost 2021") instead of generic terms |
| **Login Session Persistence** | ☐ Required | Section 2.2, 4.7.1 | Secure token-based authentication with 7-day session, no forced re-login on reload |
| **Dynamic Symbology Control** | ☐ Required | Section 4.1, 4.6.2, 4.7.3 | Users can modify color/transparency of solutions and uploaded layers without deletion/reload |
| **Goal Achievement Narratives** | ☐ Required | Section 4.3.1, 4.8.5 | System auto-generates contextual narratives explaining goal significance at national and regional scales |

#### 4.9.3. Data Management & Reporting Detail

| Requirement | Status | MDD Location | Implementation Notes |
|------------|--------|--------------|---------------------|
| **Filter by Environmental Authority (CARs)** | ☐ Required | Section 4.1, 4.7.4 | Layer Visibility Manager includes dedicated filter for individual Corporaciones Autónomas Regionales |
| **SIRAP Data Management Workflow** | ☐ Required | Section 2.3 | Complete workflow for ingestion, validation, version updates, and deprecation of outdated layers with documentation |
| **Detailed Report Metrics** | ☐ Required | Section 4.3.2, 4.5, 4.8.7 | Reports include percentage breakdowns by human footprint categories, land uses, and relationships with management figures |

#### 4.9.4. Analytical Narrative & Trade-off Features (NEW)

| Requirement | Status | MDD Location | Implementation Notes |
|------------|--------|--------------|---------------------|
| **Mandatory Scenario Narrative Content** | ☐ Required | Section 4.3.1, 4.5, 4.8.8 | Explicit "Gains vs. Losses" framework with template-based text showing what you get vs. what you lose. Condensed version in Solution Overview Panel, detailed version in Trade-off Analysis Report (Section 4.5, Report Type 1) |
| ~~**Explicit Tradeoff Analysis Report**~~ | ~~☐ Required~~ | ~~Section 4.5 (Report #1)~~ | ~~Full detailed report with GAINS section (conservation goals, species, ecosystem services) and LOSSES/COSTS section (opportunity cost, human footprint, development restrictions, conflict exposure) with comprehensive narrative analysis~~ |
| **Quantitative Regional vs. National Contribution** | ☐ Required | Section 4.3.1, 4.3.2.F, 4.8.8 | National Contribution Calculator in both Solution Overview Panel (overall solution level) and AOI Dashboard (regional level). Includes comparative statistics table showing AOI vs. national distribution with template-based significance classification |
| **Template-Based Text Generation with Thresholds** | ☐ Required | Section 4.3.1, 4.3.2.F, 4.8.8 | Example thresholds specified for opportunity cost ($200M/$500M), human footprint (30%/60%), goal achievement (90%/75%/50%), species protection (8/5 groups), regional significance (10%/5%/2% of national distribution). Thresholds are examples for team refinement |
| **Goal Unmet Explanations** | ☐ Required | Section 4.5 (Report #1) | Narrative analysis must explain WHY goals are unmet: insufficient ecosystem in territory, cost constraints, or optimization trade-offs prioritizing other features |
| **Conflict and Pressure Mapping Layer** | ☐ Required | Section 4.3.1, 4.5 | Explicit visualization and analysis of high-priority conservation areas overlapping with high development pressure, human footprint, and conflict zones in both sidebar summaries and detailed reports |

**Verification Status:** All stakeholder-requested granular specifications, including analytical narrative features, are explicitly documented in the MDD and ready for implementation.

## Area 4.10: Back-End Data Requirements & Verification

**Purpose:** This section consolidates all back-end data requirements needed to support the front-end metrics and features described in this document. It serves as a bridge between front-end specifications and back-end implementation.

**Critical Note:** The metrics tables in Area 4.4 describe what the front-end needs to display. This section focuses on what the back-end must provide to make those displays possible.

### 4.10.1. Data Source Categories

All metrics in this application require data from one or more of these source categories:

| Category | Description | Examples | Responsibility |
|----------|-------------|----------|----------------|
| **Prioritizr Output** | Direct output from conservation optimization runs | Selected planning units, goal achievement, solution cost | Prioritizr/Back-end |
| **Spatial Layers** | Pre-existing GIS data layers | Species distributions, ecosystem types, protected areas | Data Team |
| **Calculated Metrics** | Derived from combining Prioritizr output with spatial layers | Area of ecosystem X in solution, carbon within priority areas | Back-end API |
| **External Data** | Data from external sources requiring integration | IUCN threat status, population data, economic indices | Data Team |
| **User-Defined** | Data uploaded or drawn by users (Tier 2) | Custom AOIs, uploaded shapefiles | Front-end + Back-end |

### 4.10.2. Back-End Data Verification Checklist

**For each metric in Area 4.4, the development team must verify:**

- ☐ **Data Source Identified:** Which layer(s) or output(s) provide this metric?
- ☐ **Data Available:** Is the required data currently available?
- ☐ **Calculation Method:** If calculated, what is the formula/algorithm?
- ☐ **API Endpoint:** Which API endpoint will serve this metric?
- ☐ **Update Frequency:** How often does this data change?
- ☐ **Performance:** Can this metric be calculated in real-time or must it be pre-computed?

### 4.10.3. Required Data Layers Summary

Based on the metrics in Area 4.4, the following data layers are required:

**Biodiversity Layers:**
- ☐ Species distribution models (Mammals, Birds, Amphibians, Reptiles, Plants)
- ☐ Threatened species layer (with IUCN status)
- ☐ Endemic species layer (with endemism attribute)
- ☐ Ecosystem type layer (Cloud Forest, Paramo, Dry Forest, Wetlands, etc.)

**Ecosystem Services Layers:**
- ☐ Carbon storage layer (above-ground biomass)
- ☐ Soil organic carbon layer
- ☐ Water regulation capacity layer
- ☐ Watershed boundaries with downstream population data

**Socio-Economic Layers:**
- ☐ Human Footprint Index layer
- ☐ Land use classification layer
- ☐ Agricultural opportunity cost layer
- ☐ Historical conflict zones layer
- ☐ Social conflict risk layer
- ☐ Land disputes layer

**Cultural & Ethnic Layers:**
- ☐ Indigenous reservations (Resguardos) layer
- ☐ Community councils (Consejos Comunitarios) layer

**Protection & Administrative Layers:**
- ☐ National parks layer
- ☐ OMECs layer
- ☐ Regional protected areas layer
- ☐ Administrative boundaries (Municipalities, Departments, SIRAPs)

### 4.10.4. Prioritizr Output Requirements

The back-end must provide the following from each Prioritizr optimization run:

| Output | Description | Used By |
|--------|-------------|---------|
| Selected Planning Units | Binary or weighted selection of planning units | All solution displays |
| Goal Achievement per Feature | Percentage of each conservation target met | Conservation Achievement metrics |
| Total Solution Cost | Aggregate cost of the solution | Trade-off Analysis |
| Solution Metadata | Parameters used (goals, weights, constraints) | Scenario Identity display |
| Feature Representation | How much of each feature is protected | Goal Achievement narratives |

### 4.10.5. API Endpoints Required (Preliminary)

The following API endpoints are anticipated (to be refined during implementation):

| Endpoint | Purpose | Returns |
|----------|---------|---------|
| `/solutions/{id}` | Get full solution details | Solution geometry, metadata, metrics |
| `/solutions/{id}/metrics` | Get all metrics for a solution | Array of metric values |
| `/solutions/{id}/aoi/{aoi_id}` | Get metrics for solution within AOI | Filtered metric values |
| `/solutions/compare/{id1}/{id2}` | Compare two solutions | Agreement, conflict areas, comparative metrics |
| `/layers` | List available data layers | Layer metadata |
| `/layers/{id}/stats` | Get statistics for a layer | Summary statistics |

### 4.10.6. Status Tracking

**Current Status:** All metrics in Area 4.4 are marked as "TBD" (To Be Determined) pending back-end team review.

**Next Steps:**
1. ☐ Back-end team reviews metrics tables and confirms data availability
2. ☐ Update "Status" column in Area 4.4 tables (Available / Requires Calculation / Needs Specification / Not Available)
3. ☐ Identify any metrics that cannot be supported with current data
4. ☐ Define calculation methods for derived metrics
5. ☐ Design API endpoints to serve metrics to front-end

### 4.10.7. Infrastructure & Scalability Requirements

**⚠️ ACTION REQUIRED:** Technical review identified that infrastructure specifications need additional detail. The following must be specified before deployment:

**Hardware Requirements Clarification:**

| Resource | Minimum Requirement | Specification Needed |
|----------|---------------------|----------------------|
| **CPU** | 6-core processor | ☐ Clarify: Does this apply to the **container** or the **host server**? |
| **RAM** | 16GB | ☐ Clarify: Is this allocated to the application container or required on the host? |
| **Storage** | TBD | ☐ Specify: Required storage for layer cache, solution library, and database |
| **Network** | TBD | ☐ Specify: Bandwidth requirements for concurrent users |

**Scalability Strategy (To Be Detailed):**

The following scalability elements are committed to but require technical specification:

- ☐ **Load Balancer Configuration:** Document load balancer requirements (e.g., nginx, AWS ALB) for distributing traffic across application instances
- ☐ **Horizontal Scaling Plan:** Define auto-scaling thresholds and instance limits
- ☐ **Database Scaling:** Specify whether spatial database (PostGIS) requires read replicas or clustering
- ☐ **CDN/Caching Strategy:** Document tile caching and static asset delivery approach
- ☐ **Concurrent User Capacity:** Target capacity for simultaneous users (Tier 1 + Tier 2 + Tier 3)

**Technical Team Deliverables:**
1. ☐ Complete infrastructure specification document detailing server vs. container resource allocation
2. ☐ Architecture diagram showing load balancing and scaling components
3. ☐ Performance benchmarks for target user loads
4. ☐ Cost estimates for different scaling scenarios

### 4.10.8. Interoperability & National Standards Compliance

**Purpose:** Ensure the tool integrates seamlessly with Colombia's existing environmental data infrastructure and official systems.

#### A. Coordinate Reference System (CRS) Standards

| Standard | Requirement | Implementation |
|----------|-------------|----------------|
| **Primary CRS** | MAGNA-SIRGAS (EPSG:4686) | ☐ All spatial data exports (Shapefile, GeoTIFF, GeoJSON) must default to MAGNA-SIRGAS |
| **Alternative CRS** | WGS84 (EPSG:4326) | ☐ Available as export option for international compatibility |
| **Web Display** | Web Mercator (EPSG:3857) | ☐ Used internally for web map display only |
| **Validation** | On-the-fly reprojection | ☐ System must validate CRS of uploaded layers and reproject to MAGNA-SIRGAS for analysis |

**📋 Rationale:** MAGNA-SIRGAS is Colombia's official geodetic reference system. All spatial data exchanged with government agencies (CARs, PNNC, IGAC) must use this CRS for compatibility with national datasets.

#### B. Authentication & User Management Compatibility

| Requirement | Implementation | Status |
|-------------|----------------|--------|
| **PNNC Authentication Protocol** | ☐ Tier 2/3 user management must support standard PNNC authentication protocols (to be specified by PNNC IT) | Pending specification |
| **LDAP/Active Directory** | ☐ System should be compatible with LDAP or Active Directory integration for institutional deployments | Pending specification |
| **SSO Capability** | ☐ Consider Single Sign-On (SSO) capability for future integration with Colombian government identity systems | Optional/Future |

**📋 Rationale:** PNNC IT staff will maintain the system long-term. Authentication must align with existing institutional identity management systems.

#### C. Data Exchange Formats

| Format | Use Case | Compliance |
|--------|----------|------------|
| **Shapefile** | Primary vector export for GIS compatibility | ☐ Include .prj file with MAGNA-SIRGAS definition |
| **GeoJSON** | Web API responses and lightweight data exchange | ☐ Coordinate order: longitude, latitude (RFC 7946) |
| **GeoTIFF** | Raster export | ☐ Include georeferencing in MAGNA-SIRGAS |
| **GeoPackage** | Modern vector format (optional) | ☐ Include as alternative to Shapefile |
| **CSV** | Tabular data export | ☐ Include coordinate columns in MAGNA-SIRGAS |

---

## Area 4.11: Layer Registry (Data Asset Inventory)

**Purpose:** This registry provides the authoritative list of all data layers required by the metrics in Area 4.4. It maps **layer requirements** (what we need) to **actual assets** (what we have), enabling immediate identification of data gaps.

**📋 Future Consideration:** This registry may be extracted to a standalone document (`LAYER_REGISTRY.md`) for easier maintenance by the Data Team.

**How to Use This Registry:**
1. Find a metric's "Required Input(s)" in the finalized metrics tables (4.4.1–4.4.3)
2. Look up that layer in this registry
3. Check the "Status" column — if ❌ or ❓, the metric cannot be calculated

**Status Legend:**
- ✅ **Available** — Asset confirmed, ready for use
- ⚠️ **Outdated** — Asset exists but needs updating
- ❌ **Missing** — No asset available, blocks dependent metrics
- ❓ **Unknown** — Availability not yet verified

---

#### 4.11.1. System-Generated Layers (Prioritizr Outputs)

These are produced by the Prioritizr optimization engine and are always available when a scenario exists.

| Layer ID | Required Layer | Description | Status | Notes |
|----------|----------------|-------------|--------|-------|
| `SYS_SOLUTION` | Prioritizr solution output | Selected planning units (the conservation solution) | ✅ Available | Core system output |
| `SYS_GOALS` | Goal achievement data | Target achievement per conservation feature | ✅ Available | Included in solution metadata |
| `SYS_COSTS` | Cost summary | Total cost of solution | ✅ Available | Included in solution metadata |
| `SYS_SCENARIO_MATCH` | Scenario matching algorithm | Nearest-neighbor similarity scoring | ✅ Available | Application logic |

---

#### 4.11.2. Biodiversity & Species Layers

| Layer ID | Required Layer | Expected Source Agency | Actual Asset Name | Version/Date | URL/Reference | Status |
|----------|----------------|------------------------|-------------------|--------------|---------------|--------|
| `BIO_SDM_MAMMALS` | Species distribution - Mammals | Humboldt (BioModelos) | — | — | — | ❓ Unknown |
| `BIO_SDM_BIRDS` | Species distribution - Birds | Humboldt (BioModelos) | — | — | — | ❓ Unknown |
| `BIO_SDM_AMPHIBIANS` | Species distribution - Amphibians | Humboldt (BioModelos) | — | — | — | ❓ Unknown |
| `BIO_SDM_REPTILES` | Species distribution - Reptiles | Humboldt (BioModelos) | — | — | — | ❓ Unknown |
| `BIO_SDM_PLANTS` | Species distribution - Plants | Humboldt (BioModelos) | — | — | — | ❓ Unknown |
| `BIO_IUCN_STATUS` | IUCN threat status attribute | IUCN Red List | — | — | — | ❓ Unknown |
| `BIO_ENDEMISM` | Endemism attribute | Humboldt | — | — | — | ❓ Unknown |

---

#### 4.11.3. Ecosystem & Environmental Layers

| Layer ID | Required Layer | Expected Source Agency | Actual Asset Name | Version/Date | URL/Reference | Status |
|----------|----------------|------------------------|-------------------|--------------|---------------|--------|
| `ECO_TYPES` | Ecosystem type layer | Humboldt / IDEAM | — | — | — | ❓ Unknown |
| `ECO_CARBON_TOTAL` | Carbon storage layer (total) | IDEAM | — | — | — | ❓ Unknown |
| `ECO_CARBON_ABOVE` | Above-ground carbon layer | IDEAM | — | — | — | ❓ Unknown |
| `ECO_CARBON_SOIL` | Soil organic carbon layer | IDEAM | — | — | — | ❓ Unknown |
| `ECO_WATER_REG` | Water regulation layer | IDEAM | — | — | — | ❓ Unknown |
| `ECO_WATERSHED` | Watershed boundaries | IDEAM | — | — | — | ❓ Unknown |
| `ECO_CONNECTIVITY` | Connectivity analysis layer | TBD | — | — | — | ❓ Unknown |
| `ECO_RESTORATION` | Restoration potential layer | TBD | — | — | — | ❓ Unknown |

---

#### 4.11.3b. Marine & Coastal Ecosystem Layers

*Required for metrics #48-52 (AOI Dashboard) and Ecosystem Assessment Report metrics #4-5.*

| Layer ID | Required Layer | Expected Source Agency | Actual Asset Name | Version/Date | URL/Reference | Status |
|----------|----------------|------------------------|-------------------|--------------|---------------|--------|
| `MARINE_ECO_TYPES` | Marine ecosystem type layer (coral reefs, mangroves, seagrass, etc.) | INVEMAR | — | — | — | ❓ Unknown |
| `MARINE_CORAL` | Coral reef distribution | INVEMAR | — | — | — | ❓ Unknown |
| `MARINE_MANGROVE` | Mangrove ecosystem distribution | INVEMAR / IDEAM | — | — | — | ❓ Unknown |
| `MARINE_SEAGRASS` | Seagrass bed distribution | INVEMAR | — | — | — | ❓ Unknown |
| `MARINE_COASTAL` | Coastal zone boundaries | DIMAR / INVEMAR | — | — | — | ❓ Unknown |

**📋 Note:** Marine ecosystem layers are essential for the tool to fulfill its stated territorial scope covering both terrestrial AND marine/oceanic components. INVEMAR (Instituto de Investigaciones Marinas y Costeras José Benito Vives de Andréis) is the primary source agency for marine ecosystem data in Colombia.

---

#### 4.11.4. Socio-Economic & Land Use Layers

| Layer ID | Required Layer | Expected Source Agency | Actual Asset Name | Version/Date | URL/Reference | Status |
|----------|----------------|------------------------|-------------------|--------------|---------------|--------|
| `SOCIO_HF` | Human Footprint layer | Humboldt (IAvH) | — | — | — | ❓ Unknown |
| `SOCIO_LANDUSE` | Land use layer | IDEAM / UPRA | — | — | — | ❓ Unknown |
| `SOCIO_AG_COST` | Agricultural opportunity cost layer | Humboldt (IAvH) | — | — | — | ❓ Unknown |
| `SOCIO_AG_FRONTIER` | Agricultural frontier layer | UPRA | — | — | — | ❓ Unknown |
| `SOCIO_ECON_MODEL` | Economic valuation model | TBD | — | — | — | ❌ **Missing** |
| `SOCIO_POPULATION` | Population data | DANE | — | — | — | ❓ Unknown |

---

#### 4.11.5. Conflict & Security Layers

| Layer ID | Required Layer | Expected Source Agency | Actual Asset Name | Version/Date | URL/Reference | Status |
|----------|----------------|------------------------|-------------------|--------------|---------------|--------|
| `CONFLICT_ZONES` | Conflict zones layer | UNODC / Gov't sources | — | — | — | ❓ Unknown |
| `CONFLICT_DISPUTES` | Land disputes layer | ANT / Gov't sources | — | — | — | ❓ Unknown |
| `CONFLICT_SOCIAL` | Social conflict risk layer | TBD | — | — | — | ❓ Unknown |

---

#### 4.11.6. Protected Areas & Conservation Layers

| Layer ID | Required Layer | Expected Source Agency | Actual Asset Name | Version/Date | URL/Reference | Status |
|----------|----------------|------------------------|-------------------|--------------|---------------|--------|
| `PA_ALL` | Protected areas layer (all categories) | PNNC / RUNAP | — | — | — | ❓ Unknown |
| `PA_PARKS` | National parks layer | PNNC / RUNAP | — | — | — | ❓ Unknown |
| `PA_OMEC` | OMECs layer | Protected Planet | OMEC_2020.shp | 2020 | protectedplanet.net | ⚠️ **Outdated** |
| `PA_MPA` | Marine Protected Areas layer | PNNC / DIMAR / INVEMAR | — | — | — | ❓ Unknown |

**🚨 OMEC Layer Replacement Plan (MANDATORY):**

The OMECs layer (`PA_OMEC`) is flagged as outdated (2020 vintage). Stakeholders have explicitly noted this issue, citing specific examples such as the El Tuparro Biosphere Reserve requiring update. **This layer must be updated before final tool handoff.**

| Action | Responsible Party | Target Date | Status |
|--------|-------------------|-------------|--------|
| Identify current OMEC data source (Protected Planet 2024+ or RUNAP) | Data Team | ☐ TBD | Pending |
| Acquire updated OMEC layer | Data Team | ☐ TBD | Pending |
| Validate layer against known OMEC sites (e.g., El Tuparro) | Data Team | ☐ TBD | Pending |
| Deprecate `OMEC_2020.shp` via Layer Deprecation Workflow (Section 2.3) | Tier 3 Admin | ☐ TBD | Pending |
| Publish new OMEC layer as current version | Tier 3 Admin | ☐ TBD | Pending |
| Update scenarios using deprecated layer (warning notifications) | System/Admin | ☐ TBD | Pending |

---

#### 4.11.7. Cultural & Ethnic Territory Layers

| Layer ID | Required Layer | Expected Source Agency | Actual Asset Name | Version/Date | URL/Reference | Status |
|----------|----------------|------------------------|-------------------|--------------|---------------|--------|
| `ETH_INDIGENOUS` | Indigenous territories layer | ANT | — | — | — | ❓ Unknown |
| `ETH_COUNCILS` | Community councils layer | ANT | — | — | — | ❓ Unknown |
| `ETH_SACRED` | Sacred sites layer | TBD | — | — | — | ❌ **Missing** |
| `ETH_LEGAL_MAP` | FPIC legal requirement mapping | TBD | — | — | — | ❓ Unknown |

**🚨 ETH_SACRED Acquisition Plan (CRITICAL — Required for Ethnic Report):**

The Sacred Sites layer (`ETH_SACRED`) is **required** for the Ethnic Territory Consultation Report Metric #1 (Culturally Significant Landscape Overlap). Without this layer, the tool cannot fulfill its mandate to address community spiritual dimensions and FPIC compliance.

| Action | Responsible Party | Potential Sources | Status |
|--------|-------------------|-------------------|--------|
| Identify authoritative data source | Data Team | ANT, Ministry of Interior, Indigenous organizations, DANE | ☐ Pending |
| Assess data sensitivity and access restrictions | Data Team / Legal | Legal counsel, Indigenous community representatives | ☐ Pending |
| Negotiate data sharing agreement (if required) | Project Lead | Source agency | ☐ Pending |
| Acquire and validate layer | Data Team | — | ☐ Pending |
| Document metadata and usage restrictions | Data Team | — | ☐ Pending |

**⚠️ Note:** Sacred sites data may have cultural sensitivity restrictions. The acquisition process must respect Indigenous data sovereignty principles and may require community consultation before use in the tool.

---

#### 4.11.8. Administrative & Planning Layers

| Layer ID | Required Layer | Expected Source Agency | Actual Asset Name | Version/Date | URL/Reference | Status |
|----------|----------------|------------------------|-------------------|--------------|---------------|--------|
| `ADMIN_NATIONAL` | National boundary | IGAC | — | — | — | ❓ Unknown |
| `ADMIN_DEPT` | Department boundaries | IGAC / DANE | — | — | — | ❓ Unknown |
| `ADMIN_MUNI` | Municipality boundaries | IGAC / DANE | — | — | — | ❓ Unknown |
| `ADMIN_CAR` | CAR (Environmental Authority) boundaries | MADS | — | — | — | ❓ Unknown |
| `ADMIN_SIRAP` | SIRAP boundaries | MADS | — | — | — | ❓ Unknown |
| `ADMIN_EEZ` | Exclusive Economic Zone (EEZ) boundary | DIMAR / Colombian Navy | — | — | — | ❓ Unknown |
| `PLAN_DETERMINANTS` | Territorial Planning Determinants layer | CARs / Municipal offices | — | — | — | ❓ Unknown |
| `PLAN_ZONING` | Zoning constraint layers | CARs / Municipal offices | — | — | — | ❓ Unknown |

---

#### 4.11.9. Layer Registry Summary

| Category | Total Layers | ✅ Available | ⚠️ Outdated | ❌ Missing | ❓ Unknown |
|----------|--------------|--------------|-------------|------------|------------|
| System-Generated | 4 | 4 | 0 | 0 | 0 |
| Biodiversity & Species | 7 | 0 | 0 | 0 | 7 |
| Ecosystem & Environmental | 8 | 0 | 0 | 0 | 8 |
| **Marine & Coastal** | **5** | **0** | **0** | **0** | **5** |
| Socio-Economic & Land Use | 6 | 0 | 0 | 1 | 5 |
| Conflict & Security | 3 | 0 | 0 | 0 | 3 |
| Protected Areas & Conservation | 4 | 0 | 1 | 0 | 3 |
| Cultural & Ethnic | 4 | 0 | 0 | 1 | 3 |
| Administrative & Planning | 8 | 0 | 0 | 0 | 8 |
| **TOTAL** | **49** | **4** | **1** | **2** | **42** |

**🚨 CRITICAL ACTION REQUIRED — IMPLEMENTATION BLOCKER:**

**42 of 49 required layers have unknown availability status (❓ Unknown).** Implementation cannot proceed until these data gaps are resolved.

| Priority | Action | Responsible Party | Deadline |
|----------|--------|-------------------|----------|
| 🔴 **CRITICAL** | Verify status of all 42 ❓ Unknown layers | Data Team | ☐ **Before Sprint 1** |
| 🔴 **CRITICAL** | Acquire `SOCIO_ECON_MODEL` (Economic valuation model) — required for Metric #12 | Data Team / Science Team | ☐ **Before Tier 2 development** |
| 🔴 **CRITICAL** | Acquire `ETH_SACRED` (Sacred sites layer) — required for Ethnic Report Metric #1 | Data Team | ☐ **Before Tier 2 development** |
| 🟠 **HIGH** | Update `PA_OMEC` layer (outdated 2020 vintage) | Data Team | ☐ **Before final handoff** |
| 🟠 **HIGH** | Acquire marine ecosystem layers (`MARINE_ECO_TYPES`, `PA_MPA`, `ADMIN_EEZ`) — required for stated territorial scope | Data Team | ☐ **Before marine metrics implementation** |
| 🟡 **MEDIUM** | Verify `SOCIO_AG_FRONTIER` (Agricultural frontier layer) for Territorial Metric #4 | Data Team | ☐ **Before Tier 2 development** |

**Without resolving these gaps:**
- Metrics with ❓ Unknown inputs cannot be calculated or displayed
- Metrics with ❌ Missing inputs (Economic Impact #12, Sacred Sites overlap) will show "Data Unavailable" or be hidden entirely
- Reports depending on missing layers will be incomplete

---

#### 4.11.10. Layer Registry Maintenance Process

1. **When adding a new metric:** Add any new Required Input(s) to this registry
2. **When acquiring a new layer:** Update the "Actual Asset Name," "Version/Date," "URL/Reference," and "Status" columns
3. **When a layer becomes outdated:** Update status to ⚠️ and note the issue
4. **Quarterly review:** Data Team should audit all layer statuses

---

# Part 5: Data Dictionary & Glossary

### 5.1. Core Entities

**Planning Unit**
The fundamental spatial unit of analysis (grid cell or polygon). All data is summarized to this unit.

**Theme (Conservation Feature)**
A biological or physical feature to be protected (e.g., "Cloud Forest", "Spectacled Bear Habitat").
*   **Goal:** The target percentage (0-100%) of this feature to protect.
*   **📋 Terminology Note:** Stakeholders may use the term **"Attribute"** (Atributo) to refer to both natural and cultural features. In this application, "Attribute" is synonymous with "Theme" or "Conservation Feature." The recommended organizational structure categorizes inputs as: **Attributes** (features to protect), **Limitations/Costs** (factors that increase solution cost), and **Opportunities/Benefits** (factors that decrease cost or add value).

**Weight (Influence Factor)**
A socio-economic or physical layer that acts as a cost or benefit (e.g., "Land Cost", "Distance to Roads").
*   **Factor:** An importance value (-100 to +100). Negative avoids the feature; Positive prefers it.
*   **📋 Terminology Note:** In the user interface, weights should be contextually labeled using descriptive terms that convey their semantic meaning rather than the generic term "Weight":
    *   Use **"Cost"** or **"Limitation"** for factors the optimization should avoid (negative weights) — e.g., "Cost: Agricultural Opportunity Cost", "Limitation: Human Footprint"
    *   Use **"Benefit"** or **"Opportunity"** for factors the optimization should prefer (positive weights) — e.g., "Benefit: Connectivity Index", "Opportunity: Restoration Potential"

**Include (Constraint)**
Areas that *must* be included in the solution (e.g., Existing National Parks).

**Exclude (Constraint)**
Areas that *must not* be included in the solution (e.g., Urban Centers).

**Solution (Scenario)**
A single pre-calculated result showing selected Planning Units. Defined by the specific combination of Goals, Weights, and Constraints used to generate it.

### 5.2. Naming Conventions & Acronym Policy

**📋 Official Names Requirement:** All official communications, report headers, data citations, and metadata displays must use **full proper names** of Colombian institutions and entities rather than acronyms. This includes but is not limited to:

| Acronym | Full Name (Spanish) | Full Name (English) |
|---------|---------------------|---------------------|
| PNN / PNNC | Parques Nacionales Naturales de Colombia | National Natural Parks of Colombia |
| CARs | Corporaciones Autónomas Regionales | Regional Autonomous Corporations |
| SIRAP | Sistema Regional de Áreas Protegidas | Regional System of Protected Areas |
| SINAP | Sistema Nacional de Áreas Protegidas | National System of Protected Areas |
| MADS | Ministerio de Ambiente y Desarrollo Sostenible | Ministry of Environment and Sustainable Development |
| IAvH / Humboldt | Instituto de Investigación de Recursos Biológicos Alexander von Humboldt | Alexander von Humboldt Biological Resources Research Institute |
| IDEAM | Instituto de Hidrología, Meteorología y Estudios Ambientales | Institute of Hydrology, Meteorology and Environmental Studies |
| IGAC | Instituto Geográfico Agustín Codazzi | Agustín Codazzi Geographic Institute |
| ANT | Agencia Nacional de Tierras | National Land Agency |
| DANE | Departamento Administrativo Nacional de Estadística | National Administrative Department of Statistics |
| UPRA | Unidad de Planificación Rural Agropecuaria | Rural Agricultural Planning Unit |
| OMECs / OECMs | Otras Medidas Efectivas de Conservación Basadas en Áreas | Other Effective Area-based Conservation Measures |

**Implementation:** Interface elements may display acronyms for space efficiency, but must include the full name in tooltips, metadata panels, and all exported reports/PDFs.

### 5.3. Optimization Terminology

**Minimum Set:** An optimization objective that minimizes total cost while meeting all conservation goals.
**Minimum Shortfall:** An optimization objective that maximizes goal achievement within a fixed budget.
**Boundary Penalty (Clustering):** A mathematical penalty applied to the perimeter of the solution to encourage compact, connected shapes.
**Optimality Gap:** The allowable margin of error for the solver (e.g., 10%), used to reduce computation time while ensuring high-quality results.
