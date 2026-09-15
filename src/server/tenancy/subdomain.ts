// The subdomain field's own reserved list, ported from the Domain & DNS
// Setup doc - each of these already means something to the system, so a
// levee district can never claim one at sign-up.
export const RESERVED_SUBDOMAINS = new Set([
  "www",
  "app",
  "api",
  "admin",
  "mail",
  "smtp",
  "status",
  "support",
  "docs",
  "blog",
  "assets",
  "cdn",
  "staging",
  "dev",
  "test",
]);

const ROOT_DOMAIN = process.env.ROOT_DOMAIN ?? "leveebuddy.com";
const LOCAL_SUFFIX = ".localhost";

/**
 * Pulls the org subdomain out of a Host header, or undefined for the apex
 * domain, a reserved name, or a host that isn't on this domain at all.
 * Accepts *.localhost too, so subdomain routing is testable without editing
 * /etc/hosts or owning a real domain in dev.
 */
export function extractSubdomain(host: string): string | undefined {
  const hostname = host.split(":")[0].toLowerCase();

  if (hostname === ROOT_DOMAIN || hostname === `www.${ROOT_DOMAIN}`) return undefined;

  let candidate: string | undefined;
  if (hostname.endsWith(`.${ROOT_DOMAIN}`)) {
    candidate = hostname.slice(0, -(ROOT_DOMAIN.length + 1));
  } else if (hostname.endsWith(LOCAL_SUFFIX)) {
    candidate = hostname.slice(0, -LOCAL_SUFFIX.length);
  }

  if (!candidate || RESERVED_SUBDOMAINS.has(candidate)) return undefined;
  return candidate;
}
