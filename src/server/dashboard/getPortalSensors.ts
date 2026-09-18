import type { SensorSource, StreamRelation } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";
import { getRecentReadings } from "@/server/ingest/readingsHistory";
import { USGS_PARAM_CODES } from "@/server/integrations/usgs";
import type { FloodStages } from "@/server/rules";
import { rateOfChangePerHour } from "@/server/rules";
import { computeHistoricalSeverity, type HistoricalSeverityResult } from "./historicalSeverity";
import { findForecastsForSiteNos, type SensorForecast } from "./sensorForecast";
import { SENSOR_CAP_BY_PLAN } from "@/lib/plans";

export interface PortalSensorDetail {
  id: string;
  source: SensorSource;
  externalId: string;
  /** The friendly station name carried over from marketing-search discovery - null for sensors claimed before this field existed. */
  name: string | null;
  streamRelation: StreamRelation | null;
  floodStages: FloodStages | undefined;
  stageFt: number | undefined;
  dischargeCfs: number | undefined;
  /** Against the sensor's own NWPS "action" stage - undefined when either is missing. */
  pctOfFloodStage: number | undefined;
  /** Only ever computed when pctOfFloodStage is undefined (no official threshold) - see historicalSeverity.ts for why this is a deliberately weaker, different signal that must never be shown the same way as an official threshold. */
  historicalSeverity: HistoricalSeverityResult | undefined;
  /** NWS's own predicted stage, when NWPS covers this gauge - see sensorForecast.ts. */
  forecast: SensorForecast | undefined;
  rateOfRiseFtPerHr: number | undefined;
  lastReadingAt: Date | null;
  /** Ascending by time, gage-height only, trailing ~48h - just enough for a row sparkline. */
  sparkline: number[];
}

export interface PortalSensorsData {
  levee: { id: string; name: string } | undefined;
  sensors: PortalSensorDetail[];
  lastSyncedAt: Date | undefined;
  /** How many more sensors this org's plan allows adding right now - 0 once at the plan's cap. Undefined when there's no levee yet (nothing to cap). */
  remainingSensorCapacity: number | undefined;
  sensorCap: number | undefined;
}

/**
 * The full sensor roster for one org's (first) levee - same multi-levee
 * simplification as getPortalHome, since switching between levees isn't
 * built yet. Richer than the dashboard's preview table: every sensor (not
 * just however many fit in a summary panel), plus discharge and a
 * short-history sparkline alongside stage.
 */
export async function getPortalSensors(orgId: string): Promise<PortalSensorsData> {
  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { plan: true } });
  const levee = await prisma.levee.findFirst({ where: { orgId } });
  const sensors = levee
    ? await prisma.sensor.findMany({ where: { leveeId: levee.id }, orderBy: { externalId: "asc" } })
    : [];

  // Batched once for the whole roster, not per-row like toSensorDetail's
  // other queries - the crosswalk lookup inside findForecastsForSiteNos is
  // itself a single query for any number of site numbers, so doing it once
  // up front avoids N redundant round trips to the same table.
  const actionStageFtBySiteNo = new Map<string, number>();
  for (const sensor of sensors) {
    const stages = (sensor.floodStages as FloodStages | null) ?? undefined;
    if (stages?.action !== undefined) actionStageFtBySiteNo.set(sensor.externalId, stages.action);
  }
  const usgsSiteNos = sensors.filter((sensor) => sensor.source === "USGS").map((sensor) => sensor.externalId);
  const forecastsBySiteNo = await findForecastsForSiteNos(usgsSiteNos, actionStageFtBySiteNo);

  const sensorRows = await Promise.all(
    sensors.map((sensor) => toSensorDetail(sensor, forecastsBySiteNo.get(sensor.externalId))),
  );

  const lastSyncedAt = sensorRows.reduce<Date | undefined>((latest, row) => {
    if (!row.lastReadingAt) return latest;
    return !latest || row.lastReadingAt > latest ? row.lastReadingAt : latest;
  }, undefined);

  const sensorCap = org ? SENSOR_CAP_BY_PLAN[org.plan] : undefined;
  const remainingSensorCapacity = sensorCap !== undefined ? Math.max(0, sensorCap - sensors.length) : undefined;

  return {
    levee: levee ? { id: levee.id, name: levee.name } : undefined,
    sensors: sensorRows,
    lastSyncedAt,
    remainingSensorCapacity,
    sensorCap,
  };
}

async function toSensorDetail(
  sensor: {
    id: string;
    source: SensorSource;
    externalId: string;
    name: string | null;
    streamRelation: StreamRelation | null;
    floodStages: unknown;
    lastReadingAt: Date | null;
  },
  forecast: SensorForecast | undefined,
): Promise<PortalSensorDetail> {
  const [stageReadings, dischargeReadings] = await Promise.all([
    getRecentReadings(sensor.id, USGS_PARAM_CODES.GAGE_HEIGHT_FT, 48),
    getRecentReadings(sensor.id, USGS_PARAM_CODES.DISCHARGE_CFS, 48),
  ]);

  const latestStage = stageReadings[stageReadings.length - 1];
  const latestDischarge = dischargeReadings[dischargeReadings.length - 1];
  const floodStages = (sensor.floodStages as FloodStages | null) ?? undefined;
  const pctOfFloodStage =
    latestStage && floodStages?.action ? (latestStage.value / floodStages.action) * 100 : undefined;

  // Only worth the extra query when there's no official threshold to show
  // instead - a real signal beats none, but never runs when the stronger
  // one is already available.
  const historicalSeverity =
    pctOfFloodStage === undefined && latestStage
      ? await computeHistoricalSeverity(sensor.id, USGS_PARAM_CODES.GAGE_HEIGHT_FT, latestStage.value)
      : undefined;

  return {
    id: sensor.id,
    source: sensor.source,
    externalId: sensor.externalId,
    name: sensor.name,
    streamRelation: sensor.streamRelation,
    floodStages,
    stageFt: latestStage?.value,
    dischargeCfs: latestDischarge?.value,
    pctOfFloodStage,
    historicalSeverity,
    forecast,
    rateOfRiseFtPerHr: rateOfChangePerHour(stageReadings),
    lastReadingAt: sensor.lastReadingAt,
    sparkline: stageReadings.map((reading) => reading.value),
  };
}
