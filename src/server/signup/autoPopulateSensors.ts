import type { OrgPlan } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";
import { findRankedSensorsNearZip, UnknownZipError } from "@/server/discovery/rankedSensorSearch";
import { MIN_SEARCH_RADIUS_MILES } from "@/lib/searchConfig";
import { AUTO_SELECT_COUNT_BY_PLAN } from "@/lib/plans";

export interface AutoPopulatedSensor {
  siteNo: string;
  name: string;
  lat: number;
  lon: number;
  streamRelation?: "UPSTREAM" | "DOWNSTREAM";
}

/**
 * The "if account created, run the background sensor search and populate
 * sensors page" flow: given the ZIP a new district entered at signup and
 * the plan they chose, silently picks their best starting sensors - no
 * interactive search step, no picking through results, they just see a
 * populated Sensors page after signing up.
 *
 * Always best-effort: an unrecognized ZIP, a third-party search failure, or
 * a ZIP with fewer eligible gauges than the plan's count all resolve to
 * "fewer (or zero) auto-picked sensors," never a failed signup - a district
 * can always add sensors themselves afterward regardless of what this finds.
 *
 * Filters out USGS sites already claimed by another org's Sensor row before
 * picking the top N, rather than proposing a candidate that would only fail
 * signup's own claim check - since site selection is now fully automatic,
 * nobody would be able to explain or work around a claim conflict here the
 * way an interactive search-and-pick flow's user could.
 */
export async function autoPopulateSensorsForZip(zip: string, plan: OrgPlan): Promise<AutoPopulatedSensor[]> {
  const count = AUTO_SELECT_COUNT_BY_PLAN[plan];
  if (count <= 0) return [];

  let candidates;
  try {
    const result = await findRankedSensorsNearZip(zip, MIN_SEARCH_RADIUS_MILES);
    candidates = result.sensors;
  } catch (error) {
    if (error instanceof UnknownZipError) return [];
    console.error("Background sensor auto-populate search failed:", error);
    return [];
  }

  // Already ranked by sortBySeverityAndRelevance inside findRankedSensorsNearZip
  // - only USGS sites are ever claimable (CWMS is discovery-only, see
  // sensorSearch.ts's SensorDiscoverySource).
  const usgsCandidates = candidates.filter((sensor) => sensor.source === "USGS");
  if (usgsCandidates.length === 0) return [];

  const claimed = await prisma.sensor.findMany({
    where: { source: "USGS", externalId: { in: usgsCandidates.map((sensor) => sensor.siteNo) } },
    select: { externalId: true },
  });
  const claimedSiteNos = new Set(claimed.map((sensor) => sensor.externalId));

  return usgsCandidates
    .filter((sensor) => !claimedSiteNos.has(sensor.siteNo))
    .slice(0, count)
    .map((sensor) => ({
      siteNo: sensor.siteNo,
      name: sensor.name,
      lat: sensor.lat,
      lon: sensor.lon,
      streamRelation: sensor.streamRelation,
    }));
}
