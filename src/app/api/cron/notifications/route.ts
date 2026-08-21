import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { dispatchNotificationBatch } from "@/lib/notifications/dispatcher";
import { dispatchProductReviewNotifications } from "@/lib/notifications/product-review-dispatcher";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const configured = process.env.CRON_SECRET || "";
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  const authorized =
    configured.length > 0 &&
    configured.length === provided.length &&
    timingSafeEqual(Buffer.from(configured), Buffer.from(provided));

  if (!authorized) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }
  if (process.env.NOTIFICATIONS_ENABLED !== "true") {
    return NextResponse.json({ status: "disabled" });
  }

  try {
    const productReviewsOnly = request.nextUrl.searchParams.get("only") === "product-reviews";
    if (productReviewsOnly) {
      return NextResponse.json({
        productReviews: await dispatchProductReviewNotifications(10),
      });
    }

    await createAdminClient().rpc("schedule_operational_notifications");
    const [general, productReviews] = await Promise.all([
      dispatchNotificationBatch(10),
      dispatchProductReviewNotifications(10),
    ]);
    return NextResponse.json({ general, productReviews });
  } catch {
    return NextResponse.json({ message: "Dispatcher unavailable" }, { status: 503 });
  }
}
