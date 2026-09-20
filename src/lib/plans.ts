import type { OrgPlan } from "@/generated/prisma/client";

// Shared between server actions (sensor-cap enforcement) and client
// components (showing remaining capacity, disabling "add" once at cap) -
// same reasoning as searchConfig.ts for why these live in a plain lib file
// rather than a "use server" module.

/** The hard ceiling on how many sensors an org of this plan may ever track. GROWTH is intentionally uncapped. */
export const SENSOR_CAP_BY_PLAN: Record<OrgPlan, number> = {
  FREE: 2,
  BASE: 10,
  GROWTH: Infinity,
};

/**
 * How many sensors the automatic post-signup background search picks on the
 * district's behalf - always at or under SENSOR_CAP_BY_PLAN for the same
 * plan, since a Free org's whole 2-sensor allowance is spent on the initial
 * pick, while a paid org's pick leaves room to add more themselves
 * (BASE: 7 auto-picked + up to 3 more; GROWTH: 7 auto-picked, no cap on
 * adding further).
 */
export const AUTO_SELECT_COUNT_BY_PLAN: Record<OrgPlan, number> = {
  FREE: 2,
  BASE: 7,
  GROWTH: 7,
};

export const PLAN_LABEL: Record<OrgPlan, string> = {
  FREE: "Free",
  BASE: "Base",
  GROWTH: "Growth",
};

/**
 * The hard ceiling on how many people (Person rows - roster + portal admins
 * together) an org of this plan may ever have. The admin created at signup
 * already counts as the first of a Free org's two. GROWTH and BASE are
 * intentionally uncapped.
 */
export const CONTACT_CAP_BY_PLAN: Record<OrgPlan, number> = {
  FREE: 2,
  BASE: Infinity,
  GROWTH: Infinity,
};

/** Shown from Settings when choosing a plan - no payment processor is wired up yet, see Organization.plan. */
export const PLAN_PRICES: Record<OrgPlan, { MONTHLY: number; ANNUAL: number }> = {
  FREE: { MONTHLY: 0, ANNUAL: 0 },
  BASE: { MONTHLY: 49, ANNUAL: 39 },
  GROWTH: { MONTHLY: 99, ANNUAL: 79 },
};

export const PLAN_FEATURES: Record<OrgPlan, string[]> = {
  FREE: ["2 sensors, hand-picked for you", "2 contacts total", "Email alerts", "1 levee district"],
  BASE: ["Up to 10 sensors", "Unlimited contacts", "SMS + email alerts", "1 levee district"],
  GROWTH: ["Unlimited sensors", "Unlimited contacts", "SMS + email alerts", "Multiple levee districts"],
};
