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
 * "Find your district" by the email on file for any person in it - not just
 * the original admin who signed up, since anyone added later should be able
 * to find their own district the same way. An email could in principle
 * belong to people in more than one org (uniqueness is scoped per-org, not
 * globally), in which case this just resolves to the first match - a real
 * enough edge case to note, not one worth a disambiguation UI for.
 */
export async function findSubdomainByEmailAction(email: string): Promise<FindDistrictState> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return { error: "Enter an email address." };

  const person = await prisma.person.findFirst({
    where: { email: normalized },
    select: { organization: { select: { subdomain: true } } },
  });

  if (!person) {
    return { error: "No district found for that email address." };
  }

  return { subdomain: person.organization.subdomain };
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
