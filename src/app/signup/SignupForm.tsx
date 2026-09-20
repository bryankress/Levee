"use client";

import { useActionState } from "react";
import { signupAction, type SignupState } from "./actions";
import styles from "./signup.module.css";

const initialState: SignupState = {};

export function SignupForm() {
  const [state, formAction, pending] = useActionState(signupAction, initialState);

  return (
    <form action={formAction} className={styles.form}>
      {state.error && (
        <p className={styles.error} role="alert">
          {state.error}
        </p>
      )}

      <div className={styles.field}>
        <label className={styles.label} htmlFor="orgName">
          Organization name
        </label>
        <input className={styles.input} id="orgName" name="orgName" required />
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="address">
          Address
        </label>
        <input className={styles.input} id="address" name="address" />
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="zip">
          ZIP code
        </label>
        <input
          className={styles.input}
          id="zip"
          name="zip"
          inputMode="numeric"
          pattern="\d{5}"
          maxLength={5}
          placeholder="64501"
          required
        />
        <div className={styles.hint}>
          We&rsquo;ll automatically find and start tracking the nearest river sensors for you - no search
          needed.
        </div>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="email">
          Email
        </label>
        <input className={styles.input} id="email" name="email" type="email" autoComplete="email" required />
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="password">
          Password
        </label>
        <input
          className={styles.input}
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
        />
      </div>

      <p className={styles.billingNote}>
        You&rsquo;re starting on the Free plan - up to 2 contacts and 2 sensors, with email alerts. Your
        portal address, additional contacts, and plan can all be set up from Settings once you&rsquo;re in.
      </p>

      <button className={styles.submit} type="submit" disabled={pending}>
        {pending ? "Creating your district…" : "Create your district"}
      </button>
    </form>
  );
}
