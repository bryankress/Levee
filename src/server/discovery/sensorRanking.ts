import type { SensorStreamRelation } from "./sensorSearch";

export interface RankableSensor {
  siteNo: string;
  distanceMiles: number;
  streamRelation: SensorStreamRelation | undefined;
  isMainstem: boolean | undefined;
  /** The "action" stage threshold, in feet - see sensorSearch.ts's NearbySensor.floodStageActionFt. */
  floodStageActionFt: number | undefined;
  /** Latest gage-height reading, in feet - undefined for a CWMS entry or a USGS site with no current reading. */
  stageFt: number | undefined;
  /** Latest discharge reading, in cfs - same undefined cases as stageFt. */
  dischargeCfs: number | undefined;
}

// Distance alone rewards "close" over "actually concerning" - a large
// mainstem river 100 miles upstream already in flood is a bigger threat
// than a calm minor tributary 20 miles upstream, because a flood crest
// takes real time to travel downstream: the distant gauge gives more lead
// time to react, not less, and the mainstem carries far more water than
// the tributary regardless of distance. Severity is a hard tier (a sensor
// actually near/over its own threshold always outranks one that isn't,
// whatever the distance gap) since that's the specific case distance alone
// gets backwards; relation/size/distance settle ties within the same tier
// as soft preferences, same "sorts as if closer" pattern the rest of this
// app's ranking already uses - see sensorSearch.ts's own sortFactor.
const SEVERITY_APPROACHING_PCT = 70; // matches sensorDisplay.ts's severityOf "elevated" threshold, deliberately kept in sync

/** 0 = at/above its own official threshold (most urgent) ... 3 = no threshold known at all (least informative on severity, not necessarily least relevant otherwise). */
type SeverityTier = 0 | 1 | 2 | 3;

function severityTier(sensor: RankableSensor): SeverityTier {
  if (sensor.floodStageActionFt === undefined || sensor.floodStageActionFt <= 0 || sensor.stageFt === undefined) {
    return 3;
  }
  const pctOfFloodStage = (sensor.stageFt / sensor.floodStageActionFt) * 100;
  if (pctOfFloodStage >= 100) return 0;
  if (pctOfFloodStage >= SEVERITY_APPROACHING_PCT) return 1;
  return 2;
}

const UPSTREAM_MAINSTEM_FACTOR = 0.65;
const UPSTREAM_UNKNOWN_TIER_FACTOR = 0.75;
const UPSTREAM_TRIBUTARY_FACTOR = 0.85;

function relationFactor(sensor: RankableSensor): number {
  if (sensor.streamRelation !== "UPSTREAM") return 1;
  if (sensor.isMainstem === true) return UPSTREAM_MAINSTEM_FACTOR;
  if (sensor.isMainstem === false) return UPSTREAM_TRIBUTARY_FACTOR;
  return UPSTREAM_UNKNOWN_TIER_FACTOR;
}

// A gentle log-scale reduction, not a hard cutoff - discharge spans orders
// of magnitude (a small creek: single digits to low hundreds of cfs; a
// major river: tens of thousands or more), so a linear factor would let one
// huge river swamp everything else, while no scaling at all would make a
// 10x-bigger river barely matter. 1,000 cfs is a plausible mid-size-river
// reference point, not a meaningful threshold in itself - only the relative
// comparison between candidates matters here.
const DISCHARGE_REFERENCE_CFS = 1_000;
const DISCHARGE_WEIGHT = 0.15;

function dischargeFactor(dischargeCfs: number | undefined): number {
  if (dischargeCfs === undefined || dischargeCfs <= 0) return 1; // unknown - neutral, no adjustment
  return 1 / Math.pow(dischargeCfs / DISCHARGE_REFERENCE_CFS, DISCHARGE_WEIGHT);
}

function withinTierSortKey(sensor: RankableSensor): number {
  return sensor.distanceMiles * relationFactor(sensor) * dischargeFactor(sensor.dischargeCfs);
}

/**
 * The real relevance ranking, once live readings are available (see
 * actions.ts - this can't run any earlier, since severity requires a
 * current reading, not just a threshold's existence). Sorts by severity
 * tier first, then by the existing soft-preference blend of upstream/
 * mainstem relation, river size (discharge), and distance within that
 * tier - so a sensor actually near or over its own flood stage always
 * ranks above one that isn't, and among equally-severe (or equally
 * unknown) sensors, a bigger upstream river still outranks a smaller one
 * regardless of which happens to be a few miles closer.
 */
export function sortBySeverityAndRelevance<T extends RankableSensor>(sensors: T[]): T[] {
  return [...sensors].sort((a, b) => {
    const tierDiff = severityTier(a) - severityTier(b);
    if (tierDiff !== 0) return tierDiff;
    return withinTierSortKey(a) - withinTierSortKey(b);
  });
}
