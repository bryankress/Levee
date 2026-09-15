import { cookies } from "next/headers";
import { prisma } from "@/server/db/client";
import { verifyPassword } from "./password";
import { createSessionToken, SESSION_COOKIE } from "./session";

export class InvalidCredentialsError extends Error {
  constructor() {
    super("Invalid email or password.");
    this.name = "InvalidCredentialsError";
  }
}

/**
 * Email is only unique per org (Person.@@unique([orgId, email])), never
 * globally, so the caller resolves orgId from the request's subdomain first
 * (proxy.ts's x-org-id header) - login has no way to guess which levee a
 * bare email address belongs to.
 */
export async function login(orgId: string, email: string, password: string): Promise<void> {
  const person = await prisma.person.findUnique({ where: { orgId_email: { orgId, email } } });
  if (!person?.passwordHash) throw new InvalidCredentialsError();

  const valid = await verifyPassword(password, person.passwordHash);
  if (!valid) throw new InvalidCredentialsError();

  const token = createSessionToken(person.id);
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE.name, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_COOKIE.maxAgeSeconds,
    path: "/",
  });
}

export async function logout(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE.name);
}
