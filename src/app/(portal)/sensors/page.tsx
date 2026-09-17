import type { Metadata } from "next";
import { getCurrentPerson } from "@/server/auth/currentPerson";
import { getPortalSensors, type PortalSensorDetail } from "@/server/dashboard/getPortalSensors";
import { formatRelativeTime } from "@/lib/time";
import { formatTrend, relationColor, severityOf, SEVERITY_LABEL, STREAM_RELATION_LABEL } from "@/lib/sensorDisplay";
import { AddSensorSearch } from "./AddSensorSearch";
import { KeywordSensorSearch } from "./KeywordSensorSearch";
import { SensorRowMenu } from "./SensorRowMenu";
import styles from "../portal.module.css";

export const metadata: Metadata = { title: "Sensors" };

const USGS_SITE_URL = (siteNo: string) => `https://waterdata.usgs.gov/monitoring-location/${siteNo}/`;

export default async function SensorsPage() {
  const person = await getCurrentPerson();
  if (!person) return null; // the layout already redirects; this satisfies the type checker

  const { levee, sensors, lastSyncedAt } = await getPortalSensors(person.orgId);

  return (
    <div>
      <div className={styles.pageHeader}>
        <div>
          <h1>Sensors</h1>
          {levee && <div className={styles.meta}>{levee.name}</div>}
          <div className={styles.sync}>
            {lastSyncedAt ? `USGS data synced ${formatRelativeTime(lastSyncedAt)}` : "No sensor data synced yet"}
          </div>
        </div>
      </div>

      {levee && (
        <div className={styles.sensorToolbar}>
          <AddSensorSearch existingSiteNos={sensors.map((sensor) => sensor.externalId)} />
          <KeywordSensorSearch existingSiteNos={sensors.map((sensor) => sensor.externalId)} />
        </div>
      )}

      {!levee ? (
        <div className={styles.panel}>
          <div className={styles.panelEmpty}>No levee is set up for this organization yet.</div>
        </div>
      ) : sensors.length === 0 ? (
        <div className={styles.panel}>
          <div className={styles.panelEmpty}>No sensors tracked yet.</div>
        </div>
      ) : (
        <div className={styles.panel}>
          <div className={styles.tableScroll}>
            <table className={styles.sensors}>
              <thead>
                <tr>
                  <th>Site</th>
                  <th>Stage</th>
                  <th>Discharge</th>
                  <th>% of flood stage</th>
                  <th>Trend</th>
                  <th>48h</th>
                  <th>Updated</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {sensors.map((sensor) => (
                  <SensorDetailRow key={sensor.id} sensor={sensor} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function SensorDetailRow({ sensor }: { sensor: PortalSensorDetail }) {
  const severity = severityOf(sensor.pctOfFloodStage);
  const trend = formatTrend(sensor.rateOfRiseFtPerHr);

  return (
    <tr>
      <td>
        {sensor.name && <span className={styles.siteName}>{sensor.name}</span>}
        <span className={styles.siteId}>{sensor.externalId}</span>
        {sensor.source === "USGS" && (
          <>
            {" "}
            <a
              className={styles.externalLink}
              href={USGS_SITE_URL(sensor.externalId)}
              target="_blank"
              rel="noreferrer"
            >
              USGS ↗
            </a>
          </>
        )}
        {sensor.streamRelation && (
          <div className={styles.sideTag}>
            <span className={styles.dot} style={{ background: relationColor(sensor.streamRelation) }} />
            {STREAM_RELATION_LABEL[sensor.streamRelation]}
          </div>
        )}
      </td>
      <td>
        <span className={styles.stageVal}>{sensor.stageFt !== undefined ? `${sensor.stageFt.toFixed(1)} ft` : "—"}</span>
      </td>
      <td>
        <span className={styles.stageVal}>
          {sensor.dischargeCfs !== undefined ? `${Math.round(sensor.dischargeCfs).toLocaleString()} cfs` : "—"}
        </span>
      </td>
      <td className={styles.meterCell}>
        {sensor.pctOfFloodStage !== undefined && severity ? (
          <>
            <div className={styles.meter}>
              <div
                className={styles.meterFill}
                style={{ width: `${Math.min(100, sensor.pctOfFloodStage)}%`, background: `var(--${severity})` }}
              />
            </div>
            <div className={styles.pctLabel}>
              <span>{sensor.pctOfFloodStage.toFixed(0)}%</span>
              <span style={{ color: `var(--${severity})` }}>{SEVERITY_LABEL[severity]}</span>
            </div>
          </>
        ) : (
          <span className={styles.updated}>No flood-stage data</span>
        )}
      </td>
      <td>
        <span className={styles.trend}>{trend ? `${trend.arrow} ${trend.text}` : "—"}</span>
      </td>
      <td>
        <Sparkline values={sensor.sparkline} />
      </td>
      <td className={styles.updated}>{formatRelativeTime(sensor.lastReadingAt)}</td>
      <td>
        <SensorRowMenu sensorId={sensor.id} sensorLabel={sensor.name || sensor.externalId} />
      </td>
    </tr>
  );
}

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return <span className={styles.updated}>—</span>;

  const width = 64;
  const height = 22;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const points = values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * width;
      const y = height - ((value - min) / range) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg
      className={styles.sparkline}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`Gage height trend over the last 48 hours, from ${min.toFixed(1)} to ${max.toFixed(1)} ft`}
    >
      <polyline points={points} fill="none" stroke="var(--accent)" strokeWidth="1.5" />
    </svg>
  );
}
