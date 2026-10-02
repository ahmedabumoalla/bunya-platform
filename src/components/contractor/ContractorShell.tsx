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
import { ContractorStatus } from "./ContractorUI";

const sidebarPreferenceKey = "bunya-contractor-sidebar-state";
const navigation = [
  ["الرئيسية", "/contractor", "home"],
  ["فرص المشاريع", "/contractor/opportunities", "search"],
  ["تعليقات المشاريع", "/contractor/project-comments", "document"],
  ["العروض المقدمة", "/contractor/proposals", "check"],
  ["المشاريع", "/contractor/projects", "flow"],
  ["الخدمات والتخصصات", "/contractor/services", "grid"],
  ["معرض الأعمال", "/contractor/portfolio", "grid"],
  ["التقييمات", "/contractor/reviews", "star"],
  ["المالية والتصفية", "/contractor/finance", "money"],
  ["الإشعارات", "/contractor/notifications", "bell"],
  ["الملف المهني", "/contractor/profile", "users"],
  ["المستندات والتحقق", "/contractor/verification", "shield"],
  ["السياسات", "/contractor/policies", "shield"],
  ["الدعم والتذاكر", "/contractor/support", "support"],
] as const;

export function ContractorShell({ children }: { children: ReactNode }) {
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
    const media = window.matchMedia("(max-width: 860px)");
    const syncViewport = () => { setMobile(media.matches); if (!media.matches) setDrawerOpen(false); };
    syncViewport();
    media.addEventListener("change", syncViewport);
    return () => media.removeEventListener("change", syncViewport);
  }, []);

  useEffect(() => {
    let active = true;
    setDrawerOpen(false);
    void createClient().from("contractor_notifications").select("id", { count: "exact", head: true }).is("read_at", null).then(({ count }) => {
      if (active) setUnread(count ?? 0);
    });
    return () => { active = false; };
  }, [pathname]);

  useEffect(() => {
    if (!drawerOpen || !mobile) return;
    const unlockScroll = lockBodyScroll();
    const returnFocus = menuButton.current;
    sidebar.current?.querySelector<HTMLButtonElement>(".contractor-drawer-close")?.focus();
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
  const currentLabel = navigation.find(([, href]) => href === "/contractor" ? pathname === href : pathname.startsWith(href + "/") || pathname === href)?.[0] ?? "لوحة المقاول";
  const companyName = identity.details.contractor?.displayName ?? identity.profile?.fullName ?? "مقاول بُنية";

  return <div className={`contractor-app ${collapsed ? "contractor-app-collapsed" : ""}`} data-contractor-design="refined" dir="rtl">
    <a className="contractor-skip-link" href="#contractor-content" inert={mobile && drawerOpen}>انتقل إلى المحتوى</a>
    <button className="contractor-drawer-backdrop" aria-label="إغلاق القائمة" tabIndex={-1} type="button" data-open={drawerOpen} onClick={() => setDrawerOpen(false)} />
    <aside ref={sidebar} id="contractor-navigation" className="contractor-sidebar" data-open={drawerOpen} inert={mobile && !drawerOpen} aria-label="مساحة المقاول">
      <div className="contractor-sidebar-brand"><Link href="/" aria-label="بُنية — الصفحة الرئيسية للموقع"><BunyaLogo variant="white" sizes="120px" /></Link><span>مساحة المقاول</span></div>
      <button className="contractor-collapse" type="button" onClick={toggleCollapsed} aria-label={collapsed ? "توسيع القائمة" : "تصغير القائمة"} aria-expanded={!collapsed}><Icon name="arrow" size={17} /></button>
      <button className="contractor-drawer-close" type="button" onClick={() => setDrawerOpen(false)} aria-label="إغلاق القائمة"><Icon name="close" /></button>
      <Link className="contractor-company-card" href="/contractor/profile" onClick={() => setDrawerOpen(false)} aria-label={`الملف المهني: ${companyName}`}>
        <span className="contractor-company-initial" aria-hidden="true">{companyName.slice(0, 1)}</span><div><strong>{companyName}</strong><small>أعمالك ومشاريعك في مكان واحد</small></div>
      </Link>
      <nav aria-label="تنقل لوحة المقاول">{navigation.map(([label, href, icon], index) => {
        const active = href === "/contractor" ? pathname === href : pathname === href || pathname.startsWith(href + "/");
        return <div className="contractor-nav-item" key={href}>
          {[0, 5, 9].includes(index) && <p className="contractor-nav-label">{index === 0 ? "المشاريع والعروض" : index === 5 ? "أعمالك وحسابك" : "المتابعة والمساعدة"}</p>}
          <Link href={href} className={active ? "active" : ""} aria-label={label} aria-current={active ? "page" : undefined} title={collapsed ? label : undefined} onClick={() => setDrawerOpen(false)}><span aria-hidden="true"><Icon name={icon} /></span><b>{label}</b>{href === "/contractor/notifications" && unread ? <em>{unread > 99 ? "99+" : unread}</em> : null}</Link>
        </div>;
      })}</nav>
      <div className="contractor-sidebar-footer">
        {identity.activeRoles.includes("customer") && identity.details.customer.exists ? <Link className="contractor-logout" href="/customer" title="حساب العميل والمشتريات" aria-label="حساب العميل والمشتريات"><Icon name="flow" /><b>حساب العميل والمشتريات</b></Link> : null}
        <LogoutButton className="contractor-logout" title="تسجيل الخروج"><span aria-hidden="true"><Icon name="arrow" /></span><b>تسجيل الخروج</b></LogoutButton><small>بُنية · شركاء البناء</small></div>
    </aside>
    <section className="contractor-workspace" inert={mobile && drawerOpen}>
      <header className="contractor-topbar">
        <div className="contractor-topbar-context"><button ref={menuButton} className="contractor-mobile-menu" type="button" onClick={() => setDrawerOpen(true)} aria-label="فتح القائمة" aria-expanded={drawerOpen} aria-controls="contractor-navigation"><Icon name="menu" /></button><div><p>لوحة المقاول</p><strong>{companyName}</strong></div><ContractorStatus value={identity.details.contractor?.approvalStatus ?? "pending"}/></div>
        <div className="contractor-top-actions"><time>{dateLabel}</time><Link href="/contractor/notifications" aria-label={`الإشعارات غير المقروءة ${unread}`}><Icon name="bell" />{unread ? <em>{unread > 99 ? "99+" : unread}</em> : null}</Link><Link href="/contractor/profile" className="contractor-account" aria-label="الملف المهني">{companyName.slice(0, 1)}</Link></div>
      </header>
      <nav className="contractor-breadcrumb" aria-label="مسار الصفحة"><Link href="/contractor"><Icon name="home" size={15} /><span>لوحة المقاول</span></Link><span aria-hidden="true">/</span><strong>{currentLabel}</strong></nav>
      <main className="contractor-content" id="contractor-content" tabIndex={-1}>{children}</main>
    </section>
  </div>;
}
