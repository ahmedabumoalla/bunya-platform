import type { NextRequest } from "next/server";
import { priceQuotationContext, priceQuotationFailure, priceQuotationResponse, sendPriceQuotation } from "@/lib/quotes/price-quotation-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: NextRequest, route: { params: Promise<{ id: string }> }) {
  try {
    const context = await priceQuotationContext(request);
    return priceQuotationResponse(await sendPriceQuotation(context, (await route.params).id));
  } catch (error) { return priceQuotationFailure(error); }
}
