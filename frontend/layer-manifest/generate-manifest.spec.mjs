import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { getCategoryPalette, pickRenderingForLayer } from './generate-manifest.mjs';

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
