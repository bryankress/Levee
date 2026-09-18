import type { PortalSensorDetail } from "@/server/dashboard/getPortalSensors";
import { formatRelativeTime } from "@/lib/time";
import { formatTrend, SEVERITY_LABEL, type Severity } from "@/lib/sensorDisplay";
import styles from "../portal.module.css";

interface WatchItem {
  id: string;
  label: string;
  severity: Severity;
  qualifier: string | undefined;
  trend: { arrow: string; text: string } | undefined;
  forecastLine: string;
}

/**
 * A glanceable "what needs attention, and roughly when" summary above the
 * full sensor table below - the table already shows every sensor's current
 * numbers, but doesn't answer "which of these actually matter right now"
 * or "how much time do I have." This surfaces only the sensors worth a
 * second look: elevated/high on either the official flood-stage signal or
 * the historical-percentile fallback, or forecast to reach their own
 * action stage even if they haven't yet - so a levee admin sees rising
 * threats before they cross into "elevated" on the table itself.
 */
export function WatchPanel({ sensors }: { sensors: PortalSensorDetail[] }) {
  const items = sensors.map(buildWatchItem).filter((item): item is WatchItem => item !== undefined);

  return (
    <div className={styles.panel} style={{ marginBottom: 22 }}>
      <div className={styles.panelHead}>
        <h2>Watch</h2>
      </div>
      {items.length === 0 ? (
        <div className={styles.panelEmpty}>
          Nothing elevated and no forecast concerns right now — all tracked sensors normal.
        </div>
      ) : (
        <div className={styles.list}>
          {items.map((item) => (
            <div key={item.id} className={styles.listItem}>
              <div>
                <div className={styles.title}>{item.label}</div>
                <div className={styles.when}>
                  {item.forecastLine}
                  {item.trend && ` · ${item.trend.arrow} ${item.trend.text}`}
                </div>
              </div>
              <span className={styles.tagPill} style={{ background: "transparent", color: `var(--${item.severity})` }}>
                {SEVERITY_LABEL[item.severity]}
                {item.qualifier ? ` (${item.qualifier})` : ""}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function buildWatchItem(sensor: PortalSensorDetail): WatchItem | undefined {
  const officialSeverity =
    sensor.pctOfFloodStage !== undefined
      ? sensor.pctOfFloodStage >= 90
        ? "high"
        : sensor.pctOfFloodStage >= 70
          ? "elevated"
          : "good"
      : undefined;

  const severity: Severity | undefined = officialSeverity ?? sensor.historicalSeverity?.severity;
  const isNoteworthySeverity = severity === "elevated" || severity === "high";
  const isRisingTowardThreshold = sensor.forecast?.reachesActionStageAt !== undefined;

  if (!isNoteworthySeverity && !isRisingTowardThreshold) return undefined;

  return {
    id: sensor.id,
    label: sensor.name || sensor.externalId,
    severity: severity ?? "elevated",
    qualifier: officialSeverity === undefined && sensor.historicalSeverity ? "vs. own history, no official threshold" : undefined,
    trend: formatTrend(sensor.rateOfRiseFtPerHr),
    forecastLine: forecastLine(sensor),
  };
}

function forecastLine(sensor: PortalSensorDetail): string {
  const forecast = sensor.forecast;
  if (forecast?.reachesActionStageAt) {
    return `Forecast to reach action stage ${formatRelativeTime(forecast.reachesActionStageAt)}`;
  }
  if (forecast?.crestStageFt !== undefined && forecast.crestAt) {
    return `Expected to crest at ${forecast.crestStageFt.toFixed(1)} ft ${formatRelativeTime(forecast.crestAt)}`;
  }
  return "No forecast available for this gauge";
}
