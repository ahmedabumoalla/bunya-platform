import { NextRequest } from "next/server";

import {
  authRouteOptions,
  authRouteResponse,
  createAuthRequestClient,
} from "@/lib/auth/request-client";
import { decryptDeliveryCode } from "@/lib/delivery/code-vault";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function response(request: NextRequest, body: Record<string, unknown>, status = 200) {
  const result = authRouteResponse(request, body, status);
  result.headers.set("Cache-Control", "private, no-store, max-age=0");
  return result;
}

export async function GET(request: NextRequest, context: RouteContext<"/api/customer/deliveries/[id]/code">) {
  const auth = await createAuthRequestClient(request);
  if (auth.error || !auth.user) return response(request, { error: "يلزم تسجيل دخول العميل." }, 401);

  const { id } = await context.params;
  if (!UUID.test(id)) return response(request, { error: "معرّف التوصيل غير صالح." }, 400);

  const admin = createAdminClient();
  const assignment = await admin
    .from("provider_delivery_assignments")
    .select("id,status,order_id")
    .eq("id", id)
    .maybeSingle();
  if (assignment.error || !assignment.data) return response(request, { error: "التوصيل غير موجود." }, 404);

  const order = await admin
    .from("orders")
    .select("customer_profile_id,payment_status")
    .eq("id", assignment.data.order_id)
    .maybeSingle();
  if (order.error || !order.data || order.data.customer_profile_id !== auth.user.id) {
    return response(request, { error: "لا تملك صلاحية عرض هذا الرمز." }, 403);
  }
  if (!["paid", "succeeded"].includes(String(order.data.payment_status))) {
    return response(request, { error: "يظهر رمز التسليم بعد اكتمال السداد." }, 409);
  }
  if (assignment.data.status !== "arrived") {
    return response(request, { error: "يظهر رمز التسليم عند وصول السائق إلى موقع التسليم." }, 409);
  }

  const codeRow = await admin
    .from("delivery_confirmation_codes")
    .select("customer_code_ciphertext,expires_at,verified_at")
    .eq("assignment_id", id)
    .maybeSingle();
  if (codeRow.error || !codeRow.data) return response(request, { error: "رمز التسليم غير متاح." }, 404);
  if (assignment.data.status === "delivered" || codeRow.data.verified_at) {
    return response(request, { error: "تم استخدام رمز التسليم وإغلاق الطلب." }, 410);
  }
  if (new Date(codeRow.data.expires_at).getTime() <= Date.now()) {
    return response(request, { error: "انتهت صلاحية رمز التسليم." }, 410);
  }
  if (!codeRow.data.customer_code_ciphertext) {
    return response(request, { error: "رمز قديم يحتاج إلى إعادة إصدار آمنة." }, 409);
  }

  try {
    return response(request, {
      code: decryptDeliveryCode(codeRow.data.customer_code_ciphertext),
      expiresAt: codeRow.data.expires_at,
    });
  } catch {
    return response(request, { error: "تعذر فتح رمز التسليم بأمان." }, 500);
  }
}

export function OPTIONS(request: NextRequest) {
  return authRouteOptions(request);
}
