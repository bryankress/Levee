import type { TimedValue } from "./types";

const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_MINUTE = 60 * 1000;

export function withinWindow(
  readings: TimedValue[],
  windowMinutes: number,
  asOf: Date,
): TimedValue[] {
  const cutoff = asOf.getTime() - windowMinutes * MS_PER_MINUTE;
  return readings.filter((r) => new Date(r.timestamp).getTime() >= cutoff);
}

/**
 * Average rate of change (value units per hour) between the first and last
 * reading in the list. Returns undefined when there's nothing to compare -
 * callers treat that as "not enough data," never as a rate of zero.
 */
export function rateOfChangePerHour(readings: TimedValue[]): number | undefined {
  if (readings.length < 2) return undefined;
  const first = readings[0];
  const last = readings[readings.length - 1];
  const hours = (new Date(last.timestamp).getTime() - new Date(first.timestamp).getTime()) / MS_PER_HOUR;
  if (hours <= 0) return undefined;
  return (last.value - first.value) / hours;
}

export function latest(readings: TimedValue[]): TimedValue | undefined {
  return readings[readings.length - 1];
}

export function percentileRank(distribution: number[], value: number): number {
  if (distribution.length === 0) return 0;
  const atOrBelow = distribution.filter((v) => v <= value).length;
  return (atOrBelow / distribution.length) * 100;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
