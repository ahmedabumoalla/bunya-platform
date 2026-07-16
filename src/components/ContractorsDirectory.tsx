"use client";

/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {useRouter} from "next/navigation";
import type { ContractorProfile } from "@/lib/bunya-types";
import type { SavedContractor } from "@/lib/customer-types";
import { customerStorageKeys } from "@/lib/customer-storage";
import {readContractor,readContractorProfile} from "@/lib/contractor-storage";

export function ContractorsDirectory({ contractors }: { contractors: ContractorProfile[] }) {
  const router=useRouter();
  const [directoryContractors,setDirectoryContractors]=useState(contractors);
  const [query, setQuery] = useState("");
  const [region, setRegion] = useState("الكل");
  const [specialty, setSpecialty] = useState("الكل");
  const [saved, setSaved] = useState<SavedContractor[]>([]);
  useEffect(() => { try { setSaved(JSON.parse(localStorage.getItem(customerStorageKeys.contractors) ?? "[]") as SavedContractor[]); } catch { setSaved([]); } const profile=readContractorProfile();const portfolio=readContractor("portfolio").filter(item=>item.visible&&item.approved).sort((a,b)=>a.sortOrder-b.sortOrder);if(profile.accountStatus==="approved"&&profile.directoryVisible&&profile.availability!=="temporarily_unavailable"){const local:ContractorProfile={id:profile.id,displayName:profile.displayName,commercialName:profile.companyName??profile.displayName,city:profile.city,badge:profile.availability==="available"?"متاح الآن":"مشغول حاليًا",serviceTypes:profile.specialties,yearsExperience:profile.yearsExperience,summary:profile.bio,mockWorkImages:portfolio.slice(0,3).map(item=>item.title),phone:profile.mobile,email:profile.email,subscriptionActive:true,approvalStatus:"approved"};setDirectoryContractors(current=>[local,...current.filter(item=>item.id!==local.id)])}}, [contractors]);
  const toggleSaved = (contractorId: string) => {
    const next = saved.some((item) => item.contractorId === contractorId)
      ? saved.filter((item) => item.contractorId !== contractorId)
      : [{ contractorId, savedAt: new Date().toISOString() }, ...saved];
    setSaved(next);
    localStorage.setItem(customerStorageKeys.contractors, JSON.stringify(next));
  };
  const createProjectRequest=()=>{const destination="/customer/project-requests/new";if(!localStorage.getItem("bunya-local-session")){localStorage.setItem("bunya-auth-return-to",destination);router.push(`/login?returnTo=${encodeURIComponent(destination)}`);return}router.push(destination)};
  const approved = useMemo(() => directoryContractors.filter((item) => item.approvalStatus === "approved" && item.subscriptionActive), [directoryContractors]);
  const regions = useMemo(() => Array.from(new Set(approved.map((item) => item.city))), [approved]);
  const specialties = useMemo(() => Array.from(new Set(approved.flatMap((item) => item.serviceTypes))), [approved]);
  const filtered = useMemo(() => {
    const clean = query.trim().toLocaleLowerCase("ar");
    return approved.filter((item) => {
      const matchesQuery = !clean || [item.displayName, item.commercialName, item.summary, ...item.serviceTypes].some((value) => value.toLocaleLowerCase("ar").includes(clean));
      return matchesQuery && (region === "الكل" || item.city === region) && (specialty === "الكل" || item.serviceTypes.includes(specialty));
    });
  }, [approved, query, region, specialty]);

  return <main className="contractors-page">
    <header className="directory-header"><div><Link className="directory-brand" href="/"><span>ب</span> بُنية</Link><p>دليل المقاولين المعتمدين</p></div><div className="directory-actions"><Link href="/contractors/join">انضم كمقاول</Link><Link href="/">الرئيسية</Link></div></header>
    <section className="directory-hero"><div><p>شبكة بُنية المهنية</p><h1>ابحث عن مقاول مناسب لمشروعك</h1><span>نتائج Mock لملفات مقاولين معتمدين فقط، مع تخصصاتهم ومناطق عملهم.</span></div><button className="directory-create-project" type="button" onClick={createProjectRequest}>＋ إنشاء طلب مشروع</button></section>
    <section className="directory-content">
      <div className="directory-filters">
        <label><span>البحث بالاسم أو التخصص</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="مثال: أساس العمران أو تشطيبات" /></label>
        <label><span>المنطقة</span><select value={region} onChange={(event) => setRegion(event.target.value)}><option value="الكل">كل المناطق</option>{regions.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label><span>التخصص</span><select value={specialty} onChange={(event) => setSpecialty(event.target.value)}><option value="الكل">كل التخصصات</option>{specialties.map((item) => <option key={item}>{item}</option>)}</select></label>
        <div className="directory-count"><strong>{filtered.length.toLocaleString("ar-SA")}</strong><span>مقاول مطابق</span></div>
      </div>
      {filtered.length ? <div className="contractor-grid">{filtered.map((contractor, index) => <article className="contractor-profile-card" key={contractor.id}>
        <div className="contractor-card-top"><span className="contractor-avatar">{contractor.displayName.slice(0, 1)}</span><div><p>{contractor.badge}</p><h2>{contractor.commercialName}</h2><span>{contractor.city} · {contractor.yearsExperience} سنوات خبرة</span></div><strong>★ 4.{9 - index}</strong></div>
        <p className="contractor-summary">{contractor.summary}</p>
        <div className="contractor-meta"><section><h3>التخصصات</h3><div>{contractor.serviceTypes.map((item) => <span key={item}>{item}</span>)}</div></section><section><h3>مناطق العمل</h3><div><span>{contractor.city}</span><span>النطاق المحيط</span></div></section></div>
        <div className="contractor-work"><span>{contractor.mockWorkImages[0]}</span><span>{contractor.mockWorkImages[1]}</span><span>{contractor.mockWorkImages[2]}</span></div>
        <div className="directory-card-actions"><button type="button" onClick={() => toggleSaved(contractor.id)}>{saved.some((item) => item.contractorId === contractor.id) ? "★ محفوظ" : "☆ حفظ المقاول"}</button><button type="button" disabled>عرض التفاصيل — قريبًا</button></div>
      </article>)}</div> : <div className="directory-empty"><strong>لا توجد نتائج مطابقة</strong><span>غيّر كلمات البحث أو أعد ضبط أحد الفلاتر.</span><button type="button" onClick={() => { setQuery(""); setRegion("الكل"); setSpecialty("الكل"); }}>إعادة ضبط الفلاتر</button></div>}
    </section>
  </main>;
}
