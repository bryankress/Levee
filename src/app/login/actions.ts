"use server";

import { redirect } from "next/navigation";
import { InvalidCredentialsError, login } from "@/server/auth/login";
import { prisma } from "@/server/db/client";

export interface LoginState {
  error?: string;
}

export interface FindDistrictState {
  error?: string;
  subdomain?: string;
}

/**
 * "Find your district" by either its actual name or the email on file for
 * any person in it - a real lookup for both, not a client-side guess. The
 * old version only handled email this way; a district *name* (e.g.
 * "Riverbend Levee District") was just slugified and navigated to blind,
 * which only worked if that happened to match the org's real subdomain -
 * most people know their district's name, not its exact web-address slug.
 *
 * An email or a name could in principle match more than one org (email
 * uniqueness is scoped per-org, not global; names aren't unique at all),
 * in which case this just resolves to the first match - a real enough edge
 * case to note, not one worth a disambiguation UI for.
 */
export async function findDistrictAction(query: string): Promise<FindDistrictState> {
  const trimmed = query.trim();
  if (!trimmed) return { error: "Enter your district's name or your email." };

  if (trimmed.includes("@")) {
    const person = await prisma.person.findFirst({
      where: { email: trimmed.toLowerCase() },
      select: { organization: { select: { subdomain: true } } },
    });
    if (!person) return { error: "No district found for that email address." };
    return { subdomain: person.organization.subdomain };
  }

  // Exact web-address match first, for anyone who does know their subdomain -
  // then fall back to the org's actual display name, case-insensitively,
  // exact before partial so "Riverbend Levee" doesn't get outrun by some
  // other district whose name merely contains it.
  const bySubdomain = await prisma.organization.findUnique({
    where: { subdomain: trimmed.toLowerCase() },
    select: { subdomain: true },
  });
  if (bySubdomain) return { subdomain: bySubdomain.subdomain };

  const byExactName = await prisma.organization.findFirst({
    where: { name: { equals: trimmed, mode: "insensitive" } },
    select: { subdomain: true },
  });
  if (byExactName) return { subdomain: byExactName.subdomain };

  const byPartialName = await prisma.organization.findFirst({
    where: { name: { contains: trimmed, mode: "insensitive" } },
    select: { subdomain: true },
  });
  if (byPartialName) return { subdomain: byPartialName.subdomain };

  return { error: "No district found with that name." };
}

export async function loginAction(orgId: string, _prevState: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Enter both an email and a password." };
  }

  try {
    await login(orgId, email, password);
  } catch (error) {
    if (error instanceof InvalidCredentialsError) {
      return { error: error.message };
    }
    throw error;
  }

  redirect("/");
}
