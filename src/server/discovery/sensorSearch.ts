import { findNearestComid, findNwisSitesByNavigation, type NldiSite } from "@/server/integrations/nldi";
import { findCachedSitesNearby } from "./siteCatalog";
import { haversineMiles, type LatLon } from "./geo";
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
  /** UPSTREAM only: true when this gauge sits on the mainstem itself (same river, larger drainage) rather than only a tributary. Undefined for DOWNSTREAM/unknown, and for UPSTREAM when the mainstem check itself failed - absence is "not confirmed," not "confirmed tributary-only." */
  isMainstem: boolean | undefined;
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

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

// A rising river reaches a levee from upstream, not downstream - an upstream
// gauge is a real early-warning signal in a way a downstream one at the same
// distance isn't, and a mainstem gauge (same river, larger drainage) is a
// stronger version of that signal than one on a minor tributary. Both are
// soft preferences, not a hard partition: sorting by distance as if a
// preferred sensor were this much closer means a nearby lower-tier sensor
// can still rank above a distant higher-tier one, rather than one tier
// always burying another regardless of distance.
// Three explicit tiers, not a truthy check on isMainstem - a plain ternary
// would treat "unknown" (undefined, the mainstem check itself failed) the
// same as "confirmed tributary-only" (false), when unknown should rank
// between mainstem and tributary: it's still confirmed UPSTREAM, just with
// the finer mainstem/tributary detail unresolved, which carries a real
// chance of being mainstem that a confirmed tributary-only result doesn't.
const UPSTREAM_MAINSTEM_SORT_FACTOR = 0.65;
const UPSTREAM_UNKNOWN_TIER_SORT_FACTOR = 0.75;
const UPSTREAM_TRIBUTARY_SORT_FACTOR = 0.85;

function sortFactor(sensor: NearbySensor): number {
  if (sensor.streamRelation !== "UPSTREAM") return 1;
  if (sensor.isMainstem === true) return UPSTREAM_MAINSTEM_SORT_FACTOR;
  if (sensor.isMainstem === false) return UPSTREAM_TRIBUTARY_SORT_FACTOR;
  return UPSTREAM_UNKNOWN_TIER_SORT_FACTOR;
}

function sortByRelevance(sensors: NearbySensor[]): NearbySensor[] {
  return sensors.sort((a, b) => a.distanceMiles * sortFactor(a) - b.distanceMiles * sortFactor(b));
}

/**
 * The zip-to-sensor discovery flow's core query: given a zip code, find
 * every USGS stream gauge within radiusMiles, nearest first. Prefers real
 * upstream/downstream classification via NLDI's river-network navigation
 * (see findSensorsByNavigation) - falling back to a plain radius search
 * only when NLDI can't place the search point on the mapped network at
 * all, or finds nothing connected. The fallback's gauges get no
 * streamRelation rather than a guessed one, and come from the local USGS
 * site cache (see siteCatalog.ts) rather than a live USGS call - upstream/
 * downstream relation is inherently relative to this search's own origin
 * point, so it can't be precomputed and cached the same way plain site
 * locations can.
 */
export async function findSensorsNearZip(
  zip: string,
  radiusMiles = 100,
  signal?: AbortSignal,
): Promise<SensorSearchResult> {
  const center = lookupZipCentroid(zip);
  if (!center) throw new UnknownZipError(zip);

  const navigated = await findSensorsByNavigation(center, radiusMiles, signal);
  if (navigated.length > 0) {
    return { center, radiusMiles, sensors: navigated };
  }

  const sites = await findCachedSitesNearby(center, radiusMiles, signal);

  const sensors: NearbySensor[] = sites
    .map((site) => ({
      ...site,
      distanceMiles: haversineMiles(center, site as LatLon),
      streamRelation: undefined,
      isMainstem: undefined,
    }))
    .filter((site) => site.distanceMiles <= radiusMiles);

  return { center, radiusMiles, sensors: sortByRelevance(sensors) };
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
async function findSensorsByNavigation(
  center: ZipCentroid,
  radiusMiles: number,
  signal?: AbortSignal,
): Promise<NearbySensor[]> {
  let comid: string | undefined;
  try {
    comid = await findNearestComid(center, signal);
  } catch (error) {
    // A real timeout should surface as a timeout, not get swallowed into a
    // silent fallback that immediately fails again on the same dead signal.
    if (isAbortError(error)) throw error;
    console.error("NLDI comid lookup failed:", error);
    return [];
  }
  if (!comid) return [];

  let upstream: NldiSite[];
  let downstream: NldiSite[];
  // A second, narrower query over the same reach purely to tell which of the
  // upstream results also sit on the mainstem - a bonus signal, not a
  // required one, so its own failure resolves to "unknown" (undefined)
  // rather than failing the search, unlike the two required queries below.
  // Run alongside them, not after, so this doesn't add its own extra
  // network round trip to the search.
  let mainstemSiteNos: Set<string> | undefined;
  try {
    [upstream, downstream, mainstemSiteNos] = await Promise.all([
      findNwisSitesByNavigation(comid, "upstream", radiusMiles, signal),
      findNwisSitesByNavigation(comid, "downstream", radiusMiles, signal),
      findNwisSitesByNavigation(comid, "upstreamMainstem", radiusMiles, signal)
        .then((sites) => new Set(sites.map((site) => site.siteNo)))
        .catch((error) => {
          if (isAbortError(error)) throw error;
          console.error("NLDI mainstem navigation failed:", error);
          return undefined;
        }),
    ]);
  } catch (error) {
    if (isAbortError(error)) throw error;
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
      sensors.push({
        ...site,
        distanceMiles: haversineMiles(center, site),
        streamRelation: relation,
        isMainstem: relation === "UPSTREAM" ? mainstemSiteNos?.has(site.siteNo) : undefined,
      });
    }
  }

  return sortByRelevance(sensors);
}
