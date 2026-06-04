import { polygonToCustomAoiGeometry } from './custom-aoi-geometry';

describe('polygonToCustomAoiGeometry', () => {
  it('converts an ArcGIS polygon ring into GeoJSON polygon coordinates', () => {
    const geometry = polygonToCustomAoiGeometry({
      rings: [
        [
          [-74.1, 4.6],
          [-74, 4.6],
          [-74, 4.7],
          [-74.1, 4.6],
        ],
      ],
    });

    expect(geometry).toEqual({
      type: 'Polygon',
      coordinates: [
        [
          [-74.1, 4.6],
          [-74, 4.6],
          [-74, 4.7],
          [-74.1, 4.6],
        ],
      ],
    });
  });

  it('projects Web Mercator sketch coordinates to GeoJSON lon/lat coordinates', () => {
    const geometry = polygonToCustomAoiGeometry({
      spatialReference: { wkid: 102100 },
      rings: [
        [
          [0, 0],
          [111319.49079327357, 0],
          [111319.49079327357, 111325.14286638486],
          [0, 0],
        ],
      ],
    });

    expect(geometry?.type).toBe('Polygon');
    expect(geometry?.coordinates[0][0]).toEqual([0, 0]);
    expect(geometry?.coordinates[0][1][0]).toBeCloseTo(1, 6);
    expect(geometry?.coordinates[0][1][1]).toBeCloseTo(0, 6);
    expect(geometry?.coordinates[0][2][0]).toBeCloseTo(1, 6);
    expect(geometry?.coordinates[0][2][1]).toBeCloseTo(1, 6);
  });

  it('closes open rings before sending them to custom AOI metrics', () => {
    const geometry = polygonToCustomAoiGeometry({
      rings: [
        [
          [-74.1, 4.6],
          [-74, 4.6],
          [-74, 4.7],
        ],
      ],
    });

    expect(geometry).toEqual({
      type: 'Polygon',
      coordinates: [
        [
          [-74.1, 4.6],
          [-74, 4.6],
          [-74, 4.7],
          [-74.1, 4.6],
        ],
      ],
    });
  });

  it('returns a MultiPolygon for multipart ArcGIS polygons', () => {
    const geometry = polygonToCustomAoiGeometry({
      rings: [
        [
          [-74.1, 4.6],
          [-74, 4.6],
          [-74, 4.7],
          [-74.1, 4.6],
        ],
        [
          [-73.9, 4.8],
          [-73.8, 4.8],
          [-73.8, 4.9],
          [-73.9, 4.8],
        ],
      ],
    });

    expect(geometry).toEqual({
      type: 'MultiPolygon',
      coordinates: [
        [
          [
            [-74.1, 4.6],
            [-74, 4.6],
            [-74, 4.7],
            [-74.1, 4.6],
          ],
        ],
        [
          [
            [-73.9, 4.8],
            [-73.8, 4.8],
            [-73.8, 4.9],
            [-73.9, 4.8],
          ],
        ],
      ],
    });
  });

  it('rejects polygons without a valid ring', () => {
    expect(
      polygonToCustomAoiGeometry({
        rings: [
          [
            [-74.1, 4.6],
            [-74, 4.6],
          ],
        ],
      }),
    ).toBeNull();
  });
});
