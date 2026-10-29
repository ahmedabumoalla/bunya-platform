import type { NextRequest } from "next/server";
import { priceQuotationContext, priceQuotationFailure, priceQuotationResponse } from "@/lib/quotes/price-quotation-server";
import { priceQuotationCatalog } from "@/lib/quotes/price-quotation-catalog";
import { ManagedQuoteError, managedQuoteId } from "@/lib/quotes/managed-server";

export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    const context = await priceQuotationContext(request);
    const search = request.nextUrl.searchParams.get("q") ?? "", id = request.nextUrl.searchParams.get("product_id");
    if (search.length > 120 || (id && !/^brkz-[a-f0-9]{24}$/.test(id) && !managedQuoteId.test(id))) throw new ManagedQuoteError(400, "بحث المنتج غير صالح.");
    return priceQuotationResponse(await priceQuotationCatalog(context, search, id));
  } catch (error) { return priceQuotationFailure(error); }
}
