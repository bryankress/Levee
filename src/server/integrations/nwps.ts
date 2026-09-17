// NOAA National Water Prediction Service (NWPS) - gauge metadata and stage/flow.
// Public, unauthenticated REST API. Docs: https://api.water.noaa.gov/nwps/v1/docs/
//
// Field names below are the best-documented shape available from public search
// results at write time - api.water.noaa.gov itself was unreachable from this
// network to confirm directly. Treat parseGauge/parseStageflow as the one place
// to fix if a live response doesn't match.
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

export async function fetchNwpsGauge(lid: string): Promise<NwpsGauge> {
  const res = await fetch(`${NWPS_BASE_URL}/gauges/${encodeURIComponent(lid)}`);
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
 * NOT verified against a live response - api.water.noaa.gov is blocked by
 * this environment's egress policy (same as the *.usgs.gov domains during
 * the USGS OGC migration). The wrapper shape below (a top-level "gauges"
 * array) and the coordinate field names are a best guess, not a confirmed
 * fact - fix parseGaugeList here first if a live response doesn't match.
 * Also unconfirmed: whether this endpoint paginates for a full national
 * list - if a live run comes back suspiciously small, that's the first
 * thing to check.
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
    usgsId: body?.usgsId ?? undefined,
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
