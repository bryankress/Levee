// Twilio Programmable Messaging REST API.
// Docs: https://www.twilio.com/docs/messaging/api/message-resource
const TWILIO_API_BASE = "https://api.twilio.com/2010-04-01";

export interface SendSmsResult {
  sid: string;
  status: string;
}

export interface SendSmsParams {
  to: string;
  body: string;
}

/**
 * Sends one SMS via Twilio's Messages resource. Requires TWILIO_ACCOUNT_SID,
 * TWILIO_AUTH_TOKEN, and TWILIO_FROM_NUMBER in the environment - there's no
 * fallback "from" number, since a levee's outbound number is tied to its own
 * A2P 10DLC campaign registration, not something to default silently.
 */
export async function sendSms({ to, body }: SendSmsParams): Promise<SendSmsResult> {
  const accountSid = requireEnv("TWILIO_ACCOUNT_SID");
  const authToken = requireEnv("TWILIO_AUTH_TOKEN");
  const from = requireEnv("TWILIO_FROM_NUMBER");

  const url = `${TWILIO_API_BASE}/Accounts/${accountSid}/Messages.json`;
  const credentials = Buffer.from(`${accountSid}:${authToken}`).toString("base64");

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ To: to, From: from, Body: body }),
  });

  const payload = (await res.json()) as TwilioMessageResponse;
  if (!res.ok) {
    throw new Error(`Twilio send failed (${res.status}): ${payload.message ?? res.statusText}`);
  }

  return { sid: payload.sid, status: payload.status };
}

interface TwilioMessageResponse {
  sid: string;
  status: string;
  message?: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}
