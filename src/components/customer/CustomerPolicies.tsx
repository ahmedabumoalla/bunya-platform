"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { customerReadableText } from "@/lib/customer/presentation";
import { policyDestinations, policyForAudience, policyParagraphs } from "@/lib/policies/registry";
import styles from "./CustomerPolicies.module.css";

export const customerPolicySelect = "id,policy_key,title,summary,body,version,published_at,updated_at";
type Policy = {
  id: string;
  policy_key: string;
  title: string;
  summary: string | null;
  body: unknown;
  version: string | number | null;
  published_at: string | null;
  updated_at: string | null;
};
const basicDocuments = [
  { key: "terms", title: "شروط الاستخدام", description: "شروط استخدام منصة بُنية وخدماتها.", href: "/terms" },
  { key: "privacy", title: "سياسة الخصوصية", description: "تعرف على سياسة التعامل مع بياناتك.", href: "/privacy" },
  { key: "account-deletion", title: "حذف الحساب والبيانات", description: "خطوات طلب حذف حسابك وبياناتك.", href: "/account-deletion" },
];

function policyDate(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("ar-SA-u-ca-gregory", { dateStyle: "long", timeZone: "Asia/Riyadh" }).format(date) : null;
}

export function CustomerPolicies() {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    void createClient().from("platform_policies").select(customerPolicySelect)
      .eq("is_published", true).order("published_at", { ascending: false })
      .then(result => {
        if (cancelled) return;
        if (result.error) setError("تعذر تحميل السياسات. أعد المحاولة، أو افتح المستندات الأساسية أدناه.");
        else { setPolicies((result.data ?? []).filter(policy => policyForAudience(policy.policy_key, "customer")) as Policy[]); setError(""); }
        setLoading(false);
      }, () => { if (!cancelled) { setError("تعذر الاتصال. تحقق من الإنترنت وأعد المحاولة."); setLoading(false); } });
    return () => { cancelled = true; };
  }, [refresh]);

  const term = search.trim().toLocaleLowerCase("ar");
  const visible = policies.filter(policy => [policy.title, policy.summary, ...policyParagraphs(policy.body)].filter(Boolean).join(" ").toLocaleLowerCase("ar").includes(term));
  const fallbackDocuments = basicDocuments.filter(document => !policies.some(policy => policy.policy_key === document.key));

  function retry() { setLoading(true); setError(""); setRefresh(value => value + 1); }

  return <main className={styles.page}>
    <header className={styles.heading}>
      <span className={styles.eyebrow}>مرجعك في بُنية</span>
      <div><h1>السياسات والشروط</h1><Link href="/customer/support" className={styles.supportLink}>لديك استفسار؟ تواصل معنا <span aria-hidden="true">←</span></Link></div>
      <p>كل ما تحتاج معرفته عن استخدام المنصة وطلباتك وبيانات حسابك، في مكان واحد.</p>
    </header>

    <div className={styles.layout}>
      <aside className={styles.index} aria-label="فهرس السياسات">
        <div className={styles.indexHeader}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v5h4M9 12h6M9 16h6" /></svg><h2>في هذه الصفحة</h2></div>
        <p>انتقل مباشرة إلى السياسة التي تريد قراءتها.</p>
        <nav aria-label="الانتقال إلى سياسة"><ul>{visible.map(policy => <li key={policy.id}><a href={`#customer-policy-${policy.id}`}>{customerReadableText(policy.title)}<span aria-hidden="true">←</span></a></li>)}{fallbackDocuments.length ? <li><a href="#customer-basic-documents">المستندات الأساسية<span aria-hidden="true">←</span></a></li> : null}</ul></nav>
        <div className={styles.indexNote}><strong>مخصصة لحساب العميل</strong><p>تجد هنا السياسات المنشورة التي تنطبق على استخدامك للمنصة.</p></div>
      </aside>

      <div className={styles.content} aria-busy={loading}>
        <section className={styles.searchBar} aria-label="البحث في السياسات">
          <label htmlFor="customer-policy-search">ابحث عن سياسة أو موضوع</label>
          <div><input id="customer-policy-search" type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="مثال: الدفع، الإلغاء، الخصوصية" disabled={loading && !policies.length} /><span role="status">{loading ? "جارٍ التحميل…" : `${visible.length.toLocaleString("ar-SA")} سياسة`}</span></div>
        </section>

        {error ? <div className={styles.error} role="alert"><p>{error}</p><button onClick={retry} disabled={loading}>إعادة المحاولة</button></div> : null}
        {loading && !policies.length ? <div className={styles.empty} role="status"><h2>جارٍ تحميل السياسات…</h2><p>نجهز لك السياسات المنشورة لحساب العميل.</p></div> : null}
        {!loading && !error && !visible.length ? <div className={styles.empty}><h2>{term ? "لا توجد نتائج مطابقة" : "مستندات استخدام المنصة"}</h2><p>{term ? "جرّب كلمة أخرى أو اعرض جميع السياسات." : "يمكنك مراجعة الشروط والخصوصية وإجراءات حذف الحساب من الروابط أدناه."}</p>{term ? <button onClick={() => setSearch("")}>عرض جميع السياسات</button> : null}</div> : null}

        {visible.map(policy => {
          const paragraphs = policyParagraphs(policy.body);
          const destination = policyDestinations.find(item => item.key === policy.policy_key);
          const date = policyDate(policy.published_at || policy.updated_at);
          return <article id={`customer-policy-${policy.id}`} className={styles.policy} key={policy.id} aria-labelledby={`customer-policy-title-${policy.id}`}>
            <header><span className={styles.category}>{destination?.label || "سياسة عامة"}</span><h2 id={`customer-policy-title-${policy.id}`}>{customerReadableText(policy.title)}</h2><div className={styles.meta}>{policy.version !== null && policy.version !== "" ? <span>الإصدار <bdi>{policy.version}</bdi></span> : null}{date ? <span>{policy.published_at ? "تاريخ النشر" : "آخر تحديث"}: <time dateTime={policy.published_at || policy.updated_at || undefined}>{date}</time></span> : null}</div></header>
            {policy.summary ? <p className={styles.summary}>{customerReadableText(policy.summary)}</p> : null}
            <div className={styles.body}>{paragraphs.length ? paragraphs.map((paragraph, index) => <p key={index}>{customerReadableText(paragraph)}</p>) : <p className={styles.bodyEmpty}>لا يتوفر نص تفصيلي لهذه السياسة حاليًا. يمكنك التواصل مع الدعم للاستفسار.</p>}</div>
            <footer><a href="#customer-policy-search">العودة إلى البحث <span aria-hidden="true">↑</span></a>{destination && ["terms", "privacy", "account-deletion"].includes(policy.policy_key) ? <Link href={destination.href}>فتح صفحة السياسة <span aria-hidden="true">←</span></Link> : null}</footer>
          </article>;
        })}

        {fallbackDocuments.length ? <section id="customer-basic-documents" className={styles.basicDocuments} aria-labelledby="customer-basic-title"><div><span className={styles.eyebrow}>روابط مرجعية</span><h2 id="customer-basic-title">المستندات الأساسية</h2><p>افتح المستند للاطلاع على نصه الكامل.</p></div><div className={styles.documentLinks}>{fallbackDocuments.map(document => <Link key={document.key} href={document.href}><div><h3>{document.title}</h3><p>{document.description}</p></div><span aria-hidden="true">←</span></Link>)}</div></section> : null}
      </div>
    </div>
  </main>;
}
