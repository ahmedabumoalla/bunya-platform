"use client";

import { FormEvent, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { PortalShell } from "@/components/PortalUI";

type Application = {
  id: string;
  email: string;
  mobile: string;
  company_name?: string;
  contact_name?: string;
  contractor_name?: string;
};

export default function ReviseJoinApplicationPage() {
  const { token } = useParams<{ token: string }>();
  const [kind, setKind] = useState<"provider" | "contractor">("provider");
  const [form, setForm] = useState({ name: "", contactName: "", email: "", mobile: "" });
  const [state, setState] = useState<"loading" | "ready" | "saving" | "done" | "error">("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    fetch(`/api/public/join/revise/${encodeURIComponent(token)}`, { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json() as { kind?: "provider" | "contractor"; application?: Application; message?: string };
        if (!response.ok || !body.application || !body.kind) throw new Error(body.message || "تعذر فتح الطلب.");
        if (!active) return;
        setKind(body.kind);
        setForm({
          name: body.application.company_name || body.application.contractor_name || "",
          contactName: body.application.contact_name || "",
          email: body.application.email,
          mobile: body.application.mobile,
        });
        setState("ready");
      })
      .catch((error: Error) => { if (active) { setMessage(error.message); setState("error"); } });
    return () => { active = false; };
  }, [token]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("saving");
    setMessage("");
    try {
      const data = new FormData(event.currentTarget);
      const response = await fetch(`/api/public/join/revise/${encodeURIComponent(token)}`, { method: "POST", body: data });
      const body = await response.json() as { message?: string };
      if (!response.ok) throw new Error(body.message || "تعذر حفظ التعديلات.");
      setState("done");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "تعذر حفظ التعديلات.");
      setState("ready");
    }
  }

  if (state === "loading") return <PortalShell><section className="portal-card application-card"><p>جارٍ تحميل الطلب...</p></section></PortalShell>;
  if (state === "error") return <PortalShell><section className="portal-card application-card"><h1>تعذر فتح الرابط</h1><p className="portal-form-error">{message}</p></section></PortalShell>;
  if (state === "done") return <PortalShell><section className="portal-card application-card"><h1>تم استلام التعديلات</h1><p>عاد الطلب إلى قائمة المراجعة، وسيصلك إشعار بعد قرار الإدارة.</p></section></PortalShell>;

  return <PortalShell><section className="portal-card application-card">
    <header className="portal-heading application-heading"><p>استكمال طلب الانضمام</p><h1>تعديل بيانات {kind === "provider" ? "المزوّد" : "المقاول"}</h1><span>حدّث البيانات المطلوبة ثم أعد إرسال الطلب للمراجعة.</span></header>
    <form className="application-form" onSubmit={submit}>
      <div className="form-grid">
        <label className="portal-field"><span>{kind === "provider" ? "اسم الشركة" : "اسم المقاول"}</span><input name="name" required minLength={3} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
        {kind === "provider" ? <label className="portal-field"><span>اسم المسؤول</span><input name="contactName" value={form.contactName} onChange={(event) => setForm({ ...form, contactName: event.target.value })} /></label> : null}
        <label className="portal-field"><span>البريد الإلكتروني</span><input name="email" type="email" required value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label>
        <label className="portal-field"><span>رقم الجوال</span><input name="mobile" inputMode="tel" required value={form.mobile} onChange={(event) => setForm({ ...form, mobile: event.target.value })} /></label>
      </div>
      {message ? <p className="portal-form-error" role="alert">{message}</p> : null}
      <button className="portal-primary-button application-submit" disabled={state === "saving"}>{state === "saving" ? "جارٍ الحفظ..." : "إعادة الإرسال للمراجعة"}</button>
    </form>
  </section></PortalShell>;
}
