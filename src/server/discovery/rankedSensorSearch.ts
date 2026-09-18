import {
  findSensorsNearZip,
  UnknownZipError,
  type SensorDiscoverySource,
  type SensorStreamRelation,
} from "./sensorSearch";
import { sortBySeverityAndRelevance } from "./sensorRanking";
import { fetchUsgsInstantaneousValues, USGS_PARAM_CODES, type UsgsReading } from "@/server/integrations/usgs";
import type { ZipCentroid } from "./zipLookup";

export { UnknownZipError };

// A last-resort cap on how many candidates get readings fetched/ranked - not
// meant to bind in practice (see the two callers: the marketing/portal
// search UI shows its own truncation notice, and the signup auto-populate
// path only ever takes a handful off the front of this list anyway).
const MAX_CANDIDATES = 100;

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export interface RankedSensor {
  siteNo: string;
  name: string;
  lat: number;
  lon: number;
  distanceMiles: number;
  source: SensorDiscoverySource;
  /** CWMS only: the USACE district office that owns this location (e.g. "MVR"). */
  officeId: string | undefined;
  /** CWMS only: CWMS's own raw location-kind label (e.g. "PROJECT", "EMBANKMENT"). */
  locationKind: string | undefined;
  /** Latest USGS gage-height reading, in feet - undefined when the site has no current reading, and always undefined for a CWMS entry (discovery-only, no readings integration yet). */
  stageFt: number | undefined;
  /** Raw USGS timestamp (with the station's own UTC offset) for stageFt - undefined exactly when stageFt is. */
  stageObservedAt: string | undefined;
  /** Latest USGS discharge reading, in cfs - same undefined cases as stageFt. A rough proxy for how much water this river actually carries, independent of how close its current stage is to flooding. */
  dischargeCfs: number | undefined;
  /** Real upstream/downstream classification from NLDI's river-network navigation - undefined, not guessed, when NLDI can't place this gauge on the search point's network. */
  streamRelation: SensorStreamRelation | undefined;
  /** UPSTREAM only: true when on the mainstem itself rather than only a tributary - undefined when unknown (downstream, or the mainstem check itself failed), not "confirmed tributary-only." */
  isMainstem: boolean | undefined;
  /** True when NOAA NWPS has a real, official flood-stage threshold defined for this gauge. */
  hasFloodStage: boolean;
  /** The real "action" stage threshold itself, in feet - undefined exactly when hasFloodStage is false, or when a threshold exists for minor/moderate/major but not action specifically. */
  floodStageActionFt: number | undefined;
  /** stageFt as a percentage of floodStageActionFt - undefined unless both are known. The actual severity signal ranking is based on, not just "a threshold exists somewhere." */
  pctOfFloodStage: number | undefined;
}

export interface RankedSensorSearchResult {
  center: ZipCentroid;
  radiusMiles: number;
  sensors: RankedSensor[];
  /** True when more active sensors exist within radiusMiles than this result includes - a cap, not the exhaustive total. */
  truncated: boolean;
}

/**
 * The zip-to-sensor pipeline shared by every caller that needs a ranked,
 * reading-enriched candidate list: the marketing/portal search UI
 * (marketing/actions.ts's searchSensorsAction wraps this for a form
 * submission) and the automatic post-signup background search
 * (signup/autoPopulateSensors.ts calls this directly, no form involved).
 * Throws UnknownZipError for an unrecognized zip - callers decide how to
 * surface that (a form error message vs. a silent "no auto-picks" fallback).
 */
export async function findRankedSensorsNearZip(
  zip: string,
  radiusMiles: number,
  signal?: AbortSignal,
): Promise<RankedSensorSearchResult> {
  const result = await findSensorsNearZip(zip, radiusMiles, signal);

  const nearest = result.sensors.slice(0, MAX_CANDIDATES);
  const truncated = result.sensors.length > MAX_CANDIDATES;
  if (nearest.length === 0) {
    return { center: result.center, radiusMiles: result.radiusMiles, sensors: [], truncated: false };
  }

  let readings: UsgsReading[];
  try {
    readings = await fetchUsgsInstantaneousValues(
      nearest.filter((sensor) => sensor.source === "USGS").map((sensor) => sensor.siteNo),
      [USGS_PARAM_CODES.GAGE_HEIGHT_FT, USGS_PARAM_CODES.DISCHARGE_CFS],
      signal,
    );
  } catch (error) {
    if (isAbortError(error)) throw error;
    // The site list itself is still good even if current readings failed -
    // rank/return it without stage data rather than losing the whole search.
    console.error("USGS instantaneous-values lookup failed:", error);
    readings = [];
  }

  // Two separate maps, not one keyed only by siteNo - readings mixes both
  // gage-height and discharge rows for the same site, and a single
  // siteNo-only map would silently let one overwrite the other.
  const latestBySiteAndParam = new Map<string, Map<string, { value: number; timestamp: string }>>();
  for (const reading of readings) {
    const byParam = latestBySiteAndParam.get(reading.siteNo) ?? new Map();
    const existing = byParam.get(reading.paramCode);
    if (!existing || reading.timestamp > existing.timestamp) {
      byParam.set(reading.paramCode, { value: reading.value, timestamp: reading.timestamp });
    }
    latestBySiteAndParam.set(reading.siteNo, byParam);
  }

  const sensors: RankedSensor[] = nearest.map((sensor) => {
    const byParam = latestBySiteAndParam.get(sensor.siteNo);
    const stage = byParam?.get(USGS_PARAM_CODES.GAGE_HEIGHT_FT);
    const discharge = byParam?.get(USGS_PARAM_CODES.DISCHARGE_CFS);
    const pctOfFloodStage =
      stage && sensor.floodStageActionFt ? (stage.value / sensor.floodStageActionFt) * 100 : undefined;

    return {
      siteNo: sensor.siteNo,
      name: sensor.name,
      lat: sensor.lat,
      lon: sensor.lon,
      distanceMiles: sensor.distanceMiles,
      source: sensor.source,
      officeId: sensor.officeId,
      locationKind: sensor.locationKind,
      stageFt: stage?.value,
      stageObservedAt: stage?.timestamp,
      dischargeCfs: discharge?.value,
      streamRelation: sensor.streamRelation,
      isMainstem: sensor.isMainstem,
      hasFloodStage: sensor.hasFloodStage,
      floodStageActionFt: sensor.floodStageActionFt,
      pctOfFloodStage,
    };
  });

  return {
    center: result.center,
    radiusMiles: result.radiusMiles,
    sensors: sortBySeverityAndRelevance(sensors),
    truncated,
  };
}
