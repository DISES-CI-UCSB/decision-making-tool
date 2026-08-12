import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { catalogPatchSummary, parseCatalogArgs } from './catalog.mjs';
import {
  createCatalogPatch,
  createSingleVersionManifest,
  nextPatchVersion,
  validateCatalogPatch,
} from './lib/catalog-patch.mjs';

function referenceLayer(id, category = 'ecosystems') {
  return {
    id,
    spanishLabel: id,
    englishLabel: id,
    description: id,
    tooltip: null,
    dataRole: 'reference_layer',
    category,
    roleInMetricCalculation: 'none',
    displayUrl: `https://example.com/${id}.geojson`,
    metadataUrl: `https://example.com/${id}.metadata.json`,
    compressedDataForLiveMetricsUrl: null,
    precomputedMetricUrls: {},
    rendering: {
      valueType: 'binary',
      renderMode: 'mask',
      selectedValue: 1,
      selectedColor: '#166534',
    },
    requiredForSolution: false,
    selectableInFinder: false,
    visibleInMapLayers: true,
  };
}

function liveManifest() {
  return {
    version: '0.2.0',
    generatedAt: '2026-08-12T00:00:00Z',
    publicBlobHost: 'https://example.com',
    sourceCsv: 'layers.csv',
    releaseId: 'solutions-v0-2-0-20260805',
    catalogVersion: '0.2.0',
    solutionDataProfile: 'runtime-compact-v1',
    categories: [
      {
        id: 'ecosystems',
        spanishLabel: 'Ecosistemas',
        englishLabel: 'Ecosystems',
        layerIds: ['existing'],
      },
    ],
    layers: [referenceLayer('existing')],
    solutions: [{ id: 'solution', rasterFile: 'solution.tif' }],
  };
}

describe('catalog-only patch tooling', () => {
  it('parses repeatable layer IDs and automation flags', () => {
    assert.deepEqual(
      parseCatalogArgs([
        'publish-patch',
        '--layer-id',
        'ramsar',
        '--layer-id',
        'biosphere_reserves',
        '--dry-run',
        '--json',
      ]),
      {
        command: 'publish-patch',
        addLayerIds: ['ramsar', 'biosphere_reserves'],
        removeLayerIds: [],
        dryRun: true,
        yes: false,
        json: true,
        filePath: null,
        spanishLabel: null,
        englishLabel: null,
        description: null,
        category: null,
        sourceOrg: null,
        sourceUrl: null,
        assetVersion: 'v0.1.0',
      },
    );
  });

  it('increments only the patch component', () => {
    assert.equal(nextPatchVersion('3.2.4'), '3.2.5');
    assert.throws(() => nextPatchVersion('3.2.4-beta.1'), /stable MAJOR\.MINOR\.PATCH/);
  });

  it('adds registered view-only layers without changing solutions', () => {
    const live = liveManifest();
    const generated = { layers: [referenceLayer('ramsar')] };
    const candidate = createCatalogPatch({
      liveManifest: live,
      generatedManifest: generated,
      addLayerIds: ['ramsar'],
      generatedAt: '2026-08-12T01:00:00Z',
    });

    assert.equal(candidate.catalogVersion, '0.2.1');
    assert.equal('solutionCatalogVersion' in candidate, false);
    assert.deepEqual(candidate.solutions, live.solutions);
    assert.deepEqual(candidate.categories[0].layerIds, ['existing', 'ramsar']);
    assert.deepEqual(catalogPatchSummary(live, candidate, ['ramsar'], []), {
      livePathname: 'manifest/manifest.json',
      catalogVersionFrom: '0.2.0',
      catalogVersionTo: '0.2.1',
      releaseId: 'solutions-v0-2-0-20260805',
      addedLayers: [
        {
          id: 'ramsar',
          displayUrl: 'https://example.com/ramsar.geojson',
          metadataUrl: 'https://example.com/ramsar.metadata.json',
          category: 'ecosystems',
        },
      ],
      removedLayerIds: [],
      solutionCount: 1,
      solutionsChanged: false,
      metricsRecalculationRequired: false,
    });
  });

  it('supports removing only view-only layers', () => {
    const live = liveManifest();
    const candidate = createCatalogPatch({
      liveManifest: live,
      generatedManifest: { layers: [] },
      removeLayerIds: ['existing'],
    });
    assert.deepEqual(candidate.layers, []);
    assert.deepEqual(candidate.categories[0].layerIds, []);
  });

  it('blocks KBA redistribution and solution drift', async () => {
    const live = liveManifest();
    assert.throws(
      () =>
        createCatalogPatch({
          liveManifest: live,
          generatedManifest: { layers: [referenceLayer('kba_aica')] },
          addLayerIds: ['kba_aica'],
        }),
      /blocked from public redistribution/,
    );

    const candidate = createCatalogPatch({
      liveManifest: live,
      generatedManifest: { layers: [referenceLayer('ramsar')] },
      addLayerIds: ['ramsar'],
    });
    candidate.solutions[0].id = 'changed';
    await assert.rejects(() => validateCatalogPatch(live, candidate), /solutions changed/);
  });

  it('removes the legacy second catalog number without changing catalog content', () => {
    const live = {
      ...liveManifest(),
      catalogVersion: '0.2.1',
      solutionCatalogVersion: '0.2.0',
    };
    const candidate = createSingleVersionManifest(live, '2026-08-12T02:00:00Z');
    assert.equal(candidate.catalogVersion, '0.2.1');
    assert.equal('solutionCatalogVersion' in candidate, false);
    assert.deepEqual(candidate.layers, live.layers);
    assert.deepEqual(candidate.solutions, live.solutions);
  });
});
