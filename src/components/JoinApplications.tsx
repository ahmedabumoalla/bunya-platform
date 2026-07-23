"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import type { ParsedMapLocation } from "@/lib/bunya-types";
import { parseGoogleMapsLink } from "@/lib/bunya-local";
import { createClient } from "@/lib/supabase/client";
import { ApplicationSuccessState, MultiValueInput, PortalShell } from "./PortalUI";

type Errors = Record<string, string>;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const mobilePattern = /^(?:\+?966|0)?5\d{8}$/;
const quickRegions = ["المنطقة الجنوبية", "المنطقة الوسطى", "المنطقة الغربية", "المنطقة الشرقية", "المنطقة الشمالية"];

function ApplicationFrame({ eyebrow, title, description, children }: { eyebrow: string; title: string; description: string; children: React.ReactNode }) {
  return <PortalShell><section className="portal-card application-card"><header className="portal-heading application-heading"><p>{eyebrow}</p><h1>{title}</h1><span>{description}</span></header>{children}</section></PortalShell>;
}

function Field({ id, label, value, onChange, error, type = "text", placeholder }: { id: string; label: string; value: string; onChange: (value: string) => void; error?: string; type?: string; placeholder?: string }) {
  return <div className="portal-field"><label htmlFor={id}>{label}</label><input id={id} type={type} placeholder={placeholder} value={value} onChange={(event) => onChange(event.target.value)} />{error ? <small className="portal-error">{error}</small> : null}</div>;
}

export function ProviderJoinFlow({ categories }: { categories: string[] }) {
  const [form, setForm] = useState({ companyName: "", contactName: "", mobile: "", email: "", username: "", mapsUrl: "", discountCode: "" });
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [customCategories, setCustomCategories] = useState<string[]>([]);
  const [showOther, setShowOther] = useState(false);
  const [deliveryAvailable, setDeliveryAvailable] = useState<boolean | null>(null);
  const [deliveryRegions, setDeliveryRegions] = useState<string[]>([]);
  const [mapResult, setMapResult] = useState<ParsedMapLocation | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const update = (key: keyof typeof form, value: string) => { setForm((current) => ({ ...current, [key]: value })); setErrors((current) => ({ ...current, [key]: "" })); };
  const toggleCategory = (category: string) => setSelectedCategories((current) => current.includes(category) ? current.filter((item) => item !== category) : [...current, category]);
  const analyzeMap = () => { const result = parseGoogleMapsLink(form.mapsUrl); setMapResult(result); setErrors((current) => ({ ...current, mapsUrl: result.kind === "invalid" ? result.message : "" })); };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const next: Errors = {};
    if (form.companyName.trim().length < 2) next.companyName = "أدخل اسم الشركة.";
    if (form.contactName.trim().length < 2) next.contactName = "أدخل اسم المسؤول.";
    if (!mobilePattern.test(form.mobile.replace(/\s/g, ""))) next.mobile = "أدخل رقم جوال صحيحًا.";
    if (!emailPattern.test(form.email.trim())) next.email = "أدخل بريدًا إلكترونيًا صحيحًا.";
    if (form.username.trim().length < 4) next.username = "اسم المستخدم يجب أن يكون 4 أحرف على الأقل.";
    const parsed = parseGoogleMapsLink(form.mapsUrl);
    setMapResult(parsed);
    if (parsed.kind === "invalid") next.mapsUrl = parsed.message;
    const allCategories = [...selectedCategories, ...customCategories];
    if (!allCategories.length) next.categories = "اختر تصنيفًا واحدًا على الأقل.";
    if (deliveryAvailable === null) next.delivery = "حدد ما إذا كان التوصيل متوفرًا.";
    if (deliveryAvailable && !deliveryRegions.length) next.deliveryRegions = "أضف منطقة توصيل واحدة على الأقل.";
    if (Object.keys(next).length) return setErrors(next);
    setSubmitting(true);
    setSubmitError("");
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setSubmitting(false);
      setSubmitError("يلزم تسجيل الدخول بحساب بُنية قبل إرسال طلب الانضمام.");
      return;
    }
    const { data: application, error: applicationError } = await supabase.from("provider_applications").insert({
      applicant_profile_id: user.id,
      company_name: form.companyName.trim(),
      contact_name: form.contactName.trim(),
      mobile: form.mobile.trim(),
      email: form.email.trim().toLowerCase(),
      requested_username: form.username.trim(),
      google_maps_url: parsed.url,
      latitude: parsed.latitude ?? null,
      longitude: parsed.longitude ?? null,
      discount_code: form.discountCode.trim() || null,
      delivery_available: deliveryAvailable === true,
    }).select("id").single();
    if (applicationError || !application) {
      setSubmitting(false);
      setSubmitError(applicationError?.message ?? "تعذر إنشاء طلب الانضمام.");
      return;
    }
    const { data: categoryRecords, error: categoryLookupError } = selectedCategories.length
      ? await supabase.from("product_categories").select("id,name").in("name", selectedCategories)
      : { data: [], error: null };
    if (categoryLookupError) {
      setSubmitting(false);
      setSubmitError(categoryLookupError.message);
      return;
    }
    const categoryIds = new Map((categoryRecords ?? []).map((category) => [category.name, category.id]));
    const categoryRows = [
      ...selectedCategories.map((name) => ({ application_id: application.id, category_id: categoryIds.get(name) ?? null, custom_category: categoryIds.has(name) ? null : name })),
      ...customCategories.map((name) => ({ application_id: application.id, category_id: null, custom_category: name })),
    ];
    const { error: categoriesError } = await supabase.from("provider_application_categories").insert(categoryRows);
    const { error: regionsError } = deliveryAvailable && deliveryRegions.length
      ? await supabase.from("provider_delivery_regions").insert(deliveryRegions.map((regionName) => ({ application_id: application.id, region_name: regionName })))
      : { error: null };
    setSubmitting(false);
    if (categoriesError || regionsError) {
      setSubmitError(categoriesError?.message ?? regionsError?.message ?? "تم إنشاء الطلب، لكن تعذر حفظ بعض التفاصيل.");
      return;
    }
    setSuccess(true);
  };
  if (success) return <PortalShell><ApplicationSuccessState title="تم رفع طلب انضمام المزود" message="حُفظ الطلب في قاعدة بيانات بُنية بحالة قيد المراجعة." destination="طلبات الانضمام للمزودين" /></PortalShell>;
  return <ApplicationFrame eyebrow="بوابة الشركاء" title="طلب انضمام مزود" description="قدّم بيانات منشأتك ومنتجاتك في نموذج منظم ومختصر."><form className="application-form" onSubmit={submit} noValidate>
    <fieldset className="form-section"><legend><span>01</span> بيانات الشركة</legend><div className="form-grid"><Field id="provider-company" label="اسم الشركة" value={form.companyName} onChange={(v) => update("companyName", v)} error={errors.companyName} /><Field id="provider-contact" label="اسم المسؤول" value={form.contactName} onChange={(v) => update("contactName", v)} error={errors.contactName} /><Field id="provider-mobile" label="رقم الجوال" value={form.mobile} onChange={(v) => update("mobile", v)} error={errors.mobile} /><Field id="provider-email" label="البريد الإلكتروني" type="email" value={form.email} onChange={(v) => update("email", v)} error={errors.email} /><Field id="provider-user" label="اسم المستخدم" value={form.username} onChange={(v) => update("username", v)} error={errors.username} /><Field id="provider-discount" label="كود الخصم (اختياري)" value={form.discountCode} onChange={(v) => update("discountCode", v)} /></div></fieldset>
    <fieldset className="form-section"><legend><span>02</span> موقع الشركة</legend><div className="map-input-row"><Field id="provider-map" label="رابط Google Maps" value={form.mapsUrl} onChange={(v) => { update("mapsUrl", v); setMapResult(null); }} error={errors.mapsUrl} placeholder="https://www.google.com/maps/..." /><button type="button" onClick={analyzeMap}>تحليل الرابط</button></div>{mapResult && mapResult.kind !== "invalid" ? <div className={`map-result map-result-${mapResult.kind}`}><strong>{mapResult.message}</strong>{mapResult.latitude !== undefined ? <span dir="ltr">{mapResult.latitude}, {mapResult.longitude}</span> : null}</div> : null}</fieldset>
    <fieldset className="form-section"><legend><span>03</span> المنتجات المتوفرة</legend><div className="choice-grid">{categories.map((category) => <label className={selectedCategories.includes(category) ? "choice-card choice-card-active" : "choice-card"} key={category}><input type="checkbox" checked={selectedCategories.includes(category)} onChange={() => toggleCategory(category)} />{category}</label>)}<label className={showOther ? "choice-card choice-card-active" : "choice-card"}><input type="checkbox" checked={showOther} onChange={(event) => setShowOther(event.target.checked)} />أخرى</label></div>{showOther ? <MultiValueInput label="تصنيفات مخصصة" placeholder="اكتب التصنيف" values={customCategories} onChange={setCustomCategories} forbiddenValues={selectedCategories} /> : null}{errors.categories ? <small className="portal-error">{errors.categories}</small> : null}</fieldset>
    <fieldset className="form-section"><legend><span>04</span> التوصيل</legend><p className="section-question">هل يتوفر توصيل؟</p><div className="binary-choice"><label className={deliveryAvailable === true ? "active" : ""}><input type="radio" name="delivery" checked={deliveryAvailable === true} onChange={() => { setDeliveryAvailable(true); setErrors((c) => ({ ...c, delivery: "" })); }} />نعم</label><label className={deliveryAvailable === false ? "active" : ""}><input type="radio" name="delivery" checked={deliveryAvailable === false} onChange={() => { setDeliveryAvailable(false); setDeliveryRegions([]); setErrors((c) => ({ ...c, delivery: "" })); }} />لا</label></div>{errors.delivery ? <small className="portal-error">{errors.delivery}</small> : null}{deliveryAvailable ? <MultiValueInput label="أماكن التوصيل" placeholder="مثال: شمال الرياض" values={deliveryRegions} onChange={setDeliveryRegions} error={errors.deliveryRegions} /> : null}</fieldset>
    {submitError ? <p className="portal-form-error" role="alert">{submitError}</p> : null}
    <button className="portal-primary-button application-submit" type="submit" disabled={submitting}>{submitting ? "جارٍ الإرسال..." : "رفع طلب الانضمام"}</button>
  </form></ApplicationFrame>;
}

export function ContractorJoinFlow() {
  const [form, setForm] = useState({ contractorName: "", mobile: "", email: "" });
  const [regions, setRegions] = useState<string[]>([]);
  const [specialties, setSpecialties] = useState<string[]>([]);
  const [errors, setErrors] = useState<Errors>({});
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const update = (key: keyof typeof form, value: string) => { setForm((current) => ({ ...current, [key]: value })); setErrors({}); };
  const toggleRegion = (region: string) => setRegions((current) => current.includes(region) ? current.filter((item) => item !== region) : [...current, region]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const next: Errors = {};
    if (form.contractorName.trim().length < 3) next.contractorName = "أدخل اسم المقاول.";
    if (!mobilePattern.test(form.mobile.replace(/\s/g, ""))) next.mobile = "أدخل رقم جوال صحيحًا.";
    if (!emailPattern.test(form.email.trim())) next.email = "أدخل بريدًا إلكترونيًا صحيحًا.";
    if (!regions.length) next.regions = "اختر أو أضف منطقة عمل واحدة على الأقل.";
    if (!specialties.length) next.specialties = "أضف تخصصًا واحدًا على الأقل.";
    if (Object.keys(next).length) return setErrors(next);
    setSubmitting(true);
    setSubmitError("");
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setSubmitting(false);
      setSubmitError("يلزم تسجيل الدخول بحساب بُنية قبل إرسال طلب الانضمام.");
      return;
    }
    const { data: application, error: applicationError } = await supabase.from("contractor_applications").insert({
      applicant_profile_id: user.id,
      contractor_name: form.contractorName.trim(),
      mobile: form.mobile.trim(),
      email: form.email.trim().toLowerCase(),
    }).select("id").single();
    if (applicationError || !application) {
      setSubmitting(false);
      setSubmitError(applicationError?.message ?? "تعذر إنشاء طلب الانضمام.");
      return;
    }
    const [{ error: regionsError }, { error: specialtiesError }] = await Promise.all([
      supabase.from("contractor_work_regions").insert(regions.map((regionName) => ({ application_id: application.id, region_name: regionName }))),
      supabase.from("contractor_specialties").insert(specialties.map((specialtyName) => ({ application_id: application.id, specialty_name: specialtyName }))),
    ]);
    setSubmitting(false);
    if (regionsError || specialtiesError) {
      setSubmitError(regionsError?.message ?? specialtiesError?.message ?? "تم إنشاء الطلب، لكن تعذر حفظ بعض التفاصيل.");
      return;
    }
    setSuccess(true);
  };
  if (success) return <PortalShell><ApplicationSuccessState title="تم إرسال طلب انضمام المقاول" message="حُفظ الطلب في قاعدة بيانات بُنية بحالة قيد المراجعة." destination="طلبات انضمام المقاولين" /></PortalShell>;
  return <ApplicationFrame eyebrow="بوابة المقاولين" title="طلب انضمام مقاول" description="عرّف بخبراتك ومناطق عملك وارفق بيانات مستنداتك."><form className="application-form" onSubmit={submit} noValidate>
    <fieldset className="form-section"><legend><span>01</span> البيانات الأساسية</legend><div className="form-grid"><Field id="contractor-name" label="اسم المقاول" value={form.contractorName} onChange={(v) => update("contractorName", v)} error={errors.contractorName} /><Field id="contractor-mobile" label="رقم الجوال" value={form.mobile} onChange={(v) => update("mobile", v)} error={errors.mobile} /><Field id="contractor-email" label="البريد الإلكتروني" type="email" value={form.email} onChange={(v) => update("email", v)} error={errors.email} /></div></fieldset>
    <fieldset className="form-section"><legend><span>02</span> مناطق العمل</legend><div className="choice-grid region-grid">{quickRegions.map((region) => <label className={regions.includes(region) ? "choice-card choice-card-active" : "choice-card"} key={region}><input type="checkbox" checked={regions.includes(region)} onChange={() => toggleRegion(region)} />{region}</label>)}</div><MultiValueInput label="مناطق مخصصة" placeholder="اكتب اسم المنطقة" values={regions.filter((region) => !quickRegions.includes(region))} onChange={(custom) => setRegions([...regions.filter((region) => quickRegions.includes(region)), ...custom])} error={errors.regions} forbiddenValues={quickRegions} /></fieldset>
    <fieldset className="form-section"><legend><span>03</span> التخصصات</legend><MultiValueInput label="تخصصات المقاول" placeholder="مثال: بناء عظم" values={specialties} onChange={setSpecialties} error={errors.specialties} /></fieldset>
    <fieldset className="form-section"><legend><span>04</span> المستندات الإثباتية</legend><p className="portal-hint">تُرفع المستندات من الملف المهني بعد اعتماد الحساب، ولا تُحفظ ملفات وهمية في المتصفح.</p></fieldset>
    {submitError ? <p className="portal-form-error" role="alert">{submitError}</p> : null}
    <button className="portal-primary-button application-submit" type="submit" disabled={submitting}>{submitting ? "جارٍ الإرسال..." : "إرسال طلب الانضمام"}</button>
  </form></ApplicationFrame>;
}
