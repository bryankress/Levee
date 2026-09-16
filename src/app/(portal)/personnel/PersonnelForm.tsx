"use client";

import { useActionState } from "react";
import { addPersonAction, type PersonnelActionState } from "./actions";
import styles from "./personnel.module.css";

const initialState: PersonnelActionState = {};

export function PersonnelForm() {
  const [state, formAction, pending] = useActionState(addPersonAction, initialState);

  return (
    <form action={formAction} className={styles.builder}>
      <h2>Add to roster</h2>

      {state.error && (
        <p className={styles.error} role="alert">
          {state.error}
        </p>
      )}

      <div className={styles.row}>
        <div className={styles.field}>
          <label htmlFor="pName">Name</label>
          <input id="pName" name="name" type="text" required />
        </div>
        <div className={styles.field}>
          <label htmlFor="pEmail">Email</label>
          <input id="pEmail" name="email" type="email" required />
        </div>
        <div className={styles.field}>
          <label htmlFor="pPhone">
            Phone <span className={styles.optional}>(optional)</span>
          </label>
          <input id="pPhone" name="phone" type="tel" placeholder="+1 555 555 5555" />
        </div>
        <div className={styles.field}>
          <label htmlFor="pRole">Role</label>
          <select id="pRole" name="role" defaultValue="MEMBER">
            <option value="MEMBER">Member</option>
            <option value="ADMIN">Admin</option>
          </select>
        </div>
      </div>

      <label className={styles.checkboxRow}>
        <input type="checkbox" name="smsConsent" />
        This person has agreed to receive text alerts
      </label>

      <div className={styles.actions}>
        <button type="submit" className={styles.primary} disabled={pending}>
          {pending ? "Adding…" : "Add to roster"}
        </button>
      </div>
    </form>
  );
}
