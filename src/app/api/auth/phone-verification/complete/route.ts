import { createHash, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { resolveAuthIdentity } from "@/lib/auth/resolve-identity";
import { routeForRole } from "@/lib/auth/types";
import { assertSameOrigin, PublicJoinError } from "@/lib/join/security";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return NextResponse.json({ message: "انتهت جلسة الدخول. سجل الدخول مجددًا." }, { status: 401 });

    const body = await request.json().catch(() => ({})) as { code?: unknown };
    const code = String(body.code ?? "").trim();
    if (!/^\d{6}$/.test(code)) return NextResponse.json({ message: "أدخل رمز التحقق المكوّن من 6 أرقام." }, { status: 400 });

    const admin = createAdminClient();
    const challenge = await admin.from("phone_verification_challenges")
      .select("phone,code_hash,code_salt,expires_at,attempts,max_attempts")
      .eq("user_id", data.user.id)
      .maybeSingle();
    if (challenge.error) return NextResponse.json({ message: "تعذر قراءة طلب التحقق." }, { status: 500 });
    if (!challenge.data) return NextResponse.json({ message: "اطلب رمز تحقق جديدًا أولًا." }, { status: 409 });

    const row = challenge.data;
    if (new Date(row.expires_at).getTime() <= Date.now()) {
      await admin.from("phone_verification_challenges").delete().eq("user_id", data.user.id);
      return NextResponse.json({ message: "انتهت صلاحية الرمز. اطلب رمزًا جديدًا." }, { status: 410 });
    }
    if (row.attempts >= row.max_attempts) {
      await admin.from("phone_verification_challenges").delete().eq("user_id", data.user.id);
      return NextResponse.json({ message: "تجاوزت عدد المحاولات. اطلب رمزًا جديدًا." }, { status: 429 });
    }

    const actual = Buffer.from(createHash("sha256").update(`${row.code_salt}:${code}`).digest("hex"));
    const expected = Buffer.from(row.code_hash);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      await admin.from("phone_verification_challenges").update({ attempts: row.attempts + 1 }).eq("user_id", data.user.id);
      return NextResponse.json({ message: "رمز التحقق غير صحيح." }, { status: 400 });
    }

    const duplicate = await admin.from("profiles").select("id").eq("mobile", row.phone).neq("id", data.user.id).limit(1);
    if (duplicate.error) return NextResponse.json({ message: "تعذر اعتماد رقم الجوال." }, { status: 500 });
    if (duplicate.data?.length) return NextResponse.json({ message: "رقم الجوال مستخدم في حساب موثّق آخر." }, { status: 409 });

    const updated = await admin.auth.admin.updateUserById(data.user.id, {
      phone: row.phone,
      phone_confirm: true,
      user_metadata: { ...data.user.user_metadata, mobile: row.phone },
    });
    if (updated.error || !updated.data.user?.phone_confirmed_at) {
      const status = updated.error?.code === "phone_exists" ? 409 : 500;
      const message = status === 409 ? "رقم الجوال مستخدم في حساب آخر." : "تم التحقق من الرمز، لكن تعذر اعتماد الرقم.";
      return NextResponse.json({ message }, { status });
    }

    let identity = await resolveAuthIdentity(supabase, updated.data.user);
    if (identity.status === "missing_role") {
      const initialized = await supabase.rpc("initialize_customer_account");
      if (initialized.error) return NextResponse.json({ message: "تم توثيق الرقم، لكن تعذر تجهيز حساب العميل." }, { status: 500 });
      identity = await resolveAuthIdentity(supabase, updated.data.user);
    }

    await admin.from("phone_verification_challenges").delete().eq("user_id", data.user.id);
    if (identity.profile?.mustChangePassword) return NextResponse.json({ redirectTo: "/account/change-password" });
    if (identity.status !== "ready" || !identity.primaryRole) {
      return NextResponse.json({ message: "تم توثيق الرقم، لكن بوابة الحساب غير جاهزة." }, { status: 500 });
    }
    return NextResponse.json({ redirectTo: routeForRole(identity.primaryRole) });
  } catch (error) {
    if (error instanceof PublicJoinError) return NextResponse.json({ message: error.message }, { status: error.status });
    return NextResponse.json({ message: "تعذر إكمال توثيق رقم الجوال." }, { status: 500 });
  }
}
