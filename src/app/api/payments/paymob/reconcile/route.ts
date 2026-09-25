import { NextRequest } from "next/server";
import { resolveAuthIdentity } from "@/lib/auth/resolve-identity";
import {
  authRouteOptions,
  authRouteResponse,
  createAuthRequestClient,
  isLocalAppOrigin,
} from "@/lib/auth/request-client";
import { assertSameOrigin, PublicJoinError } from "@/lib/join/security";
import { reconcilePaymobPayment } from "@/lib/payments/paymob-reconciliation";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export function OPTIONS(request: NextRequest) {
  return authRouteOptions(request);
}

export async function POST(request: NextRequest) {
  try {
    const auth = await createAuthRequestClient(request);
    if (auth.error || !auth.user)
      throw new PublicJoinError("Authentication required.", 401);
    if (!auth.usesBearer && !isLocalAppOrigin(request)) assertSameOrigin(request);
    const identity = await resolveAuthIdentity(auth.supabase, auth.user);
    if (
      !identity ||
      identity.status !== "ready" ||
      !identity.activeRoles.includes("customer")
    ) {
      throw new PublicJoinError("Customer account required.", 403);
    }
    const body = (await request.json().catch(() => null)) as {
      quoteId?: unknown;
    } | null;
    const quoteId = String(body?.quoteId ?? "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(quoteId))
      throw new PublicJoinError("Invalid quote.", 400);
    const admin = createAdminClient();
    const order = await admin
      .from("orders")
      .select("id,invoices(payment_records(id,created_at))")
      .eq("customer_quote_id", quoteId)
      .eq("customer_profile_id", auth.user.id)
      .maybeSingle();
    const invoice = order.data?.invoices as unknown as {
      payment_records: Array<{ id: string; created_at: string }>;
    } | null;
    const payment = invoice?.payment_records
      ?.slice()
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    if (!payment) throw new PublicJoinError("Payment not found.", 404);
    const result = await reconcilePaymobPayment(admin, payment.id);
    return authRouteResponse(request, result);
  } catch (error) {
    const status = error instanceof PublicJoinError ? error.status : 503;
    const message =
      error instanceof PublicJoinError
        ? error.message
        : "Payment reconciliation is temporarily unavailable.";
    return authRouteResponse(request, { message }, status);
  }
}
