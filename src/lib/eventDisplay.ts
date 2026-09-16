import type { EventType } from "@/generated/prisma/client";

export const EVENT_TYPE_LABEL: Record<EventType, string> = {
  MEETING: "Meeting",
  MAINTENANCE: "Maintenance",
  CLEANUP: "Clean-up",
};

/**
 * How long before Event.startsAt a reminder fires, in minutes - the choices
 * offered on the "notify who / when" form. 0 means "at start time."
 */
export const REMINDER_OFFSET_OPTIONS: { minutes: number; label: string }[] = [
  { minutes: 0, label: "At start time" },
  { minutes: 15, label: "15 minutes before" },
  { minutes: 60, label: "1 hour before" },
  { minutes: 1_440, label: "1 day before" },
  { minutes: 2_880, label: "2 days before" },
  { minutes: 10_080, label: "1 week before" },
];

export function reminderOffsetLabel(minutes: number): string {
  const match = REMINDER_OFFSET_OPTIONS.find((option) => option.minutes === minutes);
  if (match) return match.label;
  return minutes === 0 ? "At start time" : `${minutes} min before`;
}
