import { getCurrentPerson } from "@/server/auth/currentPerson";
import { getPortalHome, type PortalSensorRow } from "@/server/dashboard/getPortalHome";
import { formatEventWhen, formatRelativeTime } from "@/lib/time";
import { EVENT_TYPE_LABEL } from "@/lib/eventDisplay";
import { formatTrend, relationColor, severityOf, SEVERITY_LABEL, STREAM_RELATION_LABEL } from "@/lib/sensorDisplay";
import styles from "./portal.module.css";

export default async function PortalHomePage() {
  const person = await getCurrentPerson();
  if (!person) return null; // the layout already redirects; this satisfies the type checker

  const data = await getPortalHome(person.orgId);

  if (!data.levee) {
    return (
      <div>
        <div className={styles.pageHeader}>
          <h1>Welcome to Levee Buddy</h1>
        </div>
        <div className={styles.panel}>
          <div className={styles.panelEmpty}>No levee is set up for this organization yet.</div>
        </div>
      </div>
    );
  }

  const {
    levee,
    sensors,
    criticalSensor,
    upcomingEvents,
    daysToNextEvent,
    personnelPreview,
    teamMemberCount,
    documentCount,
    lastSyncedAt,
  } = data;

  return (
    <div>
      <div className={styles.pageHeader}>
        <div>
          <h1>{levee.name}</h1>
          {(levee.address || levee.riverName) && (
            <div className={styles.meta}>
              {[levee.address, levee.riverName].filter(Boolean).join(" · ")}
            </div>
          )}
          <div className={styles.sync}>
            {lastSyncedAt ? `USGS/NWS data synced ${formatRelativeTime(lastSyncedAt)}` : "No sensor data synced yet"}
          </div>
        </div>
      </div>

      {criticalSensor && (
        <div className={styles.alert}>
          <div className={styles.stripe} />
          <div>
            Sensor <b>{criticalSensor.name || criticalSensor.externalId}</b>
            {criticalSensor.streamRelation && ` (${STREAM_RELATION_LABEL[criticalSensor.streamRelation].toLowerCase()})`} is at{" "}
            <b>{criticalSensor.pctOfFloodStage?.toFixed(0)}% of flood stage</b>
            {criticalSensor.lastReadingAt && ` — last checked ${formatRelativeTime(criticalSensor.lastReadingAt)}`}.
          </div>
        </div>
      )}

      <div className={styles.kpiRow}>
        <div className={styles.kpi}>
          <div className={styles.num}>{sensors.length}</div>
          <div className={styles.label}>Sensors tracked</div>
        </div>
        <div className={styles.kpi}>
          <div className={styles.num}>{teamMemberCount}</div>
          <div className={styles.label}>Team members</div>
        </div>
        <div className={styles.kpi}>
          <div className={styles.num}>{documentCount}</div>
          <div className={styles.label}>Documents on file</div>
        </div>
        <div className={styles.kpi}>
          <div className={styles.num}>{daysToNextEvent ?? "—"}</div>
          <div className={styles.label}>Days to next event</div>
        </div>
      </div>

      <div className={styles.grid2}>
        <div className={styles.panel}>
          <div className={styles.panelHead}>
            <h2>Tracked sensors</h2>
          </div>
          {sensors.length === 0 ? (
            <div className={styles.panelEmpty}>No sensors tracked yet.</div>
          ) : (
            <table className={styles.sensors}>
              <thead>
                <tr>
                  <th>Site</th>
                  <th>Stage</th>
                  <th>% of flood stage</th>
                  <th>Trend</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {sensors.map((sensor) => (
                  <SensorRow key={sensor.id} sensor={sensor} />
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className={styles.sideCol}>
          <div className={styles.panel}>
            <div className={styles.panelHead}>
              <h2>Upcoming</h2>
            </div>
            {upcomingEvents.length === 0 ? (
              <div className={styles.panelEmpty}>Nothing scheduled.</div>
            ) : (
              <div className={styles.list}>
                {upcomingEvents.map((event) => (
                  <div key={event.id} className={styles.listItem}>
                    <div>
                      <div className={styles.title}>{EVENT_TYPE_LABEL[event.type]}</div>
                      <div className={styles.when}>{formatEventWhen(event.startsAt)}</div>
                    </div>
                    <span className={styles.tagPill}>{EVENT_TYPE_LABEL[event.type]}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className={styles.panel}>
            <div className={styles.panelHead}>
              <h2>Personnel</h2>
            </div>
            {personnelPreview.length === 0 ? (
              <div className={styles.panelEmpty}>No one on the roster yet.</div>
            ) : (
              <div className={styles.list}>
                {personnelPreview.map((preview) => (
                  <div key={preview.id} className={styles.personRow}>
                    <span>{preview.name}</span>
                    <span className={styles.personRole}>{preview.role === "ADMIN" ? "Admin" : "Member"}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SensorRow({ sensor }: { sensor: PortalSensorRow }) {
  const severity = severityOf(sensor.pctOfFloodStage);

  return (
    <tr>
      <td>
        {sensor.name && <span className={styles.siteName}>{sensor.name}</span>}
        <span className={styles.siteId}>{sensor.externalId}</span>
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
        <TrendCell rate={sensor.rateOfRiseFtPerHr} />
      </td>
      <td className={styles.updated}>{formatRelativeTime(sensor.lastReadingAt)}</td>
    </tr>
  );
}

function TrendCell({ rate }: { rate: number | undefined }) {
  const trend = formatTrend(rate);
  if (!trend) return <span className={styles.trend}>—</span>;
  return (
    <span className={styles.trend}>
      {trend.arrow} {trend.text}
    </span>
  );
}
