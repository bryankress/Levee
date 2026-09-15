"use server";

import { redirect } from "next/navigation";
import { InvalidCredentialsError, login } from "@/server/auth/login";

export interface LoginState {
  error?: string;
}

export async function loginAction(orgId: string, _prevState: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Enter both an email and a password." };
  }

  try {
    await login(orgId, email, password);
  } catch (error) {
    if (error instanceof InvalidCredentialsError) {
      return { error: error.message };
    }
    throw error;
  }

  redirect("/");
}
