"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import Link from "next/link";
import { isAppRole, routeForRole } from "@/lib/auth/types";
import { createClient } from "@/lib/supabase/client";
import { AuthCard, PasswordFieldWithVisibilityCheckbox, PortalShell } from "./PortalUI";

type Errors = Record<string, string>;

const identityErrors: Record<string, string> = {
  missing_profile: "الحساب موجود، لكن ملف المستخدم غير مكتمل. تواصل مع إدارة المنصة.",
  inactive_profile: "ملف المستخدم موقوف. تواصل مع إدارة المنصة.",
  missing_role: "لا يوجد دور نشط مرتبط بهذا الحساب. تواصل مع إدارة المنصة.",
  missing_primary_role: "لا يوجد دور أساسي محدد لهذا الحساب. تواصل مع إدارة المنصة.",
  role_not_ready: "الدور موجود، لكن ارتباط البوابة غير مكتمل أو غير نشط.",
  invalid_callback: "رابط المصادقة غير صالح أو انتهت صلاحيته. حاول مرة أخرى.",
};

function normalizeLoginEmail(value: string) {
  return value
    .normalize("NFKC")
    .replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/gu, "")
    .trim()
    .toLowerCase();
}

function loginErrorMessage(error: { code?: string; status?: number }) {
  if (error.code === "invalid_credentials") return "لم تقبل خدمة تسجيل الدخول البريد أو كلمة المرور. أعد كتابتهما يدويًا أو استخدم استعادة كلمة المرور.";
  if (error.code === "email_not_confirmed") return "البريد الإلكتروني غير مؤكد بعد. افتح رسالة التأكيد ثم حاول مجددًا.";
  if (error.code === "user_banned") return "الحساب موقوف حاليًا. تواصل مع إدارة المنصة.";
  if (error.code === "over_request_rate_limit" || error.status === 429) return "تمت محاولات كثيرة خلال وقت قصير. انتظر دقيقة ثم حاول مرة واحدة.";
  if (error.code === "request_timeout") return "انتهت مهلة الاتصال بخدمة تسجيل الدخول. تحقق من الشبكة ثم حاول مجددًا.";
  return "تعذر الاتصال بخدمة تسجيل الدخول حاليًا. بياناتك لم تُرفض؛ حاول مرة أخرى بعد قليل.";
}

export function LoginFlow({ initialError }: { initialError?: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Errors>(
    initialError ? { form: identityErrors[initialError] ?? "تعذر إكمال تسجيل الدخول." } : {},
  );
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<"credentials" | "account">("credentials");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;

    const submitted = new FormData(event.currentTarget);
    const cleanEmail = normalizeLoginEmail(String(submitted.get("email") ?? email));
    const submittedPassword = String(submitted.get("password") ?? password);
    const next: Errors = {};
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      next.email = "أدخل بريدًا إلكترونيًا صحيحًا.";
    }
    if (!submittedPassword) next.password = "أدخل كلمة المرور.";
    if (Object.keys(next).length) {
      setErrors(next);
      return;
    }

    setBusy(true);
    setStage("credentials");
    setErrors({});
    const supabase = createClient();
    let signInResult;
    try {
      signInResult = await supabase.auth.signInWithPassword({ email: cleanEmail, password: submittedPassword });
    } catch {
      setBusy(false);
      setErrors({ form: "تعذر الوصول إلى خدمة تسجيل الدخول. تحقق من اتصال الإنترنت ثم حاول مجددًا." });
      return;
    }
    const { data, error } = signInResult;

    if (error || !data.user) {
      setBusy(false);
      setErrors({ form: error ? loginErrorMessage(error) : "تعذر إنشاء جلسة تسجيل الدخول. حاول مجددًا." });
      return;
    }

    try {
      setStage("account");
      const [profileResult, rolesResult] = await Promise.all([
        supabase.from("profiles").select("mobile,is_active,must_change_password").eq("id", data.user.id).maybeSingle(),
        supabase.from("user_roles").select("role,is_primary").eq("profile_id", data.user.id).is("revoked_at", null),
      ]);
      if (profileResult.error || rolesResult.error) throw new Error("identity_lookup_failed");

      const profile = profileResult.data;
      const roles = (rolesResult.data ?? []).filter((row) => isAppRole(row.role));
      const primaryValue = roles.find((row) => row.is_primary)?.role;
      const primaryRole = isAppRole(primaryValue) ? primaryValue : null;
      const needsPhone = !(data.user.phone && data.user.phone_confirmed_at) && Boolean(profile?.is_active) &&
        (roles.some((row) => row.role === "customer" || row.role === "provider") || roles.length === 0);

      if (needsPhone) {
        window.location.replace("/verify-phone");
        return;
      }
      if (!profile || !profile.is_active || !primaryRole) {
        await supabase.auth.signOut();
        setBusy(false);
        setErrors({ form: !profile ? identityErrors.missing_profile : !profile.is_active ? identityErrors.inactive_profile : roles.length ? identityErrors.missing_primary_role : identityErrors.missing_role });
        return;
      }

      if (profile.must_change_password) {
        window.location.replace("/account/change-password");
        return;
      }
      const root = routeForRole(primaryRole);
      const returnTo = new URLSearchParams(window.location.search).get("returnTo");
      const safeReturnTo =
        returnTo &&
        !returnTo.startsWith("//") &&
        (returnTo === root || returnTo.startsWith(`${root}/`))
          ? returnTo
          : root;
      window.location.replace(safeReturnTo);
    } catch {
      await supabase.auth.signOut();
      setBusy(false);
      setErrors({ form: "تعذر قراءة ملف الحساب وأدواره. حاول مرة أخرى." });
    }
  };

  return (
    <PortalShell>
      <AuthCard
        eyebrow="تسجيل الدخول الموحد"
        title="مرحبًا بعودتك"
        description="ادخل إلى لوحة دورك عبر البريد الإلكتروني وكلمة المرور."
      >
        <form className="portal-form" onSubmit={submit} noValidate>
          <div className="portal-field">
            <label htmlFor="login-email">البريد الإلكتروني</label>
            <input
              id="login-email"
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                setErrors({});
              }}
            />
            {errors.email ? <small className="portal-error">{errors.email}</small> : null}
          </div>
          <PasswordFieldWithVisibilityCheckbox
            id="login-password"
            name="password"
            label="كلمة المرور"
            value={password}
            onChange={(value) => {
              setPassword(value);
              setErrors({});
            }}
            error={errors.password}
          />
          {errors.form ? <p className="portal-form-message portal-form-error">{errors.form}</p> : null}
          <button className="portal-primary-button" disabled={busy} type="submit">
            {busy ? stage === "credentials" ? "جارٍ التحقق من بيانات الدخول..." : "تم التحقق، جارٍ فتح لوحة التحكم..." : "تسجيل الدخول"}
          </button>
          <div className="portal-links">
            <Link href="/forgot-password">نسيت كلمة المرور؟</Link>
            <Link href="/register">إنشاء حساب جديد</Link>
          </div>
        </form>
      </AuthCard>
    </PortalShell>
  );
}
