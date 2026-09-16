"use client";

import { useState } from "react";
import { findSubdomainByEmailAction } from "./actions";
import styles from "./login.module.css";

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
}

function looksLikeEmail(value: string): boolean {
  return value.includes("@");
}

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

  function goToSubdomain(slug: string) {
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

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(undefined);

    // An email needs a real lookup (there's no way to guess a subdomain
    // from it client-side); a district name/web address is just slugified
    // and navigated to directly, same as before - no server round trip.
    if (looksLikeEmail(value)) {
      setPending(true);
      const result = await findSubdomainByEmailAction(value);
      setPending(false);
      if (!result.subdomain) {
        setError(result.error ?? "No district found for that email address.");
        return;
      }
      goToSubdomain(result.subdomain);
      return;
    }

    const slug = slugify(value);
    if (!slug) return;
    goToSubdomain(slug);
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="findDistrict">
          Your district&rsquo;s web address or your email
        </label>
        <div className={styles.subdomainRow}>
          <input
            className={styles.input}
            id="findDistrict"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="yourdistrict or you@example.gov"
            autoFocus
            required
          />
          {!looksLikeEmail(value) && <span className={styles.subdomainSuffix}>.{rootDomain}</span>}
        </div>
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
