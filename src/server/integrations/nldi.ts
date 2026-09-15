import { USGS_USER_AGENT } from "./usgs";

// USGS Network-Linked Data Index (NLDI) - snaps a point to the National
// Hydrography Dataset's flowline network and can navigate that network's
// real topology upstream/downstream to find connected features, like USGS
// gauges. This is what actually answers "is this gauge upstream or
// downstream of here" - straight-line distance alone can't, since a nearby
// gauge might sit on a completely different river or watershed.
// Docs: https://api.water.usgs.gov/nldi/swagger-ui/index.html
const NLDI_BASE_URL = "https://labs.waterdata.usgs.gov/api/nldi/linked-data";

const MILES_TO_KM = 1.60934;

export interface NldiSite {
  siteNo: string;
  name: string;
  lat: number;
  lon: number;
}

export type NavigationDirection = "upstream" | "downstream";

// Upstream uses "UT" (upstream with tributaries), not just the mainstem -
// for flood monitoring, a tributary's gauge feeding into the river above a
// levee is exactly the kind of early-warning signal that matters. Downstream
// only offers "DM" (downstream mainstem): water only flows one way down the
// trunk, so there's no equivalent "downstream tributaries" to navigate.
const NAVIGATION_MODE: Record<NavigationDirection, string> = {
  upstream: "UT",
  downstream: "DM",
};

interface NldiFeatureCollection {
  features?: Array<{
    properties?: Record<string, unknown>;
    geometry?: { coordinates?: unknown };
  }>;
}

/**
 * Snaps a lat/lon to the nearest NHDPlus flowline and returns its COMID -
 * the reach identifier every navigation query below is anchored to.
 * Undefined when nothing in the network is close enough to snap to (e.g. a
 * ZIP centroid far from any mapped stream) - callers fall back to a plain
 * radius search in that case rather than fabricating a relation.
 */
export async function findNearestComid(point: { lat: number; lon: number }): Promise<string | undefined> {
  const coords = `POINT(${point.lon} ${point.lat})`;
  const url = `${NLDI_BASE_URL}/comid/position?f=json&coords=${encodeURIComponent(coords)}`;

  const res = await fetch(url, { headers: { "User-Agent": USGS_USER_AGENT } });
  if (res.status === 404) return undefined;
  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    throw new Error(
      `NLDI comid lookup failed: ${res.status} ${res.statusText} for ${url} - ${bodyText.slice(0, 4000)}`,
    );
  }

  const body = (await res.json()) as NldiFeatureCollection;
  const comid = body.features?.[0]?.properties?.comid;
  if (typeof comid === "string") return comid;
  if (typeof comid === "number") return String(comid);
  return undefined;
}

/**
 * Finds real USGS stream gauges connected to the given COMID's flowline,
 * navigating strictly upstream or downstream along the actual river network
 * within distanceMiles - not just nearby as the crow flies.
 */
export async function findNwisSitesByNavigation(
  comid: string,
  direction: NavigationDirection,
  distanceMiles: number,
): Promise<NldiSite[]> {
  const distanceKm = (distanceMiles * MILES_TO_KM).toFixed(1);
  const mode = NAVIGATION_MODE[direction];
  const url = `${NLDI_BASE_URL}/comid/${comid}/navigation/${mode}/nwissite?f=json&distance=${distanceKm}`;

  const res = await fetch(url, { headers: { "User-Agent": USGS_USER_AGENT } });
  if (res.status === 404) return [];
  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    throw new Error(
      `NLDI ${direction} navigation failed: ${res.status} ${res.statusText} for ${url} - ${bodyText.slice(0, 4000)}`,
    );
  }

  const body = (await res.json()) as NldiFeatureCollection;
  return parseNwisSites(body);
}

function parseNwisSites(body: NldiFeatureCollection): NldiSite[] {
  const sites: NldiSite[] = [];

  for (const feature of body.features ?? []) {
    const identifier = feature.properties?.identifier;
    // NWIS sites come back as "USGS-05464000" - strip the source prefix to
    // match the plain site numbers used everywhere else in this app.
    const siteNo = typeof identifier === "string" ? identifier.replace(/^USGS-/, "") : undefined;
    const coordinates = feature.geometry?.coordinates;
    if (!siteNo || !Array.isArray(coordinates) || coordinates.length < 2) continue;

    const [lon, lat] = coordinates as [number, number];
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    sites.push({ siteNo, name: String(feature.properties?.name ?? ""), lat, lon });
  }

  return sites;
}
