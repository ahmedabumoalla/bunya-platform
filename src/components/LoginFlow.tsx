"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { clearLegacyAuthStorage } from "@/lib/auth/legacy-cleanup";
import { resolveAuthIdentity } from "@/lib/auth/resolve-identity";
import { routeForRole } from "@/lib/auth/types";
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

export function LoginFlow({ initialError }: { initialError?: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Errors>(
    initialError ? { form: identityErrors[initialError] ?? "تعذر إكمال تسجيل الدخول." } : {},
  );
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;

    const next: Errors = {};
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      next.email = "أدخل بريدًا إلكترونيًا صحيحًا.";
    }
    if (!password) next.password = "أدخل كلمة المرور.";
    if (Object.keys(next).length) {
      setErrors(next);
      return;
    }

    setBusy(true);
    setErrors({});
    const supabase = createClient();
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });

    if (error || !data.user) {
      setBusy(false);
      setErrors({ form: "البريد الإلكتروني أو كلمة المرور غير صحيحة." });
      return;
    }

    try {
      const identity = await resolveAuthIdentity(supabase, data.user);
      if (identity.status !== "ready" || !identity.primaryRole) {
        await supabase.auth.signOut();
        setBusy(false);
        setErrors({ form: identityErrors[identity.status] ?? "تعذر تحديد بوابة الحساب." });
        return;
      }

      clearLegacyAuthStorage();
      const root = routeForRole(identity.primaryRole);
      const returnTo = new URLSearchParams(window.location.search).get("returnTo");
      const safeReturnTo =
        returnTo &&
        !returnTo.startsWith("//") &&
        (returnTo === root || returnTo.startsWith(`${root}/`))
          ? returnTo
          : root;
      window.localStorage.removeItem("bunya-auth-return-to");
      router.replace(safeReturnTo);
      router.refresh();
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
            {busy ? "جارٍ التحقق..." : "تسجيل الدخول"}
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
