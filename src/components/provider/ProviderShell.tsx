/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { BunyaLogo } from "@/components/brand/BunyaLogo";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { useAuthIdentity } from "@/components/auth/AuthIdentityProvider";
import { AdminIcon as Icon } from "@/components/admin/AdminIcon";
import { lockBodyScroll } from "@/lib/body-scroll-lock";

const sidebarPreferenceKey = "bunya-provider-sidebar-state";
const navigation = [
  ["الرئيسية", "/merchant", "home"],
  ["المنتجات", "/merchant/products", "grid"],
  ["طلبات التحقق والتسعير", "/merchant/quote-requests", "document"],
  ["استجابات التسعير", "/merchant/quotes", "check"],
  ["الطلبات", "/merchant/orders", "flow"],
  ["بوابة السائقين", "/merchant/drivers", "truck"],
  ["المالية والتصفية", "/merchant/finance", "money"],
  ["الإشعارات", "/merchant/notifications", "bell"],
  ["ملف المنشأة", "/merchant/profile", "users"],
  ["السياسات", "/merchant/policies", "shield"],
  ["الدعم والتذاكر", "/merchant/support", "support"],
] as const;

export function ProviderShell({ children }: { children: ReactNode }) {
  const identity = useAuthIdentity();
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [dateLabel, setDateLabel] = useState("");
  const [unread, setUnread] = useState(0);
  const sidebar = useRef<HTMLElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    try { setCollapsed(window.localStorage.getItem(sidebarPreferenceKey) === "collapsed"); } catch { /* Preferences are optional. */ }
    setDateLabel(new Intl.DateTimeFormat("ar-SA", { weekday: "long", day: "numeric", month: "long" }).format(new Date()));
    const media = window.matchMedia("(max-width: 820px)");
    const syncViewport = () => { setMobile(media.matches); if (!media.matches) setDrawerOpen(false); };
    syncViewport();
    media.addEventListener("change", syncViewport);
    return () => media.removeEventListener("change", syncViewport);
  }, []);

  useEffect(() => {
    let active = true;
    setDrawerOpen(false);
    void createClient().from("notifications").select("id", { count: "exact", head: true }).is("read_at", null).then(({ count }) => {
      if (active) setUnread(count ?? 0);
    });
    return () => { active = false; };
  }, [pathname]);

  useEffect(() => {
    if (!drawerOpen || !mobile) return;
    const unlockScroll = lockBodyScroll();
    const returnFocus = menuButton.current;
    sidebar.current?.querySelector<HTMLButtonElement>(".provider-drawer-close")?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); setDrawerOpen(false); }
      if (event.key !== "Tab") return;
      const items = Array.from(sidebar.current?.querySelectorAll<HTMLElement>('a[href],button:not([disabled])') ?? []).filter(item => item.getClientRects().length);
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", handleKey);
    return () => {
      unlockScroll();
      document.removeEventListener("keydown", handleKey);
      returnFocus?.focus();
    };
  }, [drawerOpen, mobile]);

  const toggleCollapsed = () => setCollapsed(current => {
    const next = !current;
    try { window.localStorage.setItem(sidebarPreferenceKey, next ? "collapsed" : "expanded"); } catch { /* Keep the current-session preference. */ }
    return next;
  });
  const currentLabel = navigation.find(([, href]) => href === "/merchant" ? pathname === href : pathname.startsWith(href + "/") || pathname === href)?.[0] ?? "لوحة المزود";
  const companyName = identity.details.provider?.companyName ?? "منشأة بُنية";

  return <div className={`provider-app ${collapsed ? "provider-app-collapsed" : ""}`} data-provider-design="refined" dir="rtl">
    <a className="provider-skip-link" href="#provider-content" inert={mobile && drawerOpen}>انتقل إلى المحتوى</a>
    <button className="provider-drawer-backdrop" aria-label="إغلاق القائمة" tabIndex={-1} type="button" data-open={drawerOpen} onClick={() => setDrawerOpen(false)} />
    <aside ref={sidebar} id="provider-navigation" className="provider-sidebar" data-open={drawerOpen} inert={mobile && !drawerOpen} aria-label="مساحة المزود">
      <div className="provider-sidebar-brand"><Link href="/merchant" aria-label="بُنية — الرئيسية"><BunyaLogo variant="white" sizes="120px" /></Link><span>مساحة المزود</span></div>
      <button className="provider-collapse" type="button" onClick={toggleCollapsed} aria-label={collapsed ? "توسيع القائمة" : "تصغير القائمة"} aria-expanded={!collapsed}><Icon name="arrow" size={17} /></button>
      <button className="provider-drawer-close" type="button" onClick={() => setDrawerOpen(false)} aria-label="إغلاق القائمة"><Icon name="close" /></button>
      <Link className="provider-company-card" href="/merchant/profile" onClick={() => setDrawerOpen(false)} aria-label={`ملف المنشأة: ${companyName}`}>
        <span className="provider-company-initial" aria-hidden="true">{companyName.slice(0, 1)}</span><div><strong>{companyName}</strong><small>إدارة المنشأة والتوريد</small></div>
      </Link>
      <nav aria-label="تنقل لوحة المزود">{navigation.map(([label, href, icon], index) => {
        const active = href === "/merchant" ? pathname === href : pathname === href || pathname.startsWith(href + "/");
        return <div className="provider-nav-item" key={href}>
          {(index === 0 || index === 7) && <p className="provider-nav-label">{index === 0 ? "إدارة الأعمال" : "المنشأة والمساعدة"}</p>}
          <Link href={href} className={active ? "active" : ""} aria-label={label} aria-current={active ? "page" : undefined} title={collapsed ? label : undefined} onClick={() => setDrawerOpen(false)}><span aria-hidden="true"><Icon name={icon} /></span><b>{label}</b>{href === "/merchant/notifications" && unread ? <em>{unread > 99 ? "99+" : unread}</em> : null}</Link>
        </div>;
      })}</nav>
      <div className="provider-sidebar-footer">{identity.activeRoles.includes("customer") && identity.details.customer.exists ? <Link className="provider-logout" href="/customer" title="حساب العميل والمشتريات" aria-label="حساب العميل والمشتريات"><span aria-hidden="true"><Icon name="flow" /></span><b>حساب العميل والمشتريات</b></Link> : null}<LogoutButton className="provider-logout" title="تسجيل الخروج"><span aria-hidden="true"><Icon name="arrow" /></span><b>تسجيل الخروج</b></LogoutButton><small>بُنية · شركاء البناء</small></div>
    </aside>
    <section className="provider-workspace" inert={mobile && drawerOpen}>
      <header className="provider-topbar">
        <div className="provider-topbar-context"><button ref={menuButton} className="provider-mobile-menu" type="button" onClick={() => setDrawerOpen(true)} aria-label="فتح القائمة" aria-expanded={drawerOpen} aria-controls="provider-navigation"><Icon name="menu" /></button><div><p>لوحة المزود</p><strong>{companyName}</strong></div></div>
        <div className="provider-top-actions"><time>{dateLabel}</time><Link href="/merchant/notifications" aria-label={`الإشعارات غير المقروءة ${unread}`}><Icon name="bell" />{unread ? <em>{unread > 99 ? "99+" : unread}</em> : null}</Link><Link href="/merchant/profile" className="provider-account" aria-label="ملف المنشأة">{companyName.slice(0, 1)}</Link></div>
      </header>
      <nav className="provider-breadcrumb" aria-label="مسار الصفحة"><Link href="/merchant"><Icon name="home" size={15} /><span>لوحة المزود</span></Link><span aria-hidden="true">/</span><strong>{currentLabel}</strong></nav>
      <main className="provider-main" id="provider-content" tabIndex={-1}>{children}</main>
    </section>
  </div>;
}
