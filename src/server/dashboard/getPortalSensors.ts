import type { SensorSource, StreamRelation } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";
import { getRecentReadings } from "@/server/ingest/readingsHistory";
import { USGS_PARAM_CODES } from "@/server/integrations/usgs";
import type { FloodStages } from "@/server/rules";
import { rateOfChangePerHour } from "@/server/rules";
import { computeHistoricalSeverity, type HistoricalSeverityResult } from "./historicalSeverity";

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
  rateOfRiseFtPerHr: number | undefined;
  lastReadingAt: Date | null;
  /** Ascending by time, gage-height only, trailing ~48h - just enough for a row sparkline. */
  sparkline: number[];
}

export interface PortalSensorsData {
  levee: { id: string; name: string } | undefined;
  sensors: PortalSensorDetail[];
  lastSyncedAt: Date | undefined;
}

/**
 * The full sensor roster for one org's (first) levee - same multi-levee
 * simplification as getPortalHome, since switching between levees isn't
 * built yet. Richer than the dashboard's preview table: every sensor (not
 * just however many fit in a summary panel), plus discharge and a
 * short-history sparkline alongside stage.
 */
export async function getPortalSensors(orgId: string): Promise<PortalSensorsData> {
  const levee = await prisma.levee.findFirst({ where: { orgId } });
  const sensors = levee
    ? await prisma.sensor.findMany({ where: { leveeId: levee.id }, orderBy: { externalId: "asc" } })
    : [];

  const sensorRows = await Promise.all(sensors.map(toSensorDetail));

  const lastSyncedAt = sensorRows.reduce<Date | undefined>((latest, row) => {
    if (!row.lastReadingAt) return latest;
    return !latest || row.lastReadingAt > latest ? row.lastReadingAt : latest;
  }, undefined);

  return {
    levee: levee ? { id: levee.id, name: levee.name } : undefined,
    sensors: sensorRows,
    lastSyncedAt,
  };
}

async function toSensorDetail(sensor: {
  id: string;
  source: SensorSource;
  externalId: string;
  name: string | null;
  streamRelation: StreamRelation | null;
  floodStages: unknown;
  lastReadingAt: Date | null;
}): Promise<PortalSensorDetail> {
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
    rateOfRiseFtPerHr: rateOfChangePerHour(stageReadings),
    lastReadingAt: sensor.lastReadingAt,
    sparkline: stageReadings.map((reading) => reading.value),
  };
}
