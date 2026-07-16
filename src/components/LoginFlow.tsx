"use client";

import type {FormEvent} from "react";
import {useEffect,useState} from "react";
import Link from "next/link";
import {useRouter} from "next/navigation";
import type {ContractorApplication,CustomerRegistration,ProviderApplication} from "@/lib/bunya-types";
import {createPasswordProof,localStorageKeys,normalizeValue,readLocalCollection} from "@/lib/bunya-local";
import {bootstrapDemoAccounts,demoAccountCredentials,ensureDemoAccount,resetDemoAccounts} from "@/lib/demo-accounts";
import type {DemoAccountRole} from "@/lib/demo-account-definitions";
import {authenticateDriver,createRoleSession,writeRoleSession} from "@/lib/driver-storage";
import {AuthCard,PasswordFieldWithVisibilityCheckbox,PortalShell} from "./PortalUI";

type Errors=Record<string,string>;
type LoginRole="customer"|"provider"|"contractor"|"admin";
type AdminRecord={id:string;name?:string;email?:string;username?:string;mobile?:string;passwordProof?:string;active?:boolean;status?:string};

const legacyRoleAccounts=[
  {role:"provider" as const,userId:"provider-modern-materials",identifier:"provider@bunya.example",passwordProof:"3ae64778ed242037f55903dc854de496872436a95811d300124d55c3d86ab5ae",displayName:"شركة مواد البناء الحديثة",username:"modern_materials",email:"provider@bunya.example",phone:"0502489012"},
  {role:"contractor" as const,userId:"ctr-asas",identifier:"info@asas-omran.example",passwordProof:"e4af33fbd14f668564b1f1961056c83bbf1d6d2b7a6ddba017381aea06ad2082",displayName:"شركة أساس العمران للمقاولات",username:"",email:"info@asas-omran.example",phone:"0501148820"},
  {role:"admin" as const,userId:"admin-super",identifier:"admin@bunya.example",passwordProof:"64adbd5037eb4ba923be64e9a2740652c4715ac3e29105c9cc872ad05226c132",displayName:"مدير منصة بُنية",username:"",email:"admin@bunya.example",phone:"0550001000"},
] as const;

const genericFailure="بيانات الدخول غير صحيحة.";
const isDevelopment=process.env.NODE_ENV==="development";

export function LoginFlow(){
  const router=useRouter();
  const [identifier,setIdentifier]=useState("");
  const [password,setPassword]=useState("");
  const [errors,setErrors]=useState<Errors>({});
  const [busy,setBusy]=useState(false);
  const [demoOpen,setDemoOpen]=useState(false);
  const [repairOpen,setRepairOpen]=useState(false);
  const [seedMessage,setSeedMessage]=useState("");

  useEffect(()=>{
    let active=true;
    if(new URLSearchParams(window.location.search).get("reason")==="role")queueMicrotask(()=>{if(active)setErrors({form:isDevelopment?"الدور الحالي غير مصرح له بفتح هذا المسار.":genericFailure})});
    if(!isDevelopment)return()=>{active=false};
    void bootstrapDemoAccounts().catch(()=>{
      if(active)setSeedMessage("بيانات Demo قديمة وتحتاج إصلاحًا.");
    });
    return()=>{active=false};
  },[]);

  const fail=(developmentMessage:string)=>{
    setBusy(false);
    setErrors({form:isDevelopment?developmentMessage:genericFailure});
  };

  const submit=async(event:FormEvent)=>{
    event.preventDefault();
    const next:Errors={};
    if(!identifier.trim())next.identifier="أدخل البريد أو اسم المستخدم أو رقم الجوال.";
    if(!password)next.password="أدخل كلمة المرور.";
    if(Object.keys(next).length){setErrors(next);return}
    setBusy(true);

    try{
      if(isDevelopment)await bootstrapDemoAccounts();
      const proof=await createPasswordProof(password);
      const normalized=normalizeValue(identifier);
      const hasIdentifier=(values:Array<string|undefined>)=>values.some(value=>normalizeValue(value??"")===normalized);

      const customer=readLocalCollection<CustomerRegistration>(localStorageKeys.customers).find(item=>hasIdentifier([item.email,item.username,item.mobile]));
      if(customer){
        if(customer.passwordProof!==proof){fail("كلمة المرور غير صحيحة.");return}
        writeRoleSession(createRoleSession({role:"customer",userId:customer.id,displayName:customer.fullName,username:customer.username,email:customer.email,phone:customer.mobile,status:"active"}));
        finishLogin("customer",router);return;
      }

      const provider=readLocalCollection<ProviderApplication & {passwordProof?:string}>(localStorageKeys.providers).find(item=>hasIdentifier([item.email,item.username,item.mobile]));
      if(provider){
        if(provider.passwordProof!==proof){fail("كلمة المرور غير صحيحة.");return}
        if(provider.status!=="approved"){fail("حساب المزود غير نشط أو ما زال قيد المراجعة.");return}
        writeRoleSession(createRoleSession({role:"provider",userId:provider.id,displayName:provider.companyName,username:provider.username,email:provider.email,phone:provider.mobile,status:provider.status}));
        finishLogin("provider",router);return;
      }

      const contractor=readLocalCollection<ContractorApplication & {username?:string;passwordProof?:string}>(localStorageKeys.contractors).find(item=>hasIdentifier([item.email,item.username,item.mobile]));
      if(contractor){
        if(contractor.passwordProof!==proof){fail("كلمة المرور غير صحيحة.");return}
        if(contractor.status!=="approved"){fail("حساب المقاول غير نشط أو ما زال قيد المراجعة.");return}
        writeRoleSession(createRoleSession({role:"contractor",userId:contractor.id,displayName:contractor.contractorName,username:contractor.username??"",email:contractor.email,phone:contractor.mobile,status:contractor.status}));
        finishLogin("contractor",router);return;
      }

      const driverResult=await authenticateDriver(identifier,password);
      if(driverResult.ok){
        setBusy(false);
        router.push(driverResult.driver.mustChangePassword?"/driver/change-password":"/driver");
        return;
      }
      if(driverResult.code!=="not_found"){fail(driverResult.message);return}

      const legacy=legacyRoleAccounts.find(item=>normalizeValue(item.identifier)===normalized);
      if(legacy){
        if(legacy.passwordProof!==proof){fail("كلمة المرور غير صحيحة.");return}
        writeRoleSession(createRoleSession({role:legacy.role,userId:legacy.userId,displayName:legacy.displayName,username:legacy.username,email:legacy.email,phone:legacy.phone,status:"active"}));
        finishLogin(legacy.role,router);return;
      }

      const admin=readLocalCollection<AdminRecord>("bunya-admin-users").find(item=>hasIdentifier([item.email,item.username,item.mobile]));
      if(admin){
        if(admin.passwordProof!==proof){fail("كلمة المرور غير صحيحة.");return}
        if(admin.active===false){fail("حساب المدير موقوف.");return}
        writeRoleSession(createRoleSession({role:"admin",userId:admin.id,displayName:admin.name??"مدير بُنية",username:admin.username??"",email:admin.email??"",phone:admin.mobile??"",status:admin.status??"active"}));
        finishLogin("admin",router);return;
      }

      fail("الحساب غير موجود في التخزين المحلي.");
    }catch{
      fail("بيانات Demo قديمة وتحتاج إصلاحًا.");
    }
  };

  const quickLogin=async(role:DemoAccountRole)=>{
    setBusy(true);setErrors({});setSeedMessage("");
    try{
      const account=await ensureDemoAccount(role);
      if(!account){fail("تعذر تجهيز الحساب التجريبي. استخدم إصلاح الحسابات التجريبية.");return}
      writeRoleSession(createRoleSession({role:account.role,userId:account.id,displayName:account.displayName,username:account.username,email:account.email,phone:account.mobile,status:account.status}));
      finishLogin(account.role,router);
    }catch{
      fail("تعذر إصلاح بيانات Demo المحلية.");
    }
  };

  const repair=async()=>{
    setBusy(true);setErrors({});
    try{
      const result=await resetDemoAccounts();
      setSeedMessage(result.created||result.repaired?`أصبحت الحسابات التجريبية جاهزة: أُنشئ ${result.created} وأُصلح ${result.repaired}.`:"الحسابات التجريبية سليمة وجاهزة.");
      setRepairOpen(false);setBusy(false);
    }catch{
      setRepairOpen(false);fail("تعذر إصلاح بيانات Demo المحلية.");
    }
  };

  return <PortalShell>
    <AuthCard eyebrow="تسجيل الدخول الموحد" title="مرحبًا بعودتك" description="ادخل إلى لوحة دورك عبر البريد أو اسم المستخدم أو رقم الجوال.">
      <form className="portal-form" onSubmit={submit} noValidate>
        <div className="portal-field">
          <label htmlFor="login-id">البريد الإلكتروني أو اسم المستخدم أو رقم الجوال</label>
          <input id="login-id" autoComplete="username" value={identifier} onChange={event=>{setIdentifier(event.target.value);setErrors({})}} />
          {errors.identifier?<small className="portal-error">{errors.identifier}</small>:null}
        </div>
        <PasswordFieldWithVisibilityCheckbox id="login-password" label="كلمة المرور" value={password} onChange={value=>{setPassword(value);setErrors({})}} error={errors.password}/>
        {errors.form?<p className="portal-form-message portal-form-error">{errors.form}</p>:null}
        <button className="portal-primary-button" disabled={busy} type="submit">{busy?"جارٍ التحقق...":"تسجيل الدخول"}</button>
        <div className="portal-links"><Link href="/forgot-password">نسيت كلمة المرور؟</Link><Link href="/register">إنشاء حساب جديد</Link></div>
      </form>
    </AuthCard>

    {isDevelopment?<section className="portal-demo-accounts">
      <button className="portal-demo-toggle" type="button" aria-expanded={demoOpen} onClick={()=>setDemoOpen(value=>!value)}>حسابات تجريبية <span>{demoOpen?"−":"＋"}</span></button>
      {demoOpen?<div className="portal-demo-content">
        <p>للاختبار المحلي فقط. هذه الأدوات لا تظهر في نسخة الإنتاج.</p>
        <section className="portal-demo-quick" aria-labelledby="demo-quick-title">
          <h3 id="demo-quick-title">دخول سريع للتجربة</h3>
          <div>{demoAccountCredentials.map(account=><button disabled={busy} key={account.role} type="button" onClick={()=>void quickLogin(account.role)}>الدخول ك{account.role==="customer"?"عميل":account.role==="provider"?"مزود":"مقاول"}</button>)}</div>
        </section>
        <div className="portal-demo-grid">{demoAccountCredentials.map(account=><article key={account.role}>
          <header><strong>{account.label}</strong><small>{account.route}</small></header>
          <dl><div><dt>البريد</dt><dd dir="ltr">{account.email}</dd></div><div><dt>المستخدم</dt><dd dir="ltr">{account.username}</dd></div><div><dt>الجوال</dt><dd dir="ltr">{account.mobile}</dd></div><div><dt>كلمة المرور</dt><dd dir="ltr">{account.password}</dd></div></dl>
          <button type="button" onClick={()=>{setIdentifier(account.email);setPassword(account.password);setErrors({});window.scrollTo({top:0,behavior:"smooth"})}}>تعبئة البيانات</button>
        </article>)}</div>
        {seedMessage?<p className="portal-demo-message" role="status">{seedMessage}</p>:null}
        <button className="portal-demo-reset" type="button" onClick={()=>setRepairOpen(true)}>إصلاح الحسابات التجريبية</button>
      </div>:null}
      {repairOpen?<div className="portal-demo-backdrop" onMouseDown={()=>setRepairOpen(false)}><section role="dialog" aria-modal="true" aria-labelledby="demo-repair-title" onMouseDown={event=>event.stopPropagation()}>
        <h2 id="demo-repair-title">إصلاح الحسابات التجريبية؟</h2>
        <p>سيُنشئ أو يصلح الحسابات الثلاثة فقط دون حذف الإدارة أو المستخدمين أو الطلبات.</p>
        <footer><button type="button" onClick={()=>setRepairOpen(false)}>تراجع</button><button disabled={busy} type="button" onClick={()=>void repair()}>تأكيد الإصلاح</button></footer>
      </section></div>:null}
    </section>:null}
  </PortalShell>;
}

function finishLogin(role:LoginRole,router:ReturnType<typeof useRouter>){
  const roots={customer:"/customer",provider:"/merchant",contractor:"/contractor",admin:"/admin"} as const;
  const queryReturnTo=new URLSearchParams(window.location.search).get("returnTo");
  const returnTo=queryReturnTo??localStorage.getItem("bunya-auth-return-to");
  localStorage.removeItem("bunya-auth-return-to");
  const root=roots[role];
  const allowed=returnTo===root||Boolean(returnTo?.startsWith(`${root}/`));
  router.push(allowed&&returnTo&&!returnTo.startsWith("//")?returnTo:root);
}
