/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { useAuthIdentity } from "@/components/auth/AuthIdentityProvider";
import { contractorStorageKeys } from "@/lib/contractor-storage";
import { createClient } from "@/lib/supabase/client";
import { ContractorStatus } from "./ContractorUI";

const nav = [
  ["الرئيسية", "/contractor", "⌂"],
  ["فرص المشاريع", "/contractor/opportunities", "◫"],
  ["تعليقات المشاريع", "/contractor/project-comments", "✎"],
  ["العروض المقدمة", "/contractor/proposals", "◈"],
  ["المشاريع", "/contractor/projects", "▤"],
  ["الخدمات والتخصصات", "/contractor/services", "▦"],
  ["معرض الأعمال", "/contractor/portfolio", "▧"],
  ["التقييمات", "/contractor/reviews", "★"],
  ["المالية والتصفية", "/contractor/finance", "◉"],
  ["الإشعارات", "/contractor/notifications", "◌"],
  ["الملف المهني", "/contractor/profile", "♙"],
  ["المستندات والتحقق", "/contractor/verification", "✓"],
  ["الدعم والسياسات", "/contractor/support", "?"],
] as const;

export function ContractorShell({ children }: { children: ReactNode }) {
  const identity = useAuthIdentity();
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [date, setDate] = useState("");
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    let active = true;
    setCollapsed(localStorage.getItem(contractorStorageKeys.sidebar) === "collapsed");
    setDate(new Intl.DateTimeFormat("ar-SA", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date()));
    void createClient().from("contractor_notifications").select("id", { count: "exact", head: true }).is("read_at", null).then(({ count }) => {
      if (active) setUnread(count ?? 0);
    });
    return () => { active = false; };
  }, [pathname]);

  const toggle = () => setCollapsed((value) => {
    const next = !value;
    localStorage.setItem(contractorStorageKeys.sidebar, next ? "collapsed" : "expanded");
    return next;
  });
  const label = nav.find(([, href]) => href === "/contractor" ? pathname === href : pathname.startsWith(href))?.[0] ?? "لوحة المقاول";
  const viewerName = identity.profile?.fullName ?? identity.details.contractor?.displayName ?? "مقاول بُنية";
  const companyName = identity.details.contractor?.displayName ?? "منشأة مقاولات";

  return <div className={`contractor-app ${collapsed ? "collapsed" : ""}`}>
    <button className="contractor-drawer-backdrop" data-open={drawer} onClick={() => setDrawer(false)} aria-label="إغلاق القائمة" />
    <aside className="contractor-sidebar" data-open={drawer}>
      <div className="contractor-brand"><span>{companyName.slice(0, 1)}</span><div><strong>بُنية</strong><small>{companyName}</small></div></div>
      <button className="contractor-collapse" onClick={toggle} aria-label={collapsed ? "توسيع القائمة" : "تصغير القائمة"}>{collapsed ? "‹" : "›"}</button>
      <nav aria-label="تنقل لوحة المقاول">{nav.map(([name, href, icon]) => <Link key={href} href={href} title={collapsed ? name : undefined} className={(href === "/contractor" ? pathname === href : pathname.startsWith(href)) ? "active" : ""} onClick={() => setDrawer(false)}><span aria-hidden>{icon}</span><b>{name}</b>{name === "الإشعارات" && unread ? <em>{unread}</em> : null}</Link>)}</nav>
      <LogoutButton className="contractor-logout"><span>↪</span><b>تسجيل الخروج</b></LogoutButton>
    </aside>
    <section className="contractor-workspace">
      <header className="contractor-topbar">
        <button onClick={() => setDrawer(true)} aria-label="فتح القائمة">☰</button>
        <div><p>مرحبًا بعودتك، {viewerName}</p><h1>{companyName}</h1><small>{date}</small></div>
        <ContractorStatus value={identity.details.contractor?.approvalStatus ?? "pending"} />
        <div className="contractor-top-actions"><Link className="contractor-quick" href="/contractor/opportunities">استعراض فرص المشاريع</Link><Link href="/contractor/notifications" aria-label={`الإشعارات غير المقروءة ${unread}`}>◌{unread ? <em>{unread}</em> : null}</Link><Link href="/contractor/profile" aria-label="الملف المهني">{viewerName.slice(0, 1)}</Link></div>
      </header>
      <div className="contractor-breadcrumb"><Link href="/contractor">لوحة المقاول</Link><span>←</span><b>{label}</b></div>
      <main className="contractor-content">{children}</main>
    </section>
  </div>;
}
