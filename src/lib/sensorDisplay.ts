export type Severity = "good" | "elevated" | "high";

export function severityOf(pct: number | undefined): Severity | undefined {
  if (pct === undefined) return undefined;
  if (pct >= 90) return "high";
  if (pct >= 70) return "elevated";
  return "good";
}

export const SEVERITY_LABEL: Record<Severity, string> = {
  good: "normal",
  elevated: "elevated",
  high: "high",
};

export const STREAM_RELATION_LABEL: Record<string, string> = {
  UPSTREAM: "Upstream",
  DOWNSTREAM: "Downstream",
  TRIBUTARY: "Tributary",
};

export function relationColor(relation: string | null | undefined): string {
  if (relation === "UPSTREAM") return "var(--brass)";
  if (relation === "DOWNSTREAM") return "var(--accent)";
  return "var(--ink-soft)";
}

/**
 * Undefined means "not enough data," distinct from a genuine zero rate.
 *
 * Rounds before comparing or formatting - confirmed in production that a
 * real, meaningful rate (two readings an hour apart, exactly -0.05 ft) can
 * land on the wrong side of a display rounding boundary purely from
 * floating-point subtraction noise (15.49 - 15.54 computes as
 * -0.049999999999998934, not -0.05), making a genuine "dropping half an
 * inch an hour" trend silently display as "0.0 ft/hr" (flat). Two decimals
 * (not one) because most sensors only have an hour or two of baseline this
 * early in the app's life, and real hour-to-hour river movement is
 * routinely sub-0.1 ft - one decimal place washes almost all of it out to
 * indistinguishable "0.0"s, matching USGS's own ~0.01ft gage-height
 * reporting precision.
 */
export function formatTrend(rate: number | undefined): { arrow: string; text: string } | undefined {
  if (rate === undefined) return undefined;
  const rounded = Math.round(rate * 100) / 100;
  const arrow = rounded > 0.005 ? "▲" : rounded < -0.005 ? "▼" : "·";
  const sign = rounded >= 0 ? "+" : "−";
  return { arrow, text: `${sign}${Math.abs(rounded).toFixed(2)} ft/hr` };
}
