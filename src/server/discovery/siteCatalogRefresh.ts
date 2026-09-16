import { prisma } from "@/server/db/client";
import { fetchUsgsSitesInBoundingBox, type UsgsSite } from "@/server/integrations/usgs";
import type { BoundingBox } from "./geo";

// Continental US only for v1 - Alaska, Hawaii, and the territories aren't
// covered. Extend this if the product ever needs gauges outside the Lower 48.
const CONUS_BBOX: BoundingBox = { west: -125, south: 24, east: -66, north: 50 };
// Comfortably under NWIS's documented bBox size limits; works out to about
// 40 tiles for CONUS_BBOX, each a separate request.
const TILE_DEGREES = 8;
// This runs roughly monthly from the worker, not on any user-facing path -
// pacing it costs nothing and is basic courtesy toward a public, unauthenticated
// government API.
const TILE_FETCH_DELAY_MS = 300;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function tileBoundingBox(box: BoundingBox, stepDegrees: number): BoundingBox[] {
  const tiles: BoundingBox[] = [];
  for (let west = box.west; west < box.east; west += stepDegrees) {
    for (let south = box.south; south < box.north; south += stepDegrees) {
      tiles.push({
        west,
        south,
        east: Math.min(west + stepDegrees, box.east),
        north: Math.min(south + stepDegrees, box.north),
      });
    }
  }
  return tiles;
}

export interface SiteCatalogRefreshSummary {
  tilesFetched: number;
  tilesFailed: number;
  sitesCached: number;
  /** True when a near-total tile-fetch failure (e.g. a USGS outage) meant the existing cache was kept rather than replaced - the caller should treat this like a failure for retry-scheduling purposes, not a completed refresh. */
  aborted: boolean;
  errors: string[];
}

/**
 * Refetches USGS's active-streamgauge catalog for the continental US, tile
 * by tile, and replaces the local cache wholesale - not an incremental diff,
 * since the whole catalog is only on the order of ten thousand rows, cheap
 * enough that a full replace is simpler and about as fast either way. A
 * failed tile is skipped (logged, not fatal) rather than aborting the whole
 * refresh; the next scheduled run will pick it back up.
 */
export async function refreshUsgsSiteCatalog(): Promise<SiteCatalogRefreshSummary> {
  const tiles = tileBoundingBox(CONUS_BBOX, TILE_DEGREES);
  const summary: SiteCatalogRefreshSummary = { tilesFetched: 0, tilesFailed: 0, sitesCached: 0, aborted: false, errors: [] };

  // Deduped by site number - adjacent tiles can both return a site that sits
  // right on their shared border.
  const bySiteNo = new Map<string, UsgsSite>();

  for (const tile of tiles) {
    try {
      const sites = await fetchUsgsSitesInBoundingBox(tile);
      summary.tilesFetched++;
      for (const site of sites) bySiteNo.set(site.siteNo, site);
    } catch (error) {
      summary.tilesFailed++;
      summary.errors.push(
        `tile [${tile.west},${tile.south},${tile.east},${tile.north}]: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    await sleep(TILE_FETCH_DELAY_MS);
  }

  // Never wipe a working cache over a near-total outage - if almost every
  // tile failed, keep serving yesterday's catalog rather than replacing it
  // with whatever scraps came back.
  const failureRate = summary.tilesFailed / tiles.length;
  if (failureRate > 0.5) {
    summary.aborted = true;
    summary.errors.push(`Refresh aborted: ${summary.tilesFailed}/${tiles.length} tiles failed - keeping the existing cache.`);
    return summary;
  }

  const syncedAt = new Date();
  const rows = Array.from(bySiteNo.values(), (site) => ({ ...site, syncedAt }));

  await prisma.$transaction([
    prisma.usgsSiteCache.deleteMany({}),
    prisma.usgsSiteCache.createMany({ data: rows }),
  ]);
  summary.sitesCached = rows.length;

  return summary;
}
