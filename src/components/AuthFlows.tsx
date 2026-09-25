"use client";
import {FormEvent,useState} from "react";
import Link from "next/link";
import {useRouter} from "next/navigation";
import {validatePassword} from "@/lib/bunya-local";
import {quoteReturnToQuery} from "@/lib/auth/return-to";
import {normalizeSaudiPhone,pendingRegistrationCodeSentKey,pendingRegistrationPhoneKey} from "@/lib/auth/phone-verification";
import {createClient} from "@/lib/supabase/client";
import {ApplicationSuccessState,AuthCard,PasswordFieldWithVisibilityCheckbox,PortalShell} from "./PortalUI";
type Errors=Record<string,string>;const emailPattern=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function RegisterFlow({returnTo}:{returnTo?:string}){
 const router=useRouter();
 const [form,setForm]=useState({fullName:"",email:"",phone:"",username:"",password:"",confirmPassword:""});
 const [errors,setErrors]=useState<Errors>({});
 const [busy,setBusy]=useState(false);
 const update=(key:keyof typeof form,value:string)=>{setForm(current=>({...current,[key]:value}));setErrors({})};
 const submit=async(event:FormEvent)=>{
  event.preventDefault();
  const next:Errors={};
  const username=form.username.normalize("NFKC").trim().replace(/\s+/gu,"_");
  const phone=normalizeSaudiPhone(form.phone);
  if(form.fullName.trim().length<3)next.fullName="أدخل الاسم الكامل.";
  if(!emailPattern.test(form.email.trim()))next.email="أدخل بريدًا صحيحًا.";
  if(!phone)next.phone="أدخل رقم جوال سعوديًا صحيحًا، مثل 05xxxxxxxx.";
  if(username.length<4||username.length>40)next.username="اسم المستخدم من 4 إلى 40 حرفًا دون مسافات.";
  const passwordError=validatePassword(form.password);
  if(passwordError)next.password=passwordError;
  if(form.password!==form.confirmPassword)next.confirmPassword="كلمتا المرور غير متطابقتين.";
  if(Object.keys(next).length)return setErrors(next);
  setErrors({});
  setBusy(true);
  const response=await fetch("/api/auth/register",{method:"POST",headers:{"content-type":"application/json","Idempotency-Key":crypto.randomUUID()},body:JSON.stringify({...form,phone,username})});
  const body=await response.json() as {created?:boolean;verificationSent?:boolean;phone?:string;message?:string};
  if(!response.ok||!body.created){setBusy(false);return setErrors({form:body.message||"تعذر إنشاء الحساب."})}
  const signedIn=await createClient().auth.signInWithPassword({email:form.email.trim().toLowerCase(),password:form.password});
  setBusy(false);
  if(signedIn.error)return setErrors({form:"تم إنشاء الحساب. سجل الدخول لإكمال توثيق رقم الجوال."});
  sessionStorage.setItem(pendingRegistrationPhoneKey,body.phone||phone!);
  if(body.verificationSent)sessionStorage.setItem(pendingRegistrationCodeSentKey,"true");
  router.replace(`/verify-phone${quoteReturnToQuery(returnTo)}`);
  router.refresh();
 };
 return <PortalShell><AuthCard eyebrow="حساب جديد" title="انضم إلى بُنية" description="أدخل رقم جوالك الأساسي؛ سنرسل إليه رمز التحقق والعروض والتنبيهات المهمة."><form className="portal-form portal-form-two" onSubmit={submit} noValidate><TextField id="name" label="الاسم الكامل" value={form.fullName} onChange={v=>update("fullName",v)} error={errors.fullName} autoComplete="name"/><TextField id="email" label="البريد الإلكتروني" value={form.email} onChange={v=>update("email",v)} error={errors.email} type="email" inputMode="email" autoComplete="email"/><TextField id="phone" label="رقم الجوال السعودي" value={form.phone} onChange={v=>update("phone",v)} error={errors.phone} type="tel" inputMode="tel" autoComplete="tel" placeholder="05xxxxxxxx" dir="ltr"/><TextField id="username" label="اسم المستخدم" value={form.username} onChange={v=>update("username",v)} error={errors.username} autoComplete="username"/><PasswordFieldWithVisibilityCheckbox id="password" label="كلمة المرور" value={form.password} onChange={v=>update("password",v)} error={errors.password}/><PasswordFieldWithVisibilityCheckbox id="confirm" label="تأكيد كلمة المرور" value={form.confirmPassword} onChange={v=>update("confirmPassword",v)} error={errors.confirmPassword} confirm/><p className="portal-hint portal-full">يجب أن يكون الرقم مفعّلًا على واتساب لاستلام رمز التحقق، وسيُستخدم لاحقًا لاستلام العروض والإشعارات والتواصل المتعلق بطلباتك.</p>{errors.form?<p className="portal-form-error portal-full" role="alert">{errors.form}</p>:null}<button className="portal-primary-button portal-full" disabled={busy}>{busy?"جارٍ إنشاء الحساب...":"إنشاء الحساب وإرسال رمز التحقق"}</button><p className="portal-auth-note portal-full">لديك حساب؟ <Link href={`/login${quoteReturnToQuery(returnTo)}`}>سجل الدخول</Link></p></form></AuthCard></PortalShell>}

export function ForgotPasswordFlow(){const[email,setEmail]=useState(""),[error,setError]=useState(""),[success,setSuccess]=useState(false),[busy,setBusy]=useState(false);const submit=async(event:FormEvent)=>{event.preventDefault();const clean=email.trim().toLowerCase();if(!emailPattern.test(clean))return setError("أدخل بريدًا صحيحًا.");setBusy(true);setError("");try{const response=await fetch("/api/auth/password-recovery",{method:"POST",headers:{"content-type":"application/json","Idempotency-Key":crypto.randomUUID()},body:JSON.stringify({email:clean})});const body=await response.json() as {accepted?:boolean;message?:string};if(!response.ok||!body.accepted)return setError(body.message||"تعذر إرسال رابط الاستعادة الآن.");setSuccess(true)}catch{return setError("تعذر الاتصال بالمنصة. تحقق من اتصالك وحاول مجددًا.")}finally{setBusy(false)}};if(success)return <PortalShell><ApplicationSuccessState title="تحقق من بريدك" message="إذا كان البريد مرتبطًا بحساب فسيصلك رابط آمن يفتح منصة بُنية الرسمية. تحقق من البريد غير المرغوب فيه أيضًا." actionHref="/login" actionLabel="العودة لتسجيل الدخول"/></PortalShell>;return <PortalShell><AuthCard eyebrow="استعادة الوصول" title="نسيت كلمة المرور؟" description="سنرسل رابط استعادة آمنًا يفتح صفحة تعيين كلمة المرور في منصة بُنية الرسمية."><form className="portal-form" onSubmit={submit}><TextField id="forgot" label="البريد الإلكتروني" value={email} onChange={v=>{setEmail(v);setError("")}} error={error} type="email"/><button className="portal-primary-button" disabled={busy}>{busy?"جارٍ الإرسال...":"إرسال رابط الاستعادة"}</button></form></AuthCard></PortalShell>}

function resetPasswordErrorMessage(error:{code?:string;message?:string}){if(error.code==="same_password"||error.message?.toLowerCase().includes("different from the old password"))return"كلمة المرور الجديدة مطابقة لكلمة المرور الحالية. اختر كلمة مختلفة ثم أعد الحفظ.";if(error.code==="weak_password")return"لم تقبل خدمة الحماية كلمة المرور. استخدم 8 أحرف على الأقل تتضمن حرفًا إنجليزيًا كبيرًا ورقمًا.";if(error.code==="session_not_found"||error.code==="refresh_token_not_found")return"انتهت جلسة الاستعادة. اطلب رابطًا جديدًا من صفحة نسيت كلمة المرور.";return"تعذر تحديث كلمة المرور الآن. أعد المحاولة، وإذا استمر الخطأ اطلب رابط استعادة جديدًا."}

export function ResetPasswordFlow(){const router=useRouter(),[password,setPassword]=useState(""),[confirm,setConfirm]=useState(""),[errors,setErrors]=useState<Errors>({}),[busy,setBusy]=useState(false);const updatePassword=(value:string)=>{setPassword(value);setErrors({})},updateConfirm=(value:string)=>{setConfirm(value);setErrors({})};const submit=async(event:FormEvent)=>{event.preventDefault();const next:Errors={},passwordError=validatePassword(password);if(passwordError)next.password=passwordError;if(password!==confirm)next.confirm="كلمتا المرور غير متطابقتين.";if(Object.keys(next).length)return setErrors(next);setBusy(true);setErrors({});const supabase=createClient(),session=await supabase.auth.getSession();if(!session.data.session){setBusy(false);return setErrors({form:"رابط الاستعادة منتهي أو غير صالح. اطلب رابط استعادة جديدًا."})}const result=await supabase.auth.updateUser({password});if(result.error){setBusy(false);return setErrors({form:resetPasswordErrorMessage(result.error)})}await supabase.auth.signOut();router.replace("/login?password=updated");router.refresh()};return <PortalShell><AuthCard eyebrow="تعيين كلمة جديدة" title="اختر كلمة مرور قوية" description="اختر كلمة مختلفة عن كلمة المرور الحالية؛ يجب أن تتكون من 8 أحرف على الأقل وتتضمن حرفًا إنجليزيًا كبيرًا ورقمًا."><form className="portal-form" onSubmit={submit}><PasswordFieldWithVisibilityCheckbox id="reset" label="كلمة المرور الجديدة" value={password} onChange={updatePassword} error={errors.password}/><PasswordFieldWithVisibilityCheckbox id="reset-confirm" label="التأكيد" value={confirm} onChange={updateConfirm} error={errors.confirm} confirm/>{errors.form?<p className="portal-form-error" role="alert">{errors.form}</p>:null}<button className="portal-primary-button" disabled={busy}>{busy?"جارٍ الحفظ...":"حفظ كلمة المرور"}</button></form></AuthCard></PortalShell>}

function TextField({id,label,value,onChange,error,type="text",inputMode,autoComplete,placeholder,dir}:{id:string;label:string;value:string;onChange:(value:string)=>void;error?:string;type?:string;inputMode?:"tel"|"email";autoComplete?:string;placeholder?:string;dir?:"ltr"|"rtl"}){return <div className="portal-field"><label htmlFor={id}>{label}</label><input id={id} type={type} inputMode={inputMode} autoComplete={autoComplete} placeholder={placeholder} dir={dir} value={value} onChange={event=>onChange(event.target.value)}/>{error?<small className="portal-error">{error}</small>:null}</div>}
