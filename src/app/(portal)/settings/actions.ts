"use server";

import { revalidatePath } from "next/cache";
import type { BillingInterval, OrgPlan } from "@/generated/prisma/client";
import { Prisma } from "@/generated/prisma/client";
import { requirePerson, requireRole } from "@/server/auth/currentPerson";
import { prisma } from "@/server/db/client";
import { assertValidSubdomain, InvalidSubdomainError } from "@/server/tenancy/subdomain";
import { CONTACT_CAP_BY_PLAN } from "@/lib/plans";

export interface SettingsActionState {
  error?: string;
  success?: string;
}

/** Every signed-in person can edit their own account details - no role check. */
export async function updateAccountAction(
  _prevState: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const person = await requirePerson();

  const name = String(formData.get("name") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const smsConsent = formData.get("smsConsent") === "on";

  if (!name) {
    return { error: "Name is required." };
  }
  if (smsConsent && !phone) {
    return { error: "Add a phone number to receive text alerts." };
  }

  await prisma.person.update({
    where: { id: person.id },
    data: {
      name,
      phone: phone || null,
      smsConsentAt: smsConsent ? (person.smsConsentAt ?? new Date()) : null,
    },
  });

  revalidatePath("/settings");
  return { success: "Account updated." };
}

/** Org name, subdomain, and the levee's own details - admin only. */
export async function updateOrganizationAction(
  _prevState: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const person = await requirePerson();
  requireRole(person, "ADMIN");

  const orgName = String(formData.get("orgName") ?? "").trim();
  const subdomain = String(formData.get("subdomain") ?? "").trim().toLowerCase();
  const leveeId = String(formData.get("leveeId") ?? "").trim();
  const leveeName = String(formData.get("leveeName") ?? "").trim();
  const leveeAddress = String(formData.get("leveeAddress") ?? "").trim();
  const riverName = String(formData.get("riverName") ?? "").trim();
  const leveeSummary = String(formData.get("leveeSummary") ?? "").trim();

  if (!orgName || !subdomain) {
    return { error: "Organization name and subdomain are required." };
  }

  try {
    assertValidSubdomain(subdomain);
  } catch (error) {
    if (error instanceof InvalidSubdomainError) return { error: error.message };
    throw error;
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.organization.update({
        where: { id: person.orgId },
        data: { name: orgName, subdomain },
      });

      if (leveeId && leveeName) {
        // updateMany, not update - the where clause needs to scope by orgId
        // too (a plain id-based update has no way to also assert tenancy).
        await tx.levee.updateMany({
          where: { id: leveeId, orgId: person.orgId },
          data: {
            name: leveeName,
            address: leveeAddress || null,
            riverName: riverName || null,
            summary: leveeSummary || null,
          },
        });
      }
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { error: `"${subdomain}" is already taken.` };
    }
    throw error;
  }

  revalidatePath("/settings");
  return { success: "Organization updated." };
}

/**
 * No payment processor is wired up yet (see Organization.plan's own
 * comment) - this just records the choice. Downgrading to Free is refused
 * outright rather than silently orphaning contacts over the cap, since
 * there's no interactive "pick who stays" step for the admin to resolve it
 * with here.
 */
export async function updatePlanAction(
  _prevState: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const person = await requirePerson();
  requireRole(person, "ADMIN");

  const planRaw = formData.get("plan");
  const plan: OrgPlan = planRaw === "FREE" || planRaw === "GROWTH" ? planRaw : "BASE";
  const billingInterval: BillingInterval = formData.get("billingInterval") === "ANNUAL" ? "ANNUAL" : "MONTHLY";

  const cap = CONTACT_CAP_BY_PLAN[plan];
  if (Number.isFinite(cap)) {
    const contactCount = await prisma.person.count({ where: { orgId: person.orgId } });
    if (contactCount > cap) {
      return {
        error: `You have ${contactCount} contacts - remove some down to ${cap} before switching to this plan.`,
      };
    }
  }

  await prisma.organization.update({
    where: { id: person.orgId },
    data: { plan, billingInterval },
  });

  revalidatePath("/settings");
  revalidatePath("/personnel");
  return { success: "Plan updated." };
}
