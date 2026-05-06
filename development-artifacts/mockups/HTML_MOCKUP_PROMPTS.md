# HTML/CSS Mockup Generation Prompts for Conservation Decision Support Tool

*Based on MASTER_DESIGN_DOCUMENT.md*  
*Generated: December 17, 2025*

---

## Why HTML Instead of AI Images?

✅ **Clean, readable text** - No garbled AI-generated text  
✅ **Pixel-perfect layouts** - Precise positioning and alignment  
✅ **Interactive elements** - Working buttons, tabs, toggles, hover states  
✅ **Easy to iterate** - Edit code directly instead of regenerating images  
✅ **Stakeholder demos** - Open in browser for realistic walkthroughs  
✅ **Dev handoff** - Can serve as starting point for actual implementation  

---

## How to Use These Prompts

1. Copy a prompt into Gemini/Claude/GPT-4
2. Get back a complete HTML file with embedded CSS
3. Save as `.html` and open in browser
4. Iterate by asking for specific changes
5. Share with stakeholders or use for design reviews

---

## Summary of Available Prompts

**Tier 1 - Critical for Stakeholder Validation (4 prompts):**
1. Solution Overview Panel (Gains/Losses framework, 17 metrics)
2. AOI Dashboard (Regional vs. national comparison, 47 metrics)
3. Solution Finder Modal (Novel interaction pattern)
4. Trade-off Analysis Report (Multi-page PDF layout)

**Tier 2 - Important for Development Clarity (4 prompts):**
5. Scenario Comparison Panel (Side-by-side analysis)
6. Full Application Layout (3-pane interface)
7. Perspective Selection Modal (5 personas)
8. Welcome/Getting Started Panel (Onboarding state)

**Total: 8 complete HTML generation prompts**

---

## TIER 1: Critical for Stakeholder Validation

### 1. Solution Overview Panel (Right Sidebar)

**Component Reference:** MDD Section 4.3.1  
**Deliverable:** Standalone HTML file showing right sidebar panel

**Prompt:**

```
Generate a complete HTML file with embedded CSS (no external dependencies) that creates a mockup of the "Solution Overview Panel" for a conservation planning application. This should look like a professional GIS tool's right sidebar.

REQUIREMENTS:
- Single HTML file with all CSS embedded in <style> tag
- Use modern CSS (Flexbox/Grid) for layout
- Responsive (but optimized for desktop 400px sidebar width)
- Use Tailwind-like utility approach OR clean semantic CSS
- Include Font Awesome CDN for icons (or use Unicode symbols)
- Clean, professional design

STRUCTURE & CONTENT:

<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Solution Overview Panel - Mockup</title>
    <!-- Include Font Awesome for icons -->
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
</head>
<body>

HEADER SECTION:
- Title: "Conservation Scenario Overview"
- Scenario name: "Cloud Forest Protection - 30% Target"
- Green pill badge: "95% Match"
- Small gray text: "Last updated: Nov 2024"

SECTION A - OPTIMIZATION PARAMETERS (Collapsible/Expandable):
- Heading with down arrow icon (collapsible)
- Show 4-5 conservation groups with expand arrows:
  * "Mammal Species: 30% (15 of 50 species protected)" - Green checkmark icon
  * "Cloud Forest Ecosystems: 32% protected (Goal: 30%)" - Yellow square icon
  * "Threatened Amphibians: 25% (8 of 32 species)" - Yellow warning icon
  * "5 more aggregated groups" - Muted text with arrow
- "Show All (12)" link at bottom

SECTION B - SPATIAL SUMMARY:
- Two stat cards side-by-side:
  * "Total Priority Area: 125,000 km²" with globe icon
    - Small progress bar showing "30%" filled in blue
    - Subtext: "Avg Patch Size: 342 patches"
  * "Number of Priority Zones (12% of Colombia)" with map marker icon
    - Subtext: "Avg Patch Size: 365 km²"

SECTION C - GAINS/LOSSES FRAMEWORK (CRITICAL):

**GAINS Section** (Green accent):
- Large heading: "✓ GAINS (What You Get)" with green checkmark
- Light green background section
- Stat cards in 2-column grid:
  * "Conservation Goals Met" - Trophy icon - "2.of 10 themes"
  * "Carbon Storage" - Leaf icon - "High capacity"
  * Additional placeholder cards

- Auto-generated narrative in green-bordered box:
  "This scenario achieves HIGH biodiversity protection with 9 species groups meeting conservation targets and EXCELLENT ecosystem service provision with 2.3 bilion tCO2e carbon storage secured"

**LOSSES/COSTS Section** (Orange accent):
- Large heading: "⚠ LOSSES/COSTS (What Yose Lou Lose)" with warning icon
- Light orange background section
- Stat cards in 2-column grid:
  * "Agricultural Opportunity Cost" - Dollar icon - "$350M USD"
  * "Human Footprint Overlap" - Footprint icon - "15% of priority areas"
  * "Conflict Zone Overlap" - Alert icon - "95,000 km²"

- Auto-generated narrative in orange-bordered box:
  "This scenario incurs MODERATE economic impact with $350M in agricultural oppotunity cost and 15% of priorates moderate-to-high hutess. ing qequirian presures"

SECTION D - NATIONAL CONTRIBUTION:
- Heading: "National Contribution"
- Text: "Contributing 40% toward Colombia's 30% conservation target"
- Progress bar (40% filled in blue)
- Subtext: "This solution protects 12% of Colombia's territory"

ACTION BUTTONS (Bottom):
- Primary green button: "See Full Summary Report"
- Two secondary gray buttons: "Compare Scenarios" | "Download Data"

CSS STYLING REQUIREMENTS:
- Color palette:
  * Primary green: #2E7D32
  * Gains green: #E8F5E9 (background), #2E7D32 (text/borders)
  * Losses orange: #FFF3E0 (background), #F57C00 (text/borders)
  * Gray tones: #F5F5F5, #E0E0E0, #757575
- Typography: System font stack (Helvetica, Arial, sans-serif) or Inter/Roboto from Google Fonts
- Card shadows: subtle box-shadow
- Rounded corners: 8px border-radius
- Spacing: consistent 16px padding/margins
- Progress bars: rounded with smooth transition
- Hover states on buttons and expandable sections

INTERACTIVE ELEMENTS (Basic JavaScript):
- Collapsible "Optimization Parameters" section (click to expand/collapse)
- Hover states on buttons
- Expandable "5 more aggregated groups" (optional)

Make this look like a professional, production-ready UI component.
```

---

### 2. AOI Dashboard (Right Sidebar)

**Component Reference:** MDD Section 4.3.2  
**Deliverable:** Standalone HTML with tabbed interface

**Prompt:**

```
Generate a complete HTML file with embedded CSS that creates a mockup of the "AOI Dashboard" (Area of Interest Analytics) for a conservation planning application. This shows detailed regional statistics and includes the critical regional vs. national comparison.

REQUIREMENTS:
- Single HTML file with all CSS and JavaScript embedded
- Use Chart.js CDN for bar/donut charts (https://cdn.jsdelivr.net/npm/chart.js)
- Include Font Awesome CDN for icons
- Tabbed interface with smooth transitions
- Responsive design (optimized for 400px sidebar)

STRUCTURE & CONTENT:

HEADER:
- Back arrow button (top-left)
- Region name: "Municipality of Popayán, Cauca"
- Badge: "Municipality" in gray pill
- Total area: "512 km²"
- Close X button (top-right)

TABS (Horizontal):
- "Overview" (active/blue underline)
- "Biodiversity"
- "Ecosystem Services"
- "Land Use"
- "Protection Status"

OVERVIEW TAB CONTENT (Default visible):

**Regional Conservation Summary:**
- Large stat card with border:
  * "Priority Area: 230 km²"
  * Subtext: "45% of region"
  * Progress bar (45% filled in green)
- Secondary stat: "12 priority conservation zones"

**Quick Stats Grid (2x2):**
Four cards with icons and values:
- "Species Richness: 245 species" - Wildlife icon
- "Carbon Stored: 85M tCO2e" - Leaf icon
- "Ag. Opportunity Cost: $125M" - Dollar icon
- "Human Footprint: Moderate (42/100)" - Footprint icon

**Biodiversity Metrics:**
- Heading: "Species Richness by Group"
- Horizontal bar chart (use Chart.js) showing:
  * Mammals: 48 species (short bar)
  * Birds: 127 species (longest bar)
  * Amphibians: 32 species
  * Reptiles: 28 species
  * Plants: 10 species
- Each bar color-coded
- Vertical line indicator: "National average"

**Threatened Species Badge:**
- Red alert card: "5 Critically Endangered species present"
- Small list: "Spectacled Bear, Yellow-eared Parrot, Lehmann's Poison Frog..."

**Ecosystems Breakdown:**
- Heading: "Ecosystem Distribution"
- Donut chart (use Chart.js) showing:
  * Cloud Forest: 35% (blue-green slice)
  * Paramo: 20% (purple)
  * Dry Forest: 25% (tan)
  * Wetlands: 10% (teal)
  * Other: 10% (gray)
- Legend with km² values

**CRITICAL SECTION - Regional vs. National Contribution:**
- Large heading: "Regional Contribution to National Goals"
- Text: "This region contributes 12% toward national 30% target"
- Progress bar (12% filled)

- Comparative Table (3 columns):
  | Feature | Regional | National | Significance |
  |---------|----------|----------|--------------|
  | Cloud Forest | 2,500 km² | 16,800 km² | **15%** 🟢 |
  | Paramo | 800 km² | 4,000 km² | **20%** 🟢 |
  | CE Species | 5 species | 32 species | **16%** 🟢 |
  | Carbon | 85M tCO2e | 1.2B tCO2e | **7%** 🟡 |

- Bar charts showing regional % of national total (horizontal bars with percentages)
- Color coding: Green (>10%), Yellow (5-10%), Red (<5%)

**Auto-Generated Narrative (Blue bordered box):**
"This municipality is a CRITICAL national contributor, containing 15% of Colombia's cloud forests and 20% of paramo ecosystems. It supports 5 critically endangered species (16% of national total) and stores 85M tCO2e (7% of national carbon stocks). Priority areas serve dual functions: protecting above-average biodiversity while maintaining water regulation for 2.5M downstream residents."

ACTION BUTTONS (Footer):
- "Generate Regional Report (PDF)"
- "Export Regional Data"
- "Export Map Image"

CSS REQUIREMENTS:
- Tab navigation with active state (blue underline)
- Card-based layout with shadows
- Chart.js styling for professional charts
- Responsive table design
- Color-coded significance indicators (green/yellow/red dots)
- Smooth tab transitions (fade in/out)

JAVASCRIPT REQUIREMENTS:
- Tab switching functionality (show/hide content divs)
- Initialize Chart.js bar and donut charts with sample data
- Animated progress bars (fill on load)
```

---

### 3. Solution Finder Modal ("Selection Grid")

**Component Reference:** MDD Section 4.2  
**Deliverable:** Full-page HTML with centered modal overlay

**Prompt:**

```
Generate a complete HTML file that creates a mockup of the "Solution Finder" modal for a conservation planning application. This is a large centered modal with interactive sliders, toggles, and scenario results.

REQUIREMENTS:
- Single HTML file with embedded CSS and JavaScript
- Modal overlay with semi-transparent backdrop
- Range sliders (HTML5 input type="range")
- Toggle switches (CSS-only, no external libraries)
- 3-column layout inside modal
- Responsive design

STRUCTURE & CONTENT:

BACKDROP:
- Semi-transparent dark overlay (rgba(0,0,0,0.6))
- Click backdrop to close modal

MODAL (Centered, 1200px wide x 800px tall):
- White background with rounded corners and shadow
- Overflow: scroll for content

HEADER:
- Title: "Find a Conservation Scenario"
- Subtitle: "Define your priorities to discover the best-matching conservation solution"
- Close button (X) at top-right

MAIN CONTENT (3 COLUMNS):

**LEFT COLUMN - Conservation Targets:**
- Heading: "Conservation Targets"
- 6 conservation features listed vertically:

Each feature has:
- Icon (tree, paw, frog, mountain, water drop, plant)
- Feature name
- Target percentage selector (pill buttons):
  * "17%" | "30%" | "34%" | "Custom" (30% selected/blue)
- Small badge: "30x30 initiative" in green

Example features:
1. Mammal Species - 30% selected
2. Cloud Forest - 32% selected
3. Threatened Amphibians - 25% selected
4. Paramo Ecosystems - 30% selected
5. Wetlands - 17% selected
6. Marine Protected Areas - 30% selected

**MIDDLE COLUMN - Priorities & Trade-offs:**
- Heading: "Priorities & Trade-offs"
- 5 range sliders (-100 to +100 scale):

Each slider has:
- Layer name above
- Slider with gradient background (red to gray to green)
- Current value displayed
- Labels: "Avoid" (-100) | "Neutral" (0) | "Prefer" (+100)

Sliders:
1. "Agricultural Opportunity Cost" - Set to -80 (red zone)
2. "Connectivity to Protected Areas" - Set to +60 (green zone)
3. "Human Footprint" - Set to -40 (light red)
4. "Carbon Storage Potential" - Set to +70 (green zone)
5. "Water Regulation Importance" - Set to +50 (green zone)

**RIGHT COLUMN - Constraints:**
- Heading: "Includes & Excludes"
- 6 toggle switches (On/Off):

Each toggle has:
- Toggle switch (CSS-styled)
- Label text
- Lock icon (include) or ban icon (exclude)

Toggles:
1. "Must include existing National Parks" - ON (green)
2. "Exclude urban centers >10k population" - ON (green)
3. "Must connect protected areas" - OFF (gray)
4. "Exclude mining concessions" - OFF (gray)
5. "Include indigenous territories" - ON (green)
6. "Exclude high conflict zones" - OFF (gray)

**BOTTOM SECTION - Results Preview:**
- Horizontal divider
- Heading: "Top Matching Scenarios"
- 3 scenario result cards displayed horizontally:

Each card shows:
- Small map thumbnail (placeholder gray box with green shapes)
- Scenario name: "Cloud Forest Protection - 30% Target"
- Large green pill badge: "95% Match"
- Brief description: "Prioritizes high-elevation ecosystems with moderate cost"
- Blue button: "Apply Scenario"

- Currently selected scenario has blue border
- "View More Results" link at right

**WARNING BOX (Optional, if constraints are extreme):**
- Yellow alert box above results:
  "⚠ These settings may result in low-quality matches. Consider adjusting wetland targets."

FOOTER:
- Left: "Need help?" text link
- Right: Two buttons:
  * "Reset to Default" (ghost button)
  * "Apply Selected Scenario" (primary blue button)

CSS REQUIREMENTS:
- Modal: max-width 1200px, max-height 800px, overflow-y: auto
- 3-column grid (1fr 1fr 1fr) with gap
- Range sliders with gradient backgrounds:
  * Red (#F44336) at -100
  * Gray (#9E9E9E) at 0
  * Green (#4CAF50) at +100
- Custom toggle switch design (rounded pill shape)
  * OFF: gray background, toggle left
  * ON: green background, toggle right
- Pill buttons for target percentages (rounded, blue when selected)
- Scenario cards with subtle hover effect (lift shadow)
- Responsive: stack columns vertically on narrow screens

JAVASCRIPT REQUIREMENTS:
- Range slider value display (update number as slider moves)
- Toggle switch state (click to toggle on/off, change color)
- Pill button selection (click to select, blue highlight)
- Close modal on backdrop click or X button
- "Apply Scenario" button highlights selected card
- Optional: Calculate "match percentage" based on selections (random for demo)
```

---

### 4. Trade-off Analysis Report (Full Page View)

**Component Reference:** MDD Section 4.5, Report #1  
**Deliverable:** Multi-page scrollable report

**Prompt:**

```
Generate a complete HTML file that creates a mockup of the "Trade-off Analysis Report" as a full-page scrollable document. This should look like a professional PDF report viewed in-browser.

REQUIREMENTS:
- Single HTML file with embedded CSS
- Use Chart.js for charts
- Print-friendly styling
- Multi-section scrollable layout (mimics multiple pages)
- Clean, professional report aesthetic

STRUCTURE & CONTENT:

PAGE LAYOUT:
- 8.5" x 11" (letter size) page proportions
- White background with margins
- Sections separated by page breaks (simulated with margin-top)

REPORT HEADER (All Pages):
- Small logo text: "Conservation Decision Support Tool - Colombia"
- Report title: "Trade-off Analysis Report"
- Scenario name: "Cloud Forest Protection - 30% Target"
- Generated date: "November 15, 2024"
- Selected perspective badge: "Conservationist Perspective" (blue pill)

---

**PAGE 1 - EXECUTIVE SUMMARY:**

**Scenario Identity Card:**
- Scenario name and ID
- Match quality badge: "95% Match"
- Date created: Nov 2024
- Small map placeholder (gray box with Colombia outline and green areas)

**Optimization Parameters Table:**
- Table with 4 columns: Feature | Target | Achieved | Status

| Conservation Feature | Target Goal | Achieved | Status |
|---------------------|-------------|----------|--------|
| Mammal Species | 30% | 32% | ✓ Met 🟢 |
| Cloud Forest | 30% | 35% | ✓ Met 🟢 |
| Threatened Amphibians | 25% | 22% | ✗ Unmet 🔴 |
| Paramo Ecosystems | 30% | 28% | ✗ Unmet 🔴 |
| Wetlands | 25% | 18% | ✗ Unmet 🔴 |

**Spatial Summary Stat Cards:**
Four cards in horizontal row:
- "Total Priority Area: 125,000 km²"
- "% of Colombia: 12%"
- "Number of Zones: 342 patches"
- "Largest Zone: 2,450 km²"

---

**PAGE 2 - GAINS (WHAT YOU GET):**

**Large Section Heading (Green):**
"✓ Conservation Gains: What This Scenario Achieves"

**Conservation Goals Met:**
- Checkmark grid showing 8 of 10 themes with green checks
- Visual: 2x5 grid with icons and checkmarks

**Species & Biodiversity Protected:**
- Bar chart (Chart.js): "Species Groups with Adequate Habitat Protection"
  * 9 horizontal bars for species groups
  * Values ranging from 20-50 species
- Badge: "45 Threatened Species Secured" in green

**Ecosystem Services Secured:**
Three large stat cards:
1. "Carbon Storage: 2.5B tCO2e"
   - Small line chart showing contribution by region (Chart.js)
2. "Water Regulation: 8M beneficiaries"
   - Water drop icon
3. "Connectivity: 15 corridors"
   - Small map showing purple corridor lines

**Auto-Generated Narrative (Green-bordered box):**
"This scenario achieves HIGH biodiversity protection with 9 species groups meeting conservation targets. EXCELLENT ecosystem service provision is secured with 2.5 billion tCO2e carbon storage and water regulation for 8 million downstream residents. The solution successfully creates 15 connectivity corridors between existing protected areas, enhancing landscape-level conservation."

---

**PAGE 3 - LOSSES/COSTS (WHAT YOU LOSE):**

**Large Section Heading (Orange):**
"⚠ Costs & Trade-offs: What This Scenario Requires"

**Agricultural Opportunity Cost:**
- Large stat card: "$350M USD"
- Bar chart (Chart.js): Cost by department (5 departments, horizontal bars)
- Pie chart: "Affected Agricultural Land by Type"
  * Pasture: 60% (tan)
  * Crops: 30% (yellow)
  * Mixed: 10% (green)

**Human Footprint Overlap:**
- Stat card: "15% of priority areas in moderate-high pressure zones"
- Histogram (Chart.js): Human Footprint distribution
  * Low (0-20): 60% (green bar)
  * Moderate (21-50): 25% (yellow)
  * High (51-80): 12% (orange)
  * Very High (81-100): 3% (red)
- Small map placeholder showing pressure overlay

**Conflict & Implementation Challenges:**
- Stat card: "8,200 km² overlap with historical conflict zones"
- Stat card: "5 Indigenous territories require prior consultation"
- Small map showing orange conflict zone overlay

**Auto-Generated Narrative (Orange-bordered box):**
"This scenario incurs MODERATE economic impact with $350M USD in agricultural opportunity cost representing 12% of regional agricultural GDP. 15% of priority areas overlap with moderate-to-high human pressure zones, requiring careful restoration approaches. Conservation priorities overlap with 8,200 km² of historical conflict zones and 5 indigenous territories, necessitating extensive community engagement and consultation processes."

---

**PAGE 4 - SYNTHESIS & RECOMMENDATIONS:**

**Overall Trade-off Summary:**
- Side-by-side comparison (2 columns):
  * Left (green background): Biodiversity gains, ecosystem services
  * Right (orange background): Economic costs, implementation challenges
- Dual-axis chart (Chart.js): Biodiversity Achievement (bars) vs. Economic Cost (line)

**Key Trade-offs Statement (Large bold text):**
"This scenario prioritizes high-elevation ecosystems (cloud forests, paramo) at moderate economic cost, achieving excellent carbon and water outcomes while requiring careful navigation of land-use conflicts in 15% of priority areas."

**Why Goals Were Unmet:**
Heading: "Explanation of Unmet Conservation Targets"

Text:
"Wetland conservation goals (18% vs. 25% target) were not met due to:
1. High agricultural opportunity cost in lowland wetland areas ($180M)
2. Optimization prioritizing high-elevation ecosystems with greater carbon storage and water regulation benefits
3. Limited available wetland area outside existing protected areas in high-priority watersheds"

**Implementation Recommendations:**
Bulleted list with icons:
- 👥 "Prioritize community consultation in 5 indigenous territories"
- 🌱 "Develop restoration plans for 25,000 km² of converted agricultural land"
- 🛡️ "Establish monitoring protocols in 8,200 km² conflict-sensitive zones"
- 🏛️ "Coordinate with 12 CARs for regional implementation"

**National Contribution Summary:**
- Large progress bar: "40% toward Colombia's 30% target"
- Text: "This solution protects 12% of Colombia's territory"
- Small table: Contribution by ecosystem type (4 rows)

---

FOOTER (All Pages):
- Page numbers (bottom center)
- Small disclaimer: "Generated by Conservation Decision Support Tool - Colombia"

CSS REQUIREMENTS:
- Page-like sections with margins (simulate 8.5" x 11" pages)
- Print-friendly colors (high contrast)
- Conservation palette:
  * Gains green: #E8F5E9 (background), #2E7D32 (borders)
  * Losses orange: #FFF3E0 (background), #F57C00 (borders)
- Clean typography (Georgia for body, Arial for headings)
- Chart.js professional styling
- Section dividers (subtle borders)
- Narrative boxes with left border accent

CHART.JS REQUIREMENTS:
- Initialize 4 charts:
  1. Bar chart: Species groups protection
  2. Pie chart: Agricultural land by type
  3. Histogram: Human footprint distribution
  4. Dual-axis chart: Biodiversity vs. Cost
- Use conservation color palette
- Clean, minimalist styling
```

---

## TIER 2: Important for Development Clarity

### 5. Scenario Comparison Panel

**Component Reference:** MDD Section 4.3.3

**Prompt:**

```
Generate a complete HTML file that creates a mockup of the "Scenario Comparison Panel" as a right sidebar component. This shows side-by-side comparison of two conservation scenarios.

REQUIREMENTS:
- Single HTML file with embedded CSS
- 400px sidebar width
- Comparison table with color-coded differences
- Interactive "Switch" button to swap scenarios

STRUCTURE & CONTENT:

HEADER:
- Title: "Scenario Comparison"
- Two scenario labels side-by-side (flex row):
  * "Scenario A: Cloud Forest Focus" (left, blue accent)
  * "Scenario B: Biodiversity Maximum" (right, purple accent)
- Match badges: "95% Match" and "88% Match"
- Small circular swap icon button between them

COMPARATIVE STATISTICS TABLE:
Large table with 4 columns and 7 rows:

| Metric | Scenario A | Scenario B | Difference |
|--------|-----------|-----------|------------|
| Total Priority Area | 125,000 km² | 98,000 km² | -27,000 km² ↓ 🔴 |
| % of Colombia | 12% | 9% | -3% ↓ 🔴 |
| Species Goals Met | 8 of 10 | 9 of 10 | +1 ↑ 🟢 |
| Carbon Stored | 2.5B tCO2e | 2.1B tCO2e | -400M ↓ 🔴 |
| Opportunity Cost | $450M | $320M | -$130M ↓ 🟢 |
| Human Footprint | 42 | 38 | -4 ↓ 🟢 |
| Conflict Exposure | 8,200 km² | 5,100 km² | -3,100 km² ↓ 🟢 |

Difference column styling:
- Green background for improvements (lower cost/conflict)
- Red background for trade-offs (lower carbon/area)
- Up/down arrow icons

THEME ACHIEVEMENT COMPARISON:
Side-by-side checklist (2 columns):

| Feature | Scenario A | Scenario B |
|---------|-----------|-----------|
| Mammals | ✓ 32% | ✓ 35% |
| Cloud Forest | ✓ 35% | ✓ 28% |
| Wetlands | ✗ 18% | ✓ 27% |
| Paramo | ✗ 28% | ✓ 32% |

Highlight rows where one meets goal and other doesn't

SPATIAL OVERLAP ANALYSIS:
Three stat cards (vertical stack):
1. "Agreement: 65,000 km²" - Green background, checkmark icon
2. "Unique to Scenario A: 60,000 km²" - Blue background, circle icon
3. "Unique to Scenario B: 33,000 km²" - Purple background, circle icon

Small Venn diagram visualization (CSS/SVG):
- Two overlapping circles (blue and purple)
- Overlap region in green
- Labels with areas

Stat: "Synergy Zones: 12 corridors" - Purple badge with network icon

AUTO-GENERATED NARRATIVE:
Light gray text box:
"Scenario A protects more area (+27,000 km²) and stores more carbon (+400M tCO2e) but has higher opportunity cost (+$130M) and greater conflict exposure (+3,100 km²). Scenario B achieves one additional species goal while reducing economic and social implementation costs, making it more feasible for near-term implementation."

MAP LEGEND REFERENCE:
Small legend box:
- Green square: "Agreement (both scenarios)"
- Blue square: "Unique to Scenario A"
- Purple square: "Unique to Scenario B"
- Orange square: "Synergy/Connectivity"
- Note: "See map for spatial visualization"

ACTION BUTTONS (Footer):
- "Generate Comparison Report (PDF)"
- "Export Comparison Data"
- "Exit Comparison Mode"

CSS REQUIREMENTS:
- Blue accent for Scenario A
- Purple accent for Scenario B
- Green for agreement/improvements
- Red for trade-offs
- Clean table design with alternating row colors
- Hover effects on swap button
- Card-based layout with shadows
```

---

### 6. Full Application Layout (3-Pane Interface)

**Component Reference:** MDD Section 4.1

**Prompt:**

```
Generate a complete HTML file that creates a mockup of the full 3-pane application layout for a conservation planning GIS tool: Left Sidebar (Control Dashboard), Center Panel (Interactive Map), and Right Sidebar (Analysis Dashboard).

REQUIREMENTS:
- Single HTML file with embedded CSS
- 3-column CSS Grid layout
- Resizable panels (optional: basic JavaScript drag handlers)
- Simulated map using Leaflet.js CDN or placeholder

STRUCTURE & CONTENT:

OVERALL LAYOUT:
- Full viewport height (100vh)
- 3-column CSS Grid:
  * Left Sidebar: 320px fixed
  * Center Panel: 1fr (flexible)
  * Right Sidebar: 420px fixed

TOP APPLICATION HEADER (Spans all 3 columns):
- Left: Logo + "Conservation Decision Support Tool"
- Center: Active scenario badge "Cloud Forest Protection - 95% Match"
- Right: User icon, bell icon, help icon

---

**LEFT SIDEBAR - CONTROL DASHBOARD:**

Background: #F5F5F5 (light gray)

**Solution Selector Section:**
- Card showing active scenario:
  * Small thumbnail map preview (placeholder gray with green)
  * "Active Scenario: Cloud Forest Protection"
  * Green badge: "95% Match"
- Large blue button: "Find a New Solution"
- Dropdown: "Recent Scenarios ▼" (collapsed)

**Layer Visibility Manager:**
- Heading: "Map Layers"
- Search input: "Search layers..." with magnifying glass icon

Hierarchical toggle list (tree structure):
- ☑ Conservation Solution (bold, checked)
- ☐ Protected Areas ▼ (expanded)
  - ☑ National Parks
  - ☑ OMECs
  - ☐ Regional Reserves
- ☐ Administrative Boundaries ▼ (collapsed)
- ☐ Biodiversity Layers ▼ (collapsed)
- ☐ Socio-Economic ▼ (collapsed)

Filter buttons (horizontal):
- "Filter by CAR"
- "Filter by Region"

**Symbology Controls:** (Collapsed section)
- "Symbology >" with chevron (click to expand)

**Export/Report Buttons:**
- "Generate Report (PDF)"
- "Download Data"
- "Export Map Image"

---

**CENTER PANEL - INTERACTIVE MAP:**

Background: Map placeholder

Option 1: Use Leaflet.js CDN to create actual interactive map
Option 2: Use placeholder image or styled div with map appearance

Map Content (if using Leaflet):
- Basemap: Light gray terrain
- Colombia GeoJSON outline
- Green semi-transparent overlay for conservation areas
- Department boundaries (light gray lines)
- Highlight: Cauca Department (yellow outline)

Map Controls (Overlaid with position: absolute):
- Top-right:
  * Zoom +/- buttons (vertical)
  * Home button
  * Basemap selector button
- Top-left:
  * Search bar: "Search for a place..."
  * Draw tools button
  * Measure button
- Bottom-right:
  * Compass rose (small)
  * Scale bar "0 50 100 km"
- Bottom-left:
  * Legend box (collapsible):
    - Conservation Priority (green square)
    - Protected Areas (dark green)
    - Selected Region (yellow outline)
- Bottom-center:
  * Coordinates: "4.5° N, 75.7° W"

---

**RIGHT SIDEBAR - ANALYSIS DASHBOARD:**

Background: White

Currently showing: AOI Dashboard

**Header:**
- Back arrow button (left)
- "Municipality of Popayán, Cauca"
- Close X button (right)

**Tabs:**
- "Overview" (active, blue underline)
- "Biodiversity"
- "Services"

**Content (scrollable):**
- Stat card: "Priority Area: 230 km² (45%)"
- Progress bar (45%)
- 2x2 grid of quick stats
- Bar chart: Species richness
- Donut chart: Ecosystems
- Regional vs. National comparison table
- Narrative text box
- Scroll indicator (fade at bottom)

---

CSS REQUIREMENTS:
- Grid layout: `display: grid; grid-template-columns: 320px 1fr 420px;`
- Full height: `height: 100vh; overflow: hidden;`
- Sidebar scrolling: `overflow-y: auto;`
- Map panel: `position: relative;` for absolute-positioned controls
- Clean, modern GIS aesthetic
- Consistent spacing and shadows
- Color palette:
  * Sidebars: #F5F5F5 / white backgrounds
  * Conservation green: #2E7D32
  * Blue accents: #1976D2

JAVASCRIPT (OPTIONAL):
- Toggle layer checkboxes (change state on click)
- Expand/collapse sections in left sidebar
- Tab switching in right sidebar
- If using Leaflet: Initialize map centered on Colombia (4.5, -74)
```

---

### 7. Perspective Selection Modal

**Component Reference:** MDD Section 4.3.1, Section G

**Prompt:**

```
Generate a complete HTML file that creates a mockup of the "Perspective Selection Modal" for choosing report narrative framing.

REQUIREMENTS:
- Single HTML file with embedded CSS and JavaScript
- Centered modal (700px x 550px)
- 5 clickable persona cards
- Selection highlights
- Semi-transparent backdrop

STRUCTURE & CONTENT:

BACKDROP:
- Dark semi-transparent overlay (rgba(0,0,0,0.5))

MODAL (Centered):
- White background, rounded corners, shadow

HEADER:
- Title: "Select Report Perspective"
- Subtitle: "Choose how you'd like the report findings to be framed. All data remains the same; only the narrative emphasis changes."
- Info icon with tooltip: "ⓘ You can change perspectives later"

MAIN CONTENT:
5 persona cards in vertical list or 2-2-1 grid:

**1. Regional Planner**
- Icon: 🏛️ (building)
- Title: "Regional Planner"
- Subtitle: "Planificador Regional" (Spanish, gray text)
- Description: "Emphasizes territorial planning compatibility, municipal distributions, and environmental authority (CAR) jurisdictions"
- Example: "Land-use planning, administrative coordination, regional development"

**2. Community Leader**
- Icon: 👥 (people)
- Title: "Community Leader"
- Subtitle: "Líder Comunitario"
- Description: "Emphasizes cultural territories, consultation requirements, ethnic communities, and local benefits"
- Example: "Indigenous territories, community councils, prior consultation, local livelihoods"

**3. Conservationist**
- Icon: 🌿 (leaf)
- Title: "Conservationist"
- Subtitle: "Conservacionista"
- Description: "Emphasizes species targets, ecosystem representation, biodiversity metrics, and conservation science"
- Example: "Threatened species, habitat protection, ecosystem services, ecological connectivity"

**4. Economist**
- Icon: 📊 (chart)
- Title: "Economist"
- Subtitle: "Economista"
- Description: "Emphasizes opportunity costs, development restrictions, economic impacts, and cost-benefit trade-offs"
- Example: "Agricultural opportunity cost, development constraints, economic feasibility"

**5. Climate Advocate**
- Icon: 🌍 (globe)
- Title: "Climate Advocate"
- Subtitle: "Defensor Climático"
- Description: "Emphasizes carbon storage, water regulation, climate resilience, and ecosystem service provision"
- Example: "Carbon sequestration, watershed protection, climate adaptation"

CARD DESIGN:
- Each card is clickable
- Default state: Light gray background (#F5F5F5), gray border
- Hover state: Blue border, slight shadow lift
- Selected state: Blue background (#1976D2), white text, checkmark icon (top-right)
- Layout: Icon at top, title in bold, subtitle below, description text, example in italics

NOTICE BOX (Below cards):
- Light blue info box with info icon:
  "ℹ️ Note: Your perspective choice only affects how report text is framed. All metrics, charts, and data remain identical across all perspectives."

FOOTER:
- Left: "Cancel" button (text link or ghost button)
- Right: "Continue to Report" button (primary blue button)
  * Disabled state (gray) until a card is selected
  * Enabled state (blue) after selection

CSS REQUIREMENTS:
- Modal: max-width 700px, max-height 550px, overflow-y: auto
- Cards: Padding, rounded corners, transition effects
- Selected card: background #1976D2, white text
- Hover effects: border color change, box-shadow lift
- Smooth transitions (0.2s ease)

JAVASCRIPT REQUIREMENTS:
- Click on card to select (add 'selected' class)
- Only one card can be selected at a time (radio button behavior)
- Enable "Continue to Report" button when card selected
- Click backdrop or Cancel to close modal
- Click Continue to proceed (console.log for demo)
```

---

### 8. Welcome/Getting Started Panel (Right Sidebar)

**Component Reference:** MDD Section 4.3.4  
**Complexity:** Low - Simple onboarding panel with CTAs  
**Deliverable:** Standalone HTML file showing welcome/onboarding state

**Prompt:**

```
Generate a complete HTML file with embedded CSS that creates a mockup of the "Welcome/Getting Started Panel" for a conservation planning application. This is shown in the right sidebar when no solution is active (initial load or after user clears selection).

REQUIREMENTS:
- Single HTML file with all CSS embedded
- Right sidebar panel (approximately 400px wide)
- Clean, inviting onboarding design
- Clear call-to-action buttons
- Use Font Awesome CDN for icons

STRUCTURE & CONTENT:

LAYOUT:
- Right sidebar panel width: 400px
- White background
- Vertically centered content
- Ample spacing for easy reading

WELCOME MESSAGE:
- Large friendly heading: "Welcome to the Conservation Decision Support Tool"
- Icon above heading: 🌿 or leafy tree icon (large, centered)
- Introductory text (2-3 sentences):
  "Explore conservation priorities across Colombia's terrestrial and marine ecosystems. Discover optimal conservation scenarios based on biodiversity, ecosystem services, and socio-economic factors."
- Subtext: "Get started by selecting conservation priorities using the Solution Finder"

QUICK START GUIDE:
- Heading: "Quick Start Guide" or "How It Works"
- 3 numbered steps with icons:

1. 🎯 **Define Your Priorities**
   "Click 'Find a Solution' to set conservation targets, costs, and constraints using the Solution Finder"

2. 🗺️ **Explore the Map**
   "View conservation priorities overlaid on Colombia's biodiversity and land-use data"

3. 📊 **Analyze Regions**
   "Click on any municipality, department, or SIRAP for detailed local statistics and trade-off analysis"

Each step should have:
- Large circular number badge (1, 2, 3) in green
- Icon next to number
- Bold step title
- Description text in regular weight

FEATURED SCENARIOS (Optional Section):
- Heading: "Featured Scenarios" or "Quick Start Options"
- Subtext: "Click a scenario to explore immediately"
- 4-5 scenario cards displayed vertically:

Each card shows:
- Scenario name in bold
- Small icon or color accent bar on left
- Brief description (1 line)
- "Load Scenario" link or arrow on right

Featured scenarios:
1. **Balanced Conservation & Development**
   Icon: ⚖️ Balance scale
   Description: "Moderate protection with economic considerations"

2. **Maximum Biodiversity Protection**
   Icon: 🦜 Bird or wildlife
   Description: "Prioritizes threatened species and ecosystem richness"

3. **Low-Cost Conservation Strategy**
   Icon: 💰 Coin
   Description: "Achieves conservation goals with minimal economic impact"

4. **Carbon & Water Security Focus**
   Icon: 💧 Water drop
   Description: "Emphasizes ecosystem services for climate resilience"

5. **Cultural Heritage & Biodiversity**
   Icon: 🏛️ Monument
   Description: "Integrates indigenous territories with conservation priorities"

Cards should have:
- Light gray background (#F5F5F5)
- Subtle border
- Hover effect (slight shadow lift)
- Clickable appearance

PRIMARY ACTION BUTTON:
- Large prominent button (full width or centered):
  * Text: "Open Solution Finder"
  * Icon: 🔍 or compass icon
  * Primary green color (#2E7D32)
  * Large, inviting design

SECONDARY ACTIONS (Optional):
- Text links below primary button:
  * "View Tutorial" with play icon
  * "Watch Demo Video" with video icon
- Small, unobtrusive

HELPFUL TIPS SECTION (Optional):
- Small info box at bottom with lightbulb icon:
  "💡 Tip: You can compare scenarios, generate reports, and download data after selecting a solution."

CSS REQUIREMENTS:
- Clean, modern onboarding design
- Conservation color palette:
  * Primary green: #2E7D32
  * Light green accents: #E8F5E9
  * Gray tones: #F5F5F5, #E0E0E0, #757575
- Typography:
  * Large heading: 24px, bold
  * Step titles: 16px, bold
  * Body text: 14px, regular
  * System font stack or Google Fonts (Inter/Roboto)
- Spacing:
  * Generous padding (24px sections)
  * Clear visual hierarchy
  * Breathing room between steps
- Numbered badges:
  * Circular (40-50px diameter)
  * Green background (#2E7D32)
  * White text
  * Bold number
- Scenario cards:
  * Light background (#F5F5F5)
  * Rounded corners (8px)
  * Subtle border (1px solid #E0E0E0)
  * Hover effect: box-shadow and slight transform
- Primary button:
  * Large (full width or min 200px)
  * Prominent green (#2E7D32)
  * White text
  * Rounded corners
  * Hover effect (darker green #1B5E20)

INTERACTIVE ELEMENTS (JavaScript):
- Hover effects on scenario cards (add class on mouseover)
- Hover effect on primary button (color change)
- Click on scenario cards logs scenario name (for demo)
- Click on "Open Solution Finder" button logs action (for demo)

ACCESSIBILITY:
- Semantic HTML (h1, h2, ol for numbered steps)
- Alt text for icons
- Good color contrast
- Keyboard navigation support

OVERALL FEEL:
- Welcoming and approachable
- Not overwhelming (simple, clear)
- Encourages exploration
- Professional but friendly
- Clear visual hierarchy guiding user to primary action
```

---

## ADDITIONAL REPORT MOCKUPS

### 9. Ecosystem Assessment Report (Report #2)

**Component Reference:** MDD Section 4.5, Report #2  
**Deliverable:** Multi-page scrollable report focused on ecosystem representation

**Prompt:**

```
Generate a complete HTML file that creates a mockup of the "Ecosystem Assessment Report" as a full-page scrollable document. This report provides detailed ecosystem representation analysis.

REQUIREMENTS:
- Single HTML file with embedded CSS
- Use Chart.js for visualizations
- Multi-section scrollable layout
- Print-friendly styling

STRUCTURE & CONTENT:

REPORT HEADER:
- Logo: "Conservation Decision Support Tool - Colombia"
- Report title: "Ecosystem Assessment Report"
- Scenario name: "Cloud Forest Protection - 30% Target"
- AOI: "Cauca Department" (if region-specific)
- Generated date

---

**PAGE 1 - EXECUTIVE SUMMARY:**

**Ecosystem Coverage Overview:**
- Table showing all ecosystem types in solution:

| Ecosystem Type | Area in Solution (km²) | % of Solution | % of National Distribution | Protection Status |
|---------------|------------------------|---------------|---------------------------|-------------------|
| Cloud Forest | 2,500 km² | 35% | 15% of national | ✓ Goal Met (30%) |
| Paramo | 800 km² | 20% | 20% of national | ✗ Below Goal (25% target) |
| Dry Forest | 1,200 km² | 25% | 8% of national | ✓ Goal Met (20%) |
| Wetlands | 450 km² | 10% | 5% of national | ✗ Below Goal (15% target) |
| Marine/Coral | 320 km² | 8% | 12% of national | ✓ Goal Met (10%) |

**Ecosystem Protection Gap Analysis:**
- For each ecosystem type, show:
  * Area currently protected (existing PAs)
  * New priority area (conservation solution)
  * Remaining gap to meet target
  * % unprotected
- Stacked bar chart showing protected/new/gap for each ecosystem

---

**PAGE 2 - TERRESTRIAL ECOSYSTEMS:**

**Cloud Forest Analysis:**
- Total area: 2,500 km²
- % of national cloud forest: 15%
- Protection status: "✓ Exceeds 30% target"
- Human Footprint breakdown:
  * Low (0-20): 70%
  * Moderate (21-50): 22%
  * High (51-80): 8%
  * Very High (81-100): 0%
- Histogram showing footprint distribution
- Ecosystem service score: HIGH (carbon storage, water regulation)
- Map showing cloud forest priority areas

**Paramo Ecosystems:**
- Total area: 800 km²
- % of national paramo: 20%
- Protection status: "✗ Below 25% target (-3%)"
- Why goal unmet: "High agricultural opportunity cost in remaining paramo areas ($85M) and optimization prioritizing lower-cost ecosystems"
- Human Footprint breakdown
- Ecosystem service score: VERY HIGH (water regulation for 3M people)

**Dry Forest Ecosystems:**
- Similar structure to above
- Protection status: "✓ Meets 20% target"

---

**PAGE 3 - MARINE & COASTAL ECOSYSTEMS:**

**Marine Ecosystem Representation Index:**
- Coral Reefs: EXCELLENT (45% protected, goal: 30%)
- Mangroves: HIGH (35% protected, goal: 30%)
- Seagrass Beds: MEDIUM (22% protected, goal: 30%)
- Overall marine representation: HIGH

**Marine-Terrestrial Connectivity:**
- 12 priority areas bridging coastal and marine ecosystems
- Total area: 450 km²
- Map showing coastal transition zones
- Importance: "Critical for nursery habitats and fish migration"

**Marine Protected Area (MPA) Overlap:**
- 25% of marine priorities overlap existing MPAs
- 75% represent new marine conservation opportunities
- Map overlay showing existing MPAs vs. new priorities

---

**PAGE 4 - ECOSYSTEM SERVICES PROVISION:**

**Carbon Storage by Ecosystem Type:**
- Table and bar chart:
  * Cloud Forest: 1.2B tCO2e (48%)
  * Paramo: 450M tCO2e (18%)
  * Dry Forest: 600M tCO2e (24%)
  * Mangroves: 200M tCO2e (8%)
  * Other: 50M tCO2e (2%)
- Total: 2.5B tCO2e
- Map showing carbon density distribution

**Water Regulation Capacity:**
- High-elevation ecosystems (Cloud Forest, Paramo) provide water for 8M downstream residents
- Watershed analysis showing beneficiary populations
- Map of priority watersheds

**Ecosystem Condition Assessment:**
- Human footprint analysis by ecosystem type
- Restoration needs and opportunities
- Connectivity status for each ecosystem

---

**PAGE 5 - RECOMMENDATIONS & IMPLEMENTATION:**

**Priority Actions:**
1. **Address Paramo Protection Gap:** Target remaining 200 km² to meet conservation goal
2. **Seagrass Restoration:** Identify 80 km² of degraded seagrass for restoration to meet marine targets
3. **Cloud Forest Connectivity:** Maintain 8 identified corridors between protected cloud forest patches
4. **Mangrove Protection:** Prioritize 150 km² of mangroves at high human pressure risk

**Restoration Opportunities:**
- Total restoration area needed: 350 km²
- Priority restoration zones: [List top 5 areas with km²]
- Restoration potential index by ecosystem

**Implementation Coordination:**
- Environmental authorities (CARs) involved: 8
- Municipalities affected: 45
- Ecosystem-specific management recommendations

CSS & CHART.JS:
- Conservation color palette
- Tables with color-coded protection status (green/red)
- Bar charts for ecosystem distribution
- Stacked bars for protection gaps
- Histograms for human footprint
- Donut chart for carbon by ecosystem
- Professional report aesthetic
```

---

### 10. Connectivity Report (Report #3)

**Component Reference:** MDD Section 4.5, Report #3

**Prompt:**

```
Generate a complete HTML file for the "Connectivity Report" focused on landscape connectivity and corridor analysis.

REQUIREMENTS:
- Single HTML file with embedded CSS and Chart.js
- Network diagrams/visualizations for corridors
- Map-centric layout showing connectivity zones

STRUCTURE & CONTENT:

REPORT HEADER:
- Title: "Connectivity Report"
- Scenario and date

---

**PAGE 1 - CONNECTIVITY OVERVIEW:**

**Connectivity Achievement Summary:**
- Total connectivity score: 78/100 (HIGH)
- Number of corridors created: 15
- Connectivity pinch points: 8 critical bottlenecks
- Connected protected area pairs: 12

**Regional vs. National Connectivity:**
- AOI connectivity contribution: "12% of national connectivity network"
- Significance: "CRITICAL contributor to landscape connectivity"

**Corridor Summary Table:**

| Corridor ID | Connects | Length (km) | Width (avg km) | Status | Pinch Points |
|-------------|----------|-------------|----------------|--------|--------------|
| COR-001 | Puracé NP ↔ Los Farallones | 45 km | 3.5 km | Functional | 2 |
| COR-002 | Cloud Forest A ↔ Cloud Forest B | 28 km | 2.1 km | At Risk | 1 |
| ... | ... | ... | ... | ... | ... |

---

**PAGE 2 - CORRIDOR ANALYSIS:**

**Functional Corridors (Status: Good):**
For each corridor:
- Map showing corridor path
- Length and average width
- Habitat types traversed
- Human footprint along corridor
- Species using corridor (if data available)
- Protection status (% in PAs)

**At-Risk Corridors:**
- Corridors with:
  * High human footprint (>50)
  * Narrow width (<1 km)
  * Critical pinch points
  * Development threats
- Map highlighting risk zones
- Mitigation recommendations

---

**PAGE 3 - CONNECTIVITY PINCH POINTS:**

**Critical Bottlenecks:**
- 8 pinch points identified
- Map showing all pinch point locations

For each pinch point:
- Location (municipality)
- Importance: "Connects X to Y"
- Width: "200m minimum width"
- Threats: "Agricultural expansion, road development"
- Area needing protection/restoration: 5 km²
- Restoration priority: HIGH/MEDIUM/LOW

---

**PAGE 4 - RESTORATION PRIORITIES:**

**Corridor Restoration Priority Analysis:**
- Total restoration area needed: 450 km²
- Restoration priority breakdown:
  * CRITICAL: 150 km² (5 pinch points)
  * HIGH: 200 km² (corridor widening)
  * MEDIUM: 100 km² (habitat improvement)

**Restoration Priority Map:**
- Choropleth map showing restoration priority zones
- Color-coded by priority level

**Priority Restoration Zones Table:**

| Zone ID | Location | Area (km²) | Priority | Reason | Est. Cost |
|---------|----------|------------|----------|--------|-----------|
| REST-001 | Corridor COR-002 pinch | 25 km² | CRITICAL | Only 200m wide, high development pressure | $2.5M |
| ... | ... | ... | ... | ... | ... |

---

**PAGE 5 - CONNECTIVITY & SPECIES:**

**Species Using Corridors:**
- List of wide-ranging species benefiting from connectivity:
  * Jaguar (requires >500 km² connected habitat)
  * Spectacled Bear (mountain corridors)
  * Endemic birds (forest connectivity)
- Map showing species ranges and corridors

**Habitat Fragmentation Analysis:**
- Average patch size: 365 km²
- Number of isolated patches: 12
- Connectivity index by habitat type

---

**PAGE 6 - IMPLEMENTATION RECOMMENDATIONS:**

**Priority Actions:**
1. **Secure Critical Pinch Points:** Acquire or establish conservation agreements for 5 critical bottlenecks (150 km²)
2. **Corridor Widening:** Expand 3 at-risk corridors to minimum 1 km width
3. **Restoration Implementation:** Begin restoration in 450 km² priority zones
4. **Monitoring Protocol:** Establish wildlife camera trap network at corridor midpoints

**Coordination Needs:**
- Environmental authorities (CARs): 6
- Municipalities involved: 28
- Indigenous territories consulted: 3
- Private landowners engaged: ~200 estimated

CSS & VISUALIZATION:
- Network diagrams showing connected areas
- Flow maps for corridors
- Risk heat maps
- Restoration priority choropleth maps
```

---

### 11. Species Conservation Report (Report #4)

**Component Reference:** MDD Section 4.5, Report #4

**Prompt:**

```
Generate HTML for "Species Conservation Report" focused on species-specific protection analysis.

STRUCTURE & CONTENT:

REPORT HEADER:
- Title: "Species Conservation Report"
- Scenario and date

---

**PAGE 1 - SPECIES PROTECTION OVERVIEW:**

**Overall Achievement:**
- Species goals met: 8 of 10 taxonomic groups
- Total species with habitat protected: 245 species
- Threatened species secured: 45 species
- Endemic species protected: 32 species

**Protection Achievement by Taxonomic Group:**

| Group | Species Count | Goal | Achievement | Status |
|-------|--------------|------|-------------|--------|
| Mammals | 48 | 30% habitat | 32% | ✓ Met |
| Birds | 127 | 30% habitat | 28% | ✗ Unmet |
| Amphibians | 32 | 35% habitat | 38% | ✓ Met |
| Reptiles | 28 | 25% habitat | 22% | ✗ Unmet |
| Plants | 10 | 20% habitat | 25% | ✓ Met |

Bar chart showing achieved vs. goal

---

**PAGE 2 - THREATENED SPECIES ANALYSIS:**

**Protection by IUCN Threat Status:**

| IUCN Status | Species Count | % with Adequate Habitat | Goal | Status |
|-------------|--------------|-------------------------|------|--------|
| Critically Endangered (CR) | 5 | 80% (4 of 5) | 100% | Near Goal |
| Endangered (EN) | 18 | 72% (13 of 18) | 80% | Near Goal |
| Vulnerable (VU) | 22 | 68% (15 of 22) | 70% | Near Goal |

**Notable Threatened Species Protected:**
- Spectacled Bear (VU): 35% habitat protected ✓
- Yellow-eared Parrot (EN): 42% habitat protected ✓
- Lehmann's Poison Frog (CR): 100% habitat protected ✓
- Magdalena River Turtle (CR): 65% habitat protected (needs improvement)

---

**PAGE 3 - ENDEMIC SPECIES PROTECTION:**

**Endemic Species Achievement:**
- Total endemic species: 180 in Colombia
- Endemic species in AOI: 32 species
- Endemic species with adequate habitat: 28 (88%)

**Endemic Protection by Taxonomic Group:**

| Group | Endemic Count | % Protected | National Importance |
|-------|--------------|-------------|---------------------|
| Mammals | 8 | 75% | 10% of national endemics |
| Birds | 15 | 93% | 8% of national endemics |
| Amphibians | 6 | 100% | 15% of national endemics |
| Reptiles | 3 | 67% | 5% of national endemics |

---

**PAGE 4 - HABITAT QUALITY & FRAGMENTATION:**

**Habitat Fragmentation Index by Taxa:**
- Mammals: 0.72 (Good connectivity)
- Birds: 0.85 (Excellent connectivity)
- Amphibians: 0.65 (Moderate fragmentation)
- Reptiles: 0.68 (Moderate fragmentation)

**Human Footprint in Species Habitats:**
For each major species group:
- Average human footprint in protected habitat
- % of habitat in low/moderate/high pressure zones
- Histogram showing footprint distribution

---

**PAGE 5 - IMPLEMENTATION & MONITORING:**

**Priority Conservation Actions:**
1. **Birds:** Additional 200 km² needed to meet 30% goal
2. **Reptiles:** Target 150 km² of riparian habitat
3. **CR Species:** Secure remaining critical habitat for 1 unprotected CR species

**Monitoring Recommendations:**
- Camera trap locations for mammals (15 sites)
- Acoustic monitoring for birds (20 sites)
- Amphibian surveys in priority wetlands (8 sites)

CSS & CHARTS:
- Species icons/silhouettes
- IUCN threat status color coding (red/orange/yellow)
- Progress bars for goals
- Fragmentation index gauges
```

---

### 12. Territorial Planning Report (Report #5)

**Component Reference:** MDD Section 4.5, Report #5

**Prompt:**

```
Generate HTML for "Territorial Planning Report" focused on land-use planning and jurisdictional coordination.

STRUCTURE & CONTENT:

REPORT HEADER:
- Title: "Territorial Planning Report"
- Scenario and date

---

**PAGE 1 - JURISDICTIONAL DISTRIBUTION:**

**Priority Area Distribution by Jurisdiction:**

Table showing all affected administrative units:

| Department | Area (km²) | % of Department | CAR Authority | Municipalities |
|------------|------------|-----------------|---------------|----------------|
| Cauca | 8,500 km² | 28% | CRC | 15 |
| Valle del Cauca | 6,200 km² | 22% | CVC | 12 |
| Nariño | 4,800 km² | 18% | Corponariño | 10 |
| ... | ... | ... | ... | ... |

**Distribution by Environmental Authority (CAR):**
- Pie chart showing priority area by CAR jurisdiction
- Table with CAR names, areas, and coordination needs

---

**PAGE 2 - LAND USE COMPATIBILITY:**

**Territorial Planning Compatibility Score:**
- Overall: PARTIAL CONFLICT (65% compatible, 35% conflict)

**Compatibility Analysis:**

| Land Use Zone | Priority Area Overlap (km²) | Compatibility Status | Notes |
|---------------|---------------------------|----------------------|-------|
| Forest Reserve | 45,000 km² | ✓ COMPATIBLE | Aligned with conservation |
| Agricultural Frontier | 12,000 km² | ⚠ PARTIAL CONFLICT | Requires negotiation |
| Mining Exclusion Zones | 8,000 km² | ✓ COMPATIBLE | Already restricted |
| Urban Expansion Areas | 500 km² | ✗ MAJOR CONFLICT | Requires planning revision |

**Territorial Planning Determinants:**
- Map showing overlap with official planning layers
- Conflict zones highlighted
- Compatible zones in green

---

**PAGE 3 - LAND USE & ECONOMIC IMPACTS:**

**Current Land Use in Priority Areas:**
- Donut chart:
  * Natural Forest: 60%
  * Pasture: 25%
  * Crop Agriculture: 10%
  * Other: 5%

**Agricultural Opportunity Cost Breakdown:**
- Total: $350M USD
- By agricultural type:
  * Pasture: $180M (51%)
  * Coffee: $85M (24%)
  * Sugarcane: $50M (14%)
  * Other crops: $35M (10%)
- By department (bar chart)

**Potential Production Area Change:**
- Projected agricultural expansion zones affected: 3,200 km²
- Future production impact: $95M (based on 2030 projections)
- Map showing agricultural frontier overlap

---

**PAGE 4 - DEVELOPMENT RESTRICTIONS:**

**Development Restriction Analysis:**
- Total area with new restrictions: 95,000 km²
- Breakdown by restriction type:
  * New protected status: 65,000 km²
  * Development exclusion: 30,000 km²

**Overlap with Legally Restricted Zones:**
- Priority areas in agricultural frontier zones: 12,000 km²
- Priority areas in mining exclusion zones: 8,000 km²
- Synergistic restrictions (already limited development): 45%

---

**PAGE 5 - COORDINATION & IMPLEMENTATION:**

**Municipal Coordination Requirements:**
- Total municipalities affected: 45
- Municipalities with >50% overlap: 8 (intensive coordination needed)
- Municipalities with 10-50% overlap: 22 (moderate coordination)
- Municipalities with <10% overlap: 15 (light coordination)

**Table: Top 10 Municipalities by Priority Area:**

| Municipality | Priority Area (km²) | % of Municipality | CAR | Coordination Priority |
|--------------|-------------------|------------------|-----|----------------------|
| Municipality A | 1,250 km² | 65% | CRC | HIGH |
| ... | ... | ... | ... | ... |

**CAR Coordination Recommendations:**
- Multi-CAR agreements needed: 6 authorities
- Lead CAR recommendations by region
- Coordination timeline and milestones

---

**PAGE 6 - IMPLEMENTATION RECOMMENDATIONS:**

**Priority Actions:**
1. **Resolve Planning Conflicts:** Engage 8 municipalities with major conflicts (urban expansion zones)
2. **Negotiate Agricultural Transitions:** Work with 500 affected agricultural producers
3. **Establish CAR Coordination Committee:** 6 authorities, meet quarterly
4. **Update Municipal Land Use Plans:** Integrate conservation priorities into 45 POTs

CSS & VISUALIZATIONS:
- Choropleth maps by jurisdiction
- Compatibility traffic lights (green/yellow/red)
- Economic impact bar charts
- Coordination matrix visualizations
```

---

### 13. Ethnic Territory Consultation Report (Report #6)

**Component Reference:** MDD Section 4.5, Report #6

**Prompt:**

```
Generate HTML for "Ethnic Territory Consultation Report" focused on indigenous and Afro-Colombian territory consultation requirements.

STRUCTURE & CONTENT:

REPORT HEADER:
- Title: "Ethnic Territory Consultation Report"
- Subtitle: "Prior Consultation Requirements under ILO Convention 169"
- Scenario and date

---

**PAGE 1 - CONSULTATION REQUIREMENTS OVERVIEW:**

**Summary:**
- Consultation required: YES
- Total ethnic territory overlap: 8,500 km²
- Indigenous reservations affected: 5
- Community councils affected: 3
- Total communities requiring consultation: 8

**Legal Framework:**
- ILO Convention 169 (ratified by Colombia)
- Colombian Constitutional Court rulings
- Prior consultation protocol requirements
- Timeline: Estimated 18-24 months for full consultation

---

**PAGE 2 - INDIGENOUS RESERVATIONS:**

**Affected Indigenous Territories:**

Table with all affected reservations:

| Reservation Name | Ethnic Group | Area in Priorities (km²) | % of Reservation | Consultation Status |
|-----------------|--------------|-------------------------|------------------|---------------------|
| Resguardo A | Nasa | 1,250 km² | 45% | Required - Not Initiated |
| Resguardo B | Misak | 850 km² | 38% | Required - Not Initiated |
| Resguardo C | Awa | 2,100 km² | 52% | Required - Not Initiated |
| ... | ... | ... | ... | ... |

**Indigenous Territory Protection Status:**
- % of priorities overlapping indigenous land: 35%
- Synergy with indigenous conservation practices: HIGH
- Cultural site protection considerations: 12 sacred sites within priorities

Map showing indigenous reservations and priority overlaps

---

**PAGE 3 - AFRO-COLOMBIAN COMMUNITY COUNCILS:**

**Affected Community Councils:**

| Community Council | Region | Area in Priorities (km²) | % of Council Territory | Consultation Status |
|------------------|--------|-------------------------|------------------------|---------------------|
| Council A | Pacific Coast | 650 km² | 42% | Required - Not Initiated |
| Council B | Cauca River | 450 km² | 30% | Required - Not Initiated |
| Council C | Pacific Coast | 800 km² | 55% | Required - Not Initiated |

**Community Council Context:**
- Traditional territories: Collective land titles
- Livelihoods: Artisanal fishing, sustainable forestry, agriculture
- Conservation alignment: Strong traditional ecological knowledge

---

**PAGE 4 - CULTURAL & SPIRITUAL SIGNIFICANCE:**

**Sacred Sites and Cultural Landscapes:**
- Total identified sacred sites in priorities: 12
- Cultural landscape areas: 3,500 km²
- Ceremonial sites requiring special protection: 5

**Spiritual Significance Indicators:**
- High cultural value zones: 25% of priority areas
- Traditional resource use areas: 40% of priorities
- Ancestral territory designations: 8

Map showing cultural sites and traditional use areas

---

**PAGE 5 - CONSULTATION PROCESS & TIMELINE:**

**Prior Consultation Protocol:**

**Phase 1: Pre-Consultation (Months 1-3):**
- Identify all affected communities (COMPLETE - see above)
- Preliminary outreach to community leaders
- Establish consultation working groups
- Develop culturally appropriate information materials

**Phase 2: Information Stage (Months 4-6):**
- Present conservation scenario to each community
- Provide full technical reports in accessible format
- Translation to indigenous languages as needed
- Community discussions and initial feedback

**Phase 3: Internal Deliberation (Months 7-12):**
- Communities deliberate internally
- Traditional decision-making processes respected
- Technical support available upon request
- No external pressure on decision timeline

**Phase 4: Dialogue & Negotiation (Months 13-18):**
- Formal dialogue sessions with each community
- Address concerns and modification requests
- Negotiate benefit-sharing arrangements
- Document agreements

**Phase 5: Agreement (Months 19-24):**
- Formalize consultation outcomes
- Sign consultation protocols
- Implement agreed-upon modifications
- Establish monitoring and oversight mechanisms

---

**PAGE 6 - RECOMMENDATIONS & CONSIDERATIONS:**

**Consultation Best Practices:**
1. **Culturally Appropriate Engagement:** Use indigenous languages, respect traditional authorities
2. **Adequate Timeline:** No rushing of consultation process
3. **Benefit Sharing:** Develop equitable benefit-sharing mechanisms (payment for ecosystem services, co-management)
4. **Capacity Building:** Provide technical training for community environmental monitors
5. **Co-Management Agreements:** Establish joint governance structures

**Key Considerations:**
- Traditional ecological knowledge integration
- Respect for indigenous land rights and autonomy
- Climate justice and environmental equity
- Free, Prior, and Informed Consent (FPIC) principles

**Estimated Resources:**
- Consultation budget: $2.5M USD
- Staff time: 6 FTE over 24 months
- Translation services: 4 indigenous languages
- Community meetings: ~120 sessions estimated

CSS & DESIGN:
- Respectful, professional tone
- Cultural sensitivity in visual design
- Timeline Gantt charts
- Map overlays showing ethnic territories
- Color-coded consultation status
```

---

## Additional Utilities

### CSS Reset/Normalization

Add this to the start of any `<style>` tag for consistency:

```css
* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    font-size: 14px;
    line-height: 1.5;
    color: #212121;
    background: #F5F5F5;
}

button {
    font-family: inherit;
    cursor: pointer;
}
```

### Conservation Color Palette (CSS Variables)

```css
:root {
    --primary-green: #2E7D32;
    --gains-bg: #E8F5E9;
    --gains-border: #2E7D32;
    --losses-bg: #FFF3E0;
    --losses-border: #F57C00;
    --blue-accent: #1976D2;
    --purple-accent: #7B1FA2;
    --gray-50: #FAFAFA;
    --gray-100: #F5F5F5;
    --gray-300: #E0E0E0;
    --gray-500: #9E9E9E;
    --gray-700: #616161;
    --gray-900: #212121;
    --success: #4CAF50;
    --warning: #FF9800;
    --error: #F44336;
}
```

---

## Iterating on Generated HTML

### Common Refinements to Request:

1. **"Make the text larger/smaller"**
2. **"Increase spacing between sections"**
3. **"Make the buttons more prominent"**
4. **"Change the color scheme to [color]"**
5. **"Add hover effects to cards"**
6. **"Make it more compact"**
7. **"Add smooth animations"**
8. **"Make it mobile-responsive"**

---

## Using the HTML Mockups

### For Stakeholder Demos:
1. Open HTML in browser
2. Full-screen for presentations
3. Click through interactions to show functionality

### For Design Review:
1. Share HTML files via email/Dropbox
2. Stakeholders can open in any browser
3. No special software needed

### For Development:
1. Extract CSS for design system
2. Use HTML structure as blueprint
3. Replace static data with API calls
4. Add real functionality

---

*Generated from MASTER_DESIGN_DOCUMENT.md*  
*Last updated: December 17, 2025*
