import type { BillingInterval, OrgPlan } from "@/generated/prisma/client";
import { Prisma } from "@/generated/prisma/client";
import { hashPassword } from "@/server/auth/password";
import { prisma } from "@/server/db/client";
import { USGS_PARAM_CODES } from "@/server/integrations/usgs";
import { findFloodStagesForSiteNos } from "@/server/discovery/nwpsCrosswalk";
import { RESERVED_SUBDOMAINS } from "@/server/tenancy/subdomain";

export interface SignupSensorInput {
  siteNo: string;
  name: string;
  lat: number;
  lon: number;
  /** Real upstream/downstream classification from the marketing search's NLDI navigation, carried through unchanged - never guessed here. */
  streamRelation?: "UPSTREAM" | "DOWNSTREAM";
}

export interface SignupInput {
  leveeName: string;
  leveeAddress: string;
  riverName: string;
  leveeSummary: string;
  orgName: string;
  subdomain: string;
  personName: string;
  email: string;
  phone: string;
  password: string;
  smsConsent: boolean;
  plan: OrgPlan;
  billingInterval: BillingInterval;
  sensors: SignupSensorInput[];
}

export interface SignupResult {
  orgId: string;
  subdomain: string;
  personId: string;
}

export class InvalidSubdomainError extends Error {
  constructor(subdomain: string) {
    super(`"${subdomain}" isn't a valid subdomain.`);
    this.name = "InvalidSubdomainError";
  }
}

export class SubdomainTakenError extends Error {
  constructor(subdomain: string) {
    super(`"${subdomain}" is already taken.`);
    this.name = "SubdomainTakenError";
  }
}

export class SensorsAlreadyClaimedError extends Error {
  constructor(public readonly siteNos: string[]) {
    super(`Already monitored by another district: ${siteNos.join(", ")}`);
    this.name = "SensorsAlreadyClaimedError";
  }
}

// USGS site numbers are typically 8-15 digits; not validated further since
// they came back from our own earlier search, not typed in by hand.
const SUBDOMAIN_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

function assertValidSubdomain(subdomain: string): void {
  if (!SUBDOMAIN_PATTERN.test(subdomain) || RESERVED_SUBDOMAINS.has(subdomain)) {
    throw new InvalidSubdomainError(subdomain);
  }
}

/**
 * The app's first real multi-table write: creates an Organization, its first
 * Levee, an ADMIN Person, and any Sensors the sign-up flow's search step
 * carried over - all inside one transaction, so a failure partway through
 * (e.g. a sensor already claimed by another district) never leaves a
 * half-created org behind.
 *
 * Sensor.@@unique([source, externalId]) has no leveeId in it - a given USGS
 * site can only ever back one Sensor row system-wide, not one per levee, so
 * a pre-check looks for already-claimed sites before the transaction opens
 * (to name them in the error) with the unique constraint itself as a
 * fallback for the rare race between the check and the write.
 */
export async function createOrganizationAndAccount(input: SignupInput): Promise<SignupResult> {
  const subdomain = input.subdomain.toLowerCase();
  assertValidSubdomain(subdomain);

  if (input.sensors.length > 0) {
    const claimed = await prisma.sensor.findMany({
      where: { source: "USGS", externalId: { in: input.sensors.map((sensor) => sensor.siteNo) } },
      select: { externalId: true },
    });
    if (claimed.length > 0) {
      throw new SensorsAlreadyClaimedError(claimed.map((sensor) => sensor.externalId));
    }
  }

  // Fetched outside the transaction below (a real third-party call has no
  // business holding a DB transaction open) - see nwpsCrosswalk.ts for why
  // this can only ever be best-effort: a gauge with no NWPS presence, or
  // whose live fetch fails, just claims with no threshold, same as before
  // this existed, rather than blocking signup on it.
  const floodStagesBySiteNo = await findFloodStagesForSiteNos(input.sensors.map((sensor) => sensor.siteNo));

  const passwordHash = await hashPassword(input.password);

  try {
    return await prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({
        data: {
          name: input.orgName,
          subdomain,
          plan: input.plan,
          billingInterval: input.billingInterval,
        },
      });

      const levee = await tx.levee.create({
        data: {
          orgId: org.id,
          name: input.leveeName,
          address: input.leveeAddress || null,
          riverName: input.riverName || null,
          summary: input.leveeSummary || null,
        },
      });

      const person = await tx.person.create({
        data: {
          orgId: org.id,
          name: input.personName,
          email: input.email,
          role: "ADMIN",
          phone: input.phone || null,
          smsConsentAt: input.smsConsent ? new Date() : null,
          passwordHash,
        },
      });

      if (input.sensors.length > 0) {
        await tx.sensor.createMany({
          data: input.sensors.map((sensor) => ({
            leveeId: levee.id,
            source: "USGS",
            externalId: sensor.siteNo,
            // The friendly name the visitor already saw during discovery -
            // never re-derived later, so it persists exactly as shown.
            name: sensor.name || null,
            paramCodes: [USGS_PARAM_CODES.GAGE_HEIGHT_FT, USGS_PARAM_CODES.DISCHARGE_CFS],
            lat: sensor.lat,
            lon: sensor.lon,
            streamRelation: sensor.streamRelation ?? null,
            floodStages: (floodStagesBySiteNo.get(sensor.siteNo) as Prisma.InputJsonValue | undefined) ?? Prisma.JsonNull,
          })),
        });
      }

      return { orgId: org.id, subdomain: org.subdomain, personId: person.id };
    });
  } catch (error) {
    // The pre-checks above cover the common cases; this only fires on a
    // genuine race (two sign-ups for the same subdomain or sensor landing
    // in the same instant), which the unique constraints still catch.
    //
    // With the pg driver adapter (vs. Prisma's own query engine), P2002's
    // meta.target is never populated - verified against a real unique
    // violation locally. The constraint name instead lives at
    // meta.driverAdapterError.cause.constraint.index, so that's what gets
    // checked here rather than the target field the docs describe.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const constraintName = violatedConstraintName(error);
      if (constraintName?.includes("subdomain")) throw new SubdomainTakenError(subdomain);
      if (constraintName?.includes("external_id") || constraintName?.includes("externalId")) {
        throw new SensorsAlreadyClaimedError(input.sensors.map((s) => s.siteNo));
      }
    }
    throw error;
  }
}

function violatedConstraintName(error: Prisma.PrismaClientKnownRequestError): string | undefined {
  const meta = error.meta as
    | { target?: string[]; driverAdapterError?: { cause?: { constraint?: { index?: string } } } }
    | undefined;
  return meta?.target?.join(",") ?? meta?.driverAdapterError?.cause?.constraint?.index;
}
