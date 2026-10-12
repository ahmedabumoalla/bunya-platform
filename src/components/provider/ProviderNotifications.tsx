/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAuthIdentity } from "@/components/auth/AuthIdentityProvider";
import { createClient } from "@/lib/supabase/client";
import { compactText, notificationPreview } from "@/lib/notifications/compact";
import styles from "./ProviderNotifications.module.css";

type Row = { id: string; title: string; message: string; action_url: string | null; read_at: string | null; created_at: string; type: string };
const db = createClient();
const when = (value: string) => new Date(value).toLocaleString("ar-SA", { dateStyle: "medium", timeStyle: "short" });
const titles: Record<string, string> = { "provider.rfq_new": "طلب تسعير جديد", "provider.rfq_reminder": "تذكير بالتسعير", "provider.rfq_expired": "انتهت مهلة التسعير", "provider.fulfillment_assigned": "أمر توريد جديد" };
const destination = (value: string | null) => value?.startsWith("/merchant/") && !value.includes("\\") ? value : null;

export function ProviderNotifications() {
  const identity = useAuthIdentity();
  const [rows, setRows] = useState<Row[]>([]);
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const result = await db.from("notifications").select("id,title,message,action_url,read_at,created_at,type").eq("profile_id", identity.userId).order("created_at", { ascending: false }).limit(100);
      if (result.error) throw result.error;
      setRows((result.data ?? []) as Row[]);
    } catch { setError("تعذر تحميل الإشعارات. أعد المحاولة."); }
    finally { setLoading(false); }
  }, [identity.userId]);
  useEffect(() => { void load(); }, [load]);
  const unread = rows.filter(row => !row.read_at).length;
  const shown = filter === "unread" ? rows.filter(row => !row.read_at) : rows;
  const markAll = async () => {
    const result = await db.from("notifications").update({ read_at: new Date().toISOString() }).eq("profile_id", identity.userId).is("read_at", null);
    if (result.error) { setError("تعذر تحديث القراءة. أعد المحاولة."); return; }
    await load();
  };
  const markOne = (id: string) => {
    const readAt = new Date().toISOString();
    void db.from("notifications").update({ read_at: readAt }).eq("id", id).eq("profile_id", identity.userId).then(({ error: updateError }) => {
      if (!updateError) setRows(current => current.map(row => row.id === id ? { ...row, read_at: readAt } : row));
    });
  };
  return <div className={styles.page}>
    <header className="provider-page-header"><div><h1>الإشعارات</h1><span>آخر تحديثات حسابك.</span></div></header>
    <div className={styles.toolbar}><div className={styles.tabs}><button className={`${styles.tab} ${filter === "all" ? styles.active : ""}`} aria-pressed={filter === "all"} onClick={() => setFilter("all")}>الكل <b>{rows.length}</b></button><button className={`${styles.tab} ${filter === "unread" ? styles.active : ""}`} aria-pressed={filter === "unread"} onClick={() => setFilter("unread")}>غير المقروء <b>{unread}</b></button></div><button className={styles.markAll} disabled={!unread || loading} onClick={() => void markAll()}>تعليم الكل كمقروء</button></div>
    {error ? <p className={styles.error} role="alert">{error} <button type="button" className={styles.markAll} onClick={() => void load()}>إعادة المحاولة</button></p> : null}
    {loading ? <div className="provider-skeleton" role="status" aria-label="جارٍ تحميل الإشعارات"><i/><i/><i/></div> : error ? null : shown.length ? <div className={styles.list}>{shown.map(row => {
      const href = destination(row.action_url);
      return <article className={`${styles.card} ${!row.read_at ? styles.unread : ""}`} key={row.id}><header className={styles.cardHeader}><div className={styles.heading}><h2>{compactText(titles[row.type] || row.title, 60)}</h2></div>{!row.read_at ? <span className={styles.new}>جديد</span> : null}</header><p className={styles.generic}>{notificationPreview(row.message)}</p><footer className={styles.footer}><span className={styles.time}>{when(row.created_at)}</span>{href ? <Link className={styles.primary} href={href} onClick={() => markOne(row.id)}>فتح التفاصيل ←</Link> : null}</footer></article>;
    })}</div> : <div className={styles.empty}><h3>{filter === "unread" ? "اطّلعت على كل الإشعارات" : "لا توجد إشعارات بعد"}</h3></div>}
  </div>;
}
