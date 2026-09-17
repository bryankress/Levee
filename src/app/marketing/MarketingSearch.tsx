"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SensorSearchPanel } from "@/components/sensorSearch/SensorSearchPanel";
import panelStyles from "@/components/sensorSearch/sensorSearch.module.css";
import type { MarketingSensor } from "./actions";
import styles from "./marketing.module.css";

// A best-effort heuristic pick, not a guarantee - see SensorSearchPanel's
// autoSelectCount/onAutoSelect for what "eligible" means (USGS-addable,
// not DOWNSTREAM). Every one of the 7 stays individually removable, and
// more can be added manually, so this is a helpful default, not a locked-in
// decision made for the visitor.
const AUTO_SELECT_COUNT = 7;

export function MarketingSearch() {
  const [selected, setSelected] = useState<Map<string, MarketingSensor>>(new Map());
  const [hasResults, setHasResults] = useState(false);
  const [searchedZip, setSearchedZip] = useState<string | undefined>(undefined);
  const router = useRouter();

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

  function autoSelectSensors(sensors: MarketingSensor[]) {
    setSelected((prev) => {
      const next = new Map(prev);
      for (const sensor of sensors) next.set(sensor.siteNo, sensor);
      return next;
    });
  }

  function goToSignup() {
    const params = new URLSearchParams();
    if (searchedZip) params.set("zip", searchedZip);
    params.set("sites", JSON.stringify(Array.from(selected.values())));
    router.push(`/signup?${params.toString()}`);
  }

  return (
    <section className={hasResults ? styles.searchSectionWide : styles.searchSection}>
      <h1 className={styles.searchHeading}>Locate your Levee</h1>

      <SensorSearchPanel
        submitLabel="Find sensors"
        selected={selected}
        onToggle={toggleSensor}
        onResultsVisibleChange={setHasResults}
        onSearchedZipChange={setSearchedZip}
        autoSelectCount={AUTO_SELECT_COUNT}
        onAutoSelect={autoSelectSensors}
      />

      {selected.size > 0 && (
        <div className={panelStyles.tray}>
          <div className={panelStyles.trayText}>
            {selected.size} sensor{selected.size === 1 ? "" : "s"} selected
          </div>
          <button className={panelStyles.traySubmit} type="button" onClick={goToSignup}>
            Sign up - First year free
          </button>
        </div>
      )}
    </section>
  );
}
