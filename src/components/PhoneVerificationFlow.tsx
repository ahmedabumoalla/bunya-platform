"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AuthCard, PortalShell } from "@/components/PortalUI";
import { createClient } from "@/lib/supabase/client";

export function PhoneVerificationFlow({ maskedPhone }: { maskedPhone: string }) {
  const router = useRouter();
  const [otp, setOtp] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const sendCode = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    const supabase = createClient();
    const { data } = await supabase.auth.getUser();
    const user = data.user;

    if (!user) {
      router.replace("/login");
      router.refresh();
      return;
    }
    if (user.phone_confirmed_at) {
      router.replace("/customer");
      router.refresh();
      return;
    }
    if (!user.phone) {
      setBusy(false);
      setError("لا يوجد رقم جوال مرتبط بهذا الحساب.");
      return;
    }

    const result = await supabase.auth.signInWithOtp({
      phone: user.phone,
      options: { shouldCreateUser: false },
    });
    setBusy(false);
    if (result.error) {
      setError("تعذر إرسال الرمز من مزود الرسائل. حاول مجددًا بعد التأكد من إعداد قناة الإرسال.");
      return;
    }
    setSent(true);
    setMessage("تم إرسال رمز التحقق إلى رقم الجوال المرتبط بالحساب.");
  };

  const verify = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (!/^\d{4,10}$/.test(otp)) {
      setError("أدخل رمز التحقق الصحيح.");
      return;
    }

    setBusy(true);
    setError("");
    const supabase = createClient();
    const { data } = await supabase.auth.getUser();
    if (!data.user?.phone) {
      await supabase.auth.signOut();
      router.replace("/login");
      router.refresh();
      return;
    }

    const verified = await supabase.auth.verifyOtp({
      phone: data.user.phone,
      token: otp,
      type: "sms",
    });
    if (verified.error || !verified.data.session) {
      setBusy(false);
      setError("رمز التحقق غير صحيح أو انتهت صلاحيته.");
      return;
    }

    const initialized = await supabase.rpc("initialize_customer_account");
    if (initialized.error) {
      setBusy(false);
      setError("تم توثيق الجوال، لكن تعذر تجهيز حساب العميل. حاول تسجيل الدخول مجددًا.");
      return;
    }

    router.replace("/customer");
    router.refresh();
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
        description={`حسابك موجود، وبقي توثيق الرقم ${maskedPhone} قبل دخول لوحة العميل.`}
      >
        <form className="portal-form" onSubmit={verify}>
          {!sent ? (
            <button className="portal-primary-button" disabled={busy} onClick={() => void sendCode()} type="button">
              {busy ? "جارٍ إرسال الرمز..." : "إرسال رمز التحقق"}
            </button>
          ) : (
            <>
              <div className="portal-field">
                <label htmlFor="phone-verification-otp">رمز التحقق</label>
                <input
                  id="phone-verification-otp"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={otp}
                  onChange={(event) => { setOtp(event.target.value.replace(/\D/g, "")); setError(""); }}
                />
              </div>
              <button className="portal-primary-button" disabled={busy} type="submit">
                {busy ? "جارٍ التحقق..." : "تحقق وادخل إلى الحساب"}
              </button>
              <button disabled={busy} onClick={() => void sendCode()} type="button">إعادة إرسال الرمز</button>
            </>
          )}
          {message ? <p className="portal-form-message">{message}</p> : null}
          {error ? <p className="portal-form-message portal-form-error">{error}</p> : null}
          <button disabled={busy} onClick={() => void signOut()} type="button">تسجيل الخروج</button>
        </form>
      </AuthCard>
    </PortalShell>
  );
}
