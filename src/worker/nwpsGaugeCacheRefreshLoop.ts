import { prisma } from "@/server/db/client";
import { refreshNwpsGaugeCache } from "@/server/discovery/nwpsGaugeCacheRefresh";

// Same cadence reasoning as the USGS site catalog: NWPS's own gauge network
// and flood-stage thresholds change on the order of months, not days.
const MIN_REFRESH_INTERVAL_DAYS = 30;
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
// Same reasoning as catalogRefreshLoop's RETRY_AFTER_ERROR_MS - a transient
// failure right after a fresh deploy (e.g. the table not existing yet for a
// few moments) shouldn't strand the cache unsynced until the next calendar day.
const RETRY_AFTER_ERROR_MS = 5 * 60 * 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function isCacheStale(): Promise<boolean> {
  const result = await prisma.nwpsGaugeCache.aggregate({ _max: { syncedAt: true } });
  const lastSync = result._max.syncedAt;
  if (!lastSync) return true; // never synced - e.g. right after a fresh deploy
  const ageDays = (Date.now() - lastSync.getTime()) / 86_400_000;
  return ageDays >= MIN_REFRESH_INTERVAL_DAYS;
}

export async function runNwpsGaugeCacheRefreshLoop(): Promise<void> {
  for (;;) {
    let nextDelayMs = CHECK_INTERVAL_MS;

    try {
      if (await isCacheStale()) {
        console.log("[worker] NWPS gauge cache is stale, refreshing...");
        const startedAt = Date.now();
        const summary = await refreshNwpsGaugeCache();
        console.log(`[worker] NWPS gauge cache refresh complete in ${Date.now() - startedAt}ms`, summary);
        if (summary.aborted) nextDelayMs = RETRY_AFTER_ERROR_MS;
      }
    } catch (error) {
      console.error("[worker] NWPS gauge cache refresh check failed", error);
      nextDelayMs = RETRY_AFTER_ERROR_MS;
    }

    await sleep(nextDelayMs);
  }
}
