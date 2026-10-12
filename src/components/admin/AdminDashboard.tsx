"use client";

import Link from "next/link";
import { useState } from "react";
import { adminGroups } from "@/lib/admin/navigation";
import { AdminIcon } from "./AdminIcon";
import { AdminAttentionBadge, useAdminAttention } from "./AdminAttentionProvider";

const queues = [
  { title: "المحادثات والعروض", href: "/admin/conversations", icon: "support" },
  { title: "طلبات الموردين", href: "/admin/join-requests/providers", icon: "users" },
  { title: "طلبات المقاولين", href: "/admin/join-requests/contractors", icon: "shield" },
  { title: "مراجعة المنتجات", href: "/admin/products/review", icon: "grid" },
  { title: "التنبيهات المفتوحة", href: "/admin/alerts", icon: "alert" },
  { title: "تصفيات المقاولين", href: "/admin/settlements/contractors", icon: "money" },
] as const;

export function AdminDashboard() {
  const { counts, loading, refresh } = useAdminAttention();
  const [query, setQuery] = useState("");
  const count = (href: string) => loading && counts[href] == null ? "…" : counts[href] == null ? "—" : counts[href].toLocaleString("ar-SA-u-nu-latn");
  const groups = adminGroups.map(([label, items]) => ({label, items: items.filter(([name]) => name.includes(query.trim()) || label.includes(query.trim()))})).filter(group => group.items.length);

  return <div className="admin-dashboard">
    <header className="admin-welcome">
      <div><span className="admin-eyebrow">إدارة بُنية</span><h1>نظرة على العمل</h1><p>الطلبات والإجراءات التي تحتاج متابعتك.</p></div>
      <div className="admin-welcome-actions"><Link href="/admin/operations">العمليات <AdminIcon name="arrow" size={18}/></Link><Link href="/admin/finance">الملخص المالي</Link></div>
    </header>
    <div className="admin-block-title"><div><h2>بانتظار الإجراء</h2><p>الأرقام تتحدث مع حالة العمل</p></div><button onClick={refresh} disabled={loading} aria-label="تحديث أعداد الطلبات والإجراءات">{loading ? "جارٍ التحديث…" : "تحديث"}</button></div>
    <section className="admin-priority-grid" aria-label="الإجراءات المطلوبة" aria-busy={loading}>{queues.map(q => <Link href={q.href} key={q.href}><span className="admin-tile-icon"><AdminIcon name={q.icon}/></span><strong aria-label={counts[q.href] == null ? "العدد غير متاح" : undefined}>{count(q.href)}</strong><h3>{q.title}</h3><span className="admin-tile-link">عرض <AdminIcon name="arrow" size={16}/></span></Link>)}</section>
    <div className="admin-block-title"><div><h2>أقسام الإدارة</h2></div><label className="admin-directory-search"><AdminIcon name="search"/><input type="search" aria-label="البحث في أقسام الإدارة" placeholder="ابحث عن قسم…" value={query} onChange={event => setQuery(event.target.value)}/></label></div>
    <section className="admin-directory">{groups.map(({label,items}) => <article key={label}><h3>{label}</h3>{items.map(([name,href,icon]) => <Link href={href} key={href}><AdminIcon name={icon}/><span>{name}</span><AdminAttentionBadge href={href}/><AdminIcon name="arrow" size={16}/></Link>)}</article>)}</section>
    {!groups.length && <div className="admin-empty"><h2>لا يوجد قسم بهذا الاسم</h2><button onClick={() => setQuery("")}>عرض جميع الأقسام</button></div>}
  </div>;
}
