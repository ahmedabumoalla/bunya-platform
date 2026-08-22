"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import styles from "./AdminUsers.module.css";

type RoleKey = "customer" | "provider" | "contractor" | "driver" | "admin";
type RoleRow = { role: RoleKey; is_primary: boolean; revoked_at: string | null };
type UserRow = {
  id: string;
  username: string | null;
  full_name: string | null;
  mobile: string | null;
  email: string | null;
  role: RoleKey;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  user_roles: RoleRow[] | null;
};

const db = createClient();
const roleLabels: Record<RoleKey, string> = { customer: "عميل", provider: "مزود", contractor: "مقاول", driver: "سائق", admin: "إدارة" };
const roleOrder: RoleKey[] = ["customer", "provider", "contractor", "driver", "admin"];
const pageSize = 15;

function activeRoles(user: UserRow) {
  const roles = (user.user_roles ?? []).filter(item => !item.revoked_at);
  if (!roles.length) return [{ role: user.role, is_primary: true, revoked_at: null }];
  return [...roles].sort((a, b) => Number(b.is_primary) - Number(a.is_primary));
}

function initials(user: UserRow) {
  const value = user.full_name || user.username || user.email || "مستخدم";
  return value.trim().slice(0, 1).toLocaleUpperCase("ar");
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ar-SA", { year: "numeric", month: "short", day: "numeric" }).format(new Date(value));
}

export function AdminUsers() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<"all" | RoleKey>("all");
  const [accountStatus, setAccountStatus] = useState<"all" | "active" | "inactive">("all");
  const [phoneStatus, setPhoneStatus] = useState<"all" | "verified" | "missing">("all");
  const [period, setPeriod] = useState<"all" | "7" | "30" | "90">("all");
  const [sort, setSort] = useState<"newest" | "oldest" | "name" | "updated">("newest");
  const [page, setPage] = useState(1);
  const [referenceTime] = useState(() => Date.now());

  useEffect(() => { void (async () => {
    setLoading(true);
    const result = await db.from("profiles").select("id,username,full_name,mobile,email,role,is_active,created_at,updated_at,user_roles!user_roles_profile_id_fkey(role,is_primary,revoked_at)").order("created_at", { ascending: false }).limit(2000);
    if (result.error) setError(result.error.message);
    else setUsers((result.data ?? []) as UserRow[]);
    setLoading(false);
  })(); }, []);

  const counts = useMemo(() => ({
    total: users.length,
    active: users.filter(user => user.is_active).length,
    verified: users.filter(user => Boolean(user.mobile)).length,
    byRole: Object.fromEntries(roleOrder.map(key => [key, users.filter(user => activeRoles(user).some(item => item.role === key)).length])) as Record<RoleKey, number>,
  }), [users]);

  const filtered = useMemo(() => {
    const clean = query.trim().toLocaleLowerCase("ar");
    const since = period === "all" ? 0 : referenceTime - Number(period) * 86_400_000;
    return users.filter(user => {
      const searchable = [user.full_name, user.username, user.email, user.mobile, user.id].filter(Boolean).join(" ").toLocaleLowerCase("ar");
      if (clean && !clean.split(/\s+/).every(token => searchable.includes(token))) return false;
      if (role !== "all" && !activeRoles(user).some(item => item.role === role)) return false;
      if (accountStatus === "active" && !user.is_active) return false;
      if (accountStatus === "inactive" && user.is_active) return false;
      if (phoneStatus === "verified" && !user.mobile) return false;
      if (phoneStatus === "missing" && user.mobile) return false;
      if (since && new Date(user.created_at).getTime() < since) return false;
      return true;
    }).sort((a, b) => {
      if (sort === "oldest") return a.created_at.localeCompare(b.created_at);
      if (sort === "name") return (a.full_name || a.username || "").localeCompare(b.full_name || b.username || "", "ar");
      if (sort === "updated") return b.updated_at.localeCompare(a.updated_at);
      return b.created_at.localeCompare(a.created_at);
    });
  }, [users, query, role, accountStatus, phoneStatus, period, sort, referenceTime]);

  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pages);
  const visible = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const hasFilters = Boolean(query || role !== "all" || accountStatus !== "all" || phoneStatus !== "all" || period !== "all" || sort !== "newest");
  const updateFilter = (action: () => void) => { action(); setPage(1); };
  const reset = () => { setQuery(""); setRole("all"); setAccountStatus("all"); setPhoneStatus("all"); setPeriod("all"); setSort("newest"); setPage(1); };

  return <div className="admin-page-stack">
    <header className="admin-page-header"><div><p>إدارة الهوية والصلاحيات</p><h2>المستخدمون</h2><span>بحث وفلترة موحدة لكل حسابات المنصة وأدوارها النشطة.</span></div><div className={styles.headerCount}><strong>{filtered.length.toLocaleString("ar-SA")}</strong><span>نتيجة مطابقة</span></div></header>

    <section className={styles.metrics} aria-label="ملخص المستخدمين">
      <button className={role === "all" ? styles.selectedMetric : ""} onClick={() => updateFilter(() => setRole("all"))}><span>كل المستخدمين</span><strong>{counts.total.toLocaleString("ar-SA")}</strong><small>{counts.active.toLocaleString("ar-SA")} حساب نشط</small></button>
      {roleOrder.map(key => <button key={key} className={role === key ? styles.selectedMetric : ""} onClick={() => updateFilter(() => setRole(key))}><span>{roleLabels[key]}</span><strong>{counts.byRole[key].toLocaleString("ar-SA")}</strong><small>بدور نشط</small></button>)}
    </section>

    <section className={`admin-panel ${styles.filterPanel}`}>
      <div className={styles.searchRow}>
        <label className={styles.search}><span aria-hidden>⌕</span><input value={query} onChange={event => updateFilter(() => setQuery(event.target.value))} placeholder="ابحث بالاسم، اسم المستخدم، البريد، الجوال أو المعرّف" aria-label="البحث في المستخدمين"/><kbd>بحث</kbd></label>
        <label><span>ترتيب النتائج</span><select value={sort} onChange={event => updateFilter(() => setSort(event.target.value as typeof sort))}><option value="newest">الأحدث تسجيلًا</option><option value="oldest">الأقدم تسجيلًا</option><option value="updated">آخر تحديث</option><option value="name">الاسم أبجديًا</option></select></label>
      </div>
      <div className={styles.filterGrid}>
        <label><span>الدور</span><select value={role} onChange={event => updateFilter(() => setRole(event.target.value as typeof role))}><option value="all">كل الأدوار</option>{roleOrder.map(key => <option value={key} key={key}>{roleLabels[key]}</option>)}</select></label>
        <label><span>حالة الحساب</span><select value={accountStatus} onChange={event => updateFilter(() => setAccountStatus(event.target.value as typeof accountStatus))}><option value="all">الكل</option><option value="active">نشط فقط</option><option value="inactive">موقوف فقط</option></select></label>
        <label><span>توثيق الجوال</span><select value={phoneStatus} onChange={event => updateFilter(() => setPhoneStatus(event.target.value as typeof phoneStatus))}><option value="all">الكل</option><option value="verified">جوال موثق</option><option value="missing">بدون جوال موثق</option></select></label>
        <label><span>تاريخ التسجيل</span><select value={period} onChange={event => updateFilter(() => setPeriod(event.target.value as typeof period))}><option value="all">كل الفترات</option><option value="7">آخر 7 أيام</option><option value="30">آخر 30 يومًا</option><option value="90">آخر 90 يومًا</option></select></label>
        {hasFilters ? <button className="admin-ghost" onClick={reset}>مسح الفلاتر</button> : null}
      </div>
      <div className={styles.resultLine}><span>عرض {visible.length ? ((currentPage - 1) * pageSize + 1).toLocaleString("ar-SA") : "٠"}–{Math.min(currentPage * pageSize, filtered.length).toLocaleString("ar-SA")} من {filtered.length.toLocaleString("ar-SA")}</span>{hasFilters ? <b>الفلاتر مفعلة</b> : <small>جميع الحسابات</small>}</div>
    </section>

    {error ? <div className="database-state database-error"><span>!</span><h2>تعذر تحميل المستخدمين</h2><p>{error}</p></div> : loading ? <div className="database-state"><span className="database-spinner"/><h2>جارٍ تحميل المستخدمين...</h2></div> : visible.length ? <section className={`admin-panel ${styles.tablePanel}`}>
      <div className={styles.tableWrap}><table><thead><tr><th>المستخدم</th><th>بيانات التواصل</th><th>الأدوار النشطة</th><th>الحالة</th><th>تاريخ التسجيل</th><th>آخر تحديث</th></tr></thead><tbody>{visible.map(user => <tr key={user.id}><td><div className={styles.identity}><span>{initials(user)}</span><div><strong>{user.full_name || "بدون اسم كامل"}</strong><small>@{user.username || "غير محدد"}</small><code title={user.id}>{user.id.slice(0, 8)}</code></div></div></td><td><div className={styles.contact}><b dir="ltr">{user.email || "بدون بريد"}</b><span dir="ltr">{user.mobile || "بدون جوال موثق"}</span></div></td><td><div className={styles.roles}>{activeRoles(user).map(item => <span data-role={item.role} key={item.role}>{roleLabels[item.role]}{item.is_primary ? <i title="الدور الأساسي">●</i> : null}</span>)}</div></td><td><div className={styles.accountState} data-active={user.is_active}><i/><div><b>{user.is_active ? "نشط" : "موقوف"}</b><small>{user.mobile ? "الجوال موثق" : "بانتظار توثيق الجوال"}</small></div></div></td><td><time dateTime={user.created_at}>{formatDate(user.created_at)}</time></td><td><time dateTime={user.updated_at}>{formatDate(user.updated_at)}</time></td></tr>)}</tbody></table></div>
    </section> : <div className="admin-empty"><span>⌕</span><h3>لا توجد نتائج مطابقة</h3><p>غيّر كلمات البحث أو امسح أحد الفلاتر للوصول إلى الحساب المطلوب.</p>{hasFilters ? <button className="admin-secondary" onClick={reset}>مسح جميع الفلاتر</button> : null}</div>}

    {!loading && !error && pages > 1 ? <nav className={styles.pagination} aria-label="صفحات المستخدمين"><button disabled={currentPage === 1} onClick={() => setPage(value => Math.max(1, value - 1))}>السابق</button><span>صفحة {currentPage.toLocaleString("ar-SA")} من {pages.toLocaleString("ar-SA")}</span><button disabled={currentPage === pages} onClick={() => setPage(value => Math.min(pages, value + 1))}>التالي</button></nav> : null}
  </div>;
}
