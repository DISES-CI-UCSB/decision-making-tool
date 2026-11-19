# Proposal: Improving Area 4.4 Metrics Tables
## Adding Formatting Context for Sidebar vs. Report Display

**Date:** December 17, 2025  
**Status:** Proposed Enhancement to MDD  

---

## Problem Statement

**Current State:**  
Area 4.4 metrics tables document WHAT metrics exist and WHERE they appear, but don't specify HOW they are formatted differently when displayed in interactive sidebars vs. reports.

**Issue:**  
The same metric (e.g., "Carbon Storage: 2.5B tCO2e") appears in:
- **Solution Overview Panel** (sidebar)
- **AOI Dashboard** (sidebar)
- **Trade-off Analysis Report** (PDF/page view)
- **Ecosystem Assessment Report** (PDF/page view)

But the tables don't show:
- Layout differences (stat card vs. table cell vs. full-page section)
- Visualization differences (icon + number vs. detailed chart)
- Context differences (summary vs. detailed breakdown)

---

## Proposed Solution

Add a new column to each metrics table: **"Display Format"** or create a separate **"Format Specification Table"** showing how each metric is rendered in different contexts.

### Option 1: Add "Display Format" Column (Simple)

Add one more column to existing metrics tables in sections 4.4.1-4.4.8:

| # | Metric Name | ... | **Sidebar Format** | **Report Format** | Also Appears In |
|---|-------------|-----|-------------------|-------------------|-----------------|
| 5 | Carbon Storage Capacity | ... | **Stat Card:** Large number with leaf icon, no breakdown | **Detailed Section:** Full-page breakdown by region + map + bar chart + narrative | Trade-off Report (pg 2), Ecosystem Report (pg 4) |

**Pros:**
- Simple to implement
- Keeps all info in one table
- Easy to scan

**Cons:**
- Makes tables wider/harder to read
- Limited space for detailed format descriptions

---

### Option 2: Separate Format Specification Tables (Detailed) ⭐ RECOMMENDED

Create a **new subsection** after each metrics table (4.4.1-4.4.8) called:

**"Format Specifications: How These Metrics Are Displayed"**

Example for Solution Overview Panel (Section 4.4.1):

---

#### 4.4.1b. Solution Overview Panel - Format Specifications

**Table: How Metrics Are Displayed in Different Contexts**

| Metric Name | Sidebar Display (Solution Overview Panel) | Report Display (Trade-off Analysis Report) |
|-------------|------------------------------------------|-------------------------------------------|
| **Conservation Goals Met** | **Format:** Progress fraction with checkmark icon<br>**Layout:** Stat card (150px x 80px)<br>**Content:** "8 of 10 themes ✓"<br>**Interaction:** Click to expand full list | **Format:** Full table with checkmarks<br>**Layout:** Half-page table<br>**Content:** All 10 themes listed with achieved/goal/status<br>**Interaction:** Static (print-friendly) |
| **Carbon Storage Capacity** | **Format:** Stat card<br>**Layout:** Icon + large number (32px font)<br>**Content:** "2.5B tCO2e" with leaf icon<br>**Visualization:** None<br>**Interaction:** Hover for tooltip | **Format:** Detailed section with breakdown<br>**Layout:** Full page section<br>**Content:** Total + breakdown by region + narrative<br>**Visualization:** Bar chart by region, line chart by ecosystem<br>**Map:** Spatial distribution of carbon density |
| **Agricultural Opportunity Cost** | **Format:** Stat card in LOSSES section<br>**Layout:** Orange-background card, dollar icon<br>**Content:** "$350M USD"<br>**Context:** One-line description<br>**Interaction:** None | **Format:** Multi-page detailed section<br>**Layout:** Full page + tables + charts<br>**Content:** Total + breakdown by dept + by crop type<br>**Visualizations:** Pie chart (crop types), bar chart (departments), histogram<br>**Map:** Choropleth showing cost distribution<br>**Narrative:** 2-3 paragraphs explaining impact |

---

**Format Terminology Reference:**

**Sidebar Formats:**
- **Stat Card:** Compact display (icon + number + label), typically 150-200px wide
- **Progress Bar:** Horizontal bar with percentage, label above
- **Badge:** Small pill-shaped indicator (e.g., "95% Match")
- **Mini Chart:** Small embedded chart (100-150px tall)
- **List Item:** Text entry in expandable list

**Report Formats:**
- **Stat Card:** Same as sidebar but larger (200-250px)
- **Section Heading:** Full-width heading for major metric category
- **Detail Table:** Multi-row table with breakdowns
- **Full Chart:** Large Chart.js visualization (400-600px)
- **Map:** Full or half-page map with overlay
- **Narrative Block:** 1-3 paragraphs of auto-generated text explaining the metric

---

### Visual Example: Carbon Storage Metric in Different Contexts

#### Context 1: Solution Overview Panel (Sidebar)

```
┌─────────────────────────────┐
│  🍃  Carbon Storage         │
│                             │
│      2.5B tCO2e            │
│                             │
│  High capacity ✓           │
└─────────────────────────────┘
       Stat Card (180px)
```

#### Context 2: AOI Dashboard (Sidebar)

```
┌─────────────────────────────────────┐
│  Carbon Storage in Region           │
│                                     │
│  Total: 85M tCO2e                  │
│  Above-ground: 60M tCO2e           │
│  Soil organic: 25M tCO2e           │
│                                     │
│  Average density: 165 tCO2e/ha     │
│                                     │
│  [=======60%=====    ] 7% national │
└─────────────────────────────────────┘
    Detailed Stat Card with Breakdown
```

#### Context 3: Trade-off Analysis Report (Full Page)

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    CARBON STORAGE SECURED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Total Carbon Stored: 2.5 Billion tCO2e

Carbon Storage by Region
┌─────────────────────────────────────┐
│ Bar Chart: Carbon by Department     │
│                                     │
│ Cauca       ████████████ 950M       │
│ Valle       ██████████ 780M         │
│ Nariño      ███████ 580M            │
│ Other       ████ 190M               │
└─────────────────────────────────────┘

Carbon Storage by Ecosystem Type
┌─────────────────────────────────────┐
│ Donut Chart showing:                │
│ - Cloud Forest: 48%                 │
│ - Paramo: 18%                       │
│ - Dry Forest: 24%                   │
│ - Mangroves: 8%                     │
│ - Other: 2%                         │
└─────────────────────────────────────┘

Spatial Distribution Map
[Full-page map showing carbon density]

Narrative:
"This conservation solution secures 2.5 billion 
tonnes of CO2 equivalent carbon storage, 
representing 7% of Colombia's terrestrial carbon 
stocks. High-elevation ecosystems (cloud forests 
and paramo) account for 66% of total carbon 
storage despite comprising only 55% of priority 
area, reflecting their exceptional carbon density 
(avg 285 tCO2e/ha vs. 165 tCO2e/ha national 
average). The Cauca Department contains 38% of 
secured carbon due to extensive cloud forest 
protection. This carbon storage provides climate 
regulation services valued at approximately $75 
billion at $30/tonne social cost of carbon."
```

---

## Implementation in MDD

### Proposed Structure:

**Current:** Area 4.4 has 8 subsections (4.4.1 through 4.4.8), each with one metrics table

**Proposed:** Each subsection gets TWO parts:

1. **Part A:** Metrics table (existing) - WHAT metrics exist
2. **Part B:** Format specifications (new) - HOW metrics are displayed

Example:

```
#### 4.4.1. Solution Overview Panel Metrics (17 Metrics)
[Existing metrics table with columns: #, Name, Description, Units, etc.]

#### 4.4.1b. Solution Overview Panel - Format Specifications
[New table showing Sidebar Format vs. Report Format for each metric]
```

---

## Benefits

✅ **Clarity for Designers:** Exactly how to render each metric in mockups  
✅ **Clarity for Developers:** Specific UI component requirements  
✅ **Prevents Ambiguity:** "Show carbon storage" means different things in sidebar vs. report  
✅ **Stakeholder Validation:** Stakeholders can see HOW data will look, not just WHAT data exists  
✅ **Consistent UX:** Ensures metrics are displayed appropriately for context  

---

## Example: Complete Specification for One Metric

### Metric: Agricultural Opportunity Cost

**Sidebar Display (Solution Overview Panel):**
- **Component Type:** Stat Card
- **Location:** LOSSES/COSTS section, orange background
- **Layout:** 180px x 100px card
- **Icon:** Dollar sign ($) icon, 24px
- **Value:** "$350M USD" in 24px bold font
- **Label:** "Agricultural Opportunity Cost" in 12px gray text
- **Additional Context:** None (minimal)
- **Interaction:** None (static display)
- **Color Scheme:** Orange background (#FFF3E0), dark orange text (#F57C00)

**Sidebar Display (AOI Dashboard):**
- **Component Type:** Stat Card
- **Location:** "Socio-Economic Context" section
- **Layout:** 200px x 120px card
- **Icon:** Dollar sign icon
- **Value:** "$125M" (regional value)
- **Label:** "Agricultural Opportunity Cost"
- **Additional Context:** "Based on 2021 agricultural census"
- **Breakdown:** None in card (available in detail view)
- **Interaction:** Click for breakdown by crop type
- **Color Scheme:** Light gray background

**Report Display (Trade-off Analysis Report, Page 3):**
- **Component Type:** Full Page Section
- **Location:** LOSSES/COSTS chapter, dedicated subsection
- **Layout:** Full page width (8.5" x 11")
- **Heading:** "Agricultural Opportunity Cost" in 18pt bold
- **Total Value:** Large "$350M USD" stat (36pt)
- **Temporal Context:** "Based on 2021 Agricultural Census Data (latest available)"
- **Breakdown Table:**
  ```
  | Crop Type    | Area (km²) | Economic Value | % of Total Cost |
  |--------------|-----------|----------------|-----------------|
  | Pasture      | 15,000    | $180M          | 51%            |
  | Coffee       | 4,200     | $85M           | 24%            |
  | Sugarcane    | 2,800     | $50M           | 14%            |
  | Other crops  | 3,000     | $35M           | 10%            |
  ```
- **Visualizations:**
  1. Pie chart: Cost by crop type (300px diameter)
  2. Bar chart: Cost by department (600px wide)
  3. Map: Choropleth showing cost density (half-page)
- **Narrative Text (Auto-Generated):** 2-3 paragraphs:
  - Total cost context and significance
  - Breakdown explanation (why pasture is highest)
  - Regional distribution (Cauca has 35% of cost)
  - Implications for implementation (negotiation needed with ~500 producers)
  - Comparison to regional agricultural GDP (12% of regional GDP)
- **Methodology Note:** Footnote with data sources and calculation method
- **Related Metrics Cross-Reference:** "See also: Land Use Distribution (Section X), Development Restrictions (Section Y)"

**Report Display (Territorial Planning Report, Page 3):**
- **Component Type:** Summary + Regional Detail
- **Layout:** Half page
- **Total Value:** "$350M USD" (summary line)
- **Regional Breakdown Table:**
  ```
  | Department | Ag. Opp. Cost | % of Regional GDP |
  |------------|--------------|-------------------|
  | Cauca      | $125M        | 15%              |
  | Valle      | $98M         | 8%               |
  | Nariño     | $85M         | 18%              |
  | Other      | $42M         | 5%               |
  ```
- **Visualization:** Bar chart by department
- **Narrative:** 1 paragraph focusing on planning implications and CAR coordination needs

---

## Recommendation

**Implement Option 2** (Separate Format Specification Tables) for all 8 metrics sections in Area 4.4.

Start with **Section 4.4.1 (Solution Overview Panel)** as a pilot, then apply the pattern to remaining sections.

This provides the missing "HOW" layer that designers, developers, and stakeholders need to validate the UI/UX before implementation begins.

---

## Next Steps

1. ☐ Review this proposal with design team
2. ☐ Create format specification table for Section 4.4.1 (Solution Overview Panel) as pilot
3. ☐ Validate format spec with stakeholders (show mockup examples)
4. ☐ If approved, replicate format spec tables for sections 4.4.2-4.4.8
5. ☐ Update HTML_MOCKUP_PROMPTS.md to reference format specifications

---

*Prepared for MASTER_DESIGN_DOCUMENT.md enhancement*  
*December 17, 2025*
