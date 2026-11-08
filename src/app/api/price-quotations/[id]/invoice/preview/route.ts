import type { NextRequest } from "next/server";
import { priceQuotationFailure, readPriceQuotationBody } from "@/lib/quotes/price-quotation-server";
import { priceInvoiceContext, previewPriceInvoice } from "@/lib/quotes/price-invoice-server";
import { renderPriceInvoicePdf } from "@/lib/quotes/price-invoice-pdf";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function POST(request: NextRequest, route: { params: Promise<{ id: string }> }) {
  try {
    const context = await priceInvoiceContext(request);
    const preview = await previewPriceInvoice(context, (await route.params).id, await readPriceQuotationBody(request));
    const pdf = await renderPriceInvoicePdf(preview);
    return new Response(new Uint8Array(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": 'inline; filename="invoice-draft.pdf"', "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) { return priceQuotationFailure(error); }
}
