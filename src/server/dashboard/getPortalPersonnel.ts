import type { PersonRole } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";

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
}

export async function getPortalPersonnel(orgId: string): Promise<PortalPersonnelData> {
  const people = await prisma.person.findMany({ where: { orgId }, orderBy: { name: "asc" } });

  const roster: PersonnelRow[] = people.map((person) => ({
    id: person.id,
    name: person.name,
    email: person.email,
    phone: person.phone,
    role: person.role,
    smsConsentAt: person.smsConsentAt,
    hasPortalAccess: person.passwordHash !== null,
  }));

  return {
    roster,
    adminCount: roster.filter((person) => person.role === "ADMIN").length,
  };
}
