import { prisma } from "@/server/db/client";

/**
 * Which of the given USGS site numbers have a real, official NWS
 * flood-stage threshold defined, via the local NWPS crosswalk cache (see
 * nwpsGaugeCacheRefresh.ts) - a fast local lookup, never a live network
 * call. Returns an empty set, not a guess, when the crosswalk hasn't been
 * populated yet (e.g. right after a fresh deploy, before the worker's
 * first refresh has run) - the caller degrades to "no flood-stage
 * preference" rather than misbehaving.
 */
export async function findSiteNosWithFloodStage(siteNos: string[]): Promise<Set<string>> {
  if (siteNos.length === 0) return new Set();

  const matches = await prisma.nwpsGaugeCache.findMany({
    where: { usgsId: { in: siteNos } },
    select: { usgsId: true, floodStages: true },
  });

  const withFloodStage = new Set<string>();
  for (const match of matches) {
    if (!match.usgsId) continue;
    const stages = match.floodStages as Record<string, unknown> | null;
    // {} (no categories NWPS actually defined for this gauge) shouldn't
    // count as "has a flood stage" just because the column itself isn't
    // null - only a real numeric threshold does.
    const hasRealThreshold = stages !== null && Object.values(stages).some((value) => typeof value === "number");
    if (hasRealThreshold) withFloodStage.add(match.usgsId);
  }
  return withFloodStage;
}
