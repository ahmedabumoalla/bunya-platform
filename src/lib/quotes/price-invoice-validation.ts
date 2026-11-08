import type { PriceInvoiceInput, InvoiceSeller } from "./price-invoice-types";

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const vat = /^3\d{13}3$/;
function text(value: unknown, max: number) {
  if (typeof value !== "string" || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) throw new Error("تحقق من بيانات الفاتورة وأطوال الحقول.");
  return value.trim();
}
export function normalizePriceInvoiceInput(value: unknown): PriceInvoiceInput {
  if (!record(value) || !record(value.buyer) || !["standard", "simplified"].includes(String(value.invoice_type))) throw new Error("اختر نوع الفاتورة وأكمل بيانات العميل.");
  const buyer = { name: text(value.buyer.name ?? "", 160), phone: text(value.buyer.phone ?? "", 30), address: text(value.buyer.address ?? "", 400), vat_number: text(value.buyer.vat_number ?? "", 15) };
  if (buyer.vat_number && !vat.test(buyer.vat_number)) throw new Error("الرقم الضريبي السعودي للعميل يتكون من 15 رقمًا ويبدأ وينتهي بالرقم 3.");
  if (buyer.phone && !/^\+9665\d{8}$/.test(buyer.phone)) throw new Error("رقم الجوال يجب أن يبدأ بـ +9665 ويحتوي 12 رقمًا.");
  if (value.invoice_type === "standard" && (!buyer.name || !buyer.address || !buyer.vat_number)) throw new Error("الفاتورة الضريبية للمنشأة المسجلة تحتاج اسم العميل القانوني وعنوانه ورقمه الضريبي.");
  if (value.invoice_type === "simplified" && buyer.vat_number) throw new Error("للعميل المسجل ضريبيًا اختر فاتورة ضريبية وأكمل بيانات المنشأة.");
  const supply = text(value.supply_date, 10), parsed = new Date(`${supply}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(supply) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== supply) throw new Error("أدخل تاريخ توريد صحيحًا.");
  return { invoice_type: value.invoice_type as PriceInvoiceInput["invoice_type"], buyer, supply_date: supply };
}
export function validateInvoiceSeller(seller: InvoiceSeller) {
  if (!seller || !text(seller.name, 160) || !text(seller.address, 400) || !vat.test(seller.vat_number) || !/^\d{10}$/.test(seller.commercial_registration)) throw new Error("بيانات البائع الضريبية غير مكتملة. يلزم مراجعة إعدادات الفوترة.");
}

// ZATCA Phase 1: tag, UTF-8 byte length, UTF-8 value; then Base64.
// This is not a Phase 2 cryptographic stamp or clearance response.
export function priceInvoiceQr(values: { seller_name: string; seller_vat: string; issued_at: string; total: number; vat_amount: number }) {
  const fields = [values.seller_name, values.seller_vat, new Date(values.issued_at).toISOString(), Number(values.total).toFixed(2), Number(values.vat_amount).toFixed(2)];
  return Buffer.concat(fields.map((value, index) => {
    const bytes = Buffer.from(value, "utf8");
    if (bytes.length > 255) throw new Error("اسم البائع أطول من الحد المسموح في رمز الفاتورة.");
    return Buffer.concat([Buffer.from([index + 1, bytes.length]), bytes]);
  })).toString("base64");
}
