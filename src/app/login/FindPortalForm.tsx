"use client";

import { useState } from "react";
import styles from "./login.module.css";

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
}

// Mirrors the same local-dev accommodation as signup/actions.ts's
// subdomainUrl(), but client-side (window.location) since there's no
// request to read headers from here - a *.localhost hostname during dev
// should redirect to another *.localhost host, not the real root domain.
function isLocalDevHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname.endsWith(".localhost");
}

export function FindPortalForm({ rootDomain }: { rootDomain: string }) {
  const [subdomain, setSubdomain] = useState("");

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const slug = slugify(subdomain);
    if (!slug) return;

    const isLocal = isLocalDevHostname(window.location.hostname);
    const protocol = isLocal ? "http" : "https";
    const port = isLocal && window.location.port ? `:${window.location.port}` : "";
    const host = isLocal ? `${slug}.localhost${port}` : `${slug}.${rootDomain}`;
    // A genuine cross-origin navigation (a different subdomain), not an
    // internal route - next/navigation's router only handles same-origin
    // client-side routing, so window.location is the correct tool here.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = `${protocol}://${host}/login`;
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="findSubdomain">
          Your district&rsquo;s web address
        </label>
        <div className={styles.subdomainRow}>
          <input
            className={styles.input}
            id="findSubdomain"
            value={subdomain}
            onChange={(event) => setSubdomain(event.target.value)}
            placeholder="yourdistrict"
            autoFocus
            required
          />
          <span className={styles.subdomainSuffix}>.{rootDomain}</span>
        </div>
      </div>

      <button className={styles.submit} type="submit">
        Go to sign in
      </button>
    </form>
  );
}
