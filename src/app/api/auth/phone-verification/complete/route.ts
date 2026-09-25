import { createHash, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { resolveAuthIdentity } from "@/lib/auth/resolve-identity";
import { authRouteOptions, authRouteResponse, createAuthRequestClient, isLocalAppOrigin } from "@/lib/auth/request-client";
import { routeForRole } from "@/lib/auth/types";
import { assertSameOrigin, PublicJoinError } from "@/lib/join/security";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export function OPTIONS(request: NextRequest) {
  return authRouteOptions(request);
}

export async function POST(request: NextRequest) {
  try {
    const auth = await createAuthRequestClient(request);
    if (!auth.usesBearer && !isLocalAppOrigin(request)) assertSameOrigin(request);
    const { supabase, user, error } = auth;
    if (error || !user) return authRouteResponse(request, { message: "انتهت جلسة الدخول. سجل الدخول مجددًا." }, 401);

    const body = await request.json().catch(() => ({})) as { code?: unknown };
    const code = String(body.code ?? "").trim();
    if (!/^\d{6}$/.test(code)) return authRouteResponse(request, { message: "أدخل رمز التحقق المكوّن من 6 أرقام." }, 400);

    const admin = createAdminClient();
    const challenge = await admin.from("phone_verification_challenges")
      .select("phone,code_hash,code_salt,expires_at,attempts,max_attempts")
      .eq("user_id", user.id)
      .maybeSingle();
    if (challenge.error) return authRouteResponse(request, { message: "تعذر قراءة طلب التحقق." }, 500);
    if (!challenge.data) return authRouteResponse(request, { message: "اطلب رمز تحقق جديدًا أولًا." }, 409);

    const row = challenge.data;
    if (new Date(row.expires_at).getTime() <= Date.now()) {
      await admin.from("phone_verification_challenges").delete().eq("user_id", user.id);
      return authRouteResponse(request, { message: "انتهت صلاحية الرمز. اطلب رمزًا جديدًا." }, 410);
    }
    if (row.attempts >= row.max_attempts) {
      await admin.from("phone_verification_challenges").delete().eq("user_id", user.id);
      return authRouteResponse(request, { message: "تجاوزت عدد المحاولات. اطلب رمزًا جديدًا." }, 429);
    }

    const actual = Buffer.from(createHash("sha256").update(`${row.code_salt}:${code}`).digest("hex"));
    const expected = Buffer.from(row.code_hash);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      await admin.from("phone_verification_challenges").update({ attempts: row.attempts + 1 }).eq("user_id", user.id);
      return authRouteResponse(request, { message: "رمز التحقق غير صحيح." }, 400);
    }

    const duplicate = await admin.from("profiles").select("id").eq("mobile", row.phone).neq("id", user.id).limit(1);
    if (duplicate.error) return authRouteResponse(request, { message: "تعذر اعتماد رقم الجوال." }, 500);
    if (duplicate.data?.length) return authRouteResponse(request, { message: "رقم الجوال مستخدم في حساب موثّق آخر." }, 409);

    const updated = await admin.auth.admin.updateUserById(user.id, {
      phone: row.phone,
      phone_confirm: true,
      user_metadata: { ...user.user_metadata, mobile: row.phone },
    });
    if (updated.error || !updated.data.user?.phone_confirmed_at) {
      const status = updated.error?.code === "phone_exists" ? 409 : 500;
      const message = status === 409 ? "رقم الجوال مستخدم في حساب آخر." : "تم التحقق من الرمز، لكن تعذر اعتماد الرقم.";
      return authRouteResponse(request, { message }, status);
    }

    const initialized = await supabase.rpc("initialize_customer_account");
    if (initialized.error) return authRouteResponse(request, { message: "تم توثيق الرقم، لكن تعذر تجهيز حساب العميل." }, 500);
    const identity = await resolveAuthIdentity(supabase, updated.data.user);

    await admin.from("phone_verification_challenges").delete().eq("user_id", user.id);
    if (identity.profile?.mustChangePassword) return authRouteResponse(request, { redirectTo: "/account/change-password" });
    if (identity.status !== "ready" || !identity.primaryRole) {
      return authRouteResponse(request, { message: "تم توثيق الرقم، لكن بوابة الحساب غير جاهزة." }, 500);
    }
    return authRouteResponse(request, { redirectTo: routeForRole(identity.primaryRole) });
  } catch (error) {
    if (error instanceof PublicJoinError) return authRouteResponse(request, { message: error.message }, error.status);
    return authRouteResponse(request, { message: "تعذر إكمال توثيق رقم الجوال." }, 500);
  }
}
