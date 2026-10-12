import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getPaymobConfig, type PaymobTransaction } from "./paymob";

// Correlate using the signed order ID, never unsigned callback extras.
export async function applyContractorTransaction(db: SupabaseClient, transaction: PaymobTransaction) {
  const config = getPaymobConfig();
  const orderId = String(transaction.order?.id ?? "");
  const transactionId = String(transaction.id ?? "");
  if (!/^\d+$/.test(orderId) || !/^\d+$/.test(transactionId) || !config.integrationIds.includes(Number(transaction.integration_id)) || String(transaction.currency).toUpperCase() !== "SAR") throw new Error("payment_mismatch");
  const { data: payment, error } = await db.from("contractor_chat_payments").select("id,amount,status").eq("gateway_order_id", orderId).maybeSingle();
  if (error || !payment) throw new Error("payment_not_ready");
  if (Math.round(Number(payment.amount) * 100) !== Number(transaction.amount_cents)) throw new Error("payment_amount_mismatch");
  if (transaction.pending === true || transaction.is_auth === true && transaction.is_capture !== true) return { status: "pending" };
  const outcome = transaction.is_refunded === true || transaction.is_voided === true && payment.status === "succeeded"
    ? "refunded" : transaction.success === true && transaction.is_voided !== true ? "succeeded" : "failed";
  const result = await db.rpc("apply_contractor_chat_payment", { p_id: payment.id, p_transaction: transactionId, p_order: orderId, p_amount: Number(payment.amount), p_outcome: outcome });
  if (result.error) throw new Error("payment_apply_failed");
  return result.data as { status: string };
}

export async function reconcileContractorPayment(db: SupabaseClient, payment: { id: string; gateway_order_id: string | null; expires_at: string }) {
  const expireUnused = async () => {
    if (Date.parse(payment.expires_at) >= Date.now()) return { status: "pending" };
    const result = await db.from("contractor_chat_payments").update({ status: "failed" }).eq("id", payment.id).eq("status", "pending");
    if (result.error) throw new Error("payment_expiry_failed");
    return { status: "failed" };
  };
  // A checkout is returned only after its order is persisted; an abandoned reservation has no payable URL.
  if (!payment.gateway_order_id) return expireUnused();
  const config = getPaymobConfig();
  const auth = await fetch(`${config.baseUrl}/api/auth/tokens`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ api_key: config.apiKey }), cache: "no-store", signal: AbortSignal.timeout(15000) });
  const authBody = await auth.json().catch(() => null) as { token?: string } | null;
  if (!auth.ok || !authBody?.token) throw new Error("payment_inquiry_unavailable");
  const response = await fetch(`${config.baseUrl}/api/ecommerce/orders/transaction_inquiry`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ auth_token: authBody.token, order_id: payment.gateway_order_id }), cache: "no-store", signal: AbortSignal.timeout(15000) });
  if (response.status === 404) return expireUnused();
  const transaction = await response.json().catch(() => null) as PaymobTransaction | null;
  if (!response.ok || !transaction?.id || String(transaction.order?.id) !== payment.gateway_order_id) throw new Error("payment_inquiry_mismatch");
  if (config.secretKey.includes("_live_") && transaction.is_live !== true) throw new Error("payment_live_mode_mismatch");
  const result = await applyContractorTransaction(db, transaction);
  if (result.status === "pending" && transaction.pending !== true && transaction.success !== true && Date.parse(payment.expires_at) < Date.now()) {
    const expired = await db.from("contractor_chat_payments").update({ status: "failed" }).eq("id", payment.id).eq("status", "pending");
    if (expired.error) throw new Error("payment_expiry_failed");
  }
  return result;
}
