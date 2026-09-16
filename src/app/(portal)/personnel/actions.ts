"use server";

import { revalidatePath } from "next/cache";
import { requirePerson, requireRole } from "@/server/auth/currentPerson";
import { prisma } from "@/server/db/client";

export interface PersonnelActionState {
  error?: string;
}

/**
 * Added as a notification/roster entry only, same as the schema's own intent
 * (Person.passwordHash is nullable specifically for this) - no password, no
 * portal login, just someone events and rules can notify. Inviting someone
 * to actually sign in isn't built yet.
 */
export async function addPersonAction(_prevState: PersonnelActionState, formData: FormData): Promise<PersonnelActionState> {
  const person = await requirePerson();
  requireRole(person, "ADMIN");

  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const phone = String(formData.get("phone") ?? "").trim();
  const role = formData.get("role") === "ADMIN" ? "ADMIN" : "MEMBER";
  const smsConsent = formData.get("smsConsent") === "on";

  if (!name || !email) {
    return { error: "Name and email are required." };
  }
  if (smsConsent && !phone) {
    return { error: "Add a phone number to enable text alerts." };
  }

  const existing = await prisma.person.findUnique({ where: { orgId_email: { orgId: person.orgId, email } } });
  if (existing) {
    return { error: "Someone with that email is already on the roster." };
  }

  await prisma.person.create({
    data: {
      orgId: person.orgId,
      name,
      email,
      phone: phone || null,
      role,
      smsConsentAt: smsConsent ? new Date() : null,
    },
  });

  revalidatePath("/personnel");
  return {};
}

export async function updateRoleAction(formData: FormData): Promise<void> {
  const person = await requirePerson();
  requireRole(person, "ADMIN");

  const personId = String(formData.get("personId") ?? "");
  const role = formData.get("role") === "ADMIN" ? "ADMIN" : "MEMBER";

  if (personId === person.id) {
    throw new Error("You can't change your own role.");
  }

  await guardLastAdmin(person.orgId, personId, role);

  await prisma.person.updateMany({ where: { id: personId, orgId: person.orgId }, data: { role } });
  revalidatePath("/personnel");
}

export async function removePersonAction(personId: string): Promise<void> {
  const person = await requirePerson();
  requireRole(person, "ADMIN");

  if (personId === person.id) {
    throw new Error("You can't remove yourself from the roster.");
  }

  await guardLastAdmin(person.orgId, personId, "MEMBER");

  await prisma.person.deleteMany({ where: { id: personId, orgId: person.orgId } });
  revalidatePath("/personnel");
}

/** Refuses to demote or remove an org's only remaining admin - there has to always be someone who can manage the roster. */
async function guardLastAdmin(orgId: string, personId: string, nextRole: "ADMIN" | "MEMBER"): Promise<void> {
  if (nextRole === "ADMIN") return;

  const target = await prisma.person.findUnique({ where: { id: personId } });
  if (!target || target.orgId !== orgId || target.role !== "ADMIN") return;

  const adminCount = await prisma.person.count({ where: { orgId, role: "ADMIN" } });
  if (adminCount <= 1) {
    throw new Error("An organization needs at least one admin.");
  }
}
