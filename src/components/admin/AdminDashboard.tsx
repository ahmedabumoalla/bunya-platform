"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { adminGroups } from "@/lib/admin/navigation";
import { AdminIcon } from "./AdminIcon";

const queues = [
  { title: "طلبات المزودين", table: "provider_applications", field: "status", values: ["pending"], href: "/admin/join-requests/providers", icon: "users", hint: "راجع المنشأة والمستندات قبل الاعتماد" },
  { title: "طلبات المقاولين", table: "contractor_applications", field: "status", values: ["pending"], href: "/admin/join-requests/contractors", icon: "shield", hint: "راجع بيانات المقاول وملف الاعتماد" },
  { title: "منتجات للمراجعة", table: "products", field: "review_status", values: ["pending_review"], href: "/admin/products/review", icon: "grid", hint: "تحقق من بيانات المنتج وجاهزيته للنشر" },
  { title: "تنبيهات مفتوحة", table: "admin_alerts", field: "status", values: ["open", "in_progress"], href: "/admin/alerts", icon: "alert", hint: "تابع الحالات التي تحتاج تدخل الإدارة" },
] as const;
const totals = [
  ["المستخدمون", "profiles", "/admin/users"], ["المزودون", "providers", "/admin/join-requests/providers"],
  ["المقاولون", "contractor_profiles", "/admin/join-requests/contractors"], ["طلبات الشراء", "orders", "/admin/orders"],
] as const;

export function AdminDashboard() {
  const [counts, setCounts] = useState<Record<string, number | null>>({});
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState("");
  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true); setError(false);
      const db = createClient();
      const requests = [...queues.map(async q => {
        const result = await db.from(q.table).select("id", { count: "exact", head: true }).in(q.field, [...q.values]);
        return [q.title, result.error ? null : result.count] as const;
      }), ...totals.map(async ([label, table]) => {
        const result = await db.from(table).select("id", { count: "exact", head: true });
        return [label + "-total", result.error ? null : result.count] as const;
      })];
      const results = await Promise.allSettled(requests);
      if (!active) return;
      const data = Object.fromEntries(results.flatMap(result => result.status === "fulfilled" ? [result.value] : []));
      setCounts(data); setError(results.some(result => result.status === "rejected" || result.value[1] === null)); setLoading(false);
    }
    void load(); return () => { active = false; };
  }, [refresh]);
  const count = (key: string) => loading ? "…" : counts[key] == null ? "غير متاح" : counts[key].toLocaleString("en-US");
  return <div className="admin-dashboard">
    <header className="admin-welcome"><div><span className="admin-eyebrow">مركز القيادة</span><h1>صورة واضحة. قرارات أسرع.</h1><p>ابدأ بما يحتاج انتباهك، ثم انتقل إلى تفاصيل العمل في كل قسم.</p><div className="admin-welcome-actions"><Link href="/admin/operations">متابعة العمليات <AdminIcon name="arrow" size={18}/></Link><Link href="/admin/finance">عرض الملخص المالي</Link></div></div><aside><AdminIcon name="flow" size={38}/><strong>إدارة بُنية</strong><span>من الانضمام إلى التسليم</span></aside></header>
    <div className="admin-block-title"><div><h2>بانتظار المتابعة</h2><p>عدد الطلبات والحالات المفتوحة حاليًا</p></div><button onClick={() => setRefresh(value => value + 1)} disabled={loading}>تحديث المؤشرات</button></div>
    {error && <p className="admin-inline-error" role="alert">تعذر تحميل بعض المؤشرات. يمكنك إعادة المحاولة أو فتح القسم مباشرة.</p>}
    <section className="admin-priority-grid" aria-label="قائمة المتابعة" aria-busy={loading}>{queues.map(q => <Link href={q.href} key={q.href}><span className="admin-tile-icon"><AdminIcon name={q.icon}/></span><strong>{count(q.title)}</strong><h3>{q.title}</h3><p>{q.hint}</p><span className="admin-tile-link">فتح القسم <AdminIcon name="arrow" size={16}/></span></Link>)}</section>
    <section className="admin-total-strip" aria-label="حجم المنصة">{totals.map(([label,,href]) => <Link href={href} key={label}><span>{label}</span><strong>{count(label + "-total")}</strong></Link>)}</section>
    <div className="admin-block-title"><div><h2>مساحات العمل</h2><p>كل أدوات الإدارة مرتبة حسب مرحلة العمل</p></div><label className="admin-directory-search"><AdminIcon name="search"/><input type="search" aria-label="البحث في أقسام الإدارة" placeholder="ابحث عن قسم…" value={query} onChange={event => setQuery(event.target.value)}/></label></div>
    <section className="admin-directory">{adminGroups.map(([label, items]) => {
      const matches = items.filter(([name]) => name.includes(query.trim()) || label.includes(query.trim()));
      return matches.length ? <article key={label}><h3>{label}</h3>{matches.map(([name,href,icon]) => <Link href={href} key={href}><AdminIcon name={icon}/><span>{name}</span><AdminIcon name="arrow" size={16}/></Link>)}</article> : null;
    })}</section>
    {query.trim() && !adminGroups.some(([label,items]) => label.includes(query.trim()) || items.some(([name]) => name.includes(query.trim()))) && <div className="admin-empty"><h2>لا يوجد قسم بهذا الاسم</h2><p>جرّب كلمة أخرى أو امسح البحث لعرض جميع الأقسام.</p><button onClick={() => setQuery("")}>عرض الأقسام</button></div>}
  </div>;
}
