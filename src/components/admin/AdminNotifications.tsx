"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { formatRecordField, readableText, type AdminRow } from "@/lib/admin/records";
import { AdminIcon } from "./AdminIcon";
import styles from "./AdminRecords.module.css";

function destination(value: unknown) {
  if (typeof value !== "string") return null;
  if (/[\\\u0000-\u001f]/.test(value) || value.startsWith("//")) return null;
  if (value.startsWith("/")) return value;
  try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) ? url.href : null; }
  catch { return null; }
}
export function AdminNotifications() {
  const [rows, setRows] = useState<AdminRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [unread, setUnread] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback((isCancelled?: () => boolean) => {
    return createClient().from("notifications").select("id,title,message,action_url,read_at,created_at").order("created_at", { ascending: false }).limit(100).then(result => {
      if (isCancelled?.()) return;
      if (result.error) setError("تعذر تحميل الإشعارات. حاول مجددًا.");
      else { setError(""); setRows(result.data ?? []); }
      setLoading(false);
    }, () => {
      if (isCancelled?.()) return;
      setError("تعذر تحميل الإشعارات. حاول مجددًا."); setLoading(false);
    });
  }, []);
  useEffect(() => { let cancelled = false; void load(() => cancelled); return () => { cancelled = true; }; }, [load]);
  async function markRead(id: string) {
    setBusy(id); setError("");
    try {
      const readAt = new Date().toISOString();
      const result = await createClient().from("notifications").update({ read_at: readAt }).eq("id", id).select("id").single();
      if (result.error) throw result.error;
      setRows(current => current.map(row => row.id === id ? { ...row, read_at: readAt } : row));
      window.dispatchEvent(new Event("bunya:notifications-read"));
    } catch { setError("تعذر تحديث حالة الإشعار."); }
    finally { setBusy(null); }
  }
  const filtered = rows.filter(row => !unread || !row.read_at);
  return <div className={styles.page}><header className={styles.hero}><div><span className={styles.eyebrow}>التواصل والحوكمة</span><h1>الإشعارات</h1><p>آخر المستجدات المرتبطة بحسابك، مع انتقال مباشر إلى الإجراء المطلوب.</p></div><button disabled={loading} onClick={() => { setLoading(true); setError(""); void load(); }}>تحديث الإشعارات</button></header>
    {error && <p className={styles.error} role="alert">{error}</p>}
    <section className={styles.panel}><div className={styles.toolbar}><label>عرض<select value={unread ? "unread" : "all"} onChange={e => setUnread(e.target.value === "unread")}><option value="all">جميع الإشعارات</option><option value="unread">غير المقروءة</option></select></label><span role="status">أحدث {rows.length} إشعار · {rows.filter(row => !row.read_at).length} غير مقروء</span></div>
      {loading ? <div className={styles.empty} role="status">جارٍ تحميل الإشعارات…</div> : error && !rows.length ? null : filtered.length ? <div className="admin-notification-list">{filtered.map(row => <article key={String(row.id)} data-unread={!row.read_at}><span className="admin-tile-icon"><AdminIcon name="bell"/></span><div><h2>{readableText(row.title)}</h2><p>{readableText(row.message)}</p><small>{formatRecordField(row, { key: "created_at", label: "التاريخ", kind: "date" })} · {row.read_at ? "مقروء" : "جديد"}</small><div className={styles.quickLinks}>{destination(row.action_url) && <Link href={destination(row.action_url)!}>فتح التفاصيل ←</Link>}{!row.read_at && <button disabled={!!busy} onClick={() => void markRead(String(row.id))}>{busy === row.id ? "جارٍ التحديث…" : "تعليم كمقروء"}</button>}</div></div></article>)}</div> : <div className={styles.empty}><AdminIcon name="bell" size={28}/><h2>{unread ? "اطّلعت على كل الإشعارات" : "لا توجد إشعارات بعد"}</h2><p>ستظهر تحديثات حسابك هنا عند وصولها.</p>{unread && <button onClick={() => setUnread(false)}>عرض جميع الإشعارات</button>}</div>}
    </section></div>;
}
