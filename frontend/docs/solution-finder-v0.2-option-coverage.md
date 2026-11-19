# Solution Finder v0.2 option coverage

Evidence checked: 2026-08-10

## Executive summary

The current land Solution Finder lets a user complete **160 distinct selectable states**. Only **60/160 (37.5%)** correspond to exactly one v0.2 catalog solution. The other **100/160 (62.5%)** have no solution. No selectable land state has multiple matches or a wrong match.

The gap is structural, not random. The supplied catalog supports only four strict target bundles:

```text
Ecosystems
  └─ + Strategic ecosystems
       └─ + Species
            └─ + Ecosystem services
```

A user may currently select any non-empty subset of the four domains, but the catalog only contains the four prefixes in this chain. The prerequisite behavior is therefore a product decision: the UI can enforce the chain, complete it with the user, or narrow what it offers.

## What counts as one selectable state

This report distinguishes a **finder-representable state** from a **catalog record**.

One land state is a complete selection across the finder:

1. **Step 1 — targets and percentages:** choose any non-empty subset of Ecosystems (`E`), Strategic ecosystems (`A`), Species (`S`), and Ecosystem services (`V`); independently assign 17% or 30% to every selected domain.
2. **Step 2 — constraints and tradeoff:** choose OMEC off or on and use the only enabled cost choice, Human Footprint 2022. RUNAP is implicit and always required; it is not a selectable dimension. Community Councils and Indigenous Reserves are intentionally absent.
3. **Step 3 — result:** the matcher looks for a catalog solution with exactly the selected domain set, exactly the selected percentage for each domain, the selected OMEC state, national scope, RUNAP included, no removed include types, and the selected cost. Step 3 does not add another state dimension; it displays the match, if any, and enables the action only when a result is selected.

There are 80 Step 1 states:

```text
Σ C(4, k) × 2^k, for k = 1..4
= (1 + 2)^4 - 1
= 80
```

OMEC off/on doubles these to `80 × 2 = 160` complete land states. Human Footprint 2022 is fixed within the currently enabled cost space, so it does not double the count.

By contrast, the manifest contains **168 land catalog records**. Catalog records are not interchangeable with finder states: records may use Human Footprint 2030 or heterogeneous EspRN targets that the current controls cannot express. Within the current 160-state space, each of the 60 supported states maps to exactly one record.

## Bundle-level coverage matrix

Notation:

- `E` = Ecosystems; `A` = Strategic ecosystems; `S` = Species; `V` = Ecosystem services.
- `{17,30}^k` means every ordered 17%/30% assignment across the `k` listed domains.
- Every count includes both OMEC states and Human Footprint 2022.
- Examples list Step 1 percentages in the bundle's displayed order, followed by OMEC.

| Target bundle | Supported? | Prerequisite issue | Target-level assignments | States with OMEC | Concrete examples |
|---|---:|---|---|---:|---|
| `E` | Yes | None; first prefix | `E ∈ {17,30}` | 4 supported | `E17`, OMEC off → `eco17_runap_iheh2022`; `E30`, on → `eco30_runap_omec_iheh2022` |
| `A` | No | Missing `E` | `A ∈ {17,30}` | 4 unsupported | `A17`, off; `A30`, on |
| `S` | No | Missing `E+A` | `S ∈ {17,30}` | 4 unsupported | `S17`, off; `S30`, on |
| `V` | No | Missing `E+A+S` | `V ∈ {17,30}` | 4 unsupported | `V17`, off; `V30`, on |
| `E+A` | Yes | None; second prefix | `(E,A) ∈ {17,30}^2` | 8 supported | `(17,17)`, off → `eco17_estr17_runap_iheh2022`; `(30,30)`, on → `eco30_estr30_runap_omec_iheh2022` |
| `E+S` | No | Missing `A` | `(E,S) ∈ {17,30}^2` | 8 unsupported | `(17,30)`, off; `(30,17)`, on |
| `E+V` | No | Missing `A+S` | `(E,V) ∈ {17,30}^2` | 8 unsupported | `(17,30)`, off; `(30,17)`, on |
| `A+S` | No | Missing `E` | `(A,S) ∈ {17,30}^2` | 8 unsupported | `(17,30)`, off; `(30,17)`, on |
| `A+V` | No | Missing `E+S` | `(A,V) ∈ {17,30}^2` | 8 unsupported | `(17,30)`, off; `(30,17)`, on |
| `S+V` | No | Missing `E+A` | `(S,V) ∈ {17,30}^2` | 8 unsupported | `(17,30)`, off; `(30,17)`, on |
| `E+A+S` | Yes | None; third prefix | `(E,A,S) ∈ {17,30}^3` | 16 supported | `(17,30,17)`, off → `eco17_estr30_esprep17_runap_iheh2022`; every permutation and OMEC state has one match |
| `E+A+V` | No | Missing `S` | `(E,A,V) ∈ {17,30}^3` | 16 unsupported | `(17,17,30)`, off; `(30,30,17)`, on |
| `E+S+V` | No | Missing `A` | `(E,S,V) ∈ {17,30}^3` | 16 unsupported | `(17,17,30)`, off; `(30,30,17)`, on |
| `A+S+V` | No | Missing `E` | `(A,S,V) ∈ {17,30}^3` | 16 unsupported | `(17,17,30)`, off; `(30,30,17)`, on |
| `E+A+S+V` | Yes | None; fourth prefix | `(E,A,S,V) ∈ {17,30}^4` | 32 supported | `(17,17,17,17)`, off → `eco17_estr17_serv17_esprep17_runap_iheh2022`; `(30,30,30,30)`, on → `eco30_estr30_serv30_esprep30_runap_omec_iheh2022` |
| **Total** |  |  | **80 Step 1 assignments** | **160 = 60 supported + 100 unsupported** | **No ambiguous states** |

The unsupported subtotal is exact: 12 singleton states + 40 two-domain states + 48 three-domain states = **100**. The four supported prefixes contribute 4 + 8 + 16 + 32 = **60**.

## Ecosystem services are real, but dependent

Ecosystem services are genuinely present in the supplied v0.2 catalog: **96 catalog records** contain service targets. All 96 also contain Ecosystems, Strategic ecosystems, and Species. There is no service-only record and no service record with any one of those three domains omitted. Services therefore cannot be selected independently against this catalog.

Examples verified against the manifest and matcher:

- **Supported, 17%, OMEC off:** `E17 + A17 + S17 + V17` maps to `eco17_estr17_serv17_esprep17_runap_iheh2022`.
- **Supported, 17%, OMEC on:** the same target levels map to `eco17_estr17_serv17_esprep17_runap_omec_iheh2022`.
- **Supported, 30%, OMEC off:** `E17 + A17 + S17 + V30` maps to `eco17_estr17_serv30_esprep17_runap_iheh2022`.
- **Supported, 30%, OMEC on:** `E30 + A30 + S30 + V30` maps to `eco30_estr30_serv30_esprep30_runap_omec_iheh2022`.
- **Unsupported, 17%, OMEC off/on:** `V17` alone has no match in either OMEC state.
- **Unsupported, 30%, OMEC off/on:** `E30 + A30 + V30` omits Species and has no match in either OMEC state.

Only **32 of the 96 service records** are representable and selectable in the current finder: the all-four-domain combinations using independent 17%/30% levels, Human Footprint 2022, and OMEC off/on. The remaining service records include catalog-only scenarios involving Human Footprint 2030 and/or heterogeneous EspRN species targets.

### Why “Explore selected solution” is disabled

The action is enabled only after matching has produced a selected result. For an unsupported service selection—such as services alone, or `E+A+V` without Species—the exact-set matcher returns zero results, so there is no selected result and the button remains disabled. This is the behavior shown by an unsupported selection; the disabled state does not mean services are absent from the catalog.

## Step 2, Step 3, marine, and catalog-only scenarios

### Step 2 effects

- **OMEC:** off/on is an exact match condition and doubles every land Step 1 assignment. Both OMEC states exist for every supported prefix state.
- **Human Footprint 2022:** this is the only enabled cost choice and is required for all 60 supported land states.
- **Human Footprint 2030:** records exist in the catalog, but 2030 is intentionally not exposed as a cost choice. The matcher also deliberately treats the visible Human Footprint choice as 2022 only.
- **Net Benefit:** displayed but disabled because no v0.2 solution matches that choice; it contributes zero selectable states to this report.
- **RUNAP:** always applied and required by the matcher. It is not a user-controlled multiplier.
- **Community Councils and Indigenous Reserves:** intentionally removed from the finder. The matcher rejects records containing either include type.

### Step 3 effects

The matcher requires equality, not “contains at least”: the solution's target-domain set must exactly equal the selected set, every selected domain's level must equal the solution's level, and OMEC and cost must also match. That exactness explains why selecting Services without all prerequisites does not fall back to a broader all-four-domain solution. Across the audited land states, the outcome is either exactly one match (60) or no match (100), never more than one.

### Marine behavior

Marine is a separate four-state space, not part of the 160 land states. All **4/4 marine states match exactly one solution**:

| Marine target | OMEC | Matching solution |
|---:|---:|---|
| 30% | Off | `marine_ecos30_mang30_runap_hhm` |
| 30% | On | `marine_ecos30_mang30_runap_omec_hhm` |
| 50% | Off | `marine_ecos50_mang50_runap_hhm` |
| 50% | On | `marine_ecos50_mang50_runap_omec_hhm` |

### Catalog-only scenarios excluded from the current UI

- **IHEH2030:** the catalog includes Human Footprint 2030 records, including service records, but the visible Human Footprint option is intentionally restricted to IHEH2022.
- **EspRN:** some records use heterogeneous per-species EspRN percentages. A single 17% or 30% Species control cannot represent those records, so they are catalog-valid but outside the current finder state space.

These exclusions are why “168 land records” must not be compared directly with “160 selectable states.”

## Product options for prerequisite behavior

### Option 1: Auto-select prerequisite domains, but require explicit percentages

When a user selects a downstream domain, automatically select every missing prerequisite domain. Leave each new prerequisite's percentage unset so the user must explicitly choose 17% or 30%.

- **Benefit:** preserves access to every supported target bundle and makes the dependency visible without silently choosing scientific targets for the user.
- **Tradeoff:** selecting one checkbox can change several controls, and the user must understand why Step 2 remains locked until all added percentages are supplied.

### Option 2: Disable downstream domains until prerequisites are selected

Enable Strategic ecosystems only after Ecosystems, Species only after both earlier domains, and Ecosystem services only after all three earlier domains.

- **Benefit:** impossible combinations cannot be entered, and the chain is taught progressively.
- **Tradeoff:** disabled controls can be harder to discover or interpret; clear prerequisite text is necessary to satisfy visibility-of-system-status and error-prevention principles.

### Option 3: Remove Ecosystem services from the finder despite catalog support

Remove the Services control while leaving service-bearing solutions available elsewhere in the catalog/application.

- **Benefit:** produces the smallest and simplest finder surface and avoids implying that Services are independently selectable.
- **Tradeoff:** hides 32 currently representable, valid service states from the finder and may suggest—incorrectly—that supplied solutions contain no service targets.

No option is selected in this report.

## Exhaustive appendix: all 100 unsupported land states

This appendix compactly but exhaustively defines every unsupported state. For every listed ordered percentage tuple, there are **exactly two unsupported states**:

```text
1. Human Footprint 2022, RUNAP included, OMEC off
2. Human Footprint 2022, RUNAP included, OMEC on
```

The domain order printed beside each bundle defines the tuple order. Thus no permutation or OMEC state is implicit or ambiguous.

### Unsupported single-domain bundles: 12 states

- **`A` (Strategic ecosystems):** `A17`, `A30`; each with OMEC off and on = 4 states. Missing `E`.
- **`S` (Species):** `S17`, `S30`; each with OMEC off and on = 4 states. Missing `E+A`.
- **`V` (Ecosystem services):** `V17`, `V30`; each with OMEC off and on = 4 states. Missing `E+A+S`.

### Unsupported two-domain bundles: 40 states

For each bundle below, the ordered level permutations are explicitly:

```text
(17,17), (17,30), (30,17), (30,30)
```

Each tuple has OMEC off and on, so each bundle contributes 8 states.

- **`E+S`**, tuple order `(E,S)`: all four tuples × both OMEC states = 8. Missing `A`.
- **`E+V`**, tuple order `(E,V)`: all four tuples × both OMEC states = 8. Missing `A+S`.
- **`A+S`**, tuple order `(A,S)`: all four tuples × both OMEC states = 8. Missing `E`.
- **`A+V`**, tuple order `(A,V)`: all four tuples × both OMEC states = 8. Missing `E+S`.
- **`S+V`**, tuple order `(S,V)`: all four tuples × both OMEC states = 8. Missing `E+A`.

### Unsupported three-domain bundles: 48 states

For each bundle below, the ordered level permutations are explicitly:

```text
(17,17,17), (17,17,30), (17,30,17), (17,30,30),
(30,17,17), (30,17,30), (30,30,17), (30,30,30)
```

Each tuple has OMEC off and on, so each bundle contributes 16 states.

- **`E+A+V`**, tuple order `(E,A,V)`: all eight tuples × both OMEC states = 16. Missing `S`.
- **`E+S+V`**, tuple order `(E,S,V)`: all eight tuples × both OMEC states = 16. Missing `A`.
- **`A+S+V`**, tuple order `(A,S,V)`: all eight tuples × both OMEC states = 16. Missing `E`.

Appendix reconciliation: `3 × 4 + 5 × 8 + 3 × 16 = 12 + 40 + 48 = 100` unsupported states.

## Evidence and method

Evidence was checked on **2026-08-10** against:

- `frontend/public/data/layer-manifest/manifest.json` — actual local release manifest, catalog version `0.2.0`, generated `2026-08-05T00:00:00Z`, containing 172 solutions: 168 land and 4 marine.
- `frontend/src/app/features/solution-finder/finder-modal/finder-modal.ts` — selectable domains and levels, Step 2 controls, exact target-set/level/include/cost matching, marine matching, and action-enable behavior.
- `frontend/src/app/core/models/solution-matching.utils.ts` — structured target-domain/level extraction, include flags, and the deliberate distinction between IHEH2022 and IHEH2030.
- `frontend/src/app/features/solution-finder/finder-modal/finder-modal.html` and `frontend/public/i18n/en.json` — disabled action binding and the “Explore selected solution” label.
- `/tmp/solution-finder-audit.json` — prior exhaustive enumeration, present at review time and verified with SHA-256 `7a5c5493ef5c2d8c2b9a466bdec0aa24a0be31f312d2cd41e3cd6d4b2c941569`.

The audit enumerated all 160 enabled land states and all four marine states against the same manifest and matcher semantics. Its totals and representative IDs were cross-checked against the source paths above. No evidence discrepancy was found.
