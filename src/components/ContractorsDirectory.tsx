/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BunyaLogo } from "./brand/BunyaLogo";
import { Icon, JoinLinks, PublicMobileNav } from "./home/HomeStorefrontUi";
import styles from "./ContractorsDirectory.module.css";
import type { ContractorProfile } from "@/lib/bunya-types";
import { createClient } from "@/lib/supabase/client";
import { publicAccountFor, type PublicAccount } from "@/lib/auth/public-account";

export function ContractorsDirectory({ contractors, dataError, account = publicAccountFor(null) }: { contractors: ContractorProfile[]; dataError?: string; account?: PublicAccount }) {
  const [query, setQuery] = useState("");
  const [region, setRegion] = useState("الكل");
  const [specialty, setSpecialty] = useState("الكل");
  const [userId, setUserId] = useState<string | null>(null);
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [saveError, setSaveError] = useState("");
  const [busyId, setBusyId] = useState("");
  const approved = useMemo(() => contractors.filter((item) => item.approvalStatus === "approved"), [contractors]);
  const regions = useMemo(() => Array.from(new Set(approved.flatMap((item) => item.workRegions.length ? item.workRegions : [item.city]))), [approved]);
  const specialties = useMemo(() => Array.from(new Set(approved.flatMap((item) => item.serviceTypes))), [approved]);
  const filtered = useMemo(() => {
    const clean = query.trim().toLocaleLowerCase("ar");
    return approved.filter((item) => {
      const matchesQuery = !clean || [item.displayName, item.commercialName, item.summary, ...item.serviceTypes].some((value) => value.toLocaleLowerCase("ar").includes(clean));
      const matchesRegion = region === "الكل" || item.city === region || item.workRegions.includes(region);
      return matchesQuery && matchesRegion && (specialty === "الكل" || item.serviceTypes.includes(specialty));
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

  return <main className={styles.page}>
    <header className={styles.header}><div className={styles.headerInner}><Link className={styles.brand} href="/" aria-label="بُنية — الرئيسية"><BunyaLogo priority sizes="144px" /></Link><JoinLinks account={account} /><nav className={styles.nav} aria-label="روابط الدليل">{account.signedIn ? <Link href={account.href} aria-label="حسابي"><Icon name="user" /><span>حسابي</span></Link> : null}<Link href="/"><span>الرئيسية</span></Link></nav></div></header>
    <section className={styles.hero}><div><h1>مقاول لمشروعك</h1><p>ابحث حسب التخصص والمنطقة.</p></div><Link className={styles.primary} href="/customer/project-requests/new"><Icon name="plus" />طلب مشروع</Link></section>
    <section className={styles.content}>
      {dataError ? <div className={styles.empty} role="alert"><Icon name="search" /><strong>تعذر تحميل المقاولين</strong><span>{dataError}</span><Link href="/contractors">إعادة المحاولة</Link></div> : null}
      {saveError ? <div className={styles.empty} role="alert"><strong>تعذر حفظ المقاول</strong><span>{saveError}</span></div> : null}
      <div className={styles.filters}>
        <label className={styles.search}><span className="sr-only">البحث بالاسم أو التخصص</span><Icon name="search" /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="اسم المقاول أو التخصص..." /></label>
        <label><span>المنطقة</span><select value={region} onChange={(event) => setRegion(event.target.value)}><option value="الكل">كل المناطق</option>{regions.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label><span>التخصص</span><select value={specialty} onChange={(event) => setSpecialty(event.target.value)}><option value="الكل">كل التخصصات</option>{specialties.map((item) => <option key={item}>{item}</option>)}</select></label>
      </div>
      {!dataError ? <div className={styles.results}><h2>المقاولون</h2><span className={styles.count} role="status">{filtered.length.toLocaleString("ar-SA")} مقاول</span>{query || region !== "الكل" || specialty !== "الكل" ? <button type="button" onClick={() => { setQuery(""); setRegion("الكل"); setSpecialty("الكل"); }}>مسح الفلاتر</button> : null}</div> : null}
      {!dataError && filtered.length ? <div className={styles.grid}>{filtered.map((contractor) => <article className={styles.card} key={contractor.id}>
        <div className={styles.cardTop}><span className={styles.avatar}>{contractor.displayName.slice(0, 1)}</span><div><p>{contractor.badge}</p><h2>{contractor.commercialName}</h2><span>{contractor.city}{contractor.yearsExperience ? ` · ${contractor.yearsExperience} سنوات خبرة` : ""}</span></div><strong>معتمد</strong></div>
        <p className={styles.summary}>{contractor.summary}</p>
        <div className={styles.stats}><span>التقييم <b>{contractor.averageRating.toLocaleString("ar-SA")}/5</b></span><span>المشاريع <b>{contractor.projectsCount.toLocaleString("ar-SA")}</b></span><span>الحالة <b>{contractor.availability === "available" ? "متاح" : "حسب الجدول"}</b></span></div>
        <div className={styles.meta}><section><h3>التخصصات</h3><div>{contractor.serviceTypes.length ? contractor.serviceTypes.map((item) => <span key={item}>{item}</span>) : <span>مقاولات عامة</span>}</div></section><section><h3>مناطق العمل</h3><div>{(contractor.workRegions.length ? contractor.workRegions : [contractor.city]).map((item) => <span key={item}>{item}</span>)}</div></section></div>
        {contractor.workItems.length ? <div className={styles.work}>{contractor.workItems.map((item) => <span key={item.title}>{item.mediaUrl&&item.mimeType?.startsWith("image/")?<img src={item.mediaUrl} alt={item.title}/>:null}{item.title}</span>)}</div> : null}
        <div className={styles.contact}><a href={`tel:${contractor.phone}`}>اتصال: {contractor.phone}</a><a href={`mailto:${contractor.email}`}>البريد الإلكتروني</a>{contractor.mapsUrl?<a href={contractor.mapsUrl} target="_blank" rel="noreferrer">الموقع على الخريطة</a>:null}</div>
        <div className={styles.cardActions}>{userId?<button type="button" disabled={busyId===contractor.id} onClick={()=>void toggleSaved(contractor.id)}>{busyId===contractor.id?"جارٍ الحفظ...":saved.has(contractor.id)?"إزالة من المحفوظات":"حفظ المقاول"}</button>:<Link href="/login">سجّل الدخول لحفظ المقاول</Link>}<Link href="/customer/project-requests/new">إنشاء طلب مشروع</Link></div>
      </article>)}</div> : !dataError ? <div className={styles.empty}><Icon name="helmet" /><strong>{approved.length ? "لا توجد نتائج مطابقة" : "لا يوجد مقاولون متاحون حاليًا"}</strong><span>{approved.length ? "جرّب تخصصًا أو منطقة أخرى." : "يمكنك إنشاء طلب لمشروعك."}</span>{approved.length ? <button type="button" onClick={() => { setQuery(""); setRegion("الكل"); setSpecialty("الكل"); }}>إعادة الضبط</button> : <Link href="/customer/project-requests/new">طلب مشروع</Link>}</div> : null}
    </section>
    <PublicMobileNav active="contractors" />
  </main>;
}
