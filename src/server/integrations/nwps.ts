// NOAA National Water Prediction Service (NWPS) - gauge metadata and stage/flow.
// Public, unauthenticated REST API. Docs: https://api.water.noaa.gov/nwps/v1/docs/
//
// parseGauge's shape is confirmed against a real production response (a
// full single-gauge fetch pulled from Render's shell, since api.water.noaa.gov
// is blocked from the dev sandbox that wrote this file). Confirmed correct:
// lid, usgsId (though it comes back as "" rather than absent for an
// unlinked gauge on this endpoint - handled below), name, latitude/
// longitude, and flood.categories.<action|minor|moderate|major>.stage.
// Confirmed *wrong*: there is no operator/agency/source field anywhere in
// the response (just rfc, wfo, state, county, reachId) - usgsId presence
// is the only signal this API gives for "is this a USGS site."
const NWPS_BASE_URL = "https://api.water.noaa.gov/nwps/v1";

export interface NwpsFloodCategories {
  action?: number;
  minor?: number;
  moderate?: number;
  major?: number;
}

export interface NwpsGauge {
  lid: string;
  usgsId?: string;
  name: string;
  /** Undefined when the response has no coordinates for this gauge - field name is a best guess, see fetchAllNwpsGauges. */
  lat?: number;
  lon?: number;
  floodCategories: NwpsFloodCategories;
}

export interface NwpsStageflowPoint {
  validTime: string;
  stageFt?: number;
  flowCfs?: number;
}

export async function fetchNwpsGauge(lid: string, signal?: AbortSignal): Promise<NwpsGauge> {
  const res = await fetch(`${NWPS_BASE_URL}/gauges/${encodeURIComponent(lid)}`, { signal });
  if (!res.ok) {
    throw new Error(`NWPS gauge request failed: ${res.status} ${res.statusText}`);
  }
  return parseGauge(await res.json());
}

export async function fetchNwpsStageflow(lid: string): Promise<NwpsStageflowPoint[]> {
  const res = await fetch(`${NWPS_BASE_URL}/gauges/${encodeURIComponent(lid)}/stageflow`);
  if (!res.ok) {
    throw new Error(`NWPS stageflow request failed: ${res.status} ${res.statusText}`);
  }
  return parseStageflow(await res.json());
}

/**
 * Fetches every gauge NWPS tracks in one call - the crosswalk source: a
 * gauge with a usgsId is the same physical site as one in UsgsSiteCache
 * (dedupe key), a gauge with none is a genuinely separate monitoring site
 * from another network - NWPS is a real multi-agency aggregator, and NOAA's
 * own docs specifically name the Army Corps of Engineers as a contributor
 * for central-US rivers and lakes.
 *
 * Confirmed against production: this returns ~12,900 gauges (a real
 * national list, not paginated/truncated) wrapped in a top-level "gauges"
 * array, with usable lid/usgsId/name/coordinates per entry. Also confirmed:
 * this bulk response does NOT include flood-category data at all (every
 * cached row's floodStages comes back empty) - only the single-gauge
 * fetchNwpsGauge endpoint carries that, which is why flood-stage relevance
 * (see nwpsCrosswalk.ts) is fetched lazily per-search instead of bulk-cached
 * here.
 */
export async function fetchAllNwpsGauges(signal?: AbortSignal): Promise<NwpsGauge[]> {
  const res = await fetch(`${NWPS_BASE_URL}/gauges`, { signal });
  if (!res.ok) {
    throw new Error(`NWPS gauges list request failed: ${res.status} ${res.statusText}`);
  }
  return parseGaugeList(await res.json());
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseGauge(body: any): NwpsGauge {
  const categories = body?.flood?.categories ?? {};
  return {
    lid: body?.lid,
    // Confirmed live: an unlinked gauge's usgsId comes back as "" on the
    // single-gauge endpoint, not absent - `||` (not `??`) so that empty
    // string is treated the same as null/undefined here too.
    usgsId: body?.usgsId || undefined,
    name: body?.name,
    lat: typeof body?.latitude === "number" ? body.latitude : undefined,
    lon: typeof body?.longitude === "number" ? body.longitude : undefined,
    floodCategories: {
      action: categories.action?.stage,
      minor: categories.minor?.stage,
      moderate: categories.moderate?.stage,
      major: categories.major?.stage,
    },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseGaugeList(body: any): NwpsGauge[] {
  const entries = Array.isArray(body) ? body : (body?.gauges ?? []);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return entries.map((entry: any) => parseGauge(entry)).filter((gauge: NwpsGauge) => typeof gauge.lid === "string");
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseStageflow(body: any): NwpsStageflowPoint[] {
  const points = body?.observed?.data ?? [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return points.map((point: any) => ({
    validTime: point.validTime,
    stageFt: point.primary,
    flowCfs: point.secondary,
  }));
}
