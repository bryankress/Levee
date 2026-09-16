"use server";

import { revalidatePath } from "next/cache";
import { requirePerson } from "@/server/auth/currentPerson";
import { prisma } from "@/server/db/client";
import { REMINDER_OFFSET_OPTIONS } from "@/lib/eventDisplay";

const VALID_TYPES = new Set(["MEETING", "MAINTENANCE", "CLEANUP"]);
const VALID_OFFSETS = new Set(REMINDER_OFFSET_OPTIONS.map((option) => option.minutes));
const DEFAULT_DURATION_MS = 60 * 60 * 1000;

export interface CalendarActionState {
  error?: string;
}

export async function createEventAction(_prevState: CalendarActionState, formData: FormData): Promise<CalendarActionState> {
  const person = await requirePerson();

  const title = String(formData.get("title") ?? "").trim();
  const type = String(formData.get("type") ?? "");
  const date = String(formData.get("date") ?? "");
  const time = String(formData.get("time") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();
  const notifyPersonIds = formData.getAll("notifyPersonIds").map(String);
  const offsetMinutes = Number(formData.get("reminderOffsetMinutes"));

  if (!title || !date) {
    return { error: "Give the event a title and a date." };
  }
  if (!VALID_TYPES.has(type)) {
    return { error: "Choose an event type." };
  }

  const startsAt = new Date(time ? `${date}T${time}` : `${date}T00:00`);
  if (Number.isNaN(startsAt.getTime())) {
    return { error: "That date/time isn't valid." };
  }
  const endsAt = new Date(startsAt.getTime() + DEFAULT_DURATION_MS);

  if (notifyPersonIds.length > 0 && !VALID_OFFSETS.has(offsetMinutes)) {
    return { error: "Choose when to send the notification." };
  }

  const levee = await prisma.levee.findFirst({ where: { orgId: person.orgId } });
  if (!levee) {
    return { error: "No levee is set up for this organization yet." };
  }

  // Notified people must actually belong to this org - never trust a
  // client-supplied id list to already be scoped correctly.
  const roster =
    notifyPersonIds.length > 0
      ? await prisma.person.findMany({ where: { id: { in: notifyPersonIds }, orgId: person.orgId }, select: { id: true } })
      : [];

  await prisma.event.create({
    data: {
      leveeId: levee.id,
      title,
      type: type as "MEETING" | "MAINTENANCE" | "CLEANUP",
      startsAt,
      endsAt,
      notes: notes || null,
      reminders: {
        create: roster.map((recipient) => ({ personId: recipient.id, offsetMinutes })),
      },
    },
  });

  revalidatePath("/calendar");
  revalidatePath("/");
  return {};
}

export async function deleteEventAction(eventId: string): Promise<void> {
  const person = await requirePerson();

  // Scoped through the levee's org, not a bare id match - a person can only
  // delete events that belong to their own organization.
  await prisma.event.deleteMany({ where: { id: eventId, levee: { orgId: person.orgId } } });

  revalidatePath("/calendar");
  revalidatePath("/");
}
