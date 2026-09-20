"use client";

import { useActionState, useState } from "react";
import { updateAccountAction, type SettingsActionState } from "./actions";
import styles from "./settings.module.css";

const initialState: SettingsActionState = {};

export function AccountForm({
  person,
}: {
  person: { name: string; phone: string | null; smsConsentAt: Date | null };
}) {
  const [state, formAction, pending] = useActionState(updateAccountAction, initialState);
  const [smsConsent, setSmsConsent] = useState(person.smsConsentAt !== null);

  return (
    <form action={formAction} className={styles.section}>
      <h2>Your account</h2>
      <p className={styles.sectionHint}>Your name, phone, and text-alert preference.</p>

      {state.error && (
        <p className={styles.error} role="alert">
          {state.error}
        </p>
      )}
      {state.success && <p className={styles.success}>{state.success}</p>}

      <div className={styles.row}>
        <div className={styles.field}>
          <label htmlFor="accName">Your name</label>
          <input id="accName" name="name" type="text" defaultValue={person.name} required />
        </div>
        <div className={styles.field}>
          <label htmlFor="accPhone">
            Phone <span className={styles.optional}>(optional)</span>
          </label>
          <input id="accPhone" name="phone" type="tel" defaultValue={person.phone ?? ""} placeholder="+1 555 555 5555" />
        </div>
      </div>

      <label className={styles.checkboxRow}>
        <input
          type="checkbox"
          name="smsConsent"
          checked={smsConsent}
          onChange={(event) => setSmsConsent(event.target.checked)}
        />
        Send text alerts to the phone number above. Message and data rates may apply; reply STOP to opt out
        at any time.
      </label>

      <div className={styles.actions}>
        <button type="submit" className={styles.primary} disabled={pending}>
          {pending ? "Saving…" : "Save account"}
        </button>
      </div>
    </form>
  );
}
