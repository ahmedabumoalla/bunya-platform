import "server-only";

import { createHash, randomBytes, randomInt } from "node:crypto";
import { encryptDeliveryCode } from "@/lib/delivery/code-vault";
import { maskWhatsAppDestination, sendGreenApiMessage } from "@/lib/notifications/providers/green-api";
import { recordProviderSubmission } from "@/lib/notifications/submissions";
import { createAdminClient } from "@/lib/supabase/admin";

export async function issueOrderDeliveryCodes(admin: ReturnType<typeof createAdminClient>, orderId: string, eventId: string) {
  const order = await admin.from("orders").select("customer_profile_id,profiles!orders_customer_profile_id_fkey(mobile)").eq("id", orderId).single();
  const mobile = (order.data?.profiles as unknown as { mobile: string | null } | null)?.mobile;
  if (!mobile) return;
  const assignments = await admin.from("provider_delivery_assignments").select("id").eq("order_id", orderId);
  for (const assignment of assignments.data ?? []) {
    const code = String(randomInt(100000, 1000000));
    const salt = randomBytes(24).toString("hex");
    const hash = createHash("sha256").update(`${salt}:${code}`).digest("hex");
    await admin.from("delivery_confirmation_codes").upsert({ assignment_id: assignment.id, code_salt: salt, code_hash: hash, customer_code_ciphertext: encryptDeliveryCode(code), expires_at: new Date(Date.now() + 7 * 86400000).toISOString(), max_attempts: 5, attempts: 0, locked_until: null, verified_at: null, created_at: new Date().toISOString() });
    const key = `delivery-code:${eventId}:${assignment.id}`;
    const messageTitle = decodeURIComponent("%D8%B1%D9%85%D8%B2%20%D8%AA%D8%A3%D9%83%D9%8A%D8%AF%20%D8%A7%D8%B3%D8%AA%D9%84%D8%A7%D9%85%20%D8%B7%D9%84%D8%A8%D9%83%20%D9%81%D9%8A%20%D9%85%D9%86%D8%B5%D8%A9%20%D8%A8%D9%8F%D9%86%D9%8A%D8%A9%3A%20");
    const messageWarning = decodeURIComponent("%D9%84%D8%A7%20%D8%AA%D8%B4%D8%A7%D8%B1%D9%83%20%D8%A7%D9%84%D8%B1%D9%85%D8%B2%20%D8%A5%D9%84%D8%A7%20%D8%A8%D8%B9%D8%AF%20%D8%A7%D8%B3%D8%AA%D9%84%D8%A7%D9%85%20%D8%A7%D9%84%D8%B4%D8%AD%D9%86%D8%A9%20%D9%83%D8%A7%D9%85%D9%84%D8%A9.");
    const result = await sendGreenApiMessage({ to: mobile, text: `${messageTitle}${code}\n${messageWarning}`, idempotencyKey: key });
    await recordProviderSubmission({ eventType: "customer.delivery_code_issued", channel: "whatsapp", destinationMasked: maskWhatsAppDestination(mobile), idempotencyKey: key, result });
    if (result.status !== "submitted") {
      await admin.from("outbox_events").insert({ aggregate_type: "delivery", aggregate_id: assignment.id, event_type: "admin.delivery_code_delivery_failed", payload: {}, idempotency_key: `delivery-code-failed:${eventId}:${assignment.id}` });
    }
  }
}
