import "server-only";
import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import { ManagedQuoteError, type ManagedQuoteContext } from "./managed-server";
import { priceQuotationContext, readPriceQuotation } from "./price-quotation-server";
import { normalizePriceInvoiceInput, priceInvoiceQr, validateInvoiceSeller } from "./price-invoice-validation";
import type { PriceInvoice, PriceInvoiceSettings } from "./price-invoice-types";

export async function priceInvoiceContext(request: NextRequest) {
  const context = await priceQuotationContext(request);
  const permission = await context.db.rpc("admin_has_permission", { requested_permission: "finance.manage" });
  if (permission.error || permission.data !== true) throw new ManagedQuoteError(403, "إصدار الفواتير وعرضها يتطلب صلاحية الإدارة المالية.");
  return context;
}
export async function priceInvoiceSettings(context: ManagedQuoteContext): Promise<PriceInvoiceSettings> {
  const result = await context.admin.from("price_invoice_settings").select("phase,verified_at,seller").eq("singleton", true).single();
  if (result.error || !result.data) throw new ManagedQuoteError(503, "إعدادات الفوترة غير متاحة حاليًا. أعد المحاولة.");
  return result.data as PriceInvoiceSettings;
}
function visibleInvoice(row: Record<string, unknown>): PriceInvoice {
  const { id, invoice_number, invoice_type, issued_at, supply_date, quotation_id, quotation_code, seller, buyer, items, subtotal, delivery_fee, vat_rate, vat_amount, total, currency } = row;
  const invoice = { id, status: "issued", invoice_number, invoice_type, issued_at, supply_date, quotation_id, quotation_code, seller, buyer, items, subtotal: Number(subtotal), delivery_fee: Number(delivery_fee), vat_rate: Number(vat_rate), vat_amount: Number(vat_amount), total: Number(total), currency } as Omit<PriceInvoice, "qr_payload">;
  return { ...invoice, qr_payload: priceInvoiceQr({ seller_name: invoice.seller.name, seller_vat: invoice.seller.vat_number, issued_at: invoice.issued_at, total: invoice.total, vat_amount: invoice.vat_amount }) };
}
export async function readPriceInvoice(context: ManagedQuoteContext, quoteId: string): Promise<PriceInvoice | null> {
  await readPriceQuotation(context, quoteId);
  const result = await context.admin.from("price_invoices").select("*").eq("quotation_id", quoteId).maybeSingle();
  if (result.error) throw new ManagedQuoteError(503, "تعذر تحميل الفاتورة. أعد المحاولة.");
  return result.data ? visibleInvoice(result.data) : null;
}
export async function previewPriceInvoice(context: ManagedQuoteContext, quoteId: string, input: unknown): Promise<PriceInvoice> {
  let draft;
  try { draft = normalizePriceInvoiceInput(input); } catch (error) { throw new ManagedQuoteError(400, (error as Error).message); }
  const [quote, settings] = await Promise.all([readPriceQuotation(context, quoteId), priceInvoiceSettings(context)]);
  try { validateInvoiceSeller(settings.seller); } catch (error) { throw new ManagedQuoteError(409, (error as Error).message); }
  if (quote.vat_rate !== 15) throw new ManagedQuoteError(409, "التحويل متاح حاليًا للعروض الخاضعة لضريبة 15٪. أنشئ عرضًا بهذه النسبة أو راجع المعالجة الضريبية قبل إصدار الفاتورة.");
  return { ...draft, id: "draft", status: "draft", invoice_number: "DRAFT", issued_at: new Date().toISOString(), quotation_id: quote.id, quotation_code: quote.quotation_code, seller: settings.seller, items: quote.items, subtotal: quote.subtotal, delivery_fee: quote.delivery_fee, vat_rate: quote.vat_rate, vat_amount: quote.vat_amount, total: quote.total, currency: "SAR", qr_payload: "" };
}
export async function createPriceInvoice(context: ManagedQuoteContext, quoteId: string, input: unknown) {
  let draft;
  try { draft = normalizePriceInvoiceInput(input); } catch (error) { throw new ManagedQuoteError(400, (error as Error).message); }
  const quote = await readPriceQuotation(context, quoteId);
  const settings = await priceInvoiceSettings(context);
  if (settings.phase !== "phase1" || !settings.verified_at) throw new ManagedQuoteError(409, settings.phase === "phase2" ? "المنشأة في مرحلة الربط والتكامل. يلزم تفعيل الربط مع فاتورة قبل إصدار الفواتير؛ يمكنك معاينة مسودة الآن." : "يلزم تحديد مرحلة الفوترة والتحقق من بيانات المنشأة قبل الإصدار. يمكنك معاينة مسودة الآن.");
  try { validateInvoiceSeller(settings.seller); } catch (error) { throw new ManagedQuoteError(409, (error as Error).message); }
  if (quote.vat_rate !== 15) throw new ManagedQuoteError(409, "التحويل متاح حاليًا للعروض الخاضعة لضريبة 15٪ فقط.");
  const fingerprint = createHash("sha256").update(JSON.stringify(draft)).digest("hex");
  const result = await context.admin.rpc("price_quotation_issue_invoice", { p_actor: context.userId, p_quotation: quoteId, p_fingerprint: fingerprint, p_input: { ...draft, items: quote.items } });
  if (result.error) {
    if (result.error.code === "23505") throw new ManagedQuoteError(409, "سبق تحويل العرض ببيانات مختلفة. حدّث الصفحة لعرض الفاتورة الأصلية.");
    if (result.error.code === "42501") throw new ManagedQuoteError(403, "لا تملك صلاحية إصدار الفاتورة.");
    throw new ManagedQuoteError(409, "تعذر إصدار الفاتورة. تحقق من إعدادات الفوترة وبيانات العميل ثم أعد المحاولة.");
  }
  const invoice = await readPriceInvoice(context, quoteId);
  if (!invoice) throw new ManagedQuoteError(503, "تعذر تحميل نتيجة الإصدار. حدّث الصفحة قبل إعادة المحاولة.");
  return invoice;
}
