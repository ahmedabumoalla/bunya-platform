"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuthIdentity } from "@/components/auth/AuthIdentityProvider";
import { useLocale } from "@/components/i18n/LocaleProvider";
import { intlLocale } from "@/lib/i18n/config";
import { createClient } from "@/lib/supabase/client";
import styles from "./CustomerNotifications.module.css";

type Notification = {
  id: string;
  title: string;
  message: string;
  notification_type: string;
  action_url: string | null;
  read_at: string | null;
  created_at: string;
};

const pageSize = 30;

function customerDestination(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(value)) return null;
  try {
    const base = "https://customer.bunya.invalid";
    const url = new URL(value, base);
    const decoded = decodeURIComponent(url.pathname);
    if (/[\\\u0000-\u001f\u007f]/.test(decoded)) return null;
    const normalized = new URL(decoded, base);
    if (url.origin !== base || normalized.origin !== base) return null;
    if (normalized.pathname !== "/customer" && !normalized.pathname.startsWith("/customer/")) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

function NotificationIcon({ type = "" }: { type?: string }) {
  const paths = /delivery|shipment|driver/i.test(type)
    ? <><path d="M3 6h11v11H3zM14 10h4l3 4v3h-7" /><circle cx="7" cy="18" r="2" /><circle cx="18" cy="18" r="2" /></>
    : /quote|request/i.test(type)
      ? <><path d="M8 4H5v17h14V4h-3M9 3h6v4H9zM8 11h8M8 15h8" /></>
      : /payment|invoice|paid/i.test(type)
        ? <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3ZM9 8h6M9 12h6" /></>
        : <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4" /></>;
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths}</svg>;
}

export function CustomerNotifications() {
  const { userId } = useAuthIdentity();
  const { locale } = useLocale();
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [snapshot, setSnapshot] = useState<{ scope: string; rows: Notification[]; total: number; unread: number }>({ scope: "", rows: [], total: 0, unread: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const scope = `${userId}:${filter}`;
  const rows = snapshot.scope === scope ? snapshot.rows : [];
  const total = snapshot.scope === scope ? snapshot.total : 0;
  const unread = snapshot.scope === scope ? snapshot.unread : 0;

  useEffect(() => {
    let active = true;
    void (async () => {
      if (!userId) throw new Error("missing-session");
      const db = createClient();
      let query = db.from("customer_notifications")
        .select("id,title,message,notification_type,action_url,read_at,created_at", { count: "exact" })
        .eq("customer_profile_id", userId)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(offset, offset + pageSize - 1);
      if (filter === "unread") query = query.is("read_at", null);
      const [result, count] = await Promise.all([
        query,
        db.from("customer_notifications").select("id", { count: "exact", head: true }).eq("customer_profile_id", userId).is("read_at", null),
      ]);
      if (result.error || count.error) throw result.error || count.error;
      if (!active) return;
      const incoming = (result.data ?? []) as Notification[];
      setSnapshot((current) => {
        const previous = offset > 0 && current.scope === scope ? current.rows : [];
        const existingIds = new Set(previous.map((row) => row.id));
        return { scope, rows: [...previous, ...incoming.filter((row) => !existingIds.has(row.id))], total: result.count ?? 0, unread: count.count ?? 0 };
      });
      setError("");
    })().catch(() => {
      if (active) setError(userId ? "تعذر تحميل الإشعارات. تحقق من الاتصال ثم حاول مجددًا." : "يرجى تسجيل الدخول لعرض إشعارات حسابك.");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [filter, offset, revision, scope, userId]);

  function changeFilter(next: "all" | "unread") {
    if (next === filter) return;
    setLoading(true);
    setError("");
    setFeedback("");
    setOffset(0);
    setFilter(next);
  }

  function refresh() {
    setLoading(true);
    setError("");
    setFeedback("");
    setOffset(0);
    setRevision((current) => current + 1);
  }

  async function markRead(id?: string) {
    if (!userId || busy) return;
    setBusy(id || "all");
    setError("");
    setFeedback("");
    try {
      const readAt = new Date().toISOString();
      let query = createClient().from("customer_notifications").update({ read_at: readAt }).eq("customer_profile_id", userId).is("read_at", null);
      if (id) query = query.eq("id", id);
      const result = await query.select("id");
      if (result.error) throw result.error;
      const updatedIds = new Set((result.data ?? []).map((row) => String(row.id)));
      if (!updatedIds.size) {
        refresh();
        setFeedback("تم تحديث الإشعارات حسب حالتها الحالية.");
      } else {
        setSnapshot((current) => {
          if (current.scope !== scope) return current;
          const changed = current.rows.map((row) => !row.read_at && (!id || updatedIds.has(row.id)) ? { ...row, read_at: readAt } : row);
          return { ...current, rows: filter === "unread" ? changed.filter((row) => !row.read_at) : changed, total: filter === "unread" ? (id ? Math.max(0, current.total - updatedIds.size) : 0) : current.total, unread: id ? Math.max(0, current.unread - updatedIds.size) : 0 };
        });
        if (id && filter === "unread" && rows.length === 1 && total > updatedIds.size) {
          setLoading(true);
          setOffset(0);
          setRevision((current) => current + 1);
        }
        setFeedback(id ? "تم تعليم الإشعار كمقروء." : "تم تعليم جميع الإشعارات كمقروءة.");
      }
      window.dispatchEvent(new Event("customer-notifications-updated"));
    } catch {
      setError("تعذر تحديث حالة القراءة. حاول مجددًا.");
    } finally {
      setBusy(null);
    }
  }

  const date = (value: string) => new Intl.DateTimeFormat(intlLocale(locale), { calendar: "gregory", dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Riyadh" }).format(new Date(value));
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div><p className={styles.eyebrow}>ابقَ على اطّلاع</p><h1>إشعاراتك</h1><p>تحديثات طلباتك وعروض الأسعار والتوصيل، في مكان واحد.</p></div>
        <div className={styles.headerActions}>
          <button className={styles.secondaryButton} onClick={refresh} disabled={loading || !!busy}>تحديث</button>
          <button className={styles.primaryButton} onClick={() => void markRead()} disabled={loading || !!busy || unread === 0}>{busy === "all" ? "جارٍ تحديث القراءة…" : "تعليم الكل كمقروء"}</button>
        </div>
      </header>
      <section className={styles.inbox} aria-label="صندوق الإشعارات" aria-busy={loading || !!busy}>
        <div className={styles.toolbar}>
          <div className={styles.filters} aria-label="تصفية الإشعارات">
            <button aria-pressed={filter === "all"} disabled={!!busy} onClick={() => changeFilter("all")}>جميع الإشعارات</button>
            <button aria-pressed={filter === "unread"} disabled={!!busy} onClick={() => changeFilter("unread")}>غير المقروءة{snapshot.scope === scope ? <span>{unread}</span> : null}</button>
          </div>
          <p className={styles.listHint}>{loading && !rows.length ? "نحمّل آخر التحديثات…" : `${total} إشعار${filter === "unread" ? " غير مقروء" : ""}`}</p>
        </div>
        {error ? <div className={styles.error} role="alert"><span>{error}</span><button onClick={refresh} disabled={loading || !!busy}>إعادة المحاولة</button></div> : null}
        {feedback ? <p className={styles.feedback} role="status">{feedback}</p> : null}
        {loading && !rows.length ? <div className={styles.empty} role="status"><span className={styles.emptyIcon}><NotificationIcon /></span><h2>جارٍ تحميل الإشعارات…</h2><p>ستظهر مستجدات حسابك هنا.</p></div> : rows.length ? (
          <ol className={styles.list}>
            {rows.map((row) => {
              const href = customerDestination(row.action_url);
              return (
                <li key={row.id}>
                  <article className={`${styles.notification} ${!row.read_at ? styles.unread : ""}`}>
                    <span className={styles.icon}><NotificationIcon type={row.notification_type} /></span>
                    <div className={styles.content}>
                      <div className={styles.rowHeader}><h2>{row.title}</h2><span className={row.read_at ? styles.readLabel : styles.unreadLabel}>{row.read_at ? "مقروء" : "جديد"}</span></div>
                      <p>{row.message}</p>
                      <div className={styles.rowFooter}>
                        <time dateTime={row.created_at}>{date(row.created_at)} · الرياض</time>
                        <div className={styles.rowActions}>
                          {href ? <Link href={href} aria-label={`فتح تفاصيل: ${row.title}`}>فتح التفاصيل <span aria-hidden="true">←</span></Link> : null}
                          {!row.read_at ? <button disabled={!!busy || loading} onClick={() => void markRead(row.id)} aria-label={`تعليم كمقروء: ${row.title}`}>{busy === row.id ? "جارٍ التحديث…" : "تعليم كمقروء"}</button> : null}
                        </div>
                      </div>
                    </div>
                  </article>
                </li>
              );
            })}
          </ol>
        ) : !error ? <div className={styles.empty}><span className={styles.emptyIcon}><NotificationIcon /></span><h2>{filter === "unread" ? "اطّلعت على كل المستجدات" : "لا توجد إشعارات بعد"}</h2><p>{filter === "unread" ? "يمكنك الرجوع إلى جميع الإشعارات لمراجعة تحديثاتك السابقة." : "سنُظهر هنا تحديثات طلباتك وعروض الأسعار فور وصولها."}</p>{filter === "unread" ? <button className={styles.secondaryButton} onClick={() => changeFilter("all")}>عرض جميع الإشعارات</button> : <Link className={styles.secondaryButton} href="/customer/quote-requests">متابعة طلباتي</Link>}</div> : null}
        {rows.length > 0 && rows.length < total ? <div className={styles.pagination}><span>عرض {rows.length} من {total} إشعار</span><button className={styles.secondaryButton} disabled={loading || !!busy} onClick={() => { setLoading(true); setError(""); setFeedback(""); setOffset(rows.length); setRevision((current) => current + 1); }}>{loading ? "جارٍ التحميل…" : "عرض المزيد"}</button></div> : null}
      </section>
    </main>
  );
}
