# Additional Features & Gap Analysis
*Gap Analysis & Implementation Guide*

This document outlines the **delta** between the current application state and the desired deliverable version. It serves two purposes:
1.  **Team Approval (Part 1):** Detailed feature definitions, user flows, and scope boundaries.
2.  **Developer Spec (Part 2):** Technical architecture and data schemas (Team can skip this).

---

## Part 1: Feature Specification & User Experience (Team Review Required)

### 1.1. The Core Pivot: "Pre-Calculated Exploration"
**The Constraint:** Optimization runs take ~24 hours. Real-time analysis is impossible for the general public.
**The Solution:** A "Solution Discovery" interface instead of a "Solution Generator."

**New User Flow (The "Discovery" Paradigm):**
1.  **User Input:** The user sets their preferences using sliders (e.g., "I want 30% Species Protection" and "Avoid High Cost Areas").
2.  **Pre-run Solution Finder:** The system does *not* run a new optimization. Instead, it searches a library of pre-run solutions to find the **"Best Fit"**.
3.  **Feedback:** The system tells the user something like: *"We found a solution that matches 95% of your criteria."*
4.  **Analysis:** The user can then explore this matched solution using the AOI and Narrative tools.

### 1.2. Detailed User Flows by Persona

#### A. The "Open User" (Public / Non-Technical)
*Goal: Understand conservation priorities in their region.*
1.  **Landing:** Sees national map.
2.  **Discovery:** Uses the **Solution Finder** to define their priorities (e.g., "High Biodiversity"). The system instantly matches them to the best pre-run solution. (See Section 1.3.C for details).
3.  **Context & Comparison:**
    -   Clicks "About this Solution" to read a narrative explanation (Pros/Cons).
    -   Clicks "Compare" to see this solution side-by-side with a "Baseline" solution. We can either set a fixed "Baseline" solution, or set a default and let the user change the "Baseline" to do AB comparisons.
4.  **Filtering:** Uses **AOI Toolkit** to select their municipality or SIRAP.
5.  **Deep Dive:** Uses the **AOI Dashboard** to see specific stats for their region (Post-Hoc Analytics).
6.  **Report:** Downloads a PDF summary for that municipality.

**🚩 TEAM FEEDBACK REQUEST:**
*   **Specific Statistics:** What specific statistics should appear in the "About this Solution" pop-up for the general public?
*   **Comparison Complexity:** Is a "Difference Map" (showing conflict areas) too complex for the public? Should we stick to a simple "Swipe" tool?
*   **Metrics:** Should we show "Area Protected (km²)" or "% of Municipality Protected"? Which is more meaningful for a non-technical user?

#### B. The "Decision Maker" (Regional Planner)
*Goal: Tailored analysis for planning.*
1.  **Login:** Authenticates.
2.  **Solution Comparisons:** Access to advanced "Difference Maps" (Overlaps/Conflicts) and comparative statistics tables.
3.  **Upload Custom Data:** Ability to upload local shapefiles (e.g. specific project boundaries) to overlay on the national map.
4.  **Advanced AOI:** Draw custom AOI polygons rather than just selecting predefined municipalities.
5.  **Export:** Download raw spatial data (Shapefile/GeoTIFF) for use in desktop GIS.

**🚩 TEAM FEEDBACK REQUEST:**
*   **Role Definition:** The feedback requested a "Decision Maker" tier (Tier 2) distinct from the Public. However, we have moved most analysis tools (Comparison, AOI Dashboard) to the Public tier for transparency.
*   **Question:** What specific features should be reserved for this Tier 2 user?
    *   Is it access to sensitive/hidden data layers?
    *   Is it the ability to upload their own Shapefiles?
    *   Is it "Advanced Filters" in the Solution Finder (e.g., filtering by specific constraints)?

#### C. The "Conceptual Manager" (Technical Admin)
*Goal: Manage the library of solutions.*
1.  **Queue Management:** Accesses a "Solution Request" dashboard.
2.  **Requesting New Runs:**
    -   Defines a new set of parameters (e.g., "2025 Updated Road Network").
    -   Submits the request to the **Calculation Queue**.
    -   System estimates time (e.g., "Ready in 24 hours").
3.  **Publication:** Once the run is complete, the Manager "Publishes" it to the library, making it available for the "Solution Finder" to match against.

### 1.3. Key UI Components (Functional Requirements)

#### A. The AOI Summary Dashboard (Detailed Specs)
*Trigger: User selects a region.*
*Goal: Provide "Post-Hoc Analytics" as requested.*

**Specific Data Points Requested:**
The following metrics are explicitly extracted from the feedback document.

| Category | Metric | Proposed Visualization | Data Source |
| :--- | :--- | :--- | :--- |
| **Biodiversity** | **Species Richness** (by taxonomic group) | Bar Chart | Raster Sum |
| | **Threatened Species** | Count (Red highlight) | Species Range Overlay |
| | **Biomes/Ecosystems** | Donut Chart (% covered) | Vector/Categorical |
| **Eco-Services** | **Biomass (Above/Below)** | Stat Card (tCO2e/ha) | Biomass Raster |
| | **Water Supply** | Stat Card (Index/m³) | Water Supply Raster |
| **Land Use** | **Human Footprint** | Gauge (Index) | HFI Raster |
| | **Ag. Rent/Incomes** | Currency Value | Econ Raster |
| **Protected Areas** | **Existing PAs** | List/Count | Vector Overlay |
| **Context** | **National Contribution** | Text: *"This AOI contains 15% of Colombia's total carbon stocks."* | Calculated vs Global |

**🚩 TEAM FEEDBACK REQUEST:**
*   **Verification:** Please review the table above. Are we missing any critical metrics or mis-categorizing any data?

#### B. Solution Comparison Module ("Map Arithmetic")
*Trigger: "Compare" button.*

**Specific Outputs Requested:**
1.  **Side-by-Side Map:** Dual-map interface.
2.  **Overlap Analysis Layer (Optional):**
    -   **Agreement (Green):** Selected in both.
    -   **Conflict (Orange/Blue):** Selected in only one.
    -   **Synergy (Purple):** Not prioritized but "connects high-priority areas" (Corridors).
3.  **Comparative Statistics Table:**
    -   Rows: Total Area, Key Species Coverage, Opportunity Cost.
    -   Cols: Solution A, Solution B.

**🚩 TEAM FEEDBACK REQUEST:**
*   **Defining "Synergy":** The feedback mentions "areas positioned to connect high-priority areas." Do we have a specific algorithm/metric for this connectivity, or should we focus on visual overlap for V1?
*   **Opportunity Cost:** What specifically constitutes "Opportunity Cost" in the table? Is it strictly financial (Ag Rent) or does it include social conflict?

#### C. The "Solution Finder" (or "Selection Grid")
*Replacing the "Run Optimization" panel.*

**Functional Specs:**
-   **Sliders (Priorities):** Adjusts goals for Themes (e.g., "Species", "Ecosystems") and importance for Weights (e.g., "Cost", "Connectivity").
-   **Toggles (Constraints):** Filters for solutions that used specific Includes/Excludes (e.g., "Must include Jaguar Corridor").
-   **Logic:** "Nearest Neighbor" search against the Pre-run Library.
-   **Output:**
    -   **Result List:** System displays the top N closest solution matches.
    -   **Best Fit:** Map updates to the #1 match.
    -   **Match Quality Badge:** *"This solution meets your Species goal (30%) but exceeds your Cost limit by 5%."*

**🚩 TEAM FEEDBACK REQUEST:**
*   **Advanced Options:** Which specific sliders and toggles should be collapsed within "Advanced Search Options"? [INSERT LINK TO DOCUMENT WITH LIST OF OPTIONS HERE]

#### D. Detailed Thematic Report Generation
*New Feature for Tier 2 (Decision Makers).*
*Trigger: "Generate Report" button.*

These reports provide specialized views of the data for specific planning contexts.

1.  **Ecosystem Assessment Report:** 
    *   **Purpose:** Inform ecosystem-focused decisions.
    *   **Content:** Detailed breakdown of ecosystems present in the AOI, percentage protected vs. at risk.
2.  **Connectivity Report:** 
    *   **Purpose:** Identify corridors for protected area networks.
    *   **Content:** Map of connectivity corridors, identification of key linkage areas.
3.  **Species Conservation Report:** 
    *   **Purpose:** Identify important areas for focal species.
    *   **Content:** List of focal species, maps of critical habitat within the AOI.
4.  **Territorial Planning Report:** 
    *   **Purpose:** Support "environmental land use planning" and management plans (POMCAs/PNN).
    *   **Content:** (To be defined - likely zoning recommendations).

**🚩 TEAM FEEDBACK REQUEST:**
*   **Report Specifics:** We need concrete details for these reports.
    *   For the **Territorial Planning Report**: What specific data points constitute "planning inputs"? Is it zoning conflicts? Land use recommendations?
    *   For **Connectivity**: Do we have a pre-calculated "Connectivity" layer to report on, or is this derived from the solution?

#### E. Future / Tier 3 Features (Lower Priority)
*   **Conflict & Pressure Mapping:** Visualizing "Uncertainty" or "Conflict Hotspots" (e.g., areas with high conservation value AND high mining pressure).
*   **Offline Mode:** Field access without internet.
*   **Partner Logos:** Custom branding options.

---

## Part 2: Technical Implementation & Developer Spec (For Development Team)
*Technical architecture details for the web developer.*

### 2.1. Data Architecture for "Solution Finder"
**Requirement:** Efficiently search thousands of pre-run solutions.
**Implementation:**
-   **Vector Database / KNN Search:** Store solution metadata (goal achievements, total cost) as vectors.
-   **Query:** When user moves sliders, perform a K-Nearest Neighbors search to find the `solution_id` with the smallest Euclidean distance to the user's desired vector.
-   **Frontend State:** The "Map" component subscribes to the `active_solution_id`.

### 2.2. Optimization Pipeline ("The Queue")
**Architecture for the 24-hour runs:**
1.  **UI (Manager):** "Request Run" form -> POST `/api/jobs`.
2.  **API:** Validates params -> Inserts into `job_queue` (Redis) -> Returns `job_id`.
3.  **Worker (Python/Celery):**
    -   Picks up job.
    -   Launches `prioritizr` process (R script).
    -   Updates `job_status` to "Processing".
4.  **Completion:**
    -   Worker saves Result Raster to S3/MinIO.
    -   Worker calculates summary stats -> DB.
    -   Email notification sent to Manager.

### 2.3. Tech Stack Migration (React)
-   **Frontend:** React + Vite + Tailwind.
-   **State Management:** Zustand (Global Store for "Active Solution", "User Preferences").
-   **Mapping:** MapLibre GL JS (Vector Tiles for performance).
-   **Backend:** Python FastAPI (Auth, Queue Management, KNN Search).
