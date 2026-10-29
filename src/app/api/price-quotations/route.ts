import type { NextRequest } from "next/server";
import { createPriceQuotation, priceQuotationContext, priceQuotationFailure, priceQuotationResponse, readPriceQuotationBody, visiblePriceQuotation } from "@/lib/quotes/price-quotation-server";
import { ManagedQuoteError } from "@/lib/quotes/managed-server";

export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    const context = await priceQuotationContext(request);
    const page = Number(request.nextUrl.searchParams.get("page") || 0);
    if (!Number.isSafeInteger(page) || page < 0 || page > 100000) throw new ManagedQuoteError(400, "رقم الصفحة غير صالح.");
    const result = await context.admin.from("price_quotations").select("*", { count: "exact" }).order("created_at", { ascending: false }).order("id").range(page * 30, page * 30 + 29);
    if (result.error) throw new ManagedQuoteError(503, "تعذر تحميل عروض الأسعار. تأكد من تفعيل القسم ثم أعد المحاولة.");
    return priceQuotationResponse({ quotations: result.data.map(visiblePriceQuotation), count: result.count ?? 0 });
  } catch (error) { return priceQuotationFailure(error); }
}
export async function POST(request: NextRequest) {
  try {
    const context = await priceQuotationContext(request);
    const quotation = await createPriceQuotation(context, await readPriceQuotationBody(request));
    return priceQuotationResponse({ quotation }, 201);
  } catch (error) { return priceQuotationFailure(error); }
}
