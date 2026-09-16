"use client";

import { useActionState } from "react";
import { createEventAction, type CalendarActionState } from "./actions";
import { EVENT_TYPE_LABEL, REMINDER_OFFSET_OPTIONS } from "@/lib/eventDisplay";
import styles from "./calendar.module.css";

const initialState: CalendarActionState = {};

export function EventForm({ roster }: { roster: { id: string; name: string }[] }) {
  const [state, formAction, pending] = useActionState(createEventAction, initialState);

  return (
    <form action={formAction} className={styles.builder}>
      <h2>New event</h2>

      {state.error && (
        <p className={styles.error} role="alert">
          {state.error}
        </p>
      )}

      <div className={styles.row}>
        <div className={styles.field}>
          <label htmlFor="evTitle">Title</label>
          <input id="evTitle" name="title" type="text" placeholder="e.g. Quarterly board meeting" required />
        </div>
        <div className={styles.field}>
          <label htmlFor="evDate">Date</label>
          <input id="evDate" name="date" type="date" required />
        </div>
        <div className={styles.field}>
          <label htmlFor="evTime">
            Time <span className={styles.optional}>(optional)</span>
          </label>
          <input id="evTime" name="time" type="time" />
        </div>
      </div>

      <div className={styles.field}>
        <label>Type</label>
        <div className={styles.typeChoice}>
          {(Object.keys(EVENT_TYPE_LABEL) as (keyof typeof EVENT_TYPE_LABEL)[]).map((type, index) => (
            <label key={type} className={`${styles.typePill} ${styles[`type${type}`]}`}>
              <input type="radio" name="type" value={type} defaultChecked={index === 0} required />
              {EVENT_TYPE_LABEL[type]}
            </label>
          ))}
        </div>
      </div>

      <div className={styles.field}>
        <label htmlFor="evNotes">
          Notes <span className={styles.optional}>(optional)</span>
        </label>
        <textarea id="evNotes" name="notes" placeholder="Location, agenda, who to bring…" />
      </div>

      <div className={styles.notifyRow}>
        <div className={styles.field}>
          <label>Notify</label>
          {roster.length === 0 ? (
            <p className={styles.notifyEmpty}>No one on the roster yet - add people on the Personnel page first.</p>
          ) : (
            <div className={styles.notifyList}>
              {roster.map((recipient) => (
                <label key={recipient.id} className={styles.notifyItem}>
                  <input type="checkbox" name="notifyPersonIds" value={recipient.id} />
                  {recipient.name}
                </label>
              ))}
            </div>
          )}
        </div>

        <div className={styles.field}>
          <label htmlFor="evWhen">When</label>
          <select id="evWhen" name="reminderOffsetMinutes" defaultValue={REMINDER_OFFSET_OPTIONS[0].minutes}>
            {REMINDER_OFFSET_OPTIONS.map((option) => (
              <option key={option.minutes} value={option.minutes}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className={styles.actions}>
        <button type="submit" className={styles.primary} disabled={pending}>
          {pending ? "Saving…" : "Create event"}
        </button>
      </div>
    </form>
  );
}
