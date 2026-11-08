import type { NextRequest } from "next/server";
import { priceQuotationFailure, priceQuotationResponse, readPriceQuotationBody } from "@/lib/quotes/price-quotation-server";
import { createPriceInvoice, priceInvoiceContext, priceInvoiceSettings, readPriceInvoice } from "@/lib/quotes/price-invoice-server";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest, route: { params: Promise<{ id: string }> }) {
  try {
    const context = await priceInvoiceContext(request), id = (await route.params).id;
    const [invoice, settings] = await Promise.all([readPriceInvoice(context, id), priceInvoiceSettings(context)]);
    return priceQuotationResponse({ invoice, settings });
  } catch (error) { return priceQuotationFailure(error); }
}
export async function POST(request: NextRequest, route: { params: Promise<{ id: string }> }) {
  try {
    const context = await priceInvoiceContext(request);
    const invoice = await createPriceInvoice(context, (await route.params).id, await readPriceQuotationBody(request));
    return priceQuotationResponse({ invoice }, 201);
  } catch (error) { return priceQuotationFailure(error); }
}
