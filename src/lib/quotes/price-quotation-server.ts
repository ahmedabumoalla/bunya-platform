import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { managedQuoteContext, ManagedQuoteError, managedQuoteId, readManagedQuote, type ManagedQuoteContext } from "./managed-server";
import { archiveActorStatus } from "@/lib/supabase/archive-server";
import { normalizePriceQuotationDraft, calculatePriceQuotationTotals } from "./price-quotation-validation";
import { canonicalPriceQuotationItem } from "./price-quotation-catalog";
import { renderPriceQuotationPdf } from "./price-quotation-pdf";
import { sendGreenApiFile } from "@/lib/notifications/providers/green-api";
import type { PriceQuotation, PriceQuotationItem } from "./price-quotation-types";
import { PRICE_QUOTATION_POLICY_VERSION } from "./price-quotation-policy";

export async function priceQuotationContext(request: NextRequest) {
  if (request.headers.get("sec-fetch-site") === "cross-site") throw new ManagedQuoteError(403, "مصدر الطلب غير صالح.");
  const context = await managedQuoteContext(request);
  if (!context.canManage) throw new ManagedQuoteError(403, "لا تملك صلاحية إعداد عروض الأسعار.");
  if ((await archiveActorStatus(context.userId)).active) throw new ManagedQuoteError(403, "هذا القسم غير متاح لهذا الحساب.");
  return context;
}

export function priceQuotationResponse(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "private, no-store" } });
}
export function priceQuotationFailure(error: unknown) {
  return priceQuotationResponse({ message: error instanceof ManagedQuoteError ? error.message : "تعذر تنفيذ العملية. أعد المحاولة." }, error instanceof ManagedQuoteError ? error.status : 500);
}
export async function readPriceQuotationBody(request: NextRequest) {
  if (!request.headers.get("content-type")?.includes("application/json")) throw new ManagedQuoteError(415, "صيغة الطلب غير صالحة.");
  if (Number(request.headers.get("content-length") ?? 0) > 100000) throw new ManagedQuoteError(413, "بيانات العرض أكبر من الحد المسموح.");
  const reader = request.body?.getReader();
  if (!reader) throw new ManagedQuoteError(400, "بيانات العرض مطلوبة.");
  const decoder = new TextDecoder(); let body = "", bytes = 0;
  try {
    while (true) { const chunk = await reader.read(); if (chunk.done) break; bytes += chunk.value.byteLength; if (bytes > 100000) { await reader.cancel(); throw new ManagedQuoteError(413, "بيانات العرض أكبر من الحد المسموح."); } body += decoder.decode(chunk.value, { stream: true }); }
    body += decoder.decode();
    try { return JSON.parse(body) as unknown; } catch { throw new ManagedQuoteError(400, "بيانات العرض غير صالحة."); }
  } finally { reader.releaseLock(); }
}

export function visiblePriceQuotation(row: PriceQuotation & Record<string, unknown>): PriceQuotation {
  const { id, quotation_code, source_request_id, source_request_code, customer_name, customer_phone, customer_address, customer_tax_number, delivery_city, delivery_window, policy_version, items, subtotal, vat_rate, vat_amount, delivery_fee, total, valid_until, terms, created_at, send_status, sent_at, send_error } = row;
  // A worker interrupted after provider submission cannot be retried safely.
  const stale = send_status === "sending" && Date.parse(String(row.send_started_at)) < Date.now() - 120000;
  return { id, quotation_code, source_request_id, source_request_code, customer_name, customer_phone, customer_address, customer_tax_number, delivery_city, delivery_window, policy_version, items, subtotal: Number(subtotal), vat_rate: Number(vat_rate), vat_amount: Number(vat_amount), delivery_fee: Number(delivery_fee), total: Number(total), valid_until, terms, created_at, send_status: stale ? "uncertain" : send_status, sent_at, send_error: stale ? "submission_unconfirmed" : send_error };
}

export async function readPriceQuotation(context: ManagedQuoteContext, id: string) {
  if (!managedQuoteId.test(id)) throw new ManagedQuoteError(404, "عرض السعر غير موجود.");
  const result = await context.admin.from("price_quotations").select("*").eq("id", id).maybeSingle();
  if (result.error) throw new ManagedQuoteError(503, "تعذر تحميل عرض السعر. تأكد من تفعيل القسم ثم أعد المحاولة.");
  if (!result.data) throw new ManagedQuoteError(404, "عرض السعر غير موجود.");
  return visiblePriceQuotation(result.data);
}

export async function createPriceQuotation(context: ManagedQuoteContext, input: unknown) {
  let draft;
  try { draft = normalizePriceQuotationDraft(input); } catch (error) { throw new ManagedQuoteError(400, error instanceof Error ? error.message : "تحقق من بيانات العرض."); }
  const fingerprint = createHash("sha256").update(JSON.stringify(draft)).digest("hex");
  const existing = await context.admin.from("price_quotations").select("*").eq("created_by", context.userId).eq("idempotency_key", draft.idempotency_key).maybeSingle();
  if (existing.error) throw new ManagedQuoteError(503, "تعذر حفظ العرض. تأكد من تفعيل القسم ثم أعد المحاولة.");
  if (existing.data) {
    if (existing.data.request_fingerprint !== fingerprint) throw new ManagedQuoteError(409, "هذه المسودة محفوظة ببيانات مختلفة. أنشئ عرضًا جديدًا.");
    return visiblePriceQuotation(existing.data);
  }
  const source = draft.source_request_id ? await readManagedQuote(context, draft.source_request_id) : null;
  const items: PriceQuotationItem[] = [];
  for (const [index, item] of draft.items.entries()) {
    if (item.source_item_id) {
      const original = source?.items.find(line => line.id === item.source_item_id && line.product_id === item.product_id);
      if (!original || original.unit !== item.unit || original.sku !== item.sku) throw new ManagedQuoteError(400, "المنتج المحدد لا يطابق الطلب المرتبط.");
      items.push({ product_id: original.product_id, product_name: original.product_name, sku: original.sku, unit: original.unit, attributes: original.attributes, quantity: item.quantity, unit_price: item.unit_price, notes: item.notes ?? "", line_total: 0 });
    } else items.push({ ...await canonicalPriceQuotationItem(context, item, index), line_total: 0 });
  }
  let totals;
  try { totals = calculatePriceQuotationTotals(items, draft.delivery_fee, draft.vat_rate); } catch (error) { throw new ManagedQuoteError(400, error instanceof Error ? error.message : "إجمالي العرض غير صالح."); }
  items.forEach((item, index) => { item.line_total = totals.line_totals[index]; });
  const result = await context.admin.rpc("price_quotation_create", { p_actor: context.userId, p_key: draft.idempotency_key, p_fingerprint: fingerprint, p_payload: { ...draft, policy_version: PRICE_QUOTATION_POLICY_VERSION, items, source_request_code: source?.request_code ?? null, subtotal: totals.subtotal, vat_amount: totals.vat_amount, total: totals.total } });
  if (result.error) throw new ManagedQuoteError(result.error.code === "23505" ? 409 : 503, result.error.code === "23505" ? "هذه المسودة محفوظة ببيانات مختلفة." : "تعذر حفظ عرض السعر. أعد المحاولة.");
  return readPriceQuotation(context, String(result.data));
}

export async function sendPriceQuotation(context: ManagedQuoteContext, id: string) {
  const quotation = await readPriceQuotation(context, id);
  if (quotation.send_status === "submitted") return { quotation, message: "سبق إرسال هذا العرض إلى مزود واتساب." };
  if (["sending", "uncertain"].includes(quotation.send_status)) throw new ManagedQuoteError(409, "إرسال هذا العرض قيد التنفيذ أو غير مؤكد. تحقق من المحادثة قبل إنشاء إرسال جديد.");
  if (quotation.valid_until && Date.parse(quotation.valid_until) < Date.now()) throw new ManagedQuoteError(409, "انتهت صلاحية العرض. أنشئ عرضًا جديدًا بتاريخ صالح.");
  const bytes = await renderPriceQuotationPdf(quotation);
  const claim = randomUUID();
  const claimed = await context.admin.rpc("price_quotation_claim_send", { p_actor: context.userId, p_id: id, p_claim: claim });
  if (claimed.error) throw new ManagedQuoteError(503, "تعذر بدء الإرسال. أعد المحاولة.");
  if (claimed.data !== true) throw new ManagedQuoteError(409, "بدأ إرسال العرض من جلسة أخرى. حدّث الصفحة.");
  let submission;
  try { submission = await sendGreenApiFile({ to: quotation.customer_phone, file: new File([new Uint8Array(bytes)], `${quotation.quotation_code}.pdf`, { type: "application/pdf" }), caption: `شركة العنوان الحصري\nعرض السعر ${quotation.quotation_code}`, idempotencyKey: `price-quotation:${id}`, attempts: 1 }); }
  catch { submission = { status: "failed" as const, providerMessageId: null, submittedAt: null, sanitizedError: "provider_network_error" }; }
  const uncertain = submission.status === "failed" && !/^provider_http_(400|401|403|404|413|415|422|429)$/.test(submission.sanitizedError ?? "");
  const status = submission.status === "submitted" ? "submitted" : uncertain ? "uncertain" : "failed";
  const finished = await context.admin.rpc("price_quotation_finish_send", { p_actor: context.userId, p_id: id, p_claim: claim, p_status: status, p_provider_id: submission.providerMessageId, p_error: submission.sanitizedError });
  if (finished.error || finished.data !== true) throw new ManagedQuoteError(503, "تعذر تأكيد حالة الإرسال. تحقق من محادثة العميل قبل أي إرسال جديد.");
  const updated = await readPriceQuotation(context, id);
  return { quotation: updated, message: status === "submitted" ? "تم إرسال ملف PDF إلى مزود واتساب؛ وصوله للعميل غير مؤكد بعد." : status === "uncertain" ? "تعذر تأكيد الإرسال. تحقق من المحادثة قبل إنشاء إرسال جديد." : "لم يُرسل العرض. تحقق من إعدادات واتساب ثم أعد المحاولة." };
}
