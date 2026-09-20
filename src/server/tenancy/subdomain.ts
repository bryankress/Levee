import { prisma } from "@/server/db/client";

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

export const ROOT_DOMAIN = process.env.ROOT_DOMAIN ?? "leveebuddy.com";
const LOCAL_SUFFIX = ".localhost";

/**
 * True for "localhost" or any "*.localhost" hostname - the dev-only escape
 * hatch for testing subdomain routing without owning a real domain. Anything
 * that scopes a cookie or builds a redirect URL to a specific host must
 * branch on the request's actual hostname, not just default to ROOT_DOMAIN -
 * a leveebuddy.com-scoped cookie is invisible on a *.localhost host, and a
 * hardcoded leveebuddy.com redirect would bounce local testing out to the
 * real internet domain.
 */
export function isLocalDevHost(hostname: string): boolean {
  return hostname === "localhost" || hostname.endsWith(LOCAL_SUFFIX);
}

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

export const SUBDOMAIN_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export class InvalidSubdomainError extends Error {
  constructor(subdomain: string) {
    super(`"${subdomain}" isn't a valid subdomain.`);
    this.name = "InvalidSubdomainError";
  }
}

export class SubdomainTakenError extends Error {
  constructor(subdomain: string) {
    super(`"${subdomain}" is already taken.`);
    this.name = "SubdomainTakenError";
  }
}

export function assertValidSubdomain(subdomain: string): void {
  if (!SUBDOMAIN_PATTERN.test(subdomain) || RESERVED_SUBDOMAINS.has(subdomain)) {
    throw new InvalidSubdomainError(subdomain);
  }
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
}

/**
 * Signup no longer collects a subdomain directly - it's derived from the
 * organization name so the simplified form has one less field to fill in.
 * Tries the plain slug first, then numbered variants, so a collision or an
 * org name that slugifies to a reserved word never blocks account creation.
 * The result is just a starting point - Settings lets an admin change it later.
 */
export async function generateAvailableSubdomain(orgName: string): Promise<string> {
  const base = slugify(orgName) || "district";
  const safeBase = RESERVED_SUBDOMAINS.has(base) ? `${base}-district` : base;

  for (let attempt = 0; attempt < 25; attempt++) {
    const candidate = attempt === 0 ? safeBase : `${safeBase.slice(0, 58)}-${attempt + 1}`;
    if (!SUBDOMAIN_PATTERN.test(candidate) || RESERVED_SUBDOMAINS.has(candidate)) continue;
    const existing = await prisma.organization.findUnique({ where: { subdomain: candidate }, select: { id: true } });
    if (!existing) return candidate;
  }

  return `${safeBase.slice(0, 50)}-${Math.random().toString(36).slice(2, 8)}`;
}
