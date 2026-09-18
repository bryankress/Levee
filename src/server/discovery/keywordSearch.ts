import { prisma } from "@/server/db/client";
import { findSensorsNearZip, UnknownZipError, type SensorDiscoverySource } from "./sensorSearch";
import { isPlausibleUsgsSiteNo, fetchUsgsSiteByNo } from "@/server/integrations/usgs";
import { MIN_SEARCH_RADIUS_MILES } from "@/lib/searchConfig";

export interface KeywordSensorMatch {
  siteNo: string;
  name: string;
  lat: number;
  lon: number;
  source: SensorDiscoverySource;
  officeId: string | undefined;
  locationKind: string | undefined;
}

const MIN_QUERY_LENGTH = 2;
const MAX_RESULTS_PER_SOURCE = 8;
// Fetched, then re-ranked in JS so a "starts with" match outranks a
// "contains" match found earlier alphabetically - a plain `contains` query
// alone would list them in whatever order the database happens to return.
const FETCH_MULTIPLIER = 4;

const ZIP_PATTERN = /^\d{5}$/;
// A dropdown, not the full map search - capped well below findSensorsNearZip's
// own MAX_RESULTS (100, see marketing/actions.ts), same order of magnitude as
// the two name-search sources combined below.
const MAX_ZIP_RESULTS = 16;

function rankByPrefix<T>(items: T[], query: string, nameOf: (item: T) => string): T[] {
  const lowerQuery = query.toLowerCase();
  return [...items].sort((a, b) => {
    const aStarts = nameOf(a).toLowerCase().startsWith(lowerQuery) ? 0 : 1;
    const bStarts = nameOf(b).toLowerCase().startsWith(lowerQuery) ? 0 : 1;
    if (aStarts !== bStarts) return aStarts - bStarts;
    return nameOf(a).localeCompare(nameOf(b));
  });
}

/**
 * Finds USGS/CWMS locations by name, ZIP code, or an exact USGS site
 * number, for the "Graphical Search" flow's keyword field - a lighter-weight
 * complement to the full map-based radius search for someone who already
 * knows what they're looking for (a station name, a known site number from
 * elsewhere, or just a ZIP), independent of the district's own levee
 * location. A 5-digit input is treated as a ZIP (real USGS site numbers are
 * 8-15 digits - see isPlausibleUsgsSiteNo - so the two patterns never
 * collide); an 8-15 digit input is treated as an exact site number; anything
 * else falls back to the original name search. CWMS matches come back for
 * visibility only, same as the map search - discovery-only, not addable (no
 * readings integration exists for them yet).
 */
export async function findSensorsByKeyword(query: string): Promise<KeywordSensorMatch[]> {
  const trimmed = query.trim();
  if (trimmed.length < MIN_QUERY_LENGTH) return [];

  if (ZIP_PATTERN.test(trimmed)) return findByZip(trimmed);
  if (isPlausibleUsgsSiteNo(trimmed)) return findByExactSiteNo(trimmed);

  const [usgsSites, cwmsLocations] = await Promise.all([
    prisma.usgsSiteCache.findMany({
      where: { name: { contains: trimmed, mode: "insensitive" } },
      select: { siteNo: true, name: true, lat: true, lon: true },
      take: MAX_RESULTS_PER_SOURCE * FETCH_MULTIPLIER,
    }),
    prisma.cwmsLocationCache.findMany({
      where: {
        OR: [
          { name: { contains: trimmed, mode: "insensitive" } },
          { publicName: { contains: trimmed, mode: "insensitive" } },
        ],
      },
      select: { officeId: true, name: true, publicName: true, locationKind: true, lat: true, lon: true },
      take: MAX_RESULTS_PER_SOURCE * FETCH_MULTIPLIER,
    }),
  ]);

  const usgsMatches: KeywordSensorMatch[] = rankByPrefix(usgsSites, trimmed, (site) => site.name)
    .slice(0, MAX_RESULTS_PER_SOURCE)
    .map((site) => ({
      siteNo: site.siteNo,
      name: site.name,
      lat: site.lat,
      lon: site.lon,
      source: "USGS",
      officeId: undefined,
      locationKind: undefined,
    }));

  const cwmsMatches: KeywordSensorMatch[] = rankByPrefix(cwmsLocations, trimmed, (loc) => loc.publicName ?? loc.name)
    .slice(0, MAX_RESULTS_PER_SOURCE)
    .map((location) => ({
      siteNo: `cwms:${location.officeId}:${location.name}`,
      name: location.publicName ?? location.name,
      lat: location.lat,
      lon: location.lon,
      source: "CWMS",
      officeId: location.officeId,
      locationKind: location.locationKind ?? undefined,
    }));

  return [...usgsMatches, ...cwmsMatches];
}

/**
 * A ZIP typed directly into the keyword field - runs the same
 * radius/relevance search the graphical search uses (findSensorsNearZip),
 * just surfaced in this smaller dropdown instead of the full map panel. An
 * unrecognized ZIP degrades to "no matches" rather than an error, same as a
 * name search that finds nothing.
 */
async function findByZip(zip: string): Promise<KeywordSensorMatch[]> {
  try {
    const result = await findSensorsNearZip(zip, MIN_SEARCH_RADIUS_MILES);
    return result.sensors.slice(0, MAX_ZIP_RESULTS).map((sensor) => ({
      siteNo: sensor.siteNo,
      name: sensor.name,
      lat: sensor.lat,
      lon: sensor.lon,
      source: sensor.source,
      officeId: sensor.officeId,
      locationKind: sensor.locationKind,
    }));
  } catch (error) {
    if (error instanceof UnknownZipError) return [];
    throw error;
  }
}

/**
 * An exact USGS site number typed directly - checks the local catalog cache
 * first (siteCatalog.ts's monthly-refreshed national list should already
 * cover any real gauge), falling back to a live single-site lookup only when
 * that cache doesn't have it yet (e.g. a very new gauge). A number that
 * turns out not to be a real USGS site either way just comes back empty,
 * same as any other search with no matches.
 */
async function findByExactSiteNo(siteNo: string): Promise<KeywordSensorMatch[]> {
  const cached = await prisma.usgsSiteCache.findUnique({ where: { siteNo } });
  const site = cached ?? (await fetchUsgsSiteByNo(siteNo).catch(() => undefined));
  if (!site) return [];

  return [{ siteNo: site.siteNo, name: site.name, lat: site.lat, lon: site.lon, source: "USGS", officeId: undefined, locationKind: undefined }];
}
