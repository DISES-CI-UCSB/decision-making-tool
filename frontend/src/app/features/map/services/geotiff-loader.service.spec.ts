import { getRasterCrs, getSolutionRasterDataUrl } from './geotiff-loader.service';

describe('GeoTIFF loader projection metadata', () => {
  it('uses the display COG as raster data when ArcGIS renders that COG', () => {
    expect(
      getSolutionRasterDataUrl({
        displayUrl: 'https://example.com/raw.epsg4326.tif',
        displayCogUrl: 'https://example.com/display.epsg9377.cog.tif',
      }),
    ).toBe('https://example.com/display.epsg9377.cog.tif');
  });

  it('falls back to the source raster when no display COG is published', () => {
    expect(
      getSolutionRasterDataUrl({
        displayUrl: 'https://example.com/raw.tif',
        displayCogUrl: null,
      }),
    ).toBe('https://example.com/raw.tif');
  });

  it('reads the projected EPSG code from the GeoTIFF image API', () => {
    const image = {
      getGeoKeys: () => ({
        ProjectedCSTypeGeoKey: 9377,
      }),
      fileDirectory: {},
    };

    expect(getRasterCrs(image)).toBe('EPSG:9377');
  });

  it('prefers a projected CRS over its geographic base CRS', () => {
    const image = {
      getGeoKeys: () => ({
        GeographicTypeGeoKey: 20046,
        ProjectedCSTypeGeoKey: 9377,
      }),
    };

    expect(getRasterCrs(image)).toBe('EPSG:9377');
  });

  it('keeps geographic rasters in their declared CRS', () => {
    const image = {
      getGeoKeys: () => ({
        GeographicTypeGeoKey: 4326,
      }),
    };

    expect(getRasterCrs(image)).toBe('EPSG:4326');
  });
});
