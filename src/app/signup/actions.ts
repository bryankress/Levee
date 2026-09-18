"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { setSessionCookie } from "@/server/auth/session";
import {
  createOrganizationAndAccount,
  InvalidSubdomainError,
  SubdomainTakenError,
} from "@/server/signup/createOrganization";
import { isLocalDevHost, ROOT_DOMAIN } from "@/server/tenancy/subdomain";

export interface SignupState {
  error?: string;
}

/**
 * The redirect target depends on the request's own host rather than always
 * assuming ROOT_DOMAIN: local dev reaches this via *.localhost (proxy.ts's
 * own dev accommodation), and a hardcoded leveebuddy.com redirect would send
 * a local test session out to the real internet domain instead.
 */
async function subdomainUrl(subdomain: string): Promise<string> {
  const headerList = await headers();
  const host = headerList.get("host") ?? ROOT_DOMAIN;
  const [hostname, port] = host.split(":");
  const isLocal = isLocalDevHost(hostname);

  const protocol = isLocal ? "http" : "https";
  const targetHost = isLocal ? `${subdomain}.localhost${port ? `:${port}` : ""}` : `${subdomain}.${ROOT_DOMAIN}`;
  return `${protocol}://${targetHost}/`;
}

export async function signupAction(_prevState: SignupState, formData: FormData): Promise<SignupState> {
  const leveeName = String(formData.get("leveeName") ?? "").trim();
  const leveeAddress = String(formData.get("leveeAddress") ?? "").trim();
  const zip = String(formData.get("zip") ?? "").trim();
  const riverName = String(formData.get("riverName") ?? "").trim();
  const leveeSummary = String(formData.get("leveeSummary") ?? "").trim();
  const orgName = String(formData.get("orgName") ?? "").trim();
  const subdomain = String(formData.get("subdomain") ?? "").trim().toLowerCase();
  const personName = String(formData.get("personName") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const phone = String(formData.get("phone") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const smsConsent = formData.get("smsConsent") === "on";
  const planRaw = formData.get("plan");
  const plan = planRaw === "FREE" || planRaw === "GROWTH" ? planRaw : "BASE";
  const billingInterval = formData.get("billingInterval") === "ANNUAL" ? "ANNUAL" : "MONTHLY";

  if (!leveeName || !orgName || !subdomain || !personName || !email || !password) {
    return { error: "Fill in every required field." };
  }
  if (!/^\d{5}$/.test(zip)) {
    return { error: "Enter a 5-digit ZIP code for your levee - it's how we find your nearby sensors." };
  }
  if (password.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }
  if (smsConsent && !phone) {
    return { error: "Add a phone number to receive text alerts." };
  }

  let result;
  try {
    result = await createOrganizationAndAccount({
      leveeName,
      leveeAddress,
      zip,
      riverName,
      leveeSummary,
      orgName,
      subdomain,
      personName,
      email,
      phone,
      password,
      smsConsent,
      plan,
      billingInterval,
    });
  } catch (error) {
    if (error instanceof InvalidSubdomainError || error instanceof SubdomainTakenError) {
      return { error: error.message };
    }
    throw error;
  }

  const cookieStore = await cookies();
  await setSessionCookie(cookieStore, result.personId);

  redirect(await subdomainUrl(result.subdomain));
}
