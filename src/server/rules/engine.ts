import { compositeIndexThreshold, crossSensorLagDeviation } from "./clusterConditions";
import {
  acceleration,
  historicalPercentile,
  pctOfFloodStage,
  rateOfRise,
  recessionDeviation,
  staleness,
} from "./sensorConditions";
import type {
  ClusterConditionType,
  CompositeIndexContext,
  ConditionResult,
  CrossSensorLagContext,
  SensorConditionContext,
  SingleSensorConditionType,
} from "./types";

export function evaluateSensorCondition(
  type: SingleSensorConditionType,
  ctx: SensorConditionContext,
): ConditionResult {
  switch (type) {
    case "RATE_OF_RISE":
      return rateOfRise(ctx);
    case "ACCELERATION":
      return acceleration(ctx);
    case "PCT_OF_FLOOD_STAGE":
      return pctOfFloodStage(ctx);
    case "HISTORICAL_PERCENTILE":
      return historicalPercentile(ctx);
    case "RECESSION_DEVIATION":
      return recessionDeviation(ctx);
    case "STALENESS":
      return staleness(ctx);
  }
}

export function evaluateClusterCondition(
  type: ClusterConditionType,
  ctx: CrossSensorLagContext | CompositeIndexContext,
): ConditionResult {
  switch (type) {
    case "CROSS_SENSOR_LAG_DEVIATION":
      return crossSensorLagDeviation(ctx as CrossSensorLagContext);
    case "COMPOSITE_INDEX_THRESHOLD":
      return compositeIndexThreshold(ctx as CompositeIndexContext);
  }
}
