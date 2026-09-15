export type SingleSensorConditionType =
  | "RATE_OF_RISE"
  | "ACCELERATION"
  | "PCT_OF_FLOOD_STAGE"
  | "HISTORICAL_PERCENTILE"
  | "RECESSION_DEVIATION"
  | "STALENESS";

export type ClusterConditionType =
  | "CROSS_SENSOR_LAG_DEVIATION"
  | "COMPOSITE_INDEX_THRESHOLD";

export interface TimedValue {
  timestamp: string;
  value: number;
}

export interface FloodStages {
  action?: number;
  minor?: number;
  moderate?: number;
  major?: number;
}

export interface ConditionResult {
  triggered: boolean;
  /** The measured value the decision was based on, for logging/display - not present when there wasn't enough data to evaluate. */
  measured?: number;
  message: string;
}

export interface SensorConditionContext {
  /** Ascending by time. */
  readings: TimedValue[];
  floodStages?: FloodStages;
  /** Values recorded on this same calendar day in past years, for HISTORICAL_PERCENTILE. */
  calendarDayHistory?: number[];
  /** This sensor's own typical post-peak fall rate (ft/hr, positive), for RECESSION_DEVIATION. */
  historicalRecessionFtPerHr?: number;
  now?: Date;
  params: Record<string, unknown>;
}

export interface Baseline {
  lagMinutes: number;
  attenuationPct: number;
}

export interface CrossSensorLagContext {
  /** Ascending by time. */
  upstreamReadings: TimedValue[];
  /** Ascending by time. */
  downstreamReadings: TimedValue[];
  baseline: Baseline;
  params: Record<string, unknown>;
}

export interface CompositeIndexMember {
  pctOfFloodStage: number;
  rateOfRiseFtPerHr: number;
  hasOpenAnomaly: boolean;
}

export interface CompositeIndexContext {
  members: CompositeIndexMember[];
  params: Record<string, unknown>;
}
