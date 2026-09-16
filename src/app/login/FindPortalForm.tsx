"use client";

import { useState } from "react";
import { findDistrictAction } from "./actions";
import styles from "./login.module.css";

// Mirrors the same local-dev accommodation as signup/actions.ts's
// subdomainUrl(), but client-side (window.location) since there's no
// request to read headers from here - a *.localhost hostname during dev
// should redirect to another *.localhost host, not the real root domain.
function isLocalDevHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname.endsWith(".localhost");
}

export function FindPortalForm({ rootDomain }: { rootDomain: string }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(undefined);
    setPending(true);
    const result = await findDistrictAction(value);
    setPending(false);

    if (!result.subdomain) {
      setError(result.error ?? "District not found.");
      return;
    }

    const isLocal = isLocalDevHostname(window.location.hostname);
    const protocol = isLocal ? "http" : "https";
    const port = isLocal && window.location.port ? `:${window.location.port}` : "";
    const host = isLocal ? `${result.subdomain}.localhost${port}` : `${result.subdomain}.${rootDomain}`;
    // A genuine cross-origin navigation (a different subdomain), not an
    // internal route - next/navigation's router only handles same-origin
    // client-side routing, so window.location is the correct tool here.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = `${protocol}://${host}/login`;
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="findDistrict">
          Your district&rsquo;s name or your email
        </label>
        <input
          className={styles.input}
          id="findDistrict"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="Riverbend Levee District or you@example.gov"
          autoFocus
          required
        />
      </div>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      <button className={styles.submit} type="submit" disabled={pending}>
        {pending ? "Looking up…" : "Go to sign in"}
      </button>
    </form>
  );
}
