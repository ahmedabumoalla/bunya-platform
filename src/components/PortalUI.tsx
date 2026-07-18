"use client";

import type { ChangeEvent, ReactNode } from "react";
import { useState } from "react";
import Link from "next/link";
import type { UploadedDocumentMetadata } from "@/lib/bunya-types";
import { createLocalId, normalizeValue } from "@/lib/bunya-local";
import { BunyaLogo } from "@/components/brand/BunyaLogo";

export function PortalShell({ children }: { children: ReactNode }) {
  return (
    <main className="portal-page">
      <div className="portal-orb portal-orb-one" />
      <div className="portal-orb portal-orb-two" />
      <div className="portal-container">
        <Link className="portal-brand" href="/" aria-label="العودة إلى بُنية">
          <BunyaLogo priority />
          <small>منصة توريد مواد البناء</small>
        </Link>
        {children}
      </div>
    </main>
  );
}

export function AuthCard({ eyebrow, title, description, children }: { eyebrow: string; title: string; description: string; children: ReactNode }) {
  return (
    <section className="portal-card auth-card">
      <header className="portal-heading">
        <p>{eyebrow}</p>
        <h1>{title}</h1>
        <span>{description}</span>
      </header>
      {children}
    </section>
  );
}

export function PasswordFieldWithVisibilityCheckbox({
  id,
  label,
  value,
  onChange,
  error,
  confirm = false,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  confirm?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="portal-field">
      <label htmlFor={id}>{label}</label>
      <input id={id} autoComplete={confirm ? "new-password" : "current-password"} type={visible ? "text" : "password"} value={value} onChange={(event) => onChange(event.target.value)} />
      <label className="visibility-check">
        <input type="checkbox" checked={visible} onChange={(event) => setVisible(event.target.checked)} />
        {confirm ? "إظهار تأكيد كلمة المرور" : "إظهار كلمة المرور"}
      </label>
      {error ? <small className="portal-error">{error}</small> : null}
    </div>
  );
}

export function MultiValueInput({ label, placeholder, values, onChange, error, forbiddenValues = [] }: { label: string; placeholder: string; values: string[]; onChange: (values: string[]) => void; error?: string; forbiddenValues?: string[] }) {
  const [draft, setDraft] = useState("");
  const [localError, setLocalError] = useState("");
  const addValue = () => {
    const clean = draft.trim();
    if (!clean) return setLocalError("اكتب قيمة قبل الإضافة.");
    if ([...values, ...forbiddenValues].some((item) => normalizeValue(item) === normalizeValue(clean))) return setLocalError("هذه القيمة مضافة بالفعل.");
    onChange([...values, clean]);
    setDraft("");
    setLocalError("");
  };
  return (
    <div className="portal-field">
      <label>{label}</label>
      <div className="multi-value-row">
        <input value={draft} placeholder={placeholder} onChange={(event) => { setDraft(event.target.value); setLocalError(""); }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addValue(); } }} />
        <button type="button" onClick={addValue} aria-label={`إضافة ${label}`}>✓</button>
      </div>
      {values.length ? (
        <div className="chip-list">
          {values.map((value) => (
            <span className="portal-chip" key={value}>{value}<button type="button" onClick={() => onChange(values.filter((item) => item !== value))} aria-label={`حذف ${value}`}>×</button></span>
          ))}
        </div>
      ) : null}
      {localError || error ? <small className="portal-error">{localError || error}</small> : null}
    </div>
  );
}

const maxDocuments = 5;
const maxFileSize = 5 * 1024 * 1024;

export function FileUploadList({ files, onChange, error }: { files: UploadedDocumentMetadata[]; onChange: (files: UploadedDocumentMetadata[]) => void; error?: string }) {
  const [localError, setLocalError] = useState("");
  const handleFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.target.files ?? []);
    const accepted = selected.filter((file) => file.type.startsWith("image/") || file.type === "application/pdf");
    if (accepted.length !== selected.length) return setLocalError("الملفات المسموحة هي الصور وPDF فقط.");
    if (accepted.some((file) => file.size > maxFileSize)) return setLocalError("الحد الأقصى لحجم الملف الواحد 5 ميجابايت.");
    if (files.length + accepted.length > maxDocuments) return setLocalError("يمكن إرفاق 5 ملفات كحد أقصى.");
    onChange([...files, ...accepted.map((file) => ({ id: createLocalId("doc"), name: file.name, type: file.type || "غير معروف", size: file.size }))]);
    setLocalError("");
    event.target.value = "";
  };
  return (
    <div className="portal-field">
      <label htmlFor="contractor-documents">المستندات الإثباتية</label>
      <label className="file-drop" htmlFor="contractor-documents">
        <strong>اختر صورًا أو ملفات PDF</strong>
        <span>حتى 5 ملفات، وبحد أقصى 5 ميجابايت للملف</span>
      </label>
      <input className="sr-only" id="contractor-documents" type="file" accept="image/*,application/pdf" multiple onChange={handleFiles} />
      {files.length ? <div className="file-list">{files.map((file) => <div key={file.id}><span><strong>{file.name}</strong><small>{file.type} · {(file.size / 1024).toLocaleString("ar-SA", { maximumFractionDigits: 0 })} كيلوبايت</small></span><button type="button" onClick={() => onChange(files.filter((item) => item.id !== file.id))}>حذف</button></div>)}</div> : null}
      <p className="portal-hint">تُحفظ بيانات الملفات فقط محليًا؛ الرفع الفعلي يبدأ عند ربط التخزين.</p>
      {localError || error ? <small className="portal-error">{localError || error}</small> : null}
    </div>
  );
}

export function ApplicationSuccessState({ title, message, destination, actionHref = "/", actionLabel = "العودة للرئيسية" }: { title: string; message: string; destination?: string; actionHref?: string; actionLabel?: string }) {
  return (
    <section className="portal-card success-state" role="status">
      <span className="success-mark">✓</span>
      <p>تم بنجاح</p>
      <h1>{title}</h1>
      <span>{message}</span>
      {destination ? <small>سيظهر الطلب مستقبلًا ضمن: <strong>{destination}</strong></small> : null}
      <Link className="portal-primary-button" href={actionHref}>{actionLabel}</Link>
    </section>
  );
}
