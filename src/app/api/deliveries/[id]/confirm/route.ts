import { NextRequest } from "next/server";

import {
  authRouteOptions,
  authRouteResponse,
  createAuthRequestClient,
  isLocalAppOrigin,
} from "@/lib/auth/request-client";
import { assertSameOrigin, PublicJoinError } from "@/lib/join/security";
import { dispatchNotificationEvent } from "@/lib/notifications/dispatcher";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await createAuthRequestClient(request);
    if (auth.error || !auth.user) {
      throw new PublicJoinError("يلزم تسجيل الدخول لتأكيد التسليم.", 401);
    }
    if (!auth.usesBearer && !isLocalAppOrigin(request))
      assertSameOrigin(request);

    const { id } = await context.params;
    const body = (await request.json()) as { code?: unknown };
    const code = String(body.code ?? "")
      .replace(/\D/g, "")
      .slice(0, 12);
    if (!UUID.test(id) || !/^\d{4,12}$/.test(code)) {
      throw new PublicJoinError("رمز التسليم أو بيانات الطلب غير صالحة.", 400);
    }

    const confirmation = await auth.supabase.rpc("confirm_delivery_code", {
      p_assignment_id: id,
      p_plain_code: code,
    });
    if (confirmation.error) {
      throw new PublicJoinError(confirmation.error.message, 409);
    }
    if (confirmation.data !== true) {
      return authRouteResponse(request, {
        accepted: false,
        notificationDelivered: false,
        message: "الرمز غير صحيح أو منتهي أو تم قفل المحاولات.",
      });
    }

    let notificationDelivered = false;
    try {
      const admin = createAdminClient();
      const event = await admin
        .from("outbox_events")
        .select("id,status")
        .eq("idempotency_key", `delivery-confirmed:${id}`)
        .maybeSingle();
      if (event.error) throw new Error("delivery_event_lookup_failed");
      notificationDelivered = event.data?.status === "processed";
      if (event.data?.id && !notificationDelivered) {
        const dispatched = await dispatchNotificationEvent(event.data.id);
        notificationDelivered = dispatched.processed === 1;
      }
    } catch (error) {
      console.error("delivery_notification_dispatch_failed", {
        assignmentId: id,
        code: error instanceof Error ? error.message : "unknown",
      });
    }

    return authRouteResponse(request, {
      accepted: true,
      notificationDelivered,
      message: notificationDelivered
        ? "تم إثبات التسليم وإغلاق الطلب وإرسال الإشعارات بنجاح."
        : "تم إثبات التسليم وإغلاق الطلب، والإشعارات قيد إعادة المحاولة.",
    });
  } catch (error) {
    if (error instanceof PublicJoinError) {
      return authRouteResponse(request, { error: error.message }, error.status);
    }
    console.error("delivery_confirmation_failed", {
      code: error instanceof Error ? error.message : "unknown",
    });
    return authRouteResponse(
      request,
      { error: "تعذر تأكيد التسليم حاليًا. حاول مرة أخرى." },
      500,
    );
  }
}

export function OPTIONS(request: NextRequest) {
  return authRouteOptions(request);
}
