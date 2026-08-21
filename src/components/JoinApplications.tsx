"use client";

import type { ChangeEvent, FormEvent, ReactNode } from "react";
import { useState } from "react";
import type { ParsedMapLocation } from "@/lib/bunya-types";
import { parseGoogleMapsLink } from "@/lib/bunya-local";
import { optimizeUploadFiles } from "@/lib/uploads/client";
import { isValidJoinUsername } from "@/lib/join/username";
import { MultiValueInput, PortalShell } from "./PortalUI";

type Errors = Record<string, string>;
type Result = { applicationId: string; status: string; submittedAt: string };
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const mobilePattern = /^(?:\+?966|0)?5\d{8}$/;
const quickRegions = ["المنطقة الجنوبية", "المنطقة الوسطى", "المنطقة الغربية", "المنطقة الشرقية", "المنطقة الشمالية"];

function Frame({ eyebrow, title, description, children }: { eyebrow: string; title: string; description: string; children: ReactNode }) {
  return <PortalShell><section className="portal-card application-card"><header className="portal-heading application-heading"><p>{eyebrow}</p><h1>{title}</h1><span>{description}</span></header>{children}</section></PortalShell>;
}
function Field({ id, label, value, onChange, error, type = "text", placeholder }: { id: string; label: string; value: string; onChange: (value: string) => void; error?: string; type?: string; placeholder?: string }) {
  return <div className="portal-field"><label htmlFor={id}>{label}</label><input id={id} type={type} placeholder={placeholder} value={value} onChange={(event) => onChange(event.target.value)} />{error ? <small className="portal-error">{error}</small> : null}</div>;
}
function Documents({ files, onChange, error }: { files: File[]; onChange: (files: File[]) => void; error?: string }) {
  const select = (event: ChangeEvent<HTMLInputElement>) => onChange(Array.from(event.target.files || []));
  return <fieldset className="form-section"><legend><span>05</span> المستندات الرسمية الخاصة بمقدم الطلب</legend><label className="portal-field"><span>PDF أو JPEG أو PNG أو WebP — خمسة ملفات كحد أقصى، 10 ميجابايت للملف</span><input type="file" accept=".pdf,image/jpeg,image/png,image/webp" multiple onChange={select}/></label><p className="portal-hint">تُضغط صور المستندات تلقائيًا قبل التخزين، بينما يُحفظ PDF الأصلي لحماية محتواه وتوقيعاته.</p>{files.map((file) => <p className="portal-hint" key={`${file.name}-${file.size}`}>{file.name} — {(file.size / 1024 / 1024).toFixed(2)} MB</p>)}{error ? <small className="portal-error">{error}</small> : null}</fieldset>;
}
function Success({ result, kind }: { result: Result; kind: "provider" | "contractor" }) {
  return <PortalShell><section className="portal-card application-card"><header className="portal-heading application-heading"><p>تم استلام الطلب</p><h1>طلب انضمام {kind === "provider" ? "المزود" : "المقاول"}</h1><span>سيصلك رد بعد مراجعة الإدارة.</span></header><dl className="admin-record-meta"><div><dt>رقم الطلب</dt><dd dir="ltr">{result.applicationId}</dd></div><div><dt>الحالة</dt><dd>{result.status === "pending" ? "قيد المراجعة" : result.status}</dd></div></dl></section></PortalShell>;
}
function validateDocuments(files: File[], errors: Errors) {
  const allowed = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);
  if (files.length > 5 || files.some((file) => file.size > 10 * 1024 * 1024 || !allowed.has(file.type))) errors.documents = "تحقق من عدد الملفات وأنواعها وأحجامها.";
}
async function send(kind: "provider" | "contractor", values: Record<string, string>, arrays: Record<string, string[]>, files: File[]) {
  const data = new FormData();
  Object.entries(values).forEach(([key, value]) => data.set(key, value));
  Object.entries(arrays).forEach(([key, value]) => data.set(key, JSON.stringify(value)));
  const optimizedFiles = await optimizeUploadFiles(files);
  optimizedFiles.forEach((file) => data.append("documents", file));
  data.set("website", "");
  const idempotencyKey = crypto.randomUUID().replaceAll("-", "");
  const response = await fetch(`/api/public/join/${kind}`, { method: "POST", body: data, headers: { "Idempotency-Key": idempotencyKey } });
  const body = await response.json() as Result & { message?: string };
  if (!response.ok) throw new Error(body.message || "تعذر إرسال الطلب.");
  return body;
}

async function analyzeGoogleMapsLink(value: string): Promise<ParsedMapLocation> {
  const parsed = parseGoogleMapsLink(value);
  if (parsed.kind !== "short-link") return parsed;

  try {
    const response = await fetch("/api/public/maps/resolve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: parsed.url }),
    });
    const body = await response.json() as ParsedMapLocation & { message?: string };
    if (!response.ok) return { url: parsed.url, kind: "invalid", message: body.message || "تعذر تحليل الرابط." };
    return body;
  } catch {
    return { url: parsed.url, kind: "invalid", message: "تعذر الاتصال بخدمة تحليل الرابط." };
  }
}

export function ProviderJoinFlow({ categories }: { categories: string[] }) {
  const [form, setForm] = useState({ companyName: "", contactName: "", mobile: "", email: "", username: "", mapsUrl: "", discountCode: "" });
  const [selected, setSelected] = useState<string[]>([]); const [custom, setCustom] = useState<string[]>([]); const [showOther, setShowOther] = useState(false);
  const [delivery, setDelivery] = useState<boolean | null>(null); const [regions, setRegions] = useState<string[]>([]); const [files, setFiles] = useState<File[]>([]);
  const [map, setMap] = useState<ParsedMapLocation | null>(null); const [mapBusy, setMapBusy] = useState(false); const [errors, setErrors] = useState<Errors>({}); const [result, setResult] = useState<Result | null>(null); const [busy, setBusy] = useState(false); const [submitError, setSubmitError] = useState("");
  const update = (key: keyof typeof form, value: string) => { setForm((current) => ({ ...current, [key]: value })); setErrors((current) => ({ ...current, [key]: "" })); };
  const analyzeMap = async () => {
    setMapBusy(true);
    const parsed = await analyzeGoogleMapsLink(form.mapsUrl);
    setMap(parsed);
    setErrors((current) => ({ ...current, mapsUrl: parsed.kind === "invalid" ? parsed.message : "" }));
    setMapBusy(false);
    return parsed;
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault(); const next: Errors = {};
    if (form.companyName.trim().length < 2) next.companyName = "أدخل اسم الشركة."; if (form.contactName.trim().length < 2) next.contactName = "أدخل اسم المسؤول.";
    if (!mobilePattern.test(form.mobile.replace(/\s/g, ""))) next.mobile = "أدخل رقم جوال صحيحًا."; if (!emailPattern.test(form.email.trim())) next.email = "أدخل بريدًا إلكترونيًا صحيحًا."; if (!isValidJoinUsername(form.username.trim())) next.username = "استخدم 4–40 حرفًا بدون مسافات؛ يمكنك استخدام _ أو -.";
    const parsed = map?.url === form.mapsUrl.trim() && map.kind === "coordinates" ? map : await analyzeMap(); if (parsed.kind === "invalid") next.mapsUrl = parsed.message;
    const allCategories = [...selected, ...custom]; if (!allCategories.length) next.categories = "اختر تصنيفًا واحدًا على الأقل."; if (delivery === null) next.delivery = "حدد توفر التوصيل."; if (delivery && !regions.length) next.regions = "أضف منطقة توصيل واحدة على الأقل."; validateDocuments(files, next);
    if (Object.keys(next).length) return setErrors(next); setBusy(true); setSubmitError("");
    try { setResult(await send("provider", { ...form, mapsUrl: parsed.url, latitude: String(parsed.latitude ?? ""), longitude: String(parsed.longitude ?? ""), deliveryAvailable: String(delivery) }, { categories: allCategories, regions: delivery ? regions : ["لا يوجد توصيل"] }, files)); } catch (error) { setSubmitError(error instanceof Error ? error.message : "تعذر إرسال الطلب."); } finally { setBusy(false); }
  };
  if (result) return <Success result={result} kind="provider"/>;
  return <Frame eyebrow="بوابة الشركاء" title="طلب انضمام مزود" description="قدّم بيانات منشأتك دون الحاجة إلى تسجيل الدخول."><form className="application-form" onSubmit={submit} noValidate><input tabIndex={-1} autoComplete="off" className="sr-only" name="website"/>
    <fieldset className="form-section"><legend><span>01</span> بيانات مقدم الطلب</legend><div className="form-grid"><Field id="provider-company" label="اسم الشركة" value={form.companyName} onChange={(v)=>update("companyName",v)} error={errors.companyName}/><Field id="provider-contact" label="اسم المسؤول" value={form.contactName} onChange={(v)=>update("contactName",v)} error={errors.contactName}/><Field id="provider-mobile" label="رقم الجوال" value={form.mobile} onChange={(v)=>update("mobile",v)} error={errors.mobile}/><Field id="provider-email" label="البريد الإلكتروني" type="email" value={form.email} onChange={(v)=>update("email",v)} error={errors.email}/><Field id="provider-user" label="اسم المستخدم المطلوب" value={form.username} onChange={(v)=>update("username",v)} error={errors.username}/><Field id="provider-discount" label="كود الخصم (اختياري)" value={form.discountCode} onChange={(v)=>update("discountCode",v)}/></div></fieldset>
    <fieldset className="form-section"><legend><span>02</span> موقع مقدم الطلب</legend><div className="map-input-row"><Field id="provider-map" label="رابط Google Maps" value={form.mapsUrl} onChange={(v)=>{update("mapsUrl",v);setMap(null)}} error={errors.mapsUrl}/><button type="button" disabled={mapBusy} onClick={()=>void analyzeMap()}>{mapBusy?"جارٍ التحليل...":"تحليل الرابط"}</button></div>{map && map.kind!=="invalid"?<p className="portal-hint">{map.message}</p>:null}</fieldset>
    <fieldset className="form-section"><legend><span>03</span> التصنيفات الرئيسية المتوفرة لدى مقدم الطلب</legend><div className="choice-grid">{categories.map((category)=><label className={selected.includes(category)?"choice-card choice-card-active":"choice-card"} key={category}><input type="checkbox" checked={selected.includes(category)} onChange={()=>setSelected((current)=>current.includes(category)?current.filter((v)=>v!==category):[...current,category])}/>{category}</label>)}<label className={showOther?"choice-card choice-card-active":"choice-card"}><input type="checkbox" checked={showOther} onChange={(e)=>setShowOther(e.target.checked)}/>أخرى</label></div>{showOther?<MultiValueInput label="تصنيفات مخصصة" placeholder="اكتب التصنيف" values={custom} onChange={setCustom}/>:null}{errors.categories?<small className="portal-error">{errors.categories}</small>:null}</fieldset>
    <fieldset className="form-section"><legend><span>04</span> هل يوجد توصيل؟</legend><div className="binary-choice"><label className={delivery===true?"active":""}><input type="radio" checked={delivery===true} onChange={()=>setDelivery(true)}/>نعم</label><label className={delivery===false?"active":""}><input type="radio" checked={delivery===false} onChange={()=>{setDelivery(false);setRegions([])}}/>لا</label></div>{delivery?<MultiValueInput label="مناطق التوصيل" placeholder="مثال: شمال الرياض" values={regions} onChange={setRegions} error={errors.regions}/>:null}{errors.delivery?<small className="portal-error">{errors.delivery}</small>:null}</fieldset>
    <Documents files={files} onChange={setFiles} error={errors.documents}/>{submitError?<p className="portal-form-error" role="alert">{submitError}</p>:null}<button className="portal-primary-button application-submit" disabled={busy}>{busy?"جارٍ الإرسال...":"رفع طلب الانضمام"}</button></form></Frame>;
}

export function ContractorJoinFlow() {
  const [form,setForm]=useState({contractorName:"",mobile:"",email:""}); const [regions,setRegions]=useState<string[]>([]); const [specialties,setSpecialties]=useState<string[]>([]); const [files,setFiles]=useState<File[]>([]); const [errors,setErrors]=useState<Errors>({}); const [result,setResult]=useState<Result|null>(null); const [busy,setBusy]=useState(false); const [submitError,setSubmitError]=useState("");
  const submit=async(event:FormEvent)=>{event.preventDefault();const next:Errors={};if(form.contractorName.trim().length<3)next.contractorName="أدخل اسم المقاول.";if(!mobilePattern.test(form.mobile.replace(/\s/g,"")))next.mobile="أدخل رقم جوال صحيحًا.";if(!emailPattern.test(form.email.trim()))next.email="أدخل بريدًا إلكترونيًا صحيحًا.";if(!regions.length)next.regions="اختر منطقة عمل.";if(!specialties.length)next.specialties="أضف تخصصًا.";validateDocuments(files,next);if(Object.keys(next).length)return setErrors(next);setBusy(true);setSubmitError("");try{setResult(await send("contractor",form,{regions,specialties},files))}catch(error){setSubmitError(error instanceof Error?error.message:"تعذر إرسال الطلب.")}finally{setBusy(false)}};
  if(result)return <Success result={result} kind="contractor"/>;
  return <Frame eyebrow="بوابة المقاولين" title="طلب انضمام مقاول" description="عرّف بخبراتك ومناطق عملك دون الحاجة إلى تسجيل الدخول."><form className="application-form" onSubmit={submit} noValidate><fieldset className="form-section"><legend><span>01</span> البيانات الأساسية</legend><div className="form-grid"><Field id="contractor-name" label="اسم المقاول" value={form.contractorName} onChange={(v)=>setForm({...form,contractorName:v})} error={errors.contractorName}/><Field id="contractor-mobile" label="رقم الجوال" value={form.mobile} onChange={(v)=>setForm({...form,mobile:v})} error={errors.mobile}/><Field id="contractor-email" label="البريد الإلكتروني" type="email" value={form.email} onChange={(v)=>setForm({...form,email:v})} error={errors.email}/></div></fieldset><fieldset className="form-section"><legend><span>02</span> مناطق العمل</legend><div className="choice-grid region-grid">{quickRegions.map((region)=><label className={regions.includes(region)?"choice-card choice-card-active":"choice-card"} key={region}><input type="checkbox" checked={regions.includes(region)} onChange={()=>setRegions((current)=>current.includes(region)?current.filter((v)=>v!==region):[...current,region])}/>{region}</label>)}</div><MultiValueInput label="مناطق مخصصة" placeholder="اكتب المنطقة" values={regions.filter((r)=>!quickRegions.includes(r))} onChange={(custom)=>setRegions([...regions.filter((r)=>quickRegions.includes(r)),...custom])} error={errors.regions}/></fieldset><fieldset className="form-section"><legend><span>03</span> التخصصات</legend><MultiValueInput label="تخصصات المقاول" placeholder="مثال: بناء عظم" values={specialties} onChange={setSpecialties} error={errors.specialties}/></fieldset><Documents files={files} onChange={setFiles} error={errors.documents}/>{submitError?<p className="portal-form-error" role="alert">{submitError}</p>:null}<button className="portal-primary-button application-submit" disabled={busy}>{busy?"جارٍ الإرسال...":"إرسال طلب الانضمام"}</button></form></Frame>;
}
