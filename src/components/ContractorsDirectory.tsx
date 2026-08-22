/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { ContractorProfile } from "@/lib/bunya-types";
import { createClient } from "@/lib/supabase/client";

export function ContractorsDirectory({ contractors, dataError }: { contractors: ContractorProfile[]; dataError?: string }) {
  const [query, setQuery] = useState("");
  const [region, setRegion] = useState("الكل");
  const [specialty, setSpecialty] = useState("الكل");
  const [userId, setUserId] = useState<string | null>(null);
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [saveError, setSaveError] = useState("");
  const [busyId, setBusyId] = useState("");
  const approved = useMemo(() => contractors.filter((item) => item.approvalStatus === "approved" && item.subscriptionActive), [contractors]);
  const regions = useMemo(() => Array.from(new Set(approved.map((item) => item.city))), [approved]);
  const specialties = useMemo(() => Array.from(new Set(approved.flatMap((item) => item.serviceTypes))), [approved]);
  const filtered = useMemo(() => {
    const clean = query.trim().toLocaleLowerCase("ar");
    return approved.filter((item) => {
      const matchesQuery = !clean || [item.displayName, item.commercialName, item.summary, ...item.serviceTypes].some((value) => value.toLocaleLowerCase("ar").includes(clean));
      return matchesQuery && (region === "الكل" || item.city === region) && (specialty === "الكل" || item.serviceTypes.includes(specialty));
    });
  }, [approved, query, region, specialty]);

  useEffect(() => { void (async () => {
    const db = createClient();
    const auth = await db.auth.getUser();
    const id = auth.data.user?.id ?? null;
    setUserId(id);
    if (!id) return;
    const result = await db.from("saved_contractors").select("contractor_profile_id").eq("customer_profile_id", id);
    if (!result.error) setSaved(new Set((result.data ?? []).map(row => row.contractor_profile_id)));
  })(); }, []);

  const toggleSaved = async (contractorId: string) => {
    if (!userId) return;
    setBusyId(contractorId); setSaveError("");
    const db = createClient();
    const result = saved.has(contractorId)
      ? await db.from("saved_contractors").delete().eq("customer_profile_id", userId).eq("contractor_profile_id", contractorId)
      : await db.from("saved_contractors").insert({ customer_profile_id: userId, contractor_profile_id: contractorId });
    if (result.error) setSaveError("تعذر تحديث المحفوظات. تأكد من الدخول بحساب عميل فعال.");
    else setSaved(current => { const next = new Set(current); if (next.has(contractorId)) next.delete(contractorId); else next.add(contractorId); return next; });
    setBusyId("");
  };

  return <main className="contractors-page">
    <header className="directory-header"><div><Link className="directory-brand" href="/"><span>ب</span> بُنية</Link><p>دليل المقاولين المعتمدين</p></div><div className="directory-actions"><Link href="/contractors/join">انضم كمقاول</Link><Link href="/">الرئيسية</Link></div></header>
    <section className="directory-hero"><div><p>شبكة بُنية المهنية</p><h1>ابحث عن مقاول مناسب لمشروعك</h1><span>ملفات المقاولين المعتمدين والنشطين في قاعدة بيانات بُنية.</span></div><Link className="directory-create-project" href="/customer/project-requests/new">＋ إنشاء طلب مشروع</Link></section>
    <section className="directory-content">
      {dataError ? <div className="directory-empty" role="alert"><strong>تعذر الاتصال بقاعدة البيانات</strong><span>{dataError}</span></div> : null}
      {saveError ? <div className="directory-empty" role="alert"><strong>تعذر حفظ المقاول</strong><span>{saveError}</span></div> : null}
      <div className="directory-filters">
        <label><span>البحث بالاسم أو التخصص</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="مثال: أساس العمران أو تشطيبات" /></label>
        <label><span>المنطقة</span><select value={region} onChange={(event) => setRegion(event.target.value)}><option value="الكل">كل المناطق</option>{regions.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label><span>التخصص</span><select value={specialty} onChange={(event) => setSpecialty(event.target.value)}><option value="الكل">كل التخصصات</option>{specialties.map((item) => <option key={item}>{item}</option>)}</select></label>
        <div className="directory-count"><strong>{filtered.length.toLocaleString("ar-SA")}</strong><span>مقاول مطابق</span></div>
      </div>
      {!dataError && filtered.length ? <div className="contractor-grid">{filtered.map((contractor) => <article className="contractor-profile-card" key={contractor.id}>
        <div className="contractor-card-top"><span className="contractor-avatar">{contractor.displayName.slice(0, 1)}</span><div><p>{contractor.badge}</p><h2>{contractor.commercialName}</h2><span>{contractor.city} · {contractor.yearsExperience} سنوات خبرة</span></div><strong>معتمد</strong></div>
        <p className="contractor-summary">{contractor.summary}</p>
        <div className="contractor-meta"><section><h3>التخصصات</h3><div>{contractor.serviceTypes.map((item) => <span key={item}>{item}</span>)}</div></section><section><h3>مناطق العمل</h3><div><span>{contractor.city}</span><span>النطاق المحيط</span></div></section></div>
        {contractor.workItems.length ? <div className="contractor-work">{contractor.workItems.map((item) => <span key={item.title}>{item.mediaUrl&&item.mimeType?.startsWith("image/")?<img src={item.mediaUrl} alt={item.title}/>:null}{item.title}</span>)}</div> : null}
        <div className="directory-card-actions">{userId?<button type="button" disabled={busyId===contractor.id} onClick={()=>void toggleSaved(contractor.id)}>{busyId===contractor.id?"جارٍ الحفظ...":saved.has(contractor.id)?"إزالة من المحفوظات":"حفظ المقاول"}</button>:<Link href="/login">سجّل الدخول لحفظ المقاول</Link>}<Link href="/customer/project-requests/new">إنشاء طلب مشروع</Link></div>
      </article>)}</div> : !dataError ? <div className="directory-empty"><strong>لا توجد نتائج مطابقة</strong><span>غيّر كلمات البحث أو أعد ضبط أحد الفلاتر.</span><button type="button" onClick={() => { setQuery(""); setRegion("الكل"); setSpecialty("الكل"); }}>إعادة ضبط الفلاتر</button></div> : null}
    </section>
  </main>;
}
