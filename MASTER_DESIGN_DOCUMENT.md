# Conservation Decision Support Tool: Master Design Document
*Authoritative Source of Truth for Application Development*

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

---

# Part 1: Product Vision

**Conservation Decision Support Tool** is an interactive systematic conservation planning application for Colombia. It empowers users—from the general public to regional planners—to identify and prioritize conservation areas based on biodiversity, ecosystem services, and socio-economic data across **both terrestrial and marine/oceanic components** of Colombia's territory.

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
    *   Solution Finder (Slider-based discovery).
    *   Interactive Map exploration.
    *   AOI (Area of Interest) Dashboard for local statistics.
    *   Basic PDF Summary Report.

### 2.2. Tier 2: The "Decision Maker" (Planner)
*   **Identity:** Regional environmental authority (CARs), government planners, technical staff.
*   **Access:** Authenticated (Login required).
    *   **Session Persistence:** Login sessions must persist across browser reloads and page navigations. Users should not be forced to re-authenticate on every application reload. Implement secure token-based authentication with configurable session duration (e.g., 7-day persistent login with "Remember Me" option).
*   **Primary Goal:** Perform detailed trade-off analysis and generate technical planning inputs.
*   **Key Features:** 
    *   **All Tier 1 features.**
    *   **Scenario Comparison:** Side-by-side views and difference mapping (conflict/agreement). Comparison tools are **Tier 2-only** to provide professional-grade trade-off analysis while maintaining simplicity for public users.
    *   **Custom Data Upload:** 
        *   Upload **vector layers** (Shapefiles, GeoJSON, KML/KMZ) to overlay on the map
        *   Upload **raster layers** (GeoTIFF, IMG) for analysis
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
    *   Users can click a featured scenario to load it immediately, OR proceed to define custom priorities

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
*System finds the best-matching pre-calculated scenario.*

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

### 3.3. The Solution Request Workflow (Tier 3 Only)
*Administrative tools for expanding the solution library.*

1.  **Define New Optimization:**
    *   Admin accesses the **Admin Dashboard** or **Solution Request Panel**.
    *   Specifies parameters for a new conservation scenario:
        *   **Theme Goals:** Target percentages for each conservation feature (e.g., "Protect 40% of Jaguar habitat").
        *   **Species Group Fragmentation (Advanced):** 
            *   Option to fragment broad species groups into differential subgroups:
                *   By **Endemism**: "Endemic vs. Non-endemic species within Mammals"
                *   By **Threat Status**: "Critically Endangered vs. Endangered vs. Vulnerable"
                *   By **Taxonomic Subgroup**: "Primates vs. Carnivores vs. Ungulates within Mammals"
                *   By **Cost Factors**: "High-cost habitats vs. Low-cost habitats for the same species group"
            *   Assign independent goals and weights to each fragment
            *   Example: "Protect 50% of Endemic Birds (weight: 100) vs. 30% of Non-endemic Birds (weight: 50)"
        *   **Weight Factors:** Importance values for cost/benefit layers (e.g., "Agricultural Opportunity Cost 2021: -80", "Connectivity Index: +60").
        *   **Constraints:** Include/Exclude areas (e.g., "Must include National Parks", "Exclude Urban Centers").
        *   **Optimization Settings:** Budget constraints, clustering parameters, solver settings.
    *   Assigns a descriptive name and metadata to the solution request.

2.  **Submit & Queue:**
    *   Admin submits the optimization job to the processing queue.
    *   System validates parameters and estimates computation time.
    *   Job enters the queue with status "Pending" or "Running".

3.  **Monitor Progress:**
    *   Admin views the **Job Queue Dashboard** showing:
        *   Active jobs (currently running optimizations).
        *   Queued jobs (waiting to be processed).
        *   Completed jobs (finished successfully).
        *   Failed jobs (errors or timeouts).
    *   System provides status updates and estimated completion time.

4.  **Review & Publish:**
    *   Once optimization completes, Admin reviews the solution:
        *   Views the solution on the map.
        *   Checks statistics (goals met, area required, cost).
        *   Verifies spatial pattern and quality.
    *   Admin decides to:
        *   **Publish:** Add the solution to the public library (visible to Tier 1 & 2 users).
        *   **Archive:** Save for internal use only.
        *   **Delete:** Remove if unsatisfactory or redundant.

---

# Part 4: Functional Specifications

## Area 4.0: Components Overview & Summary

This section provides a high-level overview of all UI components in the application, making it easy to understand the system architecture and locate specific components in the detailed specifications below.

#### Component 4.0.1: Components Summary Tables

**Table A: Interactive Application Components**

These are the live UI components users interact with in the application.

| Component Name | Location | Has Metrics? | # of Metrics | Top 3-5 Key Metrics | Metrics Table |
|----------------|----------|--------------|--------------|---------------------|---------------|
| **LEFT SIDEBAR** | | | | | |
| Solution Selector | Left Sidebar | No | 0 | — | — |
| Layer Visibility Manager | Left Sidebar | No | 0 | — | — |
| Symbology Control Panel | Left Sidebar | No | 0 | — | — |
| Export/Report Buttons | Left Sidebar | No | 0 | — | — |
| **CENTER PANEL** | | | | | |
| Interactive Map | Center Panel | No | 0 | — | — |
| Map Controls | Center Panel | No | 0 | — | — |
| **RIGHT SIDEBAR** | | | | | |
| Solution Overview Panel | Right Sidebar | **Yes** | **17** | Goal Achievement %, Carbon Storage (tCO2e), Opportunity Cost (USD), Human Footprint Overlap %, Match Quality % | Area 4.4.1 |
| AOI Dashboard | Right Sidebar | **Yes** | **47** | Priority Area (km²), Species Richness, Carbon Biomass (tCO2e), % of National Ecosystem, Regional Significance | Area 4.4.2 |
| Scenario Comparison Panel | Right Sidebar | **Yes** | **4** | Agreement Area (km²), Unique to Scenario A, Unique to Scenario B, Synergy Zones | Area 4.4.3 |
| Welcome Panel | Right Sidebar | No | 0 | — | — |
| **MODALS** | | | | | |
| Solution Finder Modal | Modal | No | 0 | — | — |
| Perspective Selection Modal | Modal | No | 0 | — | — |

**Interactive Components Summary:** 12 total components, 3 with metrics, **68 unique metrics** (see Area 4.4 for complete metrics reference)

**Table B: Generated Reports & Documentation**

These are outputs that can be viewed in-app (Page View) and downloaded (PDF) for sharing and detailed analysis. Reports primarily **reuse metrics** from the interactive components above but may include additional unique metrics.

| Report Name | Output Format | Metrics Source | # of Additional Unique Metrics | Section Reference |
|-------------|---------------|----------------|-------------------------------|-------------------|
| Trade-off Analysis Report | PDF + Page View | Reuses Solution Overview Panel metrics | **0** (all metrics from 4.3.1) | 4.5 (Report #1) |
| Ecosystem Assessment Report | PDF + Page View | Reuses AOI Dashboard metrics + adds ecosystem-specific detail | TBD | 4.5 (Report #2) |
| Connectivity Report | PDF + Page View | Reuses AOI Dashboard metrics + adds connectivity analysis | TBD | 4.5 (Report #3) |
| Species Conservation Report | PDF + Page View | Reuses AOI Dashboard metrics + adds species-specific detail | TBD | 4.5 (Report #4) |
| Territorial Planning Report | PDF + Page View | Reuses AOI Dashboard metrics + adds planning-specific metrics | TBD | 4.5 (Report #5) |
| Ethnic Territory Consultation Report | PDF + Page View | Reuses AOI Dashboard cultural metrics + adds consultation detail | TBD | 4.5 (Report #6) |

**Reports Summary:** 6 total reports, all available as both in-app Page View and downloadable PDF. Trade-off Analysis Report is fully specified (reuses 17 metrics from Solution Overview Panel). Other thematic reports (Reports #2-6) require specification to determine unique metrics vs. reused metrics.

#### 4.0.2. Summary Statistics of All Components, Reports,  Metrics

**Interactive Components:**
- **Total Interactive Components:** 12
- **Components with Metrics:** 3 (Solution Overview Panel, AOI Dashboard, Scenario Comparison Panel)
- **Total Unique Metrics in Interactive App:** 68
- **Most Metric-Heavy Component:** AOI Dashboard (47 unique metrics)

**Reports:**
- **Total Reports:** 6
- **Fully Specified Reports:** 1 (Trade-off Analysis Report)
- **Reports Requiring Specification:** 5 (thematic reports #2-6)

**Overall:**
- **Total UI Components + Reports:** 18
- **Metric Distribution:** All 68 metrics concentrated in Right Sidebar (Analysis Components)

#### 4.0.3. Key Insights for Team Review

**Where to Focus Your Review:**
1. **Right Sidebar Components (Analysis Dashboard)** - This is where ALL 68 metrics live
   - Solution Overview Panel: 17 unique metrics (Component 4.3.1)
   - AOI Dashboard: 47 unique metrics (Component 4.3.2)
   - Scenario Comparison Panel: 4 unique metrics (Component 4.3.3)

2. **Reports** - Currently only Trade-off Analysis Report (#1) is fully specified
   - Reports #2-6 need specification work to determine unique vs. reused metrics


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
A large, centralized Modal interface for discovering conservation scenarios. This is separated from the sidebar to accommodate the comprehensive input options and narrative-driven exploration.

*   **UI Components:**
    *   **Theme Goal Selectors:** 
        *   **Discrete target options** for each conservation feature (e.g., 17%, 30%, 34%, or Custom)
        *   **Layer-based calculation tool:** Users can select specific data layers and the system automatically calculates standardized goal percentages (e.g., "Protect 30% of Jaguar Habitat")
        *   Visual indicators showing alignment with international conservation targets (e.g., 30x30 initiative)
    *   **Weight Sliders:** Control importance (-100 to +100) for cost/benefit layers with labeled presets ("Avoid", "Neutral", "Prefer")
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

## Area 4.3: Right Sidebar Analysis Views

The Right Sidebar dynamically displays different analytical content based on user actions and context.

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
    
    **Metrics Reference:** See **Area 4.4.1** for the complete Solution Overview Panel Metrics Table (17 metrics).
    
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
    
    **Metrics Reference:** See **Area 4.4.2** for the complete AOI Dashboard Metrics Table (47 metrics).
    
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

## Area 4.4: Metrics Reference Tables (Master Metrics Consolidation)

This section consolidates all metrics from the Right Sidebar analysis components into one reference location for easy completeness checking and team review.

**Purpose:** Provide a single source of truth for all 68 metrics tracked in the application. Each table shows metrics for one component, with an "Also Appears In" column indicating where metrics are reused across components and reports.

#### 4.4.1. Solution Overview Panel Metrics (17 Metrics)

*Component Reference: Component 4.3.1*

| # | Metric Name | Units | Purpose | Visualization | Also Appears In |
|---|-------------|-------|---------|---------------|-----------------|
| **GAINS (Conservation Achievements)** | | | | | |
| 1 | Conservation Goals Met | Count and % | Show how many conservation targets achieved | Visual checkmarks (✓/✗) | Trade-off Report, Comparison Panel |
| 2 | Species Groups Protected | Count (e.g., "8 of 10") | Show breadth of biodiversity protection | Progress bar or fraction | Trade-off Report |
| 3 | Threatened Species Secured | Count | Highlight protection of at-risk species | Badge with count | Trade-off Report, AOI Dashboard |
| 4 | Ecosystem Coverage | km² and % | Show area of each ecosystem type protected | Bar chart by ecosystem | Trade-off Report, AOI Dashboard |
| 5 | Carbon Storage Capacity | tCO2e | Quantify climate mitigation value | Stat card with large number | Trade-off Report, AOI Dashboard |
| 6 | Water Regulation Services | m³ or index | Quantify water provision importance | Gauge or stat card | Trade-off Report, AOI Dashboard |
| 7 | Connectivity Index | Corridor count or index | Show landscape connectivity | Network diagram or index | Trade-off Report |
| **LOSSES/COSTS (Trade-offs)** | | | | | |
| 8 | Agricultural Opportunity Cost | COP and USD (millions) | Quantify foregone agricultural revenue | Stat card, currency format | Trade-off Report, AOI Dashboard |
| 9 | Affected Agricultural Area | km² and % | Show spatial extent of agricultural impact | Bar chart or map overlay | Trade-off Report |
| 10 | Human Footprint Overlap | km² and % of priority areas | Show overlap with developed landscapes | Percentage bar, histogram | Trade-off Report, AOI Dashboard |
| 11 | Development Restriction Area | km² | Show area where development constrained | Stat card with area | Trade-off Report |
| 12 | Economic Impact of Restrictions | COP and USD (millions) | Estimate cost of development constraints | Stat card, currency format | Trade-off Report |
| 13 | Conflict Zone Overlap | km² | Show overlap with historical conflict areas | Map overlay, stat card | Trade-off Report, AOI Dashboard |
| 14 | Land Dispute Overlap | km² | Show overlap with active disputes | Map overlay, stat card | Trade-off Report |
| **SUMMARY METRICS** | | | | | |
| 15 | Goal Achievement Quality | % (0-100%) | Overall success rate for targets | Progress bar with label | Trade-off Report, Comparison Panel |
| 16 | Match Quality | % (0-100%) | How well solution matches user priorities | Badge (e.g., "95% Match") | Solution Overview only |
| 17 | National Contribution | % of Colombia | Solution's contribution to 30% target | Progress bar | Trade-off Report, AOI Dashboard |

#### 4.4.2. AOI Dashboard Metrics (47 Metrics)

*Component Reference: Component 4.3.2*

| # | Metric Name | Units | Purpose | Visualization | Also Appears In |
|---|-------------|-------|---------|---------------|-----------------|
| **REGIONAL CONSERVATION** | | | | | |
| 1 | Priority Area in Region | km² | Show conservation extent in this area | Progress bar | Regional Report |
| 2 | Priority Area in Region | % of region | Show proportion of region prioritized | Progress bar | Regional Report |
| 3 | Number of Priority Zones | Count | Show fragmentation/concentration | Stat card | Regional Report |
| **BIODIVERSITY** | | | | | |
| 4 | Species Richness - Mammals | Count | Compare biodiversity - mammals | Bar chart | Species Report |
| 5 | Species Richness - Birds | Count | Compare biodiversity - birds | Bar chart | Species Report |
| 6 | Species Richness - Amphibians | Count | Compare biodiversity - amphibians | Bar chart | Species Report |
| 7 | Species Richness - Reptiles | Count | Compare biodiversity - reptiles | Bar chart | Species Report |
| 8 | Species Richness - Plants | Count | Compare biodiversity - plants | Bar chart | Species Report |
| 9 | Threatened Species Count | Count | Highlight at-risk species presence | Badge with red highlight | Species Report, Solution Overview |
| 10 | Endemic Species Count | Count | Show unique regional biodiversity | Badge | Species Report |
| 11 | % of National Species Total | % | Show regional significance for species | Stat with comparison | Species Report |
| **ECOSYSTEMS** | | | | | |
| 12 | Ecosystem Coverage - Cloud Forest | km² and % | Show ecosystem representation | Donut chart segment | Ecosystem Report |
| 13 | Ecosystem Coverage - Paramo | km² and % | Show ecosystem representation | Donut chart segment | Ecosystem Report |
| 14 | Ecosystem Coverage - Dry Forest | km² and % | Show ecosystem representation | Donut chart segment | Ecosystem Report |
| 15 | Ecosystem Coverage - Wetlands | km² and % | Show ecosystem representation | Donut chart segment | Ecosystem Report |
| 16 | Ecosystem Coverage - Other | km² and % | Show ecosystem representation | Donut chart segment | Ecosystem Report |
| **ECOSYSTEM SERVICES** | | | | | |
| 17 | Total Carbon Biomass | tCO2e | Quantify climate value | Stat card, large number | Solution Overview |
| 18 | Above-ground Carbon | tCO2e | Show living biomass carbon | Breakdown stat | Ecosystem Report |
| 19 | Soil Organic Carbon | tCO2e | Show soil carbon storage | Breakdown stat | Ecosystem Report |
| 20 | Average Carbon Density | tCO2e/ha | Show per-area efficiency | Stat card | Ecosystem Report |
| 21 | % of National Carbon | % | Show regional carbon significance | Comparison stat | Regional Report |
| 22 | Water Regulation Capacity | m³ or index | Quantify water provision | Gauge | Solution Overview |
| 23 | Downstream Beneficiaries | Population count | Show human dependency on water | Stat card with icon | Regional Report |
| **SOCIO-ECONOMIC CONTEXT** | | | | | |
| 24 | Average Human Footprint | Index 0-100 | Assess development pressure | Gauge | Solution Overview |
| 25 | HF Distribution - Low (0-20) | % of area | Show pressure distribution | Histogram segment | Territorial Report |
| 26 | HF Distribution - Moderate (21-50) | % of area | Show pressure distribution | Histogram segment | Territorial Report |
| 27 | HF Distribution - High (51-80) | % of area | Show pressure distribution | Histogram segment | Territorial Report |
| 28 | HF Distribution - Very High (81-100) | % of area | Show pressure distribution | Histogram segment | Territorial Report |
| 29 | Land Use - Natural Forest | % | Show current land uses | Donut segment | Territorial Report |
| 30 | Land Use - Pasture | % | Show current land uses | Donut segment | Territorial Report |
| 31 | Land Use - Crop Agriculture | % | Show current land uses | Donut segment | Territorial Report |
| 32 | Land Use - Other | % | Show current land uses | Donut segment | Territorial Report |
| 33 | Agricultural Opportunity Cost | COP and USD | Quantify economic trade-off | Stat card, currency | Solution Overview |
| 34 | % of Region in Agriculture | % | Show agricultural intensity | Stat | Territorial Report |
| 35 | Historical Conflict Zone Overlap | km² | Show conflict exposure | Map overlay, stat | Solution Overview |
| 36 | Social Conflict Risk Level | Categorical (Low/Mod/High) | Assess implementation risk | Badge or gauge | Territorial Report |
| **CULTURAL & ETHNIC** | | | | | |
| 37 | Indigenous Reservations Area | km² | Identify indigenous lands | List + area stat | Ethnic Report |
| 38 | Community Councils Area | km² | Identify Afro-Colombian territories | List + area stat | Ethnic Report |
| 39 | Consultation Requirement Flag | Yes/No | Identify legal consultation needs | Badge/alert | Ethnic Report |
| 40 | Consultation Requirement Area | km² | Quantify consultation area | Stat | Ethnic Report |
| **PROTECTION STATUS** | | | | | |
| 41 | Total Protected Area in AOI | km² and % | Show current protection coverage | Progress bar | Regional Report |
| 42 | % Overlap with National Parks | % | Show complementarity | Breakdown stat | Regional Report |
| 43 | % Overlap with OMECs | % | Show complementarity | Breakdown stat | Regional Report |
| 44 | % Overlap with Indigenous Territories | % | Show cultural overlap | Breakdown stat | Ethnic Report |
| 45 | Coverage Gap | % of priority unprotected | Show new conservation opportunity | Progress bar (inverse) | Regional Report |
| 46 | Synergy Score | Index or categorical | Assess system complementarity | Gauge or badge | Regional Report |
| **NATIONAL CONTRIBUTION** | | | | | |
| 47 | Regional Significance Classification | Categorical | Summarize regional importance | Badge with color coding | Regional Report, Solution Overview |

#### 4.4.3. Scenario Comparison Panel Metrics (4 Unique Metrics)

*Component Reference: Component 4.3.3*

These metrics are unique to scenario comparison and do not appear elsewhere.

| # | Metric Name | Units | Purpose | Visualization | Also Appears In |
|---|-------------|-------|---------|---------------|-----------------|
| 1 | Agreement Area | km² | Show areas selected in BOTH scenarios | Green overlay on map, stat card | Comparison Report only |
| 2 | Unique to Scenario A | km² | Show areas only in Scenario A | Orange overlay on map, stat card | Comparison Report only |
| 3 | Unique to Scenario B | km² | Show areas only in Scenario B | Blue overlay on map, stat card | Comparison Report only |
| 4 | Connectivity/Synergy Zones | km² | Show potential corridors linking priorities | Purple overlay on map, stat card | Comparison Report only |

**Note:** The Scenario Comparison Panel also displays comparative versions of metrics from the Solution Overview Panel (Goal Achievement, Carbon Storage, Opportunity Cost, etc.) in a side-by-side table format. These are not counted as unique metrics since they reuse the same data definitions.

#### 4.4.4. Metrics Summary

**Total Unique Metrics:** 68
- Solution Overview Panel: 17 metrics
- AOI Dashboard: 47 metrics
- Scenario Comparison Panel: 4 unique metrics

**Metric Reuse Patterns:**
- **Most Reused:** Carbon Storage, Opportunity Cost, Human Footprint (appear in 3+ components/reports)
- **Component-Specific:** Match Quality (Solution Overview only), Comparison metrics (Comparison Panel only)
- **Report Coverage:** Trade-off Report uses all 17 Solution Overview metrics; Thematic Reports use subsets of AOI Dashboard metrics

**Team Review Checklist:**
- ☐ Verify all metrics are derivable from Prioritizer output
- ☐ Verify all metrics are useful for decision-making
- ☐ Verify units are correct and consistent
- ☐ Verify no metrics are missing
- ☐ Verify no duplicate/redundant metrics

## Area 4.5: Advanced Reporting (Tier 2)
Automated PDF generation for specific planning needs. All reports must include detailed statistical breakdowns and contextual narratives.

**Required Report Content Standards:**
*   **Detailed Distributions:** All reports must include percentage breakdowns of planning units by:
    *   Human Footprint value categories (Low, Moderate, High, Very High)
    *   Land use types (Natural Forest, Pasture, Agriculture, Urban, etc.)
    *   Administrative jurisdictions (Municipalities, Environmental Authorities)
    *   Relationships with existing management figures (overlap percentages)
*   **Contextual Narratives:** Auto-generated interpretive text explaining the significance of statistics at both regional and national scales
*   **Methodology Appendix:** Full documentation of data sources, dates, and calculation methods

**Report Types:**

1.  **Trade-off Analysis Report (Gains vs. Losses) - MANDATORY:**
    *   **Purpose:** Provide comprehensive "what you are getting vs. what you are losing" analysis to ensure decisions are made with full understanding of implications
    *   **Delivery Method:** 
        *   **Dedicated Page View:** Opens as a full-screen or overlay page within the application for interactive browsing
        *   **Downloadable PDF:** Complete report can be exported as PDF for offline use, sharing, and archival
        *   Both formats contain identical content (all charts, maps, statistics, and narrative text)
    *   **Perspective-Based Narrative Framing:**
        *   User selects a perspective (Regional Planner, Community Leader, Conservationist, Economist, or Climate Advocate) when generating the report
        *   **All data, metrics, charts, and statistics remain the same** regardless of perspective
        *   Perspective choice only affects how the auto-generated narrative text is worded and which aspects are emphasized
        *   User can regenerate the report with a different perspective to see alternative framings of the same data
    *   **Language Support:**
        *   Default language: Spanish (Español)
        *   Alternative language: English
        *   Language toggle available throughout the application
        *   Both page view and PDF export respect the selected language
    *   **Required Structure:** Full detailed version of the Trade-off Analysis Framework (see Section 4.3.1)
    
    **GAINS Section (Detailed):**
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
    
    **LOSSES/COSTS Section (Detailed):**
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
    
    **Full Narrative Analysis:**
    *   Comprehensive auto-generated text (2-3 paragraphs) synthesizing the gains and losses
    *   Explicit statement of major trade-offs: "This scenario prioritizes X at the cost of Y"
    *   Contextual explanations: WHY certain goals are met or unmet (insufficient ecosystem area vs. cost constraints vs. optimization trade-offs)
    *   Risk assessment: Implementation challenges and recommended mitigation strategies
    *   Example: "This conservation scenario achieves GOOD biodiversity protection (7 of 10 species groups with adequate habitats) and EXCELLENT ecosystem service provision (2.5B tCO2e carbon storage, water regulation for 8M people) at a MODERATE economic cost ($350M agricultural opportunity cost representing 12% of regional agricultural GDP). The solution prioritizes high-elevation ecosystems (cloud forests, paramo) which explain the unmet lowland wetland targets (-7% below goal). Implementation faces MODERATE challenges: 15% of priority areas overlap with human-modified landscapes requiring restoration approaches, and 8,200 km² overlap with historical conflict zones necessitating careful community engagement and consultation, particularly with 5 indigenous territories and 3 community councils within priority areas. The solution complements the existing protected area system well (35% overlap with current management figures) while identifying 65% as new priority areas filling critical conservation gaps."
    
    *   **Visual Report Components:**
        *   Side-by-side bar charts: Goals Met vs. Goals Unmet
        *   Dual-axis chart: Biodiversity gains vs. Economic costs
        *   Map series: Conservation priorities, Human pressure overlay, Conflict zone overlay, Existing protected areas overlay

2.  **Ecosystem Assessment Report:** 
    *   Detailed breakdown of ecosystem representation and gaps within the AOI
    *   Percentage of each ecosystem type protected vs. unprotected
    *   Distribution across human footprint categories
    *   Relationship with existing protected area system

2.  **Connectivity Report:** 
    *   Maps of structural connectivity and critical corridors
    *   Identification of pinch points and bottlenecks
    *   Connectivity metrics by land use type
    *   Recommendations for corridor restoration

3.  **Species Conservation Report:** 
    *   Critical habitat maps for focal species
    *   Threat level analysis and spatial distribution
    *   Habitat fragmentation metrics
    *   Endemic vs. non-endemic species protection assessment

4.  **Territorial Planning Report:** 
    *   Zoning recommendations and land-use conflict analysis
    *   Compatibility assessment with Territorial Planning Determinants
    *   Opportunity cost analysis by land use category
    *   Priority area distribution across municipalities and CARs

5.  **Ethnic Territory Consultation Report:** 
    *   Analysis of conservation priorities intersecting with indigenous reservations and community councils
    *   Consultation requirements under Colombian law and ILO Convention 169
    *   Cultural significance assessment
    *   Recommendations for community engagement

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
| **Vector Rendering for Management Figures** | ☐ Required | Section 4.1 | Protected Areas, OMECs, and management figures must be displayed as vector polygons (not rasters) for precision at all scales |

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
| **Explicit Tradeoff Analysis Report** | ☐ Required | Section 4.5 (Report #1) | Full detailed report with GAINS section (conservation goals, species, ecosystem services) and LOSSES/COSTS section (opportunity cost, human footprint, development restrictions, conflict exposure) with comprehensive narrative analysis |
| **Quantitative Regional vs. National Contribution** | ☐ Required | Section 4.3.1, 4.3.2.F, 4.8.8 | National Contribution Calculator in both Solution Overview Panel (overall solution level) and AOI Dashboard (regional level). Includes comparative statistics table showing AOI vs. national distribution with template-based significance classification |
| **Template-Based Text Generation with Thresholds** | ☐ Required | Section 4.3.1, 4.3.2.F, 4.8.8 | Example thresholds specified for opportunity cost ($200M/$500M), human footprint (30%/60%), goal achievement (90%/75%/50%), species protection (8/5 groups), regional significance (10%/5%/2% of national distribution). Thresholds are examples for team refinement |
| **Goal Unmet Explanations** | ☐ Required | Section 4.5 (Report #1) | Narrative analysis must explain WHY goals are unmet: insufficient ecosystem in territory, cost constraints, or optimization trade-offs prioritizing other features |
| **Conflict and Pressure Mapping Layer** | ☐ Required | Section 4.3.1, 4.5 | Explicit visualization and analysis of high-priority conservation areas overlapping with high development pressure, human footprint, and conflict zones in both sidebar summaries and detailed reports |

**Verification Status:** All stakeholder-requested granular specifications, including analytical narrative features, are explicitly documented in the MDD and ready for implementation.

---

# Part 5: Data Dictionary & Glossary

### 5.1. Core Entities

**Planning Unit**
The fundamental spatial unit of analysis (grid cell or polygon). All data is summarized to this unit.

**Theme (Conservation Feature)**
A biological or physical feature to be protected (e.g., "Cloud Forest", "Spectacled Bear Habitat").
*   **Goal:** The target percentage (0-100%) of this feature to protect.

**Weight (Influence Factor)**
A socio-economic or physical layer that acts as a cost or benefit (e.g., "Land Cost", "Distance to Roads").
*   **Factor:** An importance value (-100 to +100). Negative avoids the feature; Positive prefers it.

**Include (Constraint)**
Areas that *must* be included in the solution (e.g., Existing National Parks).

**Exclude (Constraint)**
Areas that *must not* be included in the solution (e.g., Urban Centers).

**Solution (Scenario)**
A single pre-calculated result showing selected Planning Units. Defined by the specific combination of Goals, Weights, and Constraints used to generate it.

### 5.2. Optimization Terminology

**Minimum Set:** An optimization objective that minimizes total cost while meeting all conservation goals.
**Minimum Shortfall:** An optimization objective that maximizes goal achievement within a fixed budget.
**Boundary Penalty (Clustering):** A mathematical penalty applied to the perimeter of the solution to encourage compact, connected shapes.
**Optimality Gap:** The allowable margin of error for the solver (e.g., 10%), used to reduce computation time while ensuring high-quality results.
