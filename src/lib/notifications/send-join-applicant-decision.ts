import "server-only";

import { sendGreenApiMessage, maskWhatsAppDestination } from "./providers/green-api";
import { sendResendSensitiveCopy } from "./providers/resend";
import { maskEmail, recordProviderSubmission } from "./submissions";

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
  const role = input.kind === "provider" ? "مزود" : "مقاول";
  const rejected = input.action === "rejected";
  const subject = rejected
    ? `قرار طلب الانضمام رقم ${input.applicationId}`
    : `طلب تعديل على طلب الانضمام رقم ${input.applicationId}`;
  const text = rejected
    ? `مرحبًا ${input.applicantName}،\nتعذر اعتماد طلب انضمامك كـ${role} في منصة بُنية.\nرقم الطلب: ${input.applicationId}\nسبب الرفض: ${input.reason}\nيمكنك التواصل مع إدارة منصة بُنية عند الحاجة.`
    : `مرحبًا ${input.applicantName}،\nطلب الانضمام رقم ${input.applicationId} يحتاج إلى تعديل.\nالتعديل المطلوب: ${input.reason}\n\nرابط تعديل الطلب: ${input.revisionUrl}\nالرابط صالح لمدة 48 ساعة ولمرة إعادة إرسال واحدة فقط، وبعد الإرسال يُلغى تلقائيًا.`;

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
