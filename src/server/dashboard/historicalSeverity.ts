import { prisma } from "@/server/db/client";
import { percentileRank } from "@/server/rules";

// Below this, a percentile is mostly noise - a brand-new sensor's very
// first few readings are trivially its own highest-ever value, which would
// otherwise show as a false "high" every time. Both gates matter
// independently: enough distinct samples, and enough elapsed time for
// those samples to reflect more than one short-lived condition.
const MIN_SAMPLE_SIZE = 50;
const MIN_HISTORY_DAYS = 3;
// A pragmatic bound on how far back the distribution looks, not a
// meaningful threshold in itself - keeps the query bounded as a sensor
// accumulates years of 15-minute readings, long before that's a real
// concern for this app's current scale.
const MAX_HISTORY_DAYS = 730;

const ELEVATED_PERCENTILE = 80;
const HIGH_PERCENTILE = 95;

export type HistoricalSeverity = "good" | "elevated" | "high";

export interface HistoricalSeverityResult {
  severity: HistoricalSeverity;
  /** Where the current reading falls among this sensor's own historical readings, 0-100. */
  percentile: number;
}

/**
 * A fallback severity signal for a sensor with real accumulated reading
 * history but no official NWS flood-stage threshold (see
 * nwpsCrosswalk.ts / getPortalSensors.ts's pctOfFloodStage) - compares the
 * current reading against this SAME sensor's own historical distribution,
 * so a district whose gauges NWPS doesn't cover (a real, common gap - see
 * sensorFloodStageRefresh.ts) still gets some glanceable signal instead of
 * a permanent blank.
 *
 * This is a genuinely weaker, different claim than an official threshold:
 * "unusually high for this specific sensor," never "close to an actual
 * flood" - callers must never render it with the same meter-bar/percent-
 * of-flood-stage UI an official threshold gets, since that would imply an
 * authority this doesn't have. Returns undefined (not a guessed severity)
 * until enough real history has accumulated to make the comparison
 * meaningful.
 */
export async function computeHistoricalSeverity(
  sensorId: string,
  paramCode: string,
  currentValue: number,
): Promise<HistoricalSeverityResult | undefined> {
  const since = new Date(Date.now() - MAX_HISTORY_DAYS * 24 * 60 * 60 * 1000);

  const readings = await prisma.sensorReading.findMany({
    where: { sensorId, paramCode, timestamp: { gte: since } },
    select: { value: true, timestamp: true },
    orderBy: { timestamp: "asc" },
  });

  if (readings.length < MIN_SAMPLE_SIZE) return undefined;

  const spanDays =
    (readings[readings.length - 1].timestamp.getTime() - readings[0].timestamp.getTime()) / (24 * 60 * 60 * 1000);
  if (spanDays < MIN_HISTORY_DAYS) return undefined;

  const percentile = percentileRank(
    readings.map((reading) => reading.value),
    currentValue,
  );
  const severity: HistoricalSeverity =
    percentile >= HIGH_PERCENTILE ? "high" : percentile >= ELEVATED_PERCENTILE ? "elevated" : "good";

  return { severity, percentile };
}
