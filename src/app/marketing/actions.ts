"use server";

import { findRankedSensorsNearZip, UnknownZipError, type RankedSensor } from "@/server/discovery/rankedSensorSearch";
import { getCachedSearch, setCachedSearch } from "@/server/discovery/searchResultCache";
import { MAX_SEARCH_RADIUS_MILES, MIN_SEARCH_RADIUS_MILES } from "@/lib/searchConfig";

const DEFAULT_SEARCH_RADIUS_MILES = MIN_SEARCH_RADIUS_MILES;
// A real last-resort cap, not the expected case - the client shows its own
// "still searching" notice well before this (see SLOW_SEARCH_MS in
// SensorSearchPanel.tsx) while the request keeps running, so this only needs
// to fire for a genuinely stuck request, not an ordinarily slow one.
const SEARCH_TIMEOUT_MS = 60_000;

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

/**
 * Kept as an alias (not a fresh type) so the portal's "Graphical Search"
 * (AddSensorSearch.tsx / SensorSearchPanel.tsx) - the one remaining caller
 * of this search UI now that the marketing landing page no longer has an
 * interactive search of its own - doesn't need to change its imports.
 */
export type MarketingSensor = RankedSensor;

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

function parseRadiusMiles(raw: FormDataEntryValue | null): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_SEARCH_RADIUS_MILES;
  return Math.min(MAX_SEARCH_RADIUS_MILES, Math.max(MIN_SEARCH_RADIUS_MILES, parsed));
}

/**
 * The form-submission entry point for the portal's "Graphical Search" - a
 * thin wrapper (parsing, caching, error messages) around the shared
 * zip-to-sensor pipeline in rankedSensorSearch.ts, which the automatic
 * post-signup background search (signup/autoPopulateSensors.ts) also calls
 * directly, without going through a form at all.
 */
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
      result = await findRankedSensorsNearZip(zip, radiusMiles, controller.signal);
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

    const found: SearchState = {
      zip,
      city: result.center.city,
      state: result.center.state,
      centerLat: result.center.lat,
      centerLon: result.center.lon,
      radiusMiles: result.radiusMiles,
      sensors: result.sensors,
      truncated: result.truncated,
    };
    setCachedSearch(cacheKey, found);
    return found;
  } finally {
    clearTimeout(timeoutId);
  }
}
