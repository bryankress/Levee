import { prisma } from "@/server/db/client";
import type { Prisma } from "@/generated/prisma/client";
import { fetchAllNwpsGauges } from "@/server/integrations/nwps";

export interface NwpsGaugeCacheRefreshSummary {
  gaugesCached: number;
  aborted: boolean;
  errors: string[];
}

// A near-total failure (an empty or near-empty response, or the fetch
// itself failing) should never wipe a working cache the way a genuine
// refresh would - the same "keep yesterday's data" rule siteCatalogRefresh
// applies per-tile applies here to the one bulk fetch as a whole.
const MIN_PLAUSIBLE_GAUGE_COUNT = 500;

/**
 * Refetches NOAA NWPS's full gauge list and replaces the local crosswalk
 * cache wholesale - one bulk fetch, not tiled like the USGS site catalog,
 * since NWPS has no documented bounding-box size limit to work around here.
 */
export async function refreshNwpsGaugeCache(): Promise<NwpsGaugeCacheRefreshSummary> {
  const summary: NwpsGaugeCacheRefreshSummary = { gaugesCached: 0, aborted: false, errors: [] };

  let gauges;
  try {
    gauges = await fetchAllNwpsGauges();
  } catch (error) {
    summary.aborted = true;
    summary.errors.push(`NWPS gauges list fetch failed: ${error instanceof Error ? error.message : String(error)}`);
    return summary;
  }

  if (gauges.length < MIN_PLAUSIBLE_GAUGE_COUNT) {
    summary.aborted = true;
    summary.errors.push(
      `Refresh aborted: only ${gauges.length} gauges returned (expected thousands) - keeping the existing cache. Possible causes: the response is paginated and this only fetched page 1, or the endpoint/response shape has changed.`,
    );
    return summary;
  }

  const syncedAt = new Date();
  const rows = gauges.map((gauge) => ({
    lid: gauge.lid,
    usgsId: gauge.usgsId ?? null,
    name: gauge.name,
    lat: gauge.lat ?? null,
    lon: gauge.lon ?? null,
    floodStages: gauge.floodCategories as Prisma.InputJsonValue,
    syncedAt,
  }));

  await prisma.$transaction([
    prisma.nwpsGaugeCache.deleteMany({}),
    prisma.nwpsGaugeCache.createMany({ data: rows }),
  ]);
  summary.gaugesCached = rows.length;

  return summary;
}
