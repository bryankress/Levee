"use client";

import { useActionState, useState } from "react";
import type { BillingInterval, OrgPlan } from "@/generated/prisma/client";
import { PLAN_FEATURES, PLAN_LABEL, PLAN_PRICES } from "@/lib/plans";
import { updatePlanAction, type SettingsActionState } from "./actions";
import styles from "./settings.module.css";

const initialState: SettingsActionState = {};
const PLANS: OrgPlan[] = ["FREE", "BASE", "GROWTH"];

export function PlanForm({
  plan: currentPlan,
  billingInterval: currentBillingInterval,
}: {
  plan: OrgPlan;
  billingInterval: BillingInterval;
}) {
  const [state, formAction, pending] = useActionState(updatePlanAction, initialState);
  const [plan, setPlan] = useState<OrgPlan>(currentPlan);
  const [billingInterval, setBillingInterval] = useState<BillingInterval>(currentBillingInterval);

  return (
    <form action={formAction} className={styles.section}>
      <h2>Plan</h2>
      <p className={styles.sectionHint}>What you&rsquo;re on today, and what upgrading unlocks.</p>

      {state.error && (
        <p className={styles.error} role="alert">
          {state.error}
        </p>
      )}
      {state.success && <p className={styles.success}>{state.success}</p>}

      <div className={styles.billingToggle}>
        <button
          type="button"
          className={billingInterval === "MONTHLY" ? styles.toggleActive : styles.toggle}
          onClick={() => setBillingInterval("MONTHLY")}
        >
          Monthly
        </button>
        <button
          type="button"
          className={billingInterval === "ANNUAL" ? styles.toggleActive : styles.toggle}
          onClick={() => setBillingInterval("ANNUAL")}
        >
          Annual (save ~20%)
        </button>
      </div>

      <div className={styles.planCards}>
        {PLANS.map((candidate) => (
          <button
            type="button"
            key={candidate}
            className={plan === candidate ? styles.planCardSelected : styles.planCard}
            onClick={() => setPlan(candidate)}
            aria-pressed={plan === candidate}
          >
            <div className={styles.planName}>{PLAN_LABEL[candidate]}</div>
            <div className={styles.planPrice}>
              ${PLAN_PRICES[candidate][billingInterval]}
              <span>/mo</span>
            </div>
            {candidate === currentPlan && <div className={styles.planCurrent}>Current plan</div>}
            <ul className={styles.planFeatures}>
              {PLAN_FEATURES[candidate].map((feature) => (
                <li key={feature}>{feature}</li>
              ))}
            </ul>
          </button>
        ))}
      </div>

      <input type="hidden" name="plan" value={plan} />
      <input type="hidden" name="billingInterval" value={billingInterval} />

      <p className={styles.billingNote}>
        No payment processor is connected yet, so choosing Base or Growth here won&rsquo;t charge you - it
        just records the plan you&rsquo;re on.
      </p>

      <div className={styles.actions}>
        <button
          type="submit"
          className={styles.primary}
          disabled={pending || (plan === currentPlan && billingInterval === currentBillingInterval)}
        >
          {pending ? "Saving…" : "Save plan"}
        </button>
      </div>
    </form>
  );
}
