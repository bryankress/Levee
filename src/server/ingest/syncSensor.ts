import { prisma } from "@/server/db/client";
import { USGS_PARAM_CODES, fetchUsgsInstantaneousValues, type UsgsParamCode } from "@/server/integrations/usgs";
import { fetchNwpsStageflow } from "@/server/integrations/nwps";

export interface SyncResult {
  sensorId: string;
  inserted: number;
  latestReadingAt?: Date;
}

interface SyncableSensor {
  id: string;
  source: "USGS" | "NWPS";
  externalId: string;
  paramCodes: string[];
}

/**
 * Pulls the latest readings for one sensor from its source (USGS or NWPS) and
 * persists any not already stored. Safe to call repeatedly on a fixed cadence -
 * the (sensorId, paramCode, timestamp) unique constraint makes re-fetching the
 * same window a no-op rather than a duplicate.
 */
export async function syncSensor(sensor: SyncableSensor): Promise<SyncResult> {
  const rows =
    sensor.source === "USGS"
      ? await fetchFromUsgs(sensor)
      : await fetchFromNwps(sensor);

  if (rows.length === 0) {
    return { sensorId: sensor.id, inserted: 0 };
  }

  const result = await prisma.sensorReading.createMany({
    data: rows.map((row) => ({
      sensorId: sensor.id,
      paramCode: row.paramCode,
      value: row.value,
      timestamp: new Date(row.timestamp),
      qualifiers: row.qualifiers ?? [],
    })),
    skipDuplicates: true,
  });

  const latestReadingAt = rows.reduce<Date | undefined>((latest, row) => {
    const timestamp = new Date(row.timestamp);
    return !latest || timestamp > latest ? timestamp : latest;
  }, undefined);

  if (latestReadingAt) {
    await prisma.sensor.update({
      where: { id: sensor.id },
      data: { lastReadingAt: latestReadingAt },
    });
  }

  return { sensorId: sensor.id, inserted: result.count, latestReadingAt };
}

interface NormalizedReading {
  paramCode: string;
  value: number;
  timestamp: string;
  qualifiers?: string[];
}

async function fetchFromUsgs(sensor: SyncableSensor): Promise<NormalizedReading[]> {
  const paramCodes = sensor.paramCodes.length > 0
    ? (sensor.paramCodes as UsgsParamCode[])
    : [USGS_PARAM_CODES.DISCHARGE_CFS, USGS_PARAM_CODES.GAGE_HEIGHT_FT];

  const readings = await fetchUsgsInstantaneousValues([sensor.externalId], paramCodes);
  return readings.map((r) => ({
    paramCode: r.paramCode,
    value: r.value,
    timestamp: r.timestamp,
    qualifiers: r.qualifiers,
  }));
}

async function fetchFromNwps(sensor: SyncableSensor): Promise<NormalizedReading[]> {
  // Only .observed is real history - .forecast is NWS's own prediction and
  // must never be ingested as an actual reading (see sensorForecast.ts for
  // the one place forecast data is actually used).
  const { observed } = await fetchNwpsStageflow(sensor.externalId);
  const readings: NormalizedReading[] = [];

  for (const point of observed) {
    if (point.stageFt !== undefined) {
      readings.push({ paramCode: USGS_PARAM_CODES.GAGE_HEIGHT_FT, value: point.stageFt, timestamp: point.validTime });
    }
    if (point.flowCfs !== undefined) {
      readings.push({ paramCode: USGS_PARAM_CODES.DISCHARGE_CFS, value: point.flowCfs, timestamp: point.validTime });
    }
  }

  return readings;
}
