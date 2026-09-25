import { NextRequest } from "next/server";
import { resolveAuthIdentity } from "@/lib/auth/resolve-identity";
import {
  authRouteOptions,
  authRouteResponse,
  createAuthRequestClient,
  isLocalAppOrigin,
} from "@/lib/auth/request-client";
import { assertSameOrigin, PublicJoinError } from "@/lib/join/security";
import { dispatchNotificationEvent } from "@/lib/notifications/dispatcher";

export const runtime = "nodejs";

export function OPTIONS(request: NextRequest) {
  return authRouteOptions(request);
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await createAuthRequestClient(request);
    if (auth.error || !auth.user) throw new PublicJoinError("يلزم تسجيل الدخول بحساب إدارة.", 401);
    if (!auth.usesBearer && !isLocalAppOrigin(request)) assertSameOrigin(request);
    const identity = await resolveAuthIdentity(auth.supabase, auth.user);
    if (!identity || identity.status !== "ready" || !identity.activeRoles.includes("admin")) throw new PublicJoinError("صلاحية الإدارة مطلوبة.", 403);
    const { id } = await context.params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new PublicJoinError("معرف طلب التعديل غير صالح.", 400);
    const body = (await request.json().catch(() => null)) as { decision?: unknown; reason?: unknown; idempotencyKey?: unknown } | null;
    const decision = String(body?.decision ?? "").trim();
    const reason = String(body?.reason ?? "").normalize("NFKC").trim();
    const idempotencyKey = String(body?.idempotencyKey ?? "").trim() || `product-change-review-${crypto.randomUUID()}`;
    if (!new Set(["approved", "rejected"]).has(decision)) throw new PublicJoinError("قرار المراجعة غير صالح.", 400);
    if (reason.length < 5 || reason.length > 1000) throw new PublicJoinError("اكتب ملاحظة قرار واضحة من 5 أحرف على الأقل.", 400);
    const result = await auth.supabase.rpc("review_product_change_request", {
      p_request_id: id,
      p_decision: decision,
      p_reason: reason,
      p_idempotency_key: idempotencyKey,
    });
    if (result.error) throw new PublicJoinError(`تعذر حفظ القرار: ${result.error.message}`, 400);
    const payload = result.data as { event_id?: string; status?: string };
    if (payload.event_id) await dispatchNotificationEvent(payload.event_id).catch((error) => console.error("product_change_decision_dispatch_failed", error instanceof Error ? error.message : "unknown"));
    return authRouteResponse(request, { status: payload.status || decision });
  } catch (error) {
    if (error instanceof PublicJoinError) return authRouteResponse(request, { error: error.message }, error.status);
    console.error("product_change_review_failed", error instanceof Error ? error.message : "unknown_error");
    return authRouteResponse(request, { error: "تعذر مراجعة طلب تعديل المنتج حاليًا." }, 500);
  }
}
