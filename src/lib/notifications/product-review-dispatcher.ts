import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  maskWhatsAppDestination,
  sendGreenApiMessage,
  type ProviderSubmission,
} from "./providers/green-api";
import { OFFICIAL_PLATFORM_URL } from "./site-url";
import { recordProviderSubmission } from "./submissions";
import { compactEventMessage } from "./event-catalog";

type ProductReviewOutbox = {
  id: string;
  aggregate_id: string;
};

type ProductReviewDetails = { name: string; providers: { company_name: string } | null };

export async function dispatchProductReviewNotifications(limit = 10) {
  const admin = createAdminClient();
  const claimed = await admin.rpc("claim_notification_outbox", {
    p_limit: limit,
    p_event_types: ["admin.product_pending_review"],
  });
  if (claimed.error) throw new Error("product_review_outbox_claim_failed");

  let processed = 0;
  let failed = 0;

  for (const event of (claimed.data ?? []) as ProductReviewOutbox[]) {
    try {
      const [recipients, productResult] = await Promise.all([
        admin.from("admin_users").select("profile_id,profiles(mobile)").eq("is_active", true),
        admin
          .from("products")
          .select(
            "name,providers(company_name)",
          )
          .eq("id", event.aggregate_id)
          .maybeSingle(),
      ]);

      if (recipients.error) throw new Error("admin_recipients_lookup_failed");
      if (productResult.error || !productResult.data) throw new Error("product_review_details_not_found");

      const ready = (recipients.data ?? []).flatMap((row) => {
        const profile = row.profiles as unknown as { mobile: string | null } | null;
        return profile?.mobile ? [{ profileId: String(row.profile_id), mobile: profile.mobile }] : [];
      });
      if (!ready.length) throw new Error("admin_mobile_not_ready");

      const product = productResult.data as unknown as ProductReviewDetails;
      const siteUrl = OFFICIAL_PLATFORM_URL;
      const reviewUrl = `${siteUrl}/admin/products/review/${event.aggregate_id}`;
      const text = compactEventMessage("admin.product_pending_review", event.aggregate_id, new URL(reviewUrl).pathname, siteUrl, `${product.providers?.company_name || ""} · ${product.name}`);

      let success = true;
      for (const recipient of ready) {
        const baseKey = `product-review-${event.id}-${recipient.profileId}`;
        const destinationMasked = maskWhatsAppDestination(recipient.mobile);

        const fallbackResult = await sendGreenApiMessage({
          to: recipient.mobile,
          text,
          idempotencyKey: `${baseKey}-text`,
        });
        await recordSubmission(destinationMasked, `${baseKey}-text`, fallbackResult);
        success = success && fallbackResult.status === "submitted";
      }

      await admin.rpc("finish_notification_outbox", {
        p_id: event.id,
        p_success: success,
        p_error: success ? null : "provider_submission_failed",
      });
      if (success) processed += 1;
      else failed += 1;
    } catch {
      await admin.rpc("finish_notification_outbox", {
        p_id: event.id,
        p_success: false,
        p_error: "product_review_notification_failed",
      });
      failed += 1;
    }
  }

  return { claimed: (claimed.data ?? []).length, processed, failed };
}

async function recordSubmission(
  destinationMasked: string,
  idempotencyKey: string,
  result: ProviderSubmission,
) {
  await recordProviderSubmission({
    eventType: "admin.product_pending_review",
    channel: "whatsapp",
    destinationMasked,
    idempotencyKey,
    result,
  });
}
