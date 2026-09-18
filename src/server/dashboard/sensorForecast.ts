import { prisma } from "@/server/db/client";
import { fetchNwpsStageflow, type NwpsStageflowPoint } from "@/server/integrations/nwps";

// A single gauge's live forecast fetch shouldn't be allowed to stall the
// whole portal page - same reasoning as findFloodStagesForSiteNos's
// PER_GAUGE_TIMEOUT_MS in nwpsCrosswalk.ts.
const PER_GAUGE_TIMEOUT_MS = 5_000;

// Forecasts update far more often than flood-stage thresholds (which are
// fixed NWS reference values) - a short TTL keeps the portal page from
// re-fetching NOAA on every single request while still staying reasonably
// current within one viewing session.
const CACHE_TTL_MS = 15 * 60 * 1000;

export interface SensorForecast {
  crestStageFt: number | undefined;
  crestAt: Date | undefined;
  /** First forecast point at or above the sensor's own NWPS action stage - undefined when there's no threshold to compare against, or the forecast never reaches it. */
  reachesActionStageAt: Date | undefined;
}

interface CacheEntry {
  expiresAt: number;
  forecast: SensorForecast;
}

// Keyed by NWPS lid, not usgsId - the forecast itself doesn't depend on
// which sensor asked for it, so it can be shared across orgs/requests.
const forecastCache = new Map<string, CacheEntry>();

/**
 * NWS's own predicted stage/flow for whichever of the given USGS site
 * numbers NWPS covers - same lazy, per-request crosswalk pattern as
 * findFloodStagesForSiteNos in nwpsCrosswalk.ts, but reading the
 * "forecast" half of the stageflow endpoint instead of the single-gauge
 * flood-category endpoint, and cached briefly in memory instead of
 * written back to Postgres (this data goes stale in hours, not months).
 *
 * The forecast schema here (validTime/primary/secondary under a top-level
 * "forecast" key, mirroring "observed") is inferred from NWPS's own docs
 * description ("returns observed and forecast stage/flow data") and the
 * shape of the already-confirmed "observed" key - it has NOT yet been
 * confirmed against a live response, since api.water.noaa.gov is blocked
 * from the sandbox that wrote this. Needs a live check after deploy.
 *
 * A gauge whose live fetch fails, times out, or simply has no forecast
 * data is left out of the result - same "just don't show it this time"
 * failure isolation as everywhere else this session.
 */
export async function findForecastsForSiteNos(
  siteNos: string[],
  actionStageFtBySiteNo: Map<string, number>,
  signal?: AbortSignal,
): Promise<Map<string, SensorForecast>> {
  if (siteNos.length === 0) return new Map();

  const matches = await prisma.nwpsGaugeCache.findMany({
    where: { usgsId: { in: siteNos } },
    select: { lid: true, usgsId: true },
  });

  const result = new Map<string, SensorForecast>();
  const toFetch: { lid: string; usgsId: string }[] = [];
  const now = Date.now();
  for (const match of matches) {
    if (!match.usgsId) continue;
    const cached = forecastCache.get(match.lid);
    if (cached && cached.expiresAt > now) {
      result.set(match.usgsId, cached.forecast);
    } else {
      toFetch.push({ lid: match.lid, usgsId: match.usgsId });
    }
  }

  const fetched = await Promise.allSettled(
    toFetch.map(async ({ lid, usgsId }) => {
      const timeoutSignal = AbortSignal.timeout(PER_GAUGE_TIMEOUT_MS);
      const gaugeSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
      const { forecast } = await fetchNwpsStageflow(lid, gaugeSignal);
      const derived = deriveForecast(forecast, actionStageFtBySiteNo.get(usgsId));
      return { lid, usgsId, derived };
    }),
  );

  for (const settled of fetched) {
    if (settled.status !== "fulfilled") continue;
    const { lid, usgsId, derived } = settled.value;
    forecastCache.set(lid, { expiresAt: now + CACHE_TTL_MS, forecast: derived });
    result.set(usgsId, derived);
  }

  return result;
}

function deriveForecast(points: NwpsStageflowPoint[], actionStageFt: number | undefined): SensorForecast {
  let crest: NwpsStageflowPoint | undefined;
  for (const point of points) {
    if (point.stageFt === undefined) continue;
    if (!crest || point.stageFt > (crest.stageFt as number)) crest = point;
  }

  let reachesActionStageAt: Date | undefined;
  if (actionStageFt !== undefined) {
    const firstCrossing = points.find((point) => point.stageFt !== undefined && point.stageFt >= actionStageFt);
    reachesActionStageAt = firstCrossing ? new Date(firstCrossing.validTime) : undefined;
  }

  return {
    crestStageFt: crest?.stageFt,
    crestAt: crest ? new Date(crest.validTime) : undefined,
    reachesActionStageAt,
  };
}
