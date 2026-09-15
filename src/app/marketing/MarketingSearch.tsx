"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import type { SensorStreamRelation } from "@/server/discovery/sensorSearch";
import { searchSensorsAction, type MarketingSensor, type SearchState } from "./actions";
import styles from "./marketing.module.css";

const initialState: SearchState = {};

const RELATION_LABEL: Record<SensorStreamRelation, string> = {
  UPSTREAM: "Upstream",
  DOWNSTREAM: "Downstream",
};

function relationColor(relation: SensorStreamRelation | undefined): string {
  if (relation === "UPSTREAM") return "var(--brass)";
  if (relation === "DOWNSTREAM") return "var(--accent)";
  return "var(--ink-soft)";
}

export function MarketingSearch() {
  const [state, formAction, pending] = useActionState(searchSensorsAction, initialState);
  const [selected, setSelected] = useState<Map<string, MarketingSensor>>(new Map());
  const router = useRouter();

  const sensors = state.sensors ?? [];
  const radiusMiles = state.radiusMiles ?? 100;

  function toggleSensor(sensor: MarketingSensor) {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(sensor.siteNo)) {
        next.delete(sensor.siteNo);
      } else {
        next.set(sensor.siteNo, sensor);
      }
      return next;
    });
  }

  function goToSignup() {
    const params = new URLSearchParams();
    if (state.zip) params.set("zip", state.zip);
    params.set("sites", JSON.stringify(Array.from(selected.values())));
    router.push(`/signup?${params.toString()}`);
  }

  return (
    <div className={styles.searchBlock}>
      <form action={formAction} className={styles.zipForm}>
        <input
          className={styles.zipInput}
          name="zip"
          inputMode="numeric"
          pattern="\d{5}"
          maxLength={5}
          placeholder="ZIP code"
          aria-label="ZIP code"
          required
        />
        <button className={styles.zipSubmit} type="submit" disabled={pending}>
          {pending ? "Searching…" : "Find gauges"}
        </button>
      </form>

      {state.error && (
        <p className={styles.error} role="alert">
          {state.error}
        </p>
      )}

      {state.sensors && (
        <div className={styles.results}>
          <p className={styles.resultsMeta}>
            {sensors.length === 0
              ? `No active USGS stream gauges within ${radiusMiles} miles of ${state.city}, ${state.state}.`
              : `${sensors.length} active USGS stream gauge${sensors.length === 1 ? "" : "s"} within ${radiusMiles} miles of ${state.city}, ${state.state} — nearest first, live from USGS.`}
          </p>

          {sensors.length > 0 && (
            <>
              <RadialMap sensors={sensors} radiusMiles={radiusMiles} selected={selected} onToggle={toggleSensor} />

              <ul className={styles.sensorList}>
                {sensors.map((sensor) => (
                  <li key={sensor.siteNo} className={styles.sensorRow}>
                    <label className={styles.sensorLabel}>
                      <input
                        type="checkbox"
                        checked={selected.has(sensor.siteNo)}
                        onChange={() => toggleSensor(sensor)}
                      />
                      <span className={styles.sensorNameCol}>
                        <span className={styles.sensorName}>{sensor.name || sensor.siteNo}</span>
                        {sensor.streamRelation && (
                          <span className={styles.relationTag}>
                            <span className={styles.relationDot} style={{ background: relationColor(sensor.streamRelation) }} />
                            {RELATION_LABEL[sensor.streamRelation]}
                          </span>
                        )}
                      </span>
                      <span className={styles.sensorMeta}>
                        {sensor.distanceMiles.toFixed(1)} mi
                        {sensor.stageFt !== undefined && ` · ${sensor.stageFt.toFixed(1)} ft gage height`}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {selected.size > 0 && (
        <div className={styles.tray}>
          <div className={styles.trayText}>
            {selected.size} sensor{selected.size === 1 ? "" : "s"} selected
          </div>
          <button className={styles.traySubmit} type="button" onClick={goToSignup}>
            Sign up to monitor these
          </button>
        </div>
      )}
    </div>
  );
}

function RadialMap({
  sensors,
  radiusMiles,
  selected,
  onToggle,
}: {
  sensors: MarketingSensor[];
  radiusMiles: number;
  selected: Map<string, MarketingSensor>;
  onToggle: (sensor: MarketingSensor) => void;
}) {
  const size = 280;
  const center = size / 2;
  const maxR = center - 16;

  return (
    <svg
      className={styles.radial}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label="Sensor positions relative to your ZIP code, nearer sensors closer to the center"
    >
      <circle cx={center} cy={center} r={maxR} className={styles.radialRing} />
      <circle cx={center} cy={center} r={maxR * 0.5} className={styles.radialRing} />
      <circle cx={center} cy={center} r={3} className={styles.radialCenter} />

      {sensors.map((sensor) => {
        const r = Math.min(1, sensor.distanceMiles / radiusMiles) * maxR;
        const angle = (sensor.bearingDeg * Math.PI) / 180;
        const x = center + r * Math.sin(angle);
        const y = center - r * Math.cos(angle);
        const isSelected = selected.has(sensor.siteNo);

        return (
          <g
            key={sensor.siteNo}
            transform={`translate(${x}, ${y})`}
            className={styles.radialDot}
            onClick={() => onToggle(sensor)}
            tabIndex={0}
            role="button"
            aria-pressed={isSelected}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") onToggle(sensor);
            }}
          >
            <circle
              r={isSelected ? 6.5 : 4.5}
              style={{ fill: relationColor(sensor.streamRelation) }}
              className={isSelected ? styles.radialDotSelected : undefined}
            />
            <title>
              {sensor.name} — {sensor.streamRelation ? `${RELATION_LABEL[sensor.streamRelation]}, ` : ""}
              {sensor.distanceMiles.toFixed(1)} mi
              {sensor.stageFt !== undefined ? ` — ${sensor.stageFt.toFixed(1)} ft` : ""}
            </title>
          </g>
        );
      })}
    </svg>
  );
}
