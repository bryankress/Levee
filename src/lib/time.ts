const relativeTimeFormat = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

export function formatRelativeTime(date: Date | null | undefined): string {
  if (!date) return "no data yet";

  const diffMinutes = Math.round((date.getTime() - Date.now()) / 60_000);
  if (Math.abs(diffMinutes) < 60) return relativeTimeFormat.format(diffMinutes, "minute");

  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 24) return relativeTimeFormat.format(diffHours, "hour");

  return relativeTimeFormat.format(Math.round(diffHours / 24), "day");
}

const eventDateFormat = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" });
const eventTimeFormat = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });

/** "Thu, Sep 17" for an all-day-feeling event, "Thu, Sep 17 · 6:00 PM" once a real time is set. */
export function formatEventWhen(date: Date): string {
  const hasTimeOfDay = date.getHours() !== 0 || date.getMinutes() !== 0;
  const day = eventDateFormat.format(date);
  return hasTimeOfDay ? `${day} · ${eventTimeFormat.format(date)}` : day;
}
