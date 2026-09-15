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

/** Undefined means "not enough data," distinct from a genuine zero rate. */
export function formatTrend(rate: number | undefined): { arrow: string; text: string } | undefined {
  if (rate === undefined) return undefined;
  const arrow = rate > 0.05 ? "▲" : rate < -0.05 ? "▼" : "·";
  const sign = rate >= 0 ? "+" : "−";
  return { arrow, text: `${sign}${Math.abs(rate).toFixed(1)} ft/hr` };
}
