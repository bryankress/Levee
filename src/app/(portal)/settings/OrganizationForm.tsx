"use client";

import { useActionState, useState } from "react";
import { updateOrganizationAction, type SettingsActionState } from "./actions";
import styles from "./settings.module.css";

const initialState: SettingsActionState = {};

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
}

export function OrganizationForm({
  org,
  levee,
  rootDomain,
}: {
  org: { name: string; subdomain: string };
  levee: { id: string; name: string; address: string | null; riverName: string | null; summary: string | null } | null;
  rootDomain: string;
}) {
  const [state, formAction, pending] = useActionState(updateOrganizationAction, initialState);
  const [subdomain, setSubdomain] = useState(org.subdomain);

  return (
    <form action={formAction} className={styles.section}>
      <h2>Organization &amp; levee</h2>
      <p className={styles.sectionHint}>Your portal address and the details of your levee district.</p>

      {state.error && (
        <p className={styles.error} role="alert">
          {state.error}
        </p>
      )}
      {state.success && <p className={styles.success}>{state.success}</p>}

      {levee && <input type="hidden" name="leveeId" value={levee.id} />}

      <div className={styles.row}>
        <div className={styles.field}>
          <label htmlFor="orgName">Organization name</label>
          <input id="orgName" name="orgName" type="text" defaultValue={org.name} required />
        </div>
        <div className={styles.field}>
          <label htmlFor="subdomain">Subdomain</label>
          <div className={styles.subdomainRow}>
            <input
              id="subdomain"
              name="subdomain"
              type="text"
              value={subdomain}
              onChange={(event) => setSubdomain(slugify(event.target.value))}
              required
            />
            <span className={styles.subdomainSuffix}>.{rootDomain}</span>
          </div>
        </div>
      </div>

      <div className={styles.row}>
        <div className={styles.field}>
          <label htmlFor="leveeName">Levee name</label>
          <input id="leveeName" name="leveeName" type="text" defaultValue={levee?.name ?? ""} required />
        </div>
        <div className={styles.field}>
          <label htmlFor="leveeAddress">Address</label>
          <input id="leveeAddress" name="leveeAddress" type="text" defaultValue={levee?.address ?? ""} />
        </div>
      </div>

      <div className={styles.row}>
        <div className={styles.field}>
          <label htmlFor="riverName">River</label>
          <input id="riverName" name="riverName" type="text" defaultValue={levee?.riverName ?? ""} />
        </div>
        <div className={styles.field}>
          <label htmlFor="leveeSummary">Summary</label>
          <textarea id="leveeSummary" name="leveeSummary" rows={2} defaultValue={levee?.summary ?? ""} />
        </div>
      </div>

      <div className={styles.actions}>
        <button type="submit" className={styles.primary} disabled={pending || !levee}>
          {pending ? "Saving…" : "Save organization"}
        </button>
      </div>
    </form>
  );
}
