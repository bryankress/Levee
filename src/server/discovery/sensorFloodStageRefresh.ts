import { prisma } from "@/server/db/client";
import { Prisma } from "@/generated/prisma/client";
import { fetchNwpsGauge } from "@/server/integrations/nwps";
import { hasRealThreshold } from "./nwpsCrosswalk";

const PER_GAUGE_TIMEOUT_MS = 5_000;

export interface SensorFloodStageRefreshSummary {
  sensorsChecked: number;
  sensorsUpdated: number;
  sensorsFailed: number;
  errors: string[];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Re-fetches Sensor.floodStages for every currently-claimed USGS sensor
 * that has any NWPS presence - a real live re-fetch each time (not the
 * search/claim-path crosswalk's cache-skip shortcut in nwpsCrosswalk.ts),
 * since the whole point of this periodic job is to catch a threshold NWS
 * revised after the sensor was claimed, not just fill one in once. NWS
 * revises these rarely (a channel/levee remodel, a re-survey), so this is a
 * courtesy cadence, not a freshness requirement - see
 * sensorFloodStageRefreshLoop.ts for how often it actually runs.
 */
export async function refreshSensorFloodStages(): Promise<SensorFloodStageRefreshSummary> {
  const summary: SensorFloodStageRefreshSummary = {
    sensorsChecked: 0,
    sensorsUpdated: 0,
    sensorsFailed: 0,
    errors: [],
  };

  const sensors = await prisma.sensor.findMany({
    where: { source: "USGS" },
    select: { id: true, externalId: true },
  });
  if (sensors.length === 0) return summary;

  const gaugeCacheEntries = await prisma.nwpsGaugeCache.findMany({
    where: { usgsId: { in: sensors.map((sensor) => sensor.externalId) } },
    select: { lid: true, usgsId: true },
  });
  const lidBySiteNo = new Map(
    gaugeCacheEntries
      .filter((entry): entry is { lid: string; usgsId: string } => entry.usgsId !== null)
      .map((entry) => [entry.usgsId, entry.lid]),
  );

  // A sensor with no NWPS presence at all has nothing to refresh - skipped
  // rather than counted as a failure.
  const refreshable = sensors
    .map((sensor) => ({ sensor, lid: lidBySiteNo.get(sensor.externalId) }))
    .filter((entry): entry is { sensor: (typeof sensors)[number]; lid: string } => entry.lid !== undefined);
  summary.sensorsChecked = refreshable.length;

  const results = await Promise.allSettled(
    refreshable.map(async ({ sensor, lid }) => {
      const gauge = await fetchNwpsGauge(lid, AbortSignal.timeout(PER_GAUGE_TIMEOUT_MS));
      await prisma.sensor.update({
        where: { id: sensor.id },
        data: {
          floodStages: hasRealThreshold(gauge.floodCategories)
            ? (gauge.floodCategories as Prisma.InputJsonValue)
            : Prisma.JsonNull,
        },
      });
    }),
  );

  for (const result of results) {
    if (result.status === "fulfilled") {
      summary.sensorsUpdated++;
    } else {
      summary.sensorsFailed++;
      summary.errors.push(errorMessage(result.reason));
    }
  }

  return summary;
}
