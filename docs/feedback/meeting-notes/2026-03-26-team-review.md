# Team Review Meeting — 2026-03-26

**Source:** Recorded meeting transcript (`audio1485421573.txt`)
**Attendees:** Nick (SPEAKER_05, facilitator), Joanna (SPEAKER_01), Patrick (SPEAKER_02), Kevin (SPEAKER_04), + 2–3 others (SPEAKER_00, SPEAKER_03, SPEAKER_06/07)
**Context:** Live walkthrough of the decision-making tool. Nick demoed the current state and solicited feedback from the team.

---

## 1. Translation & Localization

- Tool defaults to Spanish but not everything is actually translated. Some components are in English, some in Spanish.
- Translations go through a backend AI tool — risk of inaccurate translations.
- **Action:** Audit all UI strings; ensure consistent language toggle; flag and manually correct any AI mistranslations.

## 2. Solution Finder — Step 1 (Conservation Targets)

- Currently lists individual taxa groups (mammals, etc.) with separate target sliders.
- Nick: The model is **not** running individual taxa — it runs broader categories (species richness, ecosystems, strategic ecosystems).
- **Action:** Simplify Step 1 categories to match actual model inputs (biodiversity/species richness, ecosystems, strategic ecosystems).

## 3. Solution Finder — Step 2 (Includes/Excludes)

- Joanna: Replace "lock-in" / "lock-out" terminology with "include" / "exclude" — more intuitive for general audience.
- Nick: Some toggles say "include," others say "exclude" — confusing. Standardize so it's all "include" (toggle on = included).
- Nick: Make sure the options actually reflect what the model supports (e.g., mining is **not** currently modeled).
- Joanna: Need tooltip / info icons explaining what each option means in the context of the model run.

## 4. Solution Finder — Step 3 (Scenario Matching Results)

This section received the most criticism and is a candidate for removal/overhaul.

- **Match percentage is confusing:** Nobody could tell what the 90%/89% scores meant or why two very different input configurations produced only 1% difference (SPEAKER_03).
- **Joanna:** For decision-making, need to know *exactly* why a scenario isn't at 100% — what's limiting it.
- **Patrick (strong opinion):** The similarity matching score is not useful and potentially misleading. First thing users should see is the map + diagnostics of representation targets met, not a matching score.
- **Patrick:** Scenario codes are inscrutable (`ECOS30`, `RUNAP`, `HFCommunidatus`). Need human-readable names. Should show percent of target attained per feature, not a single number.
- **Kevin:** Some scenario descriptions are actually wrong (ECOS 30/17 labeled as ecosystem types but are actually species richness).
- **Kevin (counterpoint to removal):** Useful to show when a requested scenario doesn't exist so users know they need to run it themselves.
- **Patrick:** Comparing many scenarios could be useful later (hierarchical clustering like Jeff Hansen showed), but not as the entry point.
- **Nick's proposal:** Instead of showing a list of partial matches, inputs should map to exactly one scenario output. If that configuration hasn't been run, indicate that.
- **Consensus:** Step 3 in its current form should be overhauled or removed. The matching score adds confusion, not clarity.

## 5. Solution Finder — UX Issues

- The "Load Scenario" button is hidden at the bottom of the panel and not findable. The panel may need scrolling or the button needs better placement.
- Patrick: Results are all within 5% of each other — low information value and users' eyes will just go to the top result regardless.

## 6. Map & Layers Panel (Left Sidebar)

- **Suitup shapefile is incorrect** — currently shows RUNAP (protected areas) instead of actual suitup boundaries. Kevin confirmed they still don't have the correct shapefile.
- **Bug:** Adding biodiversity layers doesn't show them in the "Selected Layers" section.
- **Bug:** Color picker for layers is not working.
- Administrative boundaries (departments) work and are useful for spatial drill-down.
- Input layers are consistent across scenarios; only the conservation solution output changes.
- Patrick: "Once those features get locked in, this is looking pretty slick."

## 7. Right Sidebar — Overview Tab

- Current data is **all dummy / AI-generated**. Will has not yet calculated actual values.
- "National Contribution" tile: Patrick notes it may be redundant. If scenarios are target-based, every scenario meets targets — making this metric meaningless.
- **"Zones" and "Average"** metrics: Nobody understood what these mean. Patrick suggested they might refer to discrete blobs of green (planning units). If so, landscape-level metrics (fragmentation, patch size, continuity) could be genuinely useful, but current labels are unclear.
- **Costs and trade-offs section:** Team previously agreed this doesn't make sense depending on cost layer. "Trade-off" implies judgment. Should be reconsidered.
- **Action:** Align displayed metrics with the previously agreed-upon metrics spreadsheet. Remove or rethink metrics that aren't in that doc.

## 8. Right Sidebar — Area of Interest Tab

- Clicking a department on the map auto-switches to AOI tab — works nicely.
- Breaks down biodiversity by taxa, ecosystems as pie chart, carbon benefits, water, land use, socioeconomic info, cultural/indigenous territories, marine info.
- Summary blurb at bottom puts metrics into sentence form — good for communication.
- Patrick: Looking really good; individual species data may add latency.
- **Layout question:** Should Overview and AOI look the same or different?
  - **Consensus:** Mostly the same unless certain metrics don't apply to AOI. Overview can stay higher-level with expandable sections.

## 9. Right Sidebar — Comparison Tab

- Slider for side-by-side comparison works but is not the best for overview-level comparison.
- **Joanna (key feedback):** Color-coded overlay is far more useful than slider for comparing two scenarios.
- **Patrick:** Agrees — slider is good for zoomed-in inspection, color overlay is better for overview.
- **Nick's summary of consensus:**
  - Default to color overlay: Solution A = color 1, Solution B = color 2, Overlap = color 3.
  - Keep slider as an optional tool.
  - Second solution should appear in selected layers on the left sidebar.
  - Users should be able to change the comparison colors.
- **Bug:** Cannot unselect an area of interest once selected.
- **Bug:** Tab navigation breaks after entering comparison mode — can't switch tabs.

## 10. Export Features

- Export report button exists but is non-functional. **Lower priority** than getting metrics meaningful.
- "Export data" needs clarification — tabular metrics? Solution as data? Map image?
- Map export also mentioned.

## 11. General Notes

- Patrick will be out the following week.
- Holy Week is coming — may not hear from the Mesa team before that.
- Meeting will likely repeat weekly for continued review as Will makes progress.
