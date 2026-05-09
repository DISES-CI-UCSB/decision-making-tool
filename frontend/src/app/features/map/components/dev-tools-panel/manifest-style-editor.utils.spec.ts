import {
  parseCategoryPath,
  type RuntimeLayerManifest,
  type RuntimeLayerManifestLayer,
} from '@core/models/layer-manifest.model';
import {
  applyCategoryColorDefaults,
  buildManifestDiffSummary,
  clearLayerStyleOverride,
  getCategoryColorDefaults,
  getSubcategoryColorDefaults,
  isValidHexColor,
  normalizeManifestForEditor,
  parseOptionalNumber,
  setSubcategoryColorDefaults,
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
      version: '0.2.0',
      generatedAt: '2026-05-07T00:00:00.000Z',
      publicBlobHost: 'blob.vercel-storage.com',
      sourceCsv: 'layers.csv',
      categories: [
        {
          id: 'ecosystems',
          spanishLabel: 'Ecosistemas',
          englishLabel: 'Ecosystems',
          layerIds: ['layer-mask'],
        },
      ],
      layers: [
        {
          id: 'layer-mask',
          spanishLabel: 'Mascara',
          englishLabel: 'Mask',
          description: 'Mask layer',
          tooltip: null,
          dataRole: 'feature_layer',
          category: 'ecosystems',
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
      solutions: [],
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
    expect(diff.changedDefaultCount).toBe(0);
    expect(diff.changedOverrideCount).toBe(0);
  });

  it('supports basic parser and hex helpers', () => {
    expect(parseOptionalNumber('')).toBe(null);
    expect(parseOptionalNumber('42.5')).toBe(42.5);
    expect(Number.isNaN(parseOptionalNumber('abc') as number)).toBe(true);
    expect(isValidHexColor('#22c55e')).toBe(true);
    expect(isValidHexColor('#22c5')).toBe(false);
  });

  it('parses bare and dotted category paths', () => {
    expect(parseCategoryPath('ecosystems')).toEqual({
      categoryId: 'ecosystems',
      subcategoryId: null,
    });
    expect(parseCategoryPath('species_and_biodiversity.felidae')).toEqual({
      categoryId: 'species_and_biodiversity',
      subcategoryId: 'felidae',
    });
    expect(() => parseCategoryPath('Bad.Category')).toThrow();
    expect(() => parseCategoryPath('a.b.c')).toThrow();
  });

  it('synthesizes default rendering for layers missing a rendering block', () => {
    const layerWithoutRendering = {
      id: 'layer-no-rendering',
      spanishLabel: 'Sin rendering',
      englishLabel: 'No Rendering',
      description: 'Layer missing rendering',
      tooltip: null,
      dataRole: 'feature_layer',
      category: 'ecosystems',
      roleInMetricCalculation: 'none',
      displayUrl: null,
      displayCollectionUrl: null,
      speciesManifestUrl: null,
      metadataUrl: null,
      compressedDataForLiveMetricsUrl: null,
      precomputedMetricUrls: {},
    } as unknown as RuntimeLayerManifestLayer;

    const manifest: RuntimeLayerManifest = {
      version: '0.2.0',
      generatedAt: '2026-05-07T00:00:00.000Z',
      publicBlobHost: 'blob.vercel-storage.com',
      sourceCsv: 'layers.csv',
      categories: [
        {
          id: 'ecosystems',
          spanishLabel: 'Ecosistemas',
          englishLabel: 'Ecosystems',
          layerIds: ['layer-no-rendering'],
        },
      ],
      layers: [layerWithoutRendering],
      solutions: [],
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
      category: 'species_and_biodiversity',
      roleInMetricCalculation: 'data_used_for_live_metric_calculation',
      displayUrl: null,
      displayCollectionUrl: null,
      speciesManifestUrl: null,
      metadataUrl: null,
      compressedDataForLiveMetricsUrl: null,
      precomputedMetricUrls: {},
    } as unknown as RuntimeLayerManifestLayer;

    const normalized = normalizeManifestForEditor({
      version: '0.2.0',
      generatedAt: '2026-05-07T00:00:00.000Z',
      publicBlobHost: 'blob.vercel-storage.com',
      sourceCsv: 'layers.csv',
      categories: [
        {
          id: 'species_and_biodiversity',
          spanishLabel: 'Especies y biodiversidad',
          englishLabel: 'Species & Biodiversity',
          layerIds: ['species'],
        },
      ],
      layers: [speciesPointerLayer],
      solutions: [],
    });

    expect(normalized.layers[0].rendering).toBeUndefined();
  });

  it('applies category defaults inline and skips layer-specific overrides', () => {
    const manifest = manifestWithTwoEcosystemLayers();

    const updated = applyCategoryColorDefaults(
      manifest,
      'ecosystems',
      { selectedColor: '#15803d' },
      { replaceOverrides: false },
    );

    const ecosystemsCategory = updated.categories.find((entry) => entry.id === 'ecosystems');
    expect(ecosystemsCategory?.styleDefaults?.selectedColor).toBe('#15803d');
    expect(updated.layers[0].rendering.selectedColor).toBe('#15803d');
    expect(updated.layers[1].rendering.selectedColor).toBe('#f97316');
  });

  it('uses gradient end color as the derived category mask color', () => {
    const manifest: RuntimeLayerManifest = {
      ...manifestWithTwoEcosystemLayers(),
      layers: [
        ...manifestWithTwoEcosystemLayers().layers,
        {
          ...manifestWithTwoEcosystemLayers().layers[0],
          id: 'ecosystems-gradient',
          rendering: {
            valueType: 'continuous',
            renderMode: 'gradient',
            startColor: '#bbf7d0',
            endColor: '#166534',
          },
        },
      ],
    };

    const defaults = getCategoryColorDefaults(manifest, 'ecosystems');

    expect(defaults.selectedColor).toBe('#166534');
    expect(defaults.startColor).toBe('#bbf7d0');
    expect(defaults.endColor).toBe('#166534');
  });

  it('reads inline category styleDefaults when present', () => {
    const manifest: RuntimeLayerManifest = {
      ...manifestWithTwoEcosystemLayers(),
      categories: [
        {
          ...manifestWithTwoEcosystemLayers().categories[0],
          styleDefaults: {
            selectedColor: '#15803d',
            startColor: '#bbf7d0',
            endColor: '#15803d',
          },
        },
      ],
    };

    const defaults = getCategoryColorDefaults(manifest, 'ecosystems');
    expect(defaults.selectedColor).toBe('#15803d');
    expect(defaults.startColor).toBe('#bbf7d0');
    expect(defaults.endColor).toBe('#15803d');
  });

  it('reads and writes inline subcategory styleDefaults', () => {
    const manifest = manifestWithSpeciesSubcategory();
    const initial = getSubcategoryColorDefaults(manifest, 'species_and_biodiversity', 'felidae');
    expect(initial.selectedColor).toBe('#854d0e');

    const updated = setSubcategoryColorDefaults(manifest, 'species_and_biodiversity', 'felidae', {
      selectedColor: '#000000',
      startColor: '#fde68a',
      endColor: '#000000',
    });
    const subcategory = updated.categories[0].subcategories?.[0];
    expect(subcategory?.styleDefaults).toEqual({
      selectedColor: '#000000',
      startColor: '#fde68a',
      endColor: '#000000',
    });
  });

  it('can replace category layer overrides when requested', () => {
    const manifest = manifestWithTwoEcosystemLayers();

    const updated = applyCategoryColorDefaults(
      manifest,
      'ecosystems',
      { selectedColor: '#15803d' },
      { replaceOverrides: true },
    );

    expect(updated.layers[0].rendering.selectedColor).toBe('#15803d');
    expect(updated.layers[1].rendering.selectedColor).toBe('#15803d');
    expect(updated.layers[1].styleOverride).toBeNull();
  });

  it('clears a layer override by restoring the category default colors', () => {
    const baseManifest = manifestWithTwoEcosystemLayers();
    const manifest: RuntimeLayerManifest = {
      ...baseManifest,
      categories: [
        {
          ...baseManifest.categories[0],
          styleDefaults: {
            selectedColor: '#15803d',
          },
        },
      ],
    };

    const updated = clearLayerStyleOverride(manifest, 'layer-override');

    expect(updated.layers[1].rendering.selectedColor).toBe('#15803d');
    expect(updated.layers[1].styleOverride).toBeNull();
  });

  it('includes inline category and subcategory diffs and override changes', () => {
    const loadedManifest = manifestWithSpeciesSubcategory();
    const draftManifest: RuntimeLayerManifest = {
      ...loadedManifest,
      categories: [
        {
          ...loadedManifest.categories[0],
          styleDefaults: {
            selectedColor: '#7c2d12',
            startColor: loadedManifest.categories[0].styleDefaults?.startColor,
            endColor: loadedManifest.categories[0].styleDefaults?.endColor,
          },
          subcategories: [
            {
              ...loadedManifest.categories[0].subcategories![0],
              styleDefaults: { selectedColor: '#1e293b' },
            },
          ],
        },
      ],
      layers: loadedManifest.layers.map((layer) =>
        layer.id === 'species_richness' ? { ...layer, styleOverride: null } : layer,
      ),
    };

    const diff = buildManifestDiffSummary(loadedManifest, draftManifest);

    expect(diff.changedDefaultCount).toBe(2);
    const categoryDiff = diff.changedDefaults.find((entry) => entry.scopeType === 'category');
    expect(categoryDiff).toEqual({
      scopeType: 'category',
      scopeId: 'species_and_biodiversity',
      changedFields: ['selectedColor'],
    });
    const subcategoryDiff = diff.changedDefaults.find((entry) => entry.scopeType === 'subcategory');
    expect(subcategoryDiff).toEqual({
      scopeType: 'subcategory',
      scopeId: 'species_and_biodiversity.felidae',
      changedFields: ['selectedColor'],
    });
    expect(diff.changedOverrideCount).toBe(1);
    expect(diff.changedOverrideLayers).toEqual(['species_richness']);
  });
});

function manifestWithTwoEcosystemLayers(): RuntimeLayerManifest {
  return {
    version: '0.2.0',
    generatedAt: '2026-05-07T00:00:00.000Z',
    publicBlobHost: 'blob.vercel-storage.com',
    sourceCsv: 'layers.csv',
    categories: [
      {
        id: 'ecosystems',
        spanishLabel: 'Ecosistemas',
        englishLabel: 'Ecosystems',
        layerIds: ['layer-default', 'layer-override'],
      },
    ],
    layers: [
      {
        id: 'layer-default',
        spanishLabel: 'Default',
        englishLabel: 'Default',
        description: 'Default layer',
        tooltip: null,
        dataRole: 'feature_layer',
        category: 'ecosystems',
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
      {
        id: 'layer-override',
        spanishLabel: 'Override',
        englishLabel: 'Override',
        description: 'Override layer',
        tooltip: null,
        dataRole: 'feature_layer',
        category: 'ecosystems',
        roleInMetricCalculation: 'none',
        displayUrl: null,
        displayCollectionUrl: null,
        speciesManifestUrl: null,
        metadataUrl: null,
        compressedDataForLiveMetricsUrl: null,
        precomputedMetricUrls: {},
        styleOverride: true,
        rendering: {
          valueType: 'binary',
          renderMode: 'mask',
          selectedColor: '#f97316',
          selectedValue: 1,
          noDataValue: -9999,
        },
      },
    ],
  };
}

function manifestWithSpeciesSubcategory(): RuntimeLayerManifest {
  return {
    version: '0.2.0',
    generatedAt: '2026-05-07T00:00:00.000Z',
    publicBlobHost: 'blob.vercel-storage.com',
    sourceCsv: 'layers.csv',
    categories: [
      {
        id: 'species_and_biodiversity',
        spanishLabel: 'Especies y biodiversidad',
        englishLabel: 'Species & Biodiversity',
        styleDefaults: {
          selectedColor: '#854d0e',
          startColor: '#fef3c7',
          endColor: '#854d0e',
        },
        subcategories: [
          {
            id: 'felidae',
            spanishLabel: 'Felidae',
            englishLabel: 'Felidae',
            styleDefaults: { selectedColor: '#854d0e' },
            layerIds: [],
          },
        ],
        layerIds: ['species_richness'],
      },
    ],
    layers: [
      {
        id: 'species_richness',
        spanishLabel: 'Riqueza de especies',
        englishLabel: 'Species Richness',
        description: 'Species richness raster',
        tooltip: null,
        dataRole: 'feature_layer',
        category: 'species_and_biodiversity',
        roleInMetricCalculation: 'data_used_for_live_metric_calculation',
        displayUrl: 'https://example.com/species_richness.tif',
        displayCollectionUrl: null,
        speciesManifestUrl: null,
        metadataUrl: null,
        compressedDataForLiveMetricsUrl: null,
        precomputedMetricUrls: {},
        styleOverride: true,
        rendering: {
          valueType: 'continuous',
          renderMode: 'gradient',
          startColor: '#fef3c7',
          endColor: '#854d0e',
          minValue: 815,
          maxValue: 3562,
        },
      },
    ],
  };
}
