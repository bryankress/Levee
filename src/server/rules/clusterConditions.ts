import type {
  CompositeIndexContext,
  ConditionResult,
  CrossSensorLagContext,
  TimedValue,
} from "./types";
import { clamp } from "./utils";

/** Timestamp (ms since epoch) of the steepest rise between consecutive readings. */
function peakRiseTime(readings: TimedValue[]): number | undefined {
  if (readings.length < 2) return undefined;

  let bestDelta = -Infinity;
  let bestTime: number | undefined;
  for (let i = 1; i < readings.length; i++) {
    const delta = readings[i].value - readings[i - 1].value;
    if (delta > bestDelta) {
      bestDelta = delta;
      bestTime = new Date(readings[i].timestamp).getTime();
    }
  }
  return bestTime;
}

export function crossSensorLagDeviation(ctx: CrossSensorLagContext): ConditionResult {
  const toleranceMinutes = Number(ctx.params.toleranceMinutes);

  const upstreamPeak = peakRiseTime(ctx.upstreamReadings);
  const downstreamPeak = peakRiseTime(ctx.downstreamReadings);
  if (upstreamPeak === undefined || downstreamPeak === undefined) {
    return { triggered: false, message: "Not enough readings on one or both sensors to find a rise to compare." };
  }

  const actualLagMinutes = (downstreamPeak - upstreamPeak) / (60 * 1000);
  const deviation = Math.abs(actualLagMinutes - ctx.baseline.lagMinutes);

  return {
    triggered: deviation >= toleranceMinutes,
    measured: actualLagMinutes,
    message: `Upstream-to-downstream lag is ${actualLagMinutes.toFixed(0)} min vs. a baseline of ${ctx.baseline.lagMinutes.toFixed(0)} min (${deviation.toFixed(0)} min off, tolerance ${toleranceMinutes}).`,
  };
}

export function compositeIndexThreshold(ctx: CompositeIndexContext): ConditionResult {
  const thresholdScore = Number(ctx.params.thresholdScore);
  const pctWeight = Number(ctx.params.pctWeight ?? 0.6);
  const riseWeight = Number(ctx.params.riseWeight ?? 0.3);
  const anomalyBonus = Number(ctx.params.anomalyBonus ?? 10);
  const maxExpectedRateFtPerHr = Number(ctx.params.maxExpectedRateFtPerHr ?? 1);

  if (ctx.members.length === 0) {
    return { triggered: false, message: "Cluster has no members to score." };
  }

  const memberScores = ctx.members.map((member) => {
    const pctScore = clamp(member.pctOfFloodStage, 0, 100);
    const riseScore = clamp((member.rateOfRiseFtPerHr / maxExpectedRateFtPerHr) * 100, 0, 100);
    const anomalyScore = member.hasOpenAnomaly ? anomalyBonus : 0;
    return clamp(pctWeight * pctScore + riseWeight * riseScore + anomalyScore, 0, 100);
  });

  const score = memberScores.reduce((sum, s) => sum + s, 0) / memberScores.length;

  return {
    triggered: score >= thresholdScore,
    measured: score,
    message: `Composite reach-health score is ${score.toFixed(0)} (threshold ${thresholdScore}).`,
  };
}
