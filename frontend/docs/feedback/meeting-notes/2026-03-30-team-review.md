# Team Review Meeting — 2026-03-30

**Source:** Recorded meeting transcript (`Mar 30 at 9_07 AM.txt`)
**Attendees:** Will (Speaker 1, presenting tool), Amy (Speaker 3, facilitation), Kevin (Speaker 4, domain/model expert), Nick (end of meeting, agenda), Wenxin (mentioned for projection task), + 1–2 others (Speaker 5, 8)
**Context:** Follow-up to 2026-03-26 review. Focus: Solution Finder inputs, cost layers, comparison visualization, and prep for Monday Mesa meeting.

**Supplemental:** Kevin's email correction (received same day) — "CO" is NOT carbon cost. It is `Net_Benefit` aka "renta agropecuaria" (income/profit/rental value from agricultural, livestock, forestry, or fishing activities).

---

## 1. Solution Finder — Step 1 (Features to Prioritize / "What to Protect")

### Key Decision: Multi-select, not single-select

Will's current UI only allows selecting **one** target type (radio-button style). The team confirmed that **multiple features must be selectable** simultaneously.

Kevin confirmed: at the national level, runs are always based on **one** of the feature categories (species richness OR strategic ecosystems, not both). However, Kevin then pulled up a spreadsheet showing runs that **do** include multiple features (e.g., ecosystems + strategic ecosystems + species + carbon biomass + water recharge). So the tool must support multi-select.

### The five feature categories

Amy shared the yellow slides from the Mesa team's original decision-tree presentation. The five categories are:

1. **Ecosystems**
2. **Strategic Ecosystems**
3. **Species** (species richness — note: the data layer is labeled `ecosistemas` in the raw files, which caused AI mislabeling)
4. **Environmental / Ecosystem Services** (biomass and water provisioning)
5. **Other Natural and Cultural Elements** (not used as a prioritization feature — Kevin says it's only used as an include within runs)

**Discussion:** Whether #5 should appear in Step 1 at all, since it's only used as an include. Possible that it belongs in Step 2 instead.

### Target levels

Each feature uses **17%** or **30%** as the target level. This stays as-is.

### Terminology

Will asked if "Target Type" is the right label. Kevin: in Prioritizr model language, these are called **"features"**. The team may ask the Mesa for their preferred term. Amy proposed the narrative label: **"What to Protect"**. (Technically, it already says "What to Protect", so this just flags that we should not change this label.)

### Label accuracy issues

- `Eco17` = species richness at 17% (not ecosystems at 17%)
- Kevin will share his spreadsheet with Will so labels can be corrected
- Will noted: descriptions are AI-generated from raw file names and need manual correction

## 2. Solution Finder — Step 2 (Features to Include)

### Key Decision: Drop "exclude" entirely

Amy asked whether excludes exist in the model. Kevin confirmed: **there are no excludes** in the current runs — only includes. One exception: **climate refugia** is inverted (used as a cost layer), but Kevin didn't consider it an exclude.

**Consensus:**
- Rename from "Include / Exclude" → just **"Features to Include"**
- The on/off toggle pattern stays, but framing is always "include" (on = included, off = not included)
- No "exclude" column or toggle needed

### "Always Included" section

Will showed a section communicating features that are included in **every** run (e.g., RUNAP at the national level). Users can't toggle these off. The team didn't object to showing this — it helps users understand what goes into the solution.

### Discussion item for Monday Mesa meeting

Amy flagged: **"Will there ever be excludes?"** — to be asked on Monday.

## 3. Solution Finder — Step 3 (Costs)

### Key Decision: Single cost layer at a time

Amy asked Kevin: are there ever multiple cost layers in a single run? Kevin confirmed: **just one cost at a time**.

### Cost layers in use

| Cost Layer | Status | Notes |
|---|---|---|
| **Human Footprint** | Primary, most runs | Main cost layer; also has a projected-to-2030 version |
| **Agricultural Rent / Net Benefit** | Used in ~50-60 runs total | Kevin's email: this is `Net_Benefit` aka "renta agropecuaria" — NOT "carbon cost" as Will initially labeled it |
| **Conflict** | Sparse, wonky data | Mostly high values near major cities; methodology unclear (Diego couldn't explain at CDOP workshop) |
| **Climate Refugia** | Used as inverse cost | Higher refugia = prioritize protection; must be inverted for the model |

### Data quality concerns

**Agricultural Rent:** Max value ~2M Colombian pesos, minimum is zero. The zero values fill in wherever there's no agricultural activity, which causes the model to treat those areas as "free" — leading to solutions that look like they're selecting everything. Kevin: the high values appear concentrated in urban areas (e.g., Bogotá).

**Conflict:** Similarly sparse — mostly near cities. Methodology was questioned at the CDOP workshop and not clearly answered.

**Proposed simplification:** Amy suggested that if Human Footprint and Agricultural Rent are highly correlated, it may not add value to run both. Kevin agreed to check the correlation. If correlated, the team could push to **simplify to Human Footprint + Climate Refugia** as the only cost layers, which would also simplify Step 3 (or potentially eliminate it).

### Action items

- Kevin: Pull count of how many solutions use Agricultural Rent vs. Conflict vs. Climate Refugia as costs
- Kevin: Check correlation between Human Footprint and Agricultural Rent
- Kevin: If Agricultural Rent is kept, the data needs **normalization** (zero-to-one scaling) — Prioritizr doesn't handle extreme digit ranges well
- Monday discussion: Gently push to simplify cost layers to Human Footprint (+Climate Refugia)

## 4. Step Naming Convention

Amy proposed narrative step names:

| Step | Old Label | New Label |
|---|---|---|
| Step 1 | Target Type | **What to Protect** |
| Step 2 | Include / Exclude | **Features to Include** |
| Step 3 | Cost Layers | **Costs** |

No objections. Kevin: "Step two, great. Love it. No notes."

## 5. Sub-Optimal Match Visualization (Future Feature)

Kevin proposed a UX approach for when a user's input combination doesn't have a **perfect** solution match:

- When a perfect match exists: everything in Steps 1–3 stays highlighted normally
- When the user selects a **sub-optimal** result card: the mismatched options in Steps 1, 2, or 3 **gray out** dynamically to show what's different about that solution vs. what the user requested

**Example:** User requests 30% ecosystems + species + OMAX + community data. No perfect match. The closest solution doesn't include community data. When hovering/selecting that result, the community data toggle in Step 2 would gray out.

Will confirmed this is technically feasible. However, **if all solution combinations are pre-run**, this feature becomes unnecessary (there would always be a perfect match).

**Consensus:** Ideal is to pre-run all combinations. Sub-optimal match visualization is a fallback if that's not feasible.

## 6. Comparison Visualization

### Key Decision: Remove two-color opacity option

Will showed three comparison visualization options:
1. **Three-color overlay** — Solution A color + Solution B color + Agreement/overlap color
2. **Two-color opacity** — Just the two solution colors, no explicit overlap highlighting
3. **Swipe slider** — Side-by-side comparison with a draggable divider

Amy: "I love the three color thing." Kevin found two-color confusing ("how's that different?").

**Consensus:** Keep only **three-color overlay** and **swipe slider**. Remove two-color opacity.

Amy: "The agreement one in particular. I think people will really like the ability to see where the two solutions collide."

Will noted users can toggle the agreement layer on/off within the three-color mode if they want the two-color look.

## 7. Map — Projection / Simplification Issue

Amy noticed the green raster solution layer appears **shifted down** and **oversimplified** relative to vector polygon boundaries (RUNAP national parks). Two possible causes:

1. **Projection mismatch** between raster and vector layers
2. **Oversimplified vector boundaries** (too few vertices when rasterized)

Could be on the tool side or the data side (how the Mesa team rasterized the input).

**Action:** Wenxin to investigate with Will and Kevin — check which vector the Mesa is using and whether this is a projection issue in the tool or in their data.

## 8. Other Notes

- Will still needs to implement the RUNAP label fix (currently mislabeled as "C-RAP" / SINAP in the tool)
- Will to deploy a **live link** so team members can tinker with the tool and gather feedback
- Layer stacking order controls are not working (noted but not prioritized)

## 9. Monday Mesa Meeting Agenda (Nick)

Meeting is 1 hour. Rough agenda:

1. **Brief intros** — Monica is the new Round Table coordinator for this calendar year
2. **Updates from their end** — marine solutions, other work from the past couple months
3. **Walk through tool updates** — show new Solution Finder, discuss solution inputs
4. **Model solution questions** — clarify runs, includes, costs
5. **Updated timeline and next engagements** — confirm bi-weekly cadence, start planning next CDOP workshop (in-person?)

Amy suggested combining items 3 and 4: show the tool and let the questions flow naturally from the demo.

### Questions for Monday

- Confirm all 5 feature categories for Step 1
- Will there ever be excludes?
- Can we simplify cost layers to just Human Footprint (+Climate Refugia)?
- Agricultural rent data: where did it come from? Can we normalize it?
- Representativity vs. range — still unresolved from earlier meetings
- How many runs do they envision? (Is it 8 or 2,000?)
- When should we start planning the next CDOP workshop?

## 10. Kevin's Email Correction (Post-Meeting)

> "The only thing is that 'CO' isn't carbon cost. It's actually 'Net_Benefit' aka 'renta agropecuaria' (refers to the income, profit, or rental value generated from agricultural, livestock, forestry, or fishing activities.)"
>
> "I'm sure the team will have some things they would want to add on but I personally like the simplicity of this." — Kevin Ramos
