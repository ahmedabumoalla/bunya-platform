/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { adminGroups } from "@/lib/admin/navigation";
import { AdminIcon } from "./AdminIcon";
import { AdminSectionNav } from "./AdminSectionNav";
import { usePathname } from "next/navigation";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { useAuthIdentity } from "@/components/auth/AuthIdentityProvider";
import { createClient } from "@/lib/supabase/client";

const sidebarPreferenceKey = "bunya-admin-sidebar-state";

const labels = adminGroups.flatMap(([, items]) => items);

export function AdminShell({ children }: { children: ReactNode }) {
  const identity = useAuthIdentity();
  const pathname = usePathname();
  const sidebarRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [date, setDate] = useState("");
  const [search, setSearch] = useState("");
  const [alerts, setAlerts] = useState(0);
  const [unreadNotifications, setUnreadNotifications] = useState(0);

  useEffect(() => {
    let active = true;
    try { setCollapsed(localStorage.getItem(sidebarPreferenceKey) === "collapsed"); } catch { /* Storage may be unavailable. */ }
    setDate(new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", { timeZone: "Asia/Riyadh", weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date()));
    void createClient().from("admin_alerts").select("id", { count: "exact", head: true }).neq("status", "resolved").in("priority", ["high", "critical"]).then(({ count }) => {
      if (active) setAlerts(count ?? 0);
    });
    void createClient().from("notifications").select("id", { count: "exact", head: true }).is("read_at", null).then(({ count }) => {
      if (active) setUnreadNotifications(count ?? 0);
    });
    return () => { active = false; };
  }, [pathname]);

  useEffect(() => {
    if (!drawer) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
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
    return () => { document.body.style.overflow = previous; document.removeEventListener("keydown", keyboard); menu?.focus(); };
  }, [drawer]);

  useEffect(() => {
    const update = () => { void createClient().from("notifications").select("id", { count: "exact", head: true }).is("read_at", null).then(({ count, error }) => { if (!error) setUnreadNotifications(count ?? 0); }); };
    window.addEventListener("bunya:notifications-read", update);
    return () => window.removeEventListener("bunya:notifications-read", update);
  }, []);
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
      <div className="admin-brand"><span>ب</span><div><strong>بُنية</strong><small>إدارة منصة بُنية</small></div></div>
      <div className="admin-system-status"><i /><div><b>مساحة عمل الإدارة</b><small>الأشخاص والعمليات في مكان واحد</small></div></div>
      <button className="admin-collapse" onClick={toggle} aria-label={collapsed ? "توسيع القائمة" : "تصغير القائمة"}>{collapsed ? "‹" : "›"}</button>
      <nav aria-label="تنقل لوحة الإدارة">{adminGroups.map(([group, items]) => <section key={group}><h2>{group}</h2>{items.map(([label, href, icon]) => <Link key={href} href={href} aria-label={label} aria-current={(href === "/admin" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`)) ? "page" : undefined} title={collapsed ? label : undefined} className={(href === "/admin" ? pathname === href : pathname.startsWith(href)) ? "active" : ""} onClick={() => setDrawer(false)}><span><AdminIcon name={icon}/></span><b>{label}</b>{href === "/admin/alerts" && alerts ? <em>{alerts}</em> : null}</Link>)}</section>)}</nav>
      <LogoutButton className="admin-logout"><span>↪</span><b>تسجيل الخروج</b></LogoutButton>
    </aside>
    <section className="admin-workspace">
      <header className="admin-topbar">
        <button ref={menuRef} onClick={() => setDrawer(true)} aria-expanded={drawer} aria-controls="admin-navigation" aria-label="فتح القائمة"><AdminIcon name="menu"/></button>
        <div className="admin-page-identity"><p>لوحة التحكم المركزية</p><h1>{activeLabel}</h1><small>{date}</small></div>
        <div className="admin-global-search" onKeyDown={event => { if (event.key === "Escape") setSearch(""); }}><span><AdminIcon name="search"/></span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="انتقل إلى قسم…" aria-label="البحث الشامل" />{matches.length ? <div>{matches.map(([label, href]) => <Link href={href} key={href} onClick={() => setSearch("")}>{label}</Link>)}</div> : search.trim() ? <div role="status"><p>لا يوجد قسم بهذا الاسم</p></div> : null}</div>
        <div className="admin-top-actions"><Link className="admin-quick" href="/admin/operations">متابعة العمليات</Link><Link href="/admin/notifications" aria-label={`${unreadNotifications} إشعار غير مقروء`}><AdminIcon name="bell"/>{unreadNotifications ? <em>{unreadNotifications}</em> : null}</Link><Link href="/admin/alerts" aria-label={`${alerts} تنبيه حرج`}><AdminIcon name="alert"/>{alerts ? <em>{alerts}</em> : null}</Link><Link className="admin-account" href="/admin/admins" aria-label="حسابات الإدارة والصلاحيات"><span>{viewerName.slice(0, 1)}</span><div><b>{viewerName}</b><small>{roleLabel}</small></div></Link></div>
      </header>
      <div className="admin-breadcrumb"><Link href="/admin">الإدارة</Link><span>←</span><b>{activeLabel}</b></div>
      <main id="admin-main" tabIndex={-1} className="admin-content"><AdminSectionNav />{children}</main>
    </section>
  </div>;
}
