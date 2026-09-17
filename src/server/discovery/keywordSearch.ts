import { prisma } from "@/server/db/client";
import type { SensorDiscoverySource } from "./sensorSearch";

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
 * Finds USGS/CWMS locations by name, for the "+ Sensor" flow's keyword
 * search - a complement to the ZIP-radius map search for someone who
 * already knows a station's name, which might be nowhere near their own
 * levee's ZIP (e.g. a known upstream regional gauge). Reads the same local
 * caches the ZIP search's radius fallback and CWMS lookup already use, so
 * this adds no new external API dependency. CWMS matches come back for
 * visibility only, same as the map search - discovery-only, not addable
 * (no readings integration exists for them yet).
 */
export async function findSensorsByKeyword(query: string): Promise<KeywordSensorMatch[]> {
  const trimmed = query.trim();
  if (trimmed.length < MIN_QUERY_LENGTH) return [];

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
