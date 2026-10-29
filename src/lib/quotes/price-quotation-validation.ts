import type { PriceQuotationDraft } from "./price-quotation-types";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
function text(value: unknown, max: number) {
  if (value == null) return "";
  if (typeof value !== "string" || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new Error("النص أطول من الحد المسموح أو يحتوي رموزًا غير صالحة.");
  return value.trim();
}
function number(value: unknown, max: number, decimals: number, positive = false) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > max || (positive && value === 0) || value !== Number(value.toFixed(decimals))) throw new Error("تحقق من الكميات والأسعار؛ السعر يقبل منزلتين والكمية ثلاث منازل عشرية.");
  return value;
}

export function normalizePriceQuotationDraft(value: unknown): PriceQuotationDraft {
  if (!record(value) || typeof value.idempotency_key !== "string" || !uuid.test(value.idempotency_key)) throw new Error("تعذر التعرف على المسودة. أعد فتح إنشاء العرض.");
  const source = value.source_request_id == null || value.source_request_id === "" ? null : value.source_request_id;
  if (source !== null && (typeof source !== "string" || !uuid.test(source))) throw new Error("طلب عرض السعر المرتبط غير صالح.");
  const phone = text(value.customer_phone, 30).replace(/[\s()+-]/g, "");
  const digits = phone.startsWith("05") ? `966${phone.slice(1)}` : phone.startsWith("5") ? `966${phone}` : phone;
  if (!/^9665\d{8}$/.test(digits)) throw new Error("أدخل رقم جوال سعودي صحيح للعميل.");
  if (!Array.isArray(value.items) || value.items.length < 1 || value.items.length > 50) throw new Error("اختر من منتج واحد إلى 50 منتجًا.");
  const items = value.items.map(item => {
    if (!record(item)) throw new Error("بيانات المنتج غير صالحة.");
    const productId = text(item.product_id, 100), sourceItem = text(item.source_item_id, 100);
    if (!productId || (sourceItem && !source)) throw new Error("مرجع المنتج غير صالح.");
    if (!sourceItem && !/^brkz-[a-f0-9]{24}$/.test(productId) && !uuid.test(productId)) throw new Error("مرجع المنتج غير صالح.");
    const measurement = text(item.measurement_id, 36);
    if (measurement && !uuid.test(measurement)) throw new Error("قياس المنتج غير صالح.");
    const selections = item.variant_ids ?? [];
    if (!Array.isArray(selections) || selections.length > 20 || selections.some(value => typeof value !== "string" || !uuid.test(value)) || new Set(selections).size !== selections.length) throw new Error("مواصفات المنتج غير صالحة.");
    return { product_id: productId, sku: text(item.sku, 120), unit: text(item.unit, 100), quantity: number(item.quantity, 1000000, 3, true), unit_price: number(item.unit_price, 10000000, 2), notes: text(item.notes, 600), ...(sourceItem ? { source_item_id: sourceItem } : {}), ...(measurement ? { measurement_id: measurement } : {}), ...(selections.length ? { variant_ids: selections as string[] } : {}) };
  });
  const rawUntil = text(value.valid_until, 40);
  const until = rawUntil ? new Date(rawUntil) : null;
  if (until && (!Number.isFinite(until.getTime()) || !/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(rawUntil))) throw new Error("تاريخ صلاحية العرض غير صالح.");
  const tax = text(value.customer_tax_number, 15);
  if (tax && !/^\d{15}$/.test(tax)) throw new Error("الرقم الضريبي للعميل يجب أن يتكون من 15 رقمًا، أو اتركه فارغًا.");
  return { idempotency_key: value.idempotency_key, source_request_id: source, customer_name: text(value.customer_name, 160), customer_phone: `+${digits}`, customer_address: text(value.customer_address, 400), customer_tax_number: tax, delivery_city: text(value.delivery_city, 160), delivery_window: text(value.delivery_window, 240), items, vat_rate: number(value.vat_rate, 100, 2), delivery_fee: number(value.delivery_fee, 10000000, 2), valid_until: until?.toISOString() ?? null, terms: text(value.terms, 3000) };
}

// All arithmetic is in integer fils; quantity is in thousandths. Round half up
// once per line, then once for VAT on products and delivery combined.
export function calculatePriceQuotationTotals(items: { quantity: number; unit_price: number }[], deliveryFee: number, vatRate: number) {
  const cents = items.map(item => (BigInt(Math.round(item.quantity * 1000)) * BigInt(Math.round(item.unit_price * 100)) + BigInt(500)) / BigInt(1000));
  const subtotalCents = cents.reduce((sum, item) => sum + item, BigInt(0));
  const deliveryCents = BigInt(Math.round(deliveryFee * 100));
  const vatCents = ((subtotalCents + deliveryCents) * BigInt(Math.round(vatRate * 100)) + BigInt(5000)) / BigInt(10000);
  const totalCents = subtotalCents + deliveryCents + vatCents;
  if (totalCents > BigInt(100000000000)) throw new Error("إجمالي العرض أكبر من الحد المسموح.");
  return { line_totals: cents.map(value => Number(value) / 100), subtotal: Number(subtotalCents) / 100, vat_amount: Number(vatCents) / 100, total: Number(totalCents) / 100 };
}
