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

/**
 * The simplified signup form no longer asks for the admin's name - this
 * derives a starting display name from their email's local part (e.g.
 * "j.rivera@townlevee.org" -> "J Rivera") so Person.name has something
 * reasonable until they set their real name from Settings.
 */
function nameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? "";
  const words = local.replace(/[._+-]+/g, " ").trim();
  if (!words) return "Admin";
  return words
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export async function signupAction(_prevState: SignupState, formData: FormData): Promise<SignupState> {
  const orgName = String(formData.get("orgName") ?? "").trim();
  const address = String(formData.get("address") ?? "").trim();
  const zip = String(formData.get("zip") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!orgName || !email || !password) {
    return { error: "Fill in every required field." };
  }
  if (!/^\d{5}$/.test(zip)) {
    return { error: "Enter a 5-digit ZIP code - it's how we find your nearby sensors." };
  }
  if (password.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }

  let result;
  try {
    result = await createOrganizationAndAccount({
      // The org name doubles as the first levee's name for this simplified
      // form - a separate levee name, river, and summary are all editable
      // later from Settings.
      leveeName: orgName,
      leveeAddress: address,
      zip,
      riverName: "",
      leveeSummary: "",
      orgName,
      personName: nameFromEmail(email),
      email,
      phone: "",
      password,
      smsConsent: false,
      // Plan selection moved to Settings - every signup starts on Free.
      plan: "FREE",
      billingInterval: "MONTHLY",
    });
  } catch (error) {
    if (error instanceof InvalidSubdomainError || error instanceof SubdomainTakenError) {
      return { error: "Something went wrong setting up your account. Please try again." };
    }
    throw error;
  }

  const cookieStore = await cookies();
  await setSessionCookie(cookieStore, result.personId);

  redirect(await subdomainUrl(result.subdomain));
}
