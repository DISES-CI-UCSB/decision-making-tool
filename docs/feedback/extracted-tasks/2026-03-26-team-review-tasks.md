# Extracted Tasks — Team Review 2026-03-26

**Source:** [Meeting notes](../meeting-notes/2026-03-26-team-review.md)
**Linear project:** Decision Making Tool
**Linear labels:** `team-review` + branch label + additional tags as noted
**Tickets filed:** UCS-119 through UCS-146 (28 issues)

**Additional tags used:**
- `discussion-required` — needs team discussion/consensus before implementation
- `blocked-external` — blocked on input, data, or deliverable from someone outside the dev team

---

## Task Summary

| ID | UCS | Priority | Labels | Task | Refs | Notes |
|----|-----|----------|--------|------|------|-------|
| T01 | [UCS-119](https://linear.app/ucsb-spatial-center/issue/UCS-119) | High | `foundation` | Audit and fix translation coverage across all UI components | | Some components untranslated; AI translations may be inaccurate |
| T02 | [UCS-120](https://linear.app/ucsb-spatial-center/issue/UCS-120) | High | `solution-finder` | Simplify Step 1 categories to match actual model inputs | D07 | Replace individual taxa with broader categories: species richness, ecosystems, strategic ecosystems |
| T03 | [UCS-121](https://linear.app/ucsb-spatial-center/issue/UCS-121) | High | `solution-finder` | Standardize Step 2 toggles to all use "include" pattern | | Currently a mix of include/exclude which is confusing |
| T04 | [UCS-122](https://linear.app/ucsb-spatial-center/issue/UCS-122) | Medium | `solution-finder` | Replace "lock-in"/"lock-out" with "include"/"exclude" in scenario descriptions | | Joanna: current terms are jargon-heavy |
| T05 | [UCS-123](https://linear.app/ucsb-spatial-center/issue/UCS-123) | High | `solution-finder` | Add tooltip/info icons to Step 1 and Step 2 options explaining what each means | | Users need context on what conservation targets and include/exclude actually do |
| T06 | [UCS-124](https://linear.app/ucsb-spatial-center/issue/UCS-124) | High | `solution-finder`, `discussion-required` | Overhaul Step 3: inputs → single solution + map preview | D01, D06 | **See detailed notes.** Mockup single-solution approach, but NOT canonical until team consensus. |
| T07 | [UCS-125](https://linear.app/ucsb-spatial-center/issue/UCS-125) | Medium | `solution-finder`, `discussion-required` | Ensure Step 2 options reflect actual model capabilities | D07 | **See detailed notes.** Need Kevin/team verification. MDD may not be complete. |
| T08 | [UCS-126](https://linear.app/ucsb-spatial-center/issue/UCS-126) | High | `solution-finder`, `discussion-required` | Make scenario descriptions human-readable | D08 | **See detailed notes.** Need ideation pass + Kevin's domain input on naming. |
| T09 | [UCS-127](https://linear.app/ucsb-spatial-center/issue/UCS-127) | Medium | `solution-finder`, `discussion-required` | Fix scenario descriptions that are factually wrong | D08 | Source of truth unclear — MDD may not paint full picture. Need Kevin confirmation. |
| T10 | [UCS-128](https://linear.app/ucsb-spatial-center/issue/UCS-128) | Medium | `solution-finder` | Fix "Load Scenario" button visibility — hidden at bottom of panel | | **See detailed notes.** Need to test at multiple screen sizes; may not be reproducible. |
| T11 | [UCS-129](https://linear.app/ucsb-spatial-center/issue/UCS-129) | Medium | `solution-finder`, `discussion-required` | Design "Solution Not Found" behavior and states | D01, D06 | **See detailed notes.** Critical questions about solution space coverage for team. |
| T12 | [UCS-130](https://linear.app/ucsb-spatial-center/issue/UCS-130) | Medium | `map-spatial`, `blocked-external` | Replace suitup shapefile with correct boundaries | | Need correct shapefile from Mesa team. Someone needs to reach out. |
| T13 | [UCS-131](https://linear.app/ucsb-spatial-center/issue/UCS-131) | High | `map-spatial` | Fix: Adding biodiversity layers doesn't show in Selected Layers | | Layer selection bug — layers don't appear after being added |
| T14 | [UCS-132](https://linear.app/ucsb-spatial-center/issue/UCS-132) | Medium | `map-spatial` | Fix: Color picker for layers not working | | Cannot change layer colors |
| T15a | [UCS-133](https://linear.app/ucsb-spatial-center/issue/UCS-133) | High | `analysis-dashboards`, `discussion-required` | Audit Overview tab metrics against finalized metrics CSV | D09 | **See detailed notes.** Remove metrics not in CSV unless explicitly re-requested. |
| T15b | [UCS-134](https://linear.app/ucsb-spatial-center/issue/UCS-134) | High | `analysis-dashboards` | Calculate real metric values from input data layers | D09 | **See detailed notes.** Major undertaking — data pipeline, formulas, unit tests, manual review. |
| T16 | [UCS-135](https://linear.app/ucsb-spatial-center/issue/UCS-135) | Medium | `analysis-dashboards`, `discussion-required` | Remove or rethink "National Contribution" tile | D09 | Need to understand what this means in context. Patrick: redundant if target-based. Is it in finalized metrics CSV? |
| T17 | [UCS-136](https://linear.app/ucsb-spatial-center/issue/UCS-136) | Medium | `analysis-dashboards` | Clarify or replace "Zones" and "Average" metrics | D04 | Nobody understood these; consider landscape metrics (fragmentation, patch size, continuity) |
| T18 | [UCS-137](https://linear.app/ucsb-spatial-center/issue/UCS-137) | Medium | `analysis-dashboards`, `discussion-required` | Remove or rethink "Costs and trade-offs" section | D09 | Is this in the finalized metrics CSV? If not, remove unless team explicitly requests. |
| T19 | [UCS-138](https://linear.app/ucsb-spatial-center/issue/UCS-138) | Medium | `analysis-dashboards` | Make Overview and AOI tabs structurally consistent | | Consensus: same layout unless metrics don't apply to AOI; Overview can have expandable sections |
| T20 | [UCS-139](https://linear.app/ucsb-spatial-center/issue/UCS-139) | High | `analysis-dashboards` | Comparison view: color-coded overlay + opacity mode | | **See detailed notes.** Two visualization options for comparison view (right sidebar). Keep slider as optional. |
| T21 | [UCS-140](https://linear.app/ucsb-spatial-center/issue/UCS-140) | Medium | `analysis-dashboards` | Show second comparison scenario in Selected Layers on left sidebar | | Currently only the first solution appears |
| T22 | [UCS-141](https://linear.app/ucsb-spatial-center/issue/UCS-141) | Medium | `analysis-dashboards` | Allow users to customize comparison overlay colors | | Mentioned during comparison discussion |
| T23 | [UCS-142](https://linear.app/ucsb-spatial-center/issue/UCS-142) | High | `analysis-dashboards` | Fix: Cannot unselect area of interest once selected | | Bug — no way to deselect/clear AOI |
| T24 | [UCS-143](https://linear.app/ucsb-spatial-center/issue/UCS-143) | High | `analysis-dashboards` | Fix: Tab navigation breaks after entering comparison mode | | Bug — cannot switch tabs after comparison is loaded |
| T25 | [UCS-144](https://linear.app/ucsb-spatial-center/issue/UCS-144) | Low | `analysis-dashboards` | Implement export report functionality | | Lower priority than getting metrics correct; currently non-functional |
| T26 | [UCS-145](https://linear.app/ucsb-spatial-center/issue/UCS-145) | Low | `analysis-dashboards` | Define and implement "Export data" feature | | Clarify scope: tabular metrics? Solution data? Map image? |
| T27 | [UCS-146](https://linear.app/ucsb-spatial-center/issue/UCS-146) | Medium | `foundation` | Fix base map label — says "Gulf of Mexico" | | Should reference the correct geographic area |

---

## Detailed Notes

### T06 — Overhaul Step 3: inputs → single solution + map preview

**Status:** `discussion-required` (D01, D06)

The team consensus is that the matching % score is confusing and not useful. The proposed direction is to make the input toggles in Steps 1 and 2 map to **a single solution** (rather than a ranked list of partial matches).

**Immediate plan:** Create a mockup showing inputs → single solution + quick map preview JPG in the right column of the Solution Finder modal. This is a **proposal to present at a future meeting**, NOT the canonical design until team consensus is achieved.

**Key dependency:** This approach requires careful solution creation planning — the input parameter space must be well-covered so users aren't frustrated by setting valid combinations that return nothing. See D06.

### T07 — Ensure Step 2 options reflect actual model capabilities

**Status:** `discussion-required` (D07)

Need verification from Kevin and the team on exactly which features are modeled. The Master Design Document can be cross-referenced as a starting point, but it may not be complete or accurate. Cursor can help review docs, but the final answer requires Kevin's confirmation.

Example: mining is mentioned as an include/exclude option in the UI but may not be modeled. Need a definitive list of what's in vs. out.

### T08 — Make scenario descriptions human-readable

**Status:** `discussion-required` (D08)

Current codes (`ECOS30`, `RUNAP`, `HFCommunidatus`) are inscrutable. No clear answer yet on what human-readable names should be. Approach:
1. Take a first pass at ideation to refine mental model of what we're building
2. Bring ideas to Kevin for domain-specific naming conventions
3. Iterate with team

### T10 — Fix "Load Scenario" button visibility

Need to test at different screen sizes — this may be viewport-dependent. **Sub-step:** attempt to reproduce the bug. It may not be present on all machines/resolutions. If not reproducible, gather more info on the reporter's screen setup.

### T11 — Design "Solution Not Found" behavior and states

**Status:** `discussion-required` (D01, D06)

This is more than a simple 404 state. Need to distinguish between two cases:

1. **"Not Found, but we should have"** — The input combination is valid and expected, but we haven't pre-calculated it yet. This is a gap in our solution library.
2. **"Not Found, by design"** — We intentionally didn't create a solution for these parameters. The user needs to run their own, and we should explain how.

**Critical questions to raise with the team:**
- "What I'm hearing is that we need to pre-calculate all possible solutions based on the input parameters we allow users to modify. Is this what everyone is wanting?"
- "It may be frustrating for users if they set parameters and there are no solutions for the combination they care about."
- "Can we plan to calculate solutions for ALL possible combinations? This workload may get very intensive."
- "If not all combinations, what percentage of the solution space do we plan to cover?"

### T15a — Audit Overview tab metrics against finalized metrics CSV

**Status:** `discussion-required` (D09)

Some metrics in the Overview tab do NOT appear in the finalized metrics CSV. These should be **removed entirely** unless the team explicitly requests them in a future meeting. This is a prerequisite for T15b.

### T15b — Calculate real metric values from input data layers

This is a major undertaking involving:
- Getting additional input data layers
- Ensuring data can be pulled in performantly
- Using the correct formulas
- Writing unit tests that test calculation code properly
- **Manual review** by the team — we can't accidentally report wrong numbers to stakeholders

Consider writing calculation logic in R so scientists can review the math directly. Vibe-code an initial pass + auto-generated unit tests, but manual verification is non-negotiable.

### T20 — Comparison view: color-coded overlay + opacity mode

This task is for the **comparison view in the right sidebar**. Two visualization options to implement:

1. **Three-color overlay:** Solution A = color 1, Solution B = color 2, Overlap = color 3
2. **Two-color with adjustable opacity:** Each solution as its own layer color, default ~70% opacity so overlap is visible through transparency

Both options should be available to the user. Keep the existing slider as an optional tertiary tool (useful when zoomed in, per earlier team feedback).

---

## Discussion Points

These are items requiring team consensus before implementation can proceed. Tasks referencing a discussion point have its ID in the **Refs** column above.

| ID | Topic | Context | Decision Needed | Related Tasks |
|----|-------|---------|-----------------|---------------|
| D01 | Single scenario vs. list of matches | Nick proposes inputs → one scenario; Kevin wants "doesn't exist" indicator | How to handle scenario selection UX — design spec needed | T06, T11 |
| D02 | Hierarchical clustering for scenario comparison | Patrick referenced Jeff Hansen's approach for understanding scenario similarity | Future feature? Out of scope for now? | |
| D03 | Which metrics to highlight in Overview | Need to reference the previously-agreed metrics spreadsheet | Will needs access to the spreadsheet to implement | T15a |
| D04 | Landscape-level metrics | Patrick suggested fragmentation, patch size, continuity as useful | Define which landscape metrics to include | T17 |
| D05 | Individual species data in AOI | Patrick noted this may inject lag/latency | Performance vs. detail tradeoff | |
| D06 | Solution space coverage | If inputs → single solution, we must pre-calculate most combinations. Workload may be very intensive. | What % of possible combinations do we plan to cover? How do we handle gaps? | T06, T11 |
| D07 | Model input verification | Step 1 and 2 options must match what the model actually supports. MDD may be incomplete. | Kevin needs to provide definitive list of modeled features and constraints. | T02, T07 |
| D08 | Scenario naming conventions | Codes like ECOS30 are inscrutable. Need human-readable naming. | Kevin/team to define naming scheme for scenarios. | T08, T09 |
| D09 | Metrics source of truth | Some displayed metrics may not be in the finalized metrics CSV. | Audit against CSV; remove anything not in it unless team re-requests. | T15a, T15b, T16, T18 |

---

## QA Checklist (draft — to evolve over time)

These are cross-cutting items that should work correctly before any release:

- [ ] All UI strings translate correctly between English and Spanish
- [ ] No AI mistranslations in either language
- [ ] Step 1 categories match actual model inputs
- [ ] Step 2 toggles only show features the model supports
- [ ] All input layers appear in Selected Layers when added
- [ ] Color picker works for all layers
- [ ] Layer drag-reorder works
- [ ] Scenario descriptions are accurate and human-readable
- [ ] "Load Scenario" button is visible and accessible
- [ ] Administrative boundary layers load correctly
- [ ] Suitup boundaries use correct shapefile
- [ ] Overview metrics show real calculated values (not dummy data)
- [ ] AOI tab populates when clicking a department on the map
- [ ] AOI can be selected and deselected
- [ ] Tab navigation works in all states (overview, AOI, comparison)
- [ ] Comparison mode loads second scenario correctly
- [ ] Color overlay comparison renders with three distinct colors
- [ ] Opacity-based comparison renders correctly at default 70%
- [ ] Slider comparison works when toggled on
- [ ] Second scenario appears in Selected Layers
- [ ] Export report generates a document (when implemented)
- [ ] Export data produces expected output (when implemented)
- [ ] Map export produces an image (when implemented)
