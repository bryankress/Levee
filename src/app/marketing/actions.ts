"use server";

import { findSensorsNearZip, UnknownZipError, type SensorStreamRelation } from "@/server/discovery/sensorSearch";
import { fetchUsgsInstantaneousValues, USGS_PARAM_CODES, type UsgsReading } from "@/server/integrations/usgs";
import { MAX_SEARCH_RADIUS_MILES, MIN_SEARCH_RADIUS_MILES } from "./searchConfig";

const MAX_RESULTS = 30;
const DEFAULT_SEARCH_RADIUS_MILES = MIN_SEARCH_RADIUS_MILES;
// A real last-resort cap, not the expected case - the client shows its own
// "still searching" notice well before this (see SLOW_SEARCH_MS in
// MarketingSearch.tsx) while the request keeps running, so this only needs
// to fire for a genuinely stuck request, not an ordinarily slow one.
const SEARCH_TIMEOUT_MS = 60_000;

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

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
function parseRadiusMiles(raw: FormDataEntryValue | null): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_SEARCH_RADIUS_MILES;
  return Math.min(MAX_SEARCH_RADIUS_MILES, Math.max(MIN_SEARCH_RADIUS_MILES, parsed));
}

export async function searchSensorsAction(_prevState: SearchState, formData: FormData): Promise<SearchState> {
  const zip = String(formData.get("zip") ?? "").trim();
  if (!/^\d{5}$/.test(zip)) {
    return { error: "Enter a 5-digit ZIP code." };
  }
  // Clamped server-side regardless of what the client's slider sent - never
  // trust a client-supplied number to be within the range the UI offers.
  const radiusMiles = parseRadiusMiles(formData.get("radiusMiles"));

  // A single budget for the whole search (site lookup + readings combined),
  // not per-fetch - aborting actually cancels the in-flight request instead
  // of just giving up on waiting for it, so a slow USGS/NLDI call doesn't
  // keep running in the background after the user's been told it failed.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);

  try {
    let result;
    try {
      result = await findSensorsNearZip(zip, radiusMiles, controller.signal);
    } catch (error) {
      if (error instanceof UnknownZipError) {
        return { error: "That ZIP code isn't recognized." };
      }
      if (isAbortError(error)) {
        return { error: "USGS isn't responding. Please try again in a few minutes." };
      }
      // USGS is a real third-party service on the critical path here - a
      // network hiccup or outage shouldn't crash the page, just say so.
      // Logged server-side (visible in Render logs) since the friendly
      // message on its own gives no way to tell a bad response from a real
      // outage.
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
        controller.signal,
      );
    } catch (error) {
      if (isAbortError(error)) {
        return { error: "USGS isn't responding. Please try again in a few minutes." };
      }
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
  } finally {
    clearTimeout(timeoutId);
  }
}
