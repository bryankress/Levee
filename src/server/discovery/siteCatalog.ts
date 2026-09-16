import { prisma } from "@/server/db/client";
import { fetchUsgsSitesInBoundingBox, type UsgsSite } from "@/server/integrations/usgs";
import { boundingBoxForRadius, type LatLon } from "./geo";

/**
 * The zip-to-sensor search's radius fallback: sites within radiusMiles of
 * center, read from the local USGS site cache instead of a live call to
 * USGS's site-search service (see siteCatalogRefresh.ts for how that cache
 * gets populated). Falls back to a live query only when the cache has never
 * been populated at all - e.g. a fresh deploy before the worker's first
 * refresh has run - so a cold start degrades to today's live behavior
 * rather than silently returning zero results everywhere.
 */
export async function findCachedSitesNearby(
  center: LatLon,
  radiusMiles: number,
  signal?: AbortSignal,
): Promise<UsgsSite[]> {
  const bbox = boundingBoxForRadius(center, radiusMiles);

  const cached = await prisma.usgsSiteCache.findMany({
    where: {
      lat: { gte: bbox.south, lte: bbox.north },
      lon: { gte: bbox.west, lte: bbox.east },
    },
    select: { siteNo: true, name: true, lat: true, lon: true },
  });
  if (cached.length > 0) return cached;

  const catalogPopulated = (await prisma.usgsSiteCache.count()) > 0;
  if (catalogPopulated) return []; // a real "nothing nearby," not a cold cache

  return fetchUsgsSitesInBoundingBox(bbox, {}, signal);
}
