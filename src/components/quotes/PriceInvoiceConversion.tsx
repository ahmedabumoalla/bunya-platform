"use client";
import { useEffect, useState, type FormEvent } from "react";
import type { PriceQuotation } from "@/lib/quotes/price-quotation-types";
import type { PriceInvoice, PriceInvoiceInput, PriceInvoiceSettings } from "@/lib/quotes/price-invoice-types";
import styles from "./PriceQuotations.module.css";

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
export function PriceInvoiceConversion({ quotation }: { quotation: PriceQuotation }) {
  const [open, setOpen] = useState(false), [loading, setLoading] = useState(false), [busy, setBusy] = useState(false);
  const [invoice, setInvoice] = useState<PriceInvoice | null>(null), [settings, setSettings] = useState<PriceInvoiceSettings | null>(null);
  const [error, setError] = useState(""), [previewUrl, setPreviewUrl] = useState("");
  const [input, setInput] = useState<PriceInvoiceInput>(() => ({ invoice_type: quotation.customer_tax_number ? "standard" : "simplified", supply_date: today(), buyer: { name: quotation.customer_name, phone: quotation.customer_phone, address: quotation.customer_address, vat_number: quotation.customer_tax_number } }));
  const endpoint = `/api/price-quotations/${encodeURIComponent(quotation.id)}/invoice`;
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);
  async function load() {
    setOpen(true); setLoading(true); setError("");
    try {
      const response = await fetch(endpoint, { cache: "no-store" }), data = await response.json();
      if (!response.ok) throw new Error(data.message || "تعذر تحميل بيانات الفاتورة.");
      setInvoice(data.invoice); setSettings(data.settings);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "تعذر تحميل بيانات الفاتورة."); }
    finally { setLoading(false); }
  }
  function change(next: PriceInvoiceInput) { setInput(next); setPreviewUrl(""); }
  async function action(issue: boolean) {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(issue ? endpoint : `${endpoint}/preview`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
      if (!response.ok) { const body = await response.json(); throw new Error(body.message || "تعذر تنفيذ الطلب."); }
      if (issue) { const body = await response.json(); setInvoice(body.invoice); setPreviewUrl(""); }
      else setPreviewUrl(URL.createObjectURL(await response.blob()));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر تنفيذ الطلب.");
      // A timed-out issuance may already have committed. Recover its durable result.
      if (issue) try { const response = await fetch(endpoint, { cache: "no-store" }); if (response.ok) { const data = await response.json(); if (data.invoice) { setInvoice(data.invoice); setError(""); } } } catch { /* The next load retries without issuing again. */ }
    } finally { setBusy(false); }
  }
  const ready = settings?.phase === "phase1" && !!settings.verified_at;
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); void action(false); }
  return <section className={styles.panel} aria-label="تحويل عرض السعر إلى فاتورة">
    <h2>الفاتورة الضريبية</h2>
    {!open ? <><p>حوّل العرض إلى فاتورة مستقلة بالمنتجات والأسعار نفسها.</p><div className={styles.actions}><button onClick={() => void load()}>تحويل إلى فاتورة</button></div></> : <>
      {loading && <p role="status">جارٍ تحميل بيانات الفوترة…</p>}
      {error && <p className={styles.error} role="alert">{error}</p>}
      {invoice ? <><p className={styles.success} role="status">صدرت {invoice.invoice_type === "standard" ? "الفاتورة الضريبية" : "الفاتورة الضريبية المبسطة"} برقم <bdi className={styles.number}>{invoice.invoice_number}</bdi>.</p><p>الفاتورة محفوظة ولا يمكن تعديلها أو إصدار نسخة جديدة لهذا العرض.</p><div className={styles.actions}><a href={`${endpoint}/pdf`} target="_blank" rel="noopener noreferrer">معاينة الفاتورة</a><a href={`${endpoint}/pdf?download=1`}>تنزيل الفاتورة PDF</a></div></> : !loading && settings ? <form onSubmit={submit}>
        {!ready && <p className={styles.hint}>معاينة تجريبية متاحة؛ الإصدار النهائي غير مفعّل بعد.</p>}
        <fieldset className={styles.editor} disabled={busy}>
          <div className={styles.fields}>
            <label className={`${styles.field} ${styles.wide}`}>نوع الفاتورة<select value={input.invoice_type} onChange={event => change({ ...input, invoice_type: event.target.value as PriceInvoiceInput["invoice_type"], buyer: { ...input.buyer, vat_number: event.target.value === "simplified" ? "" : input.buyer.vat_number } })}><option value="standard">فاتورة ضريبية — منشأة مسجلة ضريبيًا</option><option value="simplified">فاتورة ضريبية مبسطة — فرد / مستهلك</option></select></label>
            <label className={`${styles.field} ${styles.wide}`}>اسم العميل{input.invoice_type === "standard" ? " القانوني" : " (اختياري)"}<input value={input.buyer.name} required={input.invoice_type === "standard"} maxLength={160} onChange={event => change({ ...input, buyer: { ...input.buyer, name: event.target.value } })} /></label>
            {input.invoice_type === "standard" && <label className={`${styles.field} ${styles.wide}`}>الرقم الضريبي للعميل<input className={styles.number} dir="ltr" inputMode="numeric" pattern="3[0-9]{13}3" required minLength={15} maxLength={15} value={input.buyer.vat_number} onChange={event => change({ ...input, buyer: { ...input.buyer, vat_number: event.target.value } })} /></label>}
            <label className={`${styles.field} ${styles.wide}`}>عنوان العميل{input.invoice_type === "simplified" ? " (اختياري)" : " الوطني"}<input value={input.buyer.address} required={input.invoice_type === "standard"} maxLength={400} onChange={event => change({ ...input, buyer: { ...input.buyer, address: event.target.value } })} /></label>
            <label className={`${styles.field} ${styles.wide}`}>تاريخ التوريد<input type="date" required value={input.supply_date} onChange={event => change({ ...input, supply_date: event.target.value })} /></label>
          </div>
          <p className={styles.hint}>البائع: {settings.seller.name} · الرقم الضريبي <bdi className={styles.number}>{settings.seller.vat_number}</bdi>. المبالغ من عرض السعر، وضريبة القيمة المضافة {quotation.vat_rate}٪.</p>
          <div className={styles.actions}><button type="submit">{busy ? "جارٍ تجهيز الملف…" : "معاينة الفاتورة"}</button>{ready && <button className={styles.primary} type="button" onClick={event => { if (event.currentTarget.form?.reportValidity()) void action(true); }}>إصدار الفاتورة الضريبية نهائيًا</button>}</div>
          {ready && <p className={styles.hint}>الإصدار يحفظ فاتورة نهائية برقم مستقل وQR ضريبي. لا يغيّر عرض السعر ولا يُرسل رسالة للعميل.</p>}
        </fieldset>
        {previewUrl && <div className={styles.actions}><a href={previewUrl} target="_blank" rel="noopener noreferrer">فتح معاينة الفاتورة — معاينة تجريبية</a></div>}
      </form> : !loading && <button onClick={() => void load()}>إعادة تحميل بيانات الفوترة</button>}
    </>}
  </section>;
}
