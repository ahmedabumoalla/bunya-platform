/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { notificationsMock, providerProfileMock } from "@/lib/provider-data";
import { providerStorageKeys, readProviderCollection } from "@/lib/provider-storage";
import { BunyaLogo } from "@/components/brand/BunyaLogo";

const navigation = [
  ["الرئيسية", "/merchant", "⌂"],
  ["المنتجات", "/merchant/products", "▦"],
  ["طلبات التحقق والتسعير", "/merchant/quote-requests", "◫"],
  ["استجابات التسعير", "/merchant/quotes", "◈"],
  ["الطلبات", "/merchant/orders", "▤"],
  ["بوابة السائقين", "/merchant/drivers", "➤"],
  ["المالية والتصفية", "/merchant/finance", "◉"],
  ["الإشعارات", "/merchant/notifications", "◌"],
  ["ملف المنشأة", "/merchant/profile", "◇"],
  ["السياسات والدعم", "/merchant/support", "?"],
] as const;

export function ProviderShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [dateLabel, setDateLabel] = useState("");
  const [unread, setUnread] = useState(notificationsMock.filter((item) => !item.read).length);

  /* Browser-only preferences and notification subscription hydrate after mount. */
  useEffect(() => {
    setCollapsed(window.localStorage.getItem(providerStorageKeys.sidebar) === "collapsed");
    setDateLabel(new Intl.DateTimeFormat("ar-SA", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date()));
    setUnread(readProviderCollection("notifications").filter((item) => !item.read).length);
    const update = () => setUnread(readProviderCollection("notifications").filter((item) => !item.read).length);
    window.addEventListener("bunya-provider-data", update);
    return () => window.removeEventListener("bunya-provider-data", update);
  }, [pathname]);

  const toggleCollapsed = () => setCollapsed((current) => {
    const next = !current;
    window.localStorage.setItem(providerStorageKeys.sidebar, next ? "collapsed" : "expanded");
    return next;
  });
  const currentLabel = navigation.find(([, href]) => href === "/merchant" ? pathname === href : pathname.startsWith(href))?.[0] ?? "لوحة المزود";

  return <div className={`provider-app ${collapsed ? "provider-app-collapsed" : ""}`}>
    <button className="provider-drawer-backdrop" aria-label="إغلاق القائمة" type="button" data-open={drawerOpen} onClick={() => setDrawerOpen(false)} />
    <aside className="provider-sidebar" data-open={drawerOpen}>
      <div className="provider-sidebar-brand"><BunyaLogo /><div><small>{providerProfileMock.companyName}</small></div></div>
      <button className="provider-collapse" type="button" onClick={toggleCollapsed} aria-label={collapsed ? "توسيع القائمة" : "تصغير القائمة"}>{collapsed ? "‹" : "›"}</button>
      <nav aria-label="تنقل لوحة المزود">{navigation.map(([label, href, icon]) => {
        const active = href === "/merchant" ? pathname === href : pathname.startsWith(href);
        return <Link key={href} href={href} className={active ? "active" : ""} title={collapsed ? label : undefined} onClick={() => setDrawerOpen(false)}><span aria-hidden>{icon}</span><b>{label}</b>{label === "الإشعارات" && unread ? <em>{unread}</em> : null}</Link>;
      })}</nav>
      <Link href="/login" onClick={()=>localStorage.removeItem("bunya-local-session")} className="provider-logout" title={collapsed ? "تسجيل الخروج" : undefined}><span aria-hidden>↪</span><b>تسجيل الخروج</b></Link>
    </aside>
    <section className="provider-workspace">
      <header className="provider-topbar">
        <button className="provider-mobile-menu" type="button" onClick={() => setDrawerOpen(true)} aria-label="فتح القائمة">☰</button>
        <div><p>مرحبًا بعودتك، {providerProfileMock.contactName.split(" ")[0]}</p><h1>{providerProfileMock.companyName}</h1><small>{dateLabel}</small></div>
        <div className="provider-top-actions"><Link href="/merchant/notifications" aria-label={`الإشعارات غير المقروءة ${unread}`}><span>◌</span>{unread ? <em>{unread}</em> : null}</Link><Link href="/merchant/profile" className="provider-account" aria-label="ملف المنشأة">{providerProfileMock.logoLabel}</Link></div>
      </header>
      <div className="provider-breadcrumb"><Link href="/merchant">لوحة المزود</Link><span>/</span><strong>{currentLabel}</strong></div>
      <main className="provider-main">{children}</main>
    </section>
  </div>;
}
