"use client";

import { useMemo, useState, useTransition } from "react";
import { SensorSearchPanel } from "@/components/sensorSearch/SensorSearchPanel";
import panelStyles from "@/components/sensorSearch/sensorSearch.module.css";
import type { MarketingSensor } from "@/app/marketing/actions";
import { addSensorsAction, type AddSensorInput } from "./actions";
import styles from "./addSensorSearch.module.css";

export function AddSensorSearch({ existingSiteNos }: { existingSiteNos: string[] }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Map<string, MarketingSensor>>(new Map());
  const [error, setError] = useState<string | undefined>(undefined);
  const [addedNotice, setAddedNotice] = useState<string | undefined>(undefined);
  const [pending, startTransition] = useTransition();

  const ownedSet = useMemo(() => new Set(existingSiteNos), [existingSiteNos]);

  function toggleSensor(sensor: MarketingSensor) {
    if (ownedSet.has(sensor.siteNo)) return; // locked - already in inventory
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

  function handleAdd() {
    const toSubmit: AddSensorInput[] = Array.from(selected.values()).map((sensor) => ({
      siteNo: sensor.siteNo,
      name: sensor.name,
      lat: sensor.lat,
      lon: sensor.lon,
      streamRelation: sensor.streamRelation,
    }));

    setError(undefined);
    setAddedNotice(undefined);
    startTransition(async () => {
      const result = await addSensorsAction(toSubmit);
      if (result.error) {
        setError(result.error);
        return;
      }
      setAddedNotice(
        `Added ${result.addedCount} sensor${result.addedCount === 1 ? "" : "s"} to your roster.`,
      );
      setSelected(new Map());
    });
  }

  if (!open) {
    return (
      <button type="button" className={styles.addTrigger} onClick={() => setOpen(true)}>
        + Sensor
      </button>
    );
  }

  return (
    <div className={styles.panel}>
      <div className={styles.panelHead}>
        <h2>Add a sensor</h2>
        <button type="button" className={styles.closeBtn} onClick={() => setOpen(false)}>
          Close
        </button>
      </div>

      {addedNotice && <p className={styles.notice}>{addedNotice}</p>}

      <SensorSearchPanel
        submitLabel="Find sensors"
        selected={selected}
        onToggle={toggleSensor}
        alreadyOwnedSiteNos={ownedSet}
      />

      {(selected.size > 0 || error) && (
        <div className={panelStyles.tray}>
          <div className={panelStyles.trayText}>
            {error ? <span className={styles.errorText}>{error}</span> : `${selected.size} sensor${selected.size === 1 ? "" : "s"} selected`}
          </div>
          {selected.size > 0 && (
            <button className={panelStyles.traySubmit} type="button" onClick={handleAdd} disabled={pending}>
              {pending ? "Adding…" : `Add ${selected.size} sensor${selected.size === 1 ? "" : "s"}`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
