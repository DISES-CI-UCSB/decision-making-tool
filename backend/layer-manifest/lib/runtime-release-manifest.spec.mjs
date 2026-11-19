import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  RUNTIME_COMPACT_SOLUTION_PROFILE,
  buildRuntimeReleaseManifest,
  compactRuntimeLayer,
  compactRuntimeSolution,
} from './runtime-release-manifest.mjs';
import { solutionCatalogSha256 } from './solution-catalog.mjs';
import { MEC_GEOGRAPHY_LEVELS } from './metric-urls.mjs';

const HOST = 'https://aagibolq28slyfof.public.blob.vercel-storage.com';
const RELEASE_ID = 'solutions-v0-2-0-20260805';

function solution(id, domain = 'land') {
  const rasterFile = `${id}.tif`;
  return {
    id,
    name: id,
    description: `${id} description`,
    domain,
    scope: domain === 'marine' ? 'marine' : 'national',
    displayUrl: `${HOST}/solutions/${rasterFile}`,
    metadataUrl: `${HOST}/solutions/${id}.json`,
    rasterFile,
    metadataFile: `${id}.json`,
    blobPath: `solutions/${rasterFile}`,
    rasterSha256: domain === 'land' ? 'a'.repeat(64) : 'b'.repeat(64),
    generatedAt: '2026-08-05T00:00:00Z',
    precomputedMetricUrls: {},
    finderInputs: {
      domain,
      scope: domain === 'marine' ? 'marine' : 'national',
      targetFeatureSet: 'esp_rn',
      targetFeatureIds: ['species'],
      targetPercent: null,
      structuredTargets: {
        format: 'solution-target-metadata-v1',
        sourceEvaluation: 'prioritizr_model',
        ecosystems: [],
        strategicEcosystems: [],
        ecosystemServices: [],
        speciesRepresentation: [],
        espRn: [
          { featureId: 'species-a', targetPercent: 17 },
          { featureId: 'species-b', targetPercent: 22.5 },
          { featureId: 'species-c', targetPercent: 30 },
        ],
      },
      costLayerId: 'human_footprint',
      includeLayerIds: ['runap'],
      excludeLayerIds: [],
    },
    inputLayerIds: {
      features: ['species'],
      cost: 'human_footprint',
      includes: ['runap'],
      excludes: [],
    },
    summaryMetrics: {
      nSelected: 10,
      totalCost: 20,
      pctTargetsMet: 30,
      coverageRowCount: 3,
    },
    coverage: [
      {
        feature: 'species-a',
        met: true,
        relativeTarget: 0.17,
        relativeHeld: 0.2,
        relativeShortfall: 0,
      },
    ],
    sourceProvenance: { metadataSha256: 'not-runtime-data' },
    rendering: {
      valueType: 'categorical',
      renderMode: 'categorical',
      noDataValue: 255,
    },
  };
}

function speciesGoalsInventoryEntry(id, levels = MEC_GEOGRAPHY_LEVELS) {
  return {
    format: 'species-goals-release-inventory-v1',
    validated: true,
    solutionId: id,
    releaseId: RELEASE_ID,
    catalogValidated: true,
    validatedGeographyLevels: [...levels],
  };
}

function releaseArtifactInventory(catalog) {
  const artifacts = catalog.solutions.flatMap((solution) => [
    ...['regularVerbose', 'regularCompact', 'goals'].map((component) => ({
      component,
      solutionId: solution.solutionId,
      geographyLevel: null,
      path: `${component}/${solution.solutionId}.json`,
      blobPath: `releases/${RELEASE_ID}/${component}/${solution.solutionId}.json`,
      sha256: 'c'.repeat(64),
    })),
    ...(solution.domain === 'land'
      ? MEC_GEOGRAPHY_LEVELS.map((geographyLevel) => ({
          component: 'mecV2',
          solutionId: solution.solutionId,
          geographyLevel,
          path: `mec/v2/cache/${solution.solutionId}/${geographyLevel}.mec.compact.json`,
          blobPath: `releases/${RELEASE_ID}/mec/v2/${solution.solutionId}/${geographyLevel}.mec.compact.json`,
          sha256: 'c'.repeat(64),
        }))
      : []),
  ]);
  return {
    format: 'solution-release-artifact-inventory-v1',
    releaseId: RELEASE_ID,
    catalogVersion: catalog.catalogVersion,
    catalogSha256: solutionCatalogSha256(catalog),
    artifactCount: artifacts.length,
    artifacts,
  };
}

function previewArtifactInventory(catalog, solutionId) {
  const inventory = releaseArtifactInventory(catalog);
  inventory.artifacts = inventory.artifacts.filter(
    (artifact) => artifact.solutionId === solutionId,
  );
  inventory.artifactCount = inventory.artifacts.length;
  return inventory;
}

function speciesGoalsCatalog() {
  return {
    format: 'species-goals-catalog-v1',
    catalogSha256: 'd'.repeat(64),
    provenance: { releaseId: RELEASE_ID },
  };
}

function releaseFixture(entries) {
  const orderedEntries = [...entries].sort((left, right) => left.id.localeCompare(right.id));
  const catalog = {
    format: 'solution-catalog-v1',
    catalogVersion: '0.2.0',
    releaseId: RELEASE_ID,
    expectedSolutionCount: orderedEntries.length,
    expectedLandSolutionCount: orderedEntries.filter((entry) => entry.domain === 'land').length,
    expectedMarineSolutionCount: orderedEntries.filter((entry) => entry.domain === 'marine').length,
    solutions: orderedEntries.map((entry) => ({
      solutionId: entry.id,
      solutionBasename: entry.rasterFile,
      domain: entry.domain,
      rasterSha256: entry.rasterSha256,
    })),
  };
  return {
    baseManifest: {
      version: '0.2.0',
      releaseId: RELEASE_ID,
      catalogVersion: '0.2.0',
      categories: [],
      layers: [],
      solutions: structuredClone(orderedEntries),
    },
    preflightManifest: {
      releaseId: RELEASE_ID,
      catalogVersion: '0.2.0',
      generatedAt: '2026-08-05T00:00:00Z',
      solutions: orderedEntries,
    },
    catalog,
  };
}

describe('runtime release manifest compaction', () => {
  it('removes unsupported layer metric URLs while retaining backed metadata', () => {
    const backedMetadataUrl = `${HOST}/metadata/ecosistemas.metadata.json`;
    const legacyLayer = {
      id: 'ecosistemas',
      roleInMetricCalculation: 'data_used_for_live_metric_calculation',
      metadataUrl: backedMetadataUrl,
      compressedDataForLiveMetricsUrl: `${HOST}/metrics/live/ecosistemas.bin.gz`,
      precomputedMetricUrls: { national: `${HOST}/metrics/precomputed/ecosistemas/nacional.json` },
    };

    assert.deepStrictEqual(
      compactRuntimeLayer(legacyLayer, { backedMetadataUrls: new Set([backedMetadataUrl]) }),
      {
        ...legacyLayer,
        roleInMetricCalculation: 'none',
        compressedDataForLiveMetricsUrl: null,
        precomputedMetricUrls: {},
      },
    );
    assert.strictEqual(
      compactRuntimeLayer(legacyLayer, { backedMetadataUrls: new Set() }).metadataUrl,
      null,
    );
  });

  it('omits analysis coverage while preserving heterogeneous EspRN targets exactly', () => {
    const source = solution('land-solution');
    source.capabilities = { aoiCoverageMetrics: 'v2' };
    const compact = compactRuntimeSolution(source);

    assert.deepStrictEqual(compact.coverage, []);
    assert.deepStrictEqual(
      compact.finderInputs.structuredTargets,
      source.finderInputs.structuredTargets,
    );
    assert.deepStrictEqual(
      compact.finderInputs.structuredTargets.espRn.map(({ targetPercent }) => targetPercent),
      [17, 22.5, 30],
    );
    assert.strictEqual(compact.summaryMetrics.coverageRowCount, 3);
    assert.deepStrictEqual(compact.capabilities, { aoiCoverageMetrics: 'v2' });
    assert.strictEqual('sourceProvenance' in compact, false);
  });

  it('uses frozen preflight solutions with current base layers and release binding', () => {
    const land = solution('land-solution');
    const marine = solution('marine-solution', 'marine');
    const catalog = {
      format: 'solution-catalog-v1',
      catalogVersion: '0.2.0',
      releaseId: RELEASE_ID,
      expectedSolutionCount: 2,
      expectedLandSolutionCount: 1,
      expectedMarineSolutionCount: 1,
      solutions: [land, marine].map((entry) => ({
        solutionId: entry.id,
        solutionBasename: entry.rasterFile,
        domain: entry.domain,
        rasterSha256: entry.rasterSha256,
      })),
    };
    const baseManifest = {
      version: '0.2.0',
      generatedAt: 'old',
      publicBlobHost: HOST,
      sourceCsv: 'data/layers.csv',
      categories: [{ id: 'base-category', spanishLabel: 'Base', layerIds: [] }],
      layers: [{ id: 'base-layer' }],
      solutions: [{ id: 'legacy-solution' }],
      referenceData: { speciesLookup: { url: `${HOST}/species.csv` } },
    };
    const preflightManifest = {
      releaseId: RELEASE_ID,
      catalogVersion: '0.2.0',
      generatedAt: '2026-08-05T00:00:00Z',
      solutions: [land, marine],
    };

    const result = buildRuntimeReleaseManifest({
      baseManifest,
      preflightManifest,
      catalog,
    });

    assert.deepStrictEqual(
      result.solutions.map(({ id }) => id),
      ['land-solution', 'marine-solution'],
    );
    assert.deepStrictEqual(result.categories, baseManifest.categories);
    assert.deepStrictEqual(result.layers, [
      {
        id: 'base-layer',
        roleInMetricCalculation: 'none',
        compressedDataForLiveMetricsUrl: null,
        precomputedMetricUrls: {},
      },
    ]);
    assert.deepStrictEqual(result.referenceData, baseManifest.referenceData);
    assert.strictEqual(result.releaseId, RELEASE_ID);
    assert.strictEqual(result.catalogVersion, '0.2.0');
    assert.strictEqual(result.solutionDataProfile, RUNTIME_COMPACT_SOLUTION_PROFILE);
  });

  it('applies authoritative Territorial SIRAP semantics without changing the thematic layer', () => {
    const fixture = releaseFixture([solution('land-solution')]);
    const thematicLayer = {
      id: 'siraps_thematic',
      englishLabel: 'Thematic SIRAP Additions',
      description: 'Thematic SIRAP additions isolated for Eje Cafetero and Macizo.',
      dataRole: 'administrative_boundary',
      roleInMetricCalculation: 'none',
    };
    fixture.baseManifest.layers = [
      {
        id: 'siraps_territorial',
        englishLabel: 'Territorial SIRAPs',
        description: 'Broad territorial SIRAP / DT boundary polygons.',
        dataRole: 'administrative_boundary',
        roleInMetricCalculation: 'none',
      },
      {
        id: 'siraps_territorial_updated',
        englishLabel: 'Territorial SIRAPs (updated, needs metric calculation)',
        description: 'Authoritative comparison layer; view-only until recalculation.',
        dataRole: 'reference_layer',
        roleInMetricCalculation: 'none',
        requiredForSolution: false,
        selectableInFinder: false,
        visibleInMapLayers: true,
      },
      thematicLayer,
    ];

    const result = buildRuntimeReleaseManifest(fixture);
    const oldTerritorial = result.layers.find(({ id }) => id === 'siraps_territorial');
    const newTerritorial = result.layers.find(({ id }) => id === 'siraps_territorial_updated');
    const thematic = result.layers.find(({ id }) => id === 'siraps_thematic');

    assert.deepStrictEqual(
      {
        englishLabel: oldTerritorial.englishLabel,
        description: oldTerritorial.description,
        dataRole: oldTerritorial.dataRole,
        roleInMetricCalculation: oldTerritorial.roleInMetricCalculation,
        requiredForSolution: oldTerritorial.requiredForSolution,
        selectableInFinder: oldTerritorial.selectableInFinder,
        visibleInMapLayers: oldTerritorial.visibleInMapLayers,
      },
      {
        englishLabel: 'Territorial SIRAPs (outdated)',
        description:
          'Outdated Territorial SIRAP boundaries retained as a view-only comparison layer.',
        dataRole: 'reference_layer',
        roleInMetricCalculation: 'none',
        requiredForSolution: false,
        selectableInFinder: false,
        visibleInMapLayers: true,
      },
    );
    assert.equal(newTerritorial.englishLabel, 'Territorial SIRAPs');
    assert.equal(newTerritorial.dataRole, 'administrative_boundary');
    assert.equal(newTerritorial.selectableInFinder, undefined);
    assert.equal(newTerritorial.roleInMetricCalculation, 'none');
    assert.match(newTerritorial.description, /AOI selection and metric lookup/);
    assert.doesNotMatch(newTerritorial.description, /view-only/i);
    assert.deepStrictEqual(thematic, {
      ...thematicLayer,
      compressedDataForLiveMetricsUrl: null,
      precomputedMetricUrls: {},
    });
  });

  it('emits AOI coverage v2 only from complete MEC and species evidence', () => {
    const completeLand = solution('complete-land');
    const incompleteLand = solution('incomplete-land');
    const marine = solution('marine-solution', 'marine');
    for (const entry of [completeLand, incompleteLand, marine]) {
      entry.capabilities = { aoiCoverageMetrics: 'v2' };
    }
    const catalog = {
      format: 'solution-catalog-v1',
      catalogVersion: '0.2.0',
      releaseId: RELEASE_ID,
      expectedSolutionCount: 3,
      expectedLandSolutionCount: 2,
      expectedMarineSolutionCount: 1,
      solutions: [completeLand, incompleteLand, marine]
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((entry) => ({
          solutionId: entry.id,
          solutionBasename: entry.rasterFile,
          domain: entry.domain,
          rasterSha256: entry.rasterSha256,
        })),
    };
    const orderedSolutions = catalog.solutions.map(({ solutionId }) =>
      [completeLand, incompleteLand, marine].find((entry) => entry.id === solutionId),
    );
    const artifactInventory = releaseArtifactInventory(catalog);
    const activeSpeciesGoalsCatalog = speciesGoalsCatalog();
    const speciesGoalsInventory = {
      format: 'species-goals-release-inventory-index-v1',
      releaseId: RELEASE_ID,
      catalogSha256: activeSpeciesGoalsCatalog.catalogSha256,
      solutions: {
        [completeLand.id]: speciesGoalsInventoryEntry(completeLand.id),
        [incompleteLand.id]: speciesGoalsInventoryEntry(incompleteLand.id),
        [marine.id]: speciesGoalsInventoryEntry(marine.id),
      },
    };

    const result = buildRuntimeReleaseManifest({
      baseManifest: {
        version: '0.2.0',
        categories: [],
        layers: [],
      },
      preflightManifest: {
        releaseId: RELEASE_ID,
        catalogVersion: '0.2.0',
        generatedAt: '2026-08-05T00:00:00Z',
        solutions: orderedSolutions,
      },
      catalog,
      releaseArtifactInventory: artifactInventory,
      speciesGoalsInventory,
      speciesGoalsCatalog: activeSpeciesGoalsCatalog,
    });
    const byId = Object.fromEntries(result.solutions.map((entry) => [entry.id, entry]));

    assert.deepStrictEqual(byId[completeLand.id].capabilities, {
      aoiCoverageMetrics: 'v2',
    });
    assert.deepStrictEqual(byId[incompleteLand.id].capabilities, {
      aoiCoverageMetrics: 'v2',
    });
    assert.strictEqual(byId[marine.id].capabilities, undefined);

    const productionSolutions = structuredClone(orderedSolutions);
    for (const entry of productionSolutions) {
      delete entry.capabilities;
      entry.precomputedMetricUrls = {
        goals: `${HOST}/releases/${RELEASE_ID}/production/${entry.id}.json`,
      };
    }
    const previewSpeciesGoalsInventory = {
      format: 'species-goals-release-inventory-index-v1',
      releaseId: RELEASE_ID,
      catalogSha256: activeSpeciesGoalsCatalog.catalogSha256,
      solutions: {
        [completeLand.id]: speciesGoalsInventoryEntry(completeLand.id),
      },
    };
    const previewResult = buildRuntimeReleaseManifest({
      baseManifest: {
        version: '0.2.0',
        releaseId: RELEASE_ID,
        catalogVersion: '0.2.0',
        categories: [],
        layers: [],
        solutions: productionSolutions,
      },
      preflightManifest: {
        releaseId: RELEASE_ID,
        catalogVersion: '0.2.0',
        generatedAt: '2026-08-05T00:00:00Z',
        solutions: orderedSolutions,
      },
      catalog,
      releaseArtifactInventory: previewArtifactInventory(catalog, completeLand.id),
      speciesGoalsInventory: previewSpeciesGoalsInventory,
      speciesGoalsCatalog: activeSpeciesGoalsCatalog,
      speciesGoalsBaseUrl: '',
      releaseArtifactBaseUrl: '',
      aoiCoveragePreviewSolutionId: completeLand.id,
    });
    const previewById = Object.fromEntries(
      previewResult.solutions.map((entry) => [entry.id, entry]),
    );
    assert.deepStrictEqual(previewById[completeLand.id].capabilities, {
      aoiCoverageMetrics: 'v2',
    });
    assert.strictEqual(previewById[incompleteLand.id].capabilities, undefined);
    assert.strictEqual(previewById[marine.id].capabilities, undefined);
    assert.ok(previewById[completeLand.id].precomputedMetricUrls.cache.startsWith('/releases/'));
    assert.strictEqual(
      previewById[completeLand.id].precomputedMetricUrls.speciesGoalsTargetOverlay,
      undefined,
    );
    assert.deepStrictEqual(
      previewById[incompleteLand.id],
      productionSolutions.find((entry) => entry.id === incompleteLand.id),
    );
    assert.deepStrictEqual(
      previewById[marine.id],
      productionSolutions.find((entry) => entry.id === marine.id),
    );

    speciesGoalsInventory.solutions[completeLand.id].validatedGeographyLevels =
      MEC_GEOGRAPHY_LEVELS.slice(0, -1);
    const incompleteSpeciesResult = buildRuntimeReleaseManifest({
      baseManifest: {
        version: '0.2.0',
        categories: [],
        layers: [],
      },
      preflightManifest: {
        releaseId: RELEASE_ID,
        catalogVersion: '0.2.0',
        generatedAt: '2026-08-05T00:00:00Z',
        solutions: orderedSolutions,
      },
      catalog,
      releaseArtifactInventory: artifactInventory,
      speciesGoalsInventory,
      speciesGoalsCatalog: activeSpeciesGoalsCatalog,
    });
    assert.strictEqual(
      incompleteSpeciesResult.solutions.find((entry) => entry.id === completeLand.id).capabilities,
      undefined,
    );
  });

  it('leaves legacy releases unmarked without both inventories', () => {
    const land = solution('land-solution');
    land.capabilities = { aoiCoverageMetrics: 'v2' };
    const catalog = {
      format: 'solution-catalog-v1',
      catalogVersion: '0.2.0',
      releaseId: RELEASE_ID,
      expectedSolutionCount: 1,
      expectedLandSolutionCount: 1,
      expectedMarineSolutionCount: 0,
      solutions: [
        {
          solutionId: land.id,
          solutionBasename: land.rasterFile,
          domain: land.domain,
          rasterSha256: land.rasterSha256,
        },
      ],
    };

    const result = buildRuntimeReleaseManifest({
      baseManifest: { version: '0.2.0', categories: [], layers: [] },
      preflightManifest: {
        releaseId: RELEASE_ID,
        catalogVersion: '0.2.0',
        solutions: [land],
      },
      catalog,
    });

    assert.strictEqual(result.solutions[0].capabilities, undefined);
  });

  it('keeps production mode on complete canonical release inventory enforcement', () => {
    const land = solution('land-solution');
    const fixture = releaseFixture([land]);
    const artifactInventory = releaseArtifactInventory(fixture.catalog);
    artifactInventory.artifacts = artifactInventory.artifacts.filter(
      (artifact) => artifact.geographyLevel !== 'omecs',
    );
    artifactInventory.artifactCount = artifactInventory.artifacts.length;
    const activeSpeciesGoalsCatalog = speciesGoalsCatalog();

    assert.throws(
      () =>
        buildRuntimeReleaseManifest({
          ...fixture,
          releaseArtifactInventory: artifactInventory,
          speciesGoalsCatalog: activeSpeciesGoalsCatalog,
          speciesGoalsInventory: {
            format: 'species-goals-release-inventory-index-v1',
            releaseId: RELEASE_ID,
            catalogSha256: activeSpeciesGoalsCatalog.catalogSha256,
            solutions: {
              [land.id]: speciesGoalsInventoryEntry(land.id),
            },
          },
        }),
      /not the complete canonical catalog inventory/,
    );
  });

  it('rejects a partial target-only preview inventory', () => {
    const land = solution('land-solution');
    const fixture = releaseFixture([land]);
    const artifactInventory = previewArtifactInventory(fixture.catalog, land.id);
    artifactInventory.artifacts = artifactInventory.artifacts.filter(
      (artifact) => artifact.geographyLevel !== 'omecs',
    );
    artifactInventory.artifactCount = artifactInventory.artifacts.length;
    const activeSpeciesGoalsCatalog = speciesGoalsCatalog();

    assert.throws(
      () =>
        buildRuntimeReleaseManifest({
          ...fixture,
          releaseArtifactInventory: artifactInventory,
          speciesGoalsCatalog: activeSpeciesGoalsCatalog,
          speciesGoalsInventory: {
            format: 'species-goals-release-inventory-index-v1',
            releaseId: RELEASE_ID,
            catalogSha256: activeSpeciesGoalsCatalog.catalogSha256,
            solutions: {
              [land.id]: speciesGoalsInventoryEntry(land.id),
            },
          },
          aoiCoveragePreviewSolutionId: land.id,
        }),
      /not complete and target-only/,
    );
  });

  it('rejects artifacts for another solution in target-only preview inventory', () => {
    const selected = solution('selected-land');
    const other = solution('other-land');
    const fixture = releaseFixture([selected, other]);
    const artifactInventory = previewArtifactInventory(fixture.catalog, selected.id);
    artifactInventory.artifacts.push(
      releaseArtifactInventory(fixture.catalog).artifacts.find(
        (artifact) => artifact.solutionId === other.id && artifact.component === 'regularVerbose',
      ),
    );
    artifactInventory.artifactCount = artifactInventory.artifacts.length;
    const activeSpeciesGoalsCatalog = speciesGoalsCatalog();

    assert.throws(
      () =>
        buildRuntimeReleaseManifest({
          ...fixture,
          releaseArtifactInventory: artifactInventory,
          speciesGoalsCatalog: activeSpeciesGoalsCatalog,
          speciesGoalsInventory: {
            format: 'species-goals-release-inventory-index-v1',
            releaseId: RELEASE_ID,
            catalogSha256: activeSpeciesGoalsCatalog.catalogSha256,
            solutions: {
              [selected.id]: speciesGoalsInventoryEntry(selected.id),
            },
          },
          aoiCoveragePreviewSolutionId: selected.id,
        }),
      /not complete and target-only/,
    );
  });

  it('rejects species-goals evidence from a stale catalog hash', () => {
    const land = solution('land-solution');
    const fixture = releaseFixture([land]);
    const activeSpeciesGoalsCatalog = speciesGoalsCatalog();

    assert.throws(
      () =>
        buildRuntimeReleaseManifest({
          ...fixture,
          releaseArtifactInventory: releaseArtifactInventory(fixture.catalog),
          speciesGoalsCatalog: activeSpeciesGoalsCatalog,
          speciesGoalsInventory: {
            format: 'species-goals-release-inventory-index-v1',
            releaseId: RELEASE_ID,
            catalogSha256: 'e'.repeat(64),
            solutions: {
              [land.id]: speciesGoalsInventoryEntry(land.id),
            },
          },
        }),
      /species goals release inventory is invalid or stale/,
    );
  });

  it('rebinds stale preflight artifact URLs onto the current release contract', () => {
    const land = solution('land-solution');
    const marine = solution('marine-solution', 'marine');
    land.precomputedMetricUrls = {
      goals: `${HOST}/releases/${RELEASE_ID}/goals/land-solution.goals.json`,
      cache: `${HOST}/releases/${RELEASE_ID}/regular/verbose/land-solution.metrics.json`,
      compactCache: `${HOST}/releases/${RELEASE_ID}/regular/compact/land-solution.metrics.compact.json`,
    };
    marine.precomputedMetricUrls = {
      goals: `${HOST}/releases/${RELEASE_ID}/goals/marine-solution.goals.json`,
    };

    const [compactLand, compactMarine] = [land, marine].map((entry) =>
      compactRuntimeSolution(entry, { releaseId: RELEASE_ID }),
    );

    assert.strictEqual(
      compactLand.precomputedMetricUrls.goals,
      `${HOST}/releases/${RELEASE_ID}/goals/v4/land-solution.goals.json`,
    );
    assert.strictEqual(
      compactLand.precomputedMetricUrls.cache,
      `${HOST}/releases/${RELEASE_ID}/regular/verbose/land-solution.metrics.json`,
    );
    assert.strictEqual(
      compactMarine.precomputedMetricUrls.goals,
      `${HOST}/releases/${RELEASE_ID}/goals/v4/marine-solution.goals.json`,
    );
    assert.strictEqual(compactMarine.precomputedMetricUrls.mecV2ByGeography, undefined);
  });

  it('opts into species sidecars only from validated release inventory evidence', () => {
    const land = solution('land-solution');
    const speciesGoalsInventory = {
      format: 'species-goals-release-inventory-v1',
      validated: true,
      solutionId: land.id,
      releaseId: RELEASE_ID,
      catalogValidated: true,
      validatedGeographyLevels: [
        'national',
        'departments',
        'municipalities',
        'siraps',
        'runaps',
        'omecs',
      ],
    };

    const compact = compactRuntimeSolution(land, {
      releaseId: RELEASE_ID,
      speciesGoalsInventory,
    });

    assert.match(
      compact.precomputedMetricUrls.speciesGoalsCatalog,
      /species-goals\/catalog\/v1\/catalog\.json$/,
    );
    assert.strictEqual(
      Object.keys(compact.precomputedMetricUrls.speciesGoalsByGeography).length,
      6,
    );
  });

  it('leaves artifact URLs untouched when no release is supplied', () => {
    const land = solution('land-solution');
    land.precomputedMetricUrls = { goals: `${HOST}/metrics/goals/land-solution.goals.json` };

    assert.deepStrictEqual(
      compactRuntimeSolution(land).precomputedMetricUrls,
      land.precomputedMetricUrls,
    );
  });

  it('binds a release-scoped display COG per publishing domain', () => {
    const land = solution('land-solution');
    const marine = solution('marine-solution', 'marine');

    const [compactLand, compactMarine] = [land, marine].map((entry) =>
      compactRuntimeSolution(entry, { releaseId: RELEASE_ID }),
    );

    assert.strictEqual(
      compactLand.displayCogUrl,
      `${HOST}/releases/${RELEASE_ID}/solutions/land/land-solution.epsg9377.cog.tif`,
    );
    assert.strictEqual(
      compactMarine.displayCogUrl,
      `${HOST}/releases/${RELEASE_ID}/solutions/marine/marine-solution.epsg9377.cog.tif`,
    );
  });

  it('leaves the display COG unbound for a domain that publishes none', () => {
    const unpublished = solution('not-a-domain-solution', 'not-a-domain');

    assert.strictEqual(
      'displayCogUrl' in compactRuntimeSolution(unpublished, { releaseId: RELEASE_ID }),
      false,
    );
  });

  it('rebinds a stale preflight display COG onto the current release', () => {
    const land = solution('land-solution');
    land.displayCogUrl = `${HOST}/solutions/nacional/land-solution.epsg9377.cog.tif`;

    assert.strictEqual(
      compactRuntimeSolution(land, { releaseId: RELEASE_ID }).displayCogUrl,
      `${HOST}/releases/${RELEASE_ID}/solutions/land/land-solution.epsg9377.cog.tif`,
    );
  });

  it('leaves the display COG unbound when no release is supplied', () => {
    assert.strictEqual('displayCogUrl' in compactRuntimeSolution(solution('land-solution')), false);
  });
});
