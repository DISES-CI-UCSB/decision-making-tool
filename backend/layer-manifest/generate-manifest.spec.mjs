import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  createBackedMetadataUrl,
  createDeterministicReferenceDisplayReference,
  createLayerEntry,
  createReferenceMetadataUrl,
  getCategoryPalette,
  inferDataRole,
  inferRoleInMetricCalculation,
  pickRenderingForLayer,
  preserveExistingDisplayReference,
  preserveReleaseLayerRendering,
  shouldIncludeManifestRow,
} from './generate-manifest.mjs';

describe('display-only reference layers', () => {
  it('assigns a non-metric reference role from the bilingual model group', () => {
    const row = {
      layer_id: 'ramsar',
      model_group: 'referencia\nreference',
      layer_group: 'Ecosistemas estratégicos',
    };

    assert.strictEqual(inferDataRole(row), 'reference_layer');
    assert.strictEqual(inferRoleInMetricCalculation('reference_layer'), 'none');
  });

  it('builds a deterministic public GeoJSON URL before the asset exists', () => {
    assert.deepStrictEqual(
      createDeterministicReferenceDisplayReference('inputs/reference/ramsar/v0.1.0/ramsar.geojson'),
      {
        status: 'matched',
        type: 'file',
        url: 'https://aagibolq28slyfof.public.blob.vercel-storage.com/inputs/reference/ramsar/v0.1.0/ramsar.geojson',
        blobPath: 'inputs/reference/ramsar/v0.1.0/ramsar.geojson',
      },
    );
  });

  it('registers immutable pipeline provenance metadata beside the GeoJSON', () => {
    assert.strictEqual(
      createReferenceMetadataUrl('inputs/reference/ramsar/v0.1.0/ramsar.geojson'),
      'https://aagibolq28slyfof.public.blob.vercel-storage.com/inputs/reference/ramsar/v0.1.0/ramsar.metadata.json',
    );
  });

  it('fails closed for KBA even if spreadsheet visibility is accidentally enabled', () => {
    assert.strictEqual(
      shouldIncludeManifestRow({
        layer_id: 'kba_aica',
        in_use_now: 'TRUE',
        data_format: 'GeoJSON',
      }),
      false,
    );
  });

  it('uses the approved Campesina Reserve Zones runtime label', async () => {
    const { manifestLayer } = await createLayerEntry(
      {
        layer_id: 'zonas_reserva_campesina_constituida',
        layer_name: 'Zonas de Reserva Campesina Constituidas\nConstituted Peasant Reserve Zones',
        model_group: 'referencia\nreference',
        layer_group: 'Territorios culturales y étnicos',
        layer_description: '',
        storage_location: 'inputs/reference/',
        filename: 'zonas_reserva_campesina_constituida.geojson',
      },
      new Map(),
    );

    assert.strictEqual(manifestLayer.englishLabel, 'Campesina Reserve Zones');
  });
});

describe('optional layer sidecars', () => {
  it('advertises metadata only when Blob inventory proves it exists', () => {
    const metadataPath = 'metadata/ecosistemas.metadata.json';
    const blobByPath = new Map([[metadataPath, { pathname: metadataPath }]]);

    assert.strictEqual(
      createBackedMetadataUrl('ecosistemas', blobByPath),
      'https://aagibolq28slyfof.public.blob.vercel-storage.com/metadata/ecosistemas.metadata.json',
    );
    assert.strictEqual(createBackedMetadataUrl('missing_layer', blobByPath), null);
  });

  it('assigns precomputed lookup authority only to administrative boundaries', () => {
    for (const dataRole of ['feature_layer', 'cost_layer']) {
      assert.strictEqual(inferRoleInMetricCalculation(dataRole), 'none');
    }
    assert.strictEqual(
      inferRoleInMetricCalculation('administrative_boundary'),
      'boundary_used_for_precomputed_metric_lookup',
    );
  });
});

describe('preserveExistingDisplayReference', () => {
  it('keeps a published display URL when the legacy CSV path cannot be reconciled', () => {
    const result = preserveExistingDisplayReference(
      { status: 'pending', type: 'file' },
      { displayUrl: 'https://example.com/existing.tif' },
    );

    assert.deepStrictEqual(result, {
      status: 'matched',
      type: 'file',
      url: 'https://example.com/existing.tif',
      blobPath: undefined,
    });
  });

  it('prefers a newly discovered Blob reference over the published URL', () => {
    const discovered = {
      status: 'matched',
      type: 'file',
      url: 'https://example.com/new.tif',
      blobPath: 'inputs/new.tif',
    };

    assert.strictEqual(
      preserveExistingDisplayReference(discovered, {
        displayUrl: 'https://example.com/existing.tif',
      }),
      discovered,
    );
  });
});

describe('preserveReleaseLayerRendering', () => {
  it('keeps published rendering byte-for-byte during an unrelated release', () => {
    const publishedRendering = {
      valueType: 'binary',
      renderMode: 'mask',
      noDataValue: 255,
      selectedValue: 1,
      selectedColor: '#166526',
    };
    const generatedLayer = {
      id: 'bosque_seco',
      rendering: {
        ...publishedRendering,
        noDataValue: 0,
      },
    };

    const result = preserveReleaseLayerRendering(
      generatedLayer,
      { id: 'bosque_seco', rendering: publishedRendering },
      'sirap-polygon-v2-20260727',
    );

    assert.deepStrictEqual(result.rendering, publishedRendering);
    assert.notStrictEqual(result.rendering, publishedRendering);
  });

  it('allows normal generation to refresh inferred rendering metadata', () => {
    const generatedLayer = {
      id: 'bosque_seco',
      rendering: { valueType: 'binary', renderMode: 'mask', noDataValue: 0 },
    };

    assert.strictEqual(
      preserveReleaseLayerRendering(
        generatedLayer,
        {
          id: 'bosque_seco',
          rendering: { valueType: 'binary', renderMode: 'mask', noDataValue: 255 },
        },
        null,
      ),
      generatedLayer,
    );
  });
});

describe('pickRenderingForLayer', () => {
  it('preserves existing style while refreshing metadata when the inferred mode matches', () => {
    const existingRendering = {
      valueType: 'binary',
      renderMode: 'mask',
      selectedColor: '#abcdef',
      selectedValue: 1,
      noDataValue: -9999,
    };
    const inferredRendering = {
      valueType: 'binary',
      renderMode: 'mask',
      selectedColor: '#000000',
      selectedValue: 2,
      noDataValue: 255,
    };

    const result = pickRenderingForLayer({
      inferredRendering,
      layerId: 'paramos',
      categoryId: 'ecosystems',
      existingLayer: { rendering: existingRendering },
    });

    assert.notStrictEqual(result, existingRendering);
    assert.strictEqual(result.selectedColor, '#abcdef');
    assert.strictEqual(result.selectedValue, 2);
    assert.strictEqual(result.noDataValue, 255);
  });

  it('preserves existing gradient colors while refreshing min/max metadata', () => {
    const existingRendering = {
      valueType: 'continuous',
      renderMode: 'gradient',
      startColor: '#fef3c7',
      endColor: '#854d0e',
      minValue: null,
      maxValue: null,
    };
    const inferredRendering = {
      valueType: 'continuous',
      renderMode: 'gradient',
      startColor: '#000000',
      endColor: '#ffffff',
      minValue: 0,
      maxValue: 100,
    };

    const result = pickRenderingForLayer({
      inferredRendering,
      layerId: 'human_footprint_2022',
      categoryId: 'socioeconomic',
      existingLayer: { rendering: existingRendering },
    });

    assert.strictEqual(result.renderMode, 'gradient');
    assert.strictEqual(result.startColor, '#fef3c7');
    assert.strictEqual(result.endColor, '#854d0e');
    assert.strictEqual(result.minValue, 0);
    assert.strictEqual(result.maxValue, 100);
  });

  it('carries existing mask color into a new gradient end color when the mode flips', () => {
    const existingRendering = {
      valueType: 'binary',
      renderMode: 'mask',
      selectedColor: '#3aa55d',
    };
    const inferredRendering = {
      valueType: 'continuous',
      renderMode: 'gradient',
      startColor: '#bbf7d0',
      endColor: '#166534',
      minValue: 0,
      maxValue: 1,
    };

    const result = pickRenderingForLayer({
      inferredRendering,
      layerId: 'paramos',
      categoryId: 'ecosystems',
      existingLayer: { rendering: existingRendering },
    });

    assert.strictEqual(result.renderMode, 'gradient');
    assert.strictEqual(result.endColor, '#3aa55d');
    assert.notStrictEqual(result.startColor, '#bbf7d0');
    assert.notStrictEqual(result.startColor, undefined);
    assert.strictEqual(result.minValue, 0);
    assert.strictEqual(result.maxValue, 1);
  });

  it('carries existing gradient end color into a new mask selectedColor when the mode flips', () => {
    const existingRendering = {
      valueType: 'continuous',
      renderMode: 'gradient',
      startColor: '#fde68a',
      endColor: '#7c2d12',
    };
    const inferredRendering = {
      valueType: 'binary',
      renderMode: 'mask',
      selectedColor: '#000000',
      selectedValue: 1,
      noDataValue: -9999,
    };

    const result = pickRenderingForLayer({
      inferredRendering,
      layerId: 'human_footprint_2030',
      categoryId: 'prospective_models',
      existingLayer: { rendering: existingRendering },
    });

    assert.strictEqual(result.renderMode, 'mask');
    assert.strictEqual(result.selectedColor, '#7c2d12');
  });

  it('seeds a new layer in a known category from the curated palette with a small hue offset', () => {
    const palette = getCategoryPalette('ecosystems');
    const inferredRendering = {
      valueType: 'binary',
      renderMode: 'mask',
      selectedColor: '#000000',
      selectedValue: 1,
      noDataValue: -9999,
    };

    const result = pickRenderingForLayer({
      inferredRendering,
      layerId: 'new_ecosystem_layer',
      categoryId: 'ecosystems',
      existingLayer: null,
    });

    assert.strictEqual(result.renderMode, 'mask');
    assert.match(result.selectedColor, /^#[0-9a-f]{6}$/);
    assert.notStrictEqual(result.selectedColor, '#000000');
    assertHexCloseTo(result.selectedColor, palette.selectedColor, 18);
  });

  it('seeds a new gradient layer with palette-derived start/end colors', () => {
    const palette = getCategoryPalette('socioeconomic');
    const inferredRendering = {
      valueType: 'continuous',
      renderMode: 'gradient',
      startColor: '#000000',
      endColor: '#ffffff',
      minValue: 0,
      maxValue: 1,
    };

    const result = pickRenderingForLayer({
      inferredRendering,
      layerId: 'brand_new_socio_layer',
      categoryId: 'socioeconomic',
      existingLayer: null,
    });

    assert.strictEqual(result.renderMode, 'gradient');
    assertHexCloseTo(result.startColor, palette.startColor, 18);
    assertHexCloseTo(result.endColor, palette.endColor, 18);
  });
});

describe('getCategoryPalette', () => {
  it('returns the curated palette for a known category', () => {
    assert.deepStrictEqual(getCategoryPalette('administrative_boundaries'), {
      selectedColor: '#111827',
      startColor: '#e5e7eb',
      endColor: '#111827',
    });
  });

  it('falls back to the neutral palette for unknown categories', () => {
    const fallback = getCategoryPalette('not_a_category');
    assert.match(fallback.selectedColor, /^#[0-9a-f]{6}$/);
    assert.match(fallback.startColor, /^#[0-9a-f]{6}$/);
    assert.match(fallback.endColor, /^#[0-9a-f]{6}$/);
  });
});

/**
 * Loose hex-distance check: hue-shifted palette colors should land within a
 * small RGB neighborhood of the canonical palette entry.
 */
function assertHexCloseTo(actualHex, expectedHex, tolerancePerChannel) {
  const actual = parseHex(actualHex);
  const expected = parseHex(expectedHex);
  for (const channel of ['r', 'g', 'b']) {
    const delta = Math.abs(actual[channel] - expected[channel]);
    assert.ok(
      delta <= tolerancePerChannel * 4,
      `Channel ${channel} differs by ${delta} (max ${tolerancePerChannel * 4}) for ${actualHex} vs ${expectedHex}`,
    );
  }
}

function parseHex(hex) {
  const value = String(hex).replace(/^#/, '');
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}
