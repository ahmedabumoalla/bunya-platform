import { NextRequest, NextResponse } from "next/server";
import { createAuthRequestClient } from "@/lib/auth/request-client";
import { resolveAuthIdentity } from "@/lib/auth/resolve-identity";
import { assertSameOrigin } from "@/lib/join/security";
import { createAdminClient } from "@/lib/supabase/admin";
import { createPaymobIntention, getPaymobConfig, paymobCheckoutUrl } from "@/lib/payments/paymob";
import { reconcileContractorPayment } from "@/lib/payments/contractor-payments";

export const runtime = "nodejs";
const reply = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: NextRequest) {
  try {
    const auth = await createAuthRequestClient(request);
    if (!auth.user || auth.error) return reply({ message: "سجّل الدخول أولًا." }, 401);
    if (!auth.usesBearer) assertSameOrigin(request);
    const identity = await resolveAuthIdentity(auth.supabase, auth.user);
    if (identity?.status !== "ready" || identity.profile?.mustChangePassword) return reply({ message: "الحساب غير جاهز للدفع." }, 403);
    if (Number(request.headers.get("content-length") ?? 0) > 2048) return reply({ message: "طلب غير صالح." }, 413);
    const text = await request.text();
    if (text.length > 2048) return reply({ message: "طلب غير صالح." }, 413);
    const body = JSON.parse(text) as { conversationId?: string; reconcile?: boolean };
    if (!body.conversationId || !/^[0-9a-f-]{36}$/i.test(body.conversationId)) return reply({ message: "محادثة غير صالحة." }, 400);
    const access = await auth.supabase.from("contractor_conversations").select("id,customer_id").eq("id", body.conversationId).single();
    const finance = body.reconcile && identity.activeRoles.includes("admin") ? await auth.supabase.rpc("admin_has_permission", { requested_permission: "finance.manage" }) : null;
    if (access.error || (access.data.customer_id !== auth.user.id || !identity.activeRoles.includes("customer")) && !finance?.data) return reply({ message: "لا تملك صلاحية الدفع لهذا الاتفاق." }, 403);
    const config = getPaymobConfig();
    if (config.secretKey.includes("_test_")) return reply({ message: "الدفع الإلكتروني بانتظار تفعيل الحساب التجاري. يمكنك استخدام التحويل للمنصة." }, 503);
    const admin = createAdminClient();
    // Reconcile all unresolved sessions before allowing a new reservation or bank confirmation.
    const prior = await admin.from("contractor_chat_payments").select("id,gateway_order_id,expires_at").eq("conversation_id", body.conversationId).eq("status", "pending").order("created_at", { ascending: false }).limit(20);
    if (prior.error) throw new Error("payment_lookup_failed");
    for (const payment of prior.data ?? []) await reconcileContractorPayment(admin, payment);
    if (body.reconcile) return reply({ status: "refreshed" });
    if (!identity.profile?.email || !identity.profile?.mobile) return reply({ message: "أكمل البريد ورقم الجوال في ملفك الشخصي قبل الدفع." }, 422);
    const reserved = await admin.rpc("reserve_contractor_chat_payment", { p_id: body.conversationId, p_customer: auth.user.id });
    if (reserved.error) return reply({ message: "تعذر بدء الدفع. تحقق من حالة الاتفاق والمدفوعات السابقة." }, 409);
    const payment = reserved.data as { id: string; status: string; amount: number; created: boolean; session_secret: string | null; number: number; quote_id: string; created_at: string };
    if (payment.status === "succeeded") return reply({ status: "succeeded" });
    if (payment.session_secret) {
      if (Date.now() - Date.parse(payment.created_at) > 55 * 60 * 1000) return reply({ message: "انتهت جلسة الدفع؛ نتحقق من نتيجتها قبل إتاحة جلسة جديدة. أعد المحاولة بعد قليل." }, 409);
      return reply({ checkoutUrl: paymobCheckoutUrl(payment.session_secret) });
    }
    if (!payment.created) return reply({ message: "جارٍ التحقق من جلسة الدفع السابقة. أعد المحاولة بعد قليل." }, 409);
    const site = (process.env.APP_URL || process.env.NEXT_PUBLIC_SITE_URL || request.nextUrl.origin).replace(/\/$/, "");
    const intention = await createPaymobIntention({ amountCents: Math.round(Number(payment.amount) * 100), paymentRecordId: payment.id, orderCode: `CHAT-${payment.number}`, quoteId: payment.quote_id,
      customer: { fullName: identity.profile.fullName || "Bunya customer", email: identity.profile.email, phone: identity.profile.mobile },
      notificationUrl: `${site}/api/contractor-payments/webhook`, redirectionUrl: `${site}/customer/conversations?id=${body.conversationId}&payment=returned` });
    if (!intention.orderId) throw new Error("gateway_order_missing");
    const saved = await admin.from("contractor_chat_payments").update({ gateway_order_id: intention.orderId, session_secret: intention.clientSecret }).eq("id", payment.id).eq("status", "pending").select("id").single();
    if (saved.error) throw new Error("checkout_save_failed");
    return reply({ checkoutUrl: paymobCheckoutUrl(intention.clientSecret) }, 201);
  } catch {
    return reply({ message: "خدمة الدفع غير متاحة حاليًا. لم نؤكد تحصيل أي مبلغ؛ أعد التحقق من حالة الدفع قبل المحاولة." }, 503);
  }
}
