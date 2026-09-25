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
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  try {
    const auth = await createAuthRequestClient(request);
    if (auth.error || !auth.user) throw new PublicJoinError("يلزم تسجيل الدخول بحساب مزود فعّال.", 401);
    const identity = await resolveAuthIdentity(auth.supabase, auth.user);
    if (!identity || identity.status !== "ready" || !identity.activeRoles.includes("provider")) {
      throw new PublicJoinError("يلزم تسجيل الدخول بحساب مزود فعّال.", 403);
    }
    if (!auth.usesBearer && !isLocalAppOrigin(request)) assertSameOrigin(request);

    const body = await request.json() as { fulfillmentId?: unknown; driverId?: unknown };
    const fulfillmentId = String(body.fulfillmentId ?? "");
    const driverId = String(body.driverId ?? "");
    if (!UUID.test(fulfillmentId) || !UUID.test(driverId)) {
      throw new PublicJoinError("بيانات إسناد السائق غير صالحة.", 400);
    }

    const assigned = await auth.supabase.rpc("assign_delivery_driver", {
      p_fulfillment_id: fulfillmentId,
      p_driver_id: driverId,
    });
    if (assigned.error || !assigned.data) {
      throw new PublicJoinError(assigned.error?.message || "تعذر إسناد السائق.", 409);
    }

    const assignmentId = String(assigned.data);
    const admin = createAdminClient();
    const event = await admin
      .from("outbox_events")
      .select("id,status")
      .eq("idempotency_key", `delivery-assigned:${assignmentId}:${driverId}`)
      .maybeSingle();
    if (event.error) throw new Error("assignment_event_lookup_failed");

    let notificationDelivered = event.data?.status === "processed";
    if (event.data?.id && !notificationDelivered) {
      const dispatched = await dispatchNotificationEvent(event.data.id);
      notificationDelivered = dispatched.processed === 1;
    }

    return authRouteResponse(request, {
      assignmentId,
      notificationDelivered,
      message: notificationDelivered
        ? "تم إسناد السائق وإرسال التفاصيل للعميل والسائق."
        : "تم إسناد السائق، والإشعارات ما زالت قيد إعادة المحاولة.",
    });
  } catch (error) {
    if (error instanceof PublicJoinError) {
      return authRouteResponse(request, { error: error.message }, error.status);
    }
    console.error("provider_driver_assignment_failed", {
      code: error instanceof Error ? error.message : "unknown",
    });
    return authRouteResponse(request, { error: "تعذر إكمال إسناد السائق وإرسال إشعاراته." }, 500);
  }
}

export function OPTIONS(request: NextRequest) {
  return authRouteOptions(request);
}
