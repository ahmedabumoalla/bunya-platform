"use client";

import { useId, useState } from "react";
import { CONTRACTOR_COMPANY_DOCUMENT_TYPES, CONTRACTOR_DOCUMENT_MIME_TYPES, CONTRACTOR_PORTFOLIO_MAX_FILES, CONTRACTOR_PORTFOLIO_MIME_TYPES, contractorDocumentAllowed, contractorDocumentType, contractorRequiredDocuments, contractorDocumentLabel, type ContractorType } from "@/lib/join/contractor-fields";
import styles from "./provider-join.module.css";

export type ContractorFiles = Record<string, File>;
export type ExistingContractorDocument = { id: string; name: string; url: string; documentKey?: string | null; documentType?: string | null };

export function validateContractorFiles(type: ContractorType, files: ContractorFiles, existing: ExistingContractorDocument[] = []) {
  for (const key of contractorRequiredDocuments(type)) {
    if (!files[key] && !existing.some((item) => item.documentType === key)) return `أرفق ${contractorDocumentLabel(key)}.`;
  }
  for (const [key, file] of Object.entries(files)) {
    const documentType = contractorDocumentType(key);
    if (!documentType || !contractorDocumentAllowed(type, documentType)) return "أزل المرفقات التي لا تتوافق مع نوع المقاول.";
    const allowed: readonly string[] = documentType === "portfolio" ? CONTRACTOR_PORTFOLIO_MIME_TYPES : CONTRACTOR_DOCUMENT_MIME_TYPES;
    if (!file.size || !allowed.includes(file.type)) return `${contractorDocumentLabel(documentType)}: اختر ملفًا غير فارغ بإحدى الصيغ الموضحة.`;
  }
  if (type === "individual") {
    const count = Object.keys(files).filter((key) => contractorDocumentType(key) === "portfolio").length + existing.filter((item) => item.documentType === "portfolio").length;
    if (!count) return "أرفق صورة أو فيديو واحدًا على الأقل لأعمالك السابقة.";
    if (count > CONTRACTOR_PORTFOLIO_MAX_FILES) return `يمكن إرفاق ${CONTRACTOR_PORTFOLIO_MAX_FILES} ملف أعمال سابقة كحد أقصى.`;
  }
  return "";
}

export function appendContractorFiles(data: FormData, files: ContractorFiles) {
  for (const [key, file] of Object.entries(files)) data.set(`document:${key}`, file);
}

export function ContractorTypeInput({ value, onChange }: { value: ContractorType; onChange: (type: ContractorType) => void }) {
  const name = useId();
  return <fieldset className="form-section"><legend>نوع المقاول</legend><div className="binary-choice">{([{ key: "company", label: "شركة" }, { key: "individual", label: "فرد" }] as const).map((item) => <label key={item.key} className={value === item.key ? "active" : ""}><input type="radio" name={name} value={item.key} checked={value === item.key} onChange={() => onChange(item.key)} />{item.label}</label>)}</div></fieldset>;
}

export function ContractorDocuments({ type, files, onChange, existing = [], onRemoveExisting, error }: { type: ContractorType; files: ContractorFiles; onChange: (files: ContractorFiles) => void; existing?: ExistingContractorDocument[]; onRemoveExisting?: (id: string) => void; error?: string }) {
  const id = useId();
  const [selectionError, setSelectionError] = useState("");
  const singletons = type === "company" ? CONTRACTOR_COMPANY_DOCUMENT_TYPES : [{ key: "national_id", label: "الهوية الوطنية", required: true }];
  const portfolio = Object.entries(files).filter(([key]) => contractorDocumentType(key) === "portfolio");
  const currentPortfolio = existing.filter((item) => item.documentType === "portfolio");
  const remove = (key: string) => { const next = { ...files }; delete next[key]; onChange(next); setSelectionError(""); };
  return <fieldset className={`form-section ${styles.documents}`} aria-describedby={`${id}-hint`}><legend><span>03</span> المستندات والأعمال</legend>
    <p id={`${id}-hint`} className="portal-hint">{type === "company" ? "المستندات الأربعة الرئيسية مطلوبة، والملف التعريفي للشركة اختياري." : "أرفق الهوية الوطنية وصورة أو فيديو واحدًا على الأقل لأعمالك السابقة."} المستندات: PDF أو JPEG أو PNG أو WebP.</p>
    <div className={styles.documentGrid}>{singletons.map(({ key, label, required }) => {
      const current = existing.find((item) => item.documentType === key);
      const file = files[key];
      return <div className={styles.documentCard} key={key}>
        <svg className={styles.documentIcon} width="28" height="32" viewBox="0 0 24 28" fill="none" aria-hidden="true"><path d="M5 1h9l5 5v20H5V1Z" stroke="currentColor" strokeWidth="1.5"/><path d="M14 1v6h5M8 12h8M8 16h8M8 20h5" stroke="currentColor" strokeWidth="1.5"/></svg>
        <label className={styles.documentTitle} htmlFor={`${id}-${key}`}>{label}{required ? " (مطلوب)" : " (اختياري)"}</label>
        <div className={styles.uploadControl}><input id={`${id}-${key}`} type="file" accept=".pdf,image/jpeg,image/png,image/webp" aria-describedby={`${id}-${key}-status`} onChange={(event) => { const selected = event.target.files?.[0]; if (selected) onChange({ ...files, [key]: selected }); event.target.value = ""; }} /><span aria-hidden="true">{file || current ? "استبدال المستند" : "تحميل المستند"}</span></div>
        <p id={`${id}-${key}-status`} className={styles.fileStatus} aria-live="polite">{file?.name || (current ? "المستند الحالي مرفق" : "لم يُرفق بعد")}</p>
        {current ? <a className={styles.currentDocument} href={current.url} target="_blank" rel="noreferrer">عرض المستند الحالي</a> : null}
        {file ? <button type="button" className={styles.removeFile} onClick={() => remove(key)} aria-label={`إزالة الملف المختار: ${label}`}>إزالة الملف المختار</button> : null}
        {current && !required && onRemoveExisting ? <button type="button" className={styles.removeFile} onClick={() => onRemoveExisting(current.id)}>إزالة المستند الحالي</button> : null}
      </div>;
    })}</div>
    {type === "individual" ? <div className="portal-field"><label htmlFor={`${id}-portfolio`}>الأعمال السابقة (مطلوب) — من ملف واحد إلى {CONTRACTOR_PORTFOLIO_MAX_FILES} ملفًا</label><input id={`${id}-portfolio`} type="file" multiple accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov" aria-describedby={`${id}-portfolio-hint`} onChange={(event) => {
      const selected = Array.from(event.target.files || []); event.target.value = "";
      if (portfolio.length + currentPortfolio.length + selected.length > CONTRACTOR_PORTFOLIO_MAX_FILES) { setSelectionError(`الحد الأقصى ${CONTRACTOR_PORTFOLIO_MAX_FILES} ملفًا للأعمال السابقة. أزل بعض الملفات أولًا.`); return; }
      const next = { ...files }; for (const file of selected) next[`portfolio_${crypto.randomUUID()}`] = file; onChange(next); setSelectionError("");
    }}/><small className="portal-hint" id={`${id}-portfolio-hint`}>يمكن اختيار عدة صور أو فيديوهات. الصور JPEG أو PNG أو WebP، والفيديو MP4 أو WebM أو MOV.</small><p className="portal-hint" role="status">الملفات المرفقة: {portfolio.length + currentPortfolio.length} من {CONTRACTOR_PORTFOLIO_MAX_FILES}</p>
      {currentPortfolio.map((item) => <div className={styles.documentCard} key={item.id}><a className={styles.currentDocument} href={item.url} target="_blank" rel="noreferrer">{item.name} — عرض الملف الحالي</a>{onRemoveExisting ? <button className={styles.removeFile} type="button" onClick={() => { onRemoveExisting(item.id); setSelectionError(""); }} aria-label={`إزالة ${item.name}`}>إزالة الملف</button> : null}</div>)}
      {portfolio.map(([key, file]) => <div className={styles.documentCard} key={key}><span className={styles.fileStatus}>{file.name}</span><button className={styles.removeFile} type="button" onClick={() => remove(key)} aria-label={`إزالة ${file.name}`}>إزالة الملف المختار</button></div>)}
    </div> : null}
    <p className="portal-hint">تُحسّن الصور وملفات PDF تلقائيًا متى أمكن مع الحفاظ على الوضوح. تدعم الملفات الكبيرة والرفع على دفعات مع إعادة المحاولة عند انقطاع الاتصال. رفع مستند جديد يستبدل المستند من النوع نفسه.</p>
    {error || selectionError ? <small className="portal-error" role="alert">{selectionError || error}</small> : null}
  </fieldset>;
}
