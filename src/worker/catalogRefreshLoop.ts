import { prisma } from "@/server/db/client";
import { refreshUsgsSiteCatalog } from "@/server/discovery/siteCatalogRefresh";

// The catalog only needs to be this fresh - real gauge networks change on
// the order of months, not days.
const MIN_REFRESH_INTERVAL_DAYS = 30;
// A day is plenty granular for a monthly job; this just needs to notice
// "it's been a month" sometime soon after it actually has been, not to the
// minute. Kept separate from pollOnce's 15-minute sensor loop on purpose -
// a refresh here takes minutes (dozens of paced USGS calls), and nothing
// about flood-alert timeliness should ever wait on it.
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function isCatalogStale(): Promise<boolean> {
  const result = await prisma.usgsSiteCache.aggregate({ _max: { syncedAt: true } });
  const lastSync = result._max.syncedAt;
  if (!lastSync) return true; // never synced - e.g. right after a fresh deploy
  const ageDays = (Date.now() - lastSync.getTime()) / 86_400_000;
  return ageDays >= MIN_REFRESH_INTERVAL_DAYS;
}

export async function runCatalogRefreshLoop(): Promise<void> {
  for (;;) {
    try {
      if (await isCatalogStale()) {
        console.log("[worker] USGS site catalog is stale, refreshing...");
        const startedAt = Date.now();
        const summary = await refreshUsgsSiteCatalog();
        console.log(`[worker] site catalog refresh complete in ${Date.now() - startedAt}ms`, summary);
      }
    } catch (error) {
      console.error("[worker] site catalog refresh check failed", error);
    }

    await sleep(CHECK_INTERVAL_MS);
  }
}
