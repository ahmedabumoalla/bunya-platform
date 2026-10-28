"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { lockBodyScroll } from "@/lib/body-scroll-lock";
import type { UserDetailField, UserDetailOverview, UserDetailPage } from "@/lib/admin/user-details-types";
import styles from "./AdminUserDetails.module.css";

type Tab = "overview" | "documents" | "records" | "activity";
const tabs: { key: Tab; label: string }[] = [{ key: "overview", label: "بيانات الحساب" }, { key: "documents", label: "المستندات" }, { key: "records", label: "الطلبات والسجلات" }, { key: "activity", label: "سجل الحركة" }];
function date(value: string) { const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? "غير مسجل" : parsed.toLocaleString("ar-SA-u-ca-gregory-nu-latn", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Riyadh" }); }
function FieldList({ fields }: { fields: UserDetailField[] }) { return <dl className={styles.fields}>{fields.map((field, index) => <div key={`${field.label}-${index}`}><dt>{field.label}</dt><dd dir="auto">{field.value}</dd></div>)}</dl>; }

export function AdminUserDetails({ userId, onClose }: { userId: string; onClose: () => void }) {
  const titleId = useId();
  const dialog = useRef<HTMLElement>(null);
  const [overview, setOverview] = useState<UserDetailOverview | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [source, setSource] = useState("");
  const [page, setPage] = useState(1);
  const [content, setContent] = useState<UserDetailPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const close = useCallback(() => { if (!busy) onClose(); }, [busy, onClose]);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const unlock = lockBodyScroll();
    dialog.current?.focus();
    return () => { unlock(); previous?.focus(); };
  }, []);

  useEffect(() => {
    const abort = new AbortController();
    void (async () => {
      setLoading(true); setError(""); setContent(null);
      try {
        const params = new URLSearchParams({ section: tab, source, page: String(page) });
        const response = await fetch(`/api/admin/users/${userId}?${params}`, { signal: abort.signal, cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || "تعذر تحميل البيانات.");
        if (abort.signal.aborted) return;
        if (tab === "overview") setOverview(data); else setContent(data);
      } catch (failure) { if (!abort.signal.aborted) setError(failure instanceof Error ? failure.message : "تعذر تحميل البيانات."); }
      finally { if (!abort.signal.aborted) setLoading(false); }
    })();
    return () => abort.abort();
  }, [userId, tab, source, page, retry]);

  function selectTab(next: Tab) {
    setTab(next); setPage(1);
    setSource(next === "documents" ? overview?.documentSources[0]?.key ?? "files" : next === "records" ? overview?.recordSources[0]?.key ?? "" : "");
  }
  async function impersonate() {
    if (busy || !overview?.canImpersonate) return;
    setBusy(true); setActionError("");
    try {
      const response = await fetch("/api/admin/impersonation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ targetUserId: userId }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "تعذر بدء الدخول بالنيابة.");
      if (typeof result.redirectTo !== "string" || !/^\/(admin|customer|merchant|contractor|driver)(\/|$)/.test(result.redirectTo)) throw new Error("تعذر فتح مساحة المستخدم.");
      window.location.assign(result.redirectTo);
    } catch (failure) { setActionError(failure instanceof Error ? failure.message : "تعذر الدخول بالنيابة."); setBusy(false); }
  }
  const sources = tab === "documents" ? overview?.documentSources : overview?.recordSources;
  return createPortal(<div className={`admin-modal-backdrop ${styles.backdrop}`} onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
    <section ref={dialog} tabIndex={-1} className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby={titleId} dir="rtl" onKeyDown={event => {
      if (event.key === "Escape" && !busy) { event.stopPropagation(); close(); }
      if (event.key !== "Tab") return;
      const items = [...event.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled),a[href],select:not(:disabled),textarea:not(:disabled),[tabindex='0']")].filter(item => item.getClientRects().length);
      const first = items[0], last = items[items.length - 1];
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === event.currentTarget)) { event.preventDefault(); first.focus(); }
    }}>
      <header className={styles.header}>
        <div className={styles.identity}><span className={styles.avatar} aria-hidden>{overview?.name.slice(0, 1) || "م"}</span><div><p>ملف المستخدم</p><h2 id={titleId}>{overview?.name || "تفاصيل الحساب"}</h2><span dir="ltr">{overview?.email}</span></div></div>
        <button type="button" className={styles.close} onClick={close} disabled={busy} aria-label="إغلاق بطاقة المستخدم">×</button>
        {overview && <div className={styles.badges}><span data-active={overview.active}>{overview.active ? "الحساب نشط" : "الحساب موقوف"}</span>{overview.roles.map((role, index) => <span key={index} data-revoked={role.revoked}>{role.label}{role.revoked ? " · مُلغى" : role.primary ? " · أساسي" : ""}</span>)}</div>}
      </header>
      <nav className={styles.tabs} aria-label="أقسام ملف المستخدم">{tabs.filter(item => item.key !== "activity" || overview?.canViewActivity).map(item => <button type="button" key={item.key} aria-current={tab === item.key ? "page" : undefined} disabled={!overview && item.key !== "overview"} onClick={() => selectTab(item.key)}>{item.label}</button>)}</nav>
      <div className={styles.body} aria-busy={loading}>
        {error ? <div className={styles.empty} role="alert"><h3>تعذر عرض البيانات</h3><p>{error}</p><button type="button" onClick={() => setRetry(value => value + 1)}>إعادة المحاولة</button></div> : loading ? <div className={styles.empty} role="status"><span className={styles.spinner}/><p>جارٍ تحميل بيانات الحساب…</p></div> : tab === "overview" ? <>
          <p className={styles.hint}>بيانات الحساب المرتبطة مباشرة بالمنصة. المستندات والسجلات تُعرض وفق صلاحياتك الإدارية.</p>
          {overview?.sections.map((section, index) => <section className={styles.section} key={`${section.title}-${index}`}><h3>{section.title}</h3><FieldList fields={section.fields}/></section>)}
          <details className={styles.reference}><summary>مرجع الحساب للدعم الفني</summary><code dir="ltr">{userId}</code></details>
        </> : <>
          {(tab === "documents" || tab === "records") && <div className={styles.toolbar}><label>نوع {tab === "documents" ? "المستندات" : "السجلات"}<select value={source} onChange={event => { setSource(event.target.value); setPage(1); }}>{sources?.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label><span>{content?.total ?? 0} {tab === "documents" ? "مستند" : "سجل"}</span></div>}
          {tab === "activity" && <p className={styles.hint}>الإجراءات المحفوظة في سجل التدقيق، وليست سجلًا لكل زيارة أو نقرة. إجمالي السجلات: {content?.total ?? 0}.</p>}
          {content?.items.length ? <ul className={styles.items}>{content.items.map(item => <li key={item.id}><div className={styles.itemTop}><div><h3>{item.title}</h3>{item.subtitle && <p>{item.subtitle}</p>}<time dateTime={item.date}>{date(item.date)}</time></div>{item.status && <span className={styles.status}>{item.status}</span>}</div>{Boolean(item.fields?.length) && <FieldList fields={item.fields!}/>} {item.href && <a className={styles.link} href={item.href} target="_blank" rel="noopener noreferrer">{tab === "documents" ? "عرض المستند" : "فتح التفاصيل"}<span aria-hidden> ↗</span><span className="sr-only"> في نافذة جديدة</span></a>}</li>)}</ul> : <div className={styles.empty}><h3>{tab === "activity" ? "لا توجد حركة مسجلة بعد" : tab === "documents" ? "لا توجد مستندات في هذا القسم" : "لا توجد سجلات في هذا القسم"}</h3><p>تظهر البيانات المرتبطة بهذا الحساب عند تسجيلها في المنصة.</p></div>}
          {content && content.total > content.pageSize && <nav className={styles.pagination} aria-label="تصفح بيانات المستخدم"><button type="button" disabled={page === 1} onClick={() => setPage(value => value - 1)}>السابق</button><span>صفحة {page} من {Math.ceil(content.total / content.pageSize)}</span><button type="button" disabled={page * content.pageSize >= content.total} onClick={() => setPage(value => value + 1)}>التالي</button></nav>}
        </>}
      </div>
      {actionError && <p role="alert" className={styles.error}>{actionError}</p>}
      <footer className={styles.footer}><div><strong>إدارة الحساب بأمان</strong><small>{overview?.canImpersonate ? "الدخول بالنيابة متاح لحسابك الإداري." : "الدخول بالنيابة متاح فقط للحساب الإداري المخوّل، ويشمل الحسابات المؤكدة والجاهزة بجميع أدوارها."}</small></div><div className={styles.actions}>{overview?.canImpersonate && <button type="button" className={styles.primary} disabled={busy} onClick={() => void impersonate()}>{busy ? "جارٍ الدخول…" : "الدخول بالنيابة"}</button>}<button type="button" onClick={close} disabled={busy}>إغلاق</button></div></footer>
    </section>
  </div>, document.body);
}
