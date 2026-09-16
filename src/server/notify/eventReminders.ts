import { prisma } from "@/server/db/client";
import { sendEmail } from "@/server/integrations/postmark";
import { REMINDER_OFFSET_OPTIONS, reminderOffsetLabel } from "@/lib/eventDisplay";
import { formatEventWhen } from "@/lib/time";

const MAX_OFFSET_MS = Math.max(...REMINDER_OFFSET_OPTIONS.map((option) => option.minutes)) * 60_000;

export interface EventReminderOutcome {
  reminderId: string;
  status: "SENT" | "FAILED" | "SKIPPED";
}

// A reminder found this much past its due time is treated as missed rather
// than sent - better to skip a stale "starting now" email than have it land
// hours after the fact because the worker was briefly down.
const STALE_GRACE_MS = 60 * 60 * 1000;

/**
 * Sends every EventReminder whose due time (Event.startsAt minus its
 * offsetMinutes) has arrived and hasn't been sent yet. Delivered by email
 * only - Person.email is required on every roster entry, unlike phone/SMS
 * consent, which the calendar's roster picker doesn't collect.
 */
export async function dispatchDueEventReminders(): Promise<EventReminderOutcome[]> {
  const now = Date.now();

  const candidates = await prisma.eventReminder.findMany({
    // A coarse pre-filter, not the real "is it due" check (that needs each
    // reminder's own offsetMinutes) - just bounds the query to events whose
    // reminders could possibly be due by now, using the widest offset offered.
    where: { sentAt: null, event: { startsAt: { gte: new Date(now - STALE_GRACE_MS - MAX_OFFSET_MS) } } },
    include: { event: true, person: true },
  });

  const due = candidates.filter((reminder) => reminder.event.startsAt.getTime() - reminder.offsetMinutes * 60_000 <= now);

  const outcomes: EventReminderOutcome[] = [];
  for (const reminder of due) {
    const dueAt = reminder.event.startsAt.getTime() - reminder.offsetMinutes * 60_000;

    if (now - dueAt > STALE_GRACE_MS) {
      await prisma.eventReminder.update({
        where: { id: reminder.id },
        data: { sentAt: new Date(), error: "Skipped - too late to send." },
      });
      outcomes.push({ reminderId: reminder.id, status: "SKIPPED" });
      continue;
    }

    try {
      await sendEmail({
        to: reminder.person.email,
        subject: `Reminder: ${reminder.event.title}`,
        textBody: `${reminder.event.title} — ${formatEventWhen(reminder.event.startsAt)} (${reminderOffsetLabel(reminder.offsetMinutes)}).${reminder.event.notes ? `\n\n${reminder.event.notes}` : ""}`,
      });
      await prisma.eventReminder.update({ where: { id: reminder.id }, data: { sentAt: new Date() } });
      outcomes.push({ reminderId: reminder.id, status: "SENT" });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await prisma.eventReminder.update({ where: { id: reminder.id }, data: { sentAt: new Date(), error: errorMessage } });
      outcomes.push({ reminderId: reminder.id, status: "FAILED" });
    }
  }

  return outcomes;
}
