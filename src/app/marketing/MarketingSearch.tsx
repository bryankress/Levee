"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SensorSearchPanel } from "@/components/sensorSearch/SensorSearchPanel";
import panelStyles from "@/components/sensorSearch/sensorSearch.module.css";
import type { MarketingSensor } from "./actions";
import styles from "./marketing.module.css";

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

  function goToSignup() {
    const params = new URLSearchParams();
    if (searchedZip) params.set("zip", searchedZip);
    params.set("sites", JSON.stringify(Array.from(selected.values())));
    router.push(`/signup?${params.toString()}`);
  }

  return (
    <section className={hasResults ? styles.searchSectionWide : styles.searchSection}>
      <h2 className={styles.searchHeading}>Locate your Levee</h2>

      <SensorSearchPanel
        submitLabel="Find sensors"
        selected={selected}
        onToggle={toggleSensor}
        onResultsVisibleChange={setHasResults}
        onSearchedZipChange={setSearchedZip}
      />

      {selected.size > 0 && (
        <div className={panelStyles.tray}>
          <div className={panelStyles.trayText}>
            {selected.size} sensor{selected.size === 1 ? "" : "s"} selected
          </div>
          <button className={panelStyles.traySubmit} type="button" onClick={goToSignup}>
            Sign up to monitor these
          </button>
        </div>
      )}
    </section>
  );
}
