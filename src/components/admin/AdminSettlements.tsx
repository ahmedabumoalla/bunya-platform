"use client";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatRecordField, readableText, recordValue, stateLabels, type AdminRow } from "@/lib/admin/records";
import { AdminDecisionDialog } from "./AdminUI";
import styles from "./AdminRecords.module.css";

const actions: Record<string, string[]> = { requested: ["review", "reject", "cancel"], under_review: ["approve", "reject", "cancel"], approved: ["process"], processing: ["paid", "fail"] };
const actionLabels: Record<string, string> = { review: "بدء المراجعة", approve: "اعتماد التصفية", reject: "رفض الطلب", cancel: "إلغاء الطلب", process: "بدء التحويل", paid: "تأكيد التحويل", fail: "تسجيل تعذر التحويل" };
export function AdminSettlements() {
  const [rows, setRows] = useState<AdminRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [pending, setPending] = useState<{ row: AdminRow; action: string } | null>(null);
  const [reason, setReason] = useState("");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [decisionError, setDecisionError] = useState("");
  const [message, setMessage] = useState("");
  const load = useCallback((isCancelled?: () => boolean) => {
    return createClient().from("contractor_settlement_requests").select("id,settlement_code,amount,workflow_status,notes,review_notes,payment_reference,created_at,contractor:contractor_profiles(display_name),bank:contractor_bank_accounts(bank_name,iban_last4)").order("created_at", { ascending: false }).then(result => {
      if (isCancelled?.()) return;
      if (result.error) setError("تعذر تحميل طلبات التصفية. حاول مجددًا.");
      else { setError(""); setRows(result.data ?? []); }
      setLoading(false);
    }, () => {
      if (isCancelled?.()) return;
      setError("تعذر تحميل طلبات التصفية. حاول مجددًا."); setLoading(false);
    });
  }, []);
  useEffect(() => { let cancelled = false; void load(() => cancelled); return () => { cancelled = true; }; }, [load]);
  async function confirm() {
    if (!pending || busy) return;
    setBusy(true); setDecisionError("");
    try {
      const result = await createClient().rpc("transition_contractor_settlement", { p_id: pending.row.id, p_action: pending.action, p_reason: reason, p_reference: reference, p_idempotency_key: crypto.randomUUID() });
      if (result.error) throw result.error;
      setPending(null); setMessage("تم تحديث طلب التصفية."); await load();
    } catch { setDecisionError("تعذر تنفيذ القرار. تحقق من صلاحيتك وحالة الطلب وبيانات التحويل."); }
    finally { setBusy(false); }
  }
  const filtered = rows.filter(row => (status === "all" || row.workflow_status === status) && [row.settlement_code, recordValue(row, "contractor.display_name")].some(value => readableText(value).includes(query.trim())));
  return <div className={styles.page}>
    <header className={styles.hero}><div><span className={styles.eyebrow}>المالية</span><h1>تصفيات المقاولين</h1><p>راجع المستحقات، واعتمد الطلب، ثم سجّل التحويل مع مرجع الدفع.</p></div><button disabled={loading || busy} onClick={() => { setLoading(true); setError(""); void load(); }}>تحديث الطلبات</button></header>
    {error && <p className={styles.error} role="alert">{error}</p>}{message && <p className="admin-inline-success" role="status">{message}</p>}
    <section className={styles.panel}><div className={styles.toolbar}><label>بحث<input value={query} onChange={e => setQuery(e.target.value)} placeholder="اسم المقاول أو رقم التصفية" type="search"/></label><label>الحالة<select value={status} onChange={e => setStatus(e.target.value)}><option value="all">جميع الحالات</option>{[...new Set(rows.map(row => String(row.workflow_status)))].map(value => <option key={value} value={value}>{value === "requested" ? "طلب جديد" : stateLabels[value] ?? "قيد المتابعة"}</option>)}</select></label><span role="status">{filtered.length} طلب</span></div>
    {loading ? <div className={styles.empty} role="status">جارٍ تحميل التصفيات…</div> : error && !rows.length ? null : !filtered.length ? <div className={styles.empty}><h2>{rows.length ? "لا توجد نتائج مطابقة" : "لا توجد طلبات تصفية بعد"}</h2><p>تظهر هنا طلبات المقاولين لتحويل مستحقاتهم المتاحة.</p>{rows.length > 0 && <button onClick={() => { setStatus("all"); setQuery(""); }}>مسح الفلاتر</button>}</div> : <div className={styles.tableWrap} role="region" aria-label="طلبات تصفية المقاولين" tabIndex={0}><table><thead><tr>{["المقاول والتصفية", "المستحق", "حساب التحويل", "الحالة", "الإجراءات"].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead><tbody>{filtered.map(row => <tr key={String(row.id)}><td data-primary="true">{readableText(recordValue(row, "contractor.display_name"))}<small className="admin-record-date"><bdi>{String(row.settlement_code)}</bdi></small><small className="admin-record-date">{formatRecordField(row, { key: "created_at", label: "التاريخ", kind: "date" })}</small></td><td>{formatRecordField(row, { key: "amount", label: "المبلغ", kind: "money" })}</td><td>{readableText(recordValue(row, "bank.bank_name"))}<small className="admin-record-date">ينتهي بـ <bdi>{readableText(recordValue(row, "bank.iban_last4"))}</bdi></small></td><td><span className={styles.badge} data-tone={row.workflow_status === "paid" ? "success" : "pending"}>{row.workflow_status === "requested" ? "طلب جديد" : stateLabels[String(row.workflow_status)] ?? "قيد المتابعة"}</span>{row.payment_reference ? <small className="admin-record-date">مرجع التحويل: <bdi>{String(row.payment_reference)}</bdi></small> : null}</td><td><div className="admin-settlement-actions">{(actions[String(row.workflow_status)] ?? []).map(action => <button key={action} disabled={busy} onClick={() => { setPending({ row, action }); setReason(""); setReference(""); setDecisionError(""); }}>{actionLabels[action]}</button>)}{!(actions[String(row.workflow_status)]?.length) && "اكتملت المعالجة"}</div>{row.notes || row.review_notes ? <details className="admin-error-detail"><summary>الملاحظات</summary><p>{readableText(row.review_notes ?? row.notes)}</p></details> : null}</td></tr>)}</tbody></table></div>}
    </section>
    {pending && <AdminDecisionDialog title={actionLabels[pending.action]} description={`${readableText(recordValue(pending.row, "contractor.display_name"))} · ${formatRecordField(pending.row, { key: "amount", label: "المبلغ", kind: "money" })}${pending.action === "paid" ? " — أكّد فقط بعد إتمام التحويل البنكي الفعلي." : " — سيُحفظ القرار على طلب التصفية."}`} reason={pending.action === "paid" ? reference : reason} onReason={pending.action === "paid" ? setReference : setReason} reasonLabel={pending.action === "paid" ? "مرجع التحويل البنكي" : "سبب القرار"} minimumReasonLength={pending.action === "paid" ? 4 : 5} requiresReason={["reject", "fail", "paid"].includes(pending.action)} confirmLabel={actionLabels[pending.action]} busy={busy} errorMessage={decisionError} onCancel={() => setPending(null)} onConfirm={confirm}/>}
  </div>;
}
