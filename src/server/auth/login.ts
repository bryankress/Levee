import { cookies, headers } from "next/headers";
import { prisma } from "@/server/db/client";
import { isLocalDevHost, ROOT_DOMAIN } from "@/server/tenancy/subdomain";
import { verifyPassword } from "./password";
import { SESSION_COOKIE, setSessionCookie } from "./session";

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

  const cookieStore = await cookies();
  await setSessionCookie(cookieStore, person.id);
}

export async function logout(): Promise<void> {
  const cookieStore = await cookies();
  const headerList = await headers();
  const hostname = (headerList.get("host") ?? "").split(":")[0];

  // Must match setSessionCookie's domain exactly, or the browser treats this
  // as a different cookie and leaves the real (domain-scoped) one in place.
  cookieStore.delete({
    name: SESSION_COOKIE.name,
    path: "/",
    domain: isLocalDevHost(hostname) ? undefined : `.${ROOT_DOMAIN}`,
  });
}
