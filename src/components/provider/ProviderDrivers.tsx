"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";

type Driver = {
  id: string;
  full_name: string;
  mobile: string;
  email: string;
  username: string;
  status: "active" | "suspended" | "must_change_password";
  must_change_password: boolean;
  internal_notes: string | null;
  last_active_at: string | null;
  created_at: string;
  updated_at: string;
};

type Credentials = {
  email: string;
  username: string;
  temporaryPassword: string;
  expiresAt: string;
};

const statusLabels: Record<Driver["status"], string> = {
  active: "نشط",
  suspended: "موقوف",
  must_change_password: "بانتظار تغيير كلمة المرور",
};

const statusClasses: Record<Driver["status"], string> = {
  active: "provider-status-success",
  suspended: "provider-status-danger",
  must_change_password: "provider-status-warning",
};

export function ProviderDriversManager() {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");

  const load = async () => {
    setLoading(true);
    const result = await createClient().from("provider_drivers")
      .select("id,full_name,mobile,email,username,status,must_change_password,internal_notes,last_active_at,created_at,updated_at")
      .order("created_at", { ascending: false });
    setLoading(false);
    if (result.error) setError("تعذر تحميل السائقين. تحقق من الاتصال ثم أعد المحاولة.");
    else {
      setDrivers((result.data ?? []) as Driver[]);
      setError("");
    }
  };

  useEffect(() => {
    let active = true;
    void createClient().from("provider_drivers")
      .select("id,full_name,mobile,email,username,status,must_change_password,internal_notes,last_active_at,created_at,updated_at")
      .order("created_at", { ascending: false })
      .then((result) => {
        if (!active) return;
        setLoading(false);
        if (result.error) setError("تعذر تحميل السائقين. تحقق من الاتصال ثم أعد المحاولة.");
        else setDrivers((result.data ?? []) as Driver[]);
      });
    return () => { active = false; };
  }, []);

  const counts = useMemo(() => ({
    all: drivers.length,
    active: drivers.filter((driver) => driver.status === "active").length,
    pending: drivers.filter((driver) => driver.status === "must_change_password").length,
  }), [drivers]);

  const changeStatus = async (driver: Driver) => {
    const status = driver.status === "suspended" ? "active" : "suspended";
    setBusyId(driver.id);
    setError("");
    const response = await fetch("/api/provider/drivers", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: driver.id, status }),
    });
    const result = await response.json() as { error?: string };
    setBusyId("");
    if (!response.ok) return setError(result.error ?? "تعذر تحديث حالة السائق.");
    await load();
  };

  return <section className="provider-page-stack">
    <header className="provider-page-header">
      <div><p>إدارة فريق التوصيل</p><h2>السائقون</h2><span>أنشئ حسابات السائقين، تابع جاهزيتها، وأوقف الوصول أو أعد تفعيله من نفس الصفحة.</span></div>
      <div><Link className="provider-primary" href="/merchant/drivers/new">＋ إضافة سائق</Link></div>
    </header>

    <section className="provider-kpi-grid" aria-label="ملخص السائقين">
      <article className="provider-kpi"><span aria-hidden>➤</span><div><small>كل السائقين</small><strong>{counts.all.toLocaleString("ar-SA")}</strong></div></article>
      <article className="provider-kpi"><span aria-hidden>✓</span><div><small>النشطون</small><strong>{counts.active.toLocaleString("ar-SA")}</strong></div></article>
      <article className="provider-kpi"><span aria-hidden>⌛</span><div><small>بانتظار التفعيل</small><strong>{counts.pending.toLocaleString("ar-SA")}</strong></div></article>
    </section>

    {error ? <p className="provider-toast provider-toast-error" role="alert">{error}</p> : null}
    {loading ? <div className="provider-skeleton" aria-label="جارٍ تحميل السائقين"><i /><i /></div> : drivers.length === 0 ? (
      <div className="provider-empty"><span aria-hidden>➤</span><h3>لم تُضف سائقين بعد</h3><p>أضف أول سائق وسيُنشأ له حساب دخول فعلي مرتبط بمنشأتك.</p><Link className="provider-primary" href="/merchant/drivers/new">إضافة أول سائق</Link></div>
    ) : <div className="provider-driver-grid">{drivers.map((driver) => <article className="provider-panel provider-driver-card" key={driver.id}>
      <header><div><small>@{driver.username}</small><h3>{driver.full_name}</h3><span>{driver.mobile} · {driver.email}</span></div><span className={`provider-status ${statusClasses[driver.status]}`}>{statusLabels[driver.status]}</span></header>
      <dl className="provider-info-grid">
        <div><dt>تاريخ الإضافة</dt><dd>{new Date(driver.created_at).toLocaleString("ar-SA")}</dd></div>
        <div><dt>آخر نشاط</dt><dd>{driver.last_active_at ? new Date(driver.last_active_at).toLocaleString("ar-SA") : "لم يسجل دخولًا بعد"}</dd></div>
        {driver.internal_notes ? <div className="wide"><dt>ملاحظات داخلية</dt><dd>{driver.internal_notes}</dd></div> : null}
      </dl>
      <footer className="provider-driver-actions">
        <button className={driver.status === "suspended" ? "" : "danger"} type="button" disabled={busyId === driver.id} onClick={() => void changeStatus(driver)}>
          {busyId === driver.id ? "جارٍ التحديث…" : driver.status === "suspended" ? "إعادة تفعيل الوصول" : "إيقاف وصول السائق"}
        </button>
      </footer>
    </article>)}</div>}
  </section>;
}

export function ProviderDriverCreate() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [copied, setCopied] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/provider/drivers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fullName: form.get("full_name"),
        mobile: form.get("mobile"),
        email: form.get("email"),
        username: form.get("username"),
        internalNotes: form.get("internal_notes"),
      }),
    });
    const result = await response.json() as { error?: string; credentials?: Credentials };
    setBusy(false);
    if (!response.ok || !result.credentials) return setError(result.error ?? "تعذر إنشاء حساب السائق.");
    setCredentials(result.credentials);
    event.currentTarget.reset();
  };

  const copyCredentials = async () => {
    if (!credentials) return;
    await navigator.clipboard.writeText(`البريد: ${credentials.email}\nاسم المستخدم: ${credentials.username}\nكلمة المرور المؤقتة: ${credentials.temporaryPassword}`);
    setCopied(true);
  };

  if (credentials) return <section className="provider-page-stack">
    <header className="provider-page-header"><div><p>تم إنشاء الحساب</p><h2>بيانات دخول السائق</h2><span>تظهر كلمة المرور المؤقتة الآن فقط. سلّمها للسائق عبر قناة آمنة واطلب منه تغييرها خلال 72 ساعة.</span></div></header>
    <section className="provider-panel provider-driver-credentials" role="status">
      <span className="provider-status provider-status-success">تم إنشاء السائق بنجاح</span>
      <dl>
        <div><dt>البريد</dt><dd dir="ltr">{credentials.email}</dd></div>
        <div><dt>اسم المستخدم</dt><dd dir="ltr">{credentials.username}</dd></div>
        <div><dt>كلمة المرور المؤقتة</dt><dd dir="ltr">{credentials.temporaryPassword}</dd></div>
        <div><dt>تنتهي في</dt><dd>{new Date(credentials.expiresAt).toLocaleString("ar-SA")}</dd></div>
      </dl>
      <footer><button className="provider-primary" type="button" onClick={() => void copyCredentials()}>{copied ? "✓ تم النسخ" : "نسخ بيانات الدخول"}</button><Link className="provider-secondary" href="/merchant/drivers">العودة إلى السائقين</Link></footer>
    </section>
  </section>;

  return <section className="provider-page-stack provider-driver-form">
    <header className="provider-page-header"><div><p>إدارة فريق التوصيل</p><h2>إضافة سائق جديد</h2><span>سيُنشأ حساب دخول حقيقي للسائق، وستظهر كلمة المرور المؤقتة مرة واحدة بعد الحفظ.</span></div><div><Link className="provider-secondary" href="/merchant/drivers">العودة للسائقين</Link></div></header>
    <form className="provider-form-section" onSubmit={submit}>
      <div className="provider-form-grid">
        <label><span>الاسم الكامل *</span><input name="full_name" required minLength={3} maxLength={120} autoComplete="name" /></label>
        <label><span>رقم الجوال السعودي *</span><input name="mobile" required inputMode="tel" dir="ltr" placeholder="05xxxxxxxx" autoComplete="tel" /></label>
        <label><span>البريد الإلكتروني *</span><input name="email" required type="email" dir="ltr" autoComplete="email" /></label>
        <label><span>اسم المستخدم *</span><input name="username" required minLength={4} maxLength={40} dir="ltr" autoComplete="username" pattern="\S{4,40}" /><small>من 4 إلى 40 حرفًا وبدون مسافات.</small></label>
        <label className="wide"><span>ملاحظات داخلية</span><textarea name="internal_notes" rows={4} maxLength={500} placeholder="اختياري — لا تظهر للسائق أو العميل" /></label>
      </div>
      {error ? <p className="provider-form-error" role="alert">{error}</p> : null}
      <footer><Link className="provider-secondary" href="/merchant/drivers">إلغاء</Link><button className="provider-primary" disabled={busy}>{busy ? "جارٍ إنشاء الحساب…" : "إنشاء حساب السائق"}</button></footer>
    </form>
  </section>;
}
