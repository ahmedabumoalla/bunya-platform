import type { NextRequest } from "next/server";
import { priceQuotationContext, priceQuotationFailure, readPriceQuotation } from "@/lib/quotes/price-quotation-server";
import { renderPriceQuotationPdf } from "@/lib/quotes/price-quotation-pdf";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(request: NextRequest, route: { params: Promise<{ id: string }> }) {
  try {
    const context = await priceQuotationContext(request);
    const quotation = await readPriceQuotation(context, (await route.params).id);
    const pdf = await renderPriceQuotationPdf(quotation);
    return new Response(new Uint8Array(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `${request.nextUrl.searchParams.get("download") === "1" ? "attachment" : "inline"}; filename="${quotation.quotation_code}.pdf"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) { return priceQuotationFailure(error); }
}
