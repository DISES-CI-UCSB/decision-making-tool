const GEOGRAPHY_LEVELS = ['national', 'departments', 'municipalities', 'siraps', 'runaps', 'omecs'];
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

export function validateArtifactDocument(document, expected, label = 'artifact') {
  assert(isRecord(document), `${label} must be a JSON object`);
  assert(
    document.solutionId === expected.solutionId,
    `${label}.solutionId must equal "${expected.solutionId}"`,
  );

  if (document.format === 'metrics-compact-v1') {
    validateCompactMetricsDocument(document, label);
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
  validateVerboseMetricsDocument(document, label);
}

export function validateVerboseMetricsDocument(document, label = 'regular metrics') {
  validateCompleteGeographies(document.geographies, label, (metrics, metricLabel) => {
    assert(metrics.length > 0, `${metricLabel} must be non-empty`);
    for (const [index, metric] of metrics.entries()) {
      const rowLabel = `${metricLabel}[${index}]`;
      assert(isRecord(metric), `${rowLabel} must be an object`);
      for (const field of ['metricId', 'status', 'unit', 'labelKey']) {
        assert(isNonEmptyString(metric[field]), `${rowLabel}.${field} must be a non-empty string`);
      }
      assert(
        VALID_METRIC_STATUSES.has(metric.status),
        `${rowLabel}.status is outside the metrics contract`,
      );
    }
  });
}

export function validateCompactMetricsDocument(document, label = 'compact metrics') {
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
  validateCompleteGeographies(document.geographies, label, (metrics, metricLabel) => {
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
    }
    const metricIds = metrics.map((row) => document.metricCatalog[row[0]][0]);
    assertExactArray(metricIds, REGULAR_METRIC_IDS, `${metricLabel} metric IDs`);
  });
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

function validateCompleteGeographies(geographies, label, validateMetrics) {
  assertExactKeys(geographies, GEOGRAPHY_LEVELS, `${label}.geographies`);
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
      validateMetrics(scope.metrics, `${label}.${level}.${scopeId}.metrics`);
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
