import { prisma } from "@/server/db/client";
import { refreshCwmsLocationCache } from "@/server/discovery/cwmsLocationCacheRefresh";

// Same cadence reasoning as the USGS site catalog and NWPS gauge cache:
// USACE's district/location catalog changes on the order of months, not days.
const MIN_REFRESH_INTERVAL_DAYS = 30;
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const RETRY_AFTER_ERROR_MS = 5 * 60 * 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function isCacheStale(): Promise<boolean> {
  const result = await prisma.cwmsLocationCache.aggregate({ _max: { syncedAt: true } });
  const lastSync = result._max.syncedAt;
  if (!lastSync) return true; // never synced - e.g. right after a fresh deploy
  const ageDays = (Date.now() - lastSync.getTime()) / 86_400_000;
  return ageDays >= MIN_REFRESH_INTERVAL_DAYS;
}

export async function runCwmsLocationCacheRefreshLoop(): Promise<void> {
  for (;;) {
    let nextDelayMs = CHECK_INTERVAL_MS;

    try {
      if (await isCacheStale()) {
        console.log("[worker] CWMS location cache is stale, refreshing...");
        const startedAt = Date.now();
        const summary = await refreshCwmsLocationCache();
        console.log(`[worker] CWMS location cache refresh complete in ${Date.now() - startedAt}ms`, summary);
        if (summary.aborted) nextDelayMs = RETRY_AFTER_ERROR_MS;
      }
    } catch (error) {
      console.error("[worker] CWMS location cache refresh check failed", error);
      nextDelayMs = RETRY_AFTER_ERROR_MS;
    }

    await sleep(nextDelayMs);
  }
}
