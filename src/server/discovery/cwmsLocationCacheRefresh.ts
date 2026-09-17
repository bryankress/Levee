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
 * cache one district at a time - not one giant wholesale replace like an
 * earlier version of this function did. That version accumulated every
 * district's full location list in memory before a single final
 * delete-everything-then-insert-everything transaction; confirmed live via
 * a Render "exceeded its memory limit" alert that this pushed the worker
 * (a 512MB starter instance) into a restart loop - CWMS's own per-project
 * instrumentation hierarchy means some districts' catalogs run far larger
 * than a flat gauge list (NWDM alone showed many depth-specific channels
 * per structure during discovery), so 38 districts' worth held at once has
 * real potential to be much bigger than the comparable single-request NWPS
 * gauge refresh (~13k gauges, already proven fine in production).
 *
 * Districts are discovered dynamically from /offices (type === "DIS") each
 * run rather than a hardcoded list, so this self-corrects if USACE
 * reorganizes. Refreshing per-district (delete+insert scoped to that one
 * officeId) also means a district that fails to fetch simply keeps
 * whatever it already had cached, rather than the entire national catalog
 * depending on every district being reachable in the same run - a strictly
 * more resilient contract than the old all-or-nothing replace.
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
      `Refresh aborted: only ${districts.length} district offices found (expected ~38) - no office was touched. The /offices response shape or its "type" field may have changed.`,
    );
    return summary;
  }

  for (const district of districts) {
    let locations;
    try {
      locations = await fetchCwmsLocations(district.name, AbortSignal.timeout(PER_REQUEST_TIMEOUT_MS));
      summary.officesQueried++;
    } catch (error) {
      summary.officesFailed++;
      summary.errors.push(`office ${district.name}: ${error instanceof Error ? error.message : String(error)}`);
      await sleep(OFFICE_FETCH_DELAY_MS);
      continue;
    }

    // An empty result is more likely a bad/partial response than a district
    // that genuinely dropped to zero real locations - every district
    // sampled live during discovery had at least some - so this office's
    // previously cached rows are left alone rather than wiped to nothing.
    if (locations.length === 0) {
      await sleep(OFFICE_FETCH_DELAY_MS);
      continue;
    }

    // Deduped by (office, name) - the cache table's own primary key - in
    // case a district's own catalog ever repeats an entry.
    const byName = new Map(locations.map((location) => [location.name, location]));
    const syncedAt = new Date();
    const rows = Array.from(byName.values(), (location) => ({
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
      prisma.cwmsLocationCache.deleteMany({ where: { officeId: district.name } }),
      prisma.cwmsLocationCache.createMany({ data: rows }),
    ]);
    summary.locationsCached += rows.length;
    console.log(`[cwms cache] ${district.name}: ${rows.length} locations`);

    await sleep(OFFICE_FETCH_DELAY_MS);
  }

  const failureRate = summary.officesFailed / districts.length;
  if (failureRate > 0.5) {
    summary.errors.push(
      `${summary.officesFailed}/${districts.length} offices failed this run - their previously cached locations were left untouched.`,
    );
  }

  return summary;
}
