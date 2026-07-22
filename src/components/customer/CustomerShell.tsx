/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { useAuthIdentity } from "@/components/auth/AuthIdentityProvider";
import { customerStorageKeys } from "@/lib/customer-storage";
import { createClient } from "@/lib/supabase/client";

const nav = [
  ["الرئيسية", "/customer", "⌂"],
  ["طلبات المشاريع", "/customer/project-requests", "▥"],
  ["طلب عرض سعر", "/customer/quote-request/new", "＋"],
  ["طلبات عروض الأسعار", "/customer/quote-requests", "◫"],
  ["عروض بُنية", "/customer/quotes", "◈"],
  ["الطلبات", "/customer/orders", "▤"],
  ["التوصيل والاستلام", "/customer/deliveries", "⌖"],
  ["المقاولون المحفوظون", "/customer/contractors", "☆"],
  ["الفواتير والمدفوعات", "/customer/billing", "▧"],
  ["الإشعارات", "/customer/notifications", "◌"],
  ["العناوين", "/customer/addresses", "◇"],
  ["الملف الشخصي", "/customer/profile", "♙"],
  ["الدعم والسياسات", "/customer/support", "?"],
] as const;

export function CustomerShell({ children }: { children: ReactNode }) {
  const identity = useAuthIdentity();
  const viewerName = identity.profile?.fullName ?? "عميل بُنية";
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [date, setDate] = useState("");
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    let active = true;
    setCollapsed(localStorage.getItem(customerStorageKeys.sidebar) === "collapsed");
    setDate(new Intl.DateTimeFormat("ar-SA", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date()));
    void createClient().from("customer_notifications").select("id", { count: "exact", head: true }).is("read_at", null).then(({ count }) => {
      if (active) setUnread(count ?? 0);
    });
    return () => { active = false; };
  }, [pathname]);

  const toggle = () => setCollapsed((value) => {
    localStorage.setItem(customerStorageKeys.sidebar, !value ? "collapsed" : "expanded");
    return !value;
  });
  const label = nav.find(([, href]) => href === "/customer" ? pathname === href : pathname.startsWith(href))?.[0] ?? "لوحة العميل";

  return <div className={`customer-app ${collapsed ? "collapsed" : ""}`}>
    <button className="customer-drawer-backdrop" data-open={drawer} onClick={() => setDrawer(false)} aria-label="إغلاق القائمة" />
    <aside className="customer-sidebar" data-open={drawer}>
      <div className="customer-brand"><span>ب</span><div><strong>بُنية</strong><small>{viewerName}</small></div></div>
      <button className="customer-collapse" onClick={toggle} aria-label="تصغير القائمة">{collapsed ? "‹" : "›"}</button>
      <nav>{nav.map(([name, href, icon]) => <Link key={href} href={href} title={collapsed ? name : undefined} className={(href === "/customer" ? pathname === href : pathname.startsWith(href)) ? "active" : ""} onClick={() => setDrawer(false)}><span>{icon}</span><b>{name}</b>{name === "الإشعارات" && unread ? <em>{unread}</em> : null}</Link>)}</nav>
      <LogoutButton className="customer-logout"><span>↪</span><b>تسجيل الخروج</b></LogoutButton>
    </aside>
    <section className="customer-workspace">
      <header className="customer-topbar">
        <button onClick={() => setDrawer(true)} aria-label="فتح القائمة">☰</button>
        <div><p>مرحبًا، {viewerName.split(" ")[0]}</p><h1>{viewerName}</h1><small>{date}</small></div>
        <div className="customer-top-actions"><Link className="customer-quick" href="/customer/quote-request/new">＋ طلب عرض سعر جديد</Link><Link href="/customer/notifications" aria-label="الإشعارات">◌{unread ? <em>{unread}</em> : null}</Link><Link href="/customer/profile" aria-label="الحساب">{viewerName.slice(0, 1)}</Link></div>
      </header>
      <div className="customer-breadcrumb"><Link href="/customer">لوحة العميل</Link><span>←</span><b>{label}</b></div>
      <main className="customer-content">{children}</main>
    </section>
  </div>;
}
