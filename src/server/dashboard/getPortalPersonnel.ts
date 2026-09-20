import type { OrgPlan, PersonRole } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";
import { CONTACT_CAP_BY_PLAN } from "@/lib/plans";

export interface PersonnelRow {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: PersonRole;
  smsConsentAt: Date | null;
  hasPortalAccess: boolean;
}

export interface PortalPersonnelData {
  roster: PersonnelRow[];
  adminCount: number;
  plan: OrgPlan;
  /** null means unlimited. */
  contactCap: number | null;
}

export async function getPortalPersonnel(orgId: string): Promise<PortalPersonnelData> {
  const [people, org] = await Promise.all([
    prisma.person.findMany({ where: { orgId }, orderBy: { name: "asc" } }),
    prisma.organization.findUniqueOrThrow({ where: { id: orgId }, select: { plan: true } }),
  ]);

  const roster: PersonnelRow[] = people.map((person) => ({
    id: person.id,
    name: person.name,
    email: person.email,
    phone: person.phone,
    role: person.role,
    smsConsentAt: person.smsConsentAt,
    hasPortalAccess: person.passwordHash !== null,
  }));

  const cap = CONTACT_CAP_BY_PLAN[org.plan];

  return {
    roster,
    adminCount: roster.filter((person) => person.role === "ADMIN").length,
    plan: org.plan,
    contactCap: Number.isFinite(cap) ? cap : null,
  };
}
