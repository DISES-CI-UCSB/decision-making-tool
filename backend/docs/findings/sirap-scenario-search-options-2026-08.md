# Conservation Scenario Search — certified SIRAP options (August 2026)

This reference defines the currently certified scenario-selection space for the Conservation Scenario Search modal in Eje Cafetero and Orinoquía. It is based on the published `sirap-2026-08-29-v2` catalog and the supplied Mesa model scripts: 40 Eje Cafetero scenarios and 16 Orinoquía scenarios. The modal should offer only combinations represented in those catalogs.

The tables deliberately distinguish model inputs from results available after solving. A supplied scenario's selected targets and settings are certified solver inputs; coverage in its summary is a reported result. Coverage must not be promoted to a new target rule unless an approved evaluation contract supplies that rule.

## Reading the three modal steps

| Step | Purpose | Certified UI behavior |
| --- | --- | --- |
| Step 1 — Conservation targets | Select the regional feature-target tuple. | Offer only the listed tuple combinations, rather than independent controls whose Cartesian product could produce an unavailable scenario. |
| Step 2 — Conservation settings | Select the optional OMEC lock-in, alongside the always-locked RUNAP baseline. | RUNAP is displayed as included/locked; OMEC may be off or on. |
| Step 3 — Cost / planning units | Select the cost and corresponding planning-unit vector. | Offer `IHEH2022` or `IHEH2030` as named catalog choices. The scripts establish that each selects its matching vector, but do not provide sufficient provenance here to make science-grade claims about the 2030 variant. |

## Eje Cafetero

### Step 1 — Certified solver target controls

| Target control | Allowed values in supplied scenarios | Meaning in the solver | Notes |
| --- | --- | --- | --- |
| Strategic ecosystems (`Estr`) | 17%, 30%, 50%, 100% | Relative target applied to strategic-ecosystem features. | `Estr50` and `Estr100` occur only with the tuple shown below. |
| Dry forest (`Bs`, bosque seco) | Inherit `Estr`, or separate 100% | When inherited, dry forest remains part of the strategic-ecosystems feature matrix and receives the `Estr` target. When specified separately, it is removed from that matrix and receives 100%. | An omitted `Bs` token means inheritance; it does **not** mean that dry forest is excluded. |
| Eje Cafetero wetlands (`HuEC`) | 70%, 100% | Relative target for the Eje-specific wetlands feature. | This is a solver target, not a generic wetlands-progress criterion. |

### Step 2 — Certified conservation settings

| Setting | Allowed value(s) | Meaning | Notes |
| --- | --- | --- | --- |
| RUNAP | Always on / locked | RUNAP cells are locked into every solution. | Display as a non-editable included baseline. |
| OMEC | Off or on | When on, OMEC cells are additionally locked in. | Both catalog variants exist for every certified Eje target tuple and cost option. |

### Step 3 — Certified cost / planning-unit options

| Option | Meaning in supplied model | Notes |
| --- | --- | --- |
| `IHEH2022` | Loads `IHEH_EC_2022.rds` as the planning-unit cost vector. | Certified catalog option. |
| `IHEH2030` | Loads `IHEH_EC_2030.rds` as the planning-unit cost vector. | Certified catalog option; retain this label and avoid claiming a specific scientific interpretation without additional approved provenance. |

### Allowed Eje Cafetero target tuples

Each row below has all four Step 2 / Step 3 variants: OMEC off or on × `IHEH2022` or `IHEH2030`. This yields 10 × 2 × 2 = **40** catalog scenarios.

| `Estr` | Dry forest (`Bs`) | `HuEC` | Catalog naming example |
| --- | --- | --- | --- |
| 17% | Separate 100% | 70% | `Estr17+Bs100+HuEC70+RUNAP_IHEH2022` |
| 17% | Separate 100% | 100% | `Estr17+Bs100+HuEC100+RUNAP_IHEH2022` |
| 17% | Inherits 17% | 70% | `Estr17+HuEC70+RUNAP_IHEH2022` |
| 17% | Inherits 17% | 100% | `Estr17+HuEC100+RUNAP_IHEH2022` |
| 30% | Separate 100% | 70% | `Estr30+Bs100+HuEC70+RUNAP_IHEH2022` |
| 30% | Separate 100% | 100% | `Estr30+Bs100+HuEC100+RUNAP_IHEH2022` |
| 30% | Inherits 30% | 70% | `Estr30+HuEC70+RUNAP_IHEH2022` |
| 30% | Inherits 30% | 100% | `Estr30+HuEC100+RUNAP_IHEH2022` |
| 50% | Inherits 50% | 100% | `Estr50+HuEC100+RUNAP_IHEH2022` |
| 100% | Inherits 100% | 70% | `Estr100+HuEC70+RUNAP_IHEH2022` |

## Orinoquía

### Step 1 — Certified solver target controls

| Target control | Allowed values in supplied scenarios | Meaning in the solver | Notes |
| --- | --- | --- | --- |
| Strategic ecosystems (`Estr`) | 17%, 30% | Relative target applied to strategic-ecosystem features. | It must be paired with the matching Congriales target shown in the tuple table. |
| Congriales (`Cong`) | 17%, 30% | Relative target for the congriales feature. | The supplied script identifies this as a model feature, but does not provide enough provenance here to make a science-grade statement beyond that label and target. |
| Savannas (`Sab`) | 17%, 30% | Relative target for the Orinoquía savannas feature. | Each allowed `Estr`/`Cong` pair is available with either listed savanna target. |

### Step 2 — Certified conservation settings

| Setting | Allowed value(s) | Meaning | Notes |
| --- | --- | --- | --- |
| RUNAP | Always on / locked | RUNAP cells are locked into every solution. | Display as a non-editable included baseline. |
| OMEC | Off or on | When on, OMEC cells are additionally locked in. | Both catalog variants exist for every certified Orinoquía target tuple and cost option. |

### Step 3 — Certified cost / planning-unit options

| Option | Meaning in supplied model | Notes |
| --- | --- | --- |
| `IHEH2022` | Loads `IHEH_orinoquia_2022.rds` as the planning-unit cost vector. | Certified catalog option. |
| `IHEH2030` | Loads `IHEH_orinoquia_2030.rds` as the planning-unit cost vector. | Certified catalog option; preserve the source label without asserting unprovided scientific provenance. |

### Allowed Orinoquía target tuples

Each row below has all four Step 2 / Step 3 variants: OMEC off or on × `IHEH2022` or `IHEH2030`. This yields 4 × 2 × 2 = **16** catalog scenarios.

| `Estr` | `Cong` | `Sab` | Catalog naming example |
| --- | --- | --- | --- |
| 17% | 17% | 17% | `Estr17+Cong17+Sab17+RUNAP_IHEH2022` |
| 17% | 17% | 30% | `Estr17+Cong17+Sab30+RUNAP_IHEH2022` |
| 30% | 30% | 17% | `Estr30+Cong30+Sab17+RUNAP_IHEH2022` |
| 30% | 30% | 30% | `Estr30+Cong30+Sab30+RUNAP_IHEH2022` |

## Decoding a supplied scenario string

`Estr30+HuEC100+RUNAP+OMEC_IHEH2022` means:

- **Region / target tuple:** Eje Cafetero; strategic ecosystems target = 30%; Eje Cafetero wetlands target = 100%.
- **Dry forest:** no `Bs` token is present, so dry forest inherits the 30% strategic-ecosystem target.
- **Step 2:** RUNAP is locked in and OMEC is enabled as an additional lock-in.
- **Step 3:** the `IHEH2022` Eje Cafetero cost/planning-unit vector is used.

This is the OMEC-enabled variant of catalog solution `eje-cafetero-029` (the catalog stores the raster basename with `.tif`).

## Coverage values available after solving

The regional summaries can report achieved coverage—such as total amount, held amount, and relative held coverage—for rows evaluated by the solver and for post-hoc ecosystem/species rows. These are useful result displays and may be shown as achieved coverage with their recorded provenance.

For Orinoquía, the supplied model explicitly writes ecosystem and species rows as `evaluated = "post-hoc"` with `relative_target = NA` and `met = NA`; they report coverage, not a certified pass/fail outcome. Regional detailed summary rows generally do not provide target/status values for individual species or post-hoc ecosystems. The released UI should preserve this distinction in labels and status treatment.

## What this does not yet define

There is no approved, generic per-species or post-hoc ecosystem target criterion in the available regional summaries. In particular, do not infer a target from achieved coverage, and do not advertise an individual species or post-hoc ecosystem as having met a target merely because its reported coverage is high.

A future target-progress UI may display post-hoc coverage, but it must receive approved evaluation targets and pass/fail rules before presenting target progress or target-met status. This is a missing definition, not an indication that the coverage data itself is unusable.

## Evidence used

- Published SIRAP catalog: [sirap-2026-08-29-v2 catalog](https://aagibolq28slyfof.public.blob.vercel-storage.com/releases/sirap-2026-08-29-v2/catalog.json) — verified 56 total solutions: 40 Eje Cafetero and 16 Orinoquía.
- Eje Cafetero solver and target handling: `scripts/3_1_sirap_eje_cafetero_model.R`.
- Orinoquía solver, target handling, and post-hoc summary construction: `scripts/3_2_sirap_orinoquia_model.R`.
- Scenario dataframe construction, catalog-style name construction, regional template resolutions, and cost-vector selection mapping: `scripts/utils.R`.
- Related limitation inventory: `docs/findings/sirap-missing-metric-inputs-2026-08.md`.
