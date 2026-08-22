"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { maskSaudiPhone, normalizeSaudiPhone } from "@/lib/auth/phone-verification";
import { createClient } from "@/lib/supabase/client";
import { AuthCard, PortalShell } from "@/components/PortalUI";

type ApiResponse = { message?: string; redirectTo?: string; phone?: string };

export function PhoneVerificationFlow() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [requestedPhone, setRequestedPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const requestCode = async (event?: FormEvent) => {
    event?.preventDefault();
    if (busy) return;
    const normalized = normalizeSaudiPhone(phone);
    if (!normalized) {
      setError("أدخل رقم جوال سعوديًا صحيحًا، مثل 05xxxxxxxx.");
      return;
    }

    setBusy(true);
    setError("");
    setMessage("");
    const response = await fetch("/api/auth/phone-verification/request", {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({ phone: normalized }),
    });
    const body = (await response.json().catch(() => ({}))) as ApiResponse;
    setBusy(false);
    if (!response.ok) {
      setError(body.message || "تعذر إرسال رمز التحقق. حاول مجددًا.");
      return;
    }

    setRequestedPhone(body.phone || normalized);
    setStep("otp");
    setOtp("");
    setMessage(body.message || "أُرسل رمز التحقق عبر واتساب.");
  };

  const verify = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (!/^\d{6}$/.test(otp)) {
      setError("أدخل رمز التحقق المكوّن من 6 أرقام.");
      return;
    }

    setBusy(true);
    setError("");
    const response = await fetch("/api/auth/phone-verification/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: otp }),
    });
    const body = (await response.json().catch(() => ({}))) as ApiResponse;
    setBusy(false);
    if (!response.ok || !body.redirectTo) {
      setError(body.message || "الرمز غير صحيح أو انتهت صلاحيته.");
      return;
    }

    router.replace(body.redirectTo);
    router.refresh();
  };

  const editPhone = () => {
    setStep("phone");
    setOtp("");
    setMessage("");
    setError("");
  };

  const signOut = async () => {
    await createClient().auth.signOut();
    router.replace("/login");
    router.refresh();
  };

  return (
    <PortalShell>
      <AuthCard
        eyebrow="إكمال تفعيل الحساب"
        title="وثّق رقم الجوال"
        description={step === "phone"
          ? "اكتب رقم الجوال الذي تريد اعتماده. لن يُحفظ الرقم إلا بعد إدخال رمز التحقق الصحيح."
          : `أرسلنا رمزًا عبر واتساب إلى الرقم ${maskSaudiPhone(requestedPhone)}.`}
      >
        {step === "phone" ? (
          <form className="portal-form" onSubmit={requestCode} noValidate>
            <div className="portal-field">
              <label htmlFor="phone-verification-number">رقم الجوال</label>
              <input
                id="phone-verification-number"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                dir="ltr"
                placeholder="05xxxxxxxx"
                value={phone}
                onChange={(event) => { setPhone(event.target.value); setError(""); }}
              />
              <small>تأكد أن الرقم مفعّل على واتساب ويمكنك الوصول إليه الآن.</small>
            </div>
            <button className="portal-primary-button" disabled={busy} type="submit">
              {busy ? "جارٍ التحقق والإرسال..." : "إرسال رمز التحقق"}
            </button>
            {error ? <p className="portal-form-message portal-form-error" role="alert">{error}</p> : null}
            <button disabled={busy} onClick={() => void signOut()} type="button">تسجيل الخروج</button>
          </form>
        ) : (
          <form className="portal-form" onSubmit={verify} noValidate>
            <div className="portal-field">
              <label htmlFor="phone-verification-otp">رمز التحقق</label>
              <input
                id="phone-verification-otp"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={otp}
                onChange={(event) => { setOtp(event.target.value.replace(/\D/g, "")); setError(""); }}
              />
            </div>
            <button className="portal-primary-button" disabled={busy} type="submit">
              {busy ? "جارٍ التحقق..." : "تحقق وادخل إلى الحساب"}
            </button>
            <button disabled={busy} onClick={() => void requestCode()} type="button">إعادة إرسال الرمز</button>
            <button disabled={busy} onClick={editPhone} type="button">تعديل رقم الجوال</button>
            {message ? <p className="portal-form-message">{message}</p> : null}
            {error ? <p className="portal-form-message portal-form-error" role="alert">{error}</p> : null}
            <button disabled={busy} onClick={() => void signOut()} type="button">تسجيل الخروج</button>
          </form>
        )}
      </AuthCard>
    </PortalShell>
  );
}
