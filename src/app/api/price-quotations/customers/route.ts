import type { NextRequest } from "next/server";
import { priceQuotationContext, priceQuotationFailure, priceQuotationResponse } from "@/lib/quotes/price-quotation-server";
import { ManagedQuoteError } from "@/lib/quotes/managed-server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const context = await priceQuotationContext(request);
    const query = (request.nextUrl.searchParams.get("q") || "").trim();
    const page = Number(request.nextUrl.searchParams.get("page") || 0);
    if (query.length > 100 || /[\u0000-\u001f\u007f]/.test(query) || !Number.isSafeInteger(page) || page < 0 || page > 50000) throw new ManagedQuoteError(400, "عبارة البحث أو رقم الصفحة غير صالح.");
    const result = await context.admin.rpc("sales_customer_search", { p_actor: context.userId, p_query: query, p_limit: 20, p_offset: page * 20 });
    if (result.error) throw new ManagedQuoteError(result.error.code === "42501" ? 403 : 503, "تعذر تحميل العملاء المحفوظين. أعد المحاولة.");
    return priceQuotationResponse(result.data);
  } catch (error) { return priceQuotationFailure(error); }
}
