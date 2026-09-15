"use server";

import { findSensorsNearZip, UnknownZipError, type SensorStreamRelation } from "@/server/discovery/sensorSearch";
import { fetchUsgsInstantaneousValues, USGS_PARAM_CODES, type UsgsReading } from "@/server/integrations/usgs";

const MAX_RESULTS = 30;
const SEARCH_RADIUS_MILES = 100;

export interface MarketingSensor {
  siteNo: string;
  name: string;
  lat: number;
  lon: number;
  distanceMiles: number;
  /** Latest USGS gage-height reading, in feet - undefined when the site has no current reading. */
  stageFt: number | undefined;
  /** Real upstream/downstream classification from NLDI's river-network navigation - undefined, not guessed, when NLDI can't place this gauge on the search point's network. */
  streamRelation: SensorStreamRelation | undefined;
}

export interface SearchState {
  error?: string;
  zip?: string;
  city?: string;
  state?: string;
  centerLat?: number;
  centerLon?: number;
  radiusMiles?: number;
  sensors?: MarketingSensor[];
}

/**
 * Real USGS data only. Upstream/downstream comes from NLDI's actual river-
 * network navigation (see findSensorsNearZip), not a guess from raw
 * coordinates. Flood-stage percentage is still deliberately absent here -
 * that needs a USGS-site-to-NWPS-lid mapping this app doesn't have yet.
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
    // network hiccup or outage shouldn't crash the page, just say so. Logged
    // server-side (visible in Render logs) since the friendly message on
    // its own gives no way to tell a timeout from a bad response from a
    // real outage.
    console.error("USGS site search failed:", error);
    return { error: "Couldn't reach USGS right now. Try again in a moment." };
  }

  const nearest = result.sensors.slice(0, MAX_RESULTS);
  if (nearest.length === 0) {
    return {
      zip,
      city: result.center.city,
      state: result.center.state,
      centerLat: result.center.lat,
      centerLon: result.center.lon,
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
  } catch (error) {
    // The site list itself is still good even if current readings failed -
    // show it without stage data rather than losing the whole search.
    console.error("USGS instantaneous-values lookup failed:", error);
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
    stageFt: latestBySite.get(sensor.siteNo)?.value,
    streamRelation: sensor.streamRelation,
  }));

  return {
    zip,
    city: result.center.city,
    state: result.center.state,
    centerLat: result.center.lat,
    centerLon: result.center.lon,
    radiusMiles: result.radiusMiles,
    sensors,
  };
}
