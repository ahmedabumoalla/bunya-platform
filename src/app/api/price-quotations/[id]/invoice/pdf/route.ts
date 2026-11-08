import type { NextRequest } from "next/server";
import { priceQuotationFailure } from "@/lib/quotes/price-quotation-server";
import { priceInvoiceContext, readPriceInvoice } from "@/lib/quotes/price-invoice-server";
import { renderPriceInvoicePdf } from "@/lib/quotes/price-invoice-pdf";
import { ManagedQuoteError } from "@/lib/quotes/managed-server";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(request: NextRequest, route: { params: Promise<{ id: string }> }) {
  try {
    const context = await priceInvoiceContext(request);
    const invoice = await readPriceInvoice(context, (await route.params).id);
    if (!invoice) throw new ManagedQuoteError(404, "لم تُصدر فاتورة لهذا العرض بعد.");
    const pdf = await renderPriceInvoicePdf(invoice);
    return new Response(new Uint8Array(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `${request.nextUrl.searchParams.get("download") === "1" ? "attachment" : "inline"}; filename="${invoice.invoice_number}.pdf"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) { return priceQuotationFailure(error); }
}
