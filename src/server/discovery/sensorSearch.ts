import { findNearestComid, findNwisSitesByNavigation, type NldiSite } from "@/server/integrations/nldi";
import { fetchUsgsSitesInBoundingBox } from "@/server/integrations/usgs";
import { boundingBoxForRadius, haversineMiles, type LatLon } from "./geo";
import { lookupZipCentroid, type ZipCentroid } from "./zipLookup";

export type SensorStreamRelation = "UPSTREAM" | "DOWNSTREAM";

export interface NearbySensor {
  siteNo: string;
  name: string;
  lat: number;
  lon: number;
  distanceMiles: number;
  /** Set only when NLDI could place this gauge on the same river network as the search point - never guessed. */
  streamRelation: SensorStreamRelation | undefined;
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
 * The zip-to-sensor discovery flow's core query: given a zip code, find
 * every USGS stream gauge within radiusMiles, nearest first. Prefers real
 * upstream/downstream classification via NLDI's river-network navigation
 * (see findSensorsByNavigation) - falling back to a plain radius search
 * only when NLDI can't place the search point on the mapped network at
 * all, or finds nothing connected. The fallback's gauges get no
 * streamRelation rather than a guessed one.
 */
export async function findSensorsNearZip(
  zip: string,
  radiusMiles = 100,
): Promise<SensorSearchResult> {
  const center = lookupZipCentroid(zip);
  if (!center) throw new UnknownZipError(zip);

  const navigated = await findSensorsByNavigation(center, radiusMiles);
  if (navigated.length > 0) {
    return { center, radiusMiles, sensors: navigated };
  }

  const bbox = boundingBoxForRadius(center, radiusMiles);
  const sites = await fetchUsgsSitesInBoundingBox(bbox);

  const sensors: NearbySensor[] = sites
    .map((site) => ({
      ...site,
      distanceMiles: haversineMiles(center, site as LatLon),
      streamRelation: undefined,
    }))
    .filter((site) => site.distanceMiles <= radiusMiles)
    .sort((a, b) => a.distanceMiles - b.distanceMiles);

  return { center, radiusMiles, sensors };
}

/**
 * Real upstream/downstream classification via NLDI: snaps the search point
 * to the nearest mapped river reach, then navigates that reach's actual
 * network topology in both directions to find connected USGS gauges.
 * Returns [] (not a throw) for any NLDI failure or a point too far from
 * the mapped network - a third-party outage or a rural ZIP with no nearby
 * mapped stream should fall back to the plain radius search, not break
 * the whole page.
 */
async function findSensorsByNavigation(center: ZipCentroid, radiusMiles: number): Promise<NearbySensor[]> {
  let comid: string | undefined;
  try {
    comid = await findNearestComid(center);
  } catch (error) {
    console.error("NLDI comid lookup failed:", error);
    return [];
  }
  if (!comid) return [];

  let upstream: NldiSite[];
  let downstream: NldiSite[];
  try {
    [upstream, downstream] = await Promise.all([
      findNwisSitesByNavigation(comid, "upstream", radiusMiles),
      findNwisSitesByNavigation(comid, "downstream", radiusMiles),
    ]);
  } catch (error) {
    console.error("NLDI navigation failed:", error);
    return [];
  }

  const seen = new Set<string>();
  const sensors: NearbySensor[] = [];
  const tagged: [NldiSite[], SensorStreamRelation][] = [
    [upstream, "UPSTREAM"],
    [downstream, "DOWNSTREAM"],
  ];

  for (const [sites, relation] of tagged) {
    for (const site of sites) {
      if (seen.has(site.siteNo)) continue;
      seen.add(site.siteNo);
      sensors.push({ ...site, distanceMiles: haversineMiles(center, site), streamRelation: relation });
    }
  }

  return sensors.sort((a, b) => a.distanceMiles - b.distanceMiles);
}
