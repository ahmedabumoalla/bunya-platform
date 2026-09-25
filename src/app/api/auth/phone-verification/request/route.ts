import type { NextRequest } from "next/server";
import { normalizeSaudiPhone, requiresPhoneVerification } from "@/lib/auth/phone-verification";
import { issuePhoneVerificationCode, PhoneVerificationDeliveryError } from "@/lib/auth/phone-verification-delivery";
import { authRouteOptions, authRouteResponse, createAuthRequestClient, isLocalAppOrigin } from "@/lib/auth/request-client";
import { resolveAuthIdentity } from "@/lib/auth/resolve-identity";
import { assertSameOrigin, enforceRateLimit, PublicJoinError } from "@/lib/join/security";

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

    const identity = await resolveAuthIdentity(supabase, user);
    if (!requiresPhoneVerification(user, identity)) {
      return authRouteResponse(request, { message: "هذا الحساب لا يحتاج إلى توثيق رقم جديد." }, 409);
    }

    const body = await request.json().catch(() => ({})) as { phone?: unknown };
    const phone = normalizeSaudiPhone(body.phone);
    if (!phone) return authRouteResponse(request, { message: "أدخل رقم جوال سعوديًا صحيحًا." }, 400);
    enforceRateLimit(request, `phone-verification:${user.id}`);

    const delivery = await issuePhoneVerificationCode({ userId: user.id, phone });

    return authRouteResponse(request, {
      phone: delivery.phone,
      message: delivery.message,
    }, 201);
  } catch (error) {
    if (error instanceof PhoneVerificationDeliveryError) {
      return authRouteResponse(request, { message: error.message }, error.status);
    }
    if (error instanceof PublicJoinError) return authRouteResponse(request, { message: error.message }, error.status);
    return authRouteResponse(request, { message: "تعذر إرسال رمز التحقق حاليًا." }, 500);
  }
}
