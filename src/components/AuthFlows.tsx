"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { validatePassword } from "@/lib/bunya-local";
import { getSiteUrl } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/client";
import {
  ApplicationSuccessState,
  AuthCard,
  PasswordFieldWithVisibilityCheckbox,
  PortalShell,
} from "./PortalUI";

type Errors = Record<string, string>;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const mobilePattern = /^(?:\+?966|0)?5\d{8}$/;

export function RegisterFlow() {
  const router = useRouter();
  const [form, setForm] = useState({
    fullName: "",
    mobile: "",
    email: "",
    username: "",
    password: "",
    confirmPassword: "",
  });
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [confirmationRequired, setConfirmationRequired] = useState(false);
  const update = (key: keyof typeof form, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors({});
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;

    const next: Errors = {};
    if (form.fullName.trim().length < 3) next.fullName = "أدخل الاسم الكامل بشكل صحيح.";
    if (!mobilePattern.test(form.mobile.replace(/\s/g, ""))) {
      next.mobile = "أدخل رقم جوال سعوديًا صحيحًا.";
    }
    if (!emailPattern.test(form.email.trim())) next.email = "أدخل بريدًا إلكترونيًا صحيحًا.";
    if (form.username.trim().length < 4) next.username = "اسم المستخدم يجب أن يكون 4 أحرف على الأقل.";
    const passwordError = validatePassword(form.password);
    if (passwordError) next.password = passwordError;
    if (form.password !== form.confirmPassword) next.confirmPassword = "كلمتا المرور غير متطابقتين.";
    if (Object.keys(next).length) {
      setErrors(next);
      return;
    }

    setBusy(true);
    const supabase = createClient();
    const { data, error } = await supabase.auth.signUp({
      email: form.email.trim().toLowerCase(),
      password: form.password,
      options: {
        emailRedirectTo: `${getSiteUrl()}/auth/callback?next=/customer`,
        data: {
          full_name: form.fullName.trim(),
          mobile: form.mobile.trim(),
          username: form.username.trim(),
        },
      },
    });

    if (error || !data.user || data.user.identities?.length === 0) {
      setBusy(false);
      setErrors({ form: registrationError(error?.message) });
      return;
    }

    if (!data.session) {
      setBusy(false);
      setConfirmationRequired(true);
      return;
    }

    const { error: initializeError } = await supabase.rpc("initialize_customer_account");
    if (initializeError) {
      await supabase.auth.signOut();
      setBusy(false);
      setErrors({ form: "تم إنشاء الحساب، لكن تعذر تهيئة ملف العميل. تواصل مع إدارة المنصة." });
      return;
    }

    router.replace("/customer");
    router.refresh();
  };

  if (confirmationRequired) {
    return (
      <PortalShell>
        <ApplicationSuccessState
          title="تحقق من بريدك الإلكتروني"
          message="أرسلنا رابط تأكيد الحساب. بعد فتحه سيُهيأ حساب العميل وتنتقل إلى بوابتك."
          actionHref="/login"
          actionLabel="العودة لتسجيل الدخول"
        />
      </PortalShell>
    );
  }

  return (
    <PortalShell>
      <AuthCard eyebrow="حساب جديد" title="انضم إلى بُنية" description="أنشئ حساب عميل لمتابعة تجربة المنصة.">
        <form className="portal-form portal-form-two" onSubmit={submit} noValidate>
          <TextField id="register-name" label="الاسم الكامل" value={form.fullName} onChange={(v) => update("fullName", v)} error={errors.fullName} />
          <TextField id="register-mobile" label="رقم الجوال" value={form.mobile} onChange={(v) => update("mobile", v)} error={errors.mobile} inputMode="tel" />
          <TextField id="register-email" label="البريد الإلكتروني" value={form.email} onChange={(v) => update("email", v)} error={errors.email} type="email" />
          <TextField id="register-user" label="اسم المستخدم" value={form.username} onChange={(v) => update("username", v)} error={errors.username} />
          <PasswordFieldWithVisibilityCheckbox id="register-password" label="كلمة المرور" value={form.password} onChange={(v) => update("password", v)} error={errors.password} />
          <PasswordFieldWithVisibilityCheckbox id="register-confirm" label="تأكيد كلمة المرور" value={form.confirmPassword} onChange={(v) => update("confirmPassword", v)} error={errors.confirmPassword} confirm />
          {errors.form ? <p className="portal-form-message portal-form-error portal-full">{errors.form}</p> : null}
          <button className="portal-primary-button portal-full" disabled={busy} type="submit">{busy ? "جارٍ إنشاء الحساب..." : "إنشاء الحساب والمتابعة"}</button>
          <p className="portal-auth-note portal-full">لديك حساب؟ <Link href="/login">سجل الدخول</Link></p>
        </form>
      </AuthCard>
    </PortalShell>
  );
}

export function ForgotPasswordFlow() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const clean = email.trim().toLowerCase();
    if (!emailPattern.test(clean)) {
      setError("أدخل بريدًا إلكترونيًا صحيحًا.");
      return;
    }

    setBusy(true);
    const supabase = createClient();
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(clean, {
      redirectTo: `${getSiteUrl()}/auth/callback?next=/reset-password`,
    });
    setBusy(false);
    if (resetError) {
      setError("تعذر إرسال رابط الاستعادة الآن. حاول لاحقًا.");
      return;
    }
    setSuccess(true);
  };

  if (success) {
    return (
      <PortalShell>
        <ApplicationSuccessState
          title="تحقق من بريدك الإلكتروني"
          message="إذا كان البريد مرتبطًا بحساب، فسيصلك رابط آمن لتعيين كلمة مرور جديدة."
          actionHref="/login"
          actionLabel="العودة لتسجيل الدخول"
        />
      </PortalShell>
    );
  }

  return (
    <PortalShell>
      <AuthCard eyebrow="استعادة الوصول" title="نسيت كلمة المرور؟" description="سنرسل رابط استعادة آمنًا إلى بريدك المسجل.">
        <form className="portal-form" onSubmit={submit}>
          <TextField id="forgot-email" label="البريد الإلكتروني" value={email} onChange={(value) => { setEmail(value); setError(""); }} error={error} type="email" inputMode="email" />
          <button className="portal-primary-button" disabled={busy} type="submit">{busy ? "جارٍ الإرسال..." : "إرسال رابط الاستعادة"}</button>
          <p className="portal-auth-note"><Link href="/login">العودة لتسجيل الدخول</Link></p>
        </form>
      </AuthCard>
    </PortalShell>
  );
}

export function ResetPasswordFlow() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const next: Errors = {};
    const passwordError = validatePassword(password);
    if (passwordError) next.password = passwordError;
    if (password !== confirm) next.confirm = "كلمتا المرور غير متطابقتين.";
    if (Object.keys(next).length) {
      setErrors(next);
      return;
    }

    setBusy(true);
    const supabase = createClient();
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) {
      setBusy(false);
      setErrors({ form: "رابط الاستعادة غير صالح أو انتهت صلاحيته. اطلب رابطًا جديدًا." });
      return;
    }

    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setBusy(false);
      setErrors({ form: "تعذر تحديث كلمة المرور. اطلب رابط استعادة جديدًا وحاول مرة أخرى." });
      return;
    }

    await supabase.auth.signOut();
    router.replace("/login?password=updated");
    router.refresh();
  };

  return (
    <PortalShell>
      <AuthCard eyebrow="تعيين كلمة جديدة" title="اختر كلمة مرور قوية" description="سيتم تحديث كلمة المرور بأمان في Supabase Auth.">
        <form className="portal-form" onSubmit={submit}>
          <PasswordFieldWithVisibilityCheckbox id="reset-password" label="كلمة المرور الجديدة" value={password} onChange={(v) => { setPassword(v); setErrors({}); }} error={errors.password} />
          <PasswordFieldWithVisibilityCheckbox id="reset-confirm" label="تأكيد كلمة المرور الجديدة" value={confirm} onChange={(v) => { setConfirm(v); setErrors({}); }} error={errors.confirm} confirm />
          {errors.form ? <p className="portal-form-message portal-form-error">{errors.form}</p> : null}
          <button className="portal-primary-button" disabled={busy} type="submit">{busy ? "جارٍ الحفظ..." : "حفظ والعودة لتسجيل الدخول"}</button>
        </form>
      </AuthCard>
    </PortalShell>
  );
}

function TextField({
  id,
  label,
  value,
  onChange,
  error,
  type = "text",
  inputMode,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  type?: string;
  inputMode?: "tel" | "email";
}) {
  return (
    <div className="portal-field">
      <label htmlFor={id}>{label}</label>
      <input id={id} type={type} inputMode={inputMode} value={value} onChange={(event) => onChange(event.target.value)} />
      {error ? <small className="portal-error">{error}</small> : null}
    </div>
  );
}

function registrationError(message?: string) {
  if (message?.toLowerCase().includes("already")) return "البريد الإلكتروني مستخدم بالفعل.";
  if (message?.toLowerCase().includes("rate")) return "محاولات كثيرة. انتظر قليلًا ثم أعد المحاولة.";
  return "تعذر إنشاء الحساب. راجع البيانات وحاول مرة أخرى.";
}
