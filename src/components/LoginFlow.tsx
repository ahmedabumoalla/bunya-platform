"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import Link from "next/link";
import { quoteReturnToQuery, resolveSafeReturnTo } from "@/lib/auth/return-to";
import { normalizeSaudiPhone } from "@/lib/auth/phone-verification";
import { isAppRole } from "@/lib/auth/types";
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

const appleSignInEnabled = process.env.NEXT_PUBLIC_APPLE_SIGN_IN_ENABLED === "true";

function normalizeLoginIdentifier(value: string) {
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

export function LoginFlow({ initialError, returnTo }: { initialError?: string; returnTo?: string }) {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Errors>(
    initialError ? { form: identityErrors[initialError] ?? "تعذر إكمال تسجيل الدخول." } : {},
  );
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<"credentials" | "account">("credentials");

  const startAppleSignIn = async () => {
    if (busy || !appleSignInEnabled) return;
    setBusy(true);
    setStage("credentials");
    setErrors({});

    const callback = new URL("/auth/callback", window.location.origin);
    callback.searchParams.set("next", "/customer");
    if (returnTo) callback.searchParams.set("returnTo", returnTo);

    try {
      const { error } = await createClient().auth.signInWithOAuth({
        provider: "apple",
        options: {
          redirectTo: callback.toString(),
          scopes: "name email",
        },
      });
      if (error) throw error;
    } catch {
      setBusy(false);
      setErrors({ form: "تعذر بدء تسجيل الدخول عبر Apple. حاول مجددًا بعد قليل." });
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;

    const submitted = new FormData(event.currentTarget);
    const cleanIdentifier = normalizeLoginIdentifier(String(submitted.get("identifier") ?? identifier));
    const isEmail = cleanIdentifier.includes("@");
    const cleanPhone = isEmail ? null : normalizeSaudiPhone(cleanIdentifier);
    const submittedPassword = String(submitted.get("password") ?? password);
    const next: Errors = {};
    if ((isEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanIdentifier)) || (!isEmail && !cleanPhone)) {
      next.identifier = "أدخل بريدًا إلكترونيًا صحيحًا أو رقم جوال سعوديًا.";
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
      signInResult = await supabase.auth.signInWithPassword(
        isEmail
          ? { email: cleanIdentifier, password: submittedPassword }
          : { phone: cleanPhone!, password: submittedPassword },
      );
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
      const returnTo = new URLSearchParams(window.location.search).get("returnTo");

      if (needsPhone) {
        window.location.replace(`/verify-phone${quoteReturnToQuery(returnTo)}`);
        return;
      }
      if (!profile || !profile.is_active || !primaryRole) {
        await supabase.auth.signOut();
        setBusy(false);
        setErrors({ form: !profile ? identityErrors.missing_profile : !profile.is_active ? identityErrors.inactive_profile : roles.length ? identityErrors.missing_primary_role : identityErrors.missing_role });
        return;
      }

      if (primaryRole === "driver") {
        await supabase.rpc("mark_driver_activity");
      }

      if (profile.must_change_password) {
        window.location.replace("/account/change-password");
        return;
      }
      const safeReturnTo = resolveSafeReturnTo(primaryRole, returnTo);
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
        description="ادخل إلى لوحة دورك عبر البريد الإلكتروني أو رقم الجوال وكلمة المرور."
      >
        <form className="portal-form" onSubmit={submit} noValidate>
          <div className="portal-field">
            <label htmlFor="login-identifier">البريد الإلكتروني أو رقم الجوال</label>
            <input
              id="login-identifier"
              name="identifier"
              type="text"
              inputMode="text"
              autoComplete="username"
              dir="ltr"
              value={identifier}
              onChange={(event) => {
                setIdentifier(event.target.value);
                setErrors({});
              }}
            />
            {errors.identifier ? <small className="portal-error">{errors.identifier}</small> : null}
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
          {appleSignInEnabled ? (
            <>
              <div className="portal-oauth-divider" aria-hidden="true"><span>أو</span></div>
              <button className="portal-apple-button" disabled={busy} type="button" onClick={startAppleSignIn}>
                <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
                  <path d="M16.37 12.15c.02 2.36 2.07 3.15 2.09 3.16-.02.06-.33 1.14-1.08 2.25-.65.96-1.33 1.91-2.39 1.93-1.04.02-1.38-.62-2.58-.62-1.19 0-1.57.6-2.55.64-1.02.04-1.8-1.03-2.46-1.99-1.34-1.94-2.36-5.48-.99-7.87a3.82 3.82 0 0 1 3.24-1.97c1.01-.02 1.97.68 2.58.68.61 0 1.76-.84 2.96-.72.51.02 1.93.2 2.84 1.54-.07.04-1.7.99-1.68 2.93ZM14.4 6.37c.54-.65.9-1.56.8-2.46-.78.03-1.73.52-2.29 1.17-.5.58-.94 1.5-.82 2.38.87.07 1.76-.44 2.31-1.09Z" />
                </svg>
                <span>المتابعة باستخدام Apple</span>
              </button>
            </>
          ) : null}
          <div className="portal-links">
            <Link href="/forgot-password">نسيت كلمة المرور؟</Link>
            <Link href={`/register${quoteReturnToQuery(returnTo)}`}>إنشاء حساب جديد</Link>
          </div>
        </form>
      </AuthCard>
    </PortalShell>
  );
}
