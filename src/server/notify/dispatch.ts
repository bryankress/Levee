import { prisma } from "@/server/db/client";
import { NotificationChannel, type Person } from "@/generated/prisma/client";
import { sendEmail } from "@/server/integrations/postmark";
import { sendSms } from "@/server/integrations/twilio";

export interface RuleAction {
  channel: "sms" | "email" | "both";
  who: string[];
}

export interface DispatchOutcome {
  personId: string;
  channel: NotificationChannel;
  status: "SENT" | "FAILED";
  error?: string;
}

/**
 * Sends one triggered rule's message to everyone its action names, over
 * every channel it names, and logs each attempt as a Notification row -
 * the Notification Log screen's data source, and eventually a billing-period
 * message count. Never texts someone without sms_consent_at on file, even if
 * a rule's action lists them - TCPA consent is per person, not per rule.
 */
export async function dispatchRuleTrigger(ruleId: string, message: string): Promise<DispatchOutcome[]> {
  const rule = await prisma.rule.findUniqueOrThrow({ where: { id: ruleId } });
  const action = parseRuleAction(rule.action);
  if (!action) {
    throw new Error(`Rule ${ruleId} has an invalid action shape - expected { channel: "sms"|"email"|"both", who: string[] }.`);
  }

  const people = await prisma.person.findMany({ where: { id: { in: action.who } } });
  const channels = resolveChannels(action.channel);

  const outcomes: DispatchOutcome[] = [];
  for (const person of people) {
    for (const channel of channels) {
      outcomes.push(await dispatchOne(ruleId, person, channel, message));
    }
  }
  return outcomes;
}

async function dispatchOne(
  ruleId: string,
  person: Person,
  channel: NotificationChannel,
  message: string,
): Promise<DispatchOutcome> {
  if (channel === NotificationChannel.SMS && !person.smsConsentAt) {
    await prisma.notification.create({
      data: {
        ruleId,
        personId: person.id,
        channel,
        body: message,
        status: "FAILED",
        error: "No SMS consent on file for this person.",
      },
    });
    return { personId: person.id, channel, status: "FAILED", error: "No SMS consent on file for this person." };
  }

  const notification = await prisma.notification.create({
    data: { ruleId, personId: person.id, channel, body: message, status: "PENDING" },
  });

  try {
    const providerId =
      channel === NotificationChannel.SMS
        ? (await sendSms({ to: requirePhone(person), body: message })).sid
        : (await sendEmail({ to: person.email, subject: "Levee Buddy alert", textBody: message })).messageId;

    await prisma.notification.update({
      where: { id: notification.id },
      data: { status: "SENT", providerId, sentAt: new Date() },
    });
    return { personId: person.id, channel, status: "SENT" };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await prisma.notification.update({
      where: { id: notification.id },
      data: { status: "FAILED", error: errorMessage },
    });
    return { personId: person.id, channel, status: "FAILED", error: errorMessage };
  }
}

function requirePhone(person: Person): string {
  if (!person.phone) throw new Error(`Person ${person.id} has no phone number on file.`);
  return person.phone;
}

function resolveChannels(channel: RuleAction["channel"]): NotificationChannel[] {
  if (channel === "both") return [NotificationChannel.SMS, NotificationChannel.EMAIL];
  return [channel === "sms" ? NotificationChannel.SMS : NotificationChannel.EMAIL];
}

function parseRuleAction(value: unknown): RuleAction | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { channel, who } = value as Record<string, unknown>;

  if (channel !== "sms" && channel !== "email" && channel !== "both") return undefined;
  if (!Array.isArray(who) || !who.every((entry) => typeof entry === "string")) return undefined;

  return { channel, who };
}
