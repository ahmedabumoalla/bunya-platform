/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/set-state-in-effect */
"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useAuthIdentity } from "@/components/auth/AuthIdentityProvider";
import { createClient } from "@/lib/supabase/client";

type ProfileForm = {
  displayName: string;
  commercialName: string;
  city: string;
  badge: string;
  yearsExperience: string;
  summary: string;
  googleMapsUrl: string;
  professionalLinks: string;
  availability: string;
};

const empty: ProfileForm = { displayName: "", commercialName: "", city: "", badge: "", yearsExperience: "", summary: "", googleMapsUrl: "", professionalLinks: "", availability: "available" };
const db = createClient();

export function ContractorProfileEditor() {
  const identity = useAuthIdentity();
  const contractorId = identity.details.contractor?.contractorProfileId;
  const [form, setForm] = useState(empty);
  const [account, setAccount] = useState<Record<string, any> | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    if (!contractorId) { setError("تعذر العثور على ملف المقاول المرتبط بالحساب."); setLoading(false); return; }
    const result = await db.from("contractor_profiles").select("*").eq("id", contractorId).single();
    if (result.error) setError(result.error.message);
    else {
      const row = result.data;
      setAccount(row);
      setForm({
        displayName: row.display_name ?? "",
        commercialName: row.commercial_name ?? "",
        city: row.city ?? "",
        badge: row.badge ?? "",
        yearsExperience: row.years_experience == null ? "" : String(row.years_experience),
        summary: row.summary ?? "",
        googleMapsUrl: row.google_maps_url ?? "",
        professionalLinks: Array.isArray(row.professional_links) ? row.professional_links.join("\n") : "",
        availability: row.availability ?? "available",
      });
    }
    setLoading(false);
  }, [contractorId]);
  useEffect(() => { void load(); }, [load]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!contractorId) return;
    setBusy(true); setError(""); setMessage("");
    const result = await db.from("contractor_profiles").update({
      display_name: form.displayName.trim(),
      commercial_name: form.commercialName.trim(),
      city: form.city.trim() || null,
      badge: form.badge.trim() || null,
      years_experience: form.yearsExperience ? Number(form.yearsExperience) : null,
      summary: form.summary.trim() || null,
      google_maps_url: form.googleMapsUrl.trim() || null,
      professional_links: form.professionalLinks.split("\n").map(value => value.trim()).filter(Boolean),
      availability: form.availability,
      sensitive_changes_pending_review: true,
    }).eq("id", contractorId);
    if (result.error) setError(result.error.message);
    else { setMessage("تم حفظ الملف المهني. البيانات الحساسة ستبقى معلّمة للمراجعة الإدارية."); await load(); }
    setBusy(false);
  };

  return <main className="database-page">
    <header className="database-page-header"><div><p>ملف المقاول</p><h1>الملف المهني</h1><span>هذه البيانات قابلة للتعديل وتُحفظ مباشرة في ملف منشأتك، بينما تبقى حالة الاعتماد والاشتراك بيد الإدارة.</span></div><aside><small>حالة الاعتماد</small><strong>{account?.approval_status ?? "—"}</strong></aside></header>
    {error ? <div className="database-state database-error customer-inline-state"><span>!</span><p>{error}</p></div> : null}
    {message ? <div className="customer-success-message">{message}</div> : null}
    {loading ? <div className="database-state"><span className="database-spinner"/><h2>جارٍ تحميل الملف...</h2></div> : <>
      <section className="database-metrics"><article><span>الاشتراك</span><strong>{account?.subscription_active ? "نشط" : "غير نشط"}</strong><small>تحدده الإدارة</small></article><article><span>الظهور في الدليل</span><strong>{account?.directory_visible ? "ظاهر" : "مخفي"}</strong><small>بعد اكتمال الاعتماد</small></article><article><span>التقييم</span><strong>{Number(account?.average_rating ?? 0).toLocaleString("ar-SA")}</strong><small>من 5</small></article><article><span>المشاريع</span><strong>{Number(account?.projects_count ?? 0).toLocaleString("ar-SA")}</strong><small>مشاريع مكتملة</small></article></section>
      <section className="database-panel database-editor"><form className="database-form-grid" onSubmit={save}>
        <label><span>اسم العرض</span><input required value={form.displayName} onChange={e => setForm({ ...form, displayName: e.target.value })}/></label>
        <label><span>الاسم التجاري</span><input required value={form.commercialName} onChange={e => setForm({ ...form, commercialName: e.target.value })}/></label>
        <label><span>المدينة</span><input required value={form.city} onChange={e => setForm({ ...form, city: e.target.value })}/></label>
        <label><span>الشارة أو التخصص المختصر</span><input required value={form.badge} onChange={e => setForm({ ...form, badge: e.target.value })}/></label>
        <label><span>سنوات الخبرة</span><input required type="number" min="0" max="100" value={form.yearsExperience} onChange={e => setForm({ ...form, yearsExperience: e.target.value })}/></label>
        <label><span>حالة التوفر</span><select value={form.availability} onChange={e => setForm({ ...form, availability: e.target.value })}><option value="available">متاح</option><option value="busy">مشغول</option><option value="unavailable">غير متاح</option></select></label>
        <label className="wide"><span>نبذة مهنية</span><textarea required rows={5} value={form.summary} onChange={e => setForm({ ...form, summary: e.target.value })}/></label>
        <label className="wide"><span>رابط خرائط Google</span><input dir="ltr" type="url" value={form.googleMapsUrl} onChange={e => setForm({ ...form, googleMapsUrl: e.target.value })}/></label>
        <label className="wide"><span>الروابط المهنية — رابط في كل سطر</span><textarea dir="ltr" rows={4} value={form.professionalLinks} onChange={e => setForm({ ...form, professionalLinks: e.target.value })}/></label>
        <label><span>الجوال الموثق</span><input readOnly dir="ltr" value={account?.phone ?? "—"}/></label>
        <label><span>البريد المرتبط</span><input readOnly dir="ltr" value={account?.email ?? "—"}/></label>
        <footer className="wide"><button disabled={busy}>{busy ? "جارٍ الحفظ..." : "حفظ الملف المهني"}</button></footer>
      </form></section>
    </>}
  </main>;
}
