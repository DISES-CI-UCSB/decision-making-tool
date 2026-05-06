# AI-Generated Mockup Prompts for Conservation Decision Support Tool

*Based on MASTER_DESIGN_DOCUMENT.md*  
*Generated: December 17, 2025*

---

## How to Use These Prompts

1. Copy the entire prompt for the component you want to visualize
2. Paste into Gemini, DALL-E, Midjourney, or similar AI image generator
3. Add `--ar 16:9` (or similar) if your tool supports aspect ratio control
4. For mockups with text, you may need to manually overlay labels afterward since AI text generation can be inconsistent

---

## TIER 1: Critical for Stakeholder Validation

### 1. Solution Overview Panel (Right Sidebar)

**Component Reference:** MDD Section 4.3.1  
**Complexity:** High - 17 unique metrics, nested sections, trade-off framework

**Prompt:**

```
Create a high-fidelity UI mockup of a conservation planning application's "Solution Overview Panel" displayed in a right sidebar. This is a professional GIS/environmental planning tool interface.

LAYOUT & STRUCTURE:
- Right sidebar panel, approximately 400px wide
- Clean, modern design with card-based sections
- Scrollable content area with clear visual hierarchy
- White/light gray background with section dividers

HEADER SECTION:
- Title: "Conservation Scenario Overview"
- Scenario name: "Cloud Forest Protection - 30% Target"
- Match quality badge: "95% Match" in green pill badge
- Small metadata line: "Last updated: Nov 2024"

SECTION A - OPTIMIZATION PARAMETERS (Collapsible):
- Show 8-12 aggregated conservation groups with expandable details:
  * "Mammal Species: 30% (15 of 50 species protected)" with green checkmark
  * "Cloud Forest Ecosystems: 32% protected (Goal: 30%)" with progress bar
  * "Threatened Amphibians: 25% (8 of 32 species)" with yellow indicator
- Small expand/collapse arrows next to each group
- Use icons: paw print for mammals, tree for forests, frog for amphibians

SECTION B - SPATIAL SUMMARY (Cards):
- Three horizontal stat cards showing:
  * "Total Priority Area: 125,000 km² (12% of Colombia)"
  * "Number of Priority Zones: 342 patches"
  * "Avg Patch Size: 365 km²"

SECTION C - GAINS VS. LOSSES FRAMEWORK (Most Important):
This is the critical trade-off section with two distinct subsections:

**GAINS (What You Get)** - Green accent color:
- Heading with green checkmark icon
- 3-4 stat cards with icons:
  * "Conservation Goals Met: 8 of 10 themes" with trophy icon
  * "Carbon Storage: 2.5B tCO2e" with leaf icon
  * "Water Regulation: High capacity" with water droplet icon
  * "Threatened Species Secured: 45 species" with shield icon
- Auto-generated green text box: "This scenario achieves HIGH biodiversity protection with 9 species groups meeting conservation targets and EXCELLENT ecosystem service provision with 2.5 billion tCO2e carbon storage secured."

**LOSSES/COSTS (What You Lose)** - Orange/amber accent color:
- Heading with warning triangle icon
- 3-4 stat cards with icons:
  * "Agricultural Opportunity Cost: $350M USD" with dollar sign icon
  * "Human Footprint Overlap: 15% of priority areas" with footprint icon
  * "Conflict Zone Overlap: 8,200 km²" with alert icon
  * "Development Restrictions: 95,000 km²" with construction cone icon
- Auto-generated amber text box: "This scenario incurs MODERATE economic impact with $350M USD in agricultural opportunity cost and 15% of priority areas overlap with moderate-to-high human pressure zones requiring careful implementation planning."

SECTION D - NATIONAL CONTRIBUTION:
- Large progress bar showing: "Contributing 40% toward Colombia's 30% conservation target"
- Visual: horizontal progress bar (40% filled in blue)
- Text: "This solution protects 12% of Colombia's territory"

SECTION E - ACTION BUTTONS (Bottom):
- Primary button: "See Full Summary Report"
- Secondary buttons: "Compare Scenarios" | "Download Data"

STYLE:
- Professional GIS tool aesthetic (think ArcGIS Online or QGIS)
- Conservation green (#2E7D32) and earth tones
- Clean typography (Inter or Roboto)
- Subtle shadows on cards
- Use real icons (not generic placeholders)
- Data visualization elements (progress bars, mini charts)
```

---

### 2. AOI Dashboard (Right Sidebar)

**Component Reference:** MDD Section 4.3.2  
**Complexity:** Very High - 47 unique metrics across 8 categories

**Prompt:**

```
Create a high-fidelity UI mockup of a conservation planning application's "AOI Dashboard" (Area of Interest Analytics) displayed in a right sidebar. This shows detailed regional statistics for a selected municipality or department.

LAYOUT & STRUCTURE:
- Right sidebar panel, approximately 400px wide
- Scrollable content with tabbed or accordion sections
- Clean, data-rich interface with multiple chart types
- White/light gray background

HEADER:
- Region name: "Municipality of Popayán, Cauca"
- Region type badge: "Municipality"
- Total area: "512 km²"
- Back/close button at top-right

SECTION TABS (Horizontal tabs at top):
- "Overview" (active) | "Biodiversity" | "Ecosystem Services" | "Land Use" | "Protection Status"

OVERVIEW TAB CONTENT (Showing):

**Regional Conservation Summary:**
- Large stat card: "Priority Area: 230 km² (45% of region)"
- Progress bar showing 45% filled
- Secondary stat: "12 priority conservation zones"

**Quick Stats Grid (2x2 cards):**
- "Species Richness: 245 species" with wildlife icon
- "Carbon Stored: 85M tCO2e" with leaf icon
- "Ag. Opportunity Cost: $125M" with dollar icon
- "Human Footprint: Moderate (42/100)" with footprint icon

**Biodiversity Metrics:**
- Horizontal bar chart showing species richness by taxonomic group:
  * Mammals: 48 species (bar length proportional)
  * Birds: 127 species (longest bar)
  * Amphibians: 32 species
  * Reptiles: 28 species
  * Plants: 10 species
- Each bar color-coded by group
- Comparison marker showing "national average" as a vertical line

**Threatened Species Badge:**
- Red alert badge: "5 Critically Endangered species present"
- Small list: "Spectacled Bear, Yellow-eared Parrot, Lehmann's Poison Frog..."

**Ecosystems Breakdown:**
- Donut chart showing ecosystem distribution:
  * Cloud Forest: 35% (blue-green)
  * Paramo: 20% (purple)
  * Dry Forest: 25% (tan)
  * Wetlands: 10% (teal)
  * Other: 10% (gray)
- Legend with km² values next to each

**CRITICAL SECTION - Regional vs. National Contribution:**
- Large heading: "Regional Contribution to National Goals"
- Visual progress indicator: "This region contributes 12% toward national 30% target"
- Comparative table (3 columns: Feature | Regional | National | Significance):
  
  | Feature | Regional Distribution | National Total | Significance |
  |---------|----------------------|----------------|--------------|
  | Cloud Forest | 2,500 km² (15% of AOI) | 16,800 km² | **15%** of national |
  | Paramo | 800 km² (5% of AOI) | 4,000 km² | **20%** of national |
  | CE Species | 5 species | 32 species | **16%** of national |
  | Carbon | 85M tCO2e | 1.2B tCO2e | **7%** of national |

- Bar charts showing regional % of national total (horizontal bars with percentages)
- Color coding: Green for above-average, Yellow for average, Red for below-average

**Auto-Generated Narrative Text Box (Bottom):**
- Light blue background box with text:
"This municipality is a CRITICAL national contributor, containing 15% of Colombia's cloud forests and 20% of paramo ecosystems. It supports 5 critically endangered species (16% of national total) and stores 85M tCO2e (7% of national carbon stocks). Priority areas serve dual functions: protecting above-average biodiversity while maintaining water regulation for 2.5M downstream residents."

ACTION BUTTONS (Footer):
- "Generate Regional Report (PDF)"
- "Export Regional Data"
- "Export Map Image"

STYLE:
- Professional data dashboard aesthetic
- Rich with charts, tables, and data visualizations
- Conservation color palette (greens, blues, earth tones)
- Clear visual hierarchy with section headers
- Mix of stat cards, charts (bar, donut), and tables
- Icons for each metric category
```

---

### 3. Solution Finder Modal ("Selection Grid")

**Component Reference:** MDD Section 4.2  
**Complexity:** High - Novel interaction pattern with sliders, toggles, and instant matching

**Prompt:**

```
Create a high-fidelity UI mockup of a large modal dialog for a conservation planning application called "Solution Finder" (also referred to as "Selection Grid"). This is the primary tool users use to discover conservation scenarios by setting priorities.

LAYOUT & STRUCTURE:
- Large centered modal overlay (approximately 1200px wide x 800px tall)
- Dark semi-transparent backdrop behind modal
- Modal has white background with rounded corners
- Header, main content area, and footer sections

HEADER:
- Title: "Find a Conservation Scenario"
- Subtitle: "Define your priorities to discover the best-matching conservation solution"
- Close button (X) at top-right

MAIN CONTENT AREA (3-column layout or tabbed):

**LEFT COLUMN - CONSERVATION THEMES (Goals):**
- Section heading: "Conservation Targets"
- 6-8 conservation features listed vertically, each with:
  * Feature name (e.g., "Jaguar Habitat", "Cloud Forest Ecosystems", "Wetland Protection")
  * Target percentage selector: Pills/buttons showing "17%", "30%", "34%", "Custom"
  * Visual indicator showing alignment with global targets (small "30x30 initiative" badge)
- Example features shown:
  * "Mammal Species" - 30% selected (highlighted in blue)
  * "Cloud Forest" - 32% selected
  * "Threatened Amphibians" - 25% selected
  * "Paramo Ecosystems" - 30% selected
  * "Wetlands" - 17% selected
- Each feature has a small icon (paw, tree, frog, mountain, water drop)

**MIDDLE COLUMN - WEIGHTS (Cost/Benefit Layers):**
- Section heading: "Priorities & Trade-offs"
- 4-6 slider controls for importance weighting (-100 to +100 scale):
  * "Agricultural Opportunity Cost" slider at -80 with red gradient (Avoid)
  * "Connectivity to Protected Areas" slider at +60 with green gradient (Prefer)
  * "Human Footprint" slider at -40 (slightly avoid)
  * "Carbon Storage Potential" slider at +70 (strong preference)
  * "Water Regulation Importance" slider at +50
- Each slider has labeled presets: "Avoid" (-100) | "Neutral" (0) | "Prefer" (+100)
- Color coding: Red gradient for negative (avoid), green for positive (prefer), gray for neutral

**RIGHT COLUMN - CONSTRAINTS (Optional):**
- Section heading: "Includes & Excludes"
- Toggle switches (binary On/Off):
  * "Must include existing National Parks" - Toggle ON (green)
  * "Exclude urban centers >10k population" - Toggle ON
  * "Must connect protected areas" - Toggle OFF (gray)
  * "Exclude mining concessions" - Toggle OFF
- Each toggle has a small lock (include) or ban (exclude) icon

**BOTTOM SECTION - RESULTS PREVIEW:**
- Horizontal divider line
- Heading: "Top Matching Scenarios"
- 3-4 scenario result cards displayed horizontally:
  * Each card shows:
    - Small preview map thumbnail (grayscale with green conservation areas)
    - Scenario name: "Cloud Forest Protection - 30% Target"
    - Match percentage badge: "95% Match" in large green pill
    - Brief description: "Prioritizes high-elevation ecosystems with moderate cost"
    - "Apply Scenario" button (blue)
- Currently matched scenario has blue highlight border
- "View More Results" link at end

**WARNING/FEEDBACK AREA (if needed):**
- Small yellow alert box above results:
  "These settings may result in low-quality matches. Consider adjusting wetland targets or reducing connectivity weight."

FOOTER:
- Left side: "Need help?" link
- Right side: Two buttons:
  * "Reset to Default" (ghost button)
  * "Apply Selected Scenario" (primary blue button)

STYLE:
- Modern, clean modal design
- Conservation green accent color (#2E7D32)
- Blue for selected/active states
- Sliders with gradient backgrounds (red to green)
- Clean typography with good spacing
- Interactive elements clearly indicated (hover states visible)
- Professional GIS tool aesthetic
- Real-time feedback indicators (match % updates as user adjusts)
```

---

### 4. Trade-off Analysis Report (Full Multi-Page PDF/Page View)

**Component Reference:** MDD Section 4.5, Report #1  
**Complexity:** High - Multi-page layout with Gains/Losses framework, charts, maps, narrative text

**Prompt:**

```
Create a high-fidelity mockup showing a multi-page "Trade-off Analysis Report" for a conservation planning tool. Show this as a full-page view within the application (or as a PDF preview) with 3-4 visible pages in a vertical scrollable layout.

LAYOUT & STRUCTURE:
- Full-page report view (8.5" x 11" or A4 page proportions)
- Professional report design with header/footer on each page
- White background with margins
- Pages shown in vertical scroll sequence

REPORT HEADER (All Pages):
- Small logo/app name: "Conservation Decision Support Tool - Colombia"
- Report title: "Trade-off Analysis Report"
- Scenario name: "Cloud Forest Protection - 30% Target"
- Generated date: "November 15, 2024"
- Selected perspective badge: "Conservationist Perspective" (or "Regional Planner", "Economist", etc.)

PAGE 1 - EXECUTIVE SUMMARY & SCENARIO OVERVIEW:

**Scenario Identity Card:**
- Scenario name and ID
- Match quality: "95% Match to your priorities"
- Date created
- Small summary map showing priority areas in green on Colombia outline

**Optimization Parameters Table:**
- Table showing themes, goals, and achievement:
  | Conservation Feature | Target Goal | Achieved | Status |
  |---------------------|-------------|----------|--------|
  | Mammal Species | 30% | 32% | ✓ Met |
  | Cloud Forest | 30% | 35% | ✓ Met |
  | Threatened Amphibians | 25% | 22% | ✗ Unmet |
  | Paramo Ecosystems | 30% | 28% | ✗ Unmet |
  | Wetlands | 25% | 18% | ✗ Unmet |

**Spatial Summary:**
- Stat cards in horizontal row:
  * Total Priority Area: 125,000 km²
  * % of Colombia: 12%
  * Number of Zones: 342 patches
  * Largest Zone: 2,450 km²

PAGE 2 - GAINS (WHAT YOU GET):

**Large Section Heading with Green Accent:**
"Conservation Gains: What This Scenario Achieves"

**Conservation Goals Met:**
- Visual checkmark grid showing achieved targets
- 8 of 10 themes shown with green checkmarks

**Species & Biodiversity Protected:**
- Bar chart: "Species Groups with Adequate Habitat Protection"
- Shows 9 species groups with horizontal bars
- "45 Threatened Species Secured" highlighted in badge

**Ecosystem Services Secured:**
- Three large stat cards:
  * Carbon Storage: 2.5B tCO2e (with line chart showing contribution by region)
  * Water Regulation: 8M beneficiaries downstream
  * Connectivity: 15 corridors linking protected areas
- Small map showing connectivity corridors in purple

**Auto-Generated Narrative Text (Green-bordered box):**
"This scenario achieves HIGH biodiversity protection with 9 species groups meeting conservation targets. EXCELLENT ecosystem service provision is secured with 2.5 billion tCO2e carbon storage and water regulation for 8 million downstream residents. The solution successfully creates 15 connectivity corridors between existing protected areas, enhancing landscape-level conservation."

PAGE 3 - LOSSES/COSTS (WHAT YOU LOSE):

**Large Section Heading with Orange/Amber Accent:**
"Costs & Trade-offs: What This Scenario Requires"

**Agricultural Opportunity Cost:**
- Large stat card: $350M USD
- Bar chart showing cost by department/region
- Pie chart: "Affected Agricultural Land: 25,000 km² by crop type"
  * Pasture: 60%
  * Crops: 30%
  * Mixed: 10%

**Human Footprint Overlap:**
- Stat card: "15% of priority areas in moderate-high pressure zones"
- Histogram showing Human Footprint distribution:
  * Low (0-20): 60% of area
  * Moderate (21-50): 25%
  * High (51-80): 12%
  * Very High (81-100): 3%
- Map showing human pressure overlay on conservation priorities

**Conflict & Implementation Challenges:**
- Stat card: "8,200 km² overlap with historical conflict zones"
- Stat card: "5 Indigenous territories require prior consultation"
- Small map showing conflict zones in orange overlay

**Auto-Generated Narrative Text (Amber-bordered box):**
"This scenario incurs MODERATE economic impact with $350M USD in agricultural opportunity cost representing 12% of regional agricultural GDP. 15% of priority areas overlap with moderate-to-high human pressure zones, requiring careful restoration approaches. Conservation priorities overlap with 8,200 km² of historical conflict zones and 5 indigenous territories, necessitating extensive community engagement and consultation processes under ILO Convention 169."

PAGE 4 - INTEGRATED SYNTHESIS & RECOMMENDATIONS:

**Overall Trade-off Summary:**
- Side-by-side comparison chart:
  * Left side (green): Biodiversity gains, ecosystem services
  * Right side (orange): Economic costs, implementation challenges
- Dual-axis chart showing "Biodiversity Achievement vs. Economic Cost"

**Key Trade-offs Statement (Large, Bold Text):**
"This scenario prioritizes high-elevation ecosystems (cloud forests, paramo) at moderate economic cost, achieving excellent carbon and water outcomes while requiring careful navigation of land-use conflicts in 15% of priority areas."

**Why Goals Were Unmet (Critical Section):**
- Text explaining unmet targets:
  "Wetland conservation goals (18% vs. 25% target) were not met due to: (1) High agricultural opportunity cost in lowland wetland areas ($180M), (2) Optimization prioritizing high-elevation ecosystems with greater carbon storage and water regulation benefits, (3) Limited available wetland area outside existing protected areas in high-priority watersheds."

**Implementation Recommendations (Bulleted List):**
- "Prioritize community consultation in 5 indigenous territories before implementation"
- "Develop restoration plans for 25,000 km² of converted agricultural land"
- "Establish monitoring protocols in 8,200 km² conflict-sensitive zones"
- "Coordinate with 12 CARs (environmental authorities) for regional implementation"

**National Contribution Summary:**
- Large progress bar: "This solution contributes 40% toward Colombia's 30% conservation target"
- Text: "Protecting 12% of Colombia's territory"
- Small table showing contribution by ecosystem type

FOOTER (All Pages):
- Page numbers
- Small disclaimer: "Generated by Conservation Decision Support Tool - Colombia"

STYLE:
- Professional report design (think World Bank or UN report aesthetic)
- Clean, readable typography (serif for body text, sans-serif for headings)
- Conservation color palette: Green for gains, orange/amber for costs, blue for neutral
- Mix of data visualizations: bar charts, pie charts, maps, tables, stat cards
- Text boxes with colored borders for narrative sections
- Clear visual hierarchy with section dividers
- Print-friendly (black text on white, colorblind-safe palette)
```

---

## TIER 2: Important for Development Clarity

### 5. Scenario Comparison Panel (Right Sidebar)

**Component Reference:** MDD Section 4.3.3  
**Complexity:** Medium - Side-by-side metrics with difference calculations

**Prompt:**

```
Create a high-fidelity UI mockup of a "Scenario Comparison Panel" displayed in a right sidebar for a conservation planning application. This shows side-by-side analysis of two conservation scenarios to support trade-off decisions (Tier 2 users only).

LAYOUT & STRUCTURE:
- Right sidebar panel, approximately 400px wide
- Scrollable content area
- Clean comparison layout with clear visual separation between scenarios

HEADER:
- Title: "Scenario Comparison"
- Two scenario labels side-by-side:
  * "Scenario A: Cloud Forest Focus" (left, blue accent)
  * "Scenario B: Biodiversity Maximum" (right, purple accent)
- Each with match quality badge: "95% Match" and "88% Match"
- Small "Switch" icon button between them to swap A/B

COMPARATIVE STATISTICS TABLE (Primary Content):
- Large comparison table with 3 columns: Metric | Scenario A | Scenario B | Difference
- Key metrics shown:

| Metric | Scenario A | Scenario B | Difference |
|--------|-----------|-----------|------------|
| **Total Priority Area** | 125,000 km² | 98,000 km² | -27,000 km² ↓ |
| **% of Colombia** | 12% | 9% | -3% ↓ |
| **Species Goals Met** | 8 of 10 | 9 of 10 | +1 ↑ |
| **Carbon Stored** | 2.5B tCO2e | 2.1B tCO2e | -400M ↓ |
| **Opportunity Cost** | $450M | $320M | -$130M ↓ |
| **Human Footprint** | 42 | 38 | -4 ↓ |
| **Conflict Exposure** | 8,200 km² | 5,100 km² | -3,100 km² ↓ |

- Difference column has color coding:
  * Green for improvements (lower cost, less conflict)
  * Red for trade-offs (lower carbon, less area)
  * Gray for neutral
- Up/down arrow indicators next to difference values

THEME ACHIEVEMENT COMPARISON:
- Side-by-side checklist showing conservation features:
  * Left column (Scenario A): Checkmarks and X marks
  * Right column (Scenario B): Checkmarks and X marks
  * Highlighted differences (where one meets goal and other doesn't)
- Example:
  | Feature | Scenario A | Scenario B |
  |---------|-----------|-----------|
  | Mammals | ✓ 32% | ✓ 35% |
  | Cloud Forest | ✓ 35% | ✓ 28% |
  | Wetlands | ✗ 18% | ✓ 27% |

SPATIAL OVERLAP ANALYSIS:
- Heading: "Spatial Agreement & Conflict"
- Three large stat cards with icons:
  * "Agreement: 65,000 km²" with green checkmark icon (areas in both)
  * "Unique to Scenario A: 60,000 km²" with blue circle icon
  * "Unique to Scenario B: 33,000 km²" with purple circle icon
- Small Venn diagram visualization showing overlap
- Stat: "Synergy Zones: 12 corridors" with purple network icon

AUTO-GENERATED TRADE-OFF NARRATIVE:
- Light gray text box with auto-generated summary:
  "Scenario A protects more area (+27,000 km²) and stores more carbon (+400M tCO2e) but has higher opportunity cost (+$130M) and greater conflict exposure (+3,100 km²). Scenario B achieves one additional species goal while reducing economic and social implementation costs, making it more feasible for near-term implementation."

MAP LEGEND REFERENCE:
- Small legend box showing difference map colors:
  * Green: Agreement (both scenarios)
  * Blue: Unique to Scenario A
  * Purple: Unique to Scenario B
  * Orange: Synergy/Connectivity zones
- Note: "See map for spatial visualization"

ACTION BUTTONS (Footer):
- "Generate Comparison Report (PDF)"
- "Export Comparison Data"
- "Exit Comparison Mode"

STYLE:
- Clean comparison layout with clear side-by-side structure
- Color coding: Blue for Scenario A, Purple for Scenario B, Green for agreement
- Professional data dashboard aesthetic
- Clear visual hierarchy
- Mix of tables, stat cards, and small visualizations
- Icons for each metric type
```

---

### 6. Map Interface + Left Sidebar (Overall App Layout)

**Component Reference:** MDD Section 4.1  
**Complexity:** Medium - Full application layout showing all three panes

**Prompt:**

```
Create a high-fidelity UI mockup of the complete application layout for a conservation planning GIS tool showing the three-pane interface: Left Sidebar (Control Dashboard), Center Panel (Interactive Map), and Right Sidebar (Analysis Dashboard).

OVERALL LAYOUT (16:9 aspect ratio):
- Three-column layout with resizable panels
- Left Sidebar: ~300px wide
- Center Panel: Flexible width (largest area)
- Right Sidebar: ~400px wide

LEFT SIDEBAR - "CONTROL DASHBOARD":

**Header:**
- App logo and title: "Conservation Tool - Colombia"
- User profile icon (top-right corner of sidebar)

**Solution Selector Section:**
- Current scenario card:
  * "Active Scenario: Cloud Forest Protection"
  * Match badge: "95% Match"
  * Small thumbnail preview map
- Large primary button: "Find a New Solution" (opens Solution Finder modal)
- Dropdown showing recent scenarios

**Layer Visibility Manager:**
- Section heading: "Map Layers"
- Search bar: "Search layers..."
- Hierarchical toggles (checkboxes) with expand/collapse:
  * ☑ Conservation Solution (bold, active)
  * ☐ Protected Areas ▼ (expanded)
    - ☑ National Parks
    - ☑ OMECs
    - ☐ Regional Reserves
  * ☐ Administrative Boundaries ▼
    - ☑ Departments
    - ☐ Municipalities
    - ☐ SIRAPs
  * ☐ Biodiversity Layers ▼
    - ☐ Species Richness
    - ☐ Threatened Species
    - ☐ Ecosystems
  * ☐ Socio-Economic ▼
    - ☐ Land Use
    - ☐ Human Footprint
    - ☐ Conflict Zones
- Filter buttons:
  * "Filter by CAR" (environmental authority)
  * "Filter by Region"

**Symbology Controls (Collapsed):**
- Collapsed section: "Symbology >" (expandable)

**Export/Report Buttons:**
- "Generate Report (PDF)"
- "Download Data"
- "Export Map Image"

CENTER PANEL - INTERACTIVE MAP:

**Map Content:**
- Interactive map of Colombia showing:
  * Base map: Light gray terrain/streets basemap
  * Conservation priority areas shown in semi-transparent green overlay
  * Existing protected areas shown as green polygons with borders
  * Administrative boundaries (department lines) in light gray
  * Colombia country outline in dark gray
  * Highlight showing "Cauca Department" selected (yellow outline)
- Zoom level showing national view with some department detail visible

**Map Controls (Overlaid on map):**
- Top-right corner:
  * Zoom +/- buttons (vertical)
  * Home/reset view button
  * Basemap selector button (toggle between satellite/streets/terrain)
- Top-left corner:
  * Search location bar: "Search for a place..."
  * Draw tools button
  * Measure tools button
- Bottom-right corner:
  * Compass rose/north arrow (small)
  * Scale bar: "0 50 100 km"
- Bottom-left corner:
  * Legend box (collapsible):
    - "Conservation Priority Areas" (green)
    - "Existing Protected Areas" (dark green outline)
    - "Selected Region" (yellow outline)
    - "Department Boundaries" (gray line)
- Coordinates display (bottom-center): "4.5° N, 75.7° W"

RIGHT SIDEBAR - "ANALYSIS DASHBOARD":

**Currently showing AOI Dashboard for selected region:**
- Header: "Municipality of Popayán, Cauca" with back button
- Tab navigation: "Overview" (active) | "Biodiversity" | "Ecosystem Services"
- Content showing:
  * Large stat card: "Priority Area: 230 km² (45% of region)"
  * Progress bar
  * 2x2 grid of quick stats with icons:
    - Species Richness: 245
    - Carbon: 85M tCO2e
    - Opportunity Cost: $125M
    - Human Footprint: 42
  * Small bar chart showing species by taxonomic group
  * Donut chart showing ecosystem distribution
- Scroll indicator showing more content below

APPLICATION HEADER (Top bar across all three panels):
- Left: App title "Conservation Decision Support Tool"
- Center: Active scenario name badge
- Right: User menu, notifications bell, help button

STYLE:
- Modern GIS application aesthetic (think ArcGIS Online, QGIS, or Felt)
- Conservation color palette: Green (#2E7D32) for priority areas, earth tones for base map
- Clean, professional interface
- Left and right sidebars on light gray/white background
- Map panel with dark controls overlaid (slight shadows for depth)
- Clear panel dividers
- Consistent iconography throughout
- Interactive elements clearly indicated
- Responsive design feel
```

---

### 7. Perspective Selection Modal

**Component Reference:** MDD Section 4.3.1, Section G  
**Complexity:** Low - Small but important modal with 5 persona choices

**Prompt:**

```
Create a high-fidelity UI mockup of a "Perspective Selection Modal" for a conservation planning application. This modal appears when a user clicks "See Full Summary Report" and prompts them to select a narrative perspective/persona that will frame the report text.

LAYOUT & STRUCTURE:
- Medium-sized centered modal overlay (approximately 700px wide x 500px tall)
- Dark semi-transparent backdrop behind modal
- Modal has white background with rounded corners
- Clear header and content area

HEADER:
- Title: "Select Report Perspective"
- Subtitle: "Choose how you'd like the report findings to be framed. All data remains the same; only the narrative emphasis changes."
- Small info icon with tooltip: "You can change perspectives later"

MAIN CONTENT - 5 PERSONA CARDS:
Display 5 perspective options as large, clickable cards in a grid (2-2-1 layout or vertical list):

**1. Regional Planner (Planificador Regional)**
- Icon: Building/government icon
- Title: "Regional Planner"
- Spanish subtitle: "Planificador Regional"
- Description: "Emphasizes territorial planning compatibility, municipal distributions, and environmental authority (CAR) jurisdictions"
- Example emphasis: "Land-use planning, administrative coordination, regional development context"

**2. Community Leader (Líder Comunitario)**
- Icon: Group of people icon
- Title: "Community Leader"
- Spanish subtitle: "Líder Comunitario"
- Description: "Emphasizes cultural territories, consultation requirements, ethnic communities, and local benefits"
- Example emphasis: "Indigenous territories, community councils, prior consultation, local livelihoods"

**3. Conservationist (Conservacionista)**
- Icon: Leaf or wildlife icon
- Title: "Conservationist"
- Spanish subtitle: "Conservacionista"
- Description: "Emphasizes species targets, ecosystem representation, biodiversity metrics, and conservation science"
- Example emphasis: "Threatened species, habitat protection, ecosystem services, ecological connectivity"

**4. Economist (Economista)**
- Icon: Chart/money icon
- Title: "Economist"
- Spanish subtitle: "Economista"
- Description: "Emphasizes opportunity costs, development restrictions, economic impacts, and cost-benefit trade-offs"
- Example emphasis: "Agricultural opportunity cost, development constraints, economic feasibility, ROI"

**5. Climate Advocate (Defensor Climático)**
- Icon: Globe/cloud icon
- Title: "Climate Advocate"
- Spanish subtitle: "Defensor Climático"
- Description: "Emphasizes carbon storage, water regulation, climate resilience, and ecosystem service provision"
- Example emphasis: "Carbon sequestration, watershed protection, climate adaptation, ecosystem services"

CARD DESIGN:
- Each card is a large clickable area with hover effect
- Currently none selected (all have light gray background)
- On hover: Blue border highlight
- On click: Selected card has blue background and white text with checkmark icon
- Each card shows:
  * Large icon at top
  * Persona title in bold
  * Spanish subtitle in smaller text
  * 2-line description
  * "Example emphasis" in italic smaller text

IMPORTANT NOTICE BOX (Below cards):
- Light blue info box with icon:
  "Note: Your perspective choice only affects how report text is framed. All metrics, charts, and data remain identical across all perspectives."

FOOTER:
- Left: "Cancel" button (ghost/text button)
- Right: "Continue to Report" button (primary blue, disabled until selection made)

STYLE:
- Clean, modern modal design
- Blue accent color for selected state
- Clear iconography for each persona
- Good spacing between cards
- Professional, inviting design
- Typography clearly distinguishes titles, subtitles, and descriptions
- Subtle shadows on modal and cards
```

---

## Notes & Best Practices

### For Best Results:

1. **Specify Text Placement:** AI image generators often struggle with text. After generation, you may need to manually add labels using Figma, Photoshop, or similar tools.

2. **Iterate on Details:** Start with the base prompt, then add specific refinements like:
   - "Make the color palette more muted/vibrant"
   - "Add more white space between sections"
   - "Make the data visualizations more prominent"

3. **Aspect Ratios:**
   - Full app layout: `--ar 16:9`
   - Sidebars: `--ar 9:16` or `--ar 2:3`
   - Modals: `--ar 4:3` or `--ar 3:2`
   - Reports: `--ar 8:11` (letter size)

4. **Style Consistency:** Add this to any prompt for visual consistency:
   ```
   Use a consistent design system throughout: Conservation green (#2E7D32), professional GIS tool aesthetic, clean typography (Inter or Roboto), subtle shadows, and clear information hierarchy.
   ```

5. **Reference Examples:** If your AI tool supports it, provide reference images:
   - "Style like ArcGIS Online"
   - "Clean dashboard like Notion or Linear"
   - "Professional report like UN or World Bank publications"

---

## Suggested Prompt for Gemini Specifically

If using Gemini, you might want to add this preamble to each prompt:

```
Generate a detailed, high-fidelity user interface mockup. Focus on realistic layout proportions, professional design aesthetics, and clear visual hierarchy. Use placeholder data that looks realistic. Ensure all UI elements are clearly visible and properly aligned. Avoid abstract or artistic interpretations—this should look like a screenshot from a real production application.
```

---

## Additional Components (If Needed Later)

If you need mockups for other components, here are starting points:

- **Solution Finder Results Grid:** Focus on the result cards showing match percentages and preview thumbnails
- **Layer Visibility Manager (Expanded):** Detailed view of the hierarchical layer toggles with filter options
- **Difference Map Visualization:** Center map panel showing Agreement/Conflict/Connectivity zones in different colors
- **Admin Dashboard:** Tier 3 queue management and solution publishing interface
- **Data Upload Interface:** Tier 2 custom shapefile upload with symbology controls

---

## Validation Checklist

After generating mockups, verify against the MDD:

- [ ] All 17 metrics visible in Solution Overview Panel
- [ ] Gains/Losses framework clearly separated with different accent colors
- [ ] AOI Dashboard shows regional vs. national comparison table
- [ ] Solution Finder has all three input types (Themes, Weights, Constraints)
- [ ] Trade-off Report has multi-page layout with both Gains and Losses sections
- [ ] Scenario Comparison shows side-by-side metrics with difference calculations
- [ ] Map interface shows all three panes with proper proportions
- [ ] Perspective Selection shows all 5 personas with descriptions

---

*Generated from MASTER_DESIGN_DOCUMENT.md*  
*Last updated: December 17, 2025*
