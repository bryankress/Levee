import type { ConditionResult, SensorConditionContext } from "./types";
import { latest, percentileRank, rateOfChangePerHour, withinWindow } from "./utils";

export function rateOfRise(ctx: SensorConditionContext): ConditionResult {
  const windowMinutes = Number(ctx.params.windowMinutes ?? 60);
  const thresholdFtPerHr = Number(ctx.params.thresholdFtPerHr);
  const now = ctx.now ?? new Date();

  const window = withinWindow(ctx.readings, windowMinutes, now);
  const rate = rateOfChangePerHour(window);
  if (rate === undefined) {
    return { triggered: false, message: `Not enough readings in the last ${windowMinutes} min to compute a rate.` };
  }

  return {
    triggered: rate >= thresholdFtPerHr,
    measured: rate,
    message: `Rising at ${rate.toFixed(2)} ft/hr over the last ${windowMinutes} min (threshold ${thresholdFtPerHr} ft/hr).`,
  };
}

export function acceleration(ctx: SensorConditionContext): ConditionResult {
  const windowMinutes = Number(ctx.params.windowMinutes ?? 120);
  const thresholdFtPerHrPerHr = Number(ctx.params.thresholdFtPerHrPerHr);
  const now = ctx.now ?? new Date();

  const window = withinWindow(ctx.readings, windowMinutes, now);
  if (window.length < 3) {
    return { triggered: false, message: `Not enough readings in the last ${windowMinutes} min to compute acceleration.` };
  }

  const midpoint = Math.floor(window.length / 2);
  const firstHalf = window.slice(0, midpoint + 1);
  const secondHalf = window.slice(midpoint);

  const rate1 = rateOfChangePerHour(firstHalf);
  const rate2 = rateOfChangePerHour(secondHalf);
  if (rate1 === undefined || rate2 === undefined) {
    return { triggered: false, message: "Not enough readings to split into two rate windows." };
  }

  const midTime1 = new Date(firstHalf[Math.floor(firstHalf.length / 2)].timestamp).getTime();
  const midTime2 = new Date(secondHalf[Math.floor(secondHalf.length / 2)].timestamp).getTime();
  const hoursBetween = (midTime2 - midTime1) / (60 * 60 * 1000);
  if (hoursBetween <= 0) {
    return { triggered: false, message: "Readings don't span enough time to compute acceleration." };
  }

  const accel = (rate2 - rate1) / hoursBetween;
  return {
    triggered: accel >= thresholdFtPerHrPerHr,
    measured: accel,
    message: `Rate of rise steepening by ${accel.toFixed(2)} (ft/hr)/hr over the last ${windowMinutes} min (threshold ${thresholdFtPerHrPerHr}).`,
  };
}

export function pctOfFloodStage(ctx: SensorConditionContext): ConditionResult {
  const category = String(ctx.params.category ?? "action") as keyof NonNullable<SensorConditionContext["floodStages"]>;
  const thresholdPct = Number(ctx.params.thresholdPct);

  const current = latest(ctx.readings);
  const stage = ctx.floodStages?.[category];
  if (current === undefined || stage === undefined) {
    return { triggered: false, message: `Missing current reading or ${category} flood stage - can't evaluate.` };
  }

  const pct = (current.value / stage) * 100;
  return {
    triggered: pct >= thresholdPct,
    measured: pct,
    message: `${pct.toFixed(0)}% of ${category} stage (threshold ${thresholdPct}%).`,
  };
}

export function historicalPercentile(ctx: SensorConditionContext): ConditionResult {
  const thresholdPercentile = Number(ctx.params.thresholdPercentile);
  const current = latest(ctx.readings);
  const distribution = ctx.calendarDayHistory ?? [];

  if (current === undefined || distribution.length === 0) {
    return { triggered: false, message: "Missing current reading or historical calendar-day distribution - can't evaluate." };
  }

  const percentile = percentileRank(distribution, current.value);
  return {
    triggered: percentile >= thresholdPercentile,
    measured: percentile,
    message: `${percentile.toFixed(0)}th percentile for this calendar day (threshold ${thresholdPercentile}th).`,
  };
}

export function recessionDeviation(ctx: SensorConditionContext): ConditionResult {
  const windowMinutes = Number(ctx.params.windowMinutes ?? 180);
  const toleranceFtPerHr = Number(ctx.params.toleranceFtPerHr);
  const now = ctx.now ?? new Date();

  const window = withinWindow(ctx.readings, windowMinutes, now);
  const rate = rateOfChangePerHour(window);
  if (rate === undefined) {
    return { triggered: false, message: `Not enough readings in the last ${windowMinutes} min to evaluate recession.` };
  }
  if (rate >= 0) {
    return { triggered: false, message: "Still rising or flat - nothing to evaluate against a recession curve yet." };
  }
  if (ctx.historicalRecessionFtPerHr === undefined) {
    return { triggered: false, message: "No historical recession rate on file for this sensor - can't evaluate." };
  }

  const actualFallRate = -rate;
  const deviation = ctx.historicalRecessionFtPerHr - actualFallRate;
  return {
    triggered: deviation >= toleranceFtPerHr,
    measured: deviation,
    message: `Falling at ${actualFallRate.toFixed(2)} ft/hr vs. a typical ${ctx.historicalRecessionFtPerHr.toFixed(2)} ft/hr (${deviation.toFixed(2)} ft/hr slower, tolerance ${toleranceFtPerHr}).`,
  };
}

export function staleness(ctx: SensorConditionContext): ConditionResult {
  const maxAgeMinutes = Number(ctx.params.maxAgeMinutes);
  const now = ctx.now ?? new Date();

  const current = latest(ctx.readings);
  if (current === undefined) {
    return { triggered: true, message: "No readings at all for this sensor." };
  }

  const ageMinutes = (now.getTime() - new Date(current.timestamp).getTime()) / (60 * 1000);
  return {
    triggered: ageMinutes > maxAgeMinutes,
    measured: ageMinutes,
    message: `Last reading is ${ageMinutes.toFixed(0)} min old (expected within ${maxAgeMinutes} min).`,
  };
}
