"use client";
import { useEffect, useState } from "react";
import "./impersonation.css";

export function ImpersonationBanner({ present }: { present: boolean }) {
  const [info, setInfo] = useState<{ name?: string; expiresAt?: number; expired?: boolean }>({});
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => {
    const refresh = () => {
      const active = document.cookie.split("; ").includes("bunya-maintenance-active=1");
      if (active !== present) { window.location.reload(); return; }
      if (present) fetch("/api/maintenance", { cache: "no-store" }).then(response => response.json()).then(setInfo).catch(() => setError("تعذر تحديث حالة جلسة الصيانة."));
    };
    refresh();
    window.addEventListener("focus", refresh);
    const interval = present ? window.setInterval(refresh, 60_000) : undefined;
    return () => { window.removeEventListener("focus", refresh); if (interval) clearInterval(interval); };
  }, [present]);
  if (!present) return null;
  async function exit() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/maintenance", { method: "DELETE" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message);
      window.location.assign(result.redirectTo);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "تعذر الرجوع للإدارة."); setBusy(false); }
  }
  return <aside className="maintenance-banner" aria-label="جلسة الدخول بالنيابة">
    <div><strong>{info.expired ? "انتهت جلسة الصيانة" : `دخول بالنيابة${info.name ? ` · ${info.name}` : ""}`}</strong>
      <span>{info.expired ? "ارجع إلى حساب الإدارة للمتابعة." : "الإجراءات تُنفّذ على حساب المستخدم وتُوثّق باسم السوبر أدمن في سجل التدقيق."}
        {info.expiresAt && !info.expired ? ` تنتهي ${new Date(info.expiresAt).toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" })}.` : ""}</span>
      {error ? <span role="alert">{error}</span> : null}</div>
    <button type="button" disabled={busy} onClick={exit}>{busy ? "جارٍ الرجوع…" : "إنهاء الصيانة والرجوع للإدارة"}</button>
  </aside>;
}
