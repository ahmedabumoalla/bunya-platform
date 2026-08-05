"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthIdentity } from "@/components/auth/AuthIdentityProvider";
import { validatePassword } from "@/lib/bunya-local";
import { createClient } from "@/lib/supabase/client";

export function DriverChangePassword() {
  const identity = useAuthIdentity();
  const router = useRouter();
  const [form, setForm] = useState({ current: "", password: "", confirm: "" });
  const [show, setShow] = useState({ current: false, password: false, confirm: false });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const passwordError = validatePassword(form.password);
    if (passwordError) return setError(passwordError);
    if (form.password !== form.confirm) return setError("كلمتا المرور الجديدتان غير متطابقتين.");
    if (!identity.authEmail) return setError("لا يوجد بريد مرتبط بحساب السائق.");

    setBusy(true);
    setError("");
    const supabase = createClient();
    const verification = await supabase.auth.signInWithPassword({ email: identity.authEmail, password: form.current });
    if (verification.error) {
      setBusy(false);
      setError("كلمة المرور الحالية غير صحيحة.");
      return;
    }
    const { error: updateError } = await supabase.auth.updateUser({ password: form.password });
    if (updateError) {
      setBusy(false);
      setError("تعذر تحديث كلمة المرور. حاول مرة أخرى.");
      return;
    }
    const { error: profileError } = await supabase
      .from("provider_drivers")
      .update({ must_change_password: false, status: "active", updated_at: new Date().toISOString() })
      .eq("profile_id", identity.profile?.id ?? "");
    if (profileError) {
      setBusy(false);
      setError("تم تغيير كلمة المرور، لكن تعذر تحديث حالة الحساب.");
      return;
    }
    router.replace("/driver");
    router.refresh();
  };

  return <main className="driver-app driver-password-page"><form className="driver-password-card" onSubmit={submit}>
    <div className="driver-logo"><span>ب</span><div><strong>بُنية</strong><small>أول دخول للسائق</small></div></div>
    <h1>غيّر كلمة المرور الأولية</h1><p>اختر كلمة مرور قوية خاصة بك قبل دخول لوحة التوصيلات.</p>
    {([ ["current", "كلمة المرور الحالية"], ["password", "كلمة المرور الجديدة"], ["confirm", "تأكيد الجديدة"] ] as const).map(([key, label]) => <label key={key}><span>{label}</span><input type={show[key] ? "text" : "password"} value={form[key]} onChange={(event) => { setForm((current) => ({ ...current, [key]: event.target.value })); setError(""); }} /><small><input type="checkbox" checked={show[key]} onChange={(event) => setShow((current) => ({ ...current, [key]: event.target.checked }))} /> إظهار الحقل</small></label>)}
    <div className="driver-password-strength"><i style={{ width: `${Math.min(100, form.password.length * 10)}%` }} /><span>{form.password && form.password === form.confirm ? "كلمتا المرور متطابقتان" : "استخدم حرفًا ورقمًا و8 أحرف على الأقل"}</span></div>
    {error ? <p className="driver-error">{error}</p> : null}<button className="driver-primary" disabled={busy}>{busy ? "جارٍ الحفظ..." : "حفظ والدخول للوحة"}</button>
  </form></main>;
}
