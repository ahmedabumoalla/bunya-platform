"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { adminRecordPages, formatRecordField, readableText, recordValue, stateLabels, unreadableText, type AdminRow, type RecordField } from "@/lib/admin/records";
import styles from "./AdminRecords.module.css";

export function AdminRecords({ path, id }: { path: string; id: string | null }) {
  const config = adminRecordPages[path];
  const router = useRouter();
  const [rows, setRows] = useState<AdminRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(0);
  const [count, setCount] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [sort, setSort] = useState<{ key: string; ascending: boolean } | null>(null);
  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true); setError("");
      try {
        let request = createClient().from(config.table).select(config.select, { count: "exact" });
        if (id) request = request.eq("id", id);
        const result = await request.order(config.order ?? "created_at", { ascending: false }).range(id ? 0 : page * 50, id ? 0 : page * 50 + 49);
        if (result.error) throw result.error;
        if (active) { setRows((result.data ?? []) as unknown as AdminRow[]); setCount(result.count ?? 0); }
      } catch {
        if (active) { setRows([]); setError("تعذر تحميل هذا القسم. حاول مجددًا أو تحقق من صلاحية حسابك."); }
      } finally { if (active) setLoading(false); }
    }
    void load();
    return () => { active = false; };
  }, [config, id, page, refresh]);

  const filtered = useMemo(() => rows.filter(row =>
    (status === "all" || String(recordValue(row, config.status ?? "status")) === status) &&
    config.columns.some(field => formatRecordField(row, field).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  ).sort((a, b) => {
    if (!sort) return 0;
    const left = recordValue(a, sort.key), right = recordValue(b, sort.key);
    const result = typeof left === "number" && typeof right === "number" ? left - right : String(left ?? "").localeCompare(String(right ?? ""), "ar", { numeric: true });
    return sort.ascending ? result : -result;
  }), [rows, status, query, config, sort]);
  const statuses = [...new Set(rows.map(row => recordValue(row, config.status ?? "status")).filter(value => value != null).map(String))];
  const row = rows[0];
  const fields = [...config.columns, ...(config.details ?? [])];
  const groups = [
    { title: "معلومات العملية", fields: fields.filter(field => field.kind !== "money" && field.kind !== "date") },
    { title: "التفاصيل المالية", fields: fields.filter(field => field.kind === "money") },
    { title: "المواعيد والتحديثات", fields: fields.filter(field => field.kind === "date") },
  ];
  async function assemble() {
    setBusy(true); setError("");
    try {
      const result = await createClient().rpc("assemble_bunya_customer_quote", { p_sourcing_request_id: id });
      if (result.error || !result.data) throw result.error;
      router.push(`/admin/bunya-quotes/${encodeURIComponent(String(result.data))}`);
    } catch { setError("تعذر تجهيز العرض. تأكد من اكتمال تسعير الأصناف وصلاحيات حسابك."); }
    finally { setBusy(false); }
  }

  return <main className={styles.page}>
    <header className={styles.hero}>
      <div><span className={styles.eyebrow}>إدارة منصة بُنية</span><h1>{id ? `تفاصيل ${config.title}` : config.title}</h1><p>{config.description}</p></div>
      <div className={styles.headerActions}>{id ? <Link href={path}>العودة للقائمة ←</Link> : <div className={styles.count}><strong>{loading ? "…" : count.toLocaleString("ar-SA")}</strong><span>إجمالي السجلات</span></div>}<button type="button" onClick={() => setRefresh(value => value + 1)} disabled={loading}>تحديث البيانات</button></div>
    </header>
    {path === "/admin/settings" && <nav className={styles.quickLinks} aria-label="إدارة المنصة"><Link href="/admin/policies">السياسات وأماكن ظهورها ←</Link><Link href="/admin/admins">المدراء والصلاحيات ←</Link></nav>}
    {error && <div className={styles.error} role="alert">{error}<button type="button" onClick={() => setRefresh(value => value + 1)}>إعادة المحاولة</button></div>}
    {loading ? <div className={styles.empty} role="status">جارٍ تحميل البيانات…</div> : error && !rows.length ? null : id ? row ? <>
      <div className={styles.detailIntro}><strong>{formatRecordField(row, config.columns[0])}</strong>{config.status && <Status row={row} field={{ key: config.status, label: "الحالة", kind: "status" }} />}</div>
      {groups.filter(group => group.fields.length).map(group => <section key={group.title} className={styles.panel}><h2>{group.title}</h2><dl className={styles.details}>{group.fields.map(field => <div key={field.key} className={field.kind === "text" || ["terms", "notes", "scope", "scope_details", "includes", "excludes", "description", "change_request"].includes(field.key) ? styles.wide : undefined}><dt>{field.label}</dt><dd>{field.kind === "status" ? <Status row={row} field={field} /> : <Value row={row} field={field} />}</dd></div>)}</dl></section>)}
      <nav className={styles.quickLinks} aria-label="العمليات المرتبطة">
        {typeof row.customer_request_id === "string" && <Link href={`/admin/quote-requests/${row.customer_request_id}`}>طلب المنتجات المرتبط ←</Link>}
        {typeof row.order_id === "string" && <Link href={`/admin/orders/${row.order_id}`}>عرض طلب الشراء ←</Link>}
        {typeof row.project_request_id === "string" && <Link href={`/admin/project-requests/${row.project_request_id}`}>عرض طلب المشروع ←</Link>}
        {path === "/admin/sourcing" && <button type="button" disabled={busy} onClick={() => void assemble()}>{busy ? "جارٍ تجهيز العرض…" : "تجهيز عرض العميل"}</button>}
      </nav>
    </> : <div className={styles.empty}><h2>السجل غير متاح</h2><p>قد يكون محذوفًا أو غير متاح لصلاحيات حسابك.</p><Link href={path}>العودة للقائمة</Link></div> : <>
      <section className={styles.panel}>
        <div className={styles.toolbar}><label>البحث في هذه الصفحة<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="ابحث بالاسم أو رقم العملية…" /></label>{config.status && <label>الحالة<select value={status} onChange={event => setStatus(event.target.value)}><option value="all">جميع الحالات</option>{statuses.map(value => <option value={value} key={value}>{stateLabels[value] ?? "حالة غير مصنفة"}</option>)}</select></label>}<span role="status">{filtered.length.toLocaleString("en-US")} من {rows.length.toLocaleString("en-US")} في هذه الصفحة</span>{(query || status !== "all") && <button type="button" onClick={() => { setQuery(""); setStatus("all"); }}>مسح الفلاتر</button>}</div>
        {filtered.length ? <div className={styles.tableWrap} tabIndex={0} role="region" aria-label={config.title}><table><caption className="sr-only">{config.title}</caption><thead><tr>{config.columns.map(field => <th scope="col" key={field.key} aria-sort={sort?.key === field.key ? sort.ascending ? "ascending" : "descending" : "none"}><button className={styles.sortButton} type="button" onClick={() => setSort(current => ({ key: field.key, ascending: current?.key === field.key ? !current.ascending : true }))} title="ترتيب السجلات في هذه الصفحة">{field.label}<span aria-hidden="true">{sort?.key === field.key ? sort.ascending ? "↑" : "↓" : "↕"}</span></button></th>)}{path !== "/admin/settings" && <th scope="col">التفاصيل</th>}</tr></thead><tbody>{filtered.map((item, index) => <tr key={String(item.id ?? item.setting_key ?? index)}>{config.columns.map((field, column) => <td key={field.key} data-primary={column === 0}>{field.kind === "status" ? <Status row={item} field={field} /> : <Value row={item} field={field} />}</td>)}{path !== "/admin/settings" && <td><Link className={styles.detailLink} href={`${path}/${encodeURIComponent(String(item.id))}`} aria-label={`عرض تفاصيل ${formatRecordField(item, config.columns[0])}`}>عرض التفاصيل ←</Link></td>}</tr>)}</tbody></table></div> : <div className={styles.empty}><h2>{rows.length ? "لا توجد نتائج تطابق البحث" : "لا توجد سجلات بعد"}</h2><p>{rows.length ? "جرّب تغيير البحث أو اختيار جميع الحالات." : config.empty}</p>{rows.length > 0 && <button type="button" onClick={() => { setQuery(""); setStatus("all"); }}>عرض الكل</button>}</div>}
        {count > 50 && <footer className={styles.pagination}><button type="button" disabled={page === 0} onClick={() => { setPage(value => value - 1); setStatus("all"); setQuery(""); }}>السابق</button><span>صفحة {page + 1} من {Math.ceil(count / 50)}</span><button type="button" disabled={(page + 1) * 50 >= count} onClick={() => { setPage(value => value + 1); setStatus("all"); setQuery(""); }}>التالي</button></footer>}
      </section>
    </>}
  </main>;
}

function Value({ row, field }: { row: AdminRow; field: RecordField }) {
  const value = formatRecordField(row, field);
  return <span className={value === unreadableText ? styles.unreadable : undefined}><bdi dir={field.kind === "money" || field.kind === "percent" ? "ltr" : undefined}>{value}</bdi></span>;
}
function Status({ row, field }: { row: AdminRow; field: RecordField }) {
  const raw = String(recordValue(row, field.key) ?? "");
  const tone = ["paid", "accepted", "approved", "completed", "delivered", "valid", "confirmed", "resolved", "transferred"].includes(raw) ? "success" : ["rejected", "cancelled", "failed", "expired", "failed_delivery"].includes(raw) ? "muted" : "pending";
  return <span className={styles.badge} data-tone={tone}>{readableText(formatRecordField(row, field))}</span>;
}
