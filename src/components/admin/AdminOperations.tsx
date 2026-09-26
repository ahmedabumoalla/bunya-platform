"use client";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { adminEventLabels } from "@/lib/admin/event-labels";
import { formatRecordField, type AdminRow } from "@/lib/admin/records";
import styles from "./AdminRecords.module.css";

const statuses: Record<string, string> = { pending: "بانتظار الإرسال", processing: "جارٍ الإرسال", sent: "تم الإرسال", processed: "تمت المعالجة", completed: "مكتمل", failed: "تعذر الإرسال", dead_letter: "يحتاج تدخلًا", delivered: "تم التسليم" };
export function AdminOperations() {
  const [rows, setRows] = useState<AdminRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const load = useCallback((isCancelled?: () => boolean) => {
    return createClient().from("outbox_events").select("id,event_type,status,attempts,next_attempt_at,dead_letter_at,sanitized_error,created_at").order("created_at", { ascending: false }).limit(100).then(result => {
      if (isCancelled?.()) return;
      if (result.error) setError("تعذر تحميل العمليات. حاول تحديث القائمة.");
      else { setError(""); setRows(result.data ?? []); }
      setLoading(false);
    }, () => {
      if (isCancelled?.()) return;
      setError("تعذر تحميل العمليات. حاول تحديث القائمة."); setLoading(false);
    });
  }, []);
  useEffect(() => { let cancelled = false; void load(() => cancelled); return () => { cancelled = true; }; }, [load]);
  async function retry(id: string) {
    setBusy(id); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/admin/notifications/${encodeURIComponent(id)}/retry`, { method: "POST" });
      if (!response.ok) throw new Error();
      await load(); setMessage("أُرسلت العملية لإعادة المحاولة. حدّث القائمة لاحقًا لمتابعة النتيجة.");
    } catch { setError("تعذرت إعادة المحاولة. تحقق من صلاحياتك أو حاول لاحقًا."); }
    finally { setBusy(null); }
  }
  const title = (row: AdminRow) => adminEventLabels[String(row.event_type)] ?? "إشعار تشغيلي";
  const filtered = rows.filter(row => (status === "all" || (status === "attention" ? ["failed", "dead_letter"].includes(String(row.status)) : ["pending", "processing"].includes(String(row.status)))) && title(row).includes(query.trim()));
  return <div className={styles.page}>
    <header className={styles.hero}><div><span className={styles.eyebrow}>القيادة والتشغيل</span><h1>مركز العمليات</h1><p>تابع إرسال الإشعارات، واكتشف العمليات المتعثرة وأعد المحاولة عند الحاجة.</p></div><button disabled={loading || !!busy} onClick={() => { setLoading(true); setError(""); void load(); }}>تحديث العمليات</button></header>
    {error && <p className={styles.error} role="alert">{error}</p>}{message && <p className="admin-inline-success" role="status">{message}</p>}
    <section className={styles.panel}><div className={styles.toolbar}><label>البحث في أحدث 100 عملية<input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="ابحث بوصف العملية…"/></label><label>عرض<select value={status} onChange={e => setStatus(e.target.value)}><option value="all">جميع العمليات</option><option value="attention">تحتاج تدخلًا</option><option value="pending">بانتظار الإرسال</option></select></label><span role="status">{loading ? "جارٍ التحميل…" : `${filtered.length} عملية`}</span></div>
      {loading ? <div className={styles.empty} role="status">جارٍ تحميل العمليات…</div> : error && !rows.length ? null : !filtered.length ? <div className={styles.empty}><h2>{rows.length ? "لا توجد عمليات تطابق الفلتر" : "لا توجد عمليات مسجلة بعد"}</h2><p>تظهر هنا الإشعارات الناتجة عن الطلبات وإجراءات المنصة.</p>{rows.length > 0 && <button onClick={() => { setStatus("all"); setQuery(""); }}>عرض الكل</button>}</div> : <div className={styles.tableWrap} tabIndex={0} role="region" aria-label="العمليات التشغيلية"><table><thead><tr>{["العملية", "الحالة", "المحاولات", "المحاولة التالية", "الإجراء"].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead><tbody>{filtered.map(row => <tr key={String(row.id)}><td data-primary="true">{title(row)}<small className="admin-record-date">{formatRecordField(row, { key: "created_at", label: "التاريخ", kind: "date" })}</small></td><td><span className={styles.badge} data-tone={["sent", "delivered", "completed", "processed"].includes(String(row.status)) ? "success" : "pending"}>{statuses[String(row.status)] ?? "قيد المتابعة"}</span></td><td>{String(row.attempts)}</td><td>{formatRecordField(row, { key: "next_attempt_at", label: "الموعد", kind: "date", empty: "لا توجد محاولة مجدولة" })}</td><td>{["failed", "dead_letter"].includes(String(row.status)) ? <button disabled={!!busy} onClick={() => void retry(String(row.id))}>{busy === row.id ? "جارٍ الطلب…" : "إعادة المحاولة"}</button> : "لا يلزم إجراء"}{row.sanitized_error ? <details className="admin-error-detail"><summary>تفاصيل التعثر</summary><p>{String(row.sanitized_error)}</p></details> : null}</td></tr>)}</tbody></table></div>}
    </section>
  </div>;
}
