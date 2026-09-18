"use client";

import { useActionState, useState } from "react";
import { signupAction, type SignupState } from "./actions";
import styles from "./signup.module.css";

const initialState: SignupState = {};

type Plan = "FREE" | "BASE" | "GROWTH";

const PLAN_PRICES: Record<Plan, { MONTHLY: number; ANNUAL: number }> = {
  FREE: { MONTHLY: 0, ANNUAL: 0 },
  BASE: { MONTHLY: 49, ANNUAL: 39 },
  GROWTH: { MONTHLY: 99, ANNUAL: 79 },
};

const PLAN_NAME: Record<Plan, string> = { FREE: "Free", BASE: "Base", GROWTH: "Growth" };

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
}

export function SignupForm({ rootDomain }: { rootDomain: string }) {
  const [state, formAction, pending] = useActionState(signupAction, initialState);
  const [orgName, setOrgName] = useState("");
  const [subdomain, setSubdomain] = useState("");
  const [subdomainTouched, setSubdomainTouched] = useState(false);
  const [plan, setPlan] = useState<Plan>("FREE");
  const [billingInterval, setBillingInterval] = useState<"MONTHLY" | "ANNUAL">("MONTHLY");
  const [smsConsent, setSmsConsent] = useState(false);

  const price = PLAN_PRICES[plan][billingInterval];
  const isFree = plan === "FREE";

  function handleOrgNameChange(value: string) {
    setOrgName(value);
    if (!subdomainTouched) setSubdomain(slugify(value));
  }

  return (
    <form action={formAction} className={styles.form}>
      {state.error && (
        <p className={styles.error} role="alert">
          {state.error}
        </p>
      )}

      <section className={styles.section}>
        <div className={styles.sectionHead}>01 · Your levee</div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="leveeName">
            Levee name
          </label>
          <input className={styles.input} id="leveeName" name="leveeName" required />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="leveeAddress">
            Address
          </label>
          <input className={styles.input} id="leveeAddress" name="leveeAddress" />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="zip">
            ZIP code
          </label>
          <input
            className={styles.input}
            id="zip"
            name="zip"
            inputMode="numeric"
            pattern="\d{5}"
            maxLength={5}
            placeholder="64501"
            required
          />
          <div className={styles.hint}>
            We&rsquo;ll automatically find and start tracking the nearest river sensors for you - no search
            needed.
          </div>
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="riverName">
            River
          </label>
          <input className={styles.input} id="riverName" name="riverName" />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="leveeSummary">
            Summary
          </label>
          <textarea className={styles.textarea} id="leveeSummary" name="leveeSummary" rows={3} />
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}>02 · Your organization</div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="orgName">
            Organization name
          </label>
          <input
            className={styles.input}
            id="orgName"
            name="orgName"
            value={orgName}
            onChange={(event) => handleOrgNameChange(event.target.value)}
            required
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="subdomain">
            Subdomain
          </label>
          <div className={styles.subdomainRow}>
            <input
              className={styles.input}
              id="subdomain"
              name="subdomain"
              value={subdomain}
              onChange={(event) => {
                setSubdomainTouched(true);
                setSubdomain(slugify(event.target.value));
              }}
              required
            />
            <span className={styles.subdomainSuffix}>.{rootDomain}</span>
          </div>
          <div className={styles.hint}>
            Your portal will live at {subdomain || "yourdistrict"}.{rootDomain}
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}>03 · Your account</div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="personName">
            Your name
          </label>
          <input className={styles.input} id="personName" name="personName" required />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="email">
            Email
          </label>
          <input className={styles.input} id="email" name="email" type="email" autoComplete="email" required />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="phone">
            Phone
          </label>
          <input className={styles.input} id="phone" name="phone" type="tel" autoComplete="tel" />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="password">
            Password
          </label>
          <input
            className={styles.input}
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
          />
        </div>

        <label className={styles.checkboxRow}>
          <input
            type="checkbox"
            name="smsConsent"
            checked={smsConsent}
            onChange={(event) => setSmsConsent(event.target.checked)}
          />
          <span>
            Send text alerts to the phone number above. Message and data rates may apply; reply STOP to
            opt out at any time.
          </span>
        </label>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}>04 · Choose a plan</div>

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
          <PlanCard
            name="Free"
            price={0}
            billingInterval={billingInterval}
            selected={plan === "FREE"}
            onSelect={() => setPlan("FREE")}
            features={["2 sensors, hand-picked for you", "Email alerts", "1 levee district"]}
          />
          <PlanCard
            name="Base"
            price={PLAN_PRICES.BASE[billingInterval]}
            billingInterval={billingInterval}
            selected={plan === "BASE"}
            onSelect={() => setPlan("BASE")}
            features={["Up to 10 sensors", "SMS + email alerts", "1 levee district"]}
          />
          <PlanCard
            name="Growth"
            price={PLAN_PRICES.GROWTH[billingInterval]}
            billingInterval={billingInterval}
            selected={plan === "GROWTH"}
            onSelect={() => setPlan("GROWTH")}
            features={["Unlimited sensors", "SMS + email alerts", "Multiple levee districts"]}
          />
        </div>
        <input type="hidden" name="plan" value={plan} />
        <input type="hidden" name="billingInterval" value={billingInterval} />

        <p className={styles.billingNote}>
          {isFree ? (
            <>No payment is ever collected on the Free plan - you&rsquo;re signing up for Free, $0/mo.</>
          ) : (
            <>
              No payment is collected here — billing setup comes after your account is created. You&rsquo;re
              choosing {PLAN_NAME[plan]} at ${price}/mo
              {billingInterval === "ANNUAL" ? " (billed annually)" : ""}.
            </>
          )}
        </p>
      </section>

      <button className={styles.submit} type="submit" disabled={pending}>
        {pending ? "Creating your district…" : "Create your district"}
      </button>
    </form>
  );
}

function PlanCard({
  name,
  price,
  billingInterval,
  selected,
  onSelect,
  features,
}: {
  name: string;
  price: number;
  billingInterval: "MONTHLY" | "ANNUAL";
  selected: boolean;
  onSelect: () => void;
  features: string[];
}) {
  return (
    <button
      type="button"
      className={selected ? styles.planCardSelected : styles.planCard}
      onClick={onSelect}
      aria-pressed={selected}
    >
      <div className={styles.planName}>{name}</div>
      <div className={styles.planPrice}>
        ${price}
        <span>/mo</span>
      </div>
      {price > 0 && billingInterval === "ANNUAL" && <div className={styles.planBilled}>billed annually</div>}
      <ul className={styles.planFeatures}>
        {features.map((feature) => (
          <li key={feature}>{feature}</li>
        ))}
      </ul>
    </button>
  );
}
