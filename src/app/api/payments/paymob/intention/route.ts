import { NextRequest } from "next/server";
import { resolveAuthIdentity } from "@/lib/auth/resolve-identity";
import {
  authRouteOptions,
  authRouteResponse,
  createAuthRequestClient,
  isLocalAppOrigin,
} from "@/lib/auth/request-client";
import { assertSameOrigin, PublicJoinError } from "@/lib/join/security";
import {
  createPaymobIntention,
  parsePaymobSession,
  paymobCheckoutUrl,
  serializePaymobSession,
} from "@/lib/payments/paymob";
import { createAdminClient } from "@/lib/supabase/admin";
import { reconcilePaymobPayment } from "@/lib/payments/paymob-reconciliation";

export const runtime = "nodejs";

function paymentReturnUrl(value: unknown, quoteId: string, siteUrl: string) {
  const fallback = `${siteUrl}/customer/quotes/${quoteId}/payment?returned=1`;
  const text = String(value ?? "").trim();
  if (!text) return fallback;
  try {
    const candidate = new URL(text);
    const allowedLocalOrigins = new Set([
      "http://127.0.0.1:8090",
      "http://localhost:8090",
    ]);
    if (!allowedLocalOrigins.has(candidate.origin)) return fallback;
    candidate.pathname = "/";
    candidate.search = "";
    candidate.hash = "";
    candidate.searchParams.set("payment", "returned");
    candidate.searchParams.set("quote", quoteId);
    return candidate.toString();
  } catch {
    return fallback;
  }
}

export function OPTIONS(request: NextRequest) {
  return authRouteOptions(request);
}

export async function POST(request: NextRequest) {
  try {
    const auth = await createAuthRequestClient(request);
    if (auth.error || !auth.user) throw new PublicJoinError("Authentication required.", 401);
    if (!auth.usesBearer && !isLocalAppOrigin(request)) assertSameOrigin(request);
    const identity = await resolveAuthIdentity(auth.supabase, auth.user);
    if (!identity || identity.status !== "ready" || !identity.activeRoles.includes("customer")) {
      throw new PublicJoinError("Customer account required.", 403);
    }

    const body = (await request.json().catch(() => null)) as {
      quoteId?: unknown;
      returnUrl?: unknown;
    } | null;
    const quoteId = String(body?.quoteId ?? "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(quoteId)) throw new PublicJoinError("Invalid quote.", 400);
    const siteUrl = (process.env.APP_URL || process.env.NEXT_PUBLIC_SITE_URL || request.nextUrl.origin).replace(/\/$/, "");
    const redirectionUrl = paymentReturnUrl(body?.returnUrl, quoteId, siteUrl);

    const admin = createAdminClient();
    const orderResult = await admin
      .from("orders")
      .select("id,order_code,customer_quote_id,customer_profile_id,total,payment_status,invoices(id,total,status,payment_records(id,amount,status,gateway_reference,created_at))")
      .eq("customer_quote_id", quoteId)
      .eq("customer_profile_id", auth.user.id)
      .maybeSingle();
    if (orderResult.error) throw new Error("payment_order_lookup_failed");
    if (!orderResult.data) throw new PublicJoinError("Order not found. Accept the quote first.", 404);
    const invoice = (orderResult.data.invoices as unknown as {
      id: string;
      total: number;
      status: string;
      payment_records: Array<{ id: string; amount: number; status: string; gateway_reference: string | null; created_at: string }>;
    } | null);
    const payment = invoice?.payment_records?.slice().sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    if (!invoice || !payment) throw new PublicJoinError("Payment record is unavailable.", 409);
    if (payment.status === "succeeded" || invoice.status === "paid" || orderResult.data.payment_status === "paid") {
      return authRouteResponse(request, { status: "succeeded" });
    }
    if (payment.status === "refunded") throw new PublicJoinError("This payment was refunded.", 409);

    const total = Number(orderResult.data.total);
    if (!Number.isFinite(total) || total <= 0 || Math.abs(total - Number(invoice.total)) > 0.001 || Math.abs(total - Number(payment.amount)) > 0.001) {
      throw new PublicJoinError("Payment amount does not match the order.", 409);
    }

    if (payment.status === "pending" && payment.gateway_reference) {
      const reconciliation = await reconcilePaymobPayment(admin, payment.id);
      if (reconciliation.status === "succeeded") {
        return authRouteResponse(request, { status: "succeeded" });
      }
    }

    const savedSession = payment.status === "pending" ? parsePaymobSession(payment.gateway_reference) : null;
    if (
      savedSession &&
      savedSession.returnUrl === redirectionUrl &&
      Date.now() - savedSession.createdAt < 55 * 60 * 1000
    ) {
      return authRouteResponse(request, { status: "pending", checkoutUrl: paymobCheckoutUrl(savedSession.clientSecret) });
    }

    const profileResult = await admin
      .from("profiles")
      .select("full_name,email,mobile")
      .eq("id", auth.user.id)
      .single();
    if (profileResult.error) throw new Error("payment_profile_lookup_failed");
    const phone = String(profileResult.data.mobile ?? auth.user.phone ?? "").trim();
    const email = String(profileResult.data.email ?? auth.user.email ?? "").trim();
    if (!phone || !email) throw new PublicJoinError("Complete your mobile number and email before payment.", 422);

    const intention = await createPaymobIntention({
      amountCents: Math.round(total * 100),
      paymentRecordId: payment.id,
      orderCode: orderResult.data.order_code,
      quoteId,
      customer: {
        fullName: String(profileResult.data.full_name ?? auth.user.user_metadata?.full_name ?? "Bunya Customer"),
        email,
        phone,
      },
      notificationUrl: `${siteUrl}/api/payments/paymob/webhook`,
      redirectionUrl,
    });
    const gatewayReference = serializePaymobSession({
      ...intention,
      createdAt: Date.now(),
      returnUrl: redirectionUrl,
    });
    const update = await admin
      .from("payment_records")
      .update({ gateway_reference: gatewayReference, failure_code: null, processed_at: null, status: "pending" })
      .eq("id", payment.id)
      .eq("customer_profile_id", auth.user.id)
      .in("status", ["pending", "failed"]);
    if (update.error) throw new Error("payment_session_save_failed");
    return authRouteResponse(request, { status: "pending", checkoutUrl: paymobCheckoutUrl(intention.clientSecret) }, 201);
  } catch (error) {
    if (error instanceof PublicJoinError) return authRouteResponse(request, { message: error.message }, error.status);
    console.error("Paymob intention error", error instanceof Error ? error.message : "unknown_error");
    return authRouteResponse(request, { message: "Payment service is temporarily unavailable." }, 503);
  }
}
