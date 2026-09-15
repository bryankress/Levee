import { prisma } from "@/server/db/client";
import type { TimedValue } from "@/server/rules/types";

/**
 * Ascending-by-time readings for one sensor/param over the trailing window.
 * Condition functions each apply their own narrower window on top of this -
 * fetch generously once, let the rule decide how much of it it needs.
 */
export async function getRecentReadings(
  sensorId: string,
  paramCode: string,
  lookbackHours = 48,
): Promise<TimedValue[]> {
  const since = new Date(Date.now() - lookbackHours * 60 * 60 * 1000);

  const rows = await prisma.sensorReading.findMany({
    where: { sensorId, paramCode, timestamp: { gte: since } },
    orderBy: { timestamp: "asc" },
  });

  return rows.map((row) => ({
    timestamp: row.timestamp.toISOString(),
    value: row.value,
  }));
}
