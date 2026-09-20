import type { BillingInterval, OrgPlan } from "@/generated/prisma/client";
import { Prisma } from "@/generated/prisma/client";
import { hashPassword } from "@/server/auth/password";
import { prisma } from "@/server/db/client";
import { USGS_PARAM_CODES } from "@/server/integrations/usgs";
import { findFloodStagesForSiteNos } from "@/server/discovery/nwpsCrosswalk";
import { syncSensor, IMMEDIATE_SYNC_TIMEOUT_MS } from "@/server/ingest/syncSensor";
import { autoPopulateSensorsForZip, type AutoPopulatedSensor } from "./autoPopulateSensors";
import {
  assertValidSubdomain,
  generateAvailableSubdomain,
  InvalidSubdomainError,
  SubdomainTakenError,
} from "@/server/tenancy/subdomain";

export { InvalidSubdomainError, SubdomainTakenError };

export interface SignupInput {
  leveeName: string;
  leveeAddress: string;
  /** Drives the automatic post-signup sensor search (see autoPopulateSensors.ts) - never shown back to the visitor, no search step for them to see or interact with. */
  zip: string;
  riverName: string;
  leveeSummary: string;
  orgName: string;
  personName: string;
  email: string;
  phone: string;
  password: string;
  smsConsent: boolean;
  plan: OrgPlan;
  billingInterval: BillingInterval;
}

export interface SignupResult {
  orgId: string;
  subdomain: string;
  personId: string;
}

/**
 * The app's first real multi-table write: creates an Organization, its first
 * Levee, an ADMIN Person, and whatever sensors the automatic background
 * search picked for the given ZIP and plan (see autoPopulateSensors.ts) -
 * all inside one transaction, so a failure partway through never leaves a
 * half-created org behind. Sensor selection itself already excludes
 * anything claimed by another org before this function ever sees it, so
 * there's no user-facing "already claimed" error to surface here the way an
 * interactive pick-your-own-sensors flow would need - only the unique
 * constraint's own rare-race fallback in the catch block below.
 */
export async function createOrganizationAndAccount(input: SignupInput): Promise<SignupResult> {
  // The simplified signup form no longer asks for a subdomain - it's derived
  // from the organization name instead, and stays editable later from Settings.
  const subdomain = await generateAvailableSubdomain(input.orgName);
  assertValidSubdomain(subdomain);

  // Both real third-party-touching steps happen outside the transaction
  // below - a DB transaction has no business staying open across a live
  // search + per-gauge NWPS fetches. See autoPopulateSensorsForZip and
  // findFloodStagesForSiteNos for why each is best-effort: an unrecognized
  // ZIP, a search failure, or a missing threshold all degrade gracefully
  // rather than blocking signup.
  const sensors: AutoPopulatedSensor[] = await autoPopulateSensorsForZip(input.zip, input.plan);
  const floodStagesBySiteNo = await findFloodStagesForSiteNos(
    sensors.map((sensor) => ({ siteNo: sensor.siteNo, name: sensor.name })),
  );

  const passwordHash = await hashPassword(input.password);

  try {
    const result = await prisma.$transaction(async (tx) => {
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

      if (sensors.length > 0) {
        // skipDuplicates, not a plain createMany - a rare race where someone
        // else claims one of these exact sites between
        // autoPopulateSensorsForZip's own check and this transaction should
        // silently drop that one sensor, not fail the whole signup (no
        // interactive picker exists anymore for the visitor to retry with
        // different sensors).
        await tx.sensor.createMany({
          skipDuplicates: true,
          data: sensors.map((sensor) => ({
            leveeId: levee.id,
            source: "USGS",
            externalId: sensor.siteNo,
            // The friendly name the background search already resolved -
            // never re-derived later, so it persists exactly as found.
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

    // Outside the transaction, same reasoning as the flood-stage fetch above -
    // a real third-party call has no business holding one open. This is the
    // very first thing a new customer sees right after signing up, so it's
    // worth an immediate best-effort pull rather than leaving them looking at
    // "no sensor data synced yet" until the worker's next scheduled poll.
    if (sensors.length > 0) {
      const createdSensors = await prisma.sensor.findMany({
        where: { levee: { orgId: result.orgId }, source: "USGS" },
        select: { id: true, source: true, externalId: true, paramCodes: true },
      });
      await Promise.allSettled(
        createdSensors.map((sensor) => syncSensor(sensor, AbortSignal.timeout(IMMEDIATE_SYNC_TIMEOUT_MS))),
      );
    }

    return result;
  } catch (error) {
    // The subdomain pre-check above covers the common case; this only fires
    // on a genuine race (two sign-ups for the same subdomain landing in the
    // same instant), which the unique constraint still catches. A sensor
    // getting claimed by someone else in the tiny window between
    // autoPopulateSensorsForZip's own check and this transaction is
    // vanishingly rare and, unlike before, isn't something the visitor
    // picked themselves to retry around - so it's swallowed (the sensor
    // silently doesn't get added) rather than surfaced as a signup error.
    //
    // With the pg driver adapter (vs. Prisma's own query engine), P2002's
    // meta.target is never populated - verified against a real unique
    // violation locally. The constraint name instead lives at
    // meta.driverAdapterError.cause.constraint.index, so that's what gets
    // checked here rather than the target field the docs describe.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const constraintName = violatedConstraintName(error);
      if (constraintName?.includes("subdomain")) throw new SubdomainTakenError(subdomain);
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
