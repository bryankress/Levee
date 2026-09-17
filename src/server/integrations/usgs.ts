// USGS Water Data APIs (OGC API - Features) - replaces the legacy Water
// Services API (waterservices.usgs.gov/nwis/iv, /nwis/site), which USGS is
// retiring between November 2026 and February 2027. Docs:
// https://api.waterdata.usgs.gov/docs/ogcapi/
//
// NOT verified against a live response. *.usgs.gov is blocked by this
// environment's egress policy (confirmed via the network proxy's own
// connection log: a 403 policy denial for waterservices.usgs.gov,
// api.waterdata.usgs.gov, and labs.waterdata.usgs.gov alike), so every
// endpoint path, param name, and response shape below is reconstructed from
// USGS's own public docs and the dataRetrieval R package's documented usage
// of this same API - not fetched and inspected directly. Test this against
// a real ZIP search after deploying, before trusting it in production.
const OGC_API_BASE_URL = "https://api.waterdata.usgs.gov/ogcapi/v0";

// Sibling federal APIs (e.g. api.weather.gov) document rejecting requests
// with no identifying User-Agent; NWIS doesn't require one as strictly, but
// a generic Node/undici default is exactly the kind of client some
// gov-infrastructure WAFs rate-limit or block, especially from cloud-host IP
// ranges - identifying the app costs nothing and follows the same etiquette.
// Exported for nldi.ts too - same USGS-run infrastructure family.
export const USGS_USER_AGENT = "LeveeBuddy/1.0 (+https://leveebuddy.com)";

export const USGS_PARAM_CODES = {
  DISCHARGE_CFS: "00060",
  GAGE_HEIGHT_FT: "00065",
} as const;

export type UsgsParamCode =
  (typeof USGS_PARAM_CODES)[keyof typeof USGS_PARAM_CODES];

export interface UsgsReading {
  siteNo: string;
  paramCode: UsgsParamCode;
  timestamp: string;
  value: number;
  qualifiers: string[];
}

// The OGC API returns GeoJSON FeatureCollections everywhere - one shape
// covers both monitoring-locations and latest-continuous responses, since
// only the properties actually used differ between them.
interface OgcFeatureCollection {
  features?: Array<{
    properties?: Record<string, unknown>;
    geometry?: { coordinates?: unknown };
  }>;
}

/** "USGS-11447650" (the OGC API's monitoring_location_id format) -> "11447650", matching the plain site numbers used everywhere else in this app. */
function stripAgencyPrefix(locationId: string): string {
  return locationId.replace(/^USGS-/, "");
}

/**
 * Fetches the latest instantaneous readings for one or more USGS site
 * numbers, via the latest-continuous collection - the OGC API's direct
 * replacement for the old /nwis/iv service's "most recent value" behavior.
 * Returns one entry per (site, param) reading actually present in the
 * response - a stale/offline site simply contributes nothing, rather than
 * throwing.
 */
export async function fetchUsgsInstantaneousValues(
  siteNumbers: string[],
  paramCodes: UsgsParamCode[] = [
    USGS_PARAM_CODES.DISCHARGE_CFS,
    USGS_PARAM_CODES.GAGE_HEIGHT_FT,
  ],
  signal?: AbortSignal,
): Promise<UsgsReading[]> {
  if (siteNumbers.length === 0) return [];

  const locationIds = siteNumbers.map((siteNo) => `USGS-${siteNo}`).join(",");
  // Commas kept literal rather than percent-encoded, same defensive choice
  // as the legacy API - unconfirmed whether this modern service is as
  // strict about it, but a literal comma is valid either way.
  const url = `${OGC_API_BASE_URL}/collections/latest-continuous/items?f=json&monitoring_location_id=${locationIds}&parameter_code=${paramCodes.join(",")}`;

  const res = await fetch(url, { headers: { "User-Agent": USGS_USER_AGENT }, signal });
  // Unconfirmed whether this service also uses 404 for "zero matches" the
  // way the legacy NWIS backend did - handled the same way regardless,
  // since an empty result set isn't a real failure under either behavior.
  if (res.status === 404) return [];
  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    throw new Error(
      `USGS latest-continuous request failed: ${res.status} ${res.statusText} for ${url} - ${bodyText.slice(0, 4000)}`,
    );
  }

  const body = (await res.json()) as OgcFeatureCollection;
  return parseLatestContinuous(body);
}

function parseLatestContinuous(body: OgcFeatureCollection): UsgsReading[] {
  const readings: UsgsReading[] = [];

  for (const feature of body.features ?? []) {
    const props = feature.properties ?? {};
    const locationId = props.monitoring_location_id;
    const paramCode = props.parameter_code;
    const time = props.time;
    const value = Number(props.value);
    if (typeof locationId !== "string" || typeof paramCode !== "string" || typeof time !== "string") continue;
    if (!Number.isFinite(value)) continue;

    readings.push({
      siteNo: stripAgencyPrefix(locationId),
      paramCode: paramCode as UsgsParamCode,
      timestamp: time,
      value,
      // The OGC API's equivalent of the legacy service's qualifier codes
      // (e.g. "P" for provisional) isn't confirmed - omitted rather than
      // guessed at a field name. Nothing in this app reads qualifiers today.
      qualifiers: [],
    });
  }

  return readings;
}

export interface UsgsSite {
  siteNo: string;
  name: string;
  lat: number;
  lon: number;
}

export interface UsgsBoundingBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

/**
 * Finds stream sites within a bounding box, via the monitoring-locations
 * collection - the zip-to-sensor discovery flow's actual data source.
 */
export async function fetchUsgsSitesInBoundingBox(
  bbox: UsgsBoundingBox,
  options: { siteType?: string } = {},
  signal?: AbortSignal,
): Promise<UsgsSite[]> {
  // The legacy API's 2-letter site-type codes (e.g. "ST") don't carry over -
  // the OGC API's documented examples use human-readable type names instead.
  const siteType = options.siteType ?? "Stream";
  const coord = (n: number) => n.toFixed(6);
  const bboxParam = `${coord(bbox.west)},${coord(bbox.south)},${coord(bbox.east)},${coord(bbox.north)}`;
  // The legacy siteStatus=active / hasDataTypeCd=iv filters have no confirmed
  // equivalent here and are dropped rather than guessed - a resulting site
  // with no current reading already renders as "No current stage reading
  // available" (see SensorSearchPanel), not a crash or a misleading value.
  const url = `${OGC_API_BASE_URL}/collections/monitoring-locations/items?f=json&bbox=${bboxParam}&site_type=${encodeURIComponent(siteType)}`;

  const res = await fetch(url, { headers: { "User-Agent": USGS_USER_AGENT }, signal });
  if (res.status === 404) return [];
  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    throw new Error(
      `USGS monitoring-locations request failed: ${res.status} ${res.statusText} for ${url} - ${bodyText.slice(0, 4000)}`,
    );
  }

  const body = (await res.json()) as OgcFeatureCollection;
  return parseMonitoringLocations(body);
}

function parseMonitoringLocations(body: OgcFeatureCollection): UsgsSite[] {
  const sites: UsgsSite[] = [];

  for (const feature of body.features ?? []) {
    const props = feature.properties ?? {};
    const locationId = props.monitoring_location_id;
    const name = props.monitoring_location_name;
    const coordinates = feature.geometry?.coordinates;
    if (typeof locationId !== "string" || !Array.isArray(coordinates) || coordinates.length < 2) continue;

    const [lon, lat] = coordinates as [number, number];
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    sites.push({ siteNo: stripAgencyPrefix(locationId), name: typeof name === "string" ? name : "", lat, lon });
  }

  return sites;
}

// The historical_percentile condition type needs USGS's Statistics Service
// (calendar-day percentile distributions). That service's JSON support is
// inconsistent enough in the public docs that a parser here would be a guess
// rather than a verified implementation - deferred until it can be checked
// against a live response instead of assumed.
