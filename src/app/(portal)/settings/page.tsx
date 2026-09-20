import type { Metadata } from "next";
import { getCurrentPerson } from "@/server/auth/currentPerson";
import { prisma } from "@/server/db/client";
import { ROOT_DOMAIN } from "@/server/tenancy/subdomain";
import { AccountForm } from "./AccountForm";
import { OrganizationForm } from "./OrganizationForm";
import { PlanForm } from "./PlanForm";
import portalStyles from "../portal.module.css";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const person = await getCurrentPerson();
  if (!person) return null; // the layout already redirects; this satisfies the type checker

  const [org, levee] = await Promise.all([
    prisma.organization.findUniqueOrThrow({ where: { id: person.orgId } }),
    // Multi-levee management isn't built yet (Growth's "multiple levee
    // districts" feature) - this edits the one every org gets at signup.
    prisma.levee.findFirst({ where: { orgId: person.orgId } }),
  ]);
  const isAdmin = person.role === "ADMIN";

  return (
    <div>
      <div className={portalStyles.pageHeader}>
        <div>
          <h1>Settings</h1>
          <div className={portalStyles.meta}>Your account, organization, and plan</div>
        </div>
      </div>

      <AccountForm person={{ name: person.name, phone: person.phone, smsConsentAt: person.smsConsentAt }} />

      {isAdmin && (
        <OrganizationForm
          org={{ name: org.name, subdomain: org.subdomain }}
          levee={levee ? { id: levee.id, name: levee.name, address: levee.address, riverName: levee.riverName, summary: levee.summary } : null}
          rootDomain={ROOT_DOMAIN}
        />
      )}

      {isAdmin && <PlanForm plan={org.plan} billingInterval={org.billingInterval} />}
    </div>
  );
}
