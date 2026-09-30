"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { lockBodyScroll } from "@/lib/body-scroll-lock";
import { PROVIDER_DOCUMENT_TYPES, normalizeProviderText, normalizeServiceCities, type ProviderDocumentType, type ProviderJoinPolicy } from "@/lib/join/provider-fields";
import styles from "./provider-join.module.css";

export type ProviderFiles = Partial<Record<ProviderDocumentType, File>>;
export type ExistingProviderDocument = { id: string; name: string; url: string; documentType?: string | null };
const allowedTypes = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);

export function validateProviderFiles(files: ProviderFiles, existing: ExistingProviderDocument[] = []) {
  for (const { key, label } of PROVIDER_DOCUMENT_TYPES) {
    const file = files[key];
    if (!file && !existing.some((document) => document.documentType === key)) return `أرفق ${label}.`;
    if (file && (!allowedTypes.has(file.type) || file.size === 0)) return `${label}: اختر ملف PDF أو JPEG أو PNG أو WebP غير فارغ.`;
  }
  return "";
}

export function appendProviderFiles(data: FormData, files: ProviderFiles) {
  for (const { key } of PROVIDER_DOCUMENT_TYPES) {
    if (files[key]) data.set(`document:${key}`, files[key]);
  }
}

export function ServiceCitiesInput({ values, onChange, error, label = "المدن التي يخدمها المزود" }: { values: string[]; onChange: (values: string[]) => void; error?: string; label?: string }) {
  const id = useId();
  const [draft, setDraft] = useState("");
  const [localError, setLocalError] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const add = () => {
    const city = normalizeProviderText(draft);
    if (!city) return;
    if (city.length < 2 || city.length > 100) return setLocalError("اكتب اسم مدينة من حرفين إلى 100 حرف.");
    const next = normalizeServiceCities([...values, city]);
    if (next.length > 50) return setLocalError("يمكن إضافة 50 مدينة كحد أقصى.");
    onChange(next);
    setDraft("");
    setLocalError("");
    setAnnouncement(next.length === values.length ? `المدينة ${city} مضافة مسبقًا.` : `تمت إضافة ${city}.`);
  };
  return <div className={`portal-field ${styles.cities}`}>
    <label htmlFor={id}>{label}</label>
    <div className={styles.cityEntry}><input id={id} value={draft} placeholder="اكتب المدينة ثم اضغط Enter" autoComplete="off" aria-invalid={Boolean(error || localError)} aria-describedby={`${id}-hint${error || localError ? ` ${id}-error` : ""}`} onChange={(event) => { setDraft(event.target.value); setLocalError(""); }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); if (!event.nativeEvent.isComposing && event.keyCode !== 229) add(); } }} /><button type="button" onClick={add} disabled={!draft.trim()}>إضافة مدينة</button></div>
    <small id={`${id}-hint`} className="portal-hint">أضف كل مدينة على حدة. يمكنك كتابة أسماء تتضمن مسافات.</small>
    {values.length > 0 ? <ul className={styles.chips}>{values.map((city) => <li key={city}><span>{city}</span><button type="button" aria-label={`إزالة مدينة ${city}`} onClick={() => { onChange(values.filter((value) => value !== city)); setAnnouncement(`تمت إزالة ${city}.`); }}>×</button></li>)}</ul> : null}
    <span className="sr-only" role="status">{announcement}</span>
    {error || localError ? <small id={`${id}-error`} className="portal-error" role="alert">{localError || error}</small> : null}
  </div>;
}

export function ProviderDocuments({ files, onChange, existing = [], error }: { files: ProviderFiles; onChange: (files: ProviderFiles) => void; existing?: ExistingProviderDocument[]; error?: string }) {
  const id = useId();
  const legacy = existing.filter((document) => !PROVIDER_DOCUMENT_TYPES.some(({ key }) => key === document.documentType));
  return <fieldset className={`form-section ${styles.documents}`} aria-describedby={`${id}-hint${error ? ` ${id}-error` : ""}`}>
    <legend><span>05</span> المستندات الرئيسية</legend>
    <p className="portal-hint" id={`${id}-hint`}>أرفق المستندات الأربعة بصيغة PDF أو JPEG أو PNG أو WebP. تدعم المستندات الكبيرة والرفع على دفعات مع إعادة المحاولة تلقائيًا عند انقطاع الاتصال.</p>
    <div className={styles.documentGrid}>{PROVIDER_DOCUMENT_TYPES.map(({ key, label }) => {
      const current = existing.find((document) => document.documentType === key);
      const file = files[key];
      return <div className={styles.documentCard} key={key}>
        <svg className={styles.documentIcon} width="28" height="32" viewBox="0 0 24 28" fill="none" aria-hidden="true"><path d="M5 1h9l5 5v20H5V1Z" stroke="currentColor" strokeWidth="1.5"/><path d="M14 1v6h5M8 12h8M8 16h8M8 20h5" stroke="currentColor" strokeWidth="1.5"/></svg>
        <label className={styles.documentTitle} htmlFor={`${id}-${key}`}>{label}</label>
        <div className={styles.uploadControl}><input id={`${id}-${key}`} type="file" accept=".pdf,image/jpeg,image/png,image/webp" aria-describedby={`${id}-${key}-status`} onChange={(event) => { const selected = event.target.files?.[0]; if (selected) onChange({ ...files, [key]: selected }); event.target.value = ""; }} /><span aria-hidden="true">{file || current ? "استبدال المستند" : "تحميل المستند"}</span></div>
        <p id={`${id}-${key}-status`} className={styles.fileStatus} aria-live="polite">{file ? file.name : current ? "المستند الحالي مرفق" : "لم يُرفق بعد"}</p>
        {current ? <a className={styles.currentDocument} href={current.url} target="_blank" rel="noreferrer">عرض المستند الحالي</a> : null}
        {file ? <button type="button" className={styles.removeFile} onClick={() => { const next = { ...files }; delete next[key]; onChange(next); }} aria-label={`إزالة الملف المختار: ${label}`}>إزالة الملف المختار</button> : null}
      </div>;
    })}</div>
    <p className="portal-hint">تُحسّن المستندات تلقائيًا لتقليل الحجم متى أمكن، مع الحفاظ على المحتوى ووضوح القراءة.{existing.length ? " رفع مستند جديد يستبدل المستند من النوع نفسه." : ""}</p>
    {legacy.length ? <div className={styles.legacyDocuments}><strong>مستندات داعمة سابقة</strong>{legacy.map((document) => <a key={document.id} href={document.url} target="_blank" rel="noreferrer">{document.name}</a>)}</div> : null}
    {error ? <small id={`${id}-error`} className="portal-error" role="alert">{error}</small> : null}
  </fieldset>;
}

export function useProviderPolicy(enabled = true, kind: "provider" | "contractor" = "provider") {
  const [policy, setPolicy] = useState<ProviderJoinPolicy | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    fetch(`/api/public/join/${kind}/policy`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json() as { policy?: ProviderJoinPolicy | null };
        if (!response.ok) throw new Error("policy-unavailable");
        if (!controller.signal.aborted) { setPolicy(body.policy || null); setStatus("ready"); }
      })
      .catch(() => { if (!controller.signal.aborted) setStatus("error"); });
    return () => controller.abort();
  }, [enabled, attempt, kind]);
  return { policy, accepted, setAccepted, status, reload: () => { setPolicy(null); setAccepted(false); setStatus("loading"); setAttempt((value) => value + 1); } };
}

export function appendProviderConsent(data: FormData, policy: ProviderJoinPolicy) {
  data.set("policyAccepted", "true");
  data.set("policyId", policy.id);
  data.set("policyVersion", String(policy.version));
  data.set("policyUpdatedAt", policy.updatedAt);
}

export function ProviderPolicyConsent({ value, label = "سياسة التقديم كمزود خدمة في بنية" }: { value: ReturnType<typeof useProviderPolicy>; label?: string }) {
  const { policy, accepted, setAccepted, status, reload } = value;
  const [open, setOpen] = useState(false);
  const id = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const unlock = lockBodyScroll();
    const trigger = triggerRef.current;
    const dialog = dialogRef.current;
    dialog?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); setOpen(false); }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), [tabindex="0"]'));
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (!first) { event.preventDefault(); dialog.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog)) { event.preventDefault(); first.focus(); }
    };
    const containFocus = (event: FocusEvent) => { if (dialog && !dialog.contains(event.target as Node)) dialog.focus(); };
    document.addEventListener("keydown", keydown);
    document.addEventListener("focusin", containFocus);
    return () => { document.removeEventListener("keydown", keydown); document.removeEventListener("focusin", containFocus); unlock(); trigger?.focus(); };
  }, [open]);
  return <div className={styles.policyConsent}>
    <div className={styles.consentRow}><input id={id} type="checkbox" checked={accepted} disabled={!policy || status !== "ready"} onChange={(event) => setAccepted(event.target.checked)} aria-describedby={`${id}-hint`} /><label htmlFor={id}>أوافق على</label><button className={styles.policyLink} ref={triggerRef} type="button" disabled={!policy} onClick={() => setOpen(true)}>{label}</button></div>
    <p className="portal-hint" id={`${id}-hint`}>{status === "loading" ? "جارٍ تحميل سياسة الانضمام..." : !policy ? "سياسة الانضمام غير متاحة حاليًا. يلزم توفر السياسة والموافقة عليها لإرسال الطلب." : "الموافقة على سياسة الانضمام مطلوبة لإرسال الطلب."}</p>
    {status !== "loading" && !policy ? <button type="button" className={styles.retryPolicy} onClick={reload}>إعادة تحميل السياسة</button> : null}
    {open && policy ? createPortal(<div className={styles.policyOverlay} onClick={(event) => { if (event.target === event.currentTarget) setOpen(false); }}><div ref={dialogRef} className={styles.policyDialog} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={`${id}-version`} tabIndex={-1} dir="rtl"><header><div><h2 id={`${id}-title`}>{policy.title}</h2><p id={`${id}-version`}>الإصدار {policy.version}</p></div><button type="button" onClick={() => setOpen(false)} aria-label="إغلاق سياسة الانضمام">×</button></header><div className={styles.policyBody}>{policy.body.map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div><footer><button type="button" onClick={() => setOpen(false)}>العودة إلى الطلب</button></footer></div></div>, document.body) : null}
  </div>;
}
