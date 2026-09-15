"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { setSessionCookie } from "@/server/auth/session";
import {
  createOrganizationAndAccount,
  InvalidSubdomainError,
  SensorsAlreadyClaimedError,
  SubdomainTakenError,
  type SignupSensorInput,
} from "@/server/signup/createOrganization";
import { isLocalDevHost, ROOT_DOMAIN } from "@/server/tenancy/subdomain";

export interface SignupState {
  error?: string;
}

function parseSensors(raw: string | null): SignupSensorInput[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (entry): entry is { siteNo: string; name?: unknown; lat: number; lon: number; streamRelation?: unknown } =>
          !!entry &&
          typeof entry.siteNo === "string" &&
          typeof entry.lat === "number" &&
          typeof entry.lon === "number",
      )
      .map((entry) => ({
        siteNo: entry.siteNo,
        name: String(entry.name ?? ""),
        lat: entry.lat,
        lon: entry.lon,
        streamRelation:
          entry.streamRelation === "UPSTREAM" || entry.streamRelation === "DOWNSTREAM"
            ? entry.streamRelation
            : undefined,
      }));
  } catch {
    return [];
  }
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
  const riverName = String(formData.get("riverName") ?? "").trim();
  const leveeSummary = String(formData.get("leveeSummary") ?? "").trim();
  const orgName = String(formData.get("orgName") ?? "").trim();
  const subdomain = String(formData.get("subdomain") ?? "").trim().toLowerCase();
  const personName = String(formData.get("personName") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const phone = String(formData.get("phone") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const smsConsent = formData.get("smsConsent") === "on";
  const plan = formData.get("plan") === "GROWTH" ? "GROWTH" : "BASE";
  const billingInterval = formData.get("billingInterval") === "ANNUAL" ? "ANNUAL" : "MONTHLY";
  const sensors = parseSensors(formData.get("sensors") as string | null);

  if (!leveeName || !orgName || !subdomain || !personName || !email || !password) {
    return { error: "Fill in every required field." };
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
      sensors,
    });
  } catch (error) {
    if (
      error instanceof InvalidSubdomainError ||
      error instanceof SubdomainTakenError ||
      error instanceof SensorsAlreadyClaimedError
    ) {
      return { error: error.message };
    }
    throw error;
  }

  const cookieStore = await cookies();
  await setSessionCookie(cookieStore, result.personId);

  redirect(await subdomainUrl(result.subdomain));
}
