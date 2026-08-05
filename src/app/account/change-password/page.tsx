"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PortalShell, PasswordFieldWithVisibilityCheckbox } from "@/components/PortalUI";

export default function ChangePasswordPage() {
  const router=useRouter(); const [password,setPassword]=useState(""); const [confirm,setConfirm]=useState(""); const [message,setMessage]=useState(""); const [busy,setBusy]=useState(false);
  const submit=async(event:FormEvent)=>{event.preventDefault();setMessage("");if(password!==confirm)return setMessage("كلمتا المرور غير متطابقتين.");if(password.length<12||!/[A-Z]/.test(password)||!/[a-z]/.test(password)||!/[0-9]/.test(password)||!/[!@#$%*\-_+]/.test(password))return setMessage("استخدم 12 حرفًا على الأقل تشمل حرفًا كبيرًا وصغيرًا ورقمًا ورمزًا.");setBusy(true);const supabase=createClient();const updated=await supabase.auth.updateUser({password});if(updated.error){setBusy(false);return setMessage("تعذر تغيير كلمة المرور. حاول مجددًا.")}const completed=await supabase.rpc("complete_temporary_password_change");if(completed.error){setBusy(false);return setMessage("تغيرت كلمة المرور، لكن تعذر إكمال تفعيل الحساب. تواصل مع الإدارة.")}await supabase.auth.refreshSession();router.replace("/login");router.refresh()};
  return <PortalShell><section className="portal-card application-card"><header className="portal-heading"><p>حماية الحساب</p><h1>تغيير كلمة المرور المؤقتة</h1><span>لا يمكن استخدام لوحة الحساب قبل اختيار كلمة مرور دائمة.</span></header><form className="portal-form" onSubmit={submit}><PasswordFieldWithVisibilityCheckbox id="new-password" label="كلمة المرور الجديدة" value={password} onChange={setPassword}/><PasswordFieldWithVisibilityCheckbox id="confirm-password" label="تأكيد كلمة المرور" value={confirm} onChange={setConfirm}/>{message?<p className="portal-form-error">{message}</p>:null}<button className="portal-primary-button" disabled={busy}>{busy?"جارٍ الحفظ...":"حفظ كلمة المرور"}</button></form></section></PortalShell>;
}
