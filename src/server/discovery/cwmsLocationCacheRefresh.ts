import { prisma } from "@/server/db/client";
import { fetchCwmsOffices, fetchCwmsLocations } from "@/server/integrations/cwms";

export interface CwmsLocationCacheRefreshSummary {
  officesQueried: number;
  officesFailed: number;
  locationsCached: number;
  aborted: boolean;
  errors: string[];
}

// The real district office count is 38 as of writing (confirmed against a
// live fetch) - a number far lower than this means the /offices response
// shape or its "type" field changed, not a real result, and the existing
// cache should be kept rather than replaced with a partial one.
const MIN_PLAUSIBLE_DISTRICT_COUNT = 20;

// Same public-API courtesy as the USGS site catalog's tile pacing - this
// runs roughly monthly from the worker, not on any user-facing path.
const OFFICE_FETCH_DELAY_MS = 300;

// Node's built-in fetch has no default timeout - confirmed live in
// production (Render worker logs): with no per-request bound, one
// unresponsive district's request hung the whole refresh forever, so the
// worker restarted, saw the cache stale, and started over, never once
// reaching "refresh complete" across multiple restarts. Generous (this is
// a monthly background job, not a user-facing path) but still finite, so a
// single bad office fails and the loop moves on instead of hanging.
const PER_REQUEST_TIMEOUT_MS = 20_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Refetches every USACE district's location catalog and replaces the local
 * cache wholesale - not tiled like the USGS site catalog, since CWMS's own
 * organization (per-district, not per-geography) is the natural way to
 * enumerate it. Districts are discovered dynamically from /offices
 * (type === "DIS") each run rather than a hardcoded list, so this
 * self-corrects if USACE reorganizes. A failed office is skipped (logged,
 * not fatal) rather than aborting the whole refresh, matching
 * siteCatalogRefresh's per-tile resilience.
 */
export async function refreshCwmsLocationCache(): Promise<CwmsLocationCacheRefreshSummary> {
  const summary: CwmsLocationCacheRefreshSummary = {
    officesQueried: 0,
    officesFailed: 0,
    locationsCached: 0,
    aborted: false,
    errors: [],
  };

  let offices;
  try {
    offices = await fetchCwmsOffices(AbortSignal.timeout(PER_REQUEST_TIMEOUT_MS));
  } catch (error) {
    summary.aborted = true;
    summary.errors.push(`CWMS offices fetch failed: ${error instanceof Error ? error.message : String(error)}`);
    return summary;
  }

  const districts = offices.filter((office) => office.type === "DIS");
  if (districts.length < MIN_PLAUSIBLE_DISTRICT_COUNT) {
    summary.aborted = true;
    summary.errors.push(
      `Refresh aborted: only ${districts.length} district offices found (expected ~38) - keeping the existing cache. The /offices response shape or its "type" field may have changed.`,
    );
    return summary;
  }

  // Deduped by (office, name) - the same composite key as the cache table's
  // primary key, in case a district's own catalog ever repeats an entry.
  const byKey = new Map<string, Awaited<ReturnType<typeof fetchCwmsLocations>>[number]>();

  for (const district of districts) {
    try {
      const locations = await fetchCwmsLocations(district.name, AbortSignal.timeout(PER_REQUEST_TIMEOUT_MS));
      summary.officesQueried++;
      for (const location of locations) {
        byKey.set(`${location.officeId}:${location.name}`, location);
      }
    } catch (error) {
      summary.officesFailed++;
      summary.errors.push(`office ${district.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
    await sleep(OFFICE_FETCH_DELAY_MS);
  }

  // Never wipe a working cache over a near-total outage - same rule as
  // siteCatalogRefresh's per-tile failure threshold.
  const failureRate = summary.officesFailed / districts.length;
  if (failureRate > 0.5) {
    summary.aborted = true;
    summary.errors.push(
      `Refresh aborted: ${summary.officesFailed}/${districts.length} offices failed - keeping the existing cache.`,
    );
    return summary;
  }

  const syncedAt = new Date();
  const rows = Array.from(byKey.values(), (location) => ({
    officeId: location.officeId,
    name: location.name,
    publicName: location.publicName ?? null,
    description: location.description ?? null,
    lat: location.lat,
    lon: location.lon,
    locationKind: location.locationKind ?? null,
    state: location.state ?? null,
    county: location.county ?? null,
    syncedAt,
  }));

  await prisma.$transaction([
    prisma.cwmsLocationCache.deleteMany({}),
    prisma.cwmsLocationCache.createMany({ data: rows }),
  ]);
  summary.locationsCached = rows.length;

  return summary;
}
