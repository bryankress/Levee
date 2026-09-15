import { fetchUsgsSitesInBoundingBox } from "@/server/integrations/usgs";
import { boundingBoxForRadius, haversineMiles, type LatLon } from "./geo";
import { lookupZipCentroid, type ZipCentroid } from "./zipLookup";

export interface NearbySensor {
  siteNo: string;
  name: string;
  lat: number;
  lon: number;
  distanceMiles: number;
}

export interface SensorSearchResult {
  center: ZipCentroid;
  radiusMiles: number;
  sensors: NearbySensor[];
}

export class UnknownZipError extends Error {
  constructor(zip: string) {
    super(`Unknown ZIP code: ${zip}`);
    this.name = "UnknownZipError";
  }
}

/**
 * The zip-to-sensor discovery flow's core query: given a zip code, find every
 * USGS stream gauge within radiusMiles, nearest first. This is the live data
 * behind the descent animation's landing view, before any org/levee exists.
 */
export async function findSensorsNearZip(
  zip: string,
  radiusMiles = 100,
): Promise<SensorSearchResult> {
  const center = lookupZipCentroid(zip);
  if (!center) throw new UnknownZipError(zip);

  const bbox = boundingBoxForRadius(center, radiusMiles);
  const sites = await fetchUsgsSitesInBoundingBox(bbox);

  const sensors: NearbySensor[] = sites
    .map((site) => ({ ...site, distanceMiles: haversineMiles(center, site as LatLon) }))
    .filter((site) => site.distanceMiles <= radiusMiles)
    .sort((a, b) => a.distanceMiles - b.distanceMiles);

  return { center, radiusMiles, sensors };
}
