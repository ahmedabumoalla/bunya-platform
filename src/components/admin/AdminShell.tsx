/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { useAuthIdentity } from "@/components/auth/AuthIdentityProvider";
import { adminStorageKeys } from "@/lib/admin-storage";
import { createClient } from "@/lib/supabase/client";

type AdminNavItem = readonly [label: string, href: string, icon: string];
type AdminNavGroup = readonly [label: string, items: readonly AdminNavItem[]];
const groups: readonly AdminNavGroup[] = [
  ["القيادة والتشغيل", [["مركز القيادة", "/admin", "⌂"], ["مركز العمليات", "/admin/operations", "◉"], ["التنبيهات الحرجة", "/admin/alerts", "!"]]],
  ["المستخدمون والانضمام", [["المستخدمون", "/admin/users", "♙"], ["طلبات المزودين", "/admin/join-requests/providers", "▦"], ["طلبات المقاولين", "/admin/join-requests/contractors", "▤"], ["السائقون", "/admin/drivers", "⌖"], ["المدراء والصلاحيات", "/admin/admins", "⚿"]]],
  ["المنتجات والتوريد", [["التصنيفات والمنتجات", "/admin/catalog", "▦"], ["مراجعة المنتجات", "/admin/products/review", "✓"], ["الأسعار والتوفر", "/admin/pricing", "◈"], ["محرك التوريد", "/admin/sourcing", "⌘"], ["عروض بُنية", "/admin/bunya-quotes", "◇"]]],
  ["الطلبات والتنفيذ", [["طلبات المنتجات", "/admin/quote-requests", "◫"], ["الطلبات", "/admin/orders", "▤"], ["التوصيل والسائقون", "/admin/deliveries", "⌖"], ["مراقبة التوصيل", "/admin/delivery-monitoring", "◎"], ["أكواد التسليم", "/admin/delivery-codes", "#"]]],
  ["المقاولات", [["طلبات المشاريع", "/admin/project-requests", "▥"], ["فرص المشاريع", "/admin/contractor-opportunities", "◫"], ["عروض المقاولين", "/admin/contractor-proposals", "◈"], ["المشاريع", "/admin/contractor-projects", "▤"], ["مراجعة التعليقات", "/admin/project-comments", "✎"], ["مستندات المقاولين", "/admin/contractor-documents", "▧"], ["التقييمات", "/admin/reviews", "★"]]],
  ["المالية", [["المركز المالي", "/admin/finance", "◉"], ["تصفيات المزودين", "/admin/settlements/providers", "⇄"], ["تصفيات المقاولين", "/admin/settlements/contractors", "⇄"], ["الفواتير والاسترجاعات", "/admin/invoices", "▧"]]],
  ["التواصل والحوكمة", [["الإشعارات", "/admin/notifications", "◌"], ["الدعم والتذاكر", "/admin/support", "?"], ["السياسات", "/admin/policies", "§"], ["سجل التدقيق", "/admin/audit", "☷"], ["إعدادات المنصة", "/admin/settings", "⚙"]]],
];
const labels = groups.flatMap(([, items]) => items);

export function AdminShell({ children }: { children: ReactNode }) {
  const identity = useAuthIdentity();
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [date, setDate] = useState("");
  const [search, setSearch] = useState("");
  const [alerts, setAlerts] = useState(0);

  useEffect(() => {
    let active = true;
    setCollapsed(localStorage.getItem(adminStorageKeys.sidebar) === "collapsed");
    setDate(new Intl.DateTimeFormat("ar-SA", { weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date()));
    void createClient().from("admin_alerts").select("id", { count: "exact", head: true }).neq("status", "resolved").in("priority", ["high", "critical"]).then(({ count }) => {
      if (active) setAlerts(count ?? 0);
    });
    return () => { active = false; };
  }, [pathname]);

  const toggle = () => setCollapsed((current) => {
    const next = !current;
    localStorage.setItem(adminStorageKeys.sidebar, next ? "collapsed" : "expanded");
    return next;
  });
  const activeLabel = labels.find(([, href]) => href === "/admin" ? pathname === href : pathname.startsWith(href))?.[0] ?? "إدارة منصة بُنية";
  const matches = useMemo(() => search.trim() ? labels.filter(([label]) => label.includes(search.trim())).slice(0, 6) : [], [search]);
  const viewerName = identity.profile?.fullName ?? "مدير بُنية";
  const roleLabel = identity.details.admin?.roleKey === "super_admin" ? "Super Admin" : identity.details.admin?.roleKey ?? "Admin";

  return <div className={`admin-app ${collapsed ? "collapsed" : ""}`}>
    <button className="admin-drawer-backdrop" data-open={drawer} onClick={() => setDrawer(false)} aria-label="إغلاق القائمة" />
    <aside className="admin-sidebar" data-open={drawer}>
      <div className="admin-brand"><span>ب</span><div><strong>بُنية</strong><small>إدارة منصة بُنية</small></div></div>
      <div className="admin-system-status"><i /><div><b>متصل بقاعدة البيانات</b><small>البيانات المعروضة تخضع لصلاحيات الحساب</small></div></div>
      <button className="admin-collapse" onClick={toggle} aria-label={collapsed ? "توسيع القائمة" : "تصغير القائمة"}>{collapsed ? "‹" : "›"}</button>
      <nav aria-label="تنقل لوحة الإدارة">{groups.map(([group, items]) => <section key={group}><h2>{group}</h2>{items.map(([label, href, icon]) => <Link key={href} href={href} title={collapsed ? label : undefined} className={(href === "/admin" ? pathname === href : pathname.startsWith(href)) ? "active" : ""} onClick={() => setDrawer(false)}><span>{icon}</span><b>{label}</b>{href === "/admin/alerts" && alerts ? <em>{alerts}</em> : null}</Link>)}</section>)}</nav>
      <LogoutButton className="admin-logout"><span>↪</span><b>تسجيل الخروج</b></LogoutButton>
    </aside>
    <section className="admin-workspace">
      <header className="admin-topbar">
        <button onClick={() => setDrawer(true)} aria-label="فتح القائمة">☰</button>
        <div className="admin-page-identity"><p>لوحة التحكم المركزية</p><h1>{activeLabel}</h1><small>{date}</small></div>
        <div className="admin-global-search"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="بحث شامل في وحدات الإدارة" aria-label="البحث الشامل" />{matches.length ? <div>{matches.map(([label, href]) => <Link href={href} key={href} onClick={() => setSearch("")}>{label}</Link>)}</div> : null}</div>
        <div className="admin-top-actions"><Link className="admin-quick" href="/admin/operations">متابعة العمليات</Link><Link href="/admin/notifications" aria-label="مركز الإشعارات">◌</Link><Link href="/admin/alerts" aria-label={`${alerts} تنبيه حرج`}>!{alerts ? <em>{alerts}</em> : null}</Link><button aria-label="قائمة حساب المدير"><span>{viewerName.slice(0, 1)}</span><div><b>{viewerName}</b><small>{roleLabel}</small></div></button></div>
      </header>
      <div className="admin-breadcrumb"><Link href="/admin">الإدارة</Link><span>←</span><b>{activeLabel}</b></div>
      <main className="admin-content">{children}</main>
    </section>
  </div>;
}
