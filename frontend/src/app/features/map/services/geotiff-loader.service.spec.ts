import { getRasterCrs } from './geotiff-loader.service';

describe('GeoTIFF loader projection metadata', () => {
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
