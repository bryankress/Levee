import { createHmac, timingSafeEqual } from "node:crypto";
import { headers, type cookies } from "next/headers";
import { isLocalDevHost, ROOT_DOMAIN } from "@/server/tenancy/subdomain";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

type CookieStore = Awaited<ReturnType<typeof cookies>>;

export const SESSION_COOKIE = {
  name: "levee_session",
  maxAgeSeconds: SESSION_TTL_MS / 1000,
};

export interface SessionPayload {
  personId: string;
  expiresAt: number;
}

function getSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("Missing required environment variable: SESSION_SECRET");
  return secret;
}

function sign(data: string): string {
  return createHmac("sha256", getSecret()).update(data).digest("base64url");
}

/**
 * A minimal signed token, not a general JWT library: fixed algorithm
 * (HMAC-SHA256, no negotiation), so there's no alg-confusion surface to
 * audit for. Nothing outside this app ever needs to read or issue it.
 */
export function createSessionToken(personId: string): string {
  const payload: SessionPayload = { personId, expiresAt: Date.now() + SESSION_TTL_MS };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body)}`;
}

export function verifySessionToken(token: string): SessionPayload | undefined {
  const [body, signature] = token.split(".");
  if (!body || !signature) return undefined;

  const expected = Buffer.from(sign(body));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return undefined;

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionPayload;
    if (typeof payload.personId !== "string" || typeof payload.expiresAt !== "number") return undefined;
    if (payload.expiresAt < Date.now()) return undefined;
    return payload;
  } catch {
    return undefined;
  }
}

/**
 * Scoped to `.${ROOT_DOMAIN}` (not the exact request host) so a session
 * created while signing up on the apex domain is already valid once the
 * browser is redirected to the org's brand-new subdomain.
 *
 * Local dev (`*.localhost`) deliberately gets no `domain` at all (a plain
 * host-only cookie), not a `.localhost` equivalent - verified against a real
 * browser that Chromium's handling of "localhost" makes that actively worse
 * than no domain scoping at all. Chromium stores a `Domain=.localhost`
 * cookie under the bare host `localhost`, then never sends it back to *any*
 * `*.localhost` host, including the exact one that set it - so it would
 * break ordinary same-host login locally, not just leave the cross-subdomain
 * signup handoff unsupported. Real two-label domains like leveebuddy.com
 * have no such exception, so only local dev takes the plain-cookie fallback.
 */
export async function setSessionCookie(cookieStore: CookieStore, personId: string): Promise<void> {
  const token = createSessionToken(personId);
  const headerList = await headers();
  const hostname = (headerList.get("host") ?? "").split(":")[0];

  cookieStore.set(SESSION_COOKIE.name, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_COOKIE.maxAgeSeconds,
    path: "/",
    domain: isLocalDevHost(hostname) ? undefined : `.${ROOT_DOMAIN}`,
  });
}
