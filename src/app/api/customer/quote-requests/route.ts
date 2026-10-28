import { after, NextRequest, NextResponse } from "next/server";
import { normalizeSaudiPhone } from "@/lib/auth/phone-verification";
import { normalizePendingStorefrontQuote } from "@/lib/quotes/pending-draft";
import { deletePendingQuote, pendingQuoteCookie, pendingQuoteCookieOptions } from "@/lib/quotes/pending-draft-server";
import { managedQuoteContext, ManagedQuoteError, submitManagedQuote } from "@/lib/quotes/managed-server";
import { enqueueManagedQuoteNotification } from "@/lib/notifications/managed-quotes";
import { dispatchNotificationEvent } from "@/lib/notifications/dispatcher";

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
  let context: Awaited<ReturnType<typeof managedQuoteContext>>;
  try { context = await managedQuoteContext(request); }
  catch (error) { return NextResponse.json({ message: error instanceof ManagedQuoteError ? error.message : "تعذر التحقق من الحساب." }, { status: error instanceof ManagedQuoteError ? error.status : 500 }); }

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

  let requestId: string;
  try {
    requestId = await submitManagedQuote(context, {
      ...draft, details: { ...details, recipientMobile, siteResponsibleMobile: responsibleMobile, contractorMobile: contractorMobile || "" },
    });
    let notificationId: string;
    try { notificationId = await enqueueManagedQuoteNotification(context.admin, requestId); }
    catch { throw new ManagedQuoteError(503, "تم حفظ الطلب، لكن تعذر تجهيز إشعار الإدارة. أعد المحاولة لإكمال الإرسال."); }
    after(async () => {
      await dispatchNotificationEvent(notificationId).catch(() => console.error("managed_quote_notification_dispatch_failed", { requestId }));
    });
  } catch (error) {
    return NextResponse.json({ message: error instanceof ManagedQuoteError ? error.message : "أعد اختيار المنتج ووحدته ومواصفاته من الكتالوج." }, { status: error instanceof ManagedQuoteError ? error.status : 400 });
  }
  const token = request.cookies.get(pendingQuoteCookie)?.value;
  await deletePendingQuote(token).catch(() => undefined);
  const response = NextResponse.json({ requestId, redirectUrl: `/customer/managed-quotes/${requestId}`, message: "تم إرسال طلب عرض السعر إلى الإدارة لتسعير المنتجات والتوصيل والضمان.", outsidePricingHours: false }, { status: 201 });
  response.cookies.set(pendingQuoteCookie, "", { ...pendingQuoteCookieOptions, maxAge: 0 });
  return response;
}
