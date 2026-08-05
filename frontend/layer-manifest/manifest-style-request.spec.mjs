import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  applyStyleRequestToManifest,
  assertLayerCategoryPaths,
  findLatestPendingStyleRequest,
} from './manifest-style-request.mjs';

describe('manifest style requests', () => {
  it('applies a style request to a newer manifest without dropping solutions', () => {
    const manifest = baseManifest({
      releaseId: 'release-one',
      catalogVersion: '0.1.0',
      solutions: [{ id: 'solution-new', name: 'Latest solution', extra: 'preserved' }],
      futureTopLevelField: { survives: true },
    });
    const updated = applyStyleRequestToManifest(manifest, {
      editorName: 'William',
      styleChanges: {
        categoryDefaults: [
          { categoryId: 'ecosystems', styleDefaults: { selectedColor: '#15803d' } },
        ],
        subcategoryDefaults: [],
        layerStyles: [
          {
            layerId: 'ecosystems-mask',
            rendering: {
              valueType: 'binary',
              renderMode: 'mask',
              selectedColor: '#15803d',
              selectedValue: 1,
              noDataValue: -9999,
            },
            styleOverride: null,
          },
        ],
      },
    });

    assert.deepStrictEqual(updated.solutions, manifest.solutions);
    assert.equal(updated.releaseId, manifest.releaseId);
    assert.equal(updated.catalogVersion, manifest.catalogVersion);
    assert.deepStrictEqual(updated.futureTopLevelField, { survives: true });
    assert.equal(updated.categories[0].styleDefaults.selectedColor, '#15803d');
    assert.equal(updated.layers[0].rendering.selectedColor, '#15803d');
  });

  it('rejects invalid category paths before applying styles', () => {
    const manifest = baseManifest({
      layers: [{ ...baseLayer(), category: 'Bad.Category' }],
    });

    assert.throws(() => assertLayerCategoryPaths(manifest), /must match/);
    assert.throws(
      () =>
        applyStyleRequestToManifest(manifest, {
          editorName: 'William',
          styleChanges: { categoryDefaults: [], subcategoryDefaults: [], layerStyles: [] },
        }),
      /must match/,
    );
  });

  it('chooses the latest pending Firestore request', () => {
    const latest = findLatestPendingStyleRequest([
      { id: 'old-pending', status: 'pending', createdAt: '2026-05-07T00:00:00.000Z' },
      { id: 'published', status: 'published', createdAt: '2026-05-09T00:00:00.000Z' },
      { id: 'new-pending', status: 'pending', createdAt: { seconds: 1_778_304_000 } },
    ]);

    assert.equal(latest.id, 'new-pending');
  });

  it('preserves non-style manifest fields while applying style fields', () => {
    const manifest = baseManifest({
      layers: [
        {
          ...baseLayer(),
          displayUrl: 'https://example.com/current.tif',
          metadataUrl: 'https://example.com/current.json',
          customFutureLayerField: 'keep-me',
        },
      ],
    });

    const updated = applyStyleRequestToManifest(manifest, {
      editorName: 'William',
      styleChanges: {
        categoryDefaults: [],
        subcategoryDefaults: [],
        layerStyles: [
          {
            layerId: 'ecosystems-mask',
            rendering: { ...manifest.layers[0].rendering, selectedColor: '#166534' },
            styleOverride: true,
          },
        ],
      },
    });

    assert.equal(updated.layers[0].displayUrl, 'https://example.com/current.tif');
    assert.equal(updated.layers[0].metadataUrl, 'https://example.com/current.json');
    assert.equal(updated.layers[0].customFutureLayerField, 'keep-me');
    assert.equal(updated.layers[0].rendering.selectedColor, '#166534');
    assert.equal(updated.layers[0].styleOverride, true);
  });
});

function baseManifest(overrides = {}) {
  return {
    version: '0.2.0',
    generatedAt: '2026-05-08T00:00:00.000Z',
    publicBlobHost: 'https://example.com',
    sourceCsv: 'layers.csv',
    categories: [
      {
        id: 'ecosystems',
        spanishLabel: 'Ecosistemas',
        englishLabel: 'Ecosystems',
        layerIds: ['ecosystems-mask'],
      },
    ],
    layers: [baseLayer()],
    solutions: [{ id: 'solution-1', name: 'Existing solution' }],
    ...overrides,
  };
}

function baseLayer() {
  return {
    id: 'ecosystems-mask',
    spanishLabel: 'Ecosistemas',
    englishLabel: 'Ecosystems',
    description: 'Ecosystem mask',
    tooltip: null,
    dataRole: 'feature_layer',
    category: 'ecosystems',
    roleInMetricCalculation: 'none',
    displayUrl: 'https://example.com/display.tif',
    displayCollectionUrl: null,
    speciesManifestUrl: null,
    metadataUrl: null,
    compressedDataForLiveMetricsUrl: null,
    precomputedMetricUrls: {},
    rendering: {
      valueType: 'binary',
      renderMode: 'mask',
      selectedColor: '#22c55e',
      selectedValue: 1,
      noDataValue: -9999,
    },
  };
}
