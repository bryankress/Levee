export interface LatLon {
  lat: number;
  lon: number;
}

export interface BoundingBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

const EARTH_RADIUS_MILES = 3958.7613;

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Great-circle distance between two points, in miles. */
export function haversineMiles(a: LatLon, b: LatLon): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(h)));
}

const MILES_PER_DEGREE_LATITUDE = 69.0;

/**
 * A bounding box guaranteed to contain every point within radiusMiles of the
 * center - a rectangle, so its corners reach slightly farther than the
 * radius. Callers filter candidates by actual haversine distance afterward;
 * this just keeps the upstream query cheap.
 */
export function boundingBoxForRadius(center: LatLon, radiusMiles: number): BoundingBox {
  const latDelta = radiusMiles / MILES_PER_DEGREE_LATITUDE;
  const milesPerDegreeLongitude = MILES_PER_DEGREE_LATITUDE * Math.cos(toRadians(center.lat));
  const lonDelta = radiusMiles / Math.max(milesPerDegreeLongitude, 1);

  return {
    west: center.lon - lonDelta,
    east: center.lon + lonDelta,
    south: center.lat - latDelta,
    north: center.lat + latDelta,
  };
}
