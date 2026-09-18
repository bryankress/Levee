import { runCatalogRefreshLoop } from "./catalogRefreshLoop";
import { runNwpsGaugeCacheRefreshLoop } from "./nwpsGaugeCacheRefreshLoop";
import { runCwmsLocationCacheRefreshLoop } from "./cwmsLocationCacheRefreshLoop";
import { runSensorFloodStageRefreshLoop } from "./sensorFloodStageRefreshLoop";
import { pollOnce } from "./pollOnce";

// USGS's own instantaneous-values cadence - polling faster wouldn't see new data.
const POLL_INTERVAL_MS = 15 * 60 * 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * A plain sequential loop, not setInterval: each poll is awaited before the
 * next is scheduled, so a slow sweep can never overlap itself and double-fire
 * notifications. If a sweep somehow runs long, the next one starts immediately
 * rather than stacking up a backlog.
 */
async function runForever(): Promise<void> {
  console.log(`[worker] starting - polling every ${POLL_INTERVAL_MS / 60_000} min`);

  for (;;) {
    const startedAt = Date.now();

    try {
      const summary = await pollOnce();
      console.log(`[worker] poll complete in ${Date.now() - startedAt}ms`, summary);
    } catch (error) {
      console.error("[worker] poll failed", error);
    }

    const elapsedMs = Date.now() - startedAt;
    await sleep(Math.max(0, POLL_INTERVAL_MS - elapsedMs));
  }
}

process.on("SIGTERM", () => {
  console.log("[worker] received SIGTERM, exiting");
  process.exit(0);
});

runForever();
runCatalogRefreshLoop();
runNwpsGaugeCacheRefreshLoop();
runCwmsLocationCacheRefreshLoop();
runSensorFloodStageRefreshLoop();
