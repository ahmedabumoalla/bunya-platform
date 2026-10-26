"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import type { ManagedQuote, ManagedQuotePricing } from "@/lib/quotes/managed-types";
import styles from "./ManagedQuotes.module.css";

type Scope = "admin" | "customer";
const statusLabels: Record<string, string> = { submitted: "بانتظار التسعير", offered: "عرض السعر جاهز", accepted: "مقبول — بانتظار التسليم", rejected: "رفض العميل العرض", delivered: "تم التسليم", cancelled: "ملغى" };
const money = (value: number | string | null | undefined) => `${Number(value ?? 0).toLocaleString("ar-SA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ر.س`;
const date = (value?: string | null) => value ? new Date(value).toLocaleString("ar-SA-u-ca-gregory", { dateStyle: "medium", timeStyle: "short" }) : "لم يحدد";
const localDate = (value?: string | null) => { if (!value) return ""; const parsed = new Date(value); return new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
const basePath = (scope: Scope) => `/${scope}/managed-quotes`;

export function ManagedQuotes({ scope, id = null }: { scope: Scope; id?: string | null }) {
  const [requests, setRequests] = useState<ManagedQuote[]>([]);
  const [request, setRequest] = useState<ManagedQuote | null>(null);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [canManage, setCanManage] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true); setError("");
      try {
        const response = await fetch(id ? `/api/managed-quotes/${encodeURIComponent(id)}` : `/api/managed-quotes?scope=${scope}&page=${page}`, { signal: controller.signal, cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || "تعذر تحميل عروض الأسعار.");
        if (!controller.signal.aborted) {
          setRequest(id ? data.request : null); setRequests(data.requests ?? []); setCount(data.count ?? 0); setCanManage(data.canManage === true);
        }
      } catch (failure) {
        if (!controller.signal.aborted) { setError(failure instanceof Error ? failure.message : "تعذر تحميل عروض الأسعار."); setRequest(null); setRequests([]); }
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void load();
    return () => controller.abort();
  }, [scope, id, page, refresh]);

  return <main className={styles.page}>
    <header className={styles.header}>
      <div><p className={styles.eyebrow}>{scope === "admin" ? "إدارة طلبات العملاء" : "طلباتك وعروضك"}</p><h1>عروض الأسعار</h1><p>{scope === "admin" ? "راجع المنتجات، جهّز عرض العميل، وأثبت التسليم بالرمز." : "اجمع منتجاتك، راجع عرض الإدارة، ثم وافق على التفاصيل المناسبة لك."}</p></div>
      <div className={styles.actions}>{id ? <Link href={basePath(scope)}>جميع عروض الأسعار</Link> : scope === "customer" ? <Link className={styles.primary} href="/products">إضافة طلب جديد</Link> : null}<button type="button" disabled={loading} onClick={() => setRefresh(value => value + 1)}>تحديث</button></div>
    </header>
    {error && <div className={styles.error} role="alert">{error}<button type="button" onClick={() => setRefresh(value => value + 1)}>إعادة المحاولة</button></div>}
    {loading ? <p className={styles.empty} role="status">جارٍ تحميل عروض الأسعار…</p> : id ? request ? <ManagedQuoteDetail key={`${request.id}:${request.revision}`} request={request} scope={scope} canManage={canManage} onChanged={() => setRefresh(value => value + 1)} /> : !error && <p className={styles.empty}>الطلب غير متاح.</p> : <>
      <p className={styles.count}>{count.toLocaleString("ar-SA")} طلب</p>
      {requests.length ? <div className={styles.list}>{requests.map(row => <Link className={styles.card} key={row.id} href={`${basePath(scope)}/${row.id}`}><div className={styles.cardHeading}><strong>{row.request_code}</strong><Status value={row.status} /></div><p>{row.items.slice(0, 3).map(item => item.product_name).join("، ")}{row.items.length > 3 ? ` +${row.items.length - 3}` : ""}</p><div className={styles.cardMeta}><span>{row.items.length.toLocaleString("ar-SA")} صنف</span><span>{date(row.created_at)}</span>{row.status !== "submitted" && <strong>{money(row.total)}</strong>}</div><span className={styles.cardLink}>عرض التفاصيل ←</span></Link>)}</div> : !error && <div className={styles.empty}><h2>لا توجد طلبات بعد</h2><p>{scope === "admin" ? "تظهر هنا طلبات العملاء الجديدة مباشرة." : "اختر المنتجات من الكتالوج وأرسلها في طلب عرض سعر واحد."}</p></div>}
      {count > 50 && <nav className={styles.pagination} aria-label="صفحات عروض الأسعار"><button disabled={page === 0} onClick={() => setPage(value => value - 1)} type="button">السابق</button><span>{page + 1} / {Math.ceil(count / 50)}</span><button disabled={(page + 1) * 50 >= count} onClick={() => setPage(value => value + 1)} type="button">التالي</button></nav>}
    </>}
  </main>;
}

function Status({ value }: { value: string }) { return <span className={styles.status} data-status={value}>{statusLabels[value] ?? value}</span>; }

export function ManagedQuoteDetail({ request, scope, canManage, onChanged }: { request: ManagedQuote; scope: Scope; canManage: boolean; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [code, setCode] = useState("");
  const [confirmation, setConfirmation] = useState<"accept" | "reject" | null>(null);
  const [openedAt] = useState(() => Date.now());
  const details = request.details as Record<string, unknown>;
  const editable = canManage && scope === "admin" && ["submitted", "offered", "rejected"].includes(request.status);
  const isOffered = request.status === "offered";
  const expired = Boolean(request.valid_until && new Date(request.valid_until).getTime() <= openedAt);

  async function command(action: string, extra: Record<string, unknown> = {}) {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/managed-quotes/${request.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, revision: request.revision, ...extra }) });
      const data = await response.json();
      if (!response.ok || data.success === false) throw new Error(data.message || "تعذر إتمام الإجراء. حدّث الطلب وحاول مجددًا.");
      setCode(""); setConfirmation(null); onChanged();
      window.dispatchEvent(new Event("bunya:admin-data-changed"));
    } catch (failure) { setError(failure instanceof Error ? failure.message : "تعذر إتمام الإجراء."); }
    finally { setBusy(false); }
  }

  const contactFields = [
    ["projectName", "المشروع"], ["recipientName", "المستلم"], ["recipientMobile", "جوال المستلم"], ["locationHint", "موقع الاستلام"],
    ["siteResponsibleName", "مسؤول الموقع"], ["siteResponsibleMobile", "جوال مسؤول الموقع"], ["workingHours", "مواعيد العمل"],
    ["loadingOption", "التحميل"], ["unloadingOption", "التنزيل"], ["roadAccess", "الوصول للموقع"], ["accessInstructions", "تعليمات الوصول"], ["notes", "ملاحظات العميل"],
  ];
  const mapsUrl = typeof details.mapsUrl === "string" && /^https?:\/\//.test(details.mapsUrl) ? details.mapsUrl : null;
  return <>
    <section className={styles.summary}><div><h2>{request.request_code}</h2><p>{date(request.created_at)}</p></div><Status value={request.status} /><p>الدفع يُنسّق مع الإدارة خارج المنصة.</p></section>
    {error && <div className={styles.error} role="alert">{error}</div>}
    <section className={styles.panel}><h2>المنتجات المطلوبة</h2><div className={styles.items}>{request.items.map(item => {
      const pricing = request.pricing?.find(line => line.item_id === item.id);
      return <article className={styles.item} key={item.id}><header><h3>{item.product_name}</h3><span>{item.quantity.toLocaleString("ar-SA")} {pricing?.unit || item.unit}</span></header><p>{item.category}</p><dl className={styles.facts}>{item.attributes.map((attribute, index) => <div key={`${attribute.label}-${index}`}><dt>{attribute.label}</dt><dd>{attribute.value}</dd></div>)}{item.sku && <div><dt>رمز الخيار</dt><dd dir="ltr">{item.sku}</dd></div>}</dl>{item.notes && <p>ملاحظات: {item.notes}</p>}{pricing && <div className={styles.priceFacts}><strong>{money(pricing.unit_price)} / {pricing?.unit || item.unit} قبل الضريبة</strong><dl className={styles.facts}><div><dt>نوع العرض</dt><dd>{pricing.offer_type === "rental" ? `تأجير — ${pricing.rental_duration_value} ${durationLabels[pricing.rental_duration_unit] || pricing.rental_duration_unit}` : "بيع"}</dd></div><div><dt>الضمان</dt><dd>{pricing.warranty || "لم يحدد"}</dd></div><div><dt>مدة التوصيل</dt><dd>{pricing.delivery_duration || "لم تحدد"}</dd></div></dl>{pricing.notes && <p>{pricing.notes}</p>}</div>}</article>;
    })}</div></section>
    <section className={styles.panel}><h2>الاستلام وبيانات التواصل</h2><dl className={styles.facts}>{contactFields.filter(([key]) => details[key]).map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{String(details[key])}</dd></div>)}<div><dt>طريقة الاستلام</dt><dd>{details.deliveryMode === "pickup" ? "استلام من الموقع المحدد" : "توصيل للموقع"}</dd></div>{typeof details.desiredReceiptAt === "string" && <div><dt>الموعد المطلوب</dt><dd>{date(details.desiredReceiptAt)}</dd></div>}</dl>{mapsUrl && <a className={styles.textLink} href={mapsUrl} target="_blank" rel="noopener noreferrer">فتح موقع الاستلام في الخريطة ←</a>}</section>
    {request.pricing?.length > 0 && <section className={styles.panel}><h2>ملخص عرض السعر</h2><dl className={styles.facts}><div><dt>قيمة المنتجات قبل الضريبة</dt><dd>{money(request.subtotal)}</dd></div><div><dt>التوصيل</dt><dd>{money(request.delivery_fee)}</dd></div><div><dt>الضريبة ({request.vat_rate}٪)</dt><dd>{money(request.vat_amount)}</dd></div><div><dt>الإجمالي</dt><dd><strong>{money(request.total)}</strong></dd></div><div><dt>صلاحية العرض</dt><dd>{date(request.valid_until)}</dd></div><div><dt>التوصيل المتوقع</dt><dd>{date(request.expected_delivery_at)}</dd></div></dl>{request.terms && <p className={styles.preLine}>{request.terms}</p>}</section>}
    {editable && <QuoteEditor request={request} busy={busy} onSubmit={(action, payload) => command(action, { payload })} />}
    {scope === "customer" && isOffered && <section className={styles.panel}><h2>قرارك على العرض</h2><p>{expired ? "انتهت صلاحية العرض. تواصل مع الإدارة لتحديثه." : "راجع المنتجات والمقاسات والأسعار والضمان والتوصيل قبل الموافقة. الدفع بالتنسيق مع الإدارة."}</p>{!expired && <div className={styles.actions}>{confirmation ? <><p>{confirmation === "accept" ? "تؤكد قبول الأسعار والشروط المعروضة؟" : "تؤكد رفض عرض السعر؟"}</p><button className={styles.primary} type="button" disabled={busy} onClick={() => void command(confirmation)}>تأكيد {confirmation === "accept" ? "القبول" : "الرفض"}</button><button type="button" disabled={busy} onClick={() => setConfirmation(null)}>تراجع</button></> : <><button className={styles.primary} type="button" onClick={() => setConfirmation("accept")}>قبول عرض السعر</button><button type="button" onClick={() => setConfirmation("reject")}>رفض العرض</button></>}</div>}</section>}
    {scope === "customer" && request.status === "accepted" && <CustomerDeliveryCode requestId={request.id} />}
    {scope === "admin" && canManage && request.status === "accepted" && <section className={styles.panel}><h2>إثبات التسليم</h2><p>بعد التسليم، يرسل المورد رمز العميل إلى الإدارة. أدخل الرمز لتسجيل الاستلام.</p><form className={styles.actions} onSubmit={event => { event.preventDefault(); void command("confirm_delivery", { code }); }}><label className={styles.field}><span>رمز التسليم</span><input required inputMode="numeric" autoComplete="off" pattern="[0-9]{6}" maxLength={6} value={code} onChange={event => setCode(event.target.value.replace(/[^0-9]/g, ""))} /></label><button className={styles.primary} type="submit" disabled={busy || code.length !== 6}>تأكيد التسليم</button></form><p>إذا انتهت صلاحية الرمز أو تعذر استخدامه، أعد إصداره للعميل؛ الرمز السابق سيتوقف.</p><button type="button" disabled={busy} onClick={() => void command("reissue_code")}>إعادة إصدار الرمز للعميل</button></section>}
    {request.status === "delivered" && <p className={styles.success}>تم إثبات التسليم بالرمز بتاريخ {date(request.delivered_at)}.</p>}
  </>;
}

const durationLabels: Record<string, string> = { hour: "ساعة", day: "يوم", week: "أسبوع", month: "شهر", year: "سنة" };
type EditableLine = Omit<ManagedQuotePricing, "unit_price" | "rental_duration_value"> & { unit_price: string; rental_duration_value: string };

export function QuoteEditor({ request, busy, onSubmit }: { request: ManagedQuote; busy: boolean; onSubmit: (action: string, payload: Record<string, unknown>) => Promise<void> }) {
  const [lines, setLines] = useState<EditableLine[]>(() => request.items.map(item => {
    const saved = request.pricing?.find(line => line.item_id === item.id);
    return { item_id: item.id, unit: saved?.unit || item.unit, unit_price: saved ? String(saved.unit_price) : "", offer_type: saved?.offer_type || "sale", rental_duration_value: saved?.rental_duration_value == null ? "" : String(saved.rental_duration_value), rental_duration_unit: saved?.rental_duration_unit || "day", warranty: saved?.warranty || "", delivery_duration: saved?.delivery_duration || "", notes: saved?.notes || "" };
  }));
  const [deliveryFee, setDeliveryFee] = useState(String(request.delivery_fee ?? 0));
  const [vatRate, setVatRate] = useState(String(request.pricing?.length ? request.vat_rate : 15));
  const [validUntil, setValidUntil] = useState(localDate(request.valid_until));
  const [expectedAt, setExpectedAt] = useState(localDate(request.expected_delivery_at));
  const [terms, setTerms] = useState(request.terms || "");
  const update = (index: number, key: keyof EditableLine, value: string) => setLines(current => current.map((line, lineIndex) => lineIndex === index ? { ...line, [key]: value } : line));

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    void onSubmit(submitter?.value || "publish_quote", { pricing: lines.map(line => ({ ...line, unit_price: Number(line.unit_price), rental_duration_value: line.offer_type === "rental" ? Number(line.rental_duration_value) : null, rental_duration_unit: line.offer_type === "rental" ? line.rental_duration_unit : "" })), delivery_fee: Number(deliveryFee), vat_rate: Number(vatRate), valid_until: validUntil ? new Date(validUntil).toISOString() : null, expected_delivery_at: expectedAt ? new Date(expectedAt).toISOString() : null, terms });
  }
  return <section className={styles.panel}><h2>تسعير الإدارة</h2><p>سعر الوحدة قبل الضريبة. أضف شروط كل صنف ثم أرسل العرض للعميل. حفظ المسودة يجعل التسعير غير ظاهر للعميل حتى ترسله.</p><form onSubmit={submit}>
    <fieldset disabled={busy} className={styles.editorFields}>
      {lines.map((line, index) => <section className={styles.editorItem} key={line.item_id}><h3>{request.items[index].product_name} — {request.items[index].quantity} {request.items[index].unit}</h3><div className={styles.fieldGrid}>
        {request.items[index].unit === "تحددها الإدارة" && <label className={styles.field}><span>وحدة تسعير الصنف</span><input required maxLength={80} value={line.unit === "تحددها الإدارة" ? "" : line.unit} onChange={event => update(index, "unit", event.target.value)} /></label>}
        <label className={styles.field}><span>سعر الوحدة قبل الضريبة (ر.س)</span><input type="number" min="0" max="100000000" step="0.01" required value={line.unit_price} onChange={event => update(index, "unit_price", event.target.value)} /></label>
        <label className={styles.field}><span>نوع العرض</span><select value={line.offer_type} onChange={event => update(index, "offer_type", event.target.value)}><option value="sale">بيع</option><option value="rental">تأجير</option></select></label>
        {line.offer_type === "rental" && <><label className={styles.field}><span>مدة التأجير</span><input type="number" min="0.01" max="10000" step="0.01" required value={line.rental_duration_value} onChange={event => update(index, "rental_duration_value", event.target.value)} /></label><label className={styles.field}><span>وحدة مدة التأجير</span><select value={line.rental_duration_unit} onChange={event => update(index, "rental_duration_unit", event.target.value)}>{Object.entries(durationLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label></>}
        <label className={styles.field}><span>الضمان وشروطه</span><input required maxLength={1000} placeholder="مدة الضمان وشروطه، أو بدون ضمان" value={line.warranty} onChange={event => update(index, "warranty", event.target.value)} /></label>
        <label className={styles.field}><span>مدة تجهيز وتوصيل الصنف</span><input required maxLength={300} placeholder="مثال: يومان بعد التنسيق" value={line.delivery_duration} onChange={event => update(index, "delivery_duration", event.target.value)} /></label>
        <label className={`${styles.field} ${styles.wide}`}><span>ملاحظات الصنف</span><textarea maxLength={1000} rows={2} value={line.notes} onChange={event => update(index, "notes", event.target.value)} /></label>
      </div></section>)}
      <div className={styles.fieldGrid}>
        <label className={styles.field}><span>رسوم التوصيل قبل الضريبة (ر.س)</span><input type="number" min="0" max="100000000" step="0.01" required value={deliveryFee} onChange={event => setDeliveryFee(event.target.value)} /></label>
        <label className={styles.field}><span>نسبة الضريبة ٪</span><input type="number" min="0" max="100" step="0.01" required value={vatRate} onChange={event => setVatRate(event.target.value)} /></label>
        <label className={styles.field}><span>العرض صالح حتى</span><input type="datetime-local" required value={validUntil} onChange={event => setValidUntil(event.target.value)} /></label>
        <label className={styles.field}><span>موعد التسليم المتوقع</span><input type="datetime-local" required value={expectedAt} onChange={event => setExpectedAt(event.target.value)} /></label>
        <label className={`${styles.field} ${styles.wide}`}><span>الشروط وتنسيق الدفع</span><textarea required maxLength={4000} rows={4} value={terms} onChange={event => setTerms(event.target.value)} /></label>
      </div>
      <div className={styles.actions}><button type="submit" value="save_quote">حفظ كمسودة</button><button className={styles.primary} type="submit" value="publish_quote">{busy ? "جارٍ الحفظ…" : "إرسال العرض للعميل"}</button></div>
    </fieldset>
  </form></section>;
}

export function CustomerDeliveryCode({ requestId }: { requestId: string }) {
  const [code, setCode] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function reveal() {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/managed-quotes/${requestId}/delivery-code`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "تعذر تحميل رمز التسليم.");
      setCode(data.code); setExpiresAt(data.expiresAt);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "تعذر تحميل رمز التسليم."); }
    finally { setBusy(false); }
  }
  return <section className={styles.panel}><h2>رمز إثبات التسليم</h2><p>لا تشارك الرمز إلا بعد استلام المنتجات كاملة. أعطه لسائق المورد عند الاستلام ليصل إلى الإدارة.</p>{error && <p className={styles.error} role="alert">{error}</p>}{code ? <><p className={styles.deliveryCode} dir="ltr" aria-label={`رمز التسليم ${code}`}>{code}</p><p>صالح حتى {date(expiresAt)}</p><button type="button" onClick={() => setCode("")}>إخفاء الرمز</button></> : <button className={styles.primary} type="button" disabled={busy} onClick={() => void reveal()}>{busy ? "جارٍ التحميل…" : "عرض رمز التسليم"}</button>}</section>;
}
