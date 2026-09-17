"use server";

import {
  findSensorsNearZip,
  UnknownZipError,
  type SensorDiscoverySource,
  type SensorStreamRelation,
} from "@/server/discovery/sensorSearch";
import { getCachedSearch, setCachedSearch } from "@/server/discovery/searchResultCache";
import { fetchUsgsInstantaneousValues, USGS_PARAM_CODES, type UsgsReading } from "@/server/integrations/usgs";
import { MAX_SEARCH_RADIUS_MILES, MIN_SEARCH_RADIUS_MILES } from "@/lib/searchConfig";

const MAX_RESULTS = 100;
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
  source: SensorDiscoverySource;
  /** CWMS only: the USACE district office that owns this location (e.g. "MVR"). */
  officeId: string | undefined;
  /** CWMS only: CWMS's own raw location-kind label (e.g. "PROJECT", "EMBANKMENT"). */
  locationKind: string | undefined;
  /** Latest USGS gage-height reading, in feet - undefined when the site has no current reading, and always undefined for a CWMS entry (discovery-only, no readings integration yet). */
  stageFt: number | undefined;
  /** Raw USGS timestamp (with the station's own UTC offset) for stageFt - undefined exactly when stageFt is. */
  stageObservedAt: string | undefined;
  /** Real upstream/downstream classification from NLDI's river-network navigation - undefined, not guessed, when NLDI can't place this gauge on the search point's network. */
  streamRelation: SensorStreamRelation | undefined;
  /** UPSTREAM only: true when on the mainstem itself rather than only a tributary - undefined when unknown (downstream, or the mainstem check itself failed), not "confirmed tributary-only." */
  isMainstem: boolean | undefined;
  /** True when NOAA NWPS has a real, official flood-stage threshold defined for this gauge. */
  hasFloodStage: boolean;
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
  /** True when more active sensors exist within radiusMiles than MAX_RESULTS shows - the count below is a cap, not the exhaustive total. */
  truncated?: boolean;
}

/**
 * Real data only, from two independent sources (see SensorDiscoverySource):
 * USGS gauges (with live readings) and, discovery-only, nearby USACE CWMS
 * locations (see findSensorsNearZip) - never guessed or merged into one
 * fabricated identity. Upstream/downstream comes from NLDI's actual river-
 * network navigation, USGS only. hasFloodStage flags whether NOAA NWPS has
 * an official threshold defined for a gauge (via the local crosswalk cache -
 * see nwpsCrosswalk.ts) but still doesn't show the current reading's actual
 * percentage of that threshold - that needs the reading and the threshold
 * compared together, not just their both existing.
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

  // A repeat search for the same zip+radius within the cache's TTL skips
  // USGS/NLDI entirely - see searchResultCache.ts for why this is safe.
  // Errors are never cached, so a real outage doesn't get "stuck" for
  // everyone until the TTL expires - the next searcher gets a fresh attempt.
  const cacheKey = `${zip}:${radiusMiles}`;
  const cached = getCachedSearch<SearchState>(cacheKey);
  if (cached) return cached;

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
    const truncated = result.sensors.length > MAX_RESULTS;
    if (nearest.length === 0) {
      const empty: SearchState = {
        zip,
        city: result.center.city,
        state: result.center.state,
        centerLat: result.center.lat,
        centerLon: result.center.lon,
        radiusMiles: result.radiusMiles,
        sensors: [],
        truncated: false,
      };
      setCachedSearch(cacheKey, empty);
      return empty;
    }

    let readings: UsgsReading[];
    try {
      readings = await fetchUsgsInstantaneousValues(
        nearest.filter((sensor) => sensor.source === "USGS").map((sensor) => sensor.siteNo),
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
      source: sensor.source,
      officeId: sensor.officeId,
      locationKind: sensor.locationKind,
      stageFt: latestBySite.get(sensor.siteNo)?.value,
      stageObservedAt: latestBySite.get(sensor.siteNo)?.timestamp,
      streamRelation: sensor.streamRelation,
      isMainstem: sensor.isMainstem,
      hasFloodStage: sensor.hasFloodStage,
    }));

    const found: SearchState = {
      zip,
      city: result.center.city,
      state: result.center.state,
      centerLat: result.center.lat,
      centerLon: result.center.lon,
      radiusMiles: result.radiusMiles,
      sensors,
      truncated,
    };
    setCachedSearch(cacheKey, found);
    return found;
  } finally {
    clearTimeout(timeoutId);
  }
}
