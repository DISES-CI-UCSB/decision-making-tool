import { buildManifestGeoJsonRenderer, isGeoJsonDisplayUrl } from './manifest-raster-layer.service';

describe('manifest GeoJSON rendering', () => {
  it('recognizes deterministic GeoJSON display URLs with optional query strings', () => {
    expect(
      isGeoJsonDisplayUrl(
        'https://example.com/inputs/reference/ramsar/ramsar.geojson?version=2026-08-04',
      ),
    ).toBe(true);
    expect(isGeoJsonDisplayUrl('https://example.com/inputs/features/ramsar.tif')).toBe(false);
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
