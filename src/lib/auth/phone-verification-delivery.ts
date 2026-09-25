import "server-only";

import { createHash, randomBytes, randomInt } from "node:crypto";
import { after } from "next/server";
import { maskSaudiPhone } from "./phone-verification";
import { checkGreenApiWhatsApp, sendGreenApiMessage, type ProviderSubmission } from "@/lib/notifications/providers/green-api";
import { recordProviderSubmission } from "@/lib/notifications/submissions";
import { createAdminClient } from "@/lib/supabase/admin";

export class PhoneVerificationDeliveryError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

type DeliveryInput = {
  userId: string;
  phone: string;
  availabilityConfirmed?: boolean;
  respectResendCooldown?: boolean;
};

export type PhoneVerificationDelivery = {
  phone: string;
  message: string;
  submission: ProviderSubmission;
};

export async function issuePhoneVerificationCode({
  userId,
  phone,
  availabilityConfirmed = false,
  respectResendCooldown = true,
}: DeliveryInput): Promise<PhoneVerificationDelivery> {
  const admin = createAdminClient();
  const [duplicate, existing] = await Promise.all([
    admin.from("profiles").select("id").eq("mobile", phone).neq("id", userId).limit(1),
    admin.from("phone_verification_challenges").select("resend_after").eq("user_id", userId).maybeSingle(),
  ]);
  if (duplicate.error || existing.error) {
    throw new PhoneVerificationDeliveryError("تعذر تجهيز طلب التحقق حاليًا.", 500);
  }
  if (duplicate.data?.length) {
    throw new PhoneVerificationDeliveryError("رقم الجوال مستخدم في حساب موثّق آخر.", 409);
  }
  if (
    respectResendCooldown &&
    existing.data?.resend_after &&
    new Date(existing.data.resend_after).getTime() > Date.now()
  ) {
    throw new PhoneVerificationDeliveryError("انتظر دقيقة قبل إعادة إرسال الرمز.", 429);
  }

  if (!availabilityConfirmed) {
    const availability = await checkGreenApiWhatsApp(phone);
    if (availability.status === "not_available") {
      throw new PhoneVerificationDeliveryError("هذا الرقم غير مفعّل على واتساب. صحح الرقم أو استخدم رقمًا آخر.", 422);
    }
    if (availability.status !== "available") {
      throw new PhoneVerificationDeliveryError("تعذر التحقق من اتصال واتساب حاليًا. حاول بعد قليل.", 502);
    }
  }

  const code = String(randomInt(100000, 1000000));
  const salt = randomBytes(24).toString("hex");
  const codeHash = createHash("sha256").update(`${salt}:${code}`).digest("hex");
  const challenge = await admin.from("phone_verification_challenges").upsert({
    user_id: userId,
    phone,
    code_hash: codeHash,
    code_salt: salt,
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    resend_after: new Date(Date.now() + 60 * 1000).toISOString(),
    attempts: 0,
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id" });
  if (challenge.error) {
    const conflict = challenge.error.code === "23505";
    throw new PhoneVerificationDeliveryError(
      conflict ? "يوجد حساب آخر يحاول توثيق هذا الرقم حاليًا." : "تعذر حفظ طلب التحقق.",
      conflict ? 409 : 500,
    );
  }

  const idempotencyKey = `phone-verification-${userId}-${crypto.randomUUID()}`;
  const submission = await sendGreenApiMessage({
    to: phone,
    text: `رمز التحقق في منصة بُنية: ${code}\nلا تشارك هذا الرمز مع أي شخص. تنتهي صلاحيته خلال 10 دقائق.`,
    idempotencyKey,
    urgent: true,
  });
  after(() => recordProviderSubmission({
    eventType: "auth.phone_verification",
    channel: "whatsapp",
    destinationMasked: maskSaudiPhone(phone),
    idempotencyKey,
    result: submission,
  }).catch(() => undefined));

  if (submission.status !== "submitted") {
    await admin.from("phone_verification_challenges").delete().eq("user_id", userId);
    throw new PhoneVerificationDeliveryError("لم يقبل واتساب إرسال الرمز. صحح الرقم أو حاول بعد قليل.", 502);
  }

  return {
    phone,
    message: "أُرسل رمز التحقق عبر واتساب. أدخل الرمز الذي وصلك.",
    submission,
  };
}
