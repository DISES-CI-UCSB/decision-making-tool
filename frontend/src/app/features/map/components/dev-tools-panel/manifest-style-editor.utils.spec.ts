import type {
  RuntimeLayerManifest,
  RuntimeLayerManifestLayer,
} from '@core/models/layer-manifest.model';
import {
  buildManifestDiffSummary,
  isValidHexColor,
  normalizeManifestForEditor,
  parseOptionalNumber,
  validateRenderingConfig,
} from './manifest-style-editor.utils';

describe('manifest-style-editor.utils', () => {
  it('validates mask rendering colors and numeric values', () => {
    const errors = validateRenderingConfig({
      valueType: 'binary',
      renderMode: 'mask',
      selectedColor: '#zzzzzz',
      selectedValue: Number.NaN,
      noDataValue: Number.NaN,
    });

    expect(errors['selectedColor']?.length).toBeGreaterThan(0);
    expect(errors['selectedValue']?.length).toBeGreaterThan(0);
    expect(errors['noDataValue']?.length).toBeGreaterThan(0);
  });

  it('validates gradient min/max semantics', () => {
    const errors = validateRenderingConfig({
      valueType: 'continuous',
      renderMode: 'gradient',
      startColor: '#d1fae5',
      endColor: '#166534',
      minValue: 20,
      maxValue: 10,
    });

    expect(errors['maxValue']).toContain('maxValue must be greater than minValue');
  });

  it('builds changed fields by layer id', () => {
    const loadedManifest: RuntimeLayerManifest = {
      version: '1',
      generatedAt: '2026-05-07T00:00:00.000Z',
      publicBlobHost: 'blob.vercel-storage.com',
      sourceCsv: 'layers.csv',
      categories: [],
      layers: [
        {
          id: 'layer-mask',
          spanishLabel: 'Mascara',
          englishLabel: 'Mask',
          description: 'Mask layer',
          tooltip: null,
          dataRole: 'feature_layer',
          sidebarCategoryId: 'ecosystems',
          roleInMetricCalculation: 'none',
          displayUrl: null,
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
        },
      ],
    };

    const draftManifest: RuntimeLayerManifest = {
      ...loadedManifest,
      layers: [
        {
          ...loadedManifest.layers[0],
          rendering: {
            ...loadedManifest.layers[0].rendering,
            selectedColor: '#16a34a',
            selectedValue: 2,
          },
        },
      ],
    };

    const diff = buildManifestDiffSummary(loadedManifest, draftManifest);
    expect(diff.changedLayerCount).toBe(1);
    expect(diff.changedLayers[0]).toEqual({
      layerId: 'layer-mask',
      changedFields: ['selectedColor', 'selectedValue'],
    });
  });

  it('supports basic parser and hex helpers', () => {
    expect(parseOptionalNumber('')).toBe(null);
    expect(parseOptionalNumber('42.5')).toBe(42.5);
    expect(Number.isNaN(parseOptionalNumber('abc') as number)).toBe(true);
    expect(isValidHexColor('#22c55e')).toBe(true);
    expect(isValidHexColor('#22c5')).toBe(false);
  });

  it('synthesizes default rendering for layers missing a rendering block', () => {
    const layerWithoutRendering = {
      id: 'layer-no-rendering',
      spanishLabel: 'Sin rendering',
      englishLabel: 'No Rendering',
      description: 'Layer missing rendering',
      tooltip: null,
      dataRole: 'feature_layer',
      sidebarCategoryId: 'ecosystems',
      roleInMetricCalculation: 'none',
      displayUrl: null,
      displayCollectionUrl: null,
      speciesManifestUrl: null,
      metadataUrl: null,
      compressedDataForLiveMetricsUrl: null,
      precomputedMetricUrls: {},
    } as unknown as RuntimeLayerManifestLayer;

    const manifest: RuntimeLayerManifest = {
      version: '1',
      generatedAt: '2026-05-07T00:00:00.000Z',
      publicBlobHost: 'blob.vercel-storage.com',
      sourceCsv: 'layers.csv',
      categories: [],
      layers: [layerWithoutRendering],
    };

    const normalized = normalizeManifestForEditor(manifest);
    const normalizedLayer = normalized.layers[0];
    expect(normalizedLayer.rendering.renderMode).toBe('gradient');
    expect(normalizedLayer.rendering.startColor).toBe('#d1fae5');
  });

  it('skips data roles that are not editable', () => {
    const speciesPointerLayer = {
      id: 'species',
      spanishLabel: 'Especies',
      englishLabel: 'Species',
      description: 'Species manifest pointer',
      tooltip: null,
      dataRole: 'manifest_for_species_layers',
      sidebarCategoryId: 'species_and_biodiversity',
      roleInMetricCalculation: 'data_used_for_live_metric_calculation',
      displayUrl: null,
      displayCollectionUrl: null,
      speciesManifestUrl: null,
      metadataUrl: null,
      compressedDataForLiveMetricsUrl: null,
      precomputedMetricUrls: {},
    } as unknown as RuntimeLayerManifestLayer;

    const normalized = normalizeManifestForEditor({
      version: '1',
      generatedAt: '2026-05-07T00:00:00.000Z',
      publicBlobHost: 'blob.vercel-storage.com',
      sourceCsv: 'layers.csv',
      categories: [],
      layers: [speciesPointerLayer],
    });

    expect(normalized.layers[0].rendering).toBeUndefined();
  });
});
