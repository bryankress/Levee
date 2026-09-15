import { createHmac, timingSafeEqual } from "node:crypto";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

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
