import { refreshSensorFloodStages } from "@/server/discovery/sensorFloodStageRefresh";

// A courtesy cadence, not a freshness requirement - see
// sensorFloodStageRefresh.ts for why NWS-revised thresholds are rare. Runs
// immediately on every worker start (not gated behind a staleness check
// like the larger NWPS/CWMS/USGS catalog refreshes) since this scans only
// currently-claimed sensors - a small, cheap dataset - and an immediate
// first pass is also how any sensor claimed before this refresh existed
// gets backfilled.
const REFRESH_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000;
const RETRY_AFTER_ERROR_MS = 60 * 60 * 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runSensorFloodStageRefreshLoop(): Promise<void> {
  for (;;) {
    let nextDelayMs = REFRESH_INTERVAL_MS;

    try {
      const summary = await refreshSensorFloodStages();
      console.log("[worker] sensor flood-stage refresh complete", summary);
      if (summary.sensorsChecked > 0 && summary.sensorsUpdated === 0) {
        nextDelayMs = RETRY_AFTER_ERROR_MS;
      }
    } catch (error) {
      console.error("[worker] sensor flood-stage refresh failed", error);
      nextDelayMs = RETRY_AFTER_ERROR_MS;
    }

    await sleep(nextDelayMs);
  }
}
