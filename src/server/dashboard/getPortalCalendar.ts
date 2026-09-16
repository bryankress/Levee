import type { Event } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";

export interface CalendarReminder {
  personId: string;
  personName: string;
  offsetMinutes: number;
  sentAt: Date | null;
}

export interface CalendarEvent extends Event {
  reminders: CalendarReminder[];
}

export interface PortalCalendarData {
  levee: { id: string; name: string } | undefined;
  upcomingEvents: CalendarEvent[];
  pastEvents: CalendarEvent[];
  /** The org's roster, for the "notify who" picker - same source as the Personnel page. */
  roster: { id: string; name: string }[];
}

/**
 * Every event for one org's (first) levee - same single-levee simplification
 * as getPortalHome/getPortalSensors - split into upcoming (soonest first) and
 * past (most recent first), with each event's reminder roster attached.
 */
export async function getPortalCalendar(orgId: string): Promise<PortalCalendarData> {
  const levee = await prisma.levee.findFirst({ where: { orgId } });

  const [events, roster] = await Promise.all([
    levee
      ? prisma.event.findMany({
          where: { leveeId: levee.id },
          orderBy: { startsAt: "asc" },
          include: { reminders: { include: { person: { select: { id: true, name: true } } } } },
        })
      : Promise.resolve([]),
    prisma.person.findMany({ where: { orgId }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  const calendarEvents: CalendarEvent[] = events.map((event) => ({
    ...event,
    reminders: event.reminders.map((reminder) => ({
      personId: reminder.personId,
      personName: reminder.person.name,
      offsetMinutes: reminder.offsetMinutes,
      sentAt: reminder.sentAt,
    })),
  }));

  const now = Date.now();
  const upcomingEvents = calendarEvents.filter((event) => event.startsAt.getTime() >= now);
  const pastEvents = calendarEvents
    .filter((event) => event.startsAt.getTime() < now)
    .sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime());

  return {
    levee: levee ? { id: levee.id, name: levee.name } : undefined,
    upcomingEvents,
    pastEvents,
    roster,
  };
}
