import type { Event, StreamRelation } from "@/generated/prisma/client";
import { getRecentReadings } from "@/server/ingest/readingsHistory";
import { USGS_PARAM_CODES } from "@/server/integrations/usgs";
import type { FloodStages } from "@/server/rules";
import { rateOfChangePerHour } from "@/server/rules";
import { prisma } from "@/server/db/client";

export interface PortalSensorRow {
  id: string;
  externalId: string;
  streamRelation: StreamRelation | null;
  stageFt: number | undefined;
  /** Against the sensor's own NWPS "action" stage - undefined when either is missing. */
  pctOfFloodStage: number | undefined;
  rateOfRiseFtPerHr: number | undefined;
  lastReadingAt: Date | null;
}

export interface PortalHomeData {
  levee:
    | {
        id: string;
        name: string;
        address: string | null;
        riverName: string | null;
      }
    | undefined;
  sensors: PortalSensorRow[];
  teamMemberCount: number;
  documentCount: number;
  upcomingEvents: Event[];
  /** Whole days until upcomingEvents[0], undefined when nothing's scheduled. */
  daysToNextEvent: number | undefined;
  personnelPreview: { id: string; name: string; role: string }[];
  /** The single highest-percentage sensor at or above 90% of its action stage, for the alert banner. */
  criticalSensor: PortalSensorRow | undefined;
  lastSyncedAt: Date | undefined;
}

const CRITICAL_PCT_THRESHOLD = 90;

/**
 * Everything the portal home page renders, for one org's (first) levee.
 * Multi-levee switching isn't built yet - an org with several levees just
 * sees its first one here, same simplification the sidebar's org info makes.
 */
export async function getPortalHome(orgId: string): Promise<PortalHomeData> {
  const levee = await prisma.levee.findFirst({ where: { orgId } });

  const [sensors, teamMemberCount, documentCount, upcomingEvents, personnelPreview] = await Promise.all([
    levee ? prisma.sensor.findMany({ where: { leveeId: levee.id } }) : Promise.resolve([]),
    prisma.person.count({ where: { orgId } }),
    levee ? prisma.document.count({ where: { leveeId: levee.id } }) : Promise.resolve(0),
    levee
      ? prisma.event.findMany({
          where: { leveeId: levee.id, startsAt: { gte: new Date() } },
          orderBy: { startsAt: "asc" },
          take: 3,
        })
      : Promise.resolve([]),
    prisma.person.findMany({ where: { orgId }, take: 3, orderBy: { name: "asc" } }),
  ]);

  const sensorRows = await Promise.all(sensors.map(toSensorRow));

  const criticalSensor = sensorRows
    .filter((row) => (row.pctOfFloodStage ?? 0) >= CRITICAL_PCT_THRESHOLD)
    .sort((a, b) => (b.pctOfFloodStage ?? 0) - (a.pctOfFloodStage ?? 0))[0];

  const lastSyncedAt = sensorRows.reduce<Date | undefined>((latest, row) => {
    if (!row.lastReadingAt) return latest;
    return !latest || row.lastReadingAt > latest ? row.lastReadingAt : latest;
  }, undefined);

  const nextEvent = upcomingEvents[0];
  const daysToNextEvent = nextEvent
    ? Math.max(0, Math.ceil((nextEvent.startsAt.getTime() - Date.now()) / 86_400_000))
    : undefined;

  return {
    levee: levee ? { id: levee.id, name: levee.name, address: levee.address, riverName: levee.riverName } : undefined,
    sensors: sensorRows,
    teamMemberCount,
    documentCount,
    upcomingEvents,
    daysToNextEvent,
    personnelPreview: personnelPreview.map((person) => ({ id: person.id, name: person.name, role: person.role })),
    criticalSensor,
    lastSyncedAt,
  };
}

async function toSensorRow(sensor: {
  id: string;
  externalId: string;
  streamRelation: StreamRelation | null;
  floodStages: unknown;
  lastReadingAt: Date | null;
}): Promise<PortalSensorRow> {
  const readings = await getRecentReadings(sensor.id, USGS_PARAM_CODES.GAGE_HEIGHT_FT, 6);
  const latest = readings[readings.length - 1];
  const floodStages = (sensor.floodStages as FloodStages | null) ?? undefined;
  const pctOfFloodStage = latest && floodStages?.action ? (latest.value / floodStages.action) * 100 : undefined;

  return {
    id: sensor.id,
    externalId: sensor.externalId,
    streamRelation: sensor.streamRelation,
    stageFt: latest?.value,
    pctOfFloodStage,
    rateOfRiseFtPerHr: rateOfChangePerHour(readings),
    lastReadingAt: sensor.lastReadingAt,
  };
}
