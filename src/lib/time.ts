const relativeTimeFormat = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

export function formatRelativeTime(date: Date | null | undefined): string {
  if (!date) return "no data yet";

  const diffMinutes = Math.round((date.getTime() - Date.now()) / 60_000);
  if (Math.abs(diffMinutes) < 60) return relativeTimeFormat.format(diffMinutes, "minute");

  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 24) return relativeTimeFormat.format(diffHours, "hour");

  return relativeTimeFormat.format(Math.round(diffHours / 24), "day");
}

const STATION_TIME_RE = /^\d{4}-\d{2}-\d{2}T(\d{2}):(\d{2}):\d{2}(?:\.\d+)?([+-]\d{2}):?(\d{2})$/;

/**
 * Formats a USGS-style ISO timestamp (which carries the station's own UTC
 * offset, e.g. "2026-09-15T10:15:00.000-05:00") as an absolute local clock
 * time - using the offset embedded in the string itself, not the viewer's
 * browser timezone. An operator caring about a specific gauge wants that
 * station's own local time, which can differ from the visitor's.
 */
export function formatStationTime(iso: string): string | undefined {
  const match = STATION_TIME_RE.exec(iso);
  if (!match) return undefined;

  const [, hourStr, minute, offsetHourStr, offsetMinute] = match;
  const hour24 = Number(hourStr);
  const period = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 || 12;

  const offsetSign = offsetHourStr.startsWith("-") ? "-" : "+";
  const offsetHour = Number(offsetHourStr.slice(1));
  const offset = offsetMinute === "00" ? `UTC${offsetSign}${offsetHour}` : `UTC${offsetSign}${offsetHour}:${offsetMinute}`;

  return `${hour12}:${minute} ${period} (${offset})`;
}

const eventDateFormat = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" });
const eventTimeFormat = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });

/** "Thu, Sep 17" for an all-day-feeling event, "Thu, Sep 17 · 6:00 PM" once a real time is set. */
export function formatEventWhen(date: Date): string {
  const hasTimeOfDay = date.getHours() !== 0 || date.getMinutes() !== 0;
  const day = eventDateFormat.format(date);
  return hasTimeOfDay ? `${day} · ${eventTimeFormat.format(date)}` : day;
}
