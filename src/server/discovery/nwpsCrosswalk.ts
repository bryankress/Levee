import { prisma } from "@/server/db/client";
import type { Prisma } from "@/generated/prisma/client";
import { fetchNwpsGauge } from "@/server/integrations/nwps";

// A single gauge's live detail fetch shouldn't be allowed to stall a whole
// search - unlike the bulk crosswalk lookup below it, this is a real
// third-party call on the search path now. A slow or hung gauge times out
// on its own; every other candidate's fetch still completes independently
// (see the Promise.allSettled below).
const PER_GAUGE_TIMEOUT_MS = 5_000;

function hasRealThreshold(stages: unknown): boolean {
  if (!stages || typeof stages !== "object") return false;
  return Object.values(stages as Record<string, unknown>).some((value) => typeof value === "number");
}

/**
 * Which of the given USGS site numbers have a real, official NWS
 * flood-stage threshold - fetched live from NOAA NWPS's per-gauge detail
 * endpoint, not the bulk crosswalk cache alone. NWPS's bulk gauge list (see
 * nwpsGaugeCacheRefresh.ts) turns out not to include flood-category data at
 * all - confirmed empty for all ~12,900 gauges in production - only the
 * single-gauge detail endpoint carries it. Fetching that for the whole
 * national list isn't a reasonable background job, so this fetches it
 * lazily instead: only for the handful of sites in one search's result
 * that have any NWPS presence at all (via the cached lid crosswalk), and
 * opportunistically writes a real result back into the cache so a popular
 * zip's next search doesn't re-fetch the same gauges from NOAA.
 *
 * A gauge whose live fetch fails or times out is simply left out of the
 * result - it just won't show the flood-stage tag this one time, not a
 * reason to fail the whole search.
 */
export async function findSiteNosWithFloodStage(siteNos: string[], signal?: AbortSignal): Promise<Set<string>> {
  if (siteNos.length === 0) return new Set();

  const matches = await prisma.nwpsGaugeCache.findMany({
    where: { usgsId: { in: siteNos } },
    select: { lid: true, usgsId: true, floodStages: true },
  });

  const withFloodStage = new Set<string>();
  const toFetch: { lid: string; usgsId: string }[] = [];
  for (const match of matches) {
    if (!match.usgsId) continue;
    // Already-cached from a previous search's write-through below - no
    // need to hit NOAA again for this one.
    if (hasRealThreshold(match.floodStages)) {
      withFloodStage.add(match.usgsId);
    } else {
      toFetch.push({ lid: match.lid, usgsId: match.usgsId });
    }
  }

  const fetched = await Promise.allSettled(
    toFetch.map(async ({ lid, usgsId }) => {
      const timeoutSignal = AbortSignal.timeout(PER_GAUGE_TIMEOUT_MS);
      const gaugeSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
      const gauge = await fetchNwpsGauge(lid, gaugeSignal);
      return { lid, usgsId, floodCategories: gauge.floodCategories };
    }),
  );

  const toCache: { lid: string; floodStages: Prisma.InputJsonValue }[] = [];
  for (const result of fetched) {
    if (result.status !== "fulfilled") continue;
    const { lid, usgsId, floodCategories } = result.value;
    toCache.push({ lid, floodStages: floodCategories as Prisma.InputJsonValue });
    if (hasRealThreshold(floodCategories)) withFloodStage.add(usgsId);
  }

  if (toCache.length > 0) {
    // Best-effort cache warming, fire-and-forget-safe via allSettled - a
    // write failure here (e.g. the row got deleted by a concurrent refresh)
    // shouldn't affect the search result this function already computed.
    await Promise.allSettled(
      toCache.map(({ lid, floodStages }) => prisma.nwpsGaugeCache.update({ where: { lid }, data: { floodStages } })),
    );
  }

  return withFloodStage;
}
