import { strict as assert } from 'node:assert';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  validateArtifactDocument,
  validateCompactMetricsDocument,
  validateGoalsDocument,
  validateMecDocument,
  validateVerboseMetricsDocument,
} from './artifact-documents.mjs';

const LEVELS = ['national', 'departments', 'municipalities', 'siraps', 'runaps', 'omecs'];
const COMPACT_FIXTURE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../data/metrics/fixtures/release-compact-artifact-v1.json',
);

describe('release artifact document validation', () => {
  it('accepts complete regular verbose geography documents', () => {
    assert.doesNotThrow(() => validateVerboseMetricsDocument(createVerboseDocument()));
  });

  it('accepts the exact shared Python compact artifact bytes', async () => {
    const fixtureBytes = await fs.readFile(COMPACT_FIXTURE_PATH);
    const document = JSON.parse(fixtureBytes);
    assert.doesNotThrow(() => validateCompactMetricsDocument(document));
    assert.doesNotThrow(() =>
      validateArtifactDocument(document, { solutionId: 'fixture-land' }),
    );
  });

  it('rejects skeletal regular artifacts despite valid JSON structure', async () => {
    const missingGeographies = createVerboseDocument();
    delete missingGeographies.geographies.omecs;
    assert.throws(() => validateVerboseMetricsDocument(missingGeographies), /must contain exactly/);

    const emptyMetrics = JSON.parse(await fs.readFile(COMPACT_FIXTURE_PATH, 'utf-8'));
    emptyMetrics.geographies.departments.fixture.metrics = [];
    assert.throws(() => validateCompactMetricsDocument(emptyMetrics), /must be non-empty/);

    const incompleteMetrics = JSON.parse(await fs.readFile(COMPACT_FIXTURE_PATH, 'utf-8'));
    incompleteMetrics.geographies.departments.fixture.metrics.pop();
    assert.throws(() => validateCompactMetricsDocument(incompleteMetrics), /metric IDs/);
  });

  it('requires complete goals schema and feature rows', () => {
    assert.doesNotThrow(() => validateGoalsDocument(createGoalsDocument()));
    const skeletal = createGoalsDocument();
    skeletal.features.species = [];
    assert.throws(() => validateGoalsDocument(skeletal), /feature count/);
  });

  it('requires populated, internally referenced MEC catalogs and rows', () => {
    const document = createMecDocument();
    assert.doesNotThrow(() => validateMecDocument(document, { geographyLevel: 'national' }));

    const noRows = createMecDocument();
    noRows.rows = [];
    assert.throws(() => validateMecDocument(noRows, { geographyLevel: 'national' }), /rows/);

    const invalidReference = createMecDocument();
    invalidReference.rows[0][1] = 4;
    assert.throws(
      () => validateMecDocument(invalidReference, { geographyLevel: 'national' }),
      /rows\[0\] is invalid/,
    );
  });

  it('binds artifact structure to inventory solution and geography identity', () => {
    assert.throws(
      () =>
        validateArtifactDocument(createMecDocument(), {
          solutionId: 'other',
          geographyLevel: 'national',
        }),
      /solutionId must equal/,
    );
    assert.throws(
      () =>
        validateArtifactDocument(createMecDocument(), {
          solutionId: 'demo',
          geographyLevel: 'departments',
        }),
      /geographyLevel must equal/,
    );
  });
});

function createVerboseDocument() {
  return {
    solutionId: 'demo',
    geographies: createGeographies(() => [
      {
        metricId: 'metric-one',
        status: 'ready',
        unit: 'km2',
        labelKey: 'metric.one',
      },
    ]),
  };
}

function createGeographies(createMetrics) {
  return Object.fromEntries(
    LEVELS.map((level) => [
      level,
      {
        [level === 'national' ? 'colombia' : 'demo']: {
          metrics: createMetrics(),
        },
      },
    ]),
  );
}

function createGoalsDocument() {
  const feature = {
    featureId: 'feature-one',
    featureName: 'Feature one',
    featureType: 'species',
    met: true,
    totalAmount: 10,
    absoluteTarget: 3,
    absoluteHeld: 4,
    absoluteShortfall: 0,
    relativeTarget: 0.3,
    relativeHeld: 0.4,
    relativeShortfall: 0,
    scenario: 'demo',
  };
  const count = { metCount: 1, totalCount: 1, pctMet: 100 };
  const speciesCount = { metSpeciesCount: 1, totalSpeciesCount: 1, pctMet: 100 };
  return {
    format: 'conservation-goals-v1',
    solutionId: 'demo',
    generatedAt: '2026-08-04T00:00:00Z',
    source: {
      metadataUrl: 'https://example.test/demo.csv',
      summaryCsvUrl: 'https://example.test/demo.csv',
      summaryCsvRows: 1,
      solutionDomain: 'land',
      speciesLookupUrl: 'https://example.test/species.csv',
    },
    targetContext: {
      finderTargetPercent: 30,
      targetFeatureSet: 'all',
      targetFeatureIds: ['feature-one'],
      relativeTargetsByType: { species: [0.3] },
    },
    summary: {
      ...count,
      byType: {
        species: speciesCount,
        strategicEcosystems: { metCount: 0, totalCount: 0, pctMet: null },
        ecosystems: { metCount: 0, totalCount: 0, pctMet: null },
        other: { metCount: 0, totalCount: 0, pctMet: null },
      },
    },
    rollups: {
      species: speciesCount,
      strategicEcosystems: { metCount: 0, totalCount: 0, pctMet: null },
      ecosystems: { metCount: 0, totalCount: 0, pctMet: null },
    },
    diagnostics: {
      rawTypeCounts: { species: 1 },
      rowCounts: {
        species: 1,
        strategicEcosystems: 0,
        ecosystems: 0,
        other: 0,
      },
    },
    features: {
      species: [feature],
      strategicEcosystems: [],
      ecosystems: [],
      other: [],
    },
  };
}

function createMecDocument() {
  return {
    format: 'mec-compact-v2',
    solutionId: 'demo',
    geographyLevel: 'national',
    generatedAt: '2026-08-04T00:00:00Z',
    sourceMode: 'composite',
    units: 'km2',
    viewSupport: { supported: [], unsupported: [] },
    semantics: { contract: 'coverage' },
    rowLayout: [
      'scopeIndex',
      'classIndex',
      'ecosystemAreaKm2',
      'preExistingCoverageKm2',
      'newPrioritizrCoverageKm2',
    ],
    scopeStatsFields: ['scopeAreaKm2', 'classifiedKm2', 'unclassifiedKm2', 'boundaryProvenanceRef'],
    viewCatalog: [['biomeFamily', 'Biome family']],
    classCatalog: [[0, 'class-one', 'Class one']],
    scopeCatalog: [['colombia', 'Colombia']],
    scopeStats: {
      0: {
        scopeAreaKm2: 10,
        classifiedKm2: 8,
        unclassifiedKm2: 2,
        boundaryProvenanceRef: 'boundary-one',
      },
    },
    rows: [[0, 0, 8, 2, 1]],
  };
}
