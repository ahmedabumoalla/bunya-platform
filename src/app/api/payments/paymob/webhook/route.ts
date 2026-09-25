import { NextRequest, NextResponse } from "next/server";
import {
  getPaymobConfig,
  paymentRecordIdFromTransaction,
  type PaymobTransaction,
  verifyPaymobHmac,
} from "@/lib/payments/paymob";
import { createAdminClient } from "@/lib/supabase/admin";
import { issueOrderDeliveryCodes } from "@/lib/payments/delivery-codes";
import { reconcilePaymobPayment } from "@/lib/payments/paymob-reconciliation";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { obj?: PaymobTransaction; hmac?: string } | null;
  const transaction = body?.obj;
  const providedHmac = request.nextUrl.searchParams.get("hmac") || body?.hmac || null;
  if (!transaction) {
    return NextResponse.json({ accepted: false }, { status: 401 });
  }

  if (!verifyPaymobHmac(transaction, providedHmac)) {
    const fallbackPaymentId = paymentRecordIdFromTransaction(transaction);
    if (!providedHmac || !/^[a-f\d]{128}$/i.test(providedHmac) || !fallbackPaymentId) {
      return NextResponse.json({ accepted: false }, { status: 401 });
    }
    try {
      const reconciliation = await reconcilePaymobPayment(
        createAdminClient(),
        fallbackPaymentId,
      );
      const callbackTransactionId = String(transaction.id ?? "").trim();
      if (
        reconciliation.transactionId &&
        callbackTransactionId &&
        reconciliation.transactionId !== callbackTransactionId
      ) {
        return NextResponse.json({ accepted: false }, { status: 409 });
      }
      return NextResponse.json({
        accepted: true,
        reconciled: true,
        status: reconciliation.status,
      });
    } catch {
      return NextResponse.json({ accepted: false }, { status: 503 });
    }
  }

  const paymentRecordId = paymentRecordIdFromTransaction(transaction);
  const transactionId = String(transaction.id ?? "").trim();
  if (!paymentRecordId || !transactionId) return NextResponse.json({ accepted: false }, { status: 400 });

  const integrationId = Number(transaction.integration_id);
  if (!getPaymobConfig().integrationIds.includes(integrationId)) {
    return NextResponse.json({ accepted: false }, { status: 400 });
  }

  const admin = createAdminClient();
  const paymentResult = await admin.from("payment_records").select("id,amount,status").eq("id", paymentRecordId).maybeSingle();
  if (paymentResult.error || !paymentResult.data) return NextResponse.json({ accepted: false }, { status: 404 });
  const amountCents = Number(transaction.amount_cents);
  if (String(transaction.currency).toUpperCase() !== "SAR" || amountCents !== Math.round(Number(paymentResult.data.amount) * 100)) {
    return NextResponse.json({ accepted: false }, { status: 409 });
  }

  let eventType: "payment.succeeded" | "payment.failed" | "payment.refunded" | null = null;
  const currentStatus = String(paymentResult.data.status);
  if (currentStatus === "refunded") return NextResponse.json({ accepted: true, duplicate: true });
  if (transaction.is_refunded === true || (transaction.is_voided === true && currentStatus === "succeeded")) eventType = "payment.refunded";
  else if (transaction.is_voided === true) eventType = "payment.failed";
  else if (transaction.success === true && transaction.pending !== true) eventType = "payment.succeeded";
  else if (transaction.pending !== true) eventType = "payment.failed";
  if (!eventType) return NextResponse.json({ accepted: true, pending: true });
  if (currentStatus === "succeeded" && eventType === "payment.failed") {
    return NextResponse.json({ accepted: true, stale: true });
  }

  const eventId = `paymob:${transactionId}:${eventType.split(".")[1]}`;
  const applied = await admin.rpc("apply_trusted_payment_event", {
    p_event_id: eventId,
    p_payment_id: paymentRecordId,
    p_event_type: eventType,
    p_gateway_reference: transactionId,
  });
  if (applied.error) {
    console.error("Paymob webhook processing error", applied.error.message);
    return NextResponse.json({ accepted: false }, { status: 409 });
  }
  if (eventType === "payment.succeeded" && applied.data) {
    await issueOrderDeliveryCodes(admin, String(applied.data), eventId);
  }
  return NextResponse.json({ accepted: true, duplicate: applied.data === null });
}
