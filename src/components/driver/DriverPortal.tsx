/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { useAuthIdentity } from "@/components/auth/AuthIdentityProvider";
import type { DriverDeliveryAssignment, DriverDeliveryStatus, ProviderDriver } from "@/lib/driver-types";
import { confirmDelivery, readDrivers, syncProviderAssignments, updateDriverDeliveryStatus, writeDrivers } from "@/lib/driver-storage";
import { validatePassword } from "@/lib/bunya-local";
import { createClient } from "@/lib/supabase/client";

const labels: Record<DriverDeliveryStatus, string> = { assigned: "تم الإسناد", picked_up: "تم استلام الطلبية", in_transit: "في الطريق", arrived: "وصل إلى الموقع", delivered: "تم التسليم", failed_delivery: "تعذر التسليم" };
const next: Partial<Record<DriverDeliveryStatus, DriverDeliveryStatus>> = { assigned: "picked_up", picked_up: "in_transit", in_transit: "arrived" };

export function DriverPortal() {
  const identity = useAuthIdentity();
  const [driver, setDriver] = useState<ProviderDriver | null>(null);
  const [assignments, setAssignments] = useState<DriverDeliveryAssignment[]>([]);
  const [selected, setSelected] = useState<DriverDeliveryAssignment | null>(null);
  const [dialog, setDialog] = useState<"code" | "failed" | null>(null);
  const [code, setCode] = useState("");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");
  const databaseDriver = identity.details.driver;

  const refresh = (driverId: string) => {
    const items = syncProviderAssignments().filter((item) => item.driverId === driverId);
    setAssignments(items);
    setSelected((current) => current ? items.find((item) => item.id === current.id) ?? null : null);
  };

  useEffect(() => {
    if (!databaseDriver) return;
    const local = readDrivers().find((item) => item.id === databaseDriver.driverId || item.email.toLowerCase() === databaseDriver.email.toLowerCase());
    const resolved: ProviderDriver = local ?? {
      id: databaseDriver.driverId,
      providerId: databaseDriver.providerId,
      providerName: databaseDriver.providerName,
      fullName: databaseDriver.fullName,
      mobile: identity.profile?.mobile ?? "",
      email: databaseDriver.email,
      username: identity.profile?.username ?? databaseDriver.email,
      status: databaseDriver.status === "must_change_password" ? "must_change_password" : "active",
      mustChangePassword: databaseDriver.mustChangePassword,
      failedCodeAttempts: 0,
      violations: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setDriver(resolved);
    refresh(resolved.id);
  }, [databaseDriver, identity.profile?.mobile, identity.profile?.username]);

  if (!driver) return <main className="driver-app"><section className="driver-loading">جارٍ التحقق من جلسة السائق…</section></main>;

  const update = (assignment: DriverDeliveryAssignment) => {
    const target = next[assignment.status];
    if (!target) return;
    updateDriverDeliveryStatus(assignment.id, driver.id, target, note.trim() || undefined);
    setMessage(`تم تحديث الحالة إلى: ${labels[target]}.`);
    setNote("");
    refresh(driver.id);
  };
  const fail = () => {
    if (!selected || !note.trim()) return;
    updateDriverDeliveryStatus(selected.id, driver.id, "failed_delivery", note.trim());
    setMessage("تم تسجيل تعذر التسليم وإشعار المزود محليًا.");
    setDialog(null);
    setNote("");
    refresh(driver.id);
  };
  const verify = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected) return;
    const result = await confirmDelivery(selected.id, code, "driver", driver.id, { note: note.trim() || undefined });
    setMessage(result.message);
    if (result.ok) {
      setDialog(null);
      setCode("");
      setNote("");
    }
    refresh(driver.id);
  };

  return <main className="driver-app">
    <header className="driver-top">
      <Link href="/" className="driver-logo"><span>ب</span><div><strong>بُنية</strong><small>بوابة السائق</small></div></Link>
      <div><p>مرحبًا، {driver.fullName}</p><h1>{driver.providerName}</h1></div>
      <LogoutButton>تسجيل الخروج</LogoutButton>
    </header>
    <section className="driver-content">
      {message ? <p className="driver-toast" role="status">{message}</p> : null}
      <header className="driver-heading"><p>توصيلاتي فقط</p><h2>مهام التوصيل المسندة</h2><span>لا تظهر الأسعار أو كود العميل أو بيانات العميل الحساسة.</span></header>
      {assignments.length ? <div className="driver-assignment-grid">{assignments.map((item) => <article className="driver-card" key={item.id}>
        <header><div><small>{item.deliveryCode}</small><h3>{item.orderCode}</h3></div><span data-status={item.status}>{labels[item.status]}</span></header>
        <dl><div><dt>المنطقة</dt><dd>{item.region}</dd></div><div><dt>وقت الاستلام</dt><dd>{new Date(item.pickupAt).toLocaleString("ar-SA")}</dd></div><div><dt>الموعد المتوقع</dt><dd>{new Date(item.expectedAt).toLocaleString("ar-SA")}</dd></div><div><dt>محاولات الكود</dt><dd>{item.codeAttempts}/{item.maxCodeAttempts}</dd></div></dl>
        <a className="driver-map" href={item.mapsUrl} target="_blank" rel="noreferrer">⌖ فتح Google Maps</a>
        <label><span>ملاحظة التوصيل</span><textarea rows={2} value={selected?.id === item.id ? note : ""} onFocus={() => setSelected(item)} onChange={(event) => { setSelected(item); setNote(event.target.value); }} /></label>
        <footer><button className="driver-secondary" onClick={() => setSelected(item)}>فتح التفاصيل</button>{next[item.status] ? <button className="driver-primary" onClick={() => update(item)}>{labels[next[item.status]!]}</button> : null}{item.status === "arrived" ? <button className="driver-primary" onClick={() => { setSelected(item); setDialog("code"); }}>تأكيد التسليم</button> : null}{!["delivered", "failed_delivery"].includes(item.status) ? <button className="driver-danger" onClick={() => { setSelected(item); setDialog("failed"); }}>تعذر التسليم</button> : null}</footer>
      </article>)}</div> : <section className="driver-empty"><span>⌖</span><h3>لا توجد توصيلات مسندة</h3><p>ستظهر المهمة هنا عندما يسندها مزودك إلى حسابك.</p></section>}
    </section>
    {dialog && selected ? <div className="driver-modal-backdrop" onMouseDown={() => setDialog(null)}><section className="driver-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
      <h3>{dialog === "code" ? "تأكيد التسليم بكود العميل" : "تسجيل تعذر التسليم"}</h3>
      <p>{dialog === "code" ? "اطلب الكود بعد تسليم المواد. لا يظهر الكود داخل البوابة." : "اكتب سببًا واضحًا ليصل إلى المزود."}</p>
      {dialog === "code" ? <form onSubmit={verify}><label><span>كود العميل</span><input dir="ltr" inputMode="numeric" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} /></label><label><span>ملاحظة اختيارية</span><textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} /></label><footer><button type="button" onClick={() => setDialog(null)}>تراجع</button><button className="driver-primary" disabled={code.length !== 6}>مطابقة وتأكيد</button></footer></form> : <><label><span>سبب التعذر — إلزامي</span><textarea rows={4} value={note} onChange={(event) => setNote(event.target.value)} /></label><footer><button onClick={() => setDialog(null)}>تراجع</button><button className="driver-danger" disabled={!note.trim()} onClick={fail}>تسجيل التعذر</button></footer></>}
    </section></div> : null}
  </main>;
}

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
    const databaseDriver = identity.details.driver;
    if (databaseDriver) {
      writeDrivers(readDrivers().map((item) => item.id === databaseDriver.driverId || item.email.toLowerCase() === databaseDriver.email.toLowerCase() ? { ...item, mustChangePassword: false, status: "active", updatedAt: new Date().toISOString() } : item));
    }
    router.replace("/driver");
    router.refresh();
  };

  return <main className="driver-app driver-password-page"><form className="driver-password-card" onSubmit={submit}>
    <div className="driver-logo"><span>ب</span><div><strong>بُنية</strong><small>أول دخول للسائق</small></div></div>
    <h1>غيّر كلمة المرور الأولية</h1><p>لن تدخل لوحة التوصيلات قبل اختيار كلمة قوية خاصة بك.</p>
    {([ ["current", "كلمة المرور الحالية"], ["password", "كلمة المرور الجديدة"], ["confirm", "تأكيد الجديدة"] ] as const).map(([key, label]) => <label key={key}><span>{label}</span><input type={show[key] ? "text" : "password"} value={form[key]} onChange={(event) => { setForm((current) => ({ ...current, [key]: event.target.value })); setError(""); }} /><small><input type="checkbox" checked={show[key]} onChange={(event) => setShow((current) => ({ ...current, [key]: event.target.checked }))} /> إظهار الحقل</small></label>)}
    <div className="driver-password-strength"><i style={{ width: `${Math.min(100, form.password.length * 10)}%` }} /><span>{form.password && form.password === form.confirm ? "كلمتا المرور متطابقتان" : "استخدم حرفًا ورقمًا و8 أحرف على الأقل"}</span></div>
    {error ? <p className="driver-error">{error}</p> : null}<button className="driver-primary" disabled={busy}>{busy ? "جارٍ الحفظ..." : "حفظ والدخول للوحة"}</button>
  </form></main>;
}
