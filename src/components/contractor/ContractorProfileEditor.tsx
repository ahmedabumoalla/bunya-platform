/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/set-state-in-effect */
"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useAuthIdentity } from "@/components/auth/AuthIdentityProvider";
import { createClient } from "@/lib/supabase/client";
import styles from "./ContractorProfileEditor.module.css";

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
const approvalLabels: Record<string, string> = { pending: "بانتظار المراجعة", pending_review: "بانتظار المراجعة", under_review: "قيد المراجعة", approved: "معتمد", rejected: "غير معتمد", needs_changes: "مطلوب تعديل البيانات", draft: "مسودة", suspended: "موقوف" };
const availabilityLabels: Record<string, string> = { available: "متاح لمشاريع جديدة", busy: "مشغول حاليًا", temporarily_unavailable: "غير متاح مؤقتًا" };

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

  return <section className={`${styles.page} database-page`} aria-labelledby="contractor-profile-title">
    <header className={styles.header}>
      <div><p className={styles.eyebrow}>حساب المقاول</p><h1 id="contractor-profile-title">الملف المهني</h1><p className={styles.description}>عرّف العملاء بخبرتك وأعمالك، وحدّث بيانات حضورك المهني من مكان واحد.</p></div>
      {account ? <a className={styles.secondary} href="#profile-identity">تعديل بيانات الملف</a> : null}
    </header>
    {error ? <div className={styles.error} role="alert"><strong>تعذر إتمام العملية</strong><p>{error}</p>{!account ? <button type="button" className={styles.secondary} onClick={() => { setLoading(true); setError(""); void load(); }}>إعادة المحاولة</button> : null}</div> : null}
    {loading ? <div className={styles.loading} role="status"><span className={styles.loadingMark} aria-hidden="true"/><strong>جارٍ تحميل الملف المهني…</strong><p>نجهّز بيانات حسابك المحفوظة.</p></div> : account ? <>
      <section className={styles.overview} aria-label="ملخص الملف المحفوظ">
        <div className={styles.identitySummary}><span className={styles.monogram} aria-hidden="true">{String(account.display_name || account.commercial_name || "م").trim().slice(0, 1)}</span><div><p className={styles.eyebrow}>البيانات المحفوظة</p><h2>{account.display_name || "ملف المقاول"}</h2><p>{account.commercial_name || "لم يُحدد الاسم التجاري"}</p><div className={styles.meta}><span>{account.city || "لم تُحدد المدينة"}</span><span>{availabilityLabels[account.availability] || "لم تُحدد حالة التوفر"}</span></div></div></div>
        <div className={styles.approval}><span>حالة الاعتماد</span><strong className={`${styles.badge} ${account.approval_status === "approved" ? styles.approved : account.approval_status === "rejected" ? styles.rejected : styles.pending}`}>{approvalLabels[account.approval_status] || "لم تُحدد الحالة"}</strong><p>بعد اعتماد حسابك يمكنك عرض أعمالك واستقبال دعوات المشاريع.</p>{account.sensitive_changes_pending_review ? <small>توجد بيانات حساسة بانتظار المراجعة.</small> : null}</div>
      </section>
      <dl className={styles.metrics} aria-label="مؤشرات الحساب">
        <div><dt>نموذج التعامل</dt><dd>عمولة المشاريع ٥٪<small>دون اشتراك شهري</small></dd></div>
        <div><dt>الظهور في الدليل</dt><dd>{account.directory_visible ? "ظاهر" : "مخفي"}<small>يرتبط باكتمال الاعتماد</small></dd></div>
        <div><dt>تقييم العملاء</dt><dd>{Number(account.average_rating ?? 0).toLocaleString("ar-SA")} <span>من ٥</span><small>التقييم المسجل في حسابك</small></dd></div>
        <div><dt>المشاريع المكتملة</dt><dd>{Number(account.projects_count ?? 0).toLocaleString("ar-SA")}<small>سجل أعمالك على المنصة</small></dd></div>
      </dl>
      <nav className={styles.sectionNav} aria-label="أقسام الملف المهني"><a href="#profile-identity">الهوية المهنية</a><a href="#profile-experience">الخبرة والتوفر</a><a href="#profile-location">الموقع والروابط</a><a href="#profile-contact">بيانات التواصل</a></nav>
      <form className={styles.form} onSubmit={save} aria-busy={busy}>
        <section id="profile-identity" className={styles.formSection} aria-labelledby="profile-identity-title">
          <header className={styles.sectionHeading}><h2 id="profile-identity-title">الهوية المهنية</h2><p>الاسم والتخصص والنبذة التي تعرّف العملاء بك.</p><small>الحقول المعلّمة بـ * مطلوبة.</small></header>
          <div className={styles.fields}>
            <label><span>اسم العرض <b aria-hidden="true">*</b></span><input required autoComplete="name" value={form.displayName} onChange={e => setForm({ ...form, displayName: e.target.value })}/></label>
            <label><span>الاسم التجاري <b aria-hidden="true">*</b></span><input required autoComplete="organization" value={form.commercialName} onChange={e => setForm({ ...form, commercialName: e.target.value })}/></label>
            <label className={styles.wide}><span>الشارة أو التخصص المختصر <b aria-hidden="true">*</b></span><input required aria-describedby="profile-badge-hint" value={form.badge} onChange={e => setForm({ ...form, badge: e.target.value })}/><small id="profile-badge-hint">وصف مختصر يوضّح تخصصك الرئيسي.</small></label>
            <label className={styles.wide}><span>نبذة مهنية <b aria-hidden="true">*</b></span><textarea required rows={5} value={form.summary} onChange={e => setForm({ ...form, summary: e.target.value })}/></label>
          </div>
        </section>
        <section id="profile-experience" className={styles.formSection} aria-labelledby="profile-experience-title">
          <header className={styles.sectionHeading}><h2 id="profile-experience-title">الخبرة والتوفر</h2><p>وضّح خبرتك وحالتك الحالية لاستقبال مشاريع جديدة.</p></header>
          <div className={styles.fields}>
            <label><span>سنوات الخبرة <b aria-hidden="true">*</b></span><input required type="number" min="0" max="100" value={form.yearsExperience} onChange={e => setForm({ ...form, yearsExperience: e.target.value })}/></label>
            <label><span>حالة التوفر</span><select value={form.availability} onChange={e => setForm({ ...form, availability: e.target.value })}><option value="available">متاح</option><option value="busy">مشغول</option><option value="temporarily_unavailable">غير متاح مؤقتًا</option></select></label>
          </div>
        </section>
        <section id="profile-location" className={styles.formSection} aria-labelledby="profile-location-title">
          <header className={styles.sectionHeading}><h2 id="profile-location-title">الموقع والروابط</h2><p>حدّد مدينتك وأضف روابط تساعد العملاء على التعرّف إلى أعمالك.</p></header>
          <div className={styles.fields}>
            <label className={styles.wide}><span>المدينة <b aria-hidden="true">*</b></span><input required autoComplete="address-level2" value={form.city} onChange={e => setForm({ ...form, city: e.target.value })}/></label>
            <label className={styles.wide}><span>رابط خرائط Google</span><input dir="ltr" type="url" value={form.googleMapsUrl} onChange={e => setForm({ ...form, googleMapsUrl: e.target.value })}/></label>
            <label className={styles.wide}><span>الروابط المهنية</span><textarea dir="ltr" rows={4} aria-describedby="profile-links-hint" value={form.professionalLinks} onChange={e => setForm({ ...form, professionalLinks: e.target.value })}/><small id="profile-links-hint">أدخل رابطًا واحدًا في كل سطر.</small></label>
          </div>
        </section>
        <section id="profile-contact" className={styles.formSection} aria-labelledby="profile-contact-title">
          <header className={styles.sectionHeading}><h2 id="profile-contact-title">بيانات التواصل</h2><p>بيانات التواصل المرتبطة بحسابك، معروضة هنا للاطلاع.</p><span className={styles.readOnlyTag}>للقراءة فقط</span></header>
          <div className={styles.fields}>
            <label><span>الجوال الموثق</span><input readOnly dir="ltr" value={account?.phone ?? "—"}/></label>
            <label><span>البريد المرتبط</span><input readOnly dir="ltr" value={account?.email ?? "—"}/></label>
          </div>
        </section>
        <footer className={styles.saveBar}>
          <div><strong>حفظ بيانات الملف</strong><p>تُحفظ تعديلاتك مباشرة، وتبقى البيانات الحساسة معلّمة للمراجعة الإدارية.</p>{message ? <p className={styles.success} role="status">{message}</p> : null}{busy ? <p className={styles.saveStatus} role="status">جارٍ حفظ التعديلات…</p> : null}</div>
          <button className={styles.primary} type="submit" disabled={busy}>{busy ? "جارٍ الحفظ…" : "حفظ الملف المهني"}</button>
        </footer>
      </form>
    </> : null}
  </section>;
}
