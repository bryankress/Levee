import { findNearestComid, findNwisSitesByNavigation, type NldiSite } from "@/server/integrations/nldi";
import { findCachedSitesNearby } from "./siteCatalog";
import { findCachedCwmsLocationsNearby } from "./cwmsLocationCatalog";
import { findFloodStagesForSiteNos } from "./nwpsCrosswalk";
import { haversineMiles, type LatLon } from "./geo";
import { lookupZipCentroid, type ZipCentroid } from "./zipLookup";

export type SensorStreamRelation = "UPSTREAM" | "DOWNSTREAM";

/** USGS is a live monitoring source with real readings; CWMS is discovery-only for now (see findCwmsSensorsNearby) - no readings integration exists yet, so a CWMS entry is always shown without a current stage. */
export type SensorDiscoverySource = "USGS" | "CWMS";

export interface NearbySensor {
  siteNo: string;
  name: string;
  lat: number;
  lon: number;
  distanceMiles: number;
  source: SensorDiscoverySource;
  /** CWMS only: the USACE district office that owns this location (e.g. "MVR"), for honest attribution since CWMS has no single national catalog like USGS/NWPS. */
  officeId: string | undefined;
  /** CWMS only: the raw location-kind CWMS itself reports (e.g. "PROJECT", "EMBANKMENT") - shown as-is rather than translated into a guessed meaning. */
  locationKind: string | undefined;
  /** Set only when NLDI could place this gauge on the same river network as the search point - never guessed. USGS only; CWMS has no NLDI navigation done for it. */
  streamRelation: SensorStreamRelation | undefined;
  /** UPSTREAM only: true when this gauge sits on the mainstem itself (same river, larger drainage) rather than only a tributary. Undefined for DOWNSTREAM/unknown, and for UPSTREAM when the mainstem check itself failed - absence is "not confirmed," not "confirmed tributary-only." */
  isMainstem: boolean | undefined;
  /** True when NOAA NWPS has a real, official flood-stage threshold defined for this gauge (any of action/minor/moderate/major, via the local crosswalk cache) - a gauge someone is actually watching operationally, not just a data point. USGS only; CWMS is never looked up here (no shared identifier exists to crosswalk against). */
  hasFloodStage: boolean;
  /** The "action" stage specifically, in feet - undefined whenever hasFloodStage is false, and also whenever a real threshold exists for minor/moderate/major but not action itself. This is the one used for a real "% of flood stage" calculation, matching how the portal's own severity display already computes it. */
  floodStageActionFt: number | undefined;
}

/** What the two discovery paths build before flood-stage enrichment (a local DB lookup) and final sorting happen, both centralized in enrichAndSort. */
type RawSensor = Omit<NearbySensor, "hasFloodStage" | "floodStageActionFt">;

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

function relationSortFactor(sensor: NearbySensor): number {
  if (sensor.streamRelation !== "UPSTREAM") return 1;
  if (sensor.isMainstem === true) return UPSTREAM_MAINSTEM_SORT_FACTOR;
  if (sensor.isMainstem === false) return UPSTREAM_TRIBUTARY_SORT_FACTOR;
  return UPSTREAM_UNKNOWN_TIER_SORT_FACTOR;
}

// A gauge with a real official flood-stage threshold is one someone at NWS
// is actually watching operationally - a smaller, independent boost from
// the relation-based one above (it applies regardless of upstream/
// downstream: a downstream gauge with a defined action stage still matters
// for backwater/tidal awareness), so the two multiply together rather than
// one overriding the other.
const FLOOD_STAGE_SORT_FACTOR = 0.9;

function sortFactor(sensor: NearbySensor): number {
  return relationSortFactor(sensor) * (sensor.hasFloodStage ? FLOOD_STAGE_SORT_FACTOR : 1);
}

/**
 * The one place flood-stage enrichment (a local DB lookup keyed on the
 * search's own result set, not run per-candidate) and final sorting happen,
 * for both discovery paths - a gauge's flood-stage status only affects
 * ranking once we know the full candidate list, so this runs after either
 * path has already assembled its raw sensors.
 */
async function enrichAndSort(sensors: RawSensor[], signal?: AbortSignal): Promise<NearbySensor[]> {
  // CWMS has no usgsId-style crosswalk to NWPS - only USGS site numbers are
  // ever worth looking up here, so this stays both correct and cheaper as
  // CWMS results grow.
  const usgsSites = sensors
    .filter((sensor) => sensor.source === "USGS")
    .map((sensor) => ({ siteNo: sensor.siteNo, name: sensor.name }));
  const floodStagesBySiteNo = await findFloodStagesForSiteNos(usgsSites, signal);
  const enriched = sensors.map((sensor) => {
    const floodStages = floodStagesBySiteNo.get(sensor.siteNo);
    return {
      ...sensor,
      hasFloodStage: floodStages !== undefined,
      floodStageActionFt: floodStages?.action,
    };
  });
  // A preliminary order only - real readings (stage, discharge) aren't
  // fetched yet at this point (see actions.ts), so this can't rank by
  // actual severity or river size. It exists to pick a sane subset when a
  // wide-radius search finds far more candidates than the results cap -
  // the real, severity-aware ranking happens once readings are in hand.
  return enriched.sort((a, b) => a.distanceMiles * sortFactor(a) - b.distanceMiles * sortFactor(b));
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

  // USGS and CWMS are entirely independent lookups (different APIs, no
  // shared identifier) - run them in parallel rather than one after the
  // other. A CWMS lookup failure degrades to "no CWMS results" rather than
  // failing the whole search, matching how a live-USGS failure inside
  // findSensorsByNavigation already degrades to the radius-cache fallback.
  const [usgsSensors, cwmsSensors] = await Promise.all([
    findUsgsSensorsNearZip(center, radiusMiles, signal),
    findCwmsSensorsNearby(center, radiusMiles).catch((error) => {
      console.error("CWMS location lookup failed:", error);
      return [];
    }),
  ]);

  const sensors = await enrichAndSort([...usgsSensors, ...cwmsSensors], signal);
  return { center, radiusMiles, sensors };
}

async function findUsgsSensorsNearZip(
  center: ZipCentroid,
  radiusMiles: number,
  signal?: AbortSignal,
): Promise<RawSensor[]> {
  const navigated = await findSensorsByNavigation(center, radiusMiles, signal);
  if (navigated.length > 0) return navigated;

  const sites = await findCachedSitesNearby(center, radiusMiles, signal);

  return sites
    .map((site) => ({
      ...site,
      distanceMiles: haversineMiles(center, site as LatLon),
      source: "USGS" as const,
      officeId: undefined,
      locationKind: undefined,
      streamRelation: undefined,
      isMainstem: undefined,
    }))
    .filter((site) => site.distanceMiles <= radiusMiles);
}

/**
 * USACE CWMS locations near the search point - discovery-only for now (see
 * SensorDiscoverySource): no readings integration exists yet, so these
 * always come back with no stream-relation/mainstem classification (no NLDI
 * navigation is done for them) and are never crosswalked for flood-stage
 * (CWMS shares no identifier with NWPS/USGS to crosswalk against).
 */
async function findCwmsSensorsNearby(center: ZipCentroid, radiusMiles: number): Promise<RawSensor[]> {
  const locations = await findCachedCwmsLocationsNearby(center, radiusMiles);

  return locations
    .map((location) => ({
      siteNo: `cwms:${location.officeId}:${location.name}`,
      name: location.publicName ?? location.name,
      lat: location.lat,
      lon: location.lon,
      distanceMiles: haversineMiles(center, location),
      source: "CWMS" as const,
      officeId: location.officeId,
      locationKind: location.locationKind ?? undefined,
      streamRelation: undefined,
      isMainstem: undefined,
    }))
    .filter((location) => location.distanceMiles <= radiusMiles);
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
): Promise<RawSensor[]> {
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
  const sensors: RawSensor[] = [];
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
        source: "USGS",
        officeId: undefined,
        locationKind: undefined,
        streamRelation: relation,
        isMainstem: relation === "UPSTREAM" ? mainstemSiteNos?.has(site.siteNo) : undefined,
      });
    }
  }

  return sensors;
}
