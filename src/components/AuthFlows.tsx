"use client";

import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ContractorApplication, CustomerRegistration, ProviderApplication } from "@/lib/bunya-types";
import type {LocalRoleSession} from "@/lib/driver-types";
import {authenticateDriver,createRoleSession,writeRoleSession} from "@/lib/driver-storage";
import {bootstrapDemoAccounts,demoAccountCredentials,resetDemoAccounts} from "@/lib/demo-accounts";
import { appendLocalRecord, createLocalId, createPasswordProof, localStorageKeys, normalizeValue, readLocalCollection, validatePassword } from "@/lib/bunya-local";
import { ApplicationSuccessState, AuthCard, PasswordFieldWithVisibilityCheckbox, PortalShell } from "./PortalUI";

type Errors = Record<string, string>;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const mobilePattern = /^(?:\+?966|0)?5\d{8}$/;

export function LoginFlow() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [demoOpen,setDemoOpen]=useState(false);
  const [resetOpen,setResetOpen]=useState(false);
  const [seedMessage,setSeedMessage]=useState("");
  useEffect(()=>{bootstrapDemoAccounts()},[]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const next: Errors = {};
    if (!identifier.trim()) next.identifier = "أدخل البريد أو اسم المستخدم أو رقم الجوال.";
    if (!password) next.password = "أدخل كلمة المرور.";
    if (Object.keys(next).length) return setErrors(next);
    setBusy(true);
    const proof = await createPasswordProof(password);
    const normalized = normalizeValue(identifier);
    const customer = readLocalCollection<CustomerRegistration>(localStorageKeys.customers).find((item) =>
      [item.email, item.username, item.mobile].some((value) => normalizeValue(value) === normalized) && item.passwordProof === proof,
    );
    if(customer){writeRoleSession(createRoleSession({role:"customer",userId:customer.id,displayName:customer.fullName,username:customer.username,email:customer.email,phone:customer.mobile,status:"active"}));return finishLogin("customer",router)}
    const provider=readLocalCollection<ProviderApplication & {passwordProof?:string}>(localStorageKeys.providers).find(item=>item.status==="approved"&&item.passwordProof===proof&&[item.email,item.username,item.mobile].some(value=>normalizeValue(value)===normalized));
    if(provider){writeRoleSession(createRoleSession({role:"provider",userId:provider.id,displayName:provider.companyName,username:provider.username,email:provider.email,phone:provider.mobile,status:provider.status}));return finishLogin("provider",router)}
    const contractor=readLocalCollection<ContractorApplication & {username?:string;passwordProof?:string}>(localStorageKeys.contractors).find(item=>item.status==="approved"&&item.passwordProof===proof&&[item.email,item.mobile,item.username??""].some(value=>normalizeValue(value)===normalized));
    if(contractor){writeRoleSession(createRoleSession({role:"contractor",userId:contractor.id,displayName:contractor.contractorName,username:contractor.username??"",email:contractor.email,phone:contractor.mobile,status:contractor.status}));return finishLogin("contractor",router)}
    const driverResult=await authenticateDriver(identifier,password);
    if(driverResult.ok){setBusy(false);router.push(driverResult.driver.mustChangePassword?"/driver/change-password":"/driver");return}
    const demoRole=demoRoleAccounts.find(item=>normalizeValue(item.identifier)===normalized&&item.passwordProof===proof);
    if(demoRole){writeRoleSession(createRoleSession({role:demoRole.role,userId:demoRole.userId,displayName:demoRole.displayName,username:demoRole.username,email:demoRole.email,phone:demoRole.phone,status:"active"}));return finishLogin(demoRole.role,router)}
    const admin=readLocalCollection<{id:string;name?:string;email?:string;username?:string;mobile?:string;passwordProof?:string;active?:boolean;status?:string}>("bunya-admin-users").find(item=>item.active!==false&&item.passwordProof===proof&&[item.email??"",item.username??"",item.mobile??""].some(value=>normalizeValue(value)===normalized));
    if(admin){writeRoleSession(createRoleSession({role:"admin",userId:admin.id,displayName:admin.name??"مدير بُنية",username:admin.username??"",email:admin.email??"",phone:admin.mobile??"",status:admin.status??"active"}));return finishLogin("admin",router)}
    {
      setBusy(false);
      return setErrors({ form: "بيانات الدخول غير مطابقة لحساب محلي. أنشئ حسابًا جديدًا أولًا." });
    }
  };

  const reset=()=>{const result=resetDemoAccounts();setSeedMessage(result.created?"أعيد إنشاء الحسابات التجريبية الناقصة.":"الحسابات التجريبية جاهزة دون تكرار.");setResetOpen(false)};
  return <PortalShell><AuthCard eyebrow="تسجيل الدخول الموحد" title="مرحبًا بعودتك" description="ادخل إلى لوحة دورك عبر البريد أو اسم المستخدم أو رقم الجوال.">
    <form className="portal-form" onSubmit={submit} noValidate>
      <div className="portal-field"><label htmlFor="login-id">البريد الإلكتروني أو اسم المستخدم أو رقم الجوال</label><input id="login-id" autoComplete="username" value={identifier} onChange={(event) => { setIdentifier(event.target.value); setErrors({}); }} />{errors.identifier ? <small className="portal-error">{errors.identifier}</small> : null}</div>
      <PasswordFieldWithVisibilityCheckbox id="login-password" label="كلمة المرور" value={password} onChange={(value) => { setPassword(value); setErrors({}); }} error={errors.password} />
      {errors.form ? <p className="portal-form-message portal-form-error">{errors.form}</p> : null}
      <button className="portal-primary-button" disabled={busy} type="submit">{busy ? "جارٍ التحقق..." : "تسجيل الدخول"}</button>
      <div className="portal-links"><Link href="/forgot-password">نسيت كلمة المرور؟</Link><Link href="/register">إنشاء حساب جديد</Link></div>
    </form>
  </AuthCard>{process.env.NODE_ENV==="development"?<section className="portal-demo-accounts"><button className="portal-demo-toggle" type="button" aria-expanded={demoOpen} onClick={()=>setDemoOpen(value=>!value)}>حسابات تجريبية <span>{demoOpen?"−":"＋"}</span></button>{demoOpen?<div className="portal-demo-content"><p>للاختبار المحلي فقط. زر التعبئة لا يسجل الدخول تلقائيًا.</p><div className="portal-demo-grid">{demoAccountCredentials.map(account=><article key={account.role}><header><strong>{account.label}</strong><small>{account.route}</small></header><dl><div><dt>البريد</dt><dd dir="ltr">{account.email}</dd></div><div><dt>المستخدم</dt><dd dir="ltr">{account.username}</dd></div><div><dt>الجوال</dt><dd dir="ltr">{account.mobile}</dd></div><div><dt>كلمة المرور</dt><dd dir="ltr">{account.password}</dd></div></dl><button type="button" onClick={()=>{setIdentifier(account.email);setPassword(account.password);setErrors({});window.scrollTo({top:0,behavior:"smooth"})}}>تعبئة البيانات</button></article>)}</div>{seedMessage?<p className="portal-demo-message" role="status">{seedMessage}</p>:null}<button className="portal-demo-reset" type="button" onClick={()=>setResetOpen(true)}>إعادة ضبط الحسابات التجريبية</button></div>:null}{resetOpen?<div className="portal-demo-backdrop" onMouseDown={()=>setResetOpen(false)}><section role="dialog" aria-modal="true" aria-labelledby="demo-reset-title" onMouseDown={event=>event.stopPropagation()}><h2 id="demo-reset-title">إعادة ضبط الحسابات التجريبية؟</h2><p>سيعاد إنشاء الحسابات الثلاثة فقط دون حذف الإدارة أو المستخدمين أو الطلبات.</p><footer><button type="button" onClick={()=>setResetOpen(false)}>تراجع</button><button type="button" onClick={reset}>تأكيد إعادة الضبط</button></footer></section></div>:null}</section>:null}</PortalShell>;
}

export function RegisterFlow() {
  const router = useRouter();
  const [form, setForm] = useState({ fullName: "", mobile: "", email: "", username: "", password: "", confirmPassword: "" });
  const [errors, setErrors] = useState<Errors>({});
  const update = (key: keyof typeof form, value: string) => { setForm((current) => ({ ...current, [key]: value })); setErrors({}); };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const next: Errors = {};
    if (form.fullName.trim().length < 3) next.fullName = "أدخل الاسم الكامل بشكل صحيح.";
    if (!mobilePattern.test(form.mobile.replace(/\s/g, ""))) next.mobile = "أدخل رقم جوال سعوديًا صحيحًا.";
    if (!emailPattern.test(form.email.trim())) next.email = "أدخل بريدًا إلكترونيًا صحيحًا.";
    if (form.username.trim().length < 4) next.username = "اسم المستخدم يجب أن يكون 4 أحرف على الأقل.";
    next.password = validatePassword(form.password);
    if (form.password !== form.confirmPassword) next.confirmPassword = "كلمتا المرور غير متطابقتين.";
    const customers = readLocalCollection<CustomerRegistration>(localStorageKeys.customers);
    if (customers.some((item) => normalizeValue(item.email) === normalizeValue(form.email))) next.email = "البريد الإلكتروني مستخدم محليًا.";
    if (customers.some((item) => normalizeValue(item.mobile) === normalizeValue(form.mobile))) next.mobile = "رقم الجوال مستخدم محليًا.";
    if (customers.some((item) => normalizeValue(item.username) === normalizeValue(form.username))) next.username = "اسم المستخدم مستخدم محليًا.";
    Object.keys(next).forEach((key) => { if (!next[key]) delete next[key]; });
    if (Object.keys(next).length) return setErrors(next);
    const record: CustomerRegistration = { id: createLocalId("customer"), fullName: form.fullName.trim(), mobile: form.mobile.trim(), email: normalizeValue(form.email), username: form.username.trim(), passwordProof: await createPasswordProof(form.password), createdAt: new Date().toISOString() };
    appendLocalRecord(localStorageKeys.customers, record);
    const session:LocalRoleSession=createRoleSession({role:"customer",userId:record.id,displayName:record.fullName,username:record.username,email:record.email,phone:record.mobile,status:"active"});
    writeRoleSession(session);
    router.push("/customer");
  };
  return <PortalShell><AuthCard eyebrow="حساب جديد" title="انضم إلى بُنية" description="أنشئ حساب عميل محليًا لمتابعة تجربة المنصة.">
    <form className="portal-form portal-form-two" onSubmit={submit} noValidate>
      <TextField id="register-name" label="الاسم الكامل" value={form.fullName} onChange={(v) => update("fullName", v)} error={errors.fullName} />
      <TextField id="register-mobile" label="رقم الجوال" value={form.mobile} onChange={(v) => update("mobile", v)} error={errors.mobile} inputMode="tel" />
      <TextField id="register-email" label="البريد الإلكتروني" value={form.email} onChange={(v) => update("email", v)} error={errors.email} type="email" />
      <TextField id="register-user" label="اسم المستخدم" value={form.username} onChange={(v) => update("username", v)} error={errors.username} />
      <PasswordFieldWithVisibilityCheckbox id="register-password" label="كلمة المرور" value={form.password} onChange={(v) => update("password", v)} error={errors.password} />
      <PasswordFieldWithVisibilityCheckbox id="register-confirm" label="تأكيد كلمة المرور" value={form.confirmPassword} onChange={(v) => update("confirmPassword", v)} error={errors.confirmPassword} confirm />
      <button className="portal-primary-button portal-full" type="submit">إنشاء الحساب والمتابعة</button>
      <p className="portal-auth-note portal-full">لديك حساب؟ <Link href="/login">سجل الدخول</Link></p>
    </form>
  </AuthCard></PortalShell>;
}

export function ForgotPasswordFlow() {
  const [identifier, setIdentifier] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const clean = identifier.trim();
    if (!emailPattern.test(clean) && !mobilePattern.test(clean.replace(/\s/g, ""))) return setError("أدخل بريدًا إلكترونيًا أو رقم جوال صحيحًا.");
    appendLocalRecord(localStorageKeys.resetRequests, { id: createLocalId("reset"), identifier: clean, createdAt: new Date().toISOString(), status: "mock-requested" });
    setSuccess(true);
  };
  if (success) return <PortalShell><ApplicationSuccessState title="تم تسجيل طلب الاستعادة" message="عند ربط خدمة المصادقة سيصل رابط الاستعادة أو الرمز إلى البريد أو الجوال المسجل." actionHref="/reset-password?token=mock-preview" actionLabel="معاينة تعيين كلمة جديدة" /></PortalShell>;
  return <PortalShell><AuthCard eyebrow="استعادة الوصول" title="نسيت كلمة المرور؟" description="هذه محاكاة محلية ولا ترسل بريدًا أو رسالة نصية."><form className="portal-form" onSubmit={submit}><TextField id="forgot-id" label="البريد الإلكتروني أو رقم الجوال" value={identifier} onChange={(value) => { setIdentifier(value); setError(""); }} error={error} /><button className="portal-primary-button" type="submit">إرسال طلب الاستعادة</button><p className="portal-auth-note"><Link href="/login">العودة لتسجيل الدخول</Link></p></form></AuthCard></PortalShell>;
}

export function ResetPasswordFlow() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const next: Errors = { password: validatePassword(password) };
    if (password !== confirm) next.confirm = "كلمتا المرور غير متطابقتين.";
    if (!next.password) delete next.password;
    if (Object.keys(next).length) return setErrors(next);
    window.localStorage.setItem("bunya-local-password-reset", JSON.stringify({ tokenPresent: new URLSearchParams(window.location.search).has("token"), completedAt: new Date().toISOString() }));
    router.push("/login");
  };
  return <PortalShell><AuthCard eyebrow="تعيين كلمة جديدة" title="اختر كلمة مرور قوية" description="الواجهة جاهزة لاستقبال token مستقبلًا من رابط الاستعادة."><form className="portal-form" onSubmit={submit}><PasswordFieldWithVisibilityCheckbox id="reset-password" label="كلمة المرور الجديدة" value={password} onChange={(v) => { setPassword(v); setErrors({}); }} error={errors.password} /><PasswordFieldWithVisibilityCheckbox id="reset-confirm" label="تأكيد كلمة المرور الجديدة" value={confirm} onChange={(v) => { setConfirm(v); setErrors({}); }} error={errors.confirm} confirm /><button className="portal-primary-button" type="submit">حفظ والعودة لتسجيل الدخول</button></form></AuthCard></PortalShell>;
}

function TextField({ id, label, value, onChange, error, type = "text", inputMode }: { id: string; label: string; value: string; onChange: (value: string) => void; error?: string; type?: string; inputMode?: "tel" | "email" }) {
  return <div className="portal-field"><label htmlFor={id}>{label}</label><input id={id} type={type} inputMode={inputMode} value={value} onChange={(event) => onChange(event.target.value)} />{error ? <small className="portal-error">{error}</small> : null}</div>;
}

function finishLogin(role:"customer"|"provider"|"contractor"|"admin",router:ReturnType<typeof useRouter>){const roots={customer:"/customer",provider:"/merchant",contractor:"/contractor",admin:"/admin"} as const;const queryReturnTo=new URLSearchParams(window.location.search).get("returnTo");const returnTo=queryReturnTo??localStorage.getItem("bunya-auth-return-to");localStorage.removeItem("bunya-auth-return-to");const root=roots[role];const allowed=returnTo===root||Boolean(returnTo?.startsWith(`${root}/`));router.push(allowed&&returnTo&&!returnTo.startsWith("//")?returnTo:root)}

const demoRoleAccounts=[
  {role:"provider" as const,userId:"provider-modern-materials",identifier:"provider@bunya.example",passwordProof:"3ae64778ed242037f55903dc854de496872436a95811d300124d55c3d86ab5ae",displayName:"شركة مواد البناء الحديثة",username:"modern_materials",email:"provider@bunya.example",phone:"0502489012"},
  {role:"contractor" as const,userId:"ctr-asas",identifier:"info@asas-omran.example",passwordProof:"e4af33fbd14f668564b1f1961056c83bbf1d6d2b7a6ddba017381aea06ad2082",displayName:"شركة أساس العمران للمقاولات",username:"",email:"info@asas-omran.example",phone:"0501148820"},
  {role:"admin" as const,userId:"admin-super",identifier:"admin@bunya.example",passwordProof:"64adbd5037eb4ba923be64e9a2740652c4715ac3e29105c9cc872ad05226c132",displayName:"مدير منصة بُنية",username:"",email:"admin@bunya.example",phone:"0550001000"},
] as const;
