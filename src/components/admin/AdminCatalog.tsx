"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import styles from "./AdminCatalog.module.css";

type Category = Record<string, unknown>;
const categoryArt: Record<string, { description: string; path: string }> = {
  cement: { description: "الأسمنت ومواد التأسيس", path: "M7 3h10l2 18H5L7 3ZM7 7h10M9 12h6m-3-3v6" },
  steel: { description: "حديد التسليح والقطاعات المعدنية", path: "M5 3h14v4h-5v10h5v4H5v-4h5V7H5V3Z" },
  "blocks-bricks": { description: "البلك والطوب وأعمال البناء", path: "M3 5h18v14H3V5Zm0 7h18M12 5v7M8 12v7m8-7v7" },
  insulation: { description: "حلول العزل وحماية المباني", path: "m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5" },
  plumbing: { description: "الأنابيب والتمديدات الصحية", path: "M4 3h6v7h10v6H8a4 4 0 0 1-4-4V3Zm-1 0h8m9 6v8M4 7h6m6 3v6" },
  electrical: { description: "الكابلات والتجهيزات الكهربائية", path: "m13 2-9 12h7l-1 8 10-13h-7l1-7Z" },
  wood: { description: "الأخشاب والألواح ومستلزماتها", path: "M4 3h16v18H4V3Zm5 0v18m6-18v18M6 7v4m6 2v5m6-13v5" },
  paint: { description: "الدهانات ومواد التشطيب", path: "M4 3h13v6H4V3Zm13 3h3v7h-9v3m-2 0h4v6H9v-6Z" },
  "tools-equipment": { description: "أدوات العمل وتجهيزات الموقع", path: "m14 3 7 7-4 4-3-3-8 10-3-3 10-8-3-3 4-4Z" },
};

function CategoryIcon({ slug }: { slug: string }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={categoryArt[slug]?.path ?? "M3 3h7v7H3V3Zm11 0h7v7h-7V3ZM3 14h7v7H3v-7Zm11 0h7v7h-7v-7Z"} /></svg>;
}

export function AdminCatalog({ rows }: { rows: Category[] }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const active = rows.filter(row => row.is_active === true).length;
  const filtered = useMemo(() => rows.filter(row => {
    const matchesStatus = status === "all" || (status === "active" ? row.is_active === true : row.is_active !== true);
    return matchesStatus && `${row.name ?? ""} ${row.slug ?? ""}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  }).sort((a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0)), [rows, query, status]);

  return <section className={styles.catalog} aria-labelledby="catalog-title">
    <header className={styles.header}>
      <div className={styles.heading}>
        <span className={styles.eyebrow}>إدارة الكتالوج</span>
        <h1 id="catalog-title">كل مواد البناء،<br /><span>في مكان منظّم.</span></h1>
        <p>استعرض التصنيفات وانتقل إلى تفاصيلها بسهولة.</p>
      </div>
      <div className={styles.overview}>
        <div className={styles.stats}>
          <div><strong>{rows.length.toLocaleString("ar-SA")}</strong><span>إجمالي التصنيفات</span></div>
          <div><strong>{active.toLocaleString("ar-SA")}</strong><span>تصنيفات نشطة</span></div>
          <div><strong>{(rows.length - active).toLocaleString("ar-SA")}</strong><span>غير نشطة</span></div>
        </div>
        <nav className={styles.actions} aria-label="إجراءات الكتالوج">
          <Link href="/admin/products/review">مراجعة المنتجات <span aria-hidden="true">↗</span></Link>
          <Link href="/admin/pricing">الأسعار والتوفر <span aria-hidden="true">↗</span></Link>
        </nav>
      </div>
    </header>

    <div className={styles.toolbar}>
      <label className={styles.search}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></svg>
        <input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="ابحث عن تصنيف…" aria-label="البحث في التصنيفات" />
      </label>
      <div className={styles.filters} role="group" aria-label="حالة التصنيف">
        {[["all", "الكل", rows.length], ["active", "نشط", active], ["inactive", "غير نشط", rows.length - active]].map(([value, label, count]) => <button key={value} type="button" aria-pressed={status === value} onClick={() => setStatus(String(value))}>{label}<span>{Number(count).toLocaleString("ar-SA")}</span></button>)}
      </div>
    </div>

    <div className={styles.sectionHeading}><h2>تصنيفات المنتجات</h2><span role="status">{filtered.length.toLocaleString("ar-SA")} تصنيف</span></div>
    {filtered.length ? <div className={styles.grid}>
      {filtered.map(row => {
        const slug = String(row.slug ?? "");
        return <Link className={styles.card} key={String(row.id)} href={`/admin/catalog/${encodeURIComponent(String(row.id))}`}>
          <div className={styles.cardTop}><span className={styles.icon}><CategoryIcon slug={slug} /></span><span className={styles.status} data-active={row.is_active === true}><i />{row.is_active === true ? "نشط" : "غير نشط"}</span></div>
          <h3>{String(row.name ?? "تصنيف")}</h3>
          <p>{categoryArt[slug]?.description ?? "استعرض بيانات هذا التصنيف وتفاصيله"}</p>
          <footer><span>استعراض التصنيف</span><span className={styles.arrow} aria-hidden="true">←</span></footer>
        </Link>;
      })}
    </div> : <div className={styles.empty}><h3>لا توجد تصنيفات مطابقة</h3><p>جرّب اسمًا آخر أو غيّر حالة التصنيف.</p><button type="button" onClick={() => { setQuery(""); setStatus("all"); }}>عرض كل التصنيفات</button></div>}
  </section>;
}
