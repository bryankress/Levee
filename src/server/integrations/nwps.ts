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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseGauge(body: any): NwpsGauge {
  const categories = body?.flood?.categories ?? {};
  return {
    lid: body?.lid,
    usgsId: body?.usgsId ?? undefined,
    name: body?.name,
    floodCategories: {
      action: categories.action?.stage,
      minor: categories.minor?.stage,
      moderate: categories.moderate?.stage,
      major: categories.major?.stage,
    },
  };
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
