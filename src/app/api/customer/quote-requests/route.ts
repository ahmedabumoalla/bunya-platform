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
  const responsibleMobile = normalizeSaudiPhone(details.siteResponsibleMobile);
  const contractorMobile = details.contractorMobile ? normalizeSaudiPhone(details.contractorMobile) : null;
  if (details.locationHint.length < 3) return NextResponse.json({ message: "أدخل وصفًا واضحًا لمكان التسليم." }, { status: 400 });
  if (!isGoogleMapsUrl(details.mapsUrl)) return NextResponse.json({ message: "أدخل رابط Google Maps صالحًا لموقع التسليم." }, { status: 400 });
  if (!Number.isFinite(desiredAt.getTime()) || desiredAt.getTime() <= Date.now() + 2 * 60 * 60 * 1000) {
    return NextResponse.json({ message: "موعد الاستلام يجب أن يكون بعد أكثر من ساعتين." }, { status: 400 });
  }
  if (details.recipientName.length < 2) return NextResponse.json({ message: "أدخل اسم مستلم الطلب." }, { status: 400 });
  if (!recipientMobile) return NextResponse.json({ message: "أدخل رقم جوال سعوديًا صحيحًا للمستلم." }, { status: 400 });
  if (details.siteResponsibleName.length < 2) return NextResponse.json({ message: "أدخل اسم المسؤول في الموقع." }, { status: 400 });
  if (!responsibleMobile) return NextResponse.json({ message: "أدخل رقم جوال سعوديًا صحيحًا لمسؤول الموقع." }, { status: 400 });
  if (details.contractorName && !contractorMobile) return NextResponse.json({ message: "أدخل رقم جوال صحيحًا للمقاول أو اترك بيانات المقاول فارغة." }, { status: 400 });
  if (details.contractorMobile && details.contractorName.length < 2) return NextResponse.json({ message: "أدخل اسم المقاول المرتبط برقم التواصل." }, { status: 400 });
  if (details.workingHours.length < 3) return NextResponse.json({ message: "حدد مواعيد عمل واستلام الموقع." }, { status: 400 });
  if (!details.loadingOption || !details.unloadingOption) return NextResponse.json({ message: "حدد مسؤولية التحميل وخيار التنزيل في الموقع." }, { status: 400 });
  if (!details.roadAccess || details.accessInstructions.length < 3) return NextResponse.json({ message: "حدد سهولة الطريق وأضف تعليمات وصول واضحة." }, { status: 400 });
  if (!details.driverDepartureLiabilityAccepted || !details.dataAccuracyAccepted) {
    return NextResponse.json({ message: "يجب الموافقة على إقراري مسؤولية الاستلام وصحة البيانات قبل الاعتماد." }, { status: 400 });
  }

  const result = await supabase.rpc("submit_storefront_rfq", {
    p_request: {
      location_hint: details.locationHint,
      google_maps_url: details.mapsUrl,
      desired_receipt_at: desiredAt.toISOString(),
      delivery_mode: details.deliveryMode,
      project_name: details.projectName,
      recipient_name: details.recipientName,
      recipient_mobile: recipientMobile,
      site_responsible_name: details.siteResponsibleName,
      site_responsible_mobile: responsibleMobile,
      contractor_name: details.contractorName,
      contractor_mobile: contractorMobile || "",
      working_hours: details.workingHours,
      loading_option: details.loadingOption,
      unloading_option: details.unloadingOption,
      road_access: details.roadAccess,
      access_instructions: details.accessInstructions,
      driver_departure_liability_accepted: details.driverDepartureLiabilityAccepted,
      data_accuracy_accepted: details.dataAccuracyAccepted,
      notes: details.notes,
    },
    p_items: draft.items.map((item) => ({
      product_id: item.productId,
      quantity: item.quantity,
      unit: item.unit,
      measurement: item.measurementLabel === "بدون قياس إضافي" ? "" : item.measurementLabel,
      unit_id: item.unitId || "",
      measurement_id: item.measurementId,
      variant_ids: item.selectedVariants.map((variant) => variant.id),
      notes: item.notes || "",
    })),
    p_idempotency_key: draft.idempotencyKey,
  });
  if (result.error || !result.data) {
    const catalogErrors: Record<string, string> = {
      "Invalid item quantity": "أدخل كمية موجبة لا تتجاوز مليونًا، وبحد أقصى ثلاث خانات عشرية.",
      "Product minimum order not met": "الكمية أقل من الحد الأدنى الذي حدده المزود لهذا المنتج.",
      "Product is not available": "أحد المنتجات لم يعد متاحًا لطلب التسعير. راجع المنتجات المختارة.",
      "Product unit is not available": "اختر وحدة متاحة من وحدات المنتج.",
      "Product unit is required": "اختر وحدة المنتج قبل إرسال الطلب.",
      "Product measurement is not available": "اختر قياسًا متاحًا لهذا المنتج والوحدة.",
      "Product measurement is required": "اختر القياس المطلوب من الخيارات المتاحة للمنتج.",
      "Product measurement unit mismatch": "القياس المختار لا يتبع وحدة المنتج المحددة.",
      "Product variant is not available": "أحد خيارات المنتج لم يعد متاحًا. أعد اختيار المواصفات.",
      "Product variant is required": "اختر المواصفات المتاحة للمنتج قبل إرسال الطلب.",
      "Select every product variant group": "اختر قيمة لكل مجموعة من مواصفات المنتج.",
      "Select one value per product variant group": "اختر قيمة واحدة فقط لكل مجموعة من المواصفات.",
      "Duplicate product variant": "لا يمكن تكرار خيار المواصفات في المنتج نفسه.",
    };
    const message = catalogErrors[result.error?.message || ""] || (result.error?.message.includes("Verified customer required")
      ? "الاعتماد متاح لحساب العميل الموثق فقط."
      : "تعذر اعتماد طلب عرض السعر. راجع البيانات وحاول مرة أخرى.");
    return NextResponse.json({ message }, { status: 400 });
  }

  const token = request.cookies.get(pendingQuoteCookie)?.value;
  await deletePendingQuote(token).catch(() => undefined);
  const { data: createdRequest } = await supabase
    .from("quote_requests")
    .select("quote_window_label")
    .eq("id", result.data)
    .eq("requester_id", auth.user.id)
    .maybeSingle();
  const message = createdRequest?.quote_window_label || "تم استلام طلب عرض السعر وبدأ توجيه كل صنف للمزودين المؤهلين.";
  const response = NextResponse.json(
    {
      requestId: result.data,
      message,
      outsidePricingHours: message.includes("خلال 24 ساعة"),
    },
    { status: 201 },
  );
  response.cookies.set(pendingQuoteCookie, "", { ...pendingQuoteCookieOptions, maxAge: 0 });
  return response;
}
