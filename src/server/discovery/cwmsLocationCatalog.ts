import { prisma } from "@/server/db/client";
import { boundingBoxForRadius, type LatLon } from "./geo";

export interface CachedCwmsLocation {
  officeId: string;
  name: string;
  publicName: string | null;
  locationKind: string | null;
  lat: number;
  lon: number;
}

/**
 * CWMS locations within radiusMiles of center, read from the local cache
 * (see cwmsLocationCacheRefresh.ts) - unlike findCachedSitesNearby, there's
 * no live fallback here: CWMS has no per-search "sites in bounding box"
 * endpoint of its own, only the whole-district catalog the worker already
 * refreshes monthly. A cold cache (fresh deploy, before the worker's first
 * refresh) just means no CWMS results yet, not a broken search - USGS
 * results are unaffected either way.
 */
export async function findCachedCwmsLocationsNearby(
  center: LatLon,
  radiusMiles: number,
): Promise<CachedCwmsLocation[]> {
  const bbox = boundingBoxForRadius(center, radiusMiles);

  return prisma.cwmsLocationCache.findMany({
    where: {
      lat: { gte: bbox.south, lte: bbox.north },
      lon: { gte: bbox.west, lte: bbox.east },
    },
    select: { officeId: true, name: true, publicName: true, locationKind: true, lat: true, lon: true },
  });
}
