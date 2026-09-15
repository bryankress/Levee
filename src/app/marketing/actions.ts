"use server";

import { bearingDegrees } from "@/server/discovery/geo";
import { findSensorsNearZip, UnknownZipError } from "@/server/discovery/sensorSearch";
import { fetchUsgsInstantaneousValues, USGS_PARAM_CODES, type UsgsReading } from "@/server/integrations/usgs";

const MAX_RESULTS = 30;
const SEARCH_RADIUS_MILES = 100;

export interface MarketingSensor {
  siteNo: string;
  name: string;
  lat: number;
  lon: number;
  distanceMiles: number;
  bearingDeg: number;
  /** Latest USGS gage-height reading, in feet - undefined when the site has no current reading. */
  stageFt: number | undefined;
}

export interface SearchState {
  error?: string;
  zip?: string;
  city?: string;
  state?: string;
  radiusMiles?: number;
  sensors?: MarketingSensor[];
}

/**
 * Real USGS data only: no flood-stage percentage or upstream/downstream
 * classification here, because neither can be computed honestly for an
 * anonymous search. Both need a levee's own pinned river-reach location
 * (upstream/downstream) or a USGS-site-to-NWPS-lid mapping (flood stage) -
 * neither exists until an org and levee are actually created at sign-up.
 */
export async function searchSensorsAction(_prevState: SearchState, formData: FormData): Promise<SearchState> {
  const zip = String(formData.get("zip") ?? "").trim();
  if (!/^\d{5}$/.test(zip)) {
    return { error: "Enter a 5-digit ZIP code." };
  }

  let result;
  try {
    result = await findSensorsNearZip(zip, SEARCH_RADIUS_MILES);
  } catch (error) {
    if (error instanceof UnknownZipError) {
      return { error: "That ZIP code isn't recognized." };
    }
    // USGS is a real third-party service on the critical path here - a
    // network hiccup or outage shouldn't crash the page, just say so.
    return { error: "Couldn't reach USGS right now. Try again in a moment." };
  }

  const nearest = result.sensors.slice(0, MAX_RESULTS);
  if (nearest.length === 0) {
    return {
      zip,
      city: result.center.city,
      state: result.center.state,
      radiusMiles: result.radiusMiles,
      sensors: [],
    };
  }

  let readings: UsgsReading[];
  try {
    readings = await fetchUsgsInstantaneousValues(
      nearest.map((sensor) => sensor.siteNo),
      [USGS_PARAM_CODES.GAGE_HEIGHT_FT],
    );
  } catch {
    // The site list itself is still good even if current readings failed -
    // show it without stage data rather than losing the whole search.
    readings = [];
  }

  const latestBySite = new Map<string, { value: number; timestamp: string }>();
  for (const reading of readings) {
    const existing = latestBySite.get(reading.siteNo);
    if (!existing || reading.timestamp > existing.timestamp) {
      latestBySite.set(reading.siteNo, { value: reading.value, timestamp: reading.timestamp });
    }
  }

  const sensors: MarketingSensor[] = nearest.map((sensor) => ({
    siteNo: sensor.siteNo,
    name: sensor.name,
    lat: sensor.lat,
    lon: sensor.lon,
    distanceMiles: sensor.distanceMiles,
    bearingDeg: bearingDegrees(result.center, sensor),
    stageFt: latestBySite.get(sensor.siteNo)?.value,
  }));

  return {
    zip,
    city: result.center.city,
    state: result.center.state,
    radiusMiles: result.radiusMiles,
    sensors,
  };
}
