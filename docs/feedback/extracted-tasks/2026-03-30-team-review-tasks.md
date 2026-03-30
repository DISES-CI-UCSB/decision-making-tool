# Extracted Tasks — Team Review 2026-03-30

**Source:** [Meeting notes](../meeting-notes/2026-03-30-team-review.md) + Kevin's email correction
**Linear project:** Decision Making Tool
**Linear labels:** `team-review` + branch label + additional tags as noted
**Tickets filed:** UCS-152 through UCS-157 (6 new issues)

---

## Task Summary

| ID | UCS | Status | Last Updated | Task | Notes |
|----|-----|--------|-------------|------|-------|
| T01 | [UCS-120](https://linear.app/ucsb-spatial-center/issue/UCS-120) | 🔄 Update existing | 2026-03-30 | Enable multi-select for Step 1 features | Currently single-select; team confirmed multi-select required |
| T02 | [UCS-120](https://linear.app/ucsb-spatial-center/issue/UCS-120) | 🔄 Update existing | 2026-03-30 | Expand Step 1 to 5 feature categories | Was 3 categories; now 5 per Mesa's original decision tree |
| T03a | [UCS-152](https://linear.app/ucsb-spatial-center/issue/UCS-152) | 🆕 Created | 2026-03-30 | Rename Step 1 header to "What to Protect" | Team agreed on this label |
| T03b | [UCS-153](https://linear.app/ucsb-spatial-center/issue/UCS-153) | 🆕 Created | 2026-03-30 | Generate and review label options for Steps 2 & 3 | `discussion-required` — AI-generate options, team picks |
| T04 | UCS-121, UCS-122 | ✅ Already done | 2026-03-30 | Drop "exclude" from Step 2 | Confirmed: no excludes exist in model; both tickets already completed |
| T05 | [UCS-154](https://linear.app/ucsb-spatial-center/issue/UCS-154) | 🆕 Created | 2026-03-30 | Fix "CO" cost label → "Net Benefit" (renta agropecuaria) | Kevin's email: CO is NOT carbon cost |
| T06 | [UCS-126](https://linear.app/ucsb-spatial-center/issue/UCS-126), [UCS-127](https://linear.app/ucsb-spatial-center/issue/UCS-127) | 🔄 Update existing | 2026-03-30 | Update scenario labels from Kevin's markdown | v1 (~70% correct) received; v2 (~90%) incoming. Update incrementally. |
| T07 | [UCS-155](https://linear.app/ucsb-spatial-center/issue/UCS-155) | 🆕 Created | 2026-03-30 | Add "Always Included" info section to Step 2 | Shows features included in every run (e.g., RUNAP); read-only |
| T08 | [UCS-124](https://linear.app/ucsb-spatial-center/issue/UCS-124), [UCS-129](https://linear.app/ucsb-spatial-center/issue/UCS-129) | 🔄 Low priority / backlog | 2026-03-30 | Design sub-optimal match visualization | Kevin proposed gray-out. **Low priority — may not do.** |
| T09 | [UCS-156](https://linear.app/ucsb-spatial-center/issue/UCS-156) | 🆕 Created | 2026-03-30 | Remove two-color opacity comparison option | Keep only three-color overlay + swipe slider |
| T10 | [UCS-157](https://linear.app/ucsb-spatial-center/issue/UCS-157) | ⏳ Waiting on Wenxin | 2026-03-30 | Investigate raster vs vector projection issue | Check in by Wednesday for status |
| T11 | — | 🆕 Action item | 2026-03-30 | Deploy live link for team testing | Not a Linear ticket; personal action item |
| T12 | — | 🆕 Action item | 2026-03-30 | Schedule mid-week review session | Not a Linear ticket; personal action item |

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

## New Tasks (Created in Linear)

| Task | UCS | Priority | Labels |
|------|-----|----------|--------|
| Rename Step 1 header to "What to Protect" | [UCS-152](https://linear.app/ucsb-spatial-center/issue/UCS-152) | High | `solution-finder`, `team-review` |
| Generate and review label options for Steps 2 & 3 | [UCS-153](https://linear.app/ucsb-spatial-center/issue/UCS-153) | Medium | `solution-finder`, `team-review`, `discussion-required` |
| Fix "CO" cost label → "Net Benefit" | [UCS-154](https://linear.app/ucsb-spatial-center/issue/UCS-154) | High | `solution-finder`, `team-review` |
| Add "Always Included" info section to Step 2 | [UCS-155](https://linear.app/ucsb-spatial-center/issue/UCS-155) | Medium | `solution-finder`, `team-review` |
| Remove two-color opacity comparison option | [UCS-156](https://linear.app/ucsb-spatial-center/issue/UCS-156) | Medium | `analysis-dashboards`, `team-review` |
| Investigate raster vs vector projection issue | [UCS-157](https://linear.app/ucsb-spatial-center/issue/UCS-157) | Medium | `map-spatial`, `team-review` |

### Detailed Notes

**T03a / UCS-152 — Rename Step 1 header to "What to Protect"**
Straightforward rename. Team agreed on this label. Should be done before Monday demo.

**T03b / UCS-153 — Generate and review label options for Steps 2 & 3**
"Features to Include" and "Costs" were floated but NOT confirmed. This ticket covers:
1. AI-generate 3–5 candidate labels for each step
2. Present options to team for review
3. Implement chosen labels after sign-off

**T05 / UCS-154 — Fix "CO" cost layer label**
Per Kevin's email: "CO" is actually `Net_Benefit` aka "renta agropecuaria." Update in Step 3 and any scenario descriptions. Should be done before Monday demo.

**T07 / UCS-155 — Add "Always Included" info section to Step 2**
Read-only section showing features in every run (e.g., RUNAP at national level). No toggles — purely informational.

**T08 addendum — Sub-optimal match visualization (NOT a new ticket)**
Low priority / backlog update to UCS-124 / UCS-129. Kevin's gray-out proposal is a fallback only if we can't pre-run all scenario combos. May never be implemented.

**T09 / UCS-156 — Remove two-color opacity comparison option**
Keep only three-color overlay + swipe slider. Users can toggle agreement off within three-color for a de facto two-color view.

**T10 / UCS-157 — Investigate projection issue**
Wenxin is actively investigating. Will to check in by Wednesday. May be a projection mismatch or oversimplified vector boundaries from the Mesa team's rasterization.

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
