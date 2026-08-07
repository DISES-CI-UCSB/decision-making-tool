import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  canonicalJson,
  parseWithNumberLiterals,
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
const COMPACT_FIXTURE = JSON.parse(await fs.readFile(COMPACT_FIXTURE_PATH, 'utf-8'));

describe('release artifact document validation', () => {
  it('accepts complete regular verbose geography documents', () => {
    assert.doesNotThrow(() => validateVerboseMetricsDocument(createVerboseDocument()));
  });

  it('accepts finite partial values and proven empty null values', () => {
    const partial = createVerboseDocument();
    partial.geographies.national.colombia.metrics[0].status = 'partial';
    assert.doesNotThrow(() => validateVerboseMetricsDocument(partial));

    const empty = createVerboseDocument();
    const scope = empty.geographies.departments.demo;
    scope.scopeState = createScopeState('departments', 'demo', 0);
    scope.metrics[0].status = 'empty';
    scope.metrics[0].value = null;
    assert.doesNotThrow(() => validateVerboseMetricsDocument(empty));
  });

  it('rejects empty values without null and cryptographic support proof', () => {
    const nonNull = createVerboseDocument();
    nonNull.geographies.departments.demo.metrics[0].status = 'empty';
    assert.throws(() => validateVerboseMetricsDocument(nonNull), /value must be null/);

    const unsupported = createVerboseDocument();
    unsupported.geographies.departments.demo.metrics[0].status = 'empty';
    unsupported.geographies.departments.demo.metrics[0].value = null;
    assert.throws(() => validateVerboseMetricsDocument(unsupported), /require proven zero-support/);
  });

  it('accepts the exact shared Python compact artifact bytes', async () => {
    const fixtureBytes = await fs.readFile(COMPACT_FIXTURE_PATH);
    const document = JSON.parse(fixtureBytes);
    assert.doesNotThrow(() => validateCompactMetricsDocument(document));
    assert.doesNotThrow(() => validateArtifactDocument(document, { solutionId: 'fixture-land' }));
  });

  it('rejects forged schema-v4 scope evidence', () => {
    const forgedReason = compactFixture();
    forgedReason.geographies.departments.fixture.scopeState.reason = 'trust-me';
    assert.throws(() => validateCompactMetricsDocument(forgedReason), /reason does not match/);

    const forgedPolicy = compactFixture();
    forgedPolicy.geographies.departments.fixture.scopeState.rasterizationPolicy = {
      allTouched: true,
    };
    assert.throws(() => validateCompactMetricsDocument(forgedPolicy), /rasterizationPolicy/);

    const swappedValidityMask = compactFixture();
    swappedValidityMask.geographies.departments.fixture.scopeState.solutionValidityMaskSha256 =
      '1'.repeat(64);
    assert.throws(() => validateCompactMetricsDocument(swappedValidityMask), /validity-mask/);

    const swappedGrid = compactFixture();
    swappedGrid.geographies.departments.fixture.scopeState.targetGridSha256 = '2'.repeat(64);
    assert.throws(() => validateCompactMetricsDocument(swappedGrid), /target grid/);
  });

  it('rejects missing, stale, and context-mismatched release provenance', () => {
    const missing = compactFixture();
    delete missing.metricsProvenance;
    assert.throws(() => validateCompactMetricsDocument(missing), /metricsProvenance/);

    const staleSchema = compactFixture();
    staleSchema.metricsProvenance.schemaVersion = 3;
    assert.throws(() => validateCompactMetricsDocument(staleSchema), /schemaVersion/);

    const staleCatalog = compactFixture();
    staleCatalog.metricsProvenance.catalogSignature = 'metrics-catalog-v3:' + '0'.repeat(64);
    assert.throws(() => validateCompactMetricsDocument(staleCatalog), /metrics-catalog-v4/);

    const expected = releaseExpectation();
    const mismatchedCatalogSignature = compactFixture();
    mismatchedCatalogSignature.metricsProvenance.catalogSignature =
      'metrics-catalog-v4:' + '0'.repeat(64);
    assert.throws(
      () => validateArtifactDocument(mismatchedCatalogSignature, expected),
      /catalogSignature must match/,
    );

    const mismatchedProvenanceHash = compactFixture();
    mismatchedProvenanceHash.metricsProvenanceSha256 = '0'.repeat(64);
    assert.throws(
      () => validateCompactMetricsDocument(mismatchedProvenanceHash),
      /must match metricsProvenance/,
    );

    const mismatchedDomain = compactFixture();
    mismatchedDomain.metricsProvenance.solutionDomain = 'marine';
    assert.throws(
      () => validateArtifactDocument(mismatchedDomain, expected),
      /solutionDomain must match/,
    );

    const mismatchedRelease = compactFixture();
    mismatchedRelease.metricsProvenance.releaseId = 'other-release';
    assert.throws(
      () => validateArtifactDocument(mismatchedRelease, expected),
      /releaseId must match/,
    );

    const mismatchedCatalog = compactFixture();
    mismatchedCatalog.solutionCatalogBinding.catalogVersion = '0.2.0';
    assert.throws(
      () => validateArtifactDocument(mismatchedCatalog, expected),
      /catalogVersion must match/,
    );

    const mismatchedRaster = compactFixture();
    mismatchedRaster.solutionRaster.sha256 = '8'.repeat(64);
    assert.throws(
      () => validateArtifactDocument(mismatchedRaster, expected),
      /sha256 must match release catalog/,
    );
  });

  it('rejects malformed boundary identity and invalid empty or partial values', () => {
    const boundarySwap = compactFixture();
    boundarySwap.geographies.departments.fixture.scopeState.boundary.scopeId = 'other';
    assert.throws(() => validateCompactMetricsDocument(boundarySwap), /boundary identity/);

    const nonNullEmpty = compactFixture();
    const emptyScope = nonNullEmpty.geographies.departments.fixture;
    emptyScope.scopeState = createScopeState('departments', 'fixture', 0);
    emptyScope.metrics[0][1] = 0;
    emptyScope.metrics[0][2] = appendStatus(nonNullEmpty, 'empty');
    assert.throws(() => validateCompactMetricsDocument(nonNullEmpty), /value must be null/);

    const nonFinitePartial = compactFixture();
    nonFinitePartial.geographies.departments.fixture.metrics[0][1] = null;
    nonFinitePartial.geographies.departments.fixture.metrics[0][2] = appendStatus(
      nonFinitePartial,
      'partial',
    );
    assert.throws(() => validateCompactMetricsDocument(nonFinitePartial), /finite for partial/);
  });

  it('accepts bound dual outcomes and rejects threshold or policy forgeries', () => {
    const dualReference = createVerboseDocument();
    dualReference.metricsProvenance.speciesTargetPolicy = {
      format: 'species-target-policy-v1',
      kind: 'dual_reference',
      source: 'manifest:finderInputs.structuredTargets',
      decisionSource: 'approved:dual-reference-species-thresholds-v1',
      structuredTargetDimension: null,
      structuredTargetCount: 0,
      structuredTargetsSha256: '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945',
      referenceThresholds: [17, 30],
      referenceThresholdsSha256: '309368de552126d50d8a6ada4eba81fd2d4f48cf5ada1a2044886bf9a5028acb',
    };
    for (const scopes of Object.values(dualReference.geographies)) {
      for (const scope of Object.values(scopes)) {
        scope.metrics[0] = {
          metricId: 'threatened_species_secured',
          value: null,
          status: 'partial',
          unit: 'count',
          labelKey: 'metrics.threatened_species_secured',
          source: 'manifest:finderInputs.structuredTargets',
          notes:
            'No species optimization target was configured; reporting 17% and 30% reference-threshold outcomes.',
          details: {
            speciesException: dualReference.metricsProvenance.generationConfig.speciesException,
            thresholdOutcomes: [
              { targetPercent: 17, value: 7 },
              { targetPercent: 30, value: 4 },
            ],
          },
        };
      }
    }
    assert.doesNotThrow(() =>
      validateVerboseMetricsDocument(dualReference, 'dual-reference', {
        speciesTargetPolicyEvidence: dualReference.metricsProvenance.speciesTargetPolicy,
      }),
    );

    const missingThreshold = structuredClone(dualReference);
    missingThreshold.geographies.national.colombia.metrics[0].details.thresholdOutcomes.pop();
    assert.throws(
      () => validateVerboseMetricsDocument(missingThreshold),
      /exactly two threshold outcomes/,
    );

    const nonFiniteOutcome = structuredClone(dualReference);
    nonFiniteOutcome.geographies.national.colombia.metrics[0].details.thresholdOutcomes[0].value =
      null;
    assert.throws(() => validateVerboseMetricsDocument(nonFiniteOutcome), /value must be finite/);

    const nonNullTopLevel = structuredClone(dualReference);
    nonNullTopLevel.geographies.national.colombia.metrics[0].value = 7;
    assert.throws(
      () => validateVerboseMetricsDocument(nonNullTopLevel),
      /dual-reference status\/provenance/,
    );

    const forgedPolicy = structuredClone(dualReference);
    forgedPolicy.metricsProvenance.speciesTargetPolicy.referenceThresholds = [17, 25];
    assert.throws(
      () => validateVerboseMetricsDocument(forgedPolicy),
      /dual-reference thresholds are invalid/,
    );

    const forgedHash = structuredClone(dualReference);
    forgedHash.metricsProvenance.speciesTargetPolicy = {
      format: 'species-target-policy-v1',
      kind: 'per_species',
      source: 'manifest:finderInputs.structuredTargets',
      structuredTargetDimension: 'espRn',
      structuredTargetCount: 1,
      structuredTargetsSha256: '2'.repeat(64),
      matchingInventory: { matchedTargetCount: 1 },
    };
    assert.throws(
      () =>
        validateVerboseMetricsDocument(forgedHash, 'per-species', {
          speciesTargetPolicyEvidence: {
            ...forgedHash.metricsProvenance.speciesTargetPolicy,
            structuredTargetsSha256: '3'.repeat(64),
          },
        }),
      /must match catalog\/manifest context/,
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

describe('species metric domain applicability', () => {
  it('requires marine solutions to report species metrics as not_applicable', () => {
    const marine = createSpeciesDocument('marine', 'not_applicable');
    assert.doesNotThrow(() => validateVerboseMetricsDocument(marine));

    const marineWithValue = createSpeciesDocument('marine', 'ready');
    assert.throws(
      () => validateVerboseMetricsDocument(marineWithValue),
      /species_groups_protected must be not_applicable for the marine solution domain/,
    );
  });

  it('still forbids not_applicable species metrics on land solutions', () => {
    const land = createSpeciesDocument('land', 'not_applicable');
    assert.throws(
      () => validateVerboseMetricsDocument(land),
      /species_groups_protected must not be not_applicable/,
    );
    assert.doesNotThrow(() =>
      validateVerboseMetricsDocument(createSpeciesDocument('land', 'ready')),
    );
  });
});

describe('Python float literal canonicalization', () => {
  it('reproduces a provenance digest Python computed over float-typed zeros', () => {
    const provenance = structuredClone(COMPACT_FIXTURE.metricsProvenance);
    provenance.generationConfig = {
      ...provenance.generationConfig,
      speciesAreaKm2: 0,
      speciesCount: 0,
    };
    const document = {
      ...compactFixture(),
      metricsProvenance: provenance,
    };
    // Python would emit `0.0` for the float and `0` for the integer.
    const sourceText = JSON.stringify(document).replace(
      '"speciesAreaKm2":0',
      '"speciesAreaKm2":0.0',
    );
    const numberLiteralDocument = parseWithNumberLiterals(sourceText);
    document.metricsProvenanceSha256 = pythonStyleProvenanceSha256(sourceText);

    assert.throws(
      () => validateCompactMetricsDocument(document),
      /must match metricsProvenance/,
      'plain JSON.parse must not be able to reproduce the Python digest',
    );
    assert.doesNotThrow(() =>
      validateCompactMetricsDocument(document, 'compact metrics', undefined, {
        numberLiteralDocument,
      }),
    );
  });

  it('leaves digests unchanged when no number literal needs preserving', () => {
    const document = compactFixture();
    assert.doesNotThrow(() =>
      validateCompactMetricsDocument(document, 'compact metrics', undefined, {
        numberLiteralDocument: parseWithNumberLiterals(JSON.stringify(document)),
      }),
    );
  });
});

function createSpeciesDocument(solutionDomain, speciesStatus) {
  const document = createVerboseDocument();
  document.metricsProvenance.solutionDomain = solutionDomain;
  document.geographies = createGeographies(() => [
    {
      metricId: 'species_groups_protected',
      value: speciesStatus === 'ready' ? 12 : null,
      status: speciesStatus,
      unit: 'count',
      labelKey: 'metric.species_groups_protected',
    },
  ]);
  return document;
}

/** Canonical SHA-256 of `metricsProvenance` the way Python's json.dumps would render it. */
function pythonStyleProvenanceSha256(sourceText) {
  const canonical = canonicalJson(parseWithNumberLiterals(sourceText).metricsProvenance);
  return createHash('sha256').update(canonical, 'utf-8').digest('hex');
}

function createVerboseDocument() {
  return {
    solutionId: 'demo',
    solutionRaster: {
      solutionBasename: 'demo.tif',
      sha256: 'a'.repeat(64),
    },
    solutionInputSignature: structuredClone(COMPACT_FIXTURE.solutionInputSignature),
    solutionCatalogBinding: structuredClone(COMPACT_FIXTURE.solutionCatalogBinding),
    metricsProvenance: structuredClone(COMPACT_FIXTURE.metricsProvenance),
    geographies: createGeographies(() => [
      {
        metricId: 'metric-one',
        value: 0,
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
          scopeState: createScopeState(level, level === 'national' ? 'colombia' : 'demo', 1),
          metrics: createMetrics(),
        },
      },
    ]),
  );
}

function createScopeState(level, scopeId, validCellCount) {
  const national = level === 'national';
  const sourceSha256 = COMPACT_FIXTURE.metricsProvenance.boundaryProvenance.sources[level]?.sha256;
  return {
    format: 'solution-raster-scope-state-v1',
    classification: validCellCount === 0 ? 'empty' : 'supported',
    reason:
      validCellCount === 0 ? 'zero_solution_valid_support' : 'positive_solution_valid_support',
    solutionValidCellCount: validCellCount,
    selectedCellCount: 0,
    boundaryGridCellCount: 1,
    targetGridSha256: 'b'.repeat(64),
    solutionRasterSha256: 'a'.repeat(64),
    solutionValidityMaskSha256: 'c'.repeat(64),
    boundary: national
      ? null
      : {
          geographyLevel: level,
          scopeId,
          sourceSha256,
          geometrySha256: 'e'.repeat(64),
        },
    rasterizationPolicy: {
      boundaryInclusion: national ? 'none' : 'pixel-center',
      allTouched: false,
      referenceGrid: 'solution raster grid',
    },
  };
}

function compactFixture() {
  return structuredClone(COMPACT_FIXTURE);
}

function releaseExpectation() {
  return {
    solutionId: 'fixture-land',
    solutionDomain: 'land',
    solutionBasename: 'fixture-land.tif',
    rasterSha256: 'a'.repeat(64),
    catalogSignature: COMPACT_FIXTURE.metricsProvenance.catalogSignature,
    releaseId: 'fixture-release',
    catalogVersion: '0.1.0',
    catalogSha256: '9'.repeat(64),
  };
}

function appendStatus(document, status) {
  document.statusCatalog.push(status);
  return document.statusCatalog.length - 1;
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
