import { prisma } from "@/server/db/client";
import { Prisma, type Sensor } from "@/generated/prisma/client";
import { USGS_PARAM_CODES } from "@/server/integrations/usgs";
import {
  evaluateClusterCondition,
  evaluateSensorCondition,
  rateOfChangePerHour,
  type CompositeIndexMember,
  type ConditionResult,
  type FloodStages,
  type SingleSensorConditionType,
} from "@/server/rules";
import { getRecentReadings } from "./readingsHistory";

const SINGLE_SENSOR_CONDITIONS = new Set<string>([
  "RATE_OF_RISE",
  "ACCELERATION",
  "PCT_OF_FLOOD_STAGE",
  "HISTORICAL_PERCENTILE",
  "RECESSION_DEVIATION",
  "STALENESS",
]);

export interface RuleEvaluation {
  ruleId: string;
  conditionType: string;
  result: ConditionResult;
  /** True only on the transition into triggered - never on a repeat poll while still triggered. */
  isNewTrigger: boolean;
}

/**
 * Evaluates every enabled rule on a cluster against currently stored readings.
 * Per-sensor condition types (rate_of_rise, staleness, etc.) expect the cluster
 * to hold exactly one sensor - that's how single-sensor rules are represented
 * in this design (a one-sensor cluster per rule), not a special case here.
 */
export async function evaluateCluster(clusterId: string): Promise<RuleEvaluation[]> {
  const cluster = await prisma.cluster.findUniqueOrThrow({
    where: { id: clusterId },
    include: { rules: { where: { enabled: true } } },
  });

  const sensors = await prisma.sensor.findMany({
    where: { id: { in: cluster.sensorIds } },
  });

  const evaluations: RuleEvaluation[] = [];

  evaluations.push(...(await evaluateSingleSensorRules(cluster.rules, sensors[0])));
  evaluations.push(...(await evaluateCrossSensorLagRules(cluster.rules, sensors)));
  evaluations.push(...(await evaluateCompositeIndexRules(cluster.rules, sensors)));

  return evaluations;
}

type ClusterWithRules = Prisma.ClusterGetPayload<{ include: { rules: true } }>;
type ClusterRule = ClusterWithRules["rules"][number];
type ClusterSensor = Sensor;

function paramsOf(rule: ClusterRule): Record<string, unknown> {
  return (rule.params as Record<string, unknown>) ?? {};
}

/**
 * Turns a raw condition result into a RuleEvaluation, persisting the rule's
 * triggered state when it changes. Every call site routes through here so the
 * poll loop always sees isNewTrigger rather than re-deriving it itself.
 */
async function recordEvaluation(rule: ClusterRule, result: ConditionResult): Promise<RuleEvaluation> {
  const isNewTrigger = result.triggered && !rule.currentlyTriggered;

  if (result.triggered !== rule.currentlyTriggered) {
    await prisma.rule.update({
      where: { id: rule.id },
      data: {
        currentlyTriggered: result.triggered,
        lastTriggeredAt: result.triggered ? new Date() : rule.lastTriggeredAt,
      },
    });
  }

  return { ruleId: rule.id, conditionType: rule.conditionType, result, isNewTrigger };
}

async function evaluateSingleSensorRules(
  rules: ClusterRule[],
  primarySensor: ClusterSensor | undefined,
): Promise<RuleEvaluation[]> {
  const evaluations: RuleEvaluation[] = [];

  for (const rule of rules) {
    if (!SINGLE_SENSOR_CONDITIONS.has(rule.conditionType)) continue;

    if (!primarySensor) {
      evaluations.push(
        await recordEvaluation(rule, { triggered: false, message: "Cluster has no sensor to evaluate against." }),
      );
      continue;
    }

    const readings = await getRecentReadings(primarySensor.id, USGS_PARAM_CODES.GAGE_HEIGHT_FT);
    const floodStages = (primarySensor.floodStages as FloodStages | null) ?? undefined;

    const result = evaluateSensorCondition(rule.conditionType as SingleSensorConditionType, {
      readings,
      floodStages,
      params: paramsOf(rule),
    });

    evaluations.push(await recordEvaluation(rule, result));
  }

  return evaluations;
}

async function evaluateCrossSensorLagRules(
  rules: ClusterRule[],
  sensors: ClusterSensor[],
): Promise<RuleEvaluation[]> {
  const crossSensorRules = rules.filter((r) => r.conditionType === "CROSS_SENSOR_LAG_DEVIATION");
  if (crossSensorRules.length === 0) return [];

  const upstream = sensors.find((s) => s.streamRelation === "UPSTREAM");
  const downstream = sensors.find((s) => s.streamRelation === "DOWNSTREAM");

  const evaluations: RuleEvaluation[] = [];
  for (const rule of crossSensorRules) {
    if (!upstream || !downstream) {
      evaluations.push(
        await recordEvaluation(rule, {
          triggered: false,
          message: "Cluster needs exactly one upstream and one downstream sensor to evaluate lag.",
        }),
      );
      continue;
    }

    const baseline = await prisma.baseline.findFirst({
      where: { upstreamSensorId: upstream.id, downstreamSensorId: downstream.id },
      orderBy: { computedAt: "desc" },
    });
    if (!baseline) {
      evaluations.push(
        await recordEvaluation(rule, { triggered: false, message: "No baseline on file for this sensor pair yet." }),
      );
      continue;
    }

    const [upstreamReadings, downstreamReadings] = await Promise.all([
      getRecentReadings(upstream.id, USGS_PARAM_CODES.GAGE_HEIGHT_FT),
      getRecentReadings(downstream.id, USGS_PARAM_CODES.GAGE_HEIGHT_FT),
    ]);

    const result = evaluateClusterCondition("CROSS_SENSOR_LAG_DEVIATION", {
      upstreamReadings,
      downstreamReadings,
      baseline: { lagMinutes: baseline.lagMinutes, attenuationPct: baseline.attenuationPct },
      params: paramsOf(rule),
    });

    evaluations.push(await recordEvaluation(rule, result));
  }

  return evaluations;
}

async function evaluateCompositeIndexRules(
  rules: ClusterRule[],
  sensors: ClusterSensor[],
): Promise<RuleEvaluation[]> {
  const compositeRules = rules.filter((r) => r.conditionType === "COMPOSITE_INDEX_THRESHOLD");
  if (compositeRules.length === 0) return [];

  const members: CompositeIndexMember[] = [];
  for (const sensor of sensors) {
    const readings = await getRecentReadings(sensor.id, USGS_PARAM_CODES.GAGE_HEIGHT_FT, 6);
    const rate = rateOfChangePerHour(readings) ?? 0;
    const floodStages = (sensor.floodStages as FloodStages | null) ?? undefined;
    const current = readings[readings.length - 1];
    const pctOfFloodStage = current && floodStages?.action ? (current.value / floodStages.action) * 100 : 0;

    members.push({
      pctOfFloodStage,
      rateOfRiseFtPerHr: rate,
      // Simplification: flags a member already past its own action stage.
      // A fuller version would also OR in that sensor's own one-sensor-cluster
      // rule triggers, which means a cross-cluster lookup this pass doesn't attempt.
      hasOpenAnomaly: pctOfFloodStage >= 100,
    });
  }

  return Promise.all(
    compositeRules.map((rule) =>
      recordEvaluation(rule, evaluateClusterCondition("COMPOSITE_INDEX_THRESHOLD", { members, params: paramsOf(rule) })),
    ),
  );
}
