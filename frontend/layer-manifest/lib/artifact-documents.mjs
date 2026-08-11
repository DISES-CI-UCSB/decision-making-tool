import { createHash } from 'node:crypto';

const GEOGRAPHY_LEVELS = ['national', 'departments', 'municipalities', 'siraps', 'runaps', 'omecs'];
const METRICS_SCHEMA_VERSION = 4;
const CATALOG_SIGNATURE_PATTERN = /^metrics-catalog-v4:[0-9a-f]{64}$/;
const SCOPE_STATE_FORMAT = 'solution-raster-scope-state-v1';
const BOUNDARY_PROVENANCE_FORMAT = 'boundary-provenance-v1';
const SOLUTION_CATALOG_BINDING_FORMAT = 'solution-catalog-binding-v1';
/** Mirror of Python `catalog_binding()`, which artifacts must match exactly. */
const SOLUTION_CATALOG_BINDING_KEYS = new Set([
  'format',
  'releaseId',
  'catalogVersion',
  'catalogSha256',
  'speciesException',
]);
const BOUNDARY_RASTERIZATION = {
  boundaryInclusion: 'pixel-center',
  allTouched: false,
  referenceGrid: 'solution raster grid',
};
const NATIONAL_RASTERIZATION = {
  boundaryInclusion: 'none',
  allTouched: false,
  referenceGrid: 'solution raster grid',
};
const BOUNDARY_SOURCES = {
  departments: {
    url: 'https://aagibolq28slyfof.public.blob.vercel-storage.com/boundaries/igac_departments_detailed.geojson',
    sha256: '88304394fdd315f7803a65730392cafe2d0defa7b73acc068ba51d1795d3ed64',
    catalogSha256: '12a5a3ea5b5fdbe0e2348aa76614773fb8b428e429199ee0a655a9a7933c7ee0',
    geometryCollectionSha256: 'd840e04d13bdecbab8fdd99cc7c9d2d73afba6a968e5d34b13291cfde991334a',
    crs: 'EPSG:4326',
    featureCount: 33,
  },
  municipalities: {
    url: 'https://aagibolq28slyfof.public.blob.vercel-storage.com/boundaries/igac_municipalities_detailed.geojson',
    sha256: '13775cad6853b632029597e101628b6ed1051e7adc7e983864a84aa8aac9876a',
    catalogSha256: 'e175d902e48890e43299b7445c29af5eafbb0d4a5e5205a4ade0fd208ab91d3c',
    geometryCollectionSha256: '7c0aac724cababa2bfc69fefc4cd30eb16760fca6af4f06d235dff616b00c12d',
    crs: 'EPSG:4326',
    featureCount: 1105,
  },
  siraps: {
    url: 'https://aagibolq28slyfof.public.blob.vercel-storage.com/inputs/boundaries/sirap/siraps_merged_polygon_v2.geojson',
    sha256: '2a44a7a4726448959432924a11703250a444fe9e06be3324563e7b89d14912de',
    catalogSha256: 'ded62832b2d97b3d47ff20299bf9c9399abda79a45400927b0bf4062faf73864',
    geometryCollectionSha256: '83d2003347811cc2aa7599abb535d029c68e8f680d136ca01a8877a7df717e8f',
    crs: 'EPSG:4326',
    featureCount: 10,
  },
  runaps: {
    url: 'https://aagibolq28slyfof.public.blob.vercel-storage.com/inputs/includes/runap_identify.geojson',
    sha256: 'b1c940228b110e18b588ed2667b8d36f447c933a5f798adc024c51502c1a06a6',
    catalogSha256: 'ee492b9519252517a7f3589c385dda55daed31eef8b98d3ca242c1e90586c564',
    geometryCollectionSha256: 'fa123bd47ad64c01a29dd5367680b2ab72da60324fbf554f8cc4b8366960652d',
    crs: 'OGC:CRS84',
    featureCount: 1879,
  },
  omecs: {
    url: 'https://aagibolq28slyfof.public.blob.vercel-storage.com/inputs/includes/omecs_identify.geojson',
    sha256: 'b22742c079acbb09230daae68ecee09a4543765e3d4c88459f649f1e2d375b83',
    catalogSha256: '34173a94279ad1b6b553ef2aefaa2cc4adba1fb298a91a1da9e9340ae2d699f5',
    geometryCollectionSha256: '3f516e4f4389a43afd21a11e7a11299f4c59c563eb9aa57b805667218e3fef40',
    crs: 'OGC:CRS84',
    featureCount: 614,
  },
};
const MEC_ROW_LAYOUT = [
  'scopeIndex',
  'classIndex',
  'ecosystemAreaKm2',
  'preExistingCoverageKm2',
  'newPrioritizrCoverageKm2',
];
const MEC_SCOPE_STATS_FIELDS = [
  'scopeAreaKm2',
  'classifiedKm2',
  'unclassifiedKm2',
  'boundaryProvenanceRef',
];
const GOAL_FEATURE_TYPES = ['species', 'strategicEcosystems', 'ecosystems', 'other'];
const VALID_METRIC_STATUSES = new Set([
  'ready',
  'partial',
  'blocked',
  'pending',
  'derivation_needed',
  'not_applicable',
  'empty',
]);
const REGULAR_METRIC_IDS = [
  'conservation_goals_met',
  'species_groups_protected',
  'ecosystem_coverage',
  'threatened_species_secured',
  'carbon_storage_biomass',
  'water_regulation_area',
  'agricultural_area',
  'national_contribution',
  'priority_area_in_region',
  'priority_area_pct_of_region',
  'ecosystem_coverage_paramo',
  'ecosystem_coverage_dry_forest',
  'ecosystem_coverage_wetlands',
  'coral_reef_coverage',
  'mangrove_coverage',
  'marine_mangrove_coverage',
  'seagrass_coverage',
  'species_richness_mammals',
  'species_richness_birds',
  'species_richness_amphibians',
  'species_richness_reptiles',
  'species_richness_plants',
  'threatened_species_count',
  'species_pct_of_national',
  'carbon_biomass_total',
  'soil_organic_carbon',
  'carbon_pct_of_national',
  'water_regulation_pct',
  'land_use_forest_pct',
  'land_use_agriculture_pct',
  'land_use_other_pct',
  'indigenous_reservations_area',
  'community_councils_area',
  'protected_area_runap_km2',
  'national_parks_pct',
  'indigenous_territory_pct',
];
const SPECIES_METRIC_IDS = new Set([
  'species_groups_protected',
  'threatened_species_secured',
  'species_richness_mammals',
  'species_richness_birds',
  'species_richness_amphibians',
  'species_richness_reptiles',
  'species_richness_plants',
  'threatened_species_count',
  'species_pct_of_national',
]);
const TARGET_DEPENDENT_SPECIES_METRIC_IDS = new Set([
  'species_groups_protected',
  'threatened_species_secured',
]);
/**
 * Mirror of `applicable_domains` on every species-kind MetricDefinition in Python
 * (data/metrics/python/metrics_pipeline/metric_definitions.py). Species ranges come from
 * the terrestrial BioModelos package, so marine solutions must report not_applicable.
 */
const SPECIES_METRIC_APPLICABLE_DOMAINS = new Set(['land']);
const TARGET_POLICY_SOURCE = 'manifest:finderInputs.structuredTargets';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function assertExactKeys(record, expected, label) {
  assert(isRecord(record), `${label} must be an object`);
  const actual = Object.keys(record).sort();
  const sortedExpected = [...expected].sort();
  assert(
    JSON.stringify(actual) === JSON.stringify(sortedExpected),
    `${label} must contain exactly: ${sortedExpected.join(', ')}`,
  );
}

export function validateArtifactDocument(document, expected, label = 'artifact', options = {}) {
  assert(isRecord(document), `${label} must be a JSON object`);
  assert(
    document.solutionId === expected.solutionId,
    `${label}.solutionId must equal "${expected.solutionId}"`,
  );

  if (document.format === 'metrics-compact-v1') {
    validateCompactMetricsDocument(document, label, expected, options);
    return;
  }
  if (document.format === 'conservation-goals-v1') {
    validateGoalsDocument(document, label);
    return;
  }
  if (document.format === 'mec-compact-v2') {
    validateMecDocument(document, expected, label);
    return;
  }
  assert(
    document.format === undefined || document.format === 'metrics-verbose-v1',
    `${label}.format is not a supported release artifact format`,
  );
  validateVerboseMetricsDocument(document, label, expected);
}

export function validateVerboseMetricsDocument(
  document,
  label = 'regular metrics',
  expected = undefined,
) {
  const context = validateRegularDocumentProvenance(document, label, expected);
  validateCompleteGeographies(
    document.geographies,
    label,
    context,
    (metrics, metricLabel, scope) => {
      assert(metrics.length > 0, `${metricLabel} must be non-empty`);
      for (const [index, metric] of metrics.entries()) {
        const rowLabel = `${metricLabel}[${index}]`;
        assert(isRecord(metric), `${rowLabel} must be an object`);
        for (const field of ['metricId', 'status', 'unit', 'labelKey']) {
          assert(
            isNonEmptyString(metric[field]),
            `${rowLabel}.${field} must be a non-empty string`,
          );
        }
        assert(
          VALID_METRIC_STATUSES.has(metric.status),
          `${rowLabel}.status is outside the metrics contract`,
        );
        validateMetricValue(metric.status, metric.value, rowLabel, {
          allowPartialNull:
            context.provenance.speciesTargetPolicy?.kind === 'dual_reference' &&
            TARGET_DEPENDENT_SPECIES_METRIC_IDS.has(metric.metricId),
        });
      }
      validateSpeciesMetricPolicy(metrics, scope, context, metricLabel);
      validateEmptyMetricProof(metrics, scope, metricLabel);
    },
  );
}

export function validateCompactMetricsDocument(
  document,
  label = 'compact metrics',
  expected = undefined,
  options = {},
) {
  const context = validateRegularDocumentProvenance(document, label, expected);
  assert(
    isSha256(document.metricsProvenanceSha256),
    `${label}.metricsProvenanceSha256 must be a SHA-256`,
  );
  const hashableProvenance =
    options.numberLiteralDocument?.metricsProvenance ?? document.metricsProvenance;
  assert(
    document.metricsProvenanceSha256 === sha256Canonical(hashableProvenance),
    `${label}.metricsProvenanceSha256 must match metricsProvenance`,
  );
  assert(
    Array.isArray(document.metricCatalog) && document.metricCatalog.length > 0,
    `${label}.metricCatalog must be non-empty`,
  );
  for (const [index, entry] of document.metricCatalog.entries()) {
    assert(
      Array.isArray(entry) &&
        entry.length === 4 &&
        entry.slice(0, 3).every((value) => typeof value === 'string'),
      `${label}.metricCatalog[${index}] must match the Python four-field catalog row`,
    );
  }
  for (const field of ['statusCatalog', 'sourceCatalog', 'notesCatalog']) {
    assert(Array.isArray(document[field]), `${label}.${field} must be an array`);
  }
  validateCompleteGeographies(
    document.geographies,
    label,
    context,
    (metrics, metricLabel, scope) => {
      assert(metrics.length > 0, `${metricLabel} must be non-empty`);
      for (const [index, row] of metrics.entries()) {
        const rowLabel = `${metricLabel}[${index}]`;
        assert(
          Array.isArray(row) && row.length >= 5,
          `${rowLabel} must contain at least five fields`,
        );
        for (const [value, catalog, field] of [
          [row[0], document.metricCatalog, 'metricIndex'],
          [row[2], document.statusCatalog, 'statusIndex'],
          [row[3], document.sourceCatalog, 'sourceIndex'],
          [row[4], document.notesCatalog, 'notesIndex'],
        ]) {
          assert(
            Number.isInteger(value) && value >= 0 && value < catalog.length,
            `${rowLabel}.${field} must reference its catalog`,
          );
        }
        assert(
          typeof document.statusCatalog[row[2]] === 'string',
          `${rowLabel}.statusIndex must reference a string status`,
        );
        assert(
          VALID_METRIC_STATUSES.has(document.statusCatalog[row[2]]),
          `${rowLabel}.statusIndex references a status outside the metrics contract`,
        );
        validateMetricValue(document.statusCatalog[row[2]], row[1], rowLabel, {
          allowPartialNull:
            context.provenance.speciesTargetPolicy?.kind === 'dual_reference' &&
            TARGET_DEPENDENT_SPECIES_METRIC_IDS.has(document.metricCatalog[row[0]][0]),
        });
      }
      validateEmptyMetricProof(
        metrics.map((row) => ({ status: document.statusCatalog[row[2]], value: row[1] })),
        scope,
        metricLabel,
      );
      const metricIds = metrics.map((row) => document.metricCatalog[row[0]][0]);
      assertExactArray(metricIds, REGULAR_METRIC_IDS, `${metricLabel} metric IDs`);
      validateSpeciesMetricPolicy(
        metrics.map((row) => ({
          metricId: document.metricCatalog[row[0]][0],
          status: document.statusCatalog[row[2]],
          source: document.sourceCatalog[row[3]],
          notes: document.notesCatalog[row[4]],
          value: row[1],
          details: row[5],
        })),
        scope,
        context,
        metricLabel,
      );
    },
  );
}

function validateRegularDocumentProvenance(document, label, expected) {
  validateSolutionRaster(document.solutionRaster, label, expected);
  validateSolutionInputSignature(document.solutionInputSignature, label);
  const provenance = validateMetricsProvenance(document.metricsProvenance, label, expected);
  validateSolutionCatalogBinding(document.solutionCatalogBinding, label, expected);
  return {
    solutionRasterSha256: document.solutionRaster.sha256,
    provenance,
  };
}

function validateSolutionRaster(solutionRaster, label, expected) {
  assert(isRecord(solutionRaster), `${label}.solutionRaster must be an object`);
  assert(isSha256(solutionRaster.sha256), `${label}.solutionRaster.sha256 must be a SHA-256`);
  assert(
    isNonEmptyString(solutionRaster.solutionBasename),
    `${label}.solutionRaster.solutionBasename must be non-empty`,
  );
  if (expected?.rasterSha256 !== undefined) {
    assert(
      solutionRaster.sha256 === expected.rasterSha256,
      `${label}.solutionRaster.sha256 must match release catalog provenance`,
    );
  }
  if (expected?.solutionBasename !== undefined) {
    assert(
      solutionRaster.solutionBasename === expected.solutionBasename,
      `${label}.solutionRaster.solutionBasename must match release catalog provenance`,
    );
  }
}

function isSha256(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function validateMetricValue(status, value, label, { allowPartialNull = false } = {}) {
  if (status === 'partial' && value === null && allowPartialNull) return;
  if (status === 'ready' || status === 'partial') {
    assert(Number.isFinite(value), `${label}.value must be finite for ${status}`);
    return;
  }
  assert(value === null, `${label}.value must be null for ${status}`);
}

function validateEmptyMetricProof(metrics, scope, label) {
  if (!metrics.some((metric) => metric.status === 'empty')) return;
  assert(
    scope.scopeState.classification === 'empty' &&
      scope.scopeState.solutionValidCellCount === 0 &&
      scope.scopeState.selectedCellCount === 0,
    `${label} empty statuses require proven zero-support scopeState`,
  );
}

function validateScopeState(state, geographyLevel, scopeId, context, label) {
  assert(isRecord(state), `${label}.scopeState must be an object`);
  assert(state.format === SCOPE_STATE_FORMAT, `${label}.scopeState.format is invalid`);
  for (const field of ['solutionValidCellCount', 'selectedCellCount', 'boundaryGridCellCount']) {
    assert(
      Number.isSafeInteger(state[field]) && state[field] >= 0,
      `${label}.scopeState.${field} must be a non-negative integer`,
    );
  }
  assert(
    state.selectedCellCount <= state.solutionValidCellCount &&
      state.solutionValidCellCount <= state.boundaryGridCellCount,
    `${label}.scopeState cell counts must reconcile`,
  );
  const expectedClassification = state.solutionValidCellCount === 0 ? 'empty' : 'supported';
  assert(
    state.classification === expectedClassification,
    `${label}.scopeState.classification does not match support`,
  );
  const expectedReason =
    state.solutionValidCellCount === 0
      ? 'zero_solution_valid_support'
      : 'positive_solution_valid_support';
  assert(state.reason === expectedReason, `${label}.scopeState.reason does not match support`);
  assert(
    geographyLevel !== 'national' || state.solutionValidCellCount > 0,
    `${label}.scopeState national support must be positive`,
  );
  for (const field of ['targetGridSha256', 'solutionRasterSha256', 'solutionValidityMaskSha256']) {
    assert(isSha256(state[field]), `${label}.scopeState.${field} must be a SHA-256`);
  }
  assert(
    state.solutionRasterSha256 === context.solutionRasterSha256,
    `${label}.scopeState solution raster SHA mismatch`,
  );
  assert(
    state.targetGridSha256 === context.targetGridSha256,
    `${label}.scopeState target grid SHA mismatch`,
  );
  assert(
    state.solutionValidityMaskSha256 === context.solutionValidityMaskSha256,
    `${label}.scopeState validity-mask SHA mismatch`,
  );
  if (geographyLevel === 'national') {
    assert(state.boundary === null, `${label}.scopeState.boundary must be null`);
  } else {
    assert(isRecord(state.boundary), `${label}.scopeState.boundary must be an object`);
    assert(
      state.boundary.geographyLevel === geographyLevel && state.boundary.scopeId === scopeId,
      `${label}.scopeState boundary identity mismatch`,
    );
    assert(
      isSha256(state.boundary.sourceSha256) && isSha256(state.boundary.geometrySha256),
      `${label}.scopeState boundary hashes must be SHA-256`,
    );
    assert(
      state.boundary.sourceSha256 ===
        context.provenance.boundaryProvenance.sources[geographyLevel].sha256,
      `${label}.scopeState boundary source SHA mismatch`,
    );
  }
  const expectedPolicy =
    geographyLevel === 'national' ? NATIONAL_RASTERIZATION : BOUNDARY_RASTERIZATION;
  assert(
    recordsEqual(state.rasterizationPolicy, expectedPolicy),
    `${label}.scopeState.rasterizationPolicy is invalid`,
  );
}

function validateMetricsProvenance(provenance, label, expected) {
  assert(isRecord(provenance), `${label}.metricsProvenance must be an object`);
  assert(
    provenance.schemaVersion === METRICS_SCHEMA_VERSION,
    `${label}.metricsProvenance.schemaVersion must be ${METRICS_SCHEMA_VERSION}`,
  );
  assert(
    provenance.solutionDomain === 'land' || provenance.solutionDomain === 'marine',
    `${label}.metricsProvenance.solutionDomain is invalid`,
  );
  assert(
    isRecord(provenance.generationConfig),
    `${label}.metricsProvenance.generationConfig must be an object`,
  );
  assert(
    CATALOG_SIGNATURE_PATTERN.test(provenance.catalogSignature),
    `${label}.metricsProvenance.catalogSignature must use metrics-catalog-v4`,
  );
  assert(
    isNonEmptyString(provenance.releaseId),
    `${label}.metricsProvenance.releaseId must be non-empty`,
  );
  if (expected?.solutionDomain !== undefined) {
    assert(
      provenance.solutionDomain === expected.solutionDomain,
      `${label}.metricsProvenance.solutionDomain must match release catalog provenance`,
    );
  }
  if (expected?.releaseId !== undefined) {
    assert(
      provenance.releaseId === expected.releaseId,
      `${label}.metricsProvenance.releaseId must match release catalog provenance`,
    );
  }
  if (expected?.catalogSignature !== undefined) {
    assert(
      provenance.catalogSignature === expected.catalogSignature,
      `${label}.metricsProvenance.catalogSignature must match publish provenance`,
    );
  }
  validateSpeciesTargetPolicy(provenance.speciesTargetPolicy, expected, label);
  validateBoundaryProvenance(provenance.boundaryProvenance, label);
  return provenance;
}

function validateSpeciesTargetPolicy(policy, expected, label) {
  if (policy === undefined) {
    assert(
      expected?.speciesTargetPolicyEvidence === undefined ||
        expected.speciesTargetPolicyEvidence === null,
      `${label}.metricsProvenance species target policy must match manifest context`,
    );
    return;
  }
  const policyLabel = `${label}.metricsProvenance.speciesTargetPolicy`;
  assert(isRecord(policy), `${policyLabel} must be an object`);
  assert(policy.format === 'species-target-policy-v1', `${policyLabel}.format is invalid`);
  assert(
    policy.kind === 'per_species' || policy.kind === 'dual_reference',
    `${policyLabel}.kind is invalid`,
  );
  assert(policy.source === TARGET_POLICY_SOURCE, `${policyLabel}.source is invalid`);
  assert(
    Number.isSafeInteger(policy.structuredTargetCount) && policy.structuredTargetCount >= 0,
    `${policyLabel}.structuredTargetCount is invalid`,
  );
  assert(isSha256(policy.structuredTargetsSha256), `${policyLabel} target hash is invalid`);
  if (policy.kind === 'dual_reference') {
    assert(
      policy.structuredTargetCount === 0 &&
        policy.structuredTargetDimension === null &&
        policy.structuredTargetsSha256 === sha256Canonical([]),
      `${policyLabel} dual-reference policy must have zero structured targets`,
    );
    assert(
      canonicalJson(policy.referenceThresholds) === canonicalJson([17, 30]) &&
        policy.referenceThresholdsSha256 === sha256Canonical([17, 30]) &&
        policy.decisionSource === 'approved:dual-reference-species-thresholds-v1',
      `${policyLabel} dual-reference thresholds are invalid`,
    );
  } else {
    assert(
      policy.structuredTargetCount > 0 &&
        ['espRn', 'speciesRepresentation'].includes(policy.structuredTargetDimension) &&
        isRecord(policy.matchingInventory) &&
        policy.matchingInventory.matchedTargetCount === policy.structuredTargetCount,
      `${policyLabel} per-species matching inventory is invalid`,
    );
  }
  if (expected?.speciesTargetPolicyEvidence !== undefined) {
    assert(
      canonicalJson(policy) === canonicalJson(expected.speciesTargetPolicyEvidence),
      `${policyLabel} must match catalog/manifest context`,
    );
  }
}

function validateSpeciesMetricPolicy(metrics, scope, context, label) {
  if (scope.scopeState?.classification === 'empty') return;
  const solutionDomain = context.provenance.solutionDomain;
  const speciesApply = SPECIES_METRIC_APPLICABLE_DOMAINS.has(solutionDomain);
  const policyKind = context.provenance.speciesTargetPolicy?.kind ?? 'scalar';
  const hasException = isRecord(context.provenance.generationConfig?.speciesException);
  for (const metric of metrics) {
    if (!SPECIES_METRIC_IDS.has(metric.metricId)) continue;
    if (!speciesApply) {
      assert(
        metric.status === 'not_applicable',
        `${label} ${metric.metricId} must be not_applicable for the ${solutionDomain} solution domain`,
      );
      continue;
    }
    if (
      policyKind === 'dual_reference' &&
      TARGET_DEPENDENT_SPECIES_METRIC_IDS.has(metric.metricId)
    ) {
      validateDualThresholdMetric(
        metric,
        `${label} ${metric.metricId}`,
        context.provenance.generationConfig?.speciesException,
      );
      continue;
    }
    if (hasException) {
      assert(
        metric.status === 'partial',
        `${label} ${metric.metricId} must be partial under the species exception`,
      );
    }
    assert(
      metric.status !== 'not_applicable',
      `${label} ${metric.metricId} must not be not_applicable`,
    );
  }
}

function validateDualThresholdMetric(metric, label, speciesException) {
  assert(
    metric.status === 'partial' &&
      metric.value === null &&
      metric.source === TARGET_POLICY_SOURCE &&
      isRecord(metric.details) &&
      Array.isArray(metric.details.thresholdOutcomes),
    `${label} dual-reference status/provenance is invalid`,
  );
  const outcomes = metric.details.thresholdOutcomes;
  if (isRecord(speciesException)) {
    assert(
      canonicalJson(metric.details.speciesException) === canonicalJson(speciesException),
      `${label} species exception binding is invalid`,
    );
  }
  assert(outcomes.length === 2, `${label} must contain exactly two threshold outcomes`);
  assert(
    canonicalJson(outcomes.map((outcome) => outcome?.targetPercent)) === canonicalJson([17, 30]),
    `${label} thresholds must be unique and sorted as 17,30`,
  );
  for (const [index, outcome] of outcomes.entries()) {
    assert(
      isRecord(outcome) && Number.isFinite(outcome.value),
      `${label}.details.thresholdOutcomes[${index}].value must be finite`,
    );
    if (metric.metricId === 'species_groups_protected') {
      assert(
        isRecord(outcome.details) &&
          isRecord(outcome.details.summary) &&
          isRecord(outcome.details.groups),
        `${label}.details.thresholdOutcomes[${index}] group breakdown is invalid`,
      );
    }
  }
}

function validateBoundaryProvenance(boundaryProvenance, label) {
  const provenanceLabel = `${label}.metricsProvenance.boundaryProvenance`;
  assert(isRecord(boundaryProvenance), `${provenanceLabel} must be an object`);
  assert(
    boundaryProvenance.format === BOUNDARY_PROVENANCE_FORMAT,
    `${provenanceLabel}.format is stale`,
  );
  assert(isRecord(boundaryProvenance.sources), `${provenanceLabel}.sources must be an object`);
  for (const [level, expectedSource] of Object.entries(BOUNDARY_SOURCES)) {
    const source = boundaryProvenance.sources[level];
    assert(isRecord(source), `${provenanceLabel}.sources.${level} must be an object`);
    for (const [field, value] of Object.entries(expectedSource)) {
      assert(
        source[field] === value,
        `${provenanceLabel}.sources.${level}.${field} is missing or stale`,
      );
    }
    assert(
      recordsEqual(source.rasterization, BOUNDARY_RASTERIZATION),
      `${provenanceLabel}.sources.${level}.rasterization is missing or stale`,
    );
  }
  assert(
    isSha256(boundaryProvenance.sha256) &&
      boundaryProvenance.sha256 === sha256Canonical(boundaryProvenance.sources),
    `${provenanceLabel}.sha256 must match boundary sources`,
  );
}

function validateSolutionCatalogBinding(binding, label, expected) {
  assert(isRecord(binding), `${label}.solutionCatalogBinding must be an object`);
  assert(
    binding.format === SOLUTION_CATALOG_BINDING_FORMAT,
    `${label}.solutionCatalogBinding.format is invalid`,
  );
  const unknownBindingKeys = Object.keys(binding).filter(
    (key) => !SOLUTION_CATALOG_BINDING_KEYS.has(key),
  );
  assert(
    unknownBindingKeys.length === 0,
    `${label}.solutionCatalogBinding has unknown keys: ${unknownBindingKeys.sort().join(', ')}`,
  );
  assert(
    isNonEmptyString(binding.releaseId),
    `${label}.solutionCatalogBinding.releaseId is invalid`,
  );
  assert(
    isNonEmptyString(binding.catalogVersion),
    `${label}.solutionCatalogBinding.catalogVersion is invalid`,
  );
  assert(
    isSha256(binding.catalogSha256),
    `${label}.solutionCatalogBinding.catalogSha256 must be a SHA-256`,
  );
  for (const [field, expectedField] of [
    ['releaseId', 'releaseId'],
    ['catalogVersion', 'catalogVersion'],
    ['catalogSha256', 'catalogSha256'],
  ]) {
    if (expected?.[expectedField] !== undefined) {
      assert(
        binding[field] === expected[expectedField],
        `${label}.solutionCatalogBinding.${field} must match release catalog provenance`,
      );
    }
  }
  if (expected?.catalogSpeciesException !== undefined) {
    assert(
      canonicalJson(binding.speciesException ?? null) ===
        canonicalJson(expected.catalogSpeciesException ?? null),
      `${label}.solutionCatalogBinding.speciesException must match the release catalog exception`,
    );
  }
}

function validateSolutionInputSignature(signature, label) {
  assert(isRecord(signature), `${label}.solutionInputSignature must be an object`);
  assert(
    [
      'solution-input-signature-v1',
      'solution-input-signature-v2',
      'solution-input-signature-v3',
    ].includes(signature.format),
    `${label}.solutionInputSignature.format is invalid`,
  );
  assert(
    typeof signature.sha256 === 'string' && signature.sha256.length === 64,
    `${label}.solutionInputSignature.sha256 is invalid`,
  );
}

export function validateGoalsDocument(document, label = 'goals') {
  assert(isNonEmptyString(document.generatedAt), `${label}.generatedAt must be non-empty`);
  assert(isRecord(document.source), `${label}.source must be an object`);
  for (const field of [
    'metadataUrl',
    'summaryCsvUrl',
    'summaryCsvRows',
    'solutionDomain',
    'speciesLookupUrl',
  ]) {
    assert(Object.hasOwn(document.source, field), `${label}.source.${field} is required`);
  }
  assert(
    Number.isSafeInteger(document.source.summaryCsvRows) && document.source.summaryCsvRows > 0,
    `${label}.source.summaryCsvRows must be positive`,
  );
  assert(
    document.source.solutionDomain === 'land' || document.source.solutionDomain === 'marine',
    `${label}.source.solutionDomain is invalid`,
  );
  validateGoalTargetContext(document.targetContext, `${label}.targetContext`);
  validateGoalCount(document.summary, false, `${label}.summary`);
  assertExactKeys(document.summary.byType, GOAL_FEATURE_TYPES, `${label}.summary.byType`);
  validateGoalCount(document.summary.byType.species, true, `${label}.summary.byType.species`);
  for (const type of GOAL_FEATURE_TYPES.slice(1)) {
    validateGoalCount(document.summary.byType[type], false, `${label}.summary.byType.${type}`);
  }
  assert(isRecord(document.rollups), `${label}.rollups must be an object`);
  validateGoalCount(document.rollups.species, true, `${label}.rollups.species`);
  for (const type of ['strategicEcosystems', 'ecosystems']) {
    validateGoalCount(document.rollups[type], false, `${label}.rollups.${type}`);
  }
  assert(isRecord(document.diagnostics), `${label}.diagnostics must be an object`);
  for (const field of ['rawTypeCounts', 'rowCounts']) {
    assert(
      isRecord(document.diagnostics[field]),
      `${label}.diagnostics.${field} must be an object`,
    );
  }
  assertExactKeys(document.features, GOAL_FEATURE_TYPES, `${label}.features`);
  assertExactKeys(
    document.diagnostics.rowCounts,
    GOAL_FEATURE_TYPES,
    `${label}.diagnostics.rowCounts`,
  );
  for (const type of GOAL_FEATURE_TYPES) {
    assert(Array.isArray(document.features[type]), `${label}.features.${type} must be an array`);
    assert(
      document.diagnostics.rowCounts[type] === document.features[type].length,
      `${label}.diagnostics.rowCounts.${type} must match its feature count`,
    );
    for (const feature of document.features[type]) {
      assert(
        feature?.featureType === type,
        `${label}.features.${type} rows must use the matching featureType`,
      );
    }
  }
  const features = GOAL_FEATURE_TYPES.flatMap((type) => document.features[type]);
  assert(features.length > 0, `${label}.features must contain at least one feature`);
  assert(
    features.length === document.source.summaryCsvRows,
    `${label}.features count must match source.summaryCsvRows`,
  );
  for (const [index, feature] of features.entries()) {
    assert(isRecord(feature), `${label}.features row ${index} must be an object`);
    for (const field of ['featureId', 'featureName', 'featureType']) {
      assert(
        isNonEmptyString(feature[field]),
        `${label}.features row ${index}.${field} must be a non-empty string`,
      );
    }
    assert(
      GOAL_FEATURE_TYPES.includes(feature.featureType),
      `${label}.features row ${index}.featureType is invalid`,
    );
    assert(
      feature.met === true || feature.met === false || feature.met === null,
      `${label}.features row ${index}.met must be boolean or null`,
    );
    for (const field of [
      'totalAmount',
      'absoluteTarget',
      'absoluteHeld',
      'absoluteShortfall',
      'relativeTarget',
      'relativeHeld',
      'relativeShortfall',
    ]) {
      assert(
        feature[field] === null || Number.isFinite(feature[field]),
        `${label}.features row ${index}.${field} must be numeric or null`,
      );
    }
    assert(
      feature.scenario === null || typeof feature.scenario === 'string',
      `${label}.features row ${index}.scenario must be a string or null`,
    );
    if (feature.evaluationSource !== undefined) {
      assert(
        feature.evaluationSource === 'prioritizr_model' || feature.evaluationSource === 'post-hoc',
        `${label}.features row ${index}.evaluationSource is invalid`,
      );
      assert(
        feature.evaluationSource !== 'post-hoc' ||
          (feature.featureType === 'ecosystems' &&
            feature.met !== null &&
            Number.isFinite(feature.relativeHeld)),
        `${label}.features row ${index} post-hoc evaluation requires valid ecosystem coverage`,
      );
    }
  }
}

export function validateMecDocument(document, expected, label = 'MEC') {
  assert(
    document.geographyLevel === expected.geographyLevel,
    `${label}.geographyLevel must equal "${expected.geographyLevel}"`,
  );
  assert(isNonEmptyString(document.generatedAt), `${label}.generatedAt must be non-empty`);
  assert(
    document.sourceMode === 'composite' || document.sourceMode === 'iavh',
    `${label}.sourceMode is invalid`,
  );
  assert(document.units === 'km2', `${label}.units must be "km2"`);
  assert(isRecord(document.viewSupport), `${label}.viewSupport must be an object`);
  assert(
    Array.isArray(document.viewSupport.supported) &&
      Array.isArray(document.viewSupport.unsupported),
    `${label}.viewSupport catalogs must be arrays`,
  );
  assert(isRecord(document.semantics), `${label}.semantics must be an object`);
  assertExactArray(document.rowLayout, MEC_ROW_LAYOUT, `${label}.rowLayout`);
  assertExactArray(document.scopeStatsFields, MEC_SCOPE_STATS_FIELDS, `${label}.scopeStatsFields`);
  for (const field of ['viewCatalog', 'classCatalog', 'scopeCatalog', 'rows']) {
    assert(
      Array.isArray(document[field]) && document[field].length > 0,
      `${label}.${field} must be non-empty`,
    );
  }
  for (const [index, view] of document.viewCatalog.entries()) {
    assert(
      Array.isArray(view) &&
        view.length === 2 &&
        isNonEmptyString(view[0]) &&
        isNonEmptyString(view[1]),
      `${label}.viewCatalog[${index}] is invalid`,
    );
  }
  for (const [index, entry] of document.classCatalog.entries()) {
    assert(
      Array.isArray(entry) &&
        entry.length === 3 &&
        Number.isInteger(entry[0]) &&
        entry[0] >= 0 &&
        entry[0] < document.viewCatalog.length &&
        isNonEmptyString(entry[1]) &&
        isNonEmptyString(entry[2]),
      `${label}.classCatalog[${index}] is invalid`,
    );
  }
  for (const [index, scope] of document.scopeCatalog.entries()) {
    assert(
      Array.isArray(scope) &&
        scope.length === 2 &&
        isNonEmptyString(scope[0]) &&
        isNonEmptyString(scope[1]),
      `${label}.scopeCatalog[${index}] is invalid`,
    );
  }
  assert(isRecord(document.scopeStats), `${label}.scopeStats must be an object`);
  const expectedScopeKeys = document.scopeCatalog.map((_, index) => String(index));
  assertExactKeys(document.scopeStats, expectedScopeKeys, `${label}.scopeStats`);
  for (const [key, stats] of Object.entries(document.scopeStats)) {
    assert(isRecord(stats), `${label}.scopeStats.${key} must be an object`);
    for (const field of MEC_SCOPE_STATS_FIELDS.slice(0, 3)) {
      assert(
        Number.isFinite(stats[field]) && stats[field] >= 0,
        `${label}.scopeStats.${key}.${field} must be non-negative`,
      );
    }
    assert(
      isNonEmptyString(stats.boundaryProvenanceRef),
      `${label}.scopeStats.${key}.boundaryProvenanceRef must be non-empty`,
    );
    const tolerance = Math.max(1e-6, stats.scopeAreaKm2 * 1e-9);
    assert(
      Math.abs(stats.classifiedKm2 + stats.unclassifiedKm2 - stats.scopeAreaKm2) <= tolerance,
      `${label}.scopeStats.${key} areas must reconcile`,
    );
  }
  for (const [index, row] of document.rows.entries()) {
    assert(
      Array.isArray(row) &&
        row.length === MEC_ROW_LAYOUT.length &&
        Number.isInteger(row[0]) &&
        row[0] >= 0 &&
        row[0] < document.scopeCatalog.length &&
        Number.isInteger(row[1]) &&
        row[1] >= 0 &&
        row[1] < document.classCatalog.length &&
        row.slice(2).every((value) => Number.isFinite(value) && value >= 0),
      `${label}.rows[${index}] is invalid`,
    );
    assert(
      row[3] + row[4] <= row[2] + 1e-6,
      `${label}.rows[${index}] coverage exceeds ecosystem area`,
    );
  }
  const rowCountsByScope = new Map();
  for (const row of document.rows) {
    rowCountsByScope.set(row[0], (rowCountsByScope.get(row[0]) ?? 0) + 1);
  }
  for (const [scopeIndex, stats] of Object.values(document.scopeStats).entries()) {
    assert(
      stats.classifiedKm2 === 0 || (rowCountsByScope.get(scopeIndex) ?? 0) > 0,
      `${label}.scopeStats.${scopeIndex} requires rows when classifiedKm2 is positive`,
    );
  }
}

function validateGoalTargetContext(context, label) {
  assert(isRecord(context), `${label} must be an object`);
  assert(
    context.finderTargetPercent === null || Number.isFinite(context.finderTargetPercent),
    `${label}.finderTargetPercent must be numeric or null`,
  );
  assert(
    context.targetFeatureSet === null || typeof context.targetFeatureSet === 'string',
    `${label}.targetFeatureSet must be a string or null`,
  );
  assert(
    Array.isArray(context.targetFeatureIds) &&
      context.targetFeatureIds.every((value) => isNonEmptyString(value)),
    `${label}.targetFeatureIds must be a string array`,
  );
  assert(
    isRecord(context.relativeTargetsByType) &&
      Object.values(context.relativeTargetsByType).every(
        (values) => Array.isArray(values) && values.every(Number.isFinite),
      ),
    `${label}.relativeTargetsByType must contain numeric arrays`,
  );
}

function validateGoalCount(summary, species, label) {
  assert(isRecord(summary), `${label} must be an object`);
  const fields = species ? ['metSpeciesCount', 'totalSpeciesCount'] : ['metCount', 'totalCount'];
  for (const field of fields) {
    assert(
      Number.isSafeInteger(summary[field]) && summary[field] >= 0,
      `${label}.${field} must be a non-negative integer`,
    );
  }
  assert(summary[fields[0]] <= summary[fields[1]], `${label} met count cannot exceed total count`);
  assert(
    summary.pctMet === null || Number.isFinite(summary.pctMet),
    `${label}.pctMet must be numeric or null`,
  );
}

function validateCompleteGeographies(geographies, label, documentContext, validateMetrics) {
  assertExactKeys(geographies, GEOGRAPHY_LEVELS, `${label}.geographies`);
  const nationalState = geographies.national?.colombia?.scopeState;
  assert(isRecord(nationalState), `${label}.national.colombia.scopeState must be an object`);
  const context = {
    ...documentContext,
    targetGridSha256: nationalState.targetGridSha256,
    solutionValidityMaskSha256: nationalState.solutionValidityMaskSha256,
  };
  const alignment = documentContext.provenance.inputAlignment;
  if (isRecord(alignment)) {
    assert(
      alignment.targetGridSha256 === context.targetGridSha256,
      `${label}.metricsProvenance.inputAlignment target grid SHA mismatch`,
    );
  }
  for (const level of GEOGRAPHY_LEVELS) {
    const scopes = geographies[level];
    assert(
      isRecord(scopes) && Object.keys(scopes).length > 0,
      `${label}.${level} must have scopes`,
    );
    if (level === 'national') {
      assertExactKeys(scopes, ['colombia'], `${label}.geographies.national`);
    }
    for (const [scopeId, scope] of Object.entries(scopes)) {
      assert(isRecord(scope), `${label}.${level}.${scopeId} must be an object`);
      assert(Array.isArray(scope.metrics), `${label}.${level}.${scopeId}.metrics must be an array`);
      validateScopeState(scope.scopeState, level, scopeId, context, `${label}.${level}.${scopeId}`);
      validateMetrics(scope.metrics, `${label}.${level}.${scopeId}.metrics`, scope);
    }
  }
}

function assertExactArray(actual, expected, label) {
  assert(
    Array.isArray(actual) &&
      actual.length === expected.length &&
      actual.every((value, index) => value === expected[index]),
    `${label} must match the release contract`,
  );
}

function recordsEqual(actual, expected) {
  return isRecord(actual) && canonicalJson(actual) === canonicalJson(expected);
}

function sha256Canonical(value) {
  return createHash('sha256').update(canonicalJson(value), 'utf-8').digest('hex');
}

/**
 * Carries a number exactly as the source document spelled it.
 *
 * Python distinguishes `0` from `0.0` and `json.dumps` preserves that in the canonical
 * form it hashes, but `JSON.parse` collapses both to the JavaScript number `0`, which
 * `JSON.stringify` renders as `0`. A digest Python embedded in an artifact is therefore
 * only reproducible from the artifact's original number literals.
 */
class NumberLiteral {
  constructor(literal) {
    this.literal = literal;
  }
}

export function parseWithNumberLiterals(sourceText) {
  return JSON.parse(sourceText, (key, value, context) =>
    typeof value === 'number' && context.source !== String(value)
      ? new NumberLiteral(context.source)
      : value,
  );
}

export function canonicalJson(value) {
  if (value instanceof NumberLiteral) {
    return value.literal;
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
