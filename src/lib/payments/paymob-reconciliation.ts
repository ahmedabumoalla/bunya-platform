import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { dispatchNotificationEvent } from "@/lib/notifications/dispatcher";
import { issueOrderDeliveryCodes } from "@/lib/payments/delivery-codes";
import {
  getPaymobConfig,
  paymentRecordIdFromTransaction,
  type PaymobTransaction,
} from "@/lib/payments/paymob";

type AdminClient = SupabaseClient;

export type PaymobReconciliationResult = {
  status: "pending" | "succeeded" | "failed" | "refunded";
  paymentRecordId: string;
  transactionId?: string;
  orderId?: string;
  applied: boolean;
};

async function paymobAuthToken() {
  const config = getPaymobConfig();
  const response = await fetch(`${config.baseUrl}/api/auth/tokens`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ api_key: config.apiKey }),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await response.json().catch(() => null)) as {
    token?: unknown;
  } | null;
  const token = String(body?.token ?? "").trim();
  if (!response.ok || !token) throw new Error("paymob_inquiry_auth_failed");
  return token;
}

async function inquireByPaymentRecordId(paymentRecordId: string) {
  const config = getPaymobConfig();
  const token = await paymobAuthToken();
  const response = await fetch(
    `${config.baseUrl}/api/ecommerce/orders/transaction_inquiry`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ merchant_order_id: paymentRecordId }),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (response.status === 404) return null;
  const transaction = (await response.json().catch(() => null)) as
    | PaymobTransaction
    | null;
  if (!response.ok || !transaction?.id) {
    throw new Error("paymob_transaction_inquiry_failed");
  }
  return transaction;
}

function outcome(transaction: PaymobTransaction) {
  if (transaction.is_refunded === true) return "payment.refunded" as const;
  if (transaction.is_voided === true) return "payment.failed" as const;
  if (transaction.success === true && transaction.pending !== true)
    return "payment.succeeded" as const;
  if (transaction.pending !== true) return "payment.failed" as const;
  return null;
}

async function dispatchPaymentEvents(
  admin: AdminClient,
  trustedEventId: string,
) {
  const events = await admin
    .from("outbox_events")
    .select("id,status")
    .like("idempotency_key", `%${trustedEventId}%`);
  for (const event of events.data ?? []) {
    if (event.status === "pending" || event.status === "failed") {
      await dispatchNotificationEvent(event.id).catch(() => undefined);
    }
  }
}

export async function reconcilePaymobPayment(
  admin: AdminClient,
  paymentRecordId: string,
): Promise<PaymobReconciliationResult> {
  const paymentResult = await admin
    .from("payment_records")
    .select("id,invoice_id,amount,status,invoices(order_id)")
    .eq("id", paymentRecordId)
    .maybeSingle();
  if (paymentResult.error || !paymentResult.data) {
    throw new Error("payment_record_not_found");
  }
  const invoice = paymentResult.data.invoices as unknown as {
    order_id: string;
  } | null;
  if (!invoice?.order_id) throw new Error("payment_invoice_not_found");
  const currentStatus = String(paymentResult.data.status);
  if (["succeeded", "refunded"].includes(currentStatus)) {
    return {
      status: currentStatus as "succeeded" | "refunded",
      paymentRecordId,
      orderId: invoice.order_id,
      applied: false,
    };
  }

  const transaction = await inquireByPaymentRecordId(paymentRecordId);
  if (!transaction) {
    return { status: "pending", paymentRecordId, applied: false };
  }
  const config = getPaymobConfig();
  const transactionId = String(transaction.id ?? "").trim();
  const amountCents = Number(transaction.amount_cents);
  const integrationId = Number(transaction.integration_id);
  const merchantOrderId = paymentRecordIdFromTransaction(transaction);
  if (
    !transactionId ||
    merchantOrderId !== paymentRecordId ||
    String(transaction.currency).toUpperCase() !== "SAR" ||
    amountCents !== Math.round(Number(paymentResult.data.amount) * 100) ||
    !config.integrationIds.includes(integrationId) ||
    (config.secretKey.includes("_live_") &&
      (transaction as { is_live?: boolean }).is_live !== true)
  ) {
    throw new Error("paymob_transaction_mismatch");
  }
  const eventType = outcome(transaction);
  if (!eventType) {
    return {
      status: "pending",
      paymentRecordId,
      transactionId,
      applied: false,
    };
  }
  const trustedEventId = `paymob:${transactionId}:${eventType.split(".")[1]}`;
  const applied = await admin.rpc("apply_trusted_payment_event", {
    p_event_id: trustedEventId,
    p_payment_id: paymentRecordId,
    p_event_type: eventType,
    p_gateway_reference: transactionId,
  });
  if (applied.error) throw new Error("paymob_reconciliation_apply_failed");
  const orderId = String(applied.data || invoice.order_id);
  if (eventType === "payment.succeeded" && applied.data) {
    await issueOrderDeliveryCodes(admin, orderId, trustedEventId);
  }
  await dispatchPaymentEvents(admin, trustedEventId);
  return {
    status: eventType.split(".")[1] as "succeeded" | "failed" | "refunded",
    paymentRecordId,
    transactionId,
    orderId,
    applied: Boolean(applied.data),
  };
}

export async function reconcilePendingPaymobPayments(
  admin: AdminClient,
  limit = 10,
) {
  const cutoff = new Date(Date.now() - 30_000).toISOString();
  const pending = await admin
    .from("payment_records")
    .select("id")
    .eq("status", "pending")
    .like("gateway_reference", "paymob-session:%")
    .lte("created_at", cutoff)
    .order("created_at", { ascending: true })
    .limit(limit);
  let succeeded = 0;
  let failed = 0;
  for (const payment of pending.data ?? []) {
    try {
      const result = await reconcilePaymobPayment(admin, payment.id);
      if (result.status === "succeeded") succeeded += 1;
    } catch {
      failed += 1;
    }
  }
  return { checked: pending.data?.length ?? 0, succeeded, failed };
}
