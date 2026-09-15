// Postmark Email API.
// Docs: https://postmarkapp.com/developer/api/email-api
const POSTMARK_API_URL = "https://api.postmarkapp.com/email";

export interface SendEmailResult {
  messageId: string;
}

export interface SendEmailParams {
  to: string;
  subject: string;
  textBody: string;
}

/**
 * Sends one transactional email via Postmark. Requires POSTMARK_SERVER_TOKEN
 * and POSTMARK_FROM_EMAIL - the from address must be a sender signature or
 * domain already verified in Postmark, or the send fails at their end.
 */
export async function sendEmail({ to, subject, textBody }: SendEmailParams): Promise<SendEmailResult> {
  const serverToken = requireEnv("POSTMARK_SERVER_TOKEN");
  const from = requireEnv("POSTMARK_FROM_EMAIL");

  const res = await fetch(POSTMARK_API_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Postmark-Server-Token": serverToken,
    },
    body: JSON.stringify({ From: from, To: to, Subject: subject, TextBody: textBody }),
  });

  const payload = (await res.json()) as PostmarkEmailResponse;
  if (!res.ok) {
    throw new Error(`Postmark send failed (${res.status}): ${payload.Message ?? res.statusText}`);
  }

  return { messageId: payload.MessageID };
}

interface PostmarkEmailResponse {
  MessageID: string;
  Message?: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}
