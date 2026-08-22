import { createHash, randomBytes, randomInt } from "node:crypto";
import { after, type NextRequest, NextResponse } from "next/server";
import { normalizeSaudiPhone, requiresPhoneVerification, maskSaudiPhone } from "@/lib/auth/phone-verification";
import { resolveAuthIdentity } from "@/lib/auth/resolve-identity";
import { assertSameOrigin, enforceRateLimit, PublicJoinError } from "@/lib/join/security";
import { checkGreenApiWhatsApp, sendGreenApiMessage } from "@/lib/notifications/providers/green-api";
import { recordProviderSubmission } from "@/lib/notifications/submissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return NextResponse.json({ message: "انتهت جلسة الدخول. سجل الدخول مجددًا." }, { status: 401 });

    const identity = await resolveAuthIdentity(supabase, data.user);
    if (!requiresPhoneVerification(data.user, identity)) {
      return NextResponse.json({ message: "هذا الحساب لا يحتاج إلى توثيق رقم جديد." }, { status: 409 });
    }

    const body = await request.json().catch(() => ({})) as { phone?: unknown };
    const phone = normalizeSaudiPhone(body.phone);
    if (!phone) return NextResponse.json({ message: "أدخل رقم جوال سعوديًا صحيحًا." }, { status: 400 });
    enforceRateLimit(request, `phone-verification:${data.user.id}`);

    const admin = createAdminClient();
    const [duplicate, existing] = await Promise.all([
      admin.from("profiles").select("id").eq("mobile", phone).neq("id", data.user.id).limit(1),
      admin.from("phone_verification_challenges").select("resend_after").eq("user_id", data.user.id).maybeSingle(),
    ]);
    if (duplicate.error || existing.error) {
      return NextResponse.json({ message: "تعذر تجهيز طلب التحقق حاليًا." }, { status: 500 });
    }
    if (duplicate.data?.length) {
      return NextResponse.json({ message: "رقم الجوال مستخدم في حساب موثّق آخر." }, { status: 409 });
    }
    if (existing.data?.resend_after && new Date(existing.data.resend_after).getTime() > Date.now()) {
      return NextResponse.json({ message: "انتظر دقيقة قبل إعادة إرسال الرمز." }, { status: 429 });
    }

    const availability = await checkGreenApiWhatsApp(phone);
    if (availability.status === "not_available") {
      return NextResponse.json({ message: "هذا الرقم غير مفعّل على واتساب. صحح الرقم أو استخدم رقمًا آخر." }, { status: 422 });
    }
    if (availability.status !== "available") {
      return NextResponse.json({ message: "تعذر التحقق من اتصال واتساب حاليًا. حاول بعد قليل." }, { status: 502 });
    }

    const code = String(randomInt(100000, 1000000));
    const salt = randomBytes(24).toString("hex");
    const codeHash = createHash("sha256").update(`${salt}:${code}`).digest("hex");
    const challenge = await admin.from("phone_verification_challenges").upsert({
      user_id: data.user.id,
      phone,
      code_hash: codeHash,
      code_salt: salt,
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      resend_after: new Date(Date.now() + 60 * 1000).toISOString(),
      attempts: 0,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
    if (challenge.error) {
      const status = challenge.error.code === "23505" ? 409 : 500;
      const message = status === 409 ? "يوجد حساب آخر يحاول توثيق هذا الرقم حاليًا." : "تعذر حفظ طلب التحقق.";
      return NextResponse.json({ message }, { status });
    }

    const idempotencyKey = `phone-verification-${data.user.id}-${crypto.randomUUID()}`;
    const sent = await sendGreenApiMessage({
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
      result: sent,
    }).catch(() => undefined));

    if (sent.status !== "submitted") {
      await admin.from("phone_verification_challenges").delete().eq("user_id", data.user.id);
      return NextResponse.json({ message: "لم يقبل واتساب إرسال الرمز. صحح الرقم أو حاول بعد قليل." }, { status: 502 });
    }

    return NextResponse.json({
      phone,
      message: "تم قبول الرسالة للإرسال عبر واتساب. أدخل الرمز الذي وصلك.",
    }, { status: 201 });
  } catch (error) {
    if (error instanceof PublicJoinError) return NextResponse.json({ message: error.message }, { status: error.status });
    return NextResponse.json({ message: "تعذر إرسال رمز التحقق حاليًا." }, { status: 500 });
  }
}
