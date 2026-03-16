# Solution Overview — Metric Layout Design Decision

> **Issue:** [UCS-60 / ANL-04](https://linear.app/ucsb-spatial-center/issue/UCS-60)
> **Mockup:** [`mockups/solution-overview-panel.html`](../../mockups/solution-overview-panel.html)
> **Date:** 2026-03-16
> **Status:** Proposed

---

## Problem

After loading a conservation solution, the right sidebar (400–420px) displays a **Solution Overview** with ~10 key metrics. This decision determines: which metrics are most prominent, how they are grouped, what the visual layout is, and how the panel responds when space is constrained.

## Metrics Inventory (from MDD)

| # | Metric | Units | Status | Assigned Tier |
|---|--------|-------|--------|---------------|
| 1 | Conservation Goals Met | Count & % | Confirmed | **Hero** |
| 17 | National Contribution | % of Colombia | Confirmed | **Hero / Anchor** |
| 2 | Species Groups Protected | Count | Confirmed | Gains |
| 3 | Threatened Species Secured | Count | Confirmed | Gains |
| 4 | Ecosystem Coverage | km² & % | Confirmed | Gains |
| 5 | Carbon Storage Capacity | tCO2e | Confirmed | Gains |
| 6 | Water Regulation Services | m³ or index | Conditional | Gains |
| 9 | Affected Agricultural Area | km² & % | Confirmed | Costs |
| 8 | Agricultural Opportunity Cost | COP & USD | Conditional | Costs |
| 13 | Conflict Zone Overlap | km² | Conditional | Costs |

## Decision: Hero Scorecard + Compact Gains/Losses Rows

### Layout (top to bottom)

```
┌─────────────────────────────────────┐
│  HEADER                             │
│  "Conservation Scenario Overview"   │
│  Scenario name · [95% Match] · date │
├─────────────────────────────────────┤
│  HERO SCORECARD  (2-column grid)    │
│  ┌──────────┐  ┌──────────┐        │
│  │  8 / 10  │  │   12%    │        │
│  │ Goals Met│  │of Colombia│        │
│  │ ████░░░░ │  │ ████░░░░ │        │
│  └──────────┘  └──────────┘        │
├─────────────────────────────────────┤
│  SPATIAL CONTEXT (compact bar)      │
│  125,000 km² · 342 zones · Avg 365 │
├─────────────────────────────────────┤
│  ✓ GAINS — What You Get             │
│  ─────────────────────────          │
│  🐾 Species Groups      45/50  Met │
│  🛡 Threatened Species  28/32  88% │
│  🌿 Ecosystem Coverage    85%  Met │
│  🌱 Carbon Storage    2.3B   High  │
│  💧 Water Regulation     —  Pending │
│                                     │
│  ┌ narrative ─────────────────────┐ │
│  │ HIGH biodiversity protection…  │ │
│  └────────────────────────────────┘ │
├─────────────────────────────────────┤
│  ⚠ COSTS — What It Requires        │
│  ─────────────────────────          │
│  🌾 Affected Ag Area  8,500km² Mod │
│  💰 Ag Opportunity   $350M   Cond. │
│  ⚡ Conflict Overlap 95,000  Cond. │
│                                     │
│  ┌ narrative ─────────────────────┐ │
│  │ MODERATE economic impact…      │ │
│  └────────────────────────────────┘ │
├─────────────────────────────────────┤
│  NATIONAL CONTRIBUTION (anchor)     │
│  40% toward 30×30 target            │
│  ████████████░░░░░░░░░░  (30% ↑)   │
│  Protects 12% of Colombia           │
├─────────────────────────────────────┤
│  ▶ Optimization Parameters  12 grps │
│    (collapsed by default)           │
├─────────────────────────────────────┤
│  [See Full Summary Report]          │
│  [Compare Scenarios] [Download]     │
└─────────────────────────────────────┘
```

### Design Rationale

**Three visual tiers create a clear reading hierarchy:**

1. **Hero Scorecard** — Two large metric cards (Conservation Goals Met + National Contribution %) answer "Is this scenario good?" in <3 seconds. Uses the Serial Position Effect — the first things seen are remembered best.

2. **Compact Metric Rows** — Gains and Losses sections use single-line rows (icon + label + value + status chip) rather than full cards. This fits ~8 metrics in the space that cards would need for ~4, reducing scrolling in a narrow sidebar. Binary Gains/Losses grouping leverages the Framing Effect for decision-making cognition.

3. **Auto-Generated Narrative** — A 1-2 sentence summary in each section (green box for Gains, amber box for Costs) provides qualitative interpretation for non-technical stakeholders who want "what does this mean?" rather than raw numbers.

**National Contribution** is placed as a standalone "anchor" section with a full-width progress bar and a 30% target marker, giving it visual prominence without duplicating the hero scorecard.

**Optimization Parameters** are collapsed by default (progressive disclosure). Most users care about the summary metrics above; only domain experts need to drill into individual conservation group performance.

### Options Considered

| Option | Layout | Benefit | Why Not Chosen |
|--------|--------|---------|----------------|
| **A: Full Gains/Losses Card Grid** | 2-column cards for all metrics in Gains vs Losses sections | Strong decision framing, visually rich | ~800px vertical space; 2-col cards cramped at 400px; Gains (6) dwarfs Losses (3) |
| **B: Hero + Thematic Accordion** | 2 hero cards, then collapsible Biodiversity / Environment / Socio-Economic groups | Clean, professional, domain-aligned | Loses Gains/Losses decision framing; collapsed content requires clicks |
| **C: Hero + Compact Gains/Losses** ✅ | Hero scorecard + compact rows in Gains/Losses + anchor bar | Best density; preserves decision framing; clear 3-tier hierarchy | Compact rows may feel less visually "rich" (mitigated by status chips and strong typography) |

### Key Principles Applied

| Principle | How It's Applied |
|-----------|-----------------|
| Serial Position Effect | Hero scorecard is first, ensuring Goals Met and National Contribution are seen and remembered |
| Hick's Law | Binary Gains/Losses grouping reduces the user's classification effort |
| Visual Hierarchy (Gestalt) | Three tiers (hero → rows → narrative) create clear figure-ground separation |
| Miller's Law (7±2) | Gains (5 items) and Costs (3 items) both within working memory limits |

### Responsive Behavior

| Sidebar Width | Adaptation |
|---------------|-----------|
| **400-420px** (default) | Full layout as designed |
| **320-400px** | Hero scorecard stacks to single column; metric rows unchanged |
| **< 320px** | Status chips hidden; metric values use abbreviated format |

### Conditional Metrics

Metrics marked "Conditional" (Water Regulation, Ag Opportunity Cost, Conflict Zone Overlap) are handled as follows:
- **Data available:** Rendered normally with a "Conditional" chip (dashed border, gray)
- **Data unavailable:** Row is simply not rendered — no "N/A" placeholders

### Color System

| Element | Background | Border/Text | Usage |
|---------|-----------|-------------|-------|
| Gains section | `#E8F5E9` | `#2E7D32` | Metric icons, chips, narrative |
| Costs section | `#FFF3E0` | `#E65100` | Metric icons, chips, narrative |
| National Contribution | `#E3F2FD` | `#1565C0` | Hero card, progress bar |
| Neutral | `#FAFAFA` | `#EEEEEE` | Spatial context, opt params |

---

*Archive this document after ANL-05 through ANL-09 are implemented.*
