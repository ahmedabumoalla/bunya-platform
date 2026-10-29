import type { NextRequest } from "next/server";
import { priceQuotationContext, priceQuotationFailure, priceQuotationResponse, readPriceQuotation } from "@/lib/quotes/price-quotation-server";

export const dynamic = "force-dynamic";
export async function GET(request: NextRequest, route: { params: Promise<{ id: string }> }) {
  try {
    const context = await priceQuotationContext(request);
    return priceQuotationResponse({ quotation: await readPriceQuotation(context, (await route.params).id) });
  } catch (error) { return priceQuotationFailure(error); }
}
