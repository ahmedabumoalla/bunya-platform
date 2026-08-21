import { NextRequest, NextResponse } from "next/server";
import { validatePassword } from "@/lib/auth/password-policy";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertSameOrigin, enforceRateLimit, PublicJoinError } from "@/lib/join/security";

export const runtime = "nodejs";

function authRegistrationError(error: { code?: string; message: string; status?: number }) {
  if (error.code === "email_exists") return { message: "البريد الإلكتروني مسجل مسبقًا. سجل الدخول أو استعد كلمة المرور.", status: 409 };
  if (error.code === "phone_exists") return { message: "رقم الجوال مسجل مسبقًا. سجل الدخول أو استعد كلمة المرور.", status: 409 };
  if (error.code === "user_already_exists") return { message: "يوجد حساب مسجل بهذه البيانات.", status: 409 };
  if (error.code === "weak_password") return { message: "رفض نظام المصادقة كلمة المرور. استخدم 8 أحرف بينها حرف إنجليزي كبير ورقم.", status: 400 };
  return { message: "تعذر إنشاء الحساب حاليًا. حاول مجددًا.", status: 500 };
}

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const body = await request.json() as Record<string, unknown>;
    const fullName = String(body.fullName || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const username = String(body.username || "").trim();
    const password = String(body.password || "");
    let digits = String(body.mobile || "").replace(/\D/g, "");
    if (digits.startsWith("05")) digits = `966${digits.slice(1)}`;
    else if (digits.startsWith("5")) digits = `966${digits}`;

    if (fullName.length < 3 || !/^\S{4,40}$/.test(username) || !/^\S+@\S+\.\S+$/.test(email) || !/^9665\d{8}$/.test(digits)) {
      throw new PublicJoinError("بيانات التسجيل غير صالحة.", 400);
    }
    const passwordError = validatePassword(password);
    if (passwordError) throw new PublicJoinError(passwordError, 400);

    enforceRateLimit(request, `register:${email}:${digits}`);
    if (!request.headers.get("idempotency-key")) throw new PublicJoinError("معرّف المحاولة مطلوب.", 400);
    const admin = createAdminClient();
    const [emailMatch, phoneMatch, usernameMatch] = await Promise.all([
      admin.from("profiles").select("id").ilike("email", email).maybeSingle(),
      admin.from("profiles").select("id").eq("mobile", `+${digits}`).maybeSingle(),
      admin.from("profiles").select("id").ilike("username", username).maybeSingle(),
    ]);
    const lookupError = emailMatch.error || phoneMatch.error || usernameMatch.error;
    if (lookupError) {
      console.error("Customer registration conflict lookup failed", { code: lookupError.code, message: lookupError.message });
      return NextResponse.json({ message: "تعذر التحقق من بيانات الحساب حاليًا." }, { status: 500 });
    }
    if (emailMatch.data) return NextResponse.json({ message: "البريد الإلكتروني مسجل مسبقًا. سجل الدخول أو استعد كلمة المرور." }, { status: 409 });
    if (phoneMatch.data) return NextResponse.json({ message: "رقم الجوال مسجل مسبقًا. سجل الدخول أو استعد كلمة المرور." }, { status: 409 });
    if (usernameMatch.data) return NextResponse.json({ message: "اسم المستخدم مستخدم مسبقًا. اختر اسمًا آخر." }, { status: 409 });

    const created = await admin.auth.admin.createUser({
      email,
      phone: `+${digits}`,
      password,
      email_confirm: true,
      phone_confirm: false,
      user_metadata: { full_name: fullName, username, mobile: `+${digits}` },
    });
    if (created.error || !created.data.user) {
      const error = created.error || new Error("Supabase returned no user");
      console.error("Customer registration failed", {
        code: "code" in error ? error.code : undefined,
        status: "status" in error ? error.status : undefined,
        message: error.message,
      });
      const response = authRegistrationError(error);
      return NextResponse.json({ message: response.message }, { status: response.status });
    }
    return NextResponse.json({ phone: `+${digits}` }, { status: 201 });
  } catch (error) {
    if (error instanceof PublicJoinError) return NextResponse.json({ message: error.message }, { status: error.status });
    return NextResponse.json({ message: "تعذر إنشاء الحساب حاليًا." }, { status: 500 });
  }
}
