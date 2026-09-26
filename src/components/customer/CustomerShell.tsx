"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { useAuthIdentity } from "@/components/auth/AuthIdentityProvider";
import { createClient } from "@/lib/supabase/client";
const groups = [
  { title: "المشتريات والمشاريع", links: [
    ["الرئيسية", "/customer", "home"], ["طلب عرض سعر", "/customer/quote-request/new", "plus"],
    ["طلبات عروض الأسعار", "/customer/quote-requests", "list"], ["عروض بُنية", "/customer/quotes", "quote"],
    ["الطلبات", "/customer/orders", "box"], ["متابعة التوصيل", "/customer/deliveries", "truck"],
    ["طلبات المشاريع", "/customer/project-requests", "building"], ["المقاولون المحفوظون", "/customer/contractors", "bookmark"],
  ] },
  { title: "حسابي", links: [
    ["الفواتير والمدفوعات", "/customer/billing", "receipt"], ["الإشعارات", "/customer/notifications", "bell"],
    ["العناوين", "/customer/addresses", "pin"], ["الملف الشخصي", "/customer/profile", "user"],
  ] },
  { title: "المساعدة", links: [["السياسات", "/customer/policies", "shield"], ["الدعم والتذاكر", "/customer/support", "help"]] },
] as const;
const iconPaths: Record<string, string> = {
  home: "m3 10 9-7 9 7M5 9v12h14V9M9 21v-8h6v8", plus: "M12 5v14M5 12h14",
  list: "M8 6h12M8 12h12M8 18h12M3 6h.1M3 12h.1M3 18h.1", quote: "m12 3 9 9-9 9-9-9 9-9ZM8 12h8",
  box: "m3 7 9-4 9 4-9 4-9-4Zm0 0v10l9 4 9-4V7M12 11v10M8 5l9 4",
  truck: "M3 5h11v12H3V5Zm11 4h4l3 4v4h-7M7 17a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm11 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z",
  building: "M4 21V7h8V3h8v18M8 11h.1M8 15h.1M16 7h.1M16 11h.1M16 15h.1M2 21h20",
  bookmark: "M6 3h12v18l-6-4-6 4V3Z", receipt: "M5 3h14v18l-3-2-4 2-4-2-3 2V3ZM9 7h6M9 11h6M9 15h3",
  bell: "M18 8a6 6 0 0 0-12 0c0 7-3 8-3 8h18s-3-1-3-8M10 20h4",
  pin: "M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0ZM12 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z",
  user: "M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM4 21v-2a8 8 0 0 1 16 0v2",
  shield: "m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Zm-4 9 3 3 5-6",
  help: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM9 9a3 3 0 0 1 6 0c0 2-3 2-3 5M12 17h.1",
  menu: "M4 6h16M4 12h16M4 18h16", close: "m6 6 12 12M6 18 18 6", logout: "M10 4H4v16h6M10 12h11m-4-4 4 4-4 4",
};
export function CustomerIcon({ name }: { name: string }) {
  return <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={iconPaths[name] ?? iconPaths.box} /></svg>;
}
export function CustomerShell({ children }: { children: ReactNode }) {
  const identity = useAuthIdentity(), pathname = usePathname();
  const viewerName = identity.profile?.fullName ?? "عميل بُنية";
  const [collapsed, setCollapsed] = useState(false), [drawer, setDrawer] = useState(false), [unread, setUnread] = useState(0);
  const [compact, setCompact] = useState(false);
  const aside = useRef<HTMLElement>(null), menu = useRef<HTMLButtonElement>(null);
  const isActive = (href: string) => href === "/customer" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  const label = groups.flatMap(group => [...group.links]).find(([, href]) => isActive(href))?.[0] ?? "حساب العميل";
  useEffect(() => { Promise.resolve().then(() => { try { setCollapsed(localStorage.getItem("bunya-customer-sidebar-state") === "collapsed"); } catch { /* Optional preference. */ } }); }, []);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 820px)");
    const update = () => setCompact(media.matches);
    Promise.resolve().then(update);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    let active = true;
    const refresh = () => { void createClient().from("customer_notifications").select("id", { count: "exact", head: true }).eq("customer_profile_id", identity.userId).is("read_at", null).then(({ count, error }) => { if (active && !error) setUnread(count ?? 0); }); };
    refresh(); window.addEventListener("customer-notifications-updated", refresh);
    return () => { active = false; window.removeEventListener("customer-notifications-updated", refresh); };
  }, [pathname, identity.userId]);
  useEffect(() => {
    if (!drawer) return;
    const previousOverflow = document.body.style.overflow;
    const returnFocus = menu.current;
    document.body.style.overflow = "hidden";
    aside.current?.querySelector<HTMLButtonElement>(".customer-mobile-close")?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setDrawer(false); return; }
      if (event.key !== "Tab") return;
      const items = Array.from(aside.current?.querySelectorAll<HTMLElement>('a[href],button:not([disabled])') ?? []).filter(item => item.getClientRects().length);
      const first = items[0], last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    const breakpoint = window.matchMedia("(min-width: 821px)");
    const resize = () => { if (breakpoint.matches) setDrawer(false); };
    document.addEventListener("keydown", keydown); breakpoint.addEventListener("change", resize);
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener("keydown", keydown); breakpoint.removeEventListener("change", resize); returnFocus?.focus(); };
  }, [drawer]);
  const toggle = () => setCollapsed(value => { try { localStorage.setItem("bunya-customer-sidebar-state", value ? "expanded" : "collapsed"); } catch { /* Keep usable without storage. */ } return !value; });
  return <div className={`customer-app${collapsed ? " collapsed" : ""}`}>
    <a className="customer-skip" href="#customer-content">الانتقال إلى المحتوى</a>
    <button className="customer-drawer-backdrop" data-open={drawer} onClick={() => setDrawer(false)} tabIndex={-1} aria-label="إغلاق القائمة" />
    <aside ref={aside} id="customer-navigation" className="customer-sidebar" data-open={drawer} inert={compact && !drawer} role={drawer ? "dialog" : undefined} aria-modal={drawer || undefined} aria-label="قائمة حساب العميل">
      <div className="customer-brand"><Link href="/customer" aria-label="بُنية الرئيسية" onClick={() => setDrawer(false)}>ب</Link><div><strong>بُنية</strong><small>مساحة العميل</small></div><button className="customer-mobile-close" onClick={() => setDrawer(false)} aria-label="إغلاق القائمة"><CustomerIcon name="close" /></button></div>
      <button className="customer-collapse" onClick={toggle} aria-label={collapsed ? "توسيع القائمة" : "تصغير القائمة"} aria-expanded={!collapsed}>{collapsed ? "‹" : "›"}</button>
      <nav aria-label="أقسام حساب العميل">{groups.map(group => <div className="customer-nav-group" key={group.title}><p>{group.title}</p>{group.links.map(([name, href, icon]) => <Link key={href} href={href} title={collapsed ? name : undefined} aria-label={name} aria-current={isActive(href) ? "page" : undefined} className={isActive(href) ? "active" : ""} onClick={() => setDrawer(false)}><span><CustomerIcon name={icon} /></span><b>{name}</b>{icon === "bell" && unread > 0 ? <em>{unread > 99 ? "99+" : unread}</em> : null}</Link>)}</div>)}</nav>
      <div className="customer-sidebar-footer"><Link href="/customer/profile" onClick={() => setDrawer(false)} className="customer-account"><span>{viewerName.slice(0, 1)}</span><div><strong>{viewerName}</strong><small>إدارة حسابك</small></div></Link><LogoutButton className="customer-logout"><span><CustomerIcon name="logout" /></span><b>تسجيل الخروج</b></LogoutButton></div>
    </aside>
    <section className="customer-workspace" inert={drawer}>
      <header className="customer-topbar"><button ref={menu} onClick={() => setDrawer(true)} aria-label="فتح القائمة" aria-expanded={drawer} aria-controls="customer-navigation"><CustomerIcon name="menu" /></button><div className="customer-current-section"><p>مساحتك في بُنية</p><strong>{label}</strong></div><div className="customer-top-actions"><Link className="customer-quick" href="/customer/quote-request/new"><CustomerIcon name="plus" /> طلب عرض سعر</Link><Link href="/customer/notifications" aria-label={`الإشعارات${unread ? `، ${unread} غير مقروءة` : ""}`}><CustomerIcon name="bell" />{unread > 0 ? <em>{unread > 99 ? "99+" : unread}</em> : null}</Link><Link href="/customer/profile" aria-label="الملف الشخصي">{viewerName.slice(0, 1)}</Link></div></header>
      <div className="customer-breadcrumb"><Link href="/customer">حساب العميل</Link><span aria-hidden="true">/</span><span>{label}</span><Link href="/products" className="customer-catalog-link">تصفح المنتجات ←</Link></div>
      <div id="customer-content" tabIndex={-1} className="customer-content">{children}</div>
    </section>
  </div>;
}
