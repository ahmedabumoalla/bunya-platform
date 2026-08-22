import { NextRequest, NextResponse } from "next/server";
import { normalizeSaudiPhone } from "@/lib/auth/phone-verification";
import { normalizePendingStorefrontQuote } from "@/lib/quotes/pending-draft";
import { deletePendingQuote, pendingQuoteCookie, pendingQuoteCookieOptions } from "@/lib/quotes/pending-draft-server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

function isGoogleMapsUrl(value: string) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return host === "maps.app.goo.gl" || host === "goo.gl" ||
      (host.endsWith("google.com") && url.pathname.includes("/maps")) || host.startsWith("maps.google.");
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) return NextResponse.json({ message: "سجّل الدخول بحساب العميل لاعتماد الطلب." }, { status: 401 });

  const draft = normalizePendingStorefrontQuote(await request.json().catch(() => null));
  if (!draft) return NextResponse.json({ message: "بيانات طلب عرض السعر غير صالحة." }, { status: 400 });
  const details = draft.details;
  const desiredAt = new Date(details.desiredReceiptAt);
  const recipientMobile = normalizeSaudiPhone(details.recipientMobile);
  if (details.city.length < 2) return NextResponse.json({ message: "أدخل المدينة أو المنطقة العامة." }, { status: 400 });
  if (details.locationHint.length < 2) return NextResponse.json({ message: "أدخل وصفًا واضحًا لموقع التسليم." }, { status: 400 });
  if (!isGoogleMapsUrl(details.mapsUrl)) return NextResponse.json({ message: "أدخل رابط Google Maps صالحًا لموقع التسليم." }, { status: 400 });
  if (!Number.isFinite(desiredAt.getTime()) || desiredAt.getTime() <= Date.now() + 2 * 60 * 60 * 1000) {
    return NextResponse.json({ message: "موعد الاستلام يجب أن يكون بعد أكثر من ساعتين." }, { status: 400 });
  }
  if (details.recipientName.length < 2) return NextResponse.json({ message: "أدخل اسم مستلم الطلب." }, { status: 400 });
  if (!recipientMobile) return NextResponse.json({ message: "أدخل رقم جوال سعوديًا صحيحًا للمستلم." }, { status: 400 });

  const result = await supabase.rpc("submit_storefront_rfq", {
    p_request: {
      city: details.city,
      location_hint: details.locationHint,
      google_maps_url: details.mapsUrl,
      desired_receipt_at: desiredAt.toISOString(),
      delivery_mode: details.deliveryMode,
      project_name: details.projectName,
      recipient_name: details.recipientName,
      recipient_mobile: recipientMobile,
      notes: details.notes,
    },
    p_items: draft.items.map((item) => ({
      product_id: item.productId,
      quantity: item.quantity,
      unit: item.unit,
      measurement: item.measurementLabel === "بدون قياس إضافي" ? "" : item.measurementLabel,
      unit_id: "",
      measurement_id: item.measurementId,
      notes: item.notes || "",
    })),
    p_idempotency_key: draft.idempotencyKey,
  });
  if (result.error || !result.data) {
    const message = result.error?.message.includes("Verified customer required")
      ? "الاعتماد متاح لحساب العميل الموثق فقط."
      : "تعذر اعتماد طلب عرض السعر. راجع البيانات وحاول مرة أخرى.";
    return NextResponse.json({ message }, { status: 400 });
  }

  const token = request.cookies.get(pendingQuoteCookie)?.value;
  await deletePendingQuote(token).catch(() => undefined);
  const response = NextResponse.json({ requestId: result.data }, { status: 201 });
  response.cookies.set(pendingQuoteCookie, "", { ...pendingQuoteCookieOptions, maxAge: 0 });
  return response;
}
