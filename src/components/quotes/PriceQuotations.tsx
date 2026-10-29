"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ManagedQuote } from "@/lib/quotes/managed-types";
import type { PriceQuotation, PriceQuotationCatalogProduct, PriceQuotationDraftItem } from "@/lib/quotes/price-quotation-types";
import { priceQuotationPolicy, type PriceQuotationPolicyInput } from "@/lib/quotes/price-quotation-policy";
import { calculatePriceQuotationTotals } from "@/lib/quotes/price-quotation-validation";
import styles from "./PriceQuotations.module.css";

const base = "/admin/price-quotations";
const api = "/api/price-quotations";
const labels: Record<PriceQuotation["send_status"], string> = { draft: "جاهز للإرسال", sending: "جارٍ الإرسال", submitted: "أُرسل إلى واتساب", failed: "تعذر الإرسال", uncertain: "حالة الإرسال غير مؤكدة" };
const money = (value: number) => `${value.toLocaleString("ar-SA-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ر.س`;
const date = (value: string | null) => value ? new Date(value).toLocaleDateString("ar-SA-u-ca-gregory-nu-latn", { timeZone: "Asia/Riyadh", year: "numeric", month: "short", day: "numeric" }) : "غير محدد";
const failureMessage = (error: unknown) => error instanceof Error ? error.message : "تعذر إتمام العملية. حاول مجددًا.";

async function readJson(url: string, options?: RequestInit) {
  const response = await fetch(url, { cache: "no-store", ...options });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || "تعذر تحميل البيانات. حاول مجددًا.");
  return data;
}

export function PriceQuotations({ id = null }: { id?: string | null }) {
  return <section className={styles.page} dir="rtl">
    <header className={styles.header}><div><p className={styles.eyebrow}>شركة العنوان الحصري</p><h1>{id === "new" ? "إنشاء عرض سعر" : "عروض الأسعار"}</h1><p>اختر المنتجات وحدد الأسعار، ثم أرسل عرضك PDF إلى واتساب العميل.</p></div><div className={styles.actions}>{id ? <Link href={base}>جميع العروض</Link> : <Link className={styles.primary} href={`${base}/new`}>إنشاء عرض سعر</Link>}<Link href="/admin/managed-quotes">طلبات عروض الأسعار</Link></div></header>
    {id === "new" ? <PriceQuotationComposer /> : id ? <PriceQuotationDetail id={id} /> : <PriceQuotationList />}
  </section>;
}

function PriceQuotationList() {
  const [rows, setRows] = useState<PriceQuotation[]>([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true); setError("");
      try { const data = await readJson(`${api}?page=${page}`, { signal: controller.signal }); if (!controller.signal.aborted) { setRows(data.quotations); setCount(data.count); } }
      catch (failure) { if (!controller.signal.aborted) { setError(failureMessage(failure)); setRows([]); } }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void load(); return () => controller.abort();
  }, [page, refresh]);
  return <>
    <div className={styles.listHeading}><p>{count} عرض سعر</p><button type="button" disabled={loading} onClick={() => setRefresh(value => value + 1)}>تحديث</button></div>
    {error && <p className={styles.error} role="alert">{error}</p>}
    {loading ? <p className={styles.empty} role="status">جارٍ تحميل العروض…</p> : rows.length ? <div className={styles.list}>{rows.map(row => <Link className={styles.card} href={`${base}/${row.id}`} key={row.id}><div className={styles.cardHeading}><bdi className={styles.number}>{row.quotation_code}</bdi><SendStatus value={row.send_status} /></div><h2>{row.customer_name || "عرض لعميل"}</h2><bdi className={styles.number}>{row.customer_phone}</bdi><p>{row.items.length} صنف · {row.source_request_code ? `طلب ${row.source_request_code}` : "عرض مستقل"}</p><div className={styles.cardHeading}><strong>{money(row.total)}</strong><span>{date(row.created_at)}</span></div></Link>)}</div> : !error && <div className={styles.empty}><h2>ابدأ بعرضك الأول</h2><p>يكفي رقم العميل والمنتجات والأسعار. يمكنك ربط العرض بطلب موجود أو إنشاؤه مباشرة.</p><Link className={styles.primary} href={`${base}/new`}>إنشاء عرض سعر</Link></div>}
    {count > 50 && <nav className={styles.pagination} aria-label="صفحات عروض الأسعار"><button disabled={page === 0 || loading} onClick={() => setPage(value => value - 1)}>السابق</button><span>صفحة {page + 1}</span><button disabled={(page + 1) * 50 >= count || loading} onClick={() => setPage(value => value + 1)}>التالي</button></nav>}
  </>;
}

export function PriceQuotationDetail({ id }: { id: string }) {
  const [quotation, setQuotation] = useState<PriceQuotation | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true); setError("");
      try { const data = await readJson(`${api}/${encodeURIComponent(id)}`, { signal: controller.signal }); if (!controller.signal.aborted) setQuotation(data.quotation); }
      catch (failure) { if (!controller.signal.aborted) setError(failureMessage(failure)); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void load(); return () => controller.abort();
  }, [id, refresh]);
  async function send() {
    if (busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const data = await readJson(`${api}/${encodeURIComponent(id)}/send`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      setQuotation(data.quotation); setMessage(data.message || "تم إرسال الملف إلى مزود واتساب.");
    } catch (failure) {
      setError(failureMessage(failure));
      // A timeout can occur after the provider accepted the file. Refresh the durable state before another action.
      try { const data = await readJson(`${api}/${encodeURIComponent(id)}`); setQuotation(data.quotation); } catch { setQuotation(current => current ? { ...current, send_status: "uncertain" } : null); }
    } finally { setBusy(false); }
  }
  const canSend = quotation && ["draft", "failed"].includes(quotation.send_status);
  return <>
    {error && <p className={styles.error} role="alert">{error}</p>}{message && <p className={quotation?.send_status === "submitted" ? styles.success : styles.error} role={quotation?.send_status === "submitted" ? "status" : "alert"}>{message}</p>}
    {loading ? <p className={styles.empty} role="status">جارٍ تحميل عرض السعر…</p> : quotation ? <>
      <section className={styles.summary}><div><p>عرض سعر</p><h2 className={styles.number} dir="ltr">{quotation.quotation_code}</h2><p>صدر في {date(quotation.created_at)} · صالح حتى {date(quotation.valid_until)}</p></div><SendStatus value={quotation.send_status} /></section>
      <div className={styles.layout}><section className={styles.panel}><h2>بيانات العميل</h2><dl className={styles.facts}><div><dt>الاسم</dt><dd>{quotation.customer_name || "غير محدد"}</dd></div><div><dt>رقم واتساب</dt><dd><bdi className={styles.number}>{quotation.customer_phone}</bdi></dd></div>{quotation.customer_address && <div><dt>العنوان</dt><dd>{quotation.customer_address}</dd></div>}{quotation.customer_tax_number && <div><dt>الرقم الضريبي</dt><dd><bdi className={styles.number}>{quotation.customer_tax_number}</bdi></dd></div>}</dl>{quotation.source_request_id && <Link className={styles.textLink} href={`/admin/managed-quotes/${quotation.source_request_id}`}>الطلب المرتبط: <bdi>{quotation.source_request_code}</bdi></Link>}<h2 className={styles.sectionTitle}>المنتجات والأسعار</h2><div className={styles.lines}>{quotation.items.map((item, index) => <article className={styles.savedLine} key={index}><div><h3>{item.product_name}</h3><p>{item.attributes.map(attribute => `${attribute.label}: ${attribute.value}`).join(" · ")}</p>{item.sku && <bdi className={styles.number}>{item.sku}</bdi>}{item.notes && <p className={styles.preLine}>{item.notes}</p>}<p>{item.quantity} {item.unit} × {money(item.unit_price)} قبل الضريبة</p></div><strong>{money(item.line_total)}</strong></article>)}</div>{quotation.terms && <><h2 className={styles.sectionTitle}>ملاحظات إضافية</h2><p className={styles.preLine}>{quotation.terms}</p></>}<SalesPolicy quote={quotation} /></section>
      <aside className={styles.side}><Totals subtotal={quotation.subtotal} delivery={quotation.delivery_fee} vatRate={quotation.vat_rate} vat={quotation.vat_amount} total={quotation.total} /><section className={styles.panel}><h2>ملف عرض السعر</h2><p>باسم شركة العنوان الحصري، متضمنًا بيانات العميل والمنتجات والإجمالي.</p><div className={styles.actions}><a href={`${api}/${quotation.id}/pdf`} target="_blank" rel="noopener noreferrer">معاينة PDF</a><a href={`${api}/${quotation.id}/pdf?download=1`}>تنزيل PDF</a></div><div className={styles.sendBox}><p>الإرسال إلى <bdi className={styles.number}>{quotation.customer_phone}</bdi></p>{canSend && <button className={styles.primary} disabled={busy} onClick={() => void send()}>{busy ? "جارٍ إرسال الملف…" : quotation.send_status === "failed" ? "إعادة إرسال PDF إلى واتساب" : "إرسال PDF إلى واتساب"}</button>}{quotation.send_status === "submitted" && <p className={styles.hint}>قَبِل مزود واتساب الملف بتاريخ {date(quotation.sent_at)}. تأكيد القراءة غير متاح هنا.</p>}{["uncertain", "sending"].includes(quotation.send_status) && <p className={styles.hint}>جارٍ التحقق من حالة الإرسال. راجع واتساب العميل قبل إنشاء عرض آخر لتجنب تكرار الرسالة.</p>}<button disabled={busy} onClick={() => setRefresh(value => value + 1)}>تحديث الحالة</button></div></section></aside></div>
    </> : <button onClick={() => setRefresh(value => value + 1)}>إعادة المحاولة</button>}
  </>;
}

type EditorLine = PriceQuotationDraftItem & { key: string; product_name: string; quantityText: string; priceText: string; attributes: { label: string; value: string }[] };
type Customer = { name: string; phone: string; address: string; tax: string };

export function PriceQuotationComposer() {
  const router = useRouter();
  const [customer, setCustomer] = useState<Customer>({ name: "", phone: "", address: "", tax: "" });
  const [lines, setLines] = useState<EditorLine[]>([]);
  const [source, setSource] = useState<ManagedQuote | null>(null);
  const [sourceId, setSourceId] = useState("");
  const [requests, setRequests] = useState<ManagedQuote[]>([]);
  const [requestPage, setRequestPage] = useState(0);
  const [requestCount, setRequestCount] = useState(0);
  const [sourceBusy, setSourceBusy] = useState(false);
  const [sourceError, setSourceError] = useState("");
  const [delivery, setDelivery] = useState("0");
  const [deliveryCity, setDeliveryCity] = useState("");
  const [deliveryWindow, setDeliveryWindow] = useState("");
  const [vatRate, setVatRate] = useState("15");
  const [validUntil, setValidUntil] = useState("");
  const [terms, setTerms] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const attempt = useRef({ signature: "", key: "" });

  function populate(request: ManagedQuote) {
    setSource(request); setSourceId(request.id);
    setCustomer({ name: String(request.details.recipientName || ""), phone: String(request.details.recipientMobile || ""), address: String(request.details.locationHint || ""), tax: "" });
    setLines(request.items.map((item, index) => {
      const pricing = request.pricing.find(value => value.item_id === item.id);
      return { key: `source-${index}`, source_item_id: item.id, product_id: item.product_id, product_name: item.product_name, sku: item.sku, unit: item.unit, attributes: item.attributes, quantity: item.quantity, quantityText: String(item.quantity), unit_price: pricing?.unit_price ?? 0, priceText: pricing ? String(pricing.unit_price) : "", notes: item.notes };
    }));
    setDelivery(String(request.delivery_fee)); setVatRate(String(request.pricing.length ? request.vat_rate : 15)); setTerms(request.terms || "");
    setDeliveryCity(String(request.details.city || "")); setDeliveryWindow("");
    setValidUntil(request.valid_until ? new Date(Date.parse(request.valid_until) + 3 * 60 * 60 * 1000).toISOString().slice(0, 10) : "");
  }
  useEffect(() => {
    const controller = new AbortController();
    const linkedId = new URLSearchParams(window.location.search).get("request");
    async function load() {
      if (linkedId) setSourceBusy(true);
      try { const data = await readJson("/api/managed-quotes?scope=admin&page=0", { signal: controller.signal }); if (!controller.signal.aborted) { setRequests(data.requests); setRequestCount(data.count); } }
      catch (failure) { if (!controller.signal.aborted) setSourceError(failureMessage(failure)); }
      if (linkedId && !controller.signal.aborted) {
        setSourceBusy(true);
        try { const data = await readJson(`/api/managed-quotes/${encodeURIComponent(linkedId)}`, { signal: controller.signal }); if (!controller.signal.aborted) populate(data.request); }
        catch (failure) { if (!controller.signal.aborted) setSourceError(failureMessage(failure)); }
        finally { if (!controller.signal.aborted) setSourceBusy(false); }
      }
    }
    void load(); return () => controller.abort();
  }, []);
  async function loadRequest() {
    setSourceBusy(true); setSourceError("");
    try { const data = await readJson(`/api/managed-quotes/${encodeURIComponent(sourceId)}`); populate(data.request); }
    catch (failure) { setSourceError(failureMessage(failure)); }
    finally { setSourceBusy(false); }
  }
  async function moreRequests() {
    setSourceBusy(true); setSourceError("");
    try { const data = await readJson(`/api/managed-quotes?scope=admin&page=${requestPage + 1}`); setRequests(current => [...current, ...data.requests]); setRequestPage(value => value + 1); setRequestCount(data.count); }
    catch (failure) { setSourceError(failureMessage(failure)); }
    finally { setSourceBusy(false); }
  }
  const deliveryValue = Number(delivery) || 0;
  let totals = { subtotal: 0, vat_amount: 0, total: 0, line_totals: [] as number[] };
  let totalsError = "";
  try { totals = calculatePriceQuotationTotals(lines.map(line => ({ quantity: Number(line.quantityText) || 0, unit_price: Number(line.priceText) || 0 })), deliveryValue, Number(vatRate) || 0); }
  catch { totalsError = "إجمالي العرض أكبر من الحد المسموح. راجع الكميات والأسعار."; }
  function changeLine(key: string, patch: Partial<EditorLine>) { setLines(current => current.map(line => line.key === key ? { ...line, ...patch } : line)); }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy || sourceBusy) return;
    setError("");
    if (!lines.length) { setError("أضف منتجًا واحدًا على الأقل لعرض السعر."); return; }
    if (totalsError) { setError(totalsError); return; }
    const payload = { source_request_id: source?.id ?? null, customer_name: customer.name, customer_phone: customer.phone, customer_address: customer.address, customer_tax_number: customer.tax,
      items: lines.map(line => ({ product_id: line.product_id, source_item_id: line.source_item_id, sku: line.sku, unit: line.unit, measurement_id: line.measurement_id, variant_ids: line.variant_ids, quantity: Number(line.quantityText), unit_price: Number(line.priceText), notes: line.notes })),
      vat_rate: Number(vatRate), delivery_fee: Number(delivery), delivery_city: deliveryCity, delivery_window: deliveryWindow, valid_until: validUntil ? new Date(`${validUntil}T23:59:59+03:00`).toISOString() : null, terms };
    const signature = JSON.stringify(payload);
    if (attempt.current.signature !== signature) attempt.current = { signature, key: crypto.randomUUID() };
    setBusy(true);
    try { const data = await readJson(api, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, idempotency_key: attempt.current.key }) }); router.push(`${base}/${data.quotation.id}`); }
    catch (failure) { setError(failureMessage(failure)); setBusy(false); }
  }
  function detachSource() { setSource(null); setSourceId(""); setLines(current => current.filter(line => !line.source_item_id)); }
  return <form onSubmit={event => void save(event)}>
    <fieldset className={styles.editor} disabled={busy || sourceBusy}>
    <section className={styles.sourcePanel}><div><h2>{source ? `مرتبط بالطلب ${source.request_code}` : "عرض مستقل أو مرتبط بطلب"}</h2><p>اختيار الطلب اختياري. استيراده يملأ بيانات العميل والمنتجات بدل الاختيارات الحالية.</p></div><div className={styles.sourceControls}><label className={styles.field}><span>طلب عرض سعر موجود</span><select value={sourceId} onChange={event => setSourceId(event.target.value)}><option value="">اختر طلبًا — اختياري</option>{source && !requests.some(request => request.id === source.id) && <option value={source.id}>{source.request_code}</option>}{requests.map(request => <option key={request.id} value={request.id}>{request.request_code} — {String(request.details.recipientName || request.details.recipientMobile || "عميل")}</option>)}</select></label><button type="button" disabled={!sourceId} onClick={() => void loadRequest()}>استيراد الطلب</button>{source && <button type="button" onClick={detachSource}>إلغاء الربط وإزالة منتجات الطلب</button>}{requests.length < requestCount && <button type="button" onClick={() => void moreRequests()}>تحميل طلبات أقدم</button>}</div>{sourceError && <p className={styles.error} role="alert">{sourceError}</p>}</section>
    <div className={styles.layout}><div className={styles.main}>
      <section className={styles.panel}><h2>بيانات العميل</h2><p className={styles.hint}>لا يشترط وجود حساب للعميل في المنصة.</p><div className={styles.fields}><label className={styles.field}><span>رقم واتساب العميل <span aria-hidden="true">*</span></span><input required type="tel" dir="ltr" autoComplete="tel" inputMode="tel" maxLength={20} placeholder="05xxxxxxxx" value={customer.phone} onChange={event => setCustomer(current => ({ ...current, phone: event.target.value }))} /></label><label className={styles.field}><span>اسم العميل أو المنشأة — اختياري</span><input autoComplete="organization" maxLength={160} value={customer.name} onChange={event => setCustomer(current => ({ ...current, name: event.target.value }))} /></label><label className={styles.field}><span>العنوان — اختياري</span><input autoComplete="street-address" maxLength={400} value={customer.address} onChange={event => setCustomer(current => ({ ...current, address: event.target.value }))} /></label><label className={styles.field}><span>الرقم الضريبي — اختياري</span><input inputMode="numeric" dir="ltr" maxLength={15} pattern="[0-9]{15}" value={customer.tax} onChange={event => setCustomer(current => ({ ...current, tax: event.target.value }))} /></label></div></section>
      <section className={styles.panel}><div className={styles.panelHeading}><h2>منتجات العرض</h2><span>{lines.length} / 50 صنف</span></div><ProductPicker disabled={busy || sourceBusy || lines.length >= 50} onAdd={product => setLines(current => [...current, product])} />
      {lines.length ? <div className={styles.lines}>{lines.map((line, index) => <article className={styles.editorLine} key={line.key}><div className={styles.panelHeading}><div><h3>{index + 1}. {line.product_name}</h3><p>{line.attributes.map(attribute => `${attribute.label}: ${attribute.value}`).join(" · ")}</p>{line.sku && <bdi className={styles.number}>{line.sku}</bdi>}</div><button type="button" aria-label={`حذف ${line.product_name}`} onClick={() => setLines(current => current.filter(item => item.key !== line.key))}>حذف</button></div><div className={styles.lineFields}><label className={styles.field}><span>الكمية ({line.unit})</span><input required type="number" min="0.001" max="1000000" step="0.001" inputMode="decimal" value={line.quantityText} onChange={event => changeLine(line.key, { quantityText: event.target.value })} /></label><label className={styles.field}><span>سعر الوحدة قبل الضريبة</span><input required type="number" min="0" max="10000000" step="0.01" inputMode="decimal" value={line.priceText} onChange={event => changeLine(line.key, { priceText: event.target.value })} /></label><div className={styles.lineTotal}><span>إجمالي الصنف</span><strong>{totalsError ? "—" : money(totals.line_totals[index] ?? 0)}</strong></div></div><label className={styles.field}><span>ملاحظات الصنف — اختياري</span><input maxLength={500} value={line.notes || ""} onChange={event => changeLine(line.key, { notes: event.target.value })} /></label></article>)}</div> : <p className={styles.hint}>ابحث باسم المنتج ثم اختر المواصفات والوحدة لإضافته.</p>}</section>
      <section className={styles.panel}><h2>تفاصيل العرض</h2><div className={styles.fields}><label className={styles.field}><span>رسوم التوصيل قبل الضريبة (ر.س)</span><input required type="number" min="0" max="10000000" step="0.01" value={delivery} onChange={event => setDelivery(event.target.value)} /></label><label className={styles.field}><span>ضريبة القيمة المضافة</span><select value={vatRate} onChange={event => setVatRate(event.target.value)}><option value="15">15%</option><option value="0">0%</option></select></label><label className={styles.field}><span>مدينة التسليم — اختياري</span><input maxLength={160} value={deliveryCity} onChange={event => setDeliveryCity(event.target.value)} placeholder="مدينة تسليم هذا العرض" /></label><label className={styles.field}><span>مدة التوريد — اختياري</span><input maxLength={240} value={deliveryWindow} onChange={event => setDeliveryWindow(event.target.value)} placeholder="من يومين إلى أربعة أيام من استلام الدفعة" /></label><label className={styles.field}><span>صالح حتى — اختياري</span><input type="date" value={validUntil} onChange={event => setValidUntil(event.target.value)} /></label><label className={`${styles.field} ${styles.wide}`}><span>ملاحظات إضافية — اختياري</span><textarea rows={4} maxLength={3000} value={terms} onChange={event => setTerms(event.target.value)} placeholder="أي تفاصيل إضافية تخص هذا العرض" /></label></div></section><SalesPolicy quote={{ delivery_city: deliveryCity, delivery_window: deliveryWindow, delivery_fee: deliveryValue, valid_until: validUntil ? new Date(`${validUntil}T23:59:59+03:00`).toISOString() : null }} />
    </div><aside className={styles.side}><Totals subtotal={totals.subtotal} delivery={deliveryValue} vatRate={Number(vatRate)} vat={totals.vat_amount} total={totals.total} />{totalsError && <p className={styles.error} role="alert">{totalsError}</p>}<section className={styles.panel}><h2>جاهز للمراجعة</h2><p>سيُحفظ العرض باسم شركة العنوان الحصري. راجع ملف PDF ثم أرسله إلى واتساب العميل.</p><button className={styles.primary} type="submit" disabled={!lines.length || !!totalsError}>{busy ? "جارٍ حفظ العرض…" : "حفظ ومعاينة عرض السعر"}</button><p className={styles.hint}>الحفظ لا يرسل رسالة للعميل.</p></section></aside></div>
    </fieldset>{sourceBusy && <p role="status">جارٍ تحميل بيانات الطلب…</p>}{error && <p className={styles.error} role="alert">{error}</p>}
  </form>;
}

function ProductPicker({ disabled, onAdd }: { disabled: boolean; onAdd: (line: EditorLine) => void }) {
  const [query, setQuery] = useState("");
  const [products, setProducts] = useState<PriceQuotationCatalogProduct[]>([]);
  const [selected, setSelected] = useState<PriceQuotationCatalogProduct | null>(null);
  const [sku, setSku] = useState("");
  const [unit, setUnit] = useState("");
  const [measurementId, setMeasurementId] = useState("");
  const [variantIds, setVariantIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true); setError("");
      try { const data = await readJson(`${api}/catalog?q=${encodeURIComponent(query)}`, { signal: controller.signal }); if (!controller.signal.aborted) { setProducts(data.products); setHasMore(data.hasMore); } }
      catch (failure) { if (!controller.signal.aborted) { setError(failureMessage(failure)); setProducts([]); setSelected(null); setHasMore(false); } }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, retry]);
  async function choose(id: string) {
    setChoosing(true); setError(""); setSelected(null);
    try {
      const data = await readJson(`${api}/catalog?product_id=${encodeURIComponent(id)}`);
      const product = data.products[0] as PriceQuotationCatalogProduct | undefined;
      if (!product) throw new Error("هذا المنتج غير متاح حاليًا.");
      const firstUnit = product.units[0] || "تحددها الإدارة";
      setSelected(product); setSku(product.id.startsWith("brkz-") ? product.variants[0]?.sku || "" : ""); setUnit(firstUnit);
      setMeasurementId(product.measurements?.find(measurement => measurement.unit === firstUnit)?.id || ""); setVariantIds([]);
    }
    catch (failure) { setError(failureMessage(failure)); }
    finally { setChoosing(false); }
  }
  function add() {
    if (!selected || disabled || choosing) return;
    setError("");
    const imported = selected.id.startsWith("brkz-");
    const picked = selected.variants.filter(variant => variant.id && variantIds.includes(variant.id));
    const measurement = selected.measurements?.find(value => value.id === measurementId && value.unit === unit);
    const attributes = imported ? selected.variants.find(variant => variant.sku === sku)?.attributes || [] : picked.flatMap(variant => variant.attributes);
    if (!imported && selected.variants.length && (!picked.length || selected.variants.some(variant => variant.attributes.some(attribute => !attributes.some(value => value.label === attribute.label))))) { setError("اختر قيمة لكل نوع من مواصفات المنتج."); return; }
    if (!imported && selected.measurements?.some(value => value.unit === unit) && !measurement) { setError("اختر قياسًا متاحًا لهذه الوحدة."); return; }
    onAdd({ key: crypto.randomUUID(), product_id: selected.id, product_name: selected.name, sku, unit, measurement_id: imported ? undefined : measurement?.id, variant_ids: imported ? undefined : variantIds, quantity: 1, quantityText: "1", unit_price: 0, priceText: "", notes: "", attributes: measurement ? [{ label: "القياس", value: measurement.label }, ...attributes] : attributes });
    setSelected(null);
  }
  function changeUnit(value: string) { setUnit(value); setMeasurementId(selected?.measurements?.find(measurement => measurement.unit === value)?.id || ""); }
  function toggleVariant(id: string, checked: boolean) {
    const chosen = selected?.variants.find(variant => variant.id === id);
    setVariantIds(current => checked ? [...current.filter(value => !selected?.variants.find(variant => variant.id === value)?.attributes.some(attribute => chosen?.attributes.some(other => other.label === attribute.label))), id] : current.filter(value => value !== id));
  }
  return <div className={styles.picker}>
    <label className={styles.field}><span>البحث في منتجات المنصة</span><input type="search" value={query} maxLength={100} onChange={event => setQuery(event.target.value)} placeholder="اسم المنتج أو التصنيف أو رمز المنتج" /></label>
    {error && <div className={styles.error} role="alert">{error}<button type="button" onClick={() => setRetry(value => value + 1)}>إعادة المحاولة</button></div>}
    {loading ? <p role="status">جارٍ البحث…</p> : <div className={styles.catalogResults} aria-label="نتائج البحث">{products.map(product => <button type="button" key={product.id} disabled={disabled || choosing} aria-pressed={selected?.id === product.id} onClick={() => void choose(product.id)}><strong>{product.name}</strong><span>{product.category}</span></button>)}{!products.length && !error && <p>لا توجد منتجات مطابقة. جرّب كلمة أخرى.</p>}</div>}
    {hasMore && <p className={styles.hint}>تظهر أول 30 نتيجة. اكتب اسمًا أدق للوصول للمنتج المطلوب.</p>}{choosing && <p role="status">جارٍ تحميل مواصفات المنتج…</p>}
    {selected && <div className={styles.selection}><h3>{selected.name}</h3><div className={styles.fields}>{selected.id.startsWith("brkz-") && selected.variants.length > 0 && <label className={styles.field}><span>المواصفات / رمز المنتج</span><select value={sku} onChange={event => setSku(event.target.value)}>{selected.variants.map(variant => <option key={variant.sku} value={variant.sku}>{variant.attributes.map(attribute => `${attribute.label}: ${attribute.value}`).join(" · ") || "مواصفات غير محددة"} — {variant.sku}</option>)}</select></label>}<label className={styles.field}><span>الوحدة</span><select value={unit} onChange={event => changeUnit(event.target.value)}>{(selected.units.length ? selected.units : ["تحددها الإدارة"]).map(value => <option key={value} value={value}>{value}</option>)}</select></label>{selected.measurements?.some(measurement => measurement.unit === unit) && <label className={styles.field}><span>القياس</span><select value={measurementId} onChange={event => setMeasurementId(event.target.value)}>{selected.measurements.filter(measurement => measurement.unit === unit).map(measurement => <option key={measurement.id} value={measurement.id}>{measurement.label}</option>)}</select></label>}</div>{!selected.id.startsWith("brkz-") && selected.variants.length > 0 && <fieldset className={styles.variantChoices}><legend>المواصفات — اختر قيمة لكل نوع</legend>{selected.variants.map(variant => <label key={variant.id || variant.sku}><input type="checkbox" checked={variantIds.includes(variant.id || "")} onChange={event => toggleVariant(variant.id || "", event.target.checked)} /><span>{variant.attributes.map(attribute => `${attribute.label}: ${attribute.value}`).join(" · ") || variant.sku}</span></label>)}</fieldset>}<button type="button" className={styles.primary} disabled={disabled || choosing} onClick={add}>إضافة إلى العرض</button></div>}
  </div>;
}

function SendStatus({ value }: { value: PriceQuotation["send_status"] }) { return <span className={styles.status} data-status={value}>{labels[value]}</span>; }
function Totals({ subtotal, delivery, vatRate, vat, total }: { subtotal: number; delivery: number; vatRate: number; vat: number; total: number }) {
  return <section className={styles.totals} aria-label="ملخص عرض السعر"><p className={styles.eyebrow}>شركة العنوان الحصري</p><h2>إجمالي عرض السعر</h2><dl><div><dt>المنتجات قبل الضريبة</dt><dd>{money(subtotal)}</dd></div><div><dt>التوصيل قبل الضريبة</dt><dd>{money(delivery)}</dd></div><div><dt>القيمة المضافة ({vatRate}%)</dt><dd>{money(vat)}</dd></div><div className={styles.grandTotal}><dt>الإجمالي شامل الضريبة</dt><dd>{money(total)}</dd></div></dl><p className={styles.hint}>جميع المبالغ بالريال السعودي</p></section>;
}

function SalesPolicy({ quote }: { quote: PriceQuotationPolicyInput }) {
  const clauses = priceQuotationPolicy(quote);
  return <details className={styles.policy}><summary>سياسة البيع وشروط العرض <span>{clauses.length} بندًا · تُرفق مع ملف PDF</span></summary><ol>{clauses.map(clause => <li key={clause.title}><h3>{clause.title}</h3><p>{clause.body}</p></li>)}</ol></details>;
}
