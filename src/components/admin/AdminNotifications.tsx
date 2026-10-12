"use client";
import { compactText, notificationPreview } from "@/lib/notifications/compact";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useAuthIdentity } from "@/components/auth/AuthIdentityProvider";
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
  const { userId } = useAuthIdentity();
  const [rows, setRows] = useState<AdminRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [unread, setUnread] = useState(false);
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback((isCancelled?: () => boolean) => {
    let query = createClient().from("notifications").select("id,title,message,action_url,read_at,created_at").eq("profile_id", userId).or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`).order("created_at", { ascending: false }).order("id");
    if (unread) query = query.is("read_at", null);
    return query.range(page * 50, page * 50 + 49).then(result => {
      if (isCancelled?.()) return;
      if (result.error) setError("تعذر تحميل الإشعارات. حاول مجددًا.");
      else { setError(""); setRows(result.data ?? []); }
      setLoading(false);
    }, () => {
      if (isCancelled?.()) return;
      setError("تعذر تحميل الإشعارات. حاول مجددًا."); setLoading(false);
    });
  }, [userId, unread, page]);
  useEffect(() => { let cancelled = false; void load(() => cancelled); return () => { cancelled = true; }; }, [load]);
  async function markRead(id: string) {
    setBusy(id); setError("");
    try {
      const readAt = new Date().toISOString();
      const result = await createClient().from("notifications").update({ read_at: readAt }).eq("id", id).eq("profile_id", userId).select("id").single();
      if (result.error) throw result.error;
      setRows(current => current.map(row => row.id === id ? { ...row, read_at: readAt } : row));
      window.dispatchEvent(new Event("bunya:notifications-read"));
      if (unread) await load();
    } catch { setError("تعذر تحديث حالة الإشعار."); }
    finally { setBusy(null); }
  }
  const filtered = rows.filter(row => !unread || !row.read_at);
  return <div className={styles.page}><header className={styles.hero}><div><span className={styles.eyebrow}>التواصل والحوكمة</span><h1>الإشعارات</h1><p>آخر المستجدات المرتبطة بحسابك، مع انتقال مباشر إلى الإجراء المطلوب.</p></div><button disabled={loading} onClick={() => { setLoading(true); setError(""); void load(); }}>تحديث الإشعارات</button></header>
    {error && <p className={styles.error} role="alert">{error}</p>}
    <section className={styles.panel}><div className={styles.toolbar}><label>عرض<select value={unread ? "unread" : "all"} onChange={e => { setUnread(e.target.value === "unread");setPage(0);setLoading(true); }}><option value="all">جميع الإشعارات</option><option value="unread">غير المقروءة</option></select></label><span role="status">{rows.length} إشعار في الصفحة · {rows.filter(row => !row.read_at).length} غير مقروء</span></div>
      {loading ? <div className={styles.empty} role="status">جارٍ تحميل الإشعارات…</div> : error && !rows.length ? null : filtered.length ? <div className="admin-notification-list">{filtered.map(row => <article key={String(row.id)} data-unread={!row.read_at}><span className="admin-tile-icon"><AdminIcon name="bell"/></span><div><h2>{compactText(readableText(row.title), 60)}</h2><p>{notificationPreview(readableText(row.message))}</p><small>{formatRecordField(row, { key: "created_at", label: "التاريخ", kind: "date" })} · {row.read_at ? "مقروء" : "جديد"}</small><div className={styles.quickLinks}>{destination(row.action_url) && <Link href={destination(row.action_url)!}>فتح التفاصيل ←</Link>}{!row.read_at && <button disabled={!!busy} onClick={() => void markRead(String(row.id))}>{busy === row.id ? "جارٍ التحديث…" : "تعليم كمقروء"}</button>}</div></div></article>)}</div> : <div className={styles.empty}><AdminIcon name="bell" size={28}/><h2>{page > 0 ? "لا توجد إشعارات في هذه الصفحة" : unread ? "اطّلعت على كل الإشعارات" : "لا توجد إشعارات بعد"}</h2><p>ستظهر تحديثات حسابك هنا عند وصولها.</p>{unread && <button onClick={() => { setUnread(false); setPage(0); setLoading(true); }}>عرض جميع الإشعارات</button>}</div>}
    </section>
    <nav className="admin-notification-pagination" aria-label="صفحات الإشعارات"><button disabled={loading || page===0} onClick={()=>{setLoading(true);setPage(v=>v-1);}}>السابق</button><span>صفحة {page+1}</span><button disabled={loading || rows.length<50} onClick={()=>{setLoading(true);setPage(v=>v+1);}}>التالي</button></nav>
    </div>;
}
