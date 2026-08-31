import * as rasterFunctionUtils from '@arcgis/core/layers/support/rasterFunctionUtils';
import {
  buildManifestCogCategoricalRenderer,
  buildManifestCogRenderer,
  buildManifestCogGradientRenderer,
  buildManifestCogNoDataRasterFunction,
  buildManifestGeoJsonRenderer,
  isCogDisplayUrl,
  isCogRasterRenderingSupported,
  isGeoJsonDisplayUrl,
} from './manifest-raster-layer.service';

describe('manifest GeoJSON rendering', () => {
  it('recognizes deterministic GeoJSON display URLs with optional query strings', () => {
    expect(
      isGeoJsonDisplayUrl(
        'https://example.com/inputs/reference/ramsar/ramsar.geojson?version=2026-08-04',
      ),
    ).toBe(true);
    expect(isGeoJsonDisplayUrl('https://example.com/inputs/features/ramsar.tif')).toBe(false);
  });

  it('recognizes Cloud-Optimized GeoTIFF URLs with optional query strings', () => {
    expect(
      isCogDisplayUrl(
        'https://example.com/experiments/Alouatta_palliata.epsg9377.cog.tif?version=1',
      ),
    ).toBe(true);
    expect(isCogDisplayUrl('https://example.com/inputs/species/Alouatta_palliata.tif')).toBe(false);
  });

  it('uses a transparent default and renders only selected COG mask pixels', () => {
    const renderer = buildManifestCogRenderer({
      displayUrl: 'https://example.com/alouatta.epsg9377.cog.tif',
      visible: true,
      opacity: 0.8,
      color: '#475569',
      rendering: {
        valueType: 'binary',
        renderMode: 'mask',
        noDataValue: 255,
        selectedValue: 1,
        selectedColor: '#bf18ab',
      },
    });

    expect(renderer.field).toBe('Value');
    expect(renderer.defaultSymbol?.color).toMatchObject({ r: 0, g: 0, b: 0, a: 0 });
    expect(renderer.classBreakInfos).toHaveLength(1);
    expect(renderer.classBreakInfos[0]).toMatchObject({ minValue: 0.5, maxValue: 1.5 });
    expect(renderer.classBreakInfos[0].symbol?.color).toMatchObject({
      r: 191,
      g: 24,
      b: 171,
      a: 1,
    });
  });

  it('treats a null selectedValue as the display COG presence value', () => {
    const renderer = buildManifestCogRenderer({
      displayUrl: 'https://example.com/alouatta.epsg9377.cog.tif',
      visible: true,
      opacity: 1,
      color: '#475569',
      rendering: {
        valueType: 'binary',
        renderMode: 'mask',
        selectedValue: null,
        selectedColor: '#bf18ab',
      },
    });

    expect(renderer.classBreakInfos).toHaveLength(1);
    expect(renderer.classBreakInfos[0]).toMatchObject({ minValue: 0.5, maxValue: 1.5 });
  });

  it('builds a fixed-range algorithmic stretch renderer for a gradient COG', () => {
    const renderer = buildManifestCogGradientRenderer({
      displayUrl: 'https://example.com/richness.epsg9377.cog.tif',
      visible: true,
      opacity: 1,
      color: '#854d0e',
      rendering: {
        valueType: 'continuous',
        renderMode: 'gradient',
        minValue: 815,
        maxValue: 3562,
        startColor: '#fef3c7',
        endColor: '#854d0e',
      },
    });
    const colorRamp = renderer.colorRamp as unknown as {
      type: string;
      algorithm: string;
      fromColor: { r: number; g: number; b: number; a: number };
      toColor: { r: number; g: number; b: number; a: number };
    };

    expect(renderer.type).toBe('raster-stretch');
    expect(renderer.stretchType).toBe('min-max');
    expect(renderer.dynamicRangeAdjustment).toBe(false);
    expect(renderer.customStatistics).toEqual([{ min: 815, max: 3562, avg: 2188.5, stddev: 0 }]);
    expect(colorRamp).toMatchObject({
      type: 'algorithmic',
      algorithm: 'hsv',
      fromColor: { r: 254, g: 243, b: 199, a: 1 },
      toColor: { r: 133, g: 77, b: 14, a: 1 },
    });
  });

  it('binds a COG NoData mask to the direct-file raster input', () => {
    const rasterFunction = buildManifestCogNoDataRasterFunction(-9999, rasterFunctionUtils);

    expect(rasterFunction?.functionName).toBe('Mask');
    expect(rasterFunction?.functionArguments).toEqual({
      raster: '$$',
      noDataInterpretation: 0,
      noDataValues: ['-9999'],
    });
  });

  it('does not create a mask without configured NoData', () => {
    expect(buildManifestCogNoDataRasterFunction(null, rasterFunctionUtils)).toBeNull();
  });

  it('preserves categorical COG class values, colors, and labels', () => {
    const renderer = buildManifestCogCategoricalRenderer({
      displayUrl: 'https://example.com/ecosystems.epsg9377.cog.tif',
      visible: true,
      opacity: 1,
      color: '#475569',
      rendering: {
        valueType: 'categorical',
        renderMode: 'categorical',
        noDataValue: 0,
        classColors: [
          { value: 3, color: '#14532d', label: 'Montane forest' },
          { value: 7, color: '#f97316', label: 'Dry forest' },
        ],
      },
    });

    expect(renderer.field).toBe('Value');
    expect(renderer.defaultSymbol?.color).toMatchObject({ r: 0, g: 0, b: 0, a: 0 });
    expect(renderer.classBreakInfos).toHaveLength(2);
    expect(renderer.classBreakInfos).toMatchObject([
      {
        minValue: 2.5,
        maxValue: 3.5,
        label: 'Montane forest',
        symbol: { color: { r: 20, g: 83, b: 45, a: 1 } },
      },
      {
        minValue: 6.5,
        maxValue: 7.5,
        label: 'Dry forest',
        symbol: { color: { r: 249, g: 115, b: 22, a: 1 } },
      },
    ]);
  });

  it('routes mask, categorical, and valid fixed-range gradient COGs through ImageryTileLayer', () => {
    expect(
      isCogRasterRenderingSupported('https://example.com/mask.epsg9377.cog.tif', {
        valueType: 'binary',
        renderMode: 'mask',
      }),
    ).toBe(true);
    expect(
      isCogRasterRenderingSupported('https://example.com/ecosystems.epsg9377.cog.tif', {
        valueType: 'categorical',
        renderMode: 'categorical',
        classColors: [{ value: 1, color: '#166534', label: 'Forest' }],
      }),
    ).toBe(true);
    expect(
      isCogRasterRenderingSupported('https://example.com/richness.epsg9377.cog.tif', {
        valueType: 'continuous',
        renderMode: 'gradient',
        minValue: 1,
        maxValue: 142,
      }),
    ).toBe(true);
    expect(
      isCogRasterRenderingSupported('https://example.com/richness.epsg9377.cog.tif', {
        valueType: 'continuous',
        renderMode: 'gradient',
        minValue: 142,
        maxValue: 1,
      }),
    ).toBe(false);
  });

  it('builds a generic polygon renderer from sidebar appearance state', () => {
    expect(
      buildManifestGeoJsonRenderer({
        color: '#166534',
        borderColor: '#14532d',
        borderWidth: 2,
      }),
    ).toEqual({
      type: 'simple',
      symbol: {
        type: 'simple-fill',
        style: 'solid',
        color: [22, 101, 52, 0.35],
        outline: {
          color: [20, 83, 45, 1],
          width: 2,
        },
      },
    });
  });
});
