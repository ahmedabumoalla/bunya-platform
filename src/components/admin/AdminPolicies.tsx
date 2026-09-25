"use client";

import Link from "next/link";
import { type FormEvent, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { policyDestinations, policyParagraphs } from "@/lib/policies/registry";
import styles from "./AdminPolicies.module.css";

type Policy = { id: string; policy_key: string; title: string; summary: string; body: unknown; version: number; is_published: boolean; published_at: string | null; updated_at: string };
export function AdminPolicyManager() {
  const [rows, setRows] = useState<Policy[]>([]);
  const [editing, setEditing] = useState<Policy | null>(null);
  const [destination, setDestination] = useState("terms");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const target = policyDestinations.find(item => item.key === destination);
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const result = await createClient().from("platform_policies").select("id,policy_key,title,summary,body,version,is_published,published_at,updated_at").order("updated_at", { ascending: false });
        if (result.error) throw result.error;
        if (active) setRows(result.data ?? []);
      } catch { if (active) setError("تعذر تحميل السياسات. تحقق من الاتصال وصلاحيات حسابك."); }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [refresh]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const title = String(form.get("title") ?? "").trim();
    const summary = String(form.get("summary") ?? "").trim();
    const body = policyParagraphs(String(form.get("body") ?? "").trim());
    const version = Number(form.get("version"));
    const published = form.get("published") === "on";
    setError(""); setMessage("");
    if (title.length < 3 || summary.length < 3 || !body.length || !Number.isInteger(version) || version < 1) { setError("أكمل العنوان والملخص والنص ورقم إصدار صحيح."); return; }
    if (/\?{3,}|\uFFFD/.test([title, summary, ...body].join(" "))) { setError("النص يحتوي على حروف غير مقروءة. صححها قبل الحفظ أو النشر."); return; }
    setBusy(true);
    try {
      const record = { policy_key: destination, title, summary, body, version, is_published: published, published_at: published ? new Date().toISOString() : null };
      const db = createClient();
      const result = editing ? await db.from("platform_policies").update(record).eq("id", editing.id).select("id").single() : await db.from("platform_policies").insert(record).select("id").single();
      if (result.error) throw result.error;
      setMessage(published ? `نُشرت السياسة في: ${target?.location ?? "مركز السياسات"}.` : "حُفظت مسودة السياسة. لن تظهر للمستخدمين حتى نشرها.");
      formElement.reset(); setEditing(null); setDestination("terms"); setRefresh(value => value + 1);
    } catch { setError("تعذر حفظ السياسة. تأكد من صلاحياتك، أو افتح السياسة الموجودة لتعديلها بدل تكرارها."); }
    finally { setBusy(false); }
  }
  function edit(policy: Policy | null) { setEditing(policy); setDestination(policy?.policy_key ?? "terms"); setMessage(""); setError(""); }

  return <main className={styles.page}>
    <header className={styles.hero}><div><span>حوكمة المنصة</span><h1>السياسات وأماكن ظهورها</h1><p>اختر نوع السياسة، وأضف محتواها، ثم انشرها في الصفحات المرتبطة بها تلقائيًا.</p></div><Link href="/policies" target="_blank" rel="noreferrer">فتح مركز السياسات ↗</Link></header>
    {error && <div className={styles.error} role="alert">{error}</div>}{message && <div className={styles.message} role="status">{message}</div>}
    <div className={styles.layout}>
      <section className={styles.panel}><h2>{editing ? "تعديل السياسة" : "سياسة جديدة"}</h2>
        <form key={editing?.id ?? "new"} onSubmit={event => void save(event)} className={styles.form}>
          <label>نوع السياسة ومكانها<select value={destination} onChange={event => setDestination(event.target.value)} disabled={busy}>{policyDestinations.map(item => <option value={item.key} key={item.key}>{item.label}</option>)}{!target && <option value={destination}>سياسة إضافية</option>}</select></label>
          <label>رقم الإصدار<input name="version" type="number" min="1" step="1" required defaultValue={editing?.version ?? 1} /></label>
          <aside className={styles.destination}><strong>ستظهر بعد النشر في</strong><p>{target?.location ?? "مركز السياسات وجميع الحسابات"}</p><Link href={target?.href ?? "/policies"} target="_blank" rel="noreferrer">فتح مكان العرض ↗</Link></aside>
          <label className={styles.wide}>عنوان السياسة<input name="title" required minLength={3} defaultValue={editing?.title ?? ""} placeholder={target?.label} /></label>
          <label className={styles.wide}>ملخص مختصر<textarea name="summary" required rows={2} defaultValue={editing?.summary ?? ""} /></label>
          <label className={styles.wide}>محتوى السياسة<textarea name="body" required rows={10} defaultValue={policyParagraphs(editing?.body).join("\n\n")} placeholder="اكتب النص المعتمد، وافصل بين الفقرات بسطر فارغ." /></label>
          <label className={styles.publish}><input type="checkbox" name="published" defaultChecked={editing?.is_published ?? false} /><span><strong>نشر السياسة للمستخدمين</strong><small>اتركه غير محدد لحفظ مسودة فقط.</small></span></label>
          <div className={styles.actions}><button type="submit" disabled={busy}>{busy ? "جارٍ الحفظ…" : "حفظ السياسة"}</button>{editing && <button type="button" disabled={busy} onClick={() => edit(null)}>إلغاء التعديل</button>}</div>
        </form>
      </section>
      <aside className={styles.panel}><h2>السياسات المسجلة <span>{rows.length}</span></h2>{loading ? <p>جارٍ التحميل…</p> : rows.length ? <div className={styles.list}>{rows.map(row => <button type="button" key={row.id} disabled={busy} onClick={() => edit(row)} aria-pressed={editing?.id === row.id}><header><strong>{row.title}</strong><span data-published={row.is_published}>{row.is_published ? "منشورة" : "مسودة"}</span></header><p>{policyDestinations.find(item => item.key === row.policy_key)?.location ?? "مركز السياسات"}</p><small>الإصدار {row.version} · تعديل السياسة ←</small></button>)}</div> : <div className={styles.empty}><strong>ابدأ بأول سياسة</strong><p>السياسات المحفوظة تظهر هنا. تبقى صفحات الشروط والخصوصية الأساسية متاحة حتى تنشر بديلًا لها.</p></div>}</aside>
    </div>
  </main>;
}
