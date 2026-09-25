import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { authRouteOptions, authRouteResponse, isLocalAppOrigin } from "@/lib/auth/request-client";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertSameOrigin, enforceRateLimit, PublicJoinError } from "@/lib/join/security";
import { sendResendSensitiveCopy } from "@/lib/notifications/providers/resend";
import { maskEmail, recordProviderSubmission } from "@/lib/notifications/submissions";

export const runtime = "nodejs";

const recoveryCallback = "https://www.buniahksa.com/auth/callback";
const acceptedMessage =
  "إذا كان البريد مرتبطًا بحساب فسيصلك رابط آمن من منصة بُنية. تحقق من البريد غير المرغوب فيه أيضًا.";

export function OPTIONS(request: NextRequest) {
  return authRouteOptions(request);
}

export async function POST(request: NextRequest) {
  try {
    if (!isLocalAppOrigin(request)) assertSameOrigin(request);
    const body = (await request.json()) as Record<string, unknown>;
    const email = String(body.email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      return authRouteResponse(request, { message: "أدخل بريدًا إلكترونيًا صحيحًا." }, 400);
    }

    enforceRateLimit(
      request,
      `password-recovery:${createHash("sha256").update(email).digest("hex")}`,
    );
    const suppliedKey = request.headers.get("idempotency-key") || "";
    const requestKey = /^[A-Za-z0-9_-]{16,128}$/.test(suppliedKey)
      ? suppliedKey
      : crypto.randomUUID();
    const generated = await createAdminClient().auth.admin.generateLink({
      type: "recovery",
      email,
      options: { redirectTo: `${recoveryCallback}?next=/reset-password` },
    });

    // Keep the response identical for unknown addresses to prevent account discovery.
    const tokenHash = generated.data?.properties?.hashed_token;
    if (generated.error || !tokenHash) {
      return authRouteResponse(request, { accepted: true, message: acceptedMessage }, 202);
    }

    const recoveryUrl = new URL(recoveryCallback);
    recoveryUrl.searchParams.set("token_hash", tokenHash);
    recoveryUrl.searchParams.set("type", "recovery");
    recoveryUrl.searchParams.set("next", "/reset-password");
    const subject = "استعادة كلمة المرور في منصة بُنية";
    const text = [
      "مرحبًا،",
      "",
      "وصلنا طلب لإعادة تعيين كلمة المرور لحسابك في منصة بُنية.",
      "افتح الرابط الآمن التالي واختر كلمة مرور جديدة:",
      recoveryUrl.toString(),
      "",
      "إذا لم تطلب الاستعادة فتجاهل هذه الرسالة، ولن تتغير كلمة مرورك.",
    ].join("\n");
    const html = `<!doctype html><html lang="ar" dir="rtl"><body style="margin:0;background:#f5efe6;font-family:Tahoma,Arial,sans-serif;color:#20251f"><div style="max-width:560px;margin:32px auto;padding:32px;background:#fff;border:1px solid #eadccd;border-radius:20px"><p style="margin:0 0 8px;color:#bf6037;font-weight:700">منصة بُنية</p><h1 style="margin:0 0 16px;font-size:26px">استعادة كلمة المرور</h1><p style="line-height:1.9">وصلنا طلب لإعادة تعيين كلمة المرور لحسابك. اضغط الزر التالي واختر كلمة مرور جديدة.</p><p style="margin:28px 0"><a href="${recoveryUrl.toString()}" style="display:inline-block;padding:14px 24px;border-radius:12px;background:#bf6037;color:#fff;text-decoration:none;font-weight:700">تعيين كلمة مرور جديدة</a></p><p style="font-size:13px;line-height:1.8;color:#74685f">إذا لم تطلب الاستعادة فتجاهل الرسالة؛ لن تتغير كلمة مرورك. لا تشارك هذا الرابط مع أي شخص.</p></div></body></html>`;
    const result = await sendResendSensitiveCopy({
      to: email,
      subject,
      text,
      html,
      idempotencyKey: `password-recovery-${requestKey}`,
    });
    await recordProviderSubmission({
      eventType: "auth.password_recovery_requested",
      channel: "email",
      destinationMasked: maskEmail(email),
      idempotencyKey: `password-recovery-${requestKey}`,
      result,
    }).catch(() => undefined);
    if (result.status !== "submitted") {
      console.error("Password recovery email submission failed", {
        status: result.status,
        error: result.sanitizedError,
      });
    }
    return authRouteResponse(request, { accepted: true, message: acceptedMessage }, 202);
  } catch (error) {
    if (error instanceof PublicJoinError) {
      const message = error.status === 429
        ? "تم طلب رابط الاستعادة عدة مرات. انتظر 15 دقيقة ثم حاول مجددًا."
        : error.message;
      return authRouteResponse(request, { message }, error.status);
    }
    console.error("Password recovery request failed", {
      message: error instanceof Error ? error.message : "unknown_error",
    });
    return authRouteResponse(
      request,
      { message: "تعذر إرسال رابط الاستعادة الآن. حاول مجددًا بعد قليل." },
      503,
    );
  }
}
