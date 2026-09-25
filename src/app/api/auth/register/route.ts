import { NextRequest } from "next/server";
import { validatePassword } from "@/lib/auth/password-policy";
import { authRouteOptions, authRouteResponse, isLocalAppOrigin } from "@/lib/auth/request-client";
import { normalizeSaudiPhone } from "@/lib/auth/phone-verification";
import { issuePhoneVerificationCode, PhoneVerificationDeliveryError } from "@/lib/auth/phone-verification-delivery";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertSameOrigin, enforceRateLimit, PublicJoinError } from "@/lib/join/security";
import { isValidJoinUsername, normalizeJoinUsername } from "@/lib/join/username";
import { checkGreenApiWhatsApp } from "@/lib/notifications/providers/green-api";

export const runtime = "nodejs";

function registrationResponse(request: NextRequest, body: Record<string, unknown>, status: number) {
  return authRouteResponse(request, body, status);
}

export async function OPTIONS(request: NextRequest) {
  return authRouteOptions(request);
}

function authRegistrationError(error: { code?: string; message: string; status?: number }) {
  if (error.code === "email_exists") return { message: "البريد الإلكتروني مسجل مسبقًا. سجل الدخول أو استعد كلمة المرور.", status: 409 };
  if (error.code === "user_already_exists") return { message: "يوجد حساب مسجل بهذه البيانات.", status: 409 };
  if (error.code === "weak_password") return { message: "رفض نظام المصادقة كلمة المرور. استخدم 8 أحرف بينها حرف إنجليزي كبير ورقم.", status: 400 };
  return { message: "تعذر إنشاء الحساب حاليًا. حاول مجددًا.", status: 500 };
}

export async function POST(request: NextRequest) {
  try {
    if (!isLocalAppOrigin(request)) assertSameOrigin(request);
    const body = await request.json() as Record<string, unknown>;
    const fullName = String(body.fullName || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const phone = normalizeSaudiPhone(body.phone);
    const username = normalizeJoinUsername(String(body.username || ""));
    const password = String(body.password || "");

    if (fullName.length < 3 || !phone || !isValidJoinUsername(username) || !/^\S+@\S+\.\S+$/.test(email)) {
      throw new PublicJoinError("بيانات التسجيل غير صالحة.", 400);
    }
    const passwordError = validatePassword(password);
    if (passwordError) throw new PublicJoinError(passwordError, 400);

    enforceRateLimit(request, `register:${email}`);
    if (!request.headers.get("idempotency-key")) throw new PublicJoinError("معرّف المحاولة مطلوب.", 400);
    const admin = createAdminClient();
    const [emailMatch, usernameMatch, phoneMatch, whatsappAvailability] = await Promise.all([
      admin.from("profiles").select("id").ilike("email", email).maybeSingle(),
      admin.from("profiles").select("id").ilike("username", username).maybeSingle(),
      admin.from("profiles").select("id").eq("mobile", phone).maybeSingle(),
      checkGreenApiWhatsApp(phone),
    ]);
    const lookupError = emailMatch.error || usernameMatch.error || phoneMatch.error;
    if (lookupError) {
      console.error("Customer registration conflict lookup failed", { code: lookupError.code, message: lookupError.message });
      return registrationResponse(request, { message: "تعذر التحقق من بيانات الحساب حاليًا." }, 500);
    }
    if (emailMatch.data) return registrationResponse(request, { message: "البريد الإلكتروني مسجل مسبقًا. سجل الدخول أو استعد كلمة المرور." }, 409);
    if (usernameMatch.data) return registrationResponse(request, { message: "اسم المستخدم مستخدم مسبقًا. اختر اسمًا آخر." }, 409);
    if (phoneMatch.data) return registrationResponse(request, { message: "رقم الجوال مرتبط بحساب موثّق آخر." }, 409);
    if (whatsappAvailability.status === "not_available") {
      return registrationResponse(request, { message: "هذا الرقم غير مفعّل على واتساب. صحح الرقم أو استخدم رقمًا آخر." }, 422);
    }
    if (whatsappAvailability.status !== "available") {
      return registrationResponse(request, { message: "تعذر التحقق من اتصال واتساب حاليًا. حاول بعد قليل." }, 502);
    }

    const created = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName, username },
    });
    if (created.error || !created.data.user) {
      const error = created.error || new Error("Supabase returned no user");
      console.error("Customer registration failed", {
        code: "code" in error ? error.code : undefined,
        status: "status" in error ? error.status : undefined,
        message: error.message,
      });
      const response = authRegistrationError(error);
      return registrationResponse(request, { message: response.message }, response.status);
    }
    try {
      const delivery = await issuePhoneVerificationCode({
        userId: created.data.user.id,
        phone,
        availabilityConfirmed: true,
        respectResendCooldown: false,
      });
      return registrationResponse(request, {
        created: true,
        verificationSent: true,
        phone: delivery.phone,
        message: delivery.message,
      }, 201);
    } catch (error) {
      const rollback = await admin.auth.admin.deleteUser(created.data.user.id);
      if (rollback.error) {
        console.error("Customer registration rollback failed", {
          userId: created.data.user.id,
          code: rollback.error.code,
          message: rollback.error.message,
        });
      }
      if (error instanceof PhoneVerificationDeliveryError) {
        return registrationResponse(request, { message: error.message }, error.status);
      }
      throw error;
    }
  } catch (error) {
    if (error instanceof PublicJoinError) return registrationResponse(request, { message: error.message }, error.status);
    return registrationResponse(request, { message: "تعذر إنشاء الحساب حاليًا." }, 500);
  }
}
