import type Polygon from '@arcgis/core/geometry/Polygon';
import type { CustomPolygonMetricsGeometry } from '@core/models';

type ArcGisRing = readonly (readonly number[])[];
interface ArcGisSpatialReferenceLike {
  isWebMercator?: boolean;
  wkid?: number | null;
}
type ArcGisPolygonLike = Pick<Polygon, 'rings'> & {
  spatialReference?: ArcGisSpatialReferenceLike | null;
};

const WEB_MERCATOR_RADIUS_METERS = 6378137;
const WEB_MERCATOR_WKIDS = new Set([3857, 102100, 102113]);

function isWebMercatorSpatialReference(
  spatialReference: ArcGisSpatialReferenceLike | null | undefined,
): boolean {
  return Boolean(
    spatialReference?.isWebMercator ||
    (typeof spatialReference?.wkid === 'number' && WEB_MERCATOR_WKIDS.has(spatialReference.wkid)),
  );
}

function webMercatorPositionToLonLat([x, y]: [number, number]): [number, number] {
  const longitude = (x / WEB_MERCATOR_RADIUS_METERS) * (180 / Math.PI);
  const latitude =
    (2 * Math.atan(Math.exp(y / WEB_MERCATOR_RADIUS_METERS)) - Math.PI / 2) * (180 / Math.PI);

  return [longitude, latitude];
}

function normalizeRing(ring: ArcGisRing, shouldProjectToLonLat: boolean): number[][] | null {
  const coordinates = ring
    .map((position) => position.slice(0, 2))
    .filter(
      (position): position is [number, number] =>
        position.length === 2 && position.every((value) => Number.isFinite(value)),
    )
    .map((position) => (shouldProjectToLonLat ? webMercatorPositionToLonLat(position) : position))
    .map(([x, y]) => [x, y]);

  if (coordinates.length < 3) {
    return null;
  }

  const first = coordinates[0];
  const last = coordinates[coordinates.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    coordinates.push([...first]);
  }

  return coordinates.length >= 4 ? coordinates : null;
}

export function polygonToCustomAoiGeometry(
  polygon: ArcGisPolygonLike | null | undefined,
): CustomPolygonMetricsGeometry | null {
  const shouldProjectToLonLat = isWebMercatorSpatialReference(polygon?.spatialReference);
  const rings = polygon?.rings
    .map((ring) => normalizeRing(ring, shouldProjectToLonLat))
    .filter((ring): ring is number[][] => ring !== null);

  if (!rings || rings.length === 0) {
    return null;
  }

  if (rings.length === 1) {
    return {
      type: 'Polygon',
      coordinates: rings,
    };
  }

  return {
    type: 'MultiPolygon',
    coordinates: rings.map((ring) => [ring]),
  };
}
