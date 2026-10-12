/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import { lockBodyScroll } from "@/lib/body-scroll-lock";
import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { adminGroups } from "@/lib/admin/navigation";
import { AdminIcon } from "./AdminIcon";
import { AdminSectionNav } from "./AdminSectionNav";
import { usePathname } from "next/navigation";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { useAuthIdentity } from "@/components/auth/AuthIdentityProvider";
import { BunyaLogo } from "@/components/brand/BunyaLogo";
import { AdminAttentionBadge, AdminAttentionProvider, useAdminAttention } from "./AdminAttentionProvider";

const sidebarPreferenceKey = "bunya-admin-sidebar-state";

const labels = adminGroups.flatMap(([, items]) => items);

export function AdminShell({ children }: { children: ReactNode }) {
  return <AdminAttentionProvider><AdminShellContent>{children}</AdminShellContent></AdminAttentionProvider>;
}

function AdminShellContent({ children }: { children: ReactNode }) {
  const identity = useAuthIdentity();
  const pathname = usePathname();
  const sidebarRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [date, setDate] = useState("");
  const [search, setSearch] = useState("");
  const attention = useAdminAttention();
  const alerts = attention.counts["/admin/alerts"];
  const unreadNotifications = attention.counts["/admin/notifications"];

  useEffect(() => {
    try { setCollapsed(localStorage.getItem(sidebarPreferenceKey) === "collapsed"); } catch { /* Storage may be unavailable. */ }
    setDate(new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", { timeZone: "Asia/Riyadh", weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date()));
  }, [pathname]);

  useEffect(() => {
    if (!drawer) return;
    const unlockScroll = lockBodyScroll();
    const sidebar = sidebarRef.current;
    const menu = menuRef.current;
    sidebar?.querySelector<HTMLButtonElement>("button")?.focus();
    function keyboard(event: KeyboardEvent) {
      if (event.key === "Escape") setDrawer(false);
      if (event.key !== "Tab" || !sidebar) return;
      const items = [...sidebar.querySelectorAll<HTMLElement>("a, button")].filter(item => item.offsetParent !== null);
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    document.addEventListener("keydown", keyboard);
    return () => { unlockScroll(); document.removeEventListener("keydown", keyboard); menu?.focus(); };
  }, [drawer]);

  const toggle = () => setCollapsed((current) => {
    const next = !current;
    try { localStorage.setItem(sidebarPreferenceKey, next ? "collapsed" : "expanded"); } catch { /* Keep this session preference. */ }
    return next;
  });
  const activeLabel = [...labels].sort((a, b) => b[1].length - a[1].length).find(([, href]) => href === "/admin" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`))?.[0] ?? "إدارة منصة بُنية";
  const matches = useMemo(() => search.trim() ? labels.filter(([label]) => label.includes(search.trim())).slice(0, 6) : [], [search]);
  const viewerName = identity.profile?.fullName ?? "مدير بُنية";
  const roleLabel = identity.details.admin?.roleKey === "super_admin" ? "مدير النظام" : "إدارة المنصة";

  return <div className={`admin-app ${collapsed ? "collapsed" : ""}`}>
    <a href="#admin-main" className="admin-skip">انتقل إلى محتوى الصفحة</a><button className="admin-drawer-backdrop" data-open={drawer} onClick={() => setDrawer(false)} aria-label="إغلاق القائمة" />
    <aside role={drawer ? "dialog" : undefined} aria-modal={drawer || undefined} aria-label="تنقل لوحة الإدارة" id="admin-navigation" ref={sidebarRef} className="admin-sidebar" data-open={drawer}>
<button className="admin-drawer-close" onClick={() => setDrawer(false)} aria-label="إغلاق القائمة"><AdminIcon name="close"/></button>
      <Link href="/" className="admin-brand" aria-label="بُنية — الصفحة الرئيسية للموقع" onClick={() => setDrawer(false)}><BunyaLogo sizes="140px"/><div><small>إدارة المنصة</small></div></Link>
      <div className="admin-system-status"><div><b>قائمة المتابعة</b><small>الأرقام تشير لما ينتظر إجراءك</small></div></div>
      <button className="admin-collapse" onClick={toggle} aria-label={collapsed ? "توسيع القائمة" : "تصغير القائمة"}>{collapsed ? "‹" : "›"}</button>
      <nav aria-label="تنقل لوحة الإدارة">{adminGroups.map(([group, items]) => <section key={group}><h2>{group}</h2>{items.map(([label, href, icon]) => <Link key={href} href={href} aria-label={attention.counts[href] ? `${label}، ${attention.counts[href]} بانتظار المتابعة` : label} aria-current={(href === "/admin" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`)) ? "page" : undefined} title={collapsed ? label : undefined} className={(href === "/admin" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`)) ? "active" : ""} onClick={() => setDrawer(false)}><span><AdminIcon name={icon}/></span><b>{label}</b><AdminAttentionBadge href={href}/></Link>)}</section>)}</nav>
      <LogoutButton className="admin-logout"><span>↪</span><b>تسجيل الخروج</b></LogoutButton>
    </aside>
    <section className="admin-workspace">
      <header className="admin-topbar">
        <button ref={menuRef} onClick={() => setDrawer(true)} aria-expanded={drawer} aria-controls="admin-navigation" aria-label="فتح القائمة"><AdminIcon name="menu"/></button>
        <div className="admin-page-identity"><p>لوحة التحكم المركزية</p><h1>{activeLabel}</h1><small>{date}</small></div>
        <div className="admin-global-search" onKeyDown={event => { if (event.key === "Escape") setSearch(""); }}><span><AdminIcon name="search"/></span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="انتقل إلى قسم…" aria-label="البحث الشامل" />{matches.length ? <div>{matches.map(([label, href]) => <Link href={href} key={href} onClick={() => setSearch("")}>{label}</Link>)}</div> : search.trim() ? <div role="status"><p>لا يوجد قسم بهذا الاسم</p></div> : null}</div>
        <div className="admin-top-actions"><Link className="admin-quick" href="/admin/operations">متابعة العمليات</Link><Link href="/admin/notifications" aria-label={unreadNotifications == null ? "الإشعارات" : `${unreadNotifications} إشعار غير مقروء`}><AdminIcon name="bell"/><AdminAttentionBadge href="/admin/notifications"/></Link><Link href="/admin/alerts" aria-label={alerts == null ? "التنبيهات" : `${alerts} تنبيه بانتظار المتابعة`}><AdminIcon name="alert"/><AdminAttentionBadge href="/admin/alerts"/></Link><Link className="admin-account" href="/admin/admins" aria-label="حسابات الإدارة والصلاحيات"><span>{viewerName.slice(0, 1)}</span><div><b>{viewerName}</b><small>{roleLabel}</small></div></Link></div>
      </header>
      <div className="admin-breadcrumb"><Link href="/admin">الإدارة</Link><span>←</span><b>{activeLabel}</b></div>
      <main id="admin-main" tabIndex={-1} className="admin-content"><AdminSectionNav />{children}</main>
    </section>
  </div>;
}
