import { prisma } from "@/server/db/client";
import type { Prisma } from "@/generated/prisma/client";
import { fetchNwpsGauge } from "@/server/integrations/nwps";
import type { FloodStages } from "@/server/rules";

// A single gauge's live detail fetch shouldn't be allowed to stall a whole
// search - unlike the bulk crosswalk lookup below it, this is a real
// third-party call on the search path now. A slow or hung gauge times out
// on its own; every other candidate's fetch still completes independently
// (see the Promise.allSettled below).
const PER_GAUGE_TIMEOUT_MS = 5_000;

export function hasRealThreshold(stages: unknown): stages is FloodStages {
  if (!stages || typeof stages !== "object") return false;
  return Object.values(stages as Record<string, unknown>).some((value) => typeof value === "number");
}

export interface UsgsSiteRef {
  siteNo: string;
  /**
   * Used only as a fallback when NWPS's bulk gauge list doesn't tag this
   * site with a usgsId at all - a real, confirmed gap in NWPS's own bulk
   * export, not a rare edge case: verified directly against production for
   * two well-known, actively-forecast AHPS gauges (Wabash River at
   * Bluffton / lid BLFI3, Grand River near Pattonsburg / lid PATM7), both
   * present in nwps_gauge_cache with the correct name but a blank usgs_id.
   * Matched via exact normalized-name equality (see normalizeGaugeName)
   * against a small SQL-narrowed candidate set, never a fuzzy substring -
   * a plain "contains" match alone would confuse e.g. "Wabash River at
   * Bluffton" with "Upper Iowa River at Bluffton" (a real, different gauge
   * that also matched "%bluffton%" in production).
   */
  name?: string | null;
}

function normalizeGaugeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/,\s*[a-z]{2}$/i, "") // strip a trailing state abbreviation, e.g. ", MO"
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Only used to narrow the SQL candidate set cheaply before the real,
// authoritative comparison (exact normalized-name equality) runs in JS - a
// broad or even wrong narrowing token can only produce false negatives here
// (missing a real match), never a false positive, since every candidate it
// returns still has to pass that exact comparison.
function narrowingToken(name: string): string | undefined {
  const cleaned = name.replace(/,\s*[a-z]{2}$/i, "").trim();
  const tokens = cleaned.split(/[^a-z0-9]+/i).filter(Boolean);
  const last = tokens[tokens.length - 1];
  return last && last.length >= 3 ? last : undefined;
}

/**
 * Resolves each given USGS site to its NWPS lid, if any - the direct
 * usgsId crosswalk first (cheap, one query for the whole batch), then the
 * name-based fallback above for whatever's left over and has a name to try.
 * The fallback runs one query per unmatched site (its narrowing token
 * differs per name), which is fine since it only ever runs for the sites
 * that already failed the free direct match, not the common case.
 */
export async function findLidsForSites(sites: UsgsSiteRef[]): Promise<Map<string, string>> {
  const bySiteNo = new Map<string, string>();
  if (sites.length === 0) return bySiteNo;

  const direct = await prisma.nwpsGaugeCache.findMany({
    where: { usgsId: { in: sites.map((site) => site.siteNo) } },
    select: { lid: true, usgsId: true },
  });
  for (const entry of direct) {
    if (entry.usgsId) bySiteNo.set(entry.usgsId, entry.lid);
  }

  const unresolved = sites.filter((site) => !bySiteNo.has(site.siteNo) && site.name);
  const fallbackMatches = await Promise.all(
    unresolved.map(async (site) => ({ siteNo: site.siteNo, lid: await findLidByName(site.name as string) })),
  );
  for (const { siteNo, lid } of fallbackMatches) {
    if (lid) bySiteNo.set(siteNo, lid);
  }

  return bySiteNo;
}

async function findLidByName(name: string): Promise<string | undefined> {
  const token = narrowingToken(name);
  if (!token) return undefined;

  const candidates = await prisma.nwpsGaugeCache.findMany({
    where: { name: { contains: token, mode: "insensitive" } },
    select: { lid: true, name: true },
    take: 25,
  });

  const target = normalizeGaugeName(name);
  return candidates.find((candidate) => normalizeGaugeName(candidate.name) === target)?.lid;
}

/**
 * Real NWS flood-stage thresholds (action/minor/moderate/major, in feet) for
 * whichever of the given USGS sites have one - fetched live from NOAA
 * NWPS's per-gauge detail endpoint, not the bulk crosswalk cache alone.
 * NWPS's bulk gauge list (see nwpsGaugeCacheRefresh.ts) turns out not to
 * include flood-category data at all - confirmed empty for all ~12,900
 * gauges in production - only the single-gauge detail endpoint carries it.
 * Fetching that for the whole national list isn't a reasonable background
 * job, so this fetches it lazily instead: only for the handful of sites
 * actually asked about (one search's results, or one signup/claim's
 * sensors) that have any NWPS presence at all (via findLidsForSites above),
 * and opportunistically writes a real result back into the cache so a
 * popular zip's next search doesn't re-fetch the same gauges from NOAA.
 *
 * A gauge whose live fetch fails or times out is simply left out of the
 * result - it just won't show a threshold this one time, not a reason to
 * fail the whole search or claim.
 */
export async function findFloodStagesForSiteNos(
  sites: UsgsSiteRef[],
  signal?: AbortSignal,
): Promise<Map<string, FloodStages>> {
  if (sites.length === 0) return new Map();

  const lidBySiteNo = await findLidsForSites(sites);
  if (lidBySiteNo.size === 0) return new Map();

  const cachedRows = await prisma.nwpsGaugeCache.findMany({
    where: { lid: { in: Array.from(lidBySiteNo.values()) } },
    select: { lid: true, floodStages: true },
  });
  const cachedByLid = new Map(cachedRows.map((row) => [row.lid, row.floodStages]));

  const result = new Map<string, FloodStages>();
  const toFetch: { lid: string; usgsId: string }[] = [];
  for (const [usgsId, lid] of lidBySiteNo) {
    const cached = cachedByLid.get(lid);
    // Already-cached from a previous search's write-through below - no
    // need to hit NOAA again for this one.
    if (hasRealThreshold(cached)) {
      result.set(usgsId, cached);
    } else {
      toFetch.push({ lid, usgsId });
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
  for (const settled of fetched) {
    if (settled.status !== "fulfilled") continue;
    const { lid, usgsId, floodCategories } = settled.value;
    toCache.push({ lid, floodStages: floodCategories as Prisma.InputJsonValue });
    if (hasRealThreshold(floodCategories)) result.set(usgsId, floodCategories);
  }

  if (toCache.length > 0) {
    // Best-effort cache warming, fire-and-forget-safe via allSettled - a
    // write failure here (e.g. the row got deleted by a concurrent refresh)
    // shouldn't affect the result this function already computed.
    await Promise.allSettled(
      toCache.map(({ lid, floodStages }) => prisma.nwpsGaugeCache.update({ where: { lid }, data: { floodStages } })),
    );
  }

  return result;
}
