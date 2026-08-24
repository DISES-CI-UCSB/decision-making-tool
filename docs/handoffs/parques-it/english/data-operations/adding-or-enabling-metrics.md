[← Back to Data Operations](./README.md)

# Adding a new metric or enabling a metric for another domain

## Summary

Use this developer guide for either of two changes:

- **Genuinely new metric:** introduce a new stable metric identity and calculation contract.
- **Domain-enabling:** make an existing metric valid for another solution domain, currently `land` or `marine`, without creating a second identity for the same meaning.

Both are code changes, not layer-upload operations. A metric must agree across the Python catalog and dispatch, generated verbose and compact artifacts, frontend presentation, and—when custom polygons should support it—the FastAPI artifact and request contracts. A catalog or applicability change changes the catalog signature, so the safe production scope is **all solutions × all known AOIs**.

Do not use this guide to replace the complete solution catalog. Individual solution additions are supported by [Adding solutions](./adding-solutions.md); complete catalog replacement remains blocked pending a separately reviewed migration and release contract.

## First decision: new identity or domain-enabling?

| Question           | New metric                                                                             | Enable existing metric for another domain                                                              |
| ------------------ | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Stable `metric_id` | Add one new, permanent ID                                                              | Keep the existing ID                                                                                   |
| `MetricKind`       | Reuse an existing kind when semantics match; add a kind only for new dispatch behavior | Usually unchanged                                                                                      |
| Catalog entry      | Add one `MetricDefinition`                                                             | Expand `applicable_domains` on the existing definition                                                 |
| Calculator         | Add/register when no existing calculator implements the formula                        | Reuse only after proving the formula and source are valid in the new domain                            |
| Frontend           | Add the surfaces where the metric should appear                                        | Check domain selection/alias behavior; do not duplicate a blueprint unless the UI needs a separate row |
| Release scope      | All solutions × all AOIs                                                               | All solutions × all AOIs                                                                               |

If two domains use different scientific meanings, units, denominators, or authoritative sources, they are not automatically the same metric. Obtain scientific and product review before deciding whether to share an ID or define separate metrics.

## Contract checklist

### 1. Approve identity and scientific meaning

Edit `data/metrics/python/metrics_pipeline/metric_definitions.py`.

- [ ] Choose an immutable snake-case `MetricDefinition.metric_id`; never repurpose an ID after publication.
- [ ] Assign the reviewed `metric_number` and keep catalog order intentional because output and catalog signatures are order-sensitive.
- [ ] Set `label_key`, English and Spanish labels, `unit`, `format_hint`, and a precise `source_note`.
- [ ] Set `layer_id` when a raster supplies the value. Use `off_manifest_url` and `off_manifest_rendering` only when the reviewed source intentionally lives outside the runtime manifest.
- [ ] Set `applicable_domains` explicitly. The default is `frozenset({"land"})`.
- [ ] Reuse an existing `MetricKind` when its dispatch and output semantics fit. Extend the `MetricKind` literal only when the metric needs genuinely new behavior.
- [ ] Record NoData, selected-cell rules, denominator, pixel-area treatment, expected range, and status behavior for missing or invalid input.

For domain-enabling, modify the existing definition rather than cloning it. Confirm the new domain's solutions, raster grid, source layer, and denominator satisfy the same scientific contract.

### 2. Implement and register the calculator

Calculator modules live in:

```text
data/metrics/python/metrics_pipeline/calculators/
```

Place the formula with the closest existing concern, or add one focused module when the concern is new. Keep the calculator deterministic and independent of UI labels.

Register raster-backed calculators in `data/metrics/python/metrics_pipeline/calculator_registry.py`:

- `_OVERLAP_AREA_BY_LAYER`
- `_OVERLAP_PERCENT_BY_LAYER`
- `_CATEGORICAL_AREA_BY_METRIC_ID`
- `_WEIGHTED_SUM_BY_LAYER` or `_WEIGHTED_SUM_BY_METRIC_ID`
- `_WEIGHTED_PERCENT_BY_LAYER`

Choose metric-ID registration when metrics sharing a source layer use different formulas. Choose layer registration only when the layer uniquely determines the formula.

For a new kind, add a typed lookup if needed and update the registry coverage test. For domain-enabling, verify the existing registration is domain-neutral; registration alone does not prove the source is valid for the new domain.

### 3. Wire main dispatch, output, statuses, schema, and provenance

The regular pipeline dispatch is `_build_metrics()` in:

```text
data/metrics/python/metrics_pipeline/main.py
```

Existing kinds route through dedicated helpers or calculator-registry lookups. If a new `MetricKind` is added:

- [ ] Add an explicit dispatch branch; do not leave production output at the fallback `pending` status.
- [ ] Update `_preload_layer_masks()` or `_preload_layer_values()` if the new kind requires reusable subnational inputs.
- [ ] Ensure `_metrics_for_domain()` loads only inputs applicable to the solution domain.
- [ ] Emit values through the shared metric-output helpers so every row preserves `metricId`, `value`, `unit`, `status`, `source`, `notes`, `labelKey`, `formatHint`, and optional `details`.
- [ ] Use `ready` only with a numeric value. Use a null value for `blocked`, `pending`, `derivation_needed`, and `not_applicable`; use `empty` according to the existing empty-boundary contract.
- [ ] Emit `not_applicable` for unsupported domains, not `blocked`.

The shared contract is `data/metrics/python/metrics_pipeline/metrics_contract.py`. Catalog fields and `applicable_domains` are already included in `catalog_signature()`, so a catalog-only change automatically invalidates stale caches. Bump `METRICS_SCHEMA_VERSION` only when the wire shape or calculation semantics change in a way not represented by `MetricDefinition`; then update inspectors, frontend models, compact conversion, and tests together.

Generated documents carry `metricsProvenance` with `schemaVersion`, `solutionDomain`, `generationConfig`, `catalogSignature`, release ID, and pinned boundary provenance. Do not hand-edit provenance or reuse an old output after the signature changes.

`--validate-only` fetches the manifest and checks catalog-required layer presence, then exits before solution selection, boundary loading, source reads, and calculation. It is useful preflight, but only an actual generation plus inspection validates those later contracts.

### 4. Add focused pipeline tests

At minimum, update or add focused tests under `data/metrics/python/tests/`:

- calculator edge cases: expected value, NoData, zero denominator, and empty selection;
- `test_calculator_registry.py`: every raster-backed definition resolves to a calculator;
- dispatch: expected status/value/source and no loading of wrong-domain layers;
- domain gate: old domain behavior remains unchanged and newly supported domain is `ready`;
- wrong-domain output remains `not_applicable`;
- `test_metric_output.py` or contract tests when output/status/schema changes;
- `test_metrics_cache_resume.py` when catalog-signature or provenance behavior changes;
- compact round-trip coverage in `test_compact_metrics.py`;
- inspection coverage in `test_inspect_cache.py`.

Use the existing domain-focused patterns in `test_marine_pipeline_dispatch.py`, `test_marine_ecosystem_metrics.py`, and `test_ecosystem_coverage_pipeline.py`.

Run:

```bash
cd data/metrics/python
python -m pytest tests/test_calculator_registry.py \
  tests/test_metric_output.py \
  tests/test_metrics_cache_resume.py \
  tests/test_compact_metrics.py \
  tests/test_inspect_cache.py
```

Add the metric-specific test files to that command. Return to the repository root afterward.

### 5. Wire frontend overview, AOI, and comparison presentation

The primary configuration is:

```text
frontend/src/app/features/analysis/panel-switcher/panel-switcher.config.ts
```

Update only the surfaces approved for the metric:

- `OVERVIEW_SECTION_LOOKUP` assigns the overview section.
- `OVERVIEW_METRIC_BLUEPRINTS` controls overview rows.
- `AOI_ALIGNED_METRIC_BLUEPRINTS` maps known/custom-AOI rows to one or more metric IDs.
- `COMPARISON_METRIC_BLUEPRINTS` controls solution-comparison rows.
- `CUSTOM_AOI_METRIC_DEFINITIONS` supplies custom-response labels, units, and formatting.
- `CUSTOM_AOI_FAST_METRIC_IDS` or `CUSTOM_AOI_SPECIES_METRIC_IDS` controls custom-polygon requests; do not add an ID until the backend exposes it.

Domain-specific ID resolution currently lives in `frontend/src/app/features/analysis/panel-switcher/overview-metrics.utils.ts`; `mangrove_coverage` is the existing land/marine alias example. Prefer one ID when semantics are genuinely identical. Add alias logic only when separately identified domain metrics intentionally share one UI row.

Add English and Spanish UI copy in:

```text
frontend/public/i18n/en.json
frontend/public/i18n/es.json
```

The artifact `labelKey` is data, but the panel blueprint translation keys are separate and must also exist. Add methodology and source keys when the overview exposes them.

Formatting is centralized in `frontend/src/app/features/analysis/utils/metric-presentation.utils.ts`. Add area-valued IDs to `AREA_METRIC_IDS` so the km²/hectares selector converts them. Add a unit override only when the artifact's unit cannot be normalized by `getMetricDisplayUnit()`. Update `metric-presentation.utils.spec.ts`, `panel-switcher.config.spec.ts`, `overview-metrics.utils.spec.ts`, and relevant `panel-switcher.spec.ts` cases.

The DTO contract is `frontend/src/app/core/models/metric-value.model.ts`. A new ID alone does not require a model change because `CustomPolygonMetricId` is a string; status, format, geography, or wire-shape changes do.

### 6. Add custom-AOI support only when required

Known-AOI generation and custom-polygon calculation are separate implementations. A metric appearing in precomputed output does not make it available from `/metrics/custom-polygon`.

Backend adapter wiring is in:

```text
backend/app/metric_adapters.py
```

- [ ] Import or implement the matching shared calculator.
- [ ] Register overlap/percent/weighted behavior in the appropriate backend lookup.
- [ ] Ensure `IMPLEMENTED_RASTER_METRIC_IDS` includes the kind or explicit ID only after runtime inputs and dispatch are implemented.
- [ ] Update `metric_ids_for_request()` behavior only if aliases or request validation change.
- [ ] Ensure response metadata reports the ID in `implemented_metric_ids` and records used layers/unavailable reasons accurately.

If the metric needs a source not already packaged, update:

```text
backend/scripts/build_runtime_artifact.py
```

Add a reviewed `LayerSpec` or `SpeciesMatrixSpec`, source URL, rendering/value interpretation, and metric-ID association. Update `metric_coverage()` so `implemented_now`, blocked/deferred groups, and notes remain truthful. Rebuild artifacts with `--force` when bytes at an existing URL changed.

Add request and adapter tests in:

```text
backend/tests/test_raster_polygon_metrics.py
backend/tests/test_metrics_contract.py
backend/tests/test_shared_metric_adapters.py
```

Test explicit request, default-request exposure, unsupported IDs, unavailable source behavior, metadata, and parity with the shared pipeline calculator.

Run:

```bash
backend/.venv/bin/python -m pytest \
  backend/tests/test_raster_polygon_metrics.py \
  backend/tests/test_metrics_contract.py \
  backend/tests/test_shared_metric_adapters.py
```

After building target-host artifacts, recreate the backend container and require both `/ready` and a representative custom-polygon request before restoring traffic.

### 7. Understand manifest and source-input implications

A metric definition is not itself a runtime-manifest row. The manifest becomes part of the change when:

- a new calculation layer must be registered and resolved by `layer_id`;
- a source URL, rendering contract, or metadata changes;
- regular/compact/MEC/goals artifact URLs change; or
- solution domain metadata changes.

For a new source input, first use [Managing layers](./managing-layers.md) to approve, publish, register, and validate the layer. Confirm `_validate_required_layers()` can resolve its `displayUrl`, or deliberately document the reviewed off-manifest URL. Publish source bytes before generated metrics and publish metric bytes before the manifest that routes to them.

Changing a `MetricDefinition` changes the catalog signature even when no manifest field changes. Therefore the metric release still requires regenerated artifacts; a manifest publish is needed only when its routed URLs or source contracts change.

### 8. Generate regular and compact releases

Because catalog order/applicability is embedded in every solution document and there is no single-AOI selector, generate **all solutions × all AOIs**:

```bash
python data/metrics/python/metrics_pipeline/main.py \
  --manifest-url <approved-manifest-url> \
  --output-dir data/metrics/generated/<release-id>-verbose \
  --cache-dir data/metrics/cache/tier1 \
  --release-id <release-id> \
  --force

python data/metrics/python/metrics_pipeline/inspect_metrics.py \
  --output-dir data/metrics/generated/<release-id>-verbose

python data/metrics/python/metrics_pipeline/compact_metrics.py \
  --input-dir data/metrics/generated/<release-id>-verbose \
  --output-dir data/metrics/generated/<release-id>-compact \
  --release-id <release-id>
```

Add `--no-cache` when remote source bytes may be stale. Inspect, dry-run, publish, and verify both verbose and compact directories using [Metrics and runtime artifacts](./metrics-and-artifacts.md) and [Publishing and rollback](./publishing-and-rollback.md). Confirm every domain has the expected `ready`/`not_applicable` split and a matching catalog signature.

All-AOI recalculation is needed whenever the catalog, calculator, applicability, shared source, schema, or boundary contract changes. A single solution-raster change can use one solution, but its output still contains every known AOI.

### 9. Keep regular metrics, MEC, and goals separate

Do not treat these as interchangeable artifacts:

- **Regular verbose metrics** are generated by `main.py`.
- **Compact regular metrics** are a conversion of inspected verbose output by `compact_metrics.py`.
- **MEC shards** are generated separately by `mec_compact.py`, have a separate taxonomy/geography contract, and have no dedicated publisher.
- **Conservation goals** are solution-level sidecars generated by `conservation_goals.py` from solution summaries; they are not AOI metric rows and also lack a dedicated publisher/verifier.

A new regular metric does not automatically belong in MEC or goals. Change those pipelines only when the approved requirement explicitly changes their schemas or source products, then test and publish them through their separate reviewed procedures.

## Release verification

- [ ] Stable identity, units, labels, source, formula, domain applicability, and reviewer are recorded.
- [ ] Catalog validation passes, followed by a real generation that loads required boundaries and sources.
- [ ] Focused calculator, dispatch, domain, output, provenance, compact, inspection, frontend, and backend tests pass as applicable.
- [ ] Verbose and compact artifacts cover the complete solution catalog and every known-AOI geography.
- [ ] Old-domain values remain stable; newly enabled domains have scientifically reviewed values.
- [ ] Wrong-domain rows are `not_applicable`, not misleading zeros or blocked values.
- [ ] Frontend overview, AOI, comparison, translations, unit conversion, and exports show the intended metric.
- [ ] Custom-AOI request lists contain only backend-implemented IDs; artifact coverage and response metadata agree.
- [ ] New source bytes, metric artifacts, and routing manifests were published in dependency order.
- [ ] MEC and goals were either deliberately unchanged or released through their separate contracts.
- [ ] Prior immutable paths, local outputs, publish reports, and manifest archive references remain available.

## Current production gaps

- Complete solution-catalog replacement has no approved migration/reconciliation workflow; only individual additions are operator-documented.
- Metrics overwrites have no automatic archive; use immutable releases or retain complete prior outputs and reports.
- MEC and conservation-goal publication/verification remain manual and incomplete.
- Backend runtime inputs and frontend custom-AOI request lists are hardcoded registries.
- `--validate-only` does not load boundaries or execute calculations.
- Custom-AOI category-mask correctness still requires engineering review and arbitrary-polygon regression coverage.
- Manifest live-metric URL conventions and sparse-builder output naming may not match; verify the deployed format.
- Blob disaster recovery is not automated or tested.
