"use client";

import { useRef, useState, type FormEvent } from "react";
import { MultiValueInput, PortalShell } from "@/components/PortalUI";
import { PolicyLinks } from "@/components/legal/PolicyLinks";
import { contractorDocumentAllowed, contractorDocumentType, isValidContractorUsername, normalizeContractorText, normalizeServiceCities, resolveContractorUsername, type ContractorType } from "@/lib/join/contractor-fields";
import { ProviderUploadError, uploadProviderDocuments } from "@/lib/uploads/provider-resumable-client";
import { appendProviderConsent, ProviderPolicyConsent, ServiceCitiesInput, useProviderPolicy } from "./ProviderJoinFields";
import { appendContractorFiles, ContractorDocuments, ContractorTypeInput, validateContractorFiles, type ContractorFiles, type ExistingContractorDocument } from "./ContractorJoinFields";

export type ContractorRevisionApplication = {
  id: string;
  contractor_type?: ContractorType | null;
  contractor_name?: string;
  contractor_name_en?: string;
  contact_name?: string;
  requested_username?: string;
  username_is_custom?: boolean;
  mobile: string;
  email: string;
  regions?: string[];
  service_cities?: string[];
  specialties?: string[];
  review_notes?: string;
  documents?: ExistingContractorDocument[];
};

export function ContractorApplicationForm({ initial, revisionToken }: { initial?: ContractorRevisionApplication; revisionToken?: string }) {
  const [contractorType, setContractorType] = useState<ContractorType>(initial?.contractor_type || "company");
  const [form, setForm] = useState({ contractorName: initial?.contractor_name || "", contractorNameEn: initial?.contractor_name_en || "", contactName: initial?.contact_name || "", mobile: initial?.mobile || "", email: initial?.email || "", username: initial?.username_is_custom === false ? "" : initial?.requested_username || "" });
  const [serviceCities, setServiceCities] = useState(initial?.service_cities || initial?.regions || []);
  const [specialties, setSpecialties] = useState(initial?.specialties || []);
  const [files, setFiles] = useState<ContractorFiles>({});
  const [removedIds, setRemovedIds] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploadStatus, setUploadStatus] = useState("");
  const [result, setResult] = useState<{ applicationId: string } | null>(null);
  const submitting = useRef(false);
  const policyState = useProviderPolicy(true, "contractor");
  const allDocuments = initial?.documents || [];
  const existing = allDocuments.filter((item) => !removedIds.includes(item.id) && contractorDocumentAllowed(contractorType, item.documentType || ""));
  const changeType = (type: ContractorType) => {
    setContractorType(type);
    setFiles((current) => Object.fromEntries(Object.entries(current).filter(([key]) => contractorDocumentAllowed(type, contractorDocumentType(key) || ""))));
    setErrors({});
  };
  const update = (key: keyof typeof form, value: string) => { setForm((current) => ({ ...current, [key]: value })); setErrors((current) => ({ ...current, [key]: "" })); };
  const field = (key: keyof typeof form, label: string, type = "text", placeholder?: string) => <label className="portal-field"><span>{label}</span><input type={type} dir="auto" value={form[key]} placeholder={placeholder} autoComplete={key === "email" ? "email" : key === "mobile" ? "tel" : undefined} aria-invalid={Boolean(errors[key])} aria-describedby={errors[key] ? `contractor-${key}-error` : undefined} onChange={(event) => update(key, event.target.value)} />{errors[key] ? <small id={`contractor-${key}-error`} className="portal-error">{errors[key]}</small> : null}</label>;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const next: Record<string, string> = {};
    const contractorName = normalizeContractorText(form.contractorName);
    const contractorNameEn = normalizeContractorText(form.contractorNameEn);
    const contactName = contractorType === "company" ? normalizeContractorText(form.contactName) : "";
    for (const [key, value] of [["contractorName", contractorName], ["contractorNameEn", contractorNameEn]]) if (value.length < 2 || value.length > 160) next[key] = "أدخل اسمًا من حرفين إلى 160 حرفًا؛ المسافات مسموحة.";
    if (contactName.length > 120) next.contactName = "اسم المسؤول لا يتجاوز 120 حرفًا.";
    if (!/^(?:\+?966|0)?5\d{8}$/.test(form.mobile.replace(/\s/g, ""))) next.mobile = "أدخل رقم جوال صحيحًا.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) next.email = "أدخل بريدًا إلكترونيًا صحيحًا.";
    if (!isValidContractorUsername(resolveContractorUsername(form.username, contractorNameEn))) next.username = "استخدم من حرفين إلى 160 حرفًا؛ المسافات مسموحة.";
    if (!serviceCities.length) next.serviceCities = "أضف مدينة واحدة على الأقل ثم اضغط Enter أو إضافة مدينة.";
    if (!specialties.length) next.specialties = "أضف تخصصًا واحدًا على الأقل.";
    const documentError = validateContractorFiles(contractorType, files, existing);
    if (documentError) next.documents = documentError;
    if (!policyState.policy || !policyState.accepted) next.policy = "يلزم الاطلاع على سياسة الانضمام والموافقة عليها.";
    setErrors(next);
    if (Object.keys(next).length) return;
    submitting.current = true; setBusy(true); setSubmitError("");
    try {
      const data = new FormData();
      Object.entries({ ...form, contractorType, contractorName, contractorNameEn, contactName }).forEach(([key, value]) => data.set(key, value));
      data.set("serviceCities", JSON.stringify(normalizeServiceCities(serviceCities)));
      data.set("specialties", JSON.stringify(normalizeServiceCities(specialties)));
      data.set("website", "");
      if (revisionToken) data.set("removedDocumentIds", JSON.stringify(allDocuments.filter((item) => removedIds.includes(item.id) || !contractorDocumentAllowed(contractorType, item.documentType || "")).map((item) => item.id)));
      appendProviderConsent(data, policyState.policy!);
      appendContractorFiles(data, files);
      const idempotencyKey = revisionToken ? undefined : crypto.randomUUID().replaceAll("-", "");
      setUploadStatus("جارٍ تجهيز وضغط المرفقات...");
      await uploadProviderDocuments(data, { kind: "contractor", idempotencyKey, revisionToken, onProgress: (percent) => setUploadStatus(`جارٍ رفع المرفقات: ${percent}٪`) });
      setUploadStatus("جارٍ حفظ وإرسال الطلب...");
      const response = await fetch(revisionToken ? `/api/public/join/revise/${encodeURIComponent(revisionToken)}` : "/api/public/join/contractor", { method: "POST", body: data, headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined });
      const body = await response.json() as { applicationId?: string; message?: string };
      if (!response.ok) { if (response.status === 409) policyState.reload(); throw new Error(body.message || "تعذر إرسال الطلب."); }
      setResult({ applicationId: body.applicationId || initial?.id || "" });
    } catch (error) {
      if (error instanceof ProviderUploadError && error.status === 409) policyState.reload();
      setSubmitError(error instanceof Error ? error.message : "تعذر إرسال الطلب.");
    } finally { submitting.current = false; setBusy(false); setUploadStatus(""); }
  }
  if (result) return <PortalShell><section className="portal-card application-card"><h1>{revisionToken ? "تم استلام التعديلات" : "تم استلام طلب انضمام المقاول"}</h1><p>{revisionToken ? "عاد الطلب إلى قائمة المراجعة، وتم إلغاء رابط التعديل ولا يمكن استخدامه مرة أخرى." : "سيصلك رد بعد مراجعة الإدارة."}</p><p>رقم الطلب: <span dir="ltr">{result.applicationId}</span></p></section></PortalShell>;
  const company = contractorType === "company";
  return <PortalShell><section className="portal-card application-card"><header className="portal-heading application-heading"><p>بوابة المقاولين</p><h1>{revisionToken ? "تعديل طلب انضمام مقاول" : "طلب انضمام مقاول"}</h1><span>اختر نوع المقاول، ثم أضف بياناتك ومدن عملك ومرفقاتك.</span></header>
    {initial ? <aside className="portal-form-message" role="note"><b>رقم الطلب: <span dir="ltr">{initial.id}</span></b><br/>التعديل المطلوب: {initial.review_notes || "راجع البيانات المطلوبة ثم أعد الإرسال."}<br/><small>هذا الرابط يُلغى تلقائيًا فور إعادة إرسال الطلب.</small></aside> : null}
    <form className="application-form" onSubmit={submit} noValidate>
      <fieldset disabled={busy} className="application-form" style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <ContractorTypeInput value={contractorType} onChange={changeType}/>
        {initial && contractorType !== initial.contractor_type ? <p className="portal-hint">أرفق المستندات المطلوبة للنوع المختار. لن تبقى مرفقات النوع الآخر ضمن الطلب الحالي بعد حفظ التعديل.</p> : null}
        <fieldset className="form-section"><legend><span>01</span> البيانات الأساسية</legend><div className="form-grid">
          {field("contractorName", company ? "اسم الشركة بالعربية" : "الاسم بالعربية")}{field("contractorNameEn", company ? "اسم الشركة بالإنجليزية" : "الاسم بالإنجليزية")}
          {company ? field("contactName", "اسم المسؤول (اختياري)") : null}{field("mobile", "رقم الجوال", "tel")}{field("email", "البريد الإلكتروني", "email")}{field("username", "اسم المستخدم (اختياري)", "text", "اتركه فارغًا لاستخدام الاسم بالإنجليزية")}
          <ServiceCitiesInput label="المدن التي يعمل بها المقاول" values={serviceCities} onChange={(cities) => { setServiceCities(cities); setErrors((current) => ({ ...current, serviceCities: "" })); }} error={errors.serviceCities}/>
        </div><p className="portal-hint">الأسماء والمدن تقبل عدة كلمات تفصل بينها مسافات. يُستخدم الاسم الإنجليزي كاملًا عند ترك اسم المستخدم فارغًا.</p></fieldset>
        <fieldset className="form-section"><legend><span>02</span> التخصصات</legend><MultiValueInput label="تخصصات المقاول" placeholder="مثال: بناء عظم" values={specialties} onChange={setSpecialties} error={errors.specialties}/></fieldset>
        <ContractorDocuments key={contractorType} type={contractorType} files={files} onChange={(value) => { setFiles(value); setErrors((current) => ({ ...current, documents: "" })); }} existing={existing} onRemoveExisting={(id) => setRemovedIds((current) => [...current, id])} error={errors.documents}/>
        <ProviderPolicyConsent value={policyState} label="سياسة التقديم كمقاول في بنية"/>
        {errors.policy && !policyState.accepted ? <p className="portal-error" role="alert">{errors.policy}</p> : null}
      </fieldset>
      {submitError ? <p className="portal-form-error" role="alert">{submitError}</p> : null}<p className="portal-hint" role="status" aria-live="polite" aria-atomic="true">{uploadStatus}</p><button className="portal-primary-button application-submit" disabled={busy || !policyState.policy || !policyState.accepted}>{busy ? "جارٍ الإرسال..." : revisionToken ? "حفظ التعديلات وإعادة الإرسال" : "رفع طلب الانضمام"}</button>
    </form><PolicyLinks/></section></PortalShell>;
}
