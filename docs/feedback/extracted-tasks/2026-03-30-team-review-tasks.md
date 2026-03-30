# Extracted Tasks — Team Review 2026-03-30

**Source:** [Meeting notes](../meeting-notes/2026-03-30-team-review.md) + Kevin's email correction
**Linear project:** Decision Making Tool
**Linear labels:** `team-review` + branch label + additional tags as noted

---

## Task Summary

| ID | Status | Last Updated | Task | Notes |
|----|--------|-------------|------|-------|
| T01 | 🔄 Update existing | 2026-03-30 | Enable multi-select for Step 1 features (update UCS-120) | Currently single-select; team confirmed multi-select required |
| T02 | 🔄 Update existing | 2026-03-30 | Expand Step 1 to 5 feature categories (update UCS-120) | Was 3 categories; now 5 per Mesa's original decision tree |
| T03 | 🆕 New | 2026-03-30 | Rename Step 1 header to "What to Protect"; generate label options for Steps 2 & 3 | Only Step 1 label agreed; Steps 2 & 3 need AI-generated options → team review ticket |
| T04 | ✅ Already done | 2026-03-30 | Drop "exclude" from Step 2 (UCS-121, UCS-122 already Done) | Confirmed: no excludes exist in model; both tickets already completed |
| T05 | 🆕 New | 2026-03-30 | Fix "CO" cost label → "Net Benefit" (renta agropecuaria) | Kevin's email: CO is NOT carbon cost |
| T06 | 🔄 Update existing | 2026-03-30 | Update scenario labels from Kevin's markdown (update UCS-126, UCS-127) | Kevin providing AI-generated markdown files. v1 (~70% correct) received; v2 (~90%) incoming. Update incrementally. |
| T07 | 🆕 New | 2026-03-30 | Add "Always Included" info section to Step 2 | Shows features included in every run (e.g., RUNAP); read-only, no toggles |
| T08 | 🔄 Low priority / backlog | 2026-03-30 | Design sub-optimal match visualization (update UCS-124, UCS-129) | Kevin proposed gray-out in Steps 1-3 on hover. **Low priority — may not do this.** Depends on how many solutions we end up running. |
| T09 | 🆕 New | 2026-03-30 | Remove two-color opacity comparison option | Keep only three-color overlay + swipe slider |
| T10 | ⏳ Waiting on Wenxin | 2026-03-30 | Investigate raster vs vector projection/simplification issue | Wenxin is actively working on this. Check in by Wednesday for status. |
| T11 | 🆕 New | 2026-03-30 | Deploy live link for team testing | Will to get shareable URL to team |
| T12 | 🆕 New | 2026-03-30 | Schedule mid-week review session (Will + Kevin + Amy/Nick) | Review Solution Finder changes before Monday Mesa meeting |

---

## Deduplication Map

Cross-reference of this meeting's tasks against existing Linear issues. This prevents creating duplicate tickets.

### Existing tickets that need UPDATES (not new tickets)

| Existing UCS | Existing Title | What Changed (2026-03-30) | Action |
|---|---|---|---|
| **UCS-120** | Simplify Step 1 categories to match actual model inputs | **Scope expanded:** was 3 categories → now 5 (Ecosystems, Strategic Ecosystems, Species, Ecosystem Services, Other Natural/Cultural). **Multi-select required** (was single-select). Sub-task UCS-148 (research) is Done; UCS-147 (confirm with team) is Pending Feedback — this meeting partially answers it. | Update description + add multi-select requirement |
| **UCS-124** | Overhaul Step 3: inputs → single solution with map preview | Kevin proposed sub-optimal match gray-out UX. **Low priority / backlog — may not implement.** Depends on how many solutions we run. If all combos are pre-run, this is unnecessary. | Add Kevin's UX proposal as low-priority note only |
| **UCS-125** | Ensure Step 2 options reflect actual model capabilities | Kevin providing AI-generated markdown files with correct labels. v1 (~70% correct) received; v2 (~90%) incoming. Still `discussion-required` but now with a clear path to resolution. | Add note: Kevin providing markdown; v1 available, v2 incoming |
| **UCS-126** | Make scenario descriptions human-readable | Kevin providing AI-generated markdown (not Excel). v1 ~70% correct labels received. CO → Net_Benefit confirmed. eco17 = species richness at 17%. | Apply v1 corrections now; update again when v2 arrives |
| **UCS-127** | Fix scenario descriptions that are factually wrong | Kevin's email confirms CO is Net_Benefit (not carbon cost). v1 markdown has ~70% of corrections. | Apply v1 corrections; iterate with v2 |
| **UCS-129** | Design "Solution Not Found" behavior and states | Kevin's gray-out proposal provides a possible UX direction. **Low priority / backlog.** Team prefers to pre-run all combos so "not found" is rare. | Add note: low priority, depends on solution coverage |

### Existing tickets that are CONFIRMED DONE (no action needed)

| Existing UCS | Title | Status |
|---|---|---|
| UCS-121 | Standardize Step 2 toggles to all use include pattern | ✅ Done — confirmed correct by this meeting |
| UCS-122 | Replace lock-in/lock-out with include/exclude | ✅ Done — meeting further confirms: drop "exclude" entirely, not just replace terminology |

### Existing tickets UNAFFECTED by this meeting

| Existing UCS | Title | Why unaffected |
|---|---|---|
| UCS-123 | Add tooltip/info icons to Step 1 and Step 2 | Still needed, no new info from this meeting |
| UCS-128 | Fix Load Scenario button visibility | Not discussed |
| UCS-113 | Restyle Solution Finder modal header Close control | Already Done |

---

## New Tasks (to be created in Linear)

These are genuinely new and don't overlap with any existing ticket.

### T03 — Rename Step 1 header; generate label options for Steps 2 & 3

**Priority:** High (Step 1 rename before Monday demo; Steps 2 & 3 label review is separate)
**Labels:** `solution-finder`, `team-review`, `discussion-required`

**Description:**
- **Step 1:** "Target Type" → **"What to Protect"** — team agreed on this label.
- **Steps 2 & 3:** The team did NOT agree on specific labels. "Features to Include" and "Costs" were floated but not confirmed. Create a sub-task to:
  1. AI-generate 3–5 candidate labels for each step
  2. Create a `discussion-required` ticket with the options for team review
  3. Implement the chosen labels after team sign-off

### T05 — Fix "CO" cost layer label

**Priority:** High (should be done before Monday demo)
**Labels:** `solution-finder`, `team-review`

**Description:**
Per Kevin's email: the cost layer labeled "CO" (or "carbon opportunity cost") is actually `Net_Benefit` aka **"renta agropecuaria"** — the income, profit, or rental value generated from agricultural, livestock, forestry, or fishing activities. Update label in the Solution Finder Step 3 and any scenario descriptions.

### T07 — Add "Always Included" info section to Step 2

**Priority:** Medium
**Labels:** `solution-finder`, `team-review`

**Description:**
Add a read-only informational section to Step 2 showing features that are included in **every** run and cannot be toggled off (e.g., RUNAP at the national level). Purpose: help users understand what goes into the solution without implying they can change it.

### T08 addendum — Sub-optimal match visualization (gray-out in steps)

**Priority:** Low / Backlog — may not implement at all. Depends on how many solutions we end up running.

This is an update to UCS-124 / UCS-129, not a standalone ticket. Kevin's proposal:
- When hovering/selecting a result that isn't a perfect match, dynamically gray out the mismatched options in Steps 1, 2, and 3
- Visual cue is more scannable than reading a text summary of differences
- Only needed if not all scenario combinations are pre-run
- **If we pre-run all combos, this feature is unnecessary**

### T09 — Remove two-color opacity comparison option

**Priority:** Medium
**Labels:** `analysis-dashboards`, `team-review`

**Description:**
Remove the two-color opacity comparison visualization. Keep only:
1. **Three-color overlay** (Solution A + Solution B + Agreement)
2. **Swipe slider**

Users can toggle the agreement layer off within three-color mode to get a de facto two-color view.

### T10 — Investigate raster vs vector projection/simplification issue

**Priority:** Medium
**Labels:** `map-spatial`, `team-review`
**Status:** ⏳ Waiting on Wenxin — check in by Wednesday

**Description:**
The green raster solution layer appears shifted down and oversimplified relative to the RUNAP vector polygon boundaries on the map. Possible causes:
1. Projection mismatch between raster and vector layers in the tool
2. Oversimplified vector boundaries from the Mesa team's rasterization process

Wenxin is actively investigating this. Will should check in with her by **Wednesday** for a status update and determine next steps.

### T11 — Deploy live link for team testing

**Priority:** High (before Monday)
**Labels:** `foundation`, `team-review`

**Description:**
Get a shareable URL deployed so team members can interact with the tool and gather feedback independently before the Monday Mesa meeting.

---

## Discussion Items for Monday Mesa Meeting

These are not dev tasks — they're questions to be raised at the Monday meeting with the Mesa team.

| # | Question | Context |
|---|----------|---------|
| 1 | Confirm all 5 feature categories for Step 1 | Ecosystems, Strategic Ecosystems, Species, Ecosystem Services, Other Natural/Cultural |
| 2 | Will there ever be excludes? | Currently none; Amy flagged this |
| 3 | Can we simplify cost layers to Human Footprint (+Climate Refugia)? | Ag rent and conflict data are sparse/wonky |
| 4 | Agricultural rent data: source and normalization | Extreme values (~2M pesos), many zeros; Prioritizr struggles with it |
| 5 | Representativity vs. range | Still unresolved from prior meetings |
| 6 | How many runs are envisioned? | 8? 64? 2,000? Drives whether we can pre-run all combos |
| 7 | When to start planning the next CDOP workshop? | Need timeline for next tool version readiness |
| 8 | Confirm bi-weekly meeting cadence | Or different frequency? |

---

## Team Action Items (Non-Dev, Not Tracked in Linear)

These are action items for other team members. Will does not manage these in Linear — they're recorded here for context only.

| Who | Action | Deadline | Will's follow-up |
|-----|--------|----------|-----------------|
| **Kevin** | Provide v2 AI-generated markdown (~90% correct labels) | Before mid-week review | Check in at mid-week review |
| **Kevin** | Pull count of runs using Ag Rent / Conflict / Climate Refugia costs | Before Monday | Ask at mid-week review |
| **Kevin** | Check correlation between Human Footprint and Agricultural Rent | Before Monday | Ask at mid-week review |
| **Wenxin** | Investigate projection issue (raster vs vector shift) | Ongoing | Check in by Wednesday |

### Will's own action items

| Action | Deadline |
|--------|----------|
| Update Solution Finder per decisions from this meeting | Before mid-week review |
| Schedule mid-week review (Wed/Thu/Fri) with Kevin + Amy/Nick | ASAP |
| Deploy live link for team | Before Monday |
