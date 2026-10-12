import "server-only";

import { sendGreenApiMessage, maskWhatsAppDestination } from "./providers/green-api";
import { sendResendSensitiveCopy } from "./providers/resend";
import { maskEmail, recordProviderSubmission } from "./submissions";
import { compactText, shortReference } from "./compact";
import { OFFICIAL_PLATFORM_URL } from "./site-url";

type DecisionInput = {
  kind: "provider" | "contractor";
  action: "rejected" | "needs_changes";
  applicationId: string;
  applicantName: string;
  email: string;
  mobile: string;
  reason: string;
  revisionUrl?: string;
  idempotencyKey: string;
};

export async function sendJoinApplicantDecision(input: DecisionInput) {
  const rejected = input.action === "rejected";
  const subject = rejected
    ? `لم يُقبل طلبك #${shortReference(input.applicationId)}`
    : `طلبك يحتاج تعديلًا #${shortReference(input.applicationId)}`;
  const text = rejected
    ? `${compactText(input.applicantName, 60)}، ${subject}.\n${OFFICIAL_PLATFORM_URL}/support`
    : `${compactText(input.applicantName, 60)}، ${subject}.\nالتفاصيل والتعديل خلال 48 ساعة:\n${input.revisionUrl}`;

  const whatsappKey = `${input.idempotencyKey}-wa`;
  const emailKey = `${input.idempotencyKey}-email`;
  const [whatsapp, email] = await Promise.all([
    sendGreenApiMessage({ to: input.mobile, text, idempotencyKey: whatsappKey }),
    sendResendSensitiveCopy({ to: input.email, subject, text, idempotencyKey: emailKey }),
  ]);

  await Promise.all([
    recordProviderSubmission({
      eventType: `join.application_${input.action}`,
      channel: "whatsapp",
      destinationMasked: maskWhatsAppDestination(input.mobile),
      idempotencyKey: whatsappKey,
      result: whatsapp,
    }).catch(() => undefined),
    recordProviderSubmission({
      eventType: `join.application_${input.action}`,
      channel: "email",
      destinationMasked: maskEmail(input.email),
      idempotencyKey: emailKey,
      result: email,
    }).catch(() => undefined),
  ]);

  return { email, whatsapp };
}
