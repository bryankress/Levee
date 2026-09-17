"use server";

import { revalidatePath } from "next/cache";
import { requirePerson } from "@/server/auth/currentPerson";
import { prisma } from "@/server/db/client";
import { USGS_PARAM_CODES, isPlausibleUsgsSiteNo } from "@/server/integrations/usgs";

export interface AddSensorInput {
  siteNo: string;
  name: string;
  lat: number;
  lon: number;
  streamRelation?: "UPSTREAM" | "DOWNSTREAM";
}

export interface AddSensorsState {
  error?: string;
  addedCount?: number;
}

/**
 * Adds sensors to the signed-in person's org's (first) levee - the
 * "+ Sensor" flow's confirm step. A site number already tracked by *this*
 * org is silently skipped (idempotent - the search UI shows it pre-checked
 * and locked, so this only happens if someone re-submits a stale result);
 * one already tracked by a *different* org is a real conflict, same
 * "already claimed" rule signup enforces, since a USGS site can only ever
 * back one Sensor row system-wide.
 */
export async function addSensorsAction(sensors: AddSensorInput[]): Promise<AddSensorsState> {
  const person = await requirePerson();
  // A defensive server-side check, not just trusting the search UI's own
  // selection guard: this unconditionally records source: "USGS" below, so
  // a non-USGS discovery result (e.g. a CWMS location's "cwms:<office>:
  // <name>" id) must never reach that far, however it got here.
  sensors = sensors.filter((sensor) => isPlausibleUsgsSiteNo(sensor.siteNo));
  if (sensors.length === 0) {
    return { error: "Select at least one sensor to add." };
  }

  const levee = await prisma.levee.findFirst({ where: { orgId: person.orgId } });
  if (!levee) {
    return { error: "No levee is set up for this organization yet." };
  }

  const siteNos = sensors.map((sensor) => sensor.siteNo);
  const existing = await prisma.sensor.findMany({
    where: { source: "USGS", externalId: { in: siteNos } },
    select: { externalId: true, leveeId: true },
  });

  const claimedByOthers = existing.filter((sensor) => sensor.leveeId !== levee.id).map((sensor) => sensor.externalId);
  if (claimedByOthers.length > 0) {
    return { error: `Already monitored by another district: ${claimedByOthers.join(", ")}` };
  }

  const alreadyOwned = new Set(existing.map((sensor) => sensor.externalId));
  const toAdd = sensors.filter((sensor) => !alreadyOwned.has(sensor.siteNo));

  if (toAdd.length > 0) {
    await prisma.sensor.createMany({
      data: toAdd.map((sensor) => ({
        leveeId: levee.id,
        source: "USGS",
        externalId: sensor.siteNo,
        name: sensor.name || null,
        paramCodes: [USGS_PARAM_CODES.GAGE_HEIGHT_FT, USGS_PARAM_CODES.DISCHARGE_CFS],
        lat: sensor.lat,
        lon: sensor.lon,
        streamRelation: sensor.streamRelation ?? null,
      })),
    });
  }

  revalidatePath("/sensors");
  revalidatePath("/");
  return { addedCount: toAdd.length };
}

/**
 * Removes one sensor from the roster - the row menu's only action for now.
 * Scoped through the levee's own orgId, not a bare id match, so a person
 * can only ever remove a sensor that belongs to their own organization.
 */
export async function removeSensorAction(sensorId: string): Promise<void> {
  const person = await requirePerson();
  await prisma.sensor.deleteMany({ where: { id: sensorId, levee: { orgId: person.orgId } } });

  revalidatePath("/sensors");
  revalidatePath("/");
}
