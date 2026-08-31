# SIRAP Solution Finder — UI option matrix

This is the compact UI reference for the certified `sirap-2026-08-29-v2` catalog. It separates a card’s visual selection state from the scenario combinations that are actually available, so the finder never presents an unavailable scenario.

## Card-state language

| State | Meaning | Visual treatment |
| --- | --- | --- |
| Not selected | The user has not added an optional target feature. | White card |
| Selected; target required | The user added the feature but must still choose its target level. | Yellow card with `Required` cue |
| Complete | The user selected the feature and its certified target level. | Blue card |
| Unavailable | The choice cannot lead to a certified scenario with the selections already made. | Disabled control; do not imply it is selectable |

Important: yellow is meaningful only when a feature can be selected separately from its target. A direct percentage click moves straight from white to blue. For a visible yellow intermediate state, clicking the feature card must first select it, then reveal the target choices.

## Eje Cafetero — Step 1 target combinations

All certified Eje Cafetero scenarios include strategic ecosystems, dry forest, and Eje Cafetero wetlands. Dry forest can inherit the strategic-ecosystem target or receive its own 100% target.

| Strategic ecosystems | Dry forest | Eje Cafetero wetlands | Certified? |
| --- | --- | --- | --- |
| 17% | Inherits 17% | 70% | Yes |
| 17% | Inherits 17% | 100% | Yes |
| 17% | Separate 100% | 70% | Yes |
| 17% | Separate 100% | 100% | Yes |
| 30% | Inherits 30% | 70% | Yes |
| 30% | Inherits 30% | 100% | Yes |
| 30% | Separate 100% | 70% | Yes |
| 30% | Separate 100% | 100% | Yes |
| 50% | Inherits 50% | 100% | Yes |
| 100% | Inherits 100% | 70% | Yes |

UI constraints:

- Selecting strategic 50% disables separate dry forest and wetlands 70%.
- Selecting strategic 100% disables separate dry forest and wetlands 100%.
- Selecting strategic 17% or 30% permits both dry-forest modes and both wetlands targets.

## Orinoquía — Step 1 target combinations

Strategic ecosystems and Congriales are a paired certified target: they always have the same percentage. Savannas is selected separately.

| Strategic ecosystems | Congriales | Savannas | Certified? |
| --- | --- | --- | ---|
| 17% | 17% (paired) | 17% | Yes |
| 17% | 17% (paired) | 30% | Yes |
| 30% | 30% (paired) | 17% | Yes |
| 30% | 30% (paired) | 30% | Yes |

UI constraints:

- Congriales should be shown as a paired read-only result of the strategic-ecosystems choice, not as a separately selectable target.
- Strategic 50% and 100% are unavailable for Orinoquía.

## Step 2 and Step 3

Every complete Step 1 tuple has all four combinations below.

| Step 2 — existing conservation areas | Step 3 — cost / planning units | Certified? |
| --- | --- | --- |
| RUNAP included; OMEC off | IHEH2022 | Yes |
| RUNAP included; OMEC off | IHEH2030 | Yes |
| RUNAP included; OMEC on | IHEH2022 | Yes |
| RUNAP included; OMEC on | IHEH2030 | Yes |

RUNAP is always included and should render as a completed blue, non-editable card. OMEC is optional: white when off, blue when on. Step 2 and Step 3 stay locked until all required Step 1 target choices are complete.

## Recommended interaction sequence

1. The user clicks an optional target feature card: white → yellow.
2. The user chooses a certified target level: yellow → blue.
3. Dependent target controls become enabled only for combinations represented in the certified catalog.
4. Once the complete Step 1 tuple is blue, the user may choose OMEC and IHEH; the finder resolves the one matching certified scenario.
