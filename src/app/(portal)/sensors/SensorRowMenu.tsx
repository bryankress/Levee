"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { removeSensorAction } from "./actions";
import styles from "./sensorRowMenu.module.css";

export function SensorRowMenu({ sensorId, sensorLabel }: { sensorId: string; sensorLabel: string }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(event: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  function handleRemove() {
    setOpen(false);
    if (!window.confirm(`Remove ${sensorLabel} from your roster?`)) return;
    startTransition(async () => {
      await removeSensorAction(sensorId);
    });
  }

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <button
        type="button"
        className={styles.trigger}
        onClick={() => setOpen((value) => !value)}
        aria-label="Sensor actions"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={pending}
      >
        ⋯
      </button>
      {open && (
        <div className={styles.menu} role="menu">
          <button type="button" className={styles.menuItem} role="menuitem" onClick={handleRemove}>
            Remove
          </button>
        </div>
      )}
    </div>
  );
}
