import { cache } from "react";
import { cookies } from "next/headers";
import type { Person, PersonRole } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";
import { SESSION_COOKIE, verifySessionToken } from "./session";

export class UnauthenticatedError extends Error {
  constructor() {
    super("Not signed in.");
    this.name = "UnauthenticatedError";
  }
}

export class ForbiddenError extends Error {
  constructor() {
    super("You don't have permission to do that.");
    this.name = "ForbiddenError";
  }
}

/**
 * Reads and verifies the session cookie, then loads the current Person -
 * undefined if signed out or the token is invalid/expired. Wrapped in
 * React's cache() so the layout and every page under it share one lookup
 * per request instead of each re-querying the session and the DB.
 */
export const getCurrentPerson = cache(async (): Promise<Person | undefined> => {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE.name)?.value;
  if (!token) return undefined;

  const payload = verifySessionToken(token);
  if (!payload) return undefined;

  const person = await prisma.person.findUnique({ where: { id: payload.personId } });
  return person ?? undefined;
});

export async function requirePerson(): Promise<Person> {
  const person = await getCurrentPerson();
  if (!person) throw new UnauthenticatedError();
  return person;
}

export function requireRole(person: Person, role: PersonRole): void {
  if (person.role !== role) throw new ForbiddenError();
}
