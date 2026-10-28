import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export const MANAGED_QUOTE_OWNER_ID = "8b9f3886-e1b8-4816-9fbb-d425b0753255";
export const MANAGED_QUOTE_OWNER_MOBILE = "+966508424401";
export const MANAGED_QUOTE_SUBMITTED_EVENT = "admin.managed_quote_submitted";

/** A retry of the same quote must not reset a processed notification. */
export async function enqueueManagedQuoteNotification(admin: SupabaseClient, requestId: string) {
  const key = `managed-quote-submitted:${requestId}`;
  const queued = await admin.from("outbox_events").upsert({
    aggregate_type: "managed_quote", aggregate_id: requestId,
    event_type: MANAGED_QUOTE_SUBMITTED_EVENT, payload: {}, idempotency_key: key,
  }, { onConflict: "idempotency_key", ignoreDuplicates: true });
  if (queued.error) throw new Error("managed_quote_notification_enqueue_failed");
  const result = await admin.from("outbox_events").select("id").eq("idempotency_key", key).single();
  if (result.error || !result.data) throw new Error("managed_quote_notification_lookup_failed");
  return result.data.id as string;
}
