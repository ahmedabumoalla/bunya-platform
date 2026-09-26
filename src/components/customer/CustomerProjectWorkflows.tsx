"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { customerReadableText } from "@/lib/customer/presentation";
import styles from "./CustomerProjectWorkflows.module.css";

export const customerProjectSelect = "id,request_code,title,project_type,description,scope,city,region,estimated_budget_min,estimated_budget_max,expected_start_at,estimated_duration,proposal_deadline_at,minimum_rating,budget_negotiable,lifecycle_status,project_request_specialties(specialty_name)";
export const customerProposalSelect = "id,proposal_code,amount,vat_inclusive,execution_duration,proposed_start_at,scope_details,includes,excludes,valid_until,warranty,team,notes,status,submitted_at,rejection_reason,change_request,contractor:contractor_profiles(display_name,commercial_name),contractor_opportunities!inner(project_request_id),contractor_proposal_stages(name,description,duration,value_percentage,expected_at,sort_order)";

type Project = {
  id: string; request_code: string; title: string; project_type: string; description: string;
  scope: string; city: string; region: string; estimated_budget_min: number | null;
  estimated_budget_max: number; expected_start_at: string; estimated_duration: string;
  proposal_deadline_at: string; minimum_rating: number | null; budget_negotiable: boolean;
  lifecycle_status: string; project_request_specialties: { specialty_name: string }[];
};
type Proposal = {
  id: string; proposal_code: string; amount: number; vat_inclusive: boolean;
  execution_duration: string | null; proposed_start_at: string | null; scope_details: string | null;
  includes: string[]; excludes: string[]; valid_until: string | null; warranty: string | null;
  team: string | null; notes: string | null; status: string; submitted_at: string | null;
  rejection_reason: string | null; change_request: string | null;
  contractor: { display_name: string; commercial_name: string } | null;
  contractor_proposal_stages: { name: string; description: string; duration: string; value_percentage: number; expected_at: string; sort_order: number }[];
};
type Decision = "accepted" | "needs_changes" | "rejected";
const decisionLabels: Record<Decision, string> = { accepted: "قبول العرض", needs_changes: "طلب تعديل", rejected: "رفض العرض" };
const statusLabels: Record<string, string> = {
  draft: "مسودة", pending_admin_review: "قيد المراجعة", needs_customer_changes: "بانتظار تعديلك",
  published: "منشور", receiving_proposals: "استقبال العروض", under_customer_review: "بانتظار قرارك",
  under_review: "بانتظار قرارك", needs_changes: "طُلب تعديل العرض", accepted: "عرض مقبول",
  awarded: "تم اختيار المقاول", in_progress: "قيد التنفيذ", completed: "مكتمل",
  rejected: "مرفوض", cancelled: "ملغي", expired: "انتهت المهلة", withdrawn: "مسحوب",
};
const projectTypes = ["بناء عظم", "تشطيب", "ترميم", "تصميم وتنفيذ", "أعمال كهربائية", "أعمال سباكة", "أعمال تكييف"];
const regions = ["المنطقة الوسطى", "المنطقة الغربية", "المنطقة الشرقية", "المنطقة الشمالية", "المنطقة الجنوبية"];
const numberFormat = new Intl.NumberFormat("ar-SA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function money(value: number) { return `${numberFormat.format(Number(value))} ر.س`; }
function dateLabel(value: string | null, includeTime = false) {
  if (!value) return "غير محدد";
  const date = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  if (Number.isNaN(date.getTime())) return "غير محدد";
  return new Intl.DateTimeFormat("ar-SA-u-ca-gregory", {
    dateStyle: "medium", ...(includeTime ? { timeStyle: "short" as const, timeZone: "Asia/Riyadh" } : {}),
  }).format(date);
}
function Status({ value }: { value: string }) {
  return <span className={styles.status} data-status={value}>{statusLabels[value] || "قيد المتابعة"}</span>;
}
function Field({ label, hint, wide, children }: { label: string; hint?: string; wide?: boolean; children: ReactNode }) {
  return <label className={`${styles.field} ${wide ? styles.wide : ""}`}><span>{label}</span>{children}{hint ? <small>{hint}</small> : null}</label>;
}
function PageHeading({ title, description }: { title: string; description: string }) {
  return <header className={styles.heading}>
    <Link href="/customer/project-requests" className={styles.back}>طلبات المشاريع <span aria-hidden="true">←</span></Link>
    <span className={styles.eyebrow}>مساحة المشاريع</span><h1>{title}</h1><p>{description}</p>
  </header>;
}
function requestError(message: string) {
  if (/Invalid deadline/i.test(message)) return "اختر موعدًا لاستقبال العروض بعد أكثر من ساعة من الآن.";
  if (/Verified customer|not authorized|JWT|session/i.test(message)) return "تعذر التحقق من حسابك. حدّث الصفحة وتأكد من تسجيل الدخول بحساب العميل.";
  if (/network|fetch/i.test(message)) return "تعذر الاتصال. تحقق من الإنترنت وأعد المحاولة؛ بيانات النموذج محفوظة في هذه الصفحة.";
  return "تعذر نشر المشروع. راجع الحقول ثم أعد المحاولة. إذا استمرت المشكلة، تواصل مع الدعم.";
}

export function ProjectRequestForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const attempt = useRef<{ fingerprint: string; key: string } | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    const data = new FormData(event.currentTarget);
    const value = (name: string) => String(data.get(name) ?? "").trim();
    const specialties = [...new Set(value("specialties").split(/[،,\n]/).map(item => item.trim()).filter(Boolean))];
    const deadline = new Date(value("proposal_deadline_at"));
    const min = value("budget_min");
    const max = Number(value("budget_max"));
    if (["title", "project_type", "description", "scope", "city", "region", "estimated_duration", "expected_start_at"].some(name => !value(name))) {
      setError("أكمل تفاصيل المشروع والموقع والمدة؛ لا يمكن ترك الحقول المطلوبة فارغة."); return;
    }
    if (value("project_type") === "أخرى") { setError("اكتب نوع المشروع المطلوب بوضوح بدل كلمة «أخرى»."); return; }
    if (!specialties.length || specialties.length > 20) { setError("أضف تخصصًا واحدًا على الأقل، وحتى ٢٠ تخصصًا، مع الفصل بينها بفاصلة."); return; }
    if (!Number.isFinite(max) || max <= 0 || (min && (!Number.isFinite(Number(min)) || Number(min) < 0 || Number(min) > max))) {
      setError("أدخل ميزانية صحيحة، واجعل الحد الأعلى أكبر من صفر ولا يقل عن الحد الأدنى."); return;
    }
    if (!Number.isFinite(deadline.getTime()) || deadline.getTime() <= Date.now() + 3600000) {
      setError("يجب أن يكون آخر موعد لاستقبال العروض بعد أكثر من ساعة من الآن."); return;
    }
    const request = {
      title: value("title"), project_type: value("project_type"), description: value("description"), scope: value("scope"),
      city: value("city"), region: value("region"), budget_min: min, budget_max: max,
      expected_start_at: value("expected_start_at"), estimated_duration: value("estimated_duration"),
      proposal_deadline_at: deadline.toISOString(), minimum_rating: value("minimum_rating"),
      budget_negotiable: data.get("budget_negotiable") === "on",
    };
    const fingerprint = JSON.stringify({ request, specialties });
    if (attempt.current?.fingerprint !== fingerprint) attempt.current = { fingerprint, key: crypto.randomUUID() };
    inFlight.current = true; setBusy(true); setError("");
    try {
      const result = await createClient().rpc("submit_customer_project_request", {
        p_request: request, p_specialties: specialties, p_idempotency_key: attempt.current.key,
      });
      if (result.error) { setError(requestError(result.error.message)); return; }
      if (!result.data) { setError("لم يصل تأكيد نشر المشروع. أعد المحاولة للتحقق من حالة الطلب."); return; }
      router.push(`/customer/project-requests/${encodeURIComponent(String(result.data))}`);
    } catch { setError("تعذر الاتصال. تحقق من الإنترنت وأعد المحاولة؛ بياناتك باقية في النموذج."); }
    finally { inFlight.current = false; setBusy(false); }
  }

  return <main className={styles.page}>
    <PageHeading title="مشروعك يبدأ بتفاصيل واضحة" description="عرّفنا بما تحتاجه، وحدد ميزانيتك ومواعيدك لاستقبال عروض المقاولين المناسبين." />
    <div className={styles.formLayout}>
      <form className={styles.form} onSubmit={submit} aria-busy={busy}>
        <fieldset className={styles.section} disabled={busy}>
          <legend>تفاصيل المشروع</legend><p className={styles.sectionIntro}>وصف محدد يساعد المقاول على تقديم عرض أدق. جميع الحقول مطلوبة إلا ما وُضح أنه اختياري.</p>
          <div className={styles.fields}>
            <Field label="عنوان المشروع" wide><input name="title" required maxLength={180} placeholder="مثال: تشطيب فيلا سكنية في شمال الرياض" /></Field>
            <Field label="نوع المشروع" hint="اختر اقتراحًا أو اكتب نوع المشروع المناسب."><input name="project_type" required list="customer-project-types" placeholder="اختر أو اكتب نوع المشروع" /><datalist id="customer-project-types">{projectTypes.map(type => <option key={type} value={type} />)}</datalist></Field>
            <Field label="التخصصات المطلوبة" hint="افصل بين التخصصات بفاصلة: بناء عظم، تشطيب."><input name="specialties" required placeholder="مثال: بناء عظم، تشطيب" /></Field>
            <Field label="وصف المشروع" wide><textarea name="description" required rows={4} placeholder="صف العقار وحالته الحالية والنتيجة التي ترغب بالوصول إليها." /></Field>
            <Field label="نطاق العمل" hint="اذكر الأعمال المطلوبة والكميات أو المساحات إن توفرت." wide><textarea name="scope" required rows={4} placeholder="مثال: أعمال الدهانات والأرضيات والتمديدات الكهربائية لمساحة ٣٠٠ م²." /></Field>
          </div>
        </fieldset>
        <fieldset className={styles.section} disabled={busy}>
          <legend>الموقع والميزانية</legend><p className={styles.sectionIntro}>تساعد المنطقة والتخصصات على توجيه طلبك إلى المقاولين المناسبين.</p>
          <div className={styles.fields}>
            <Field label="المدينة"><input name="city" required autoComplete="address-level2" placeholder="مثال: الرياض" /></Field>
            <Field label="منطقة العمل" hint="اختر من المناطق المقترحة أو اكتب المنطقة المسجلة لدى المقاولين."><input name="region" required list="customer-project-regions" placeholder="اختر أو اكتب المنطقة" /><datalist id="customer-project-regions">{regions.map(region => <option key={region} value={region} />)}</datalist></Field>
            <Field label="الحد الأدنى للميزانية — اختياري" hint="بالريال السعودي."><input name="budget_min" type="number" min="0" step="0.01" inputMode="decimal" placeholder="غير محدد" /></Field>
            <Field label="الحد الأعلى للميزانية" hint="بالريال السعودي."><input name="budget_max" type="number" min="0.01" step="0.01" inputMode="decimal" required placeholder="مثال: 150000" /></Field>
          </div>
          <label className={styles.checkbox}><input name="budget_negotiable" type="checkbox" /><span>الميزانية قابلة للتفاوض <small>يمكن للمقاول اقتراح مبلغ مختلف بحسب نطاق العمل.</small></span></label>
        </fieldset>
        <fieldset className={styles.section} disabled={busy}>
          <legend>المواعيد وتفضيلات المقاول</legend><div className={styles.fields}>
            <Field label="تاريخ البدء المتوقع"><input name="expected_start_at" type="date" required /></Field>
            <Field label="المدة التقديرية"><input name="estimated_duration" required placeholder="مثال: ٣ أشهر" /></Field>
            <Field label="آخر موعد لاستقبال العروض" hint="بتوقيت جهازك، وبعد أكثر من ساعة من الآن."><input name="proposal_deadline_at" type="datetime-local" required /></Field>
            <Field label="الحد الأدنى لتقييم المقاول — اختياري"><select name="minimum_rating" defaultValue=""><option value="">جميع التقييمات</option><option value="3">٣ من ٥ فأعلى</option><option value="3.5">٣٫٥ من ٥ فأعلى</option><option value="4">٤ من ٥ فأعلى</option><option value="4.5">٤٫٥ من ٥ فأعلى</option><option value="5">٥ من ٥</option></select></Field>
          </div>
        </fieldset>
        <div className={styles.submitArea}>{error ? <p className={styles.error} role="alert">{error}</p> : null}<p>بنشر المشروع، ستتاح تفاصيله للمقاولين المطابقين للمنطقة والتخصصات وتفضيلاتك.</p><div className={styles.actions}><button className={styles.primary} type="submit" disabled={busy}>{busy ? "جارٍ نشر المشروع…" : "نشر المشروع واستقبال العروض"}</button><Link href="/customer/project-requests" className={styles.secondary}>العودة إلى مشاريعي</Link></div></div>
      </form>
      <aside className={styles.guide} aria-label="دليل طلب المشروع"><span className={styles.eyebrow}>من الفكرة إلى التنفيذ</span><h2>تفاصيل أفضل،<br />عروض أوضح.</h2><p>اكتب ما يهمك من البداية لتكون المقارنة بين عروض المقاولين أسهل.</p><ol><li><strong>صف احتياجك</strong><span>حدد الأعمال المطلوبة والموقع والميزانية.</span></li><li><strong>راجع العروض</strong><span>قارن السعر والمدة ونطاق العمل لكل مقاول.</span></li><li><strong>اختر العرض المناسب</strong><span>اطلب تعديلًا أو اقبل العرض بعد مراجعة تفاصيله.</span></li></ol><Link href="/customer/support">تحتاج مساعدة في طلبك؟ <span aria-hidden="true">←</span></Link></aside>
    </div>
  </main>;
}

export function ProjectProposalDecisions({ id }: { id: string }) {
  const [project, setProject] = useState<Project | null>(null);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadedId, setLoadedId] = useState("");
  const [loadError, setLoadError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [sort, setSort] = useState("newest");
  const [filter, setFilter] = useState("all");
  const [notice, setNotice] = useState("");
  const [decisionError, setDecisionError] = useState("");
  const [active, setActive] = useState<{ proposalId: string; decision: Decision } | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const attempt = useRef<{ fingerprint: string; key: string } | null>(null);
  const reasonField = useRef<HTMLTextAreaElement>(null);
  const decisionTrigger = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const client = createClient();
    void Promise.all([
      client.from("project_requests").select(customerProjectSelect).eq("id", id).maybeSingle(),
      client.from("contractor_proposals").select(customerProposalSelect).eq("contractor_opportunities.project_request_id", id).neq("status", "draft").order("submitted_at", { ascending: false }),
    ]).then(([requestResult, proposalResult]) => {
      if (cancelled) return;
      setProject(requestResult.data as unknown as Project | null);
      setProposals((proposalResult.data ?? []) as unknown as Proposal[]);
      setLoadError(requestResult.error || proposalResult.error ? "تعذر تحميل تفاصيل المشروع أو عروضه. أعد المحاولة." : "");
      setLoadedId(id);
      setLoading(false);
    }).catch(() => { if (!cancelled) { setLoadError("تعذر الاتصال. تحقق من الإنترنت وأعد المحاولة."); setLoadedId(id); setLoading(false); } });
    return () => { cancelled = true; };
  }, [id, refresh]);
  useEffect(() => {
    if (active) reasonField.current?.focus();
    else if (decisionTrigger.current) {
      document.getElementById(decisionTrigger.current)?.focus();
      decisionTrigger.current = null;
    }
  }, [active]);

  function openDecision(proposalId: string, decision: Decision, trigger: HTMLButtonElement) {
    decisionTrigger.current = trigger.id;
    setActive({ proposalId, decision }); setReason(""); setDecisionError(""); setNotice("");
  }
  function cancelDecision() { setActive(null); setReason(""); setDecisionError(""); }
  async function decide(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!active || inFlight.current) return;
    const trimmed = reason.trim();
    if (trimmed.length < 5) { setDecisionError("اكتب سبب القرار أو التعديلات المطلوبة بخمسة أحرف على الأقل."); return; }
    const fingerprint = JSON.stringify({ ...active, reason: trimmed });
    if (attempt.current?.fingerprint !== fingerprint) attempt.current = { fingerprint, key: crypto.randomUUID() };
    inFlight.current = true; setBusy(true); setDecisionError("");
    try {
      const result = await createClient().rpc("decide_contractor_proposal", {
        p_proposal_id: active.proposalId, p_decision: active.decision, p_reason: trimmed, p_idempotency_key: attempt.current.key,
      });
      if (result.error) {
        setDecisionError(/not reviewable/i.test(result.error.message) ? "تغيّرت حالة العرض. حدّث العروض للاطلاع على آخر حالة قبل اتخاذ القرار." : "تعذر تسجيل القرار. أعد المحاولة أو حدّث العروض للتحقق من حالتها.");
        return;
      }
      setNotice(active.decision === "accepted" ? "تم قبول العرض واختيار المقاول لمشروعك." : active.decision === "needs_changes" ? "تم إرسال طلب التعديل إلى المقاول." : "تم تسجيل رفض العرض.");
      setActive(null); setReason(""); setLoading(true); setRefresh(value => value + 1);
    } catch { setDecisionError("تعذر الاتصال. حدّث العروض للتحقق من حالة القرار قبل إعادة المحاولة."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  function reload() { setLoading(true); setLoadError(""); setActive(null); setRefresh(value => value + 1); }

  if ((loading || loadedId !== id) && project?.id !== id) return <main className={styles.page}><PageHeading title="تفاصيل المشروع" description="راجع مشروعك وقارن عروض المقاولين في مكان واحد." /><div className={styles.empty} role="status">جارٍ تحميل المشروع وعروض المقاولين…</div></main>;
  if (!project || project.id !== id) return <main className={styles.page}><PageHeading title={loadError ? "تعذر تحميل المشروع" : "المشروع غير متاح"} description={loadError || "قد لا يكون الطلب موجودًا أو متاحًا لهذا الحساب."} />{loadError ? <button className={styles.secondary} onClick={reload}>إعادة المحاولة</button> : <Link href="/customer/project-requests" className={styles.primary}>العودة إلى مشاريعي</Link>}</main>;
  const reviewable = proposals.filter(proposal => ["under_review", "needs_changes"].includes(proposal.status)).length;
  const visible = proposals.filter(proposal => filter === "all" || (filter === "reviewable" ? ["under_review", "needs_changes"].includes(proposal.status) : proposal.status === filter)).sort((a, b) => sort === "lowest" ? Number(a.amount) - Number(b.amount) : sort === "highest" ? Number(b.amount) - Number(a.amount) : (b.submitted_at || "").localeCompare(a.submitted_at || ""));
  const isAwarded = ["awarded", "in_progress", "completed", "cancelled"].includes(project.lifecycle_status);

  return <main className={styles.page}>
    <PageHeading title={customerReadableText(project.title)} description={`${customerReadableText(project.project_type)} · ${customerReadableText(project.city)} · ${customerReadableText(project.region)}`} />
    <section className={styles.projectSummary} aria-label="ملخص المشروع"><div className={styles.summaryTop}><span className={styles.reference}>طلب <bdi>{project.request_code}</bdi></span><Status value={project.lifecycle_status} /></div><dl className={styles.summaryFacts}><div><dt>الميزانية التقديرية</dt><dd>{project.estimated_budget_min !== null ? `${money(project.estimated_budget_min)} — ` : "حتى "}{money(project.estimated_budget_max)}</dd><small>{project.budget_negotiable ? "قابلة للتفاوض" : "حسب الميزانية المحددة"}</small></div><div><dt>تاريخ البدء المتوقع</dt><dd>{dateLabel(project.expected_start_at)}</dd><small>مدة التنفيذ: {customerReadableText(project.estimated_duration)}</small></div><div><dt>آخر موعد للعروض</dt><dd>{dateLabel(project.proposal_deadline_at, true)}</dd><small>بتوقيت الرياض</small></div></dl><details className={styles.projectBrief}><summary>تفاصيل الطلب ونطاق العمل</summary><div className={styles.briefGrid}><div><h3>وصف المشروع</h3><p>{customerReadableText(project.description)}</p></div><div><h3>نطاق العمل</h3><p>{customerReadableText(project.scope)}</p></div></div><div className={styles.tags}>{project.project_request_specialties?.map(item => <span key={item.specialty_name}>{customerReadableText(item.specialty_name)}</span>)}</div>{project.minimum_rating !== null ? <p className={styles.muted}>الحد الأدنى لتقييم المقاول: {project.minimum_rating} من ٥</p> : null}</details></section>
    <section className={styles.proposals} aria-label="عروض المقاولين" aria-busy={loading}>
      <div className={styles.sectionHeading}><div><span className={styles.eyebrow}>الخطوة التالية</span><h2>عروض المقاولين <span className={styles.count}>{proposals.length.toLocaleString("ar-SA")}</span></h2><p>{reviewable ? `${reviewable.toLocaleString("ar-SA")} عرض بانتظار مراجعتك. قارن التفاصيل قبل اختيار المقاول.` : "كل عرض يوضح السعر والمدة ونطاق العمل المقترح."}</p></div><button className={styles.secondary} disabled={loading || busy} onClick={reload}>{loading ? "جارٍ التحديث…" : "تحديث العروض"}</button></div>
      {notice ? <p className={styles.success} role="status">{notice}</p> : null}{loadError ? <p className={styles.error} role="alert">{loadError}</p> : null}
      {proposals.length ? <div className={styles.toolbar}><label>عرض<select value={filter} disabled={busy} onChange={event => { setFilter(event.target.value); setActive(null); }}><option value="all">جميع العروض</option><option value="reviewable">بانتظار المراجعة</option><option value="accepted">العروض المقبولة</option><option value="rejected">العروض المرفوضة</option></select></label><label>ترتيب حسب<select value={sort} disabled={busy} onChange={event => setSort(event.target.value)}><option value="newest">الأحدث أولًا</option><option value="lowest">السعر: من الأقل</option><option value="highest">السعر: من الأعلى</option></select></label></div> : null}
      {!loadError && !visible.length ? <div className={styles.empty}><h3>{proposals.length ? "لا توجد عروض بهذا الاختيار" : "بانتظار أول عرض لمشروعك"}</h3><p>{proposals.length ? "يمكنك عرض جميع العروض والاطلاع على حالتها." : "ستظهر العروض هنا عند تقديمها من المقاولين، مع السعر والمدة والتفاصيل للمقارنة."}</p>{proposals.length ? <button className={styles.secondary} onClick={() => setFilter("all")}>عرض جميع العروض</button> : null}</div> : null}
      <div className={styles.proposalList}>{visible.map(proposal => <article className={styles.proposal} key={proposal.id}>
        <header className={styles.proposalHeader}><div className={styles.contractor}><span className={styles.avatar} aria-hidden="true">{customerReadableText(proposal.contractor?.display_name || "ب", "—").slice(0, 1)}</span><div><span className={styles.reference}><bdi>{proposal.proposal_code}</bdi></span><h3>{customerReadableText(proposal.contractor?.display_name || proposal.contractor?.commercial_name || "ملف المقاول غير متاح للعرض")}</h3>{proposal.contractor?.commercial_name && proposal.contractor.commercial_name !== proposal.contractor.display_name ? <p>{customerReadableText(proposal.contractor.commercial_name)}</p> : null}</div></div><Status value={proposal.status} /></header>
        <div className={styles.offerFacts}><div className={styles.price}><span>قيمة العرض</span><strong>{money(proposal.amount)}</strong><small>{proposal.vat_inclusive ? "شامل ضريبة القيمة المضافة" : "غير شامل ضريبة القيمة المضافة"}</small></div><dl><div><dt>مدة التنفيذ</dt><dd>{customerReadableText(proposal.execution_duration || "غير محددة")}</dd></div><div><dt>البدء المقترح</dt><dd>{dateLabel(proposal.proposed_start_at)}</dd></div><div><dt>صالح حتى</dt><dd>{dateLabel(proposal.valid_until, true)}</dd></div></dl></div>
        {proposal.scope_details ? <p className={styles.scope}>{customerReadableText(proposal.scope_details)}</p> : null}
        <details className={styles.offerDetails}><summary>تفاصيل العرض ومراحل التنفيذ</summary><div className={styles.briefGrid}><div><h4>يشمل العرض</h4>{proposal.includes?.length ? <ul>{proposal.includes.map((item, index) => <li key={`${index}-${item}`}>{customerReadableText(item)}</li>)}</ul> : <p className={styles.muted}>لم تُذكر بنود إضافية.</p>}</div><div><h4>لا يشمل العرض</h4>{proposal.excludes?.length ? <ul>{proposal.excludes.map((item, index) => <li key={`${index}-${item}`}>{customerReadableText(item)}</li>)}</ul> : <p className={styles.muted}>لم تُذكر استثناءات.</p>}</div>{proposal.warranty ? <div><h4>الضمان</h4><p>{customerReadableText(proposal.warranty)}</p></div> : null}{proposal.team ? <div><h4>فريق العمل</h4><p>{customerReadableText(proposal.team)}</p></div> : null}</div>{proposal.notes ? <div><h4>ملاحظات المقاول</h4><p>{customerReadableText(proposal.notes)}</p></div> : null}{proposal.contractor_proposal_stages?.length ? <div className={styles.stages}><h4>مراحل التنفيذ</h4>{[...proposal.contractor_proposal_stages].sort((a, b) => a.sort_order - b.sort_order).map((stage, index) => <div className={styles.stage} key={`${stage.sort_order}-${index}`}><strong>{customerReadableText(stage.name)}</strong><span>{stage.value_percentage}٪ من قيمة المشروع</span><p>{customerReadableText(stage.description)}</p><small>المدة: {customerReadableText(stage.duration)} · الموعد المتوقع: {dateLabel(stage.expected_at)}</small></div>)}</div> : <p className={styles.muted}>لم تُضف مراحل تنفيذ إلى هذا العرض.</p>}</details>
        {proposal.change_request ? <p className={styles.previousDecision}><strong>التعديلات المطلوبة:</strong> {customerReadableText(proposal.change_request)}</p> : null}{proposal.rejection_reason ? <p className={styles.previousDecision}><strong>سبب الرفض:</strong> {customerReadableText(proposal.rejection_reason)}</p> : null}
        {!isAwarded && ["under_review", "needs_changes"].includes(proposal.status) ? active?.proposalId === proposal.id ? <form className={styles.decision} onSubmit={decide}><h4>{decisionLabels[active.decision]}</h4><p>{active.decision === "accepted" ? "سيُختار هذا المقاول لتنفيذ المشروع وتُرفض العروض الأخرى التي قيد المراجعة. راجع السعر ونطاق العمل قبل التأكيد." : active.decision === "needs_changes" ? "وضح للمقاول ما تريد تعديله في السعر أو المدة أو نطاق العمل." : "أضف سببًا واضحًا لمساعدة المقاول على فهم قرارك."}</p><label className={styles.field}><span>{active.decision === "needs_changes" ? "التعديلات المطلوبة" : "سبب القرار"}</span><textarea ref={reasonField} value={reason} onChange={event => setReason(event.target.value)} disabled={busy} required minLength={5} rows={3} aria-invalid={Boolean(decisionError)} aria-describedby={decisionError ? `decision-error-${proposal.id}` : undefined} /></label>{decisionError ? <p id={`decision-error-${proposal.id}`} className={styles.error} role="alert">{decisionError}</p> : null}<div className={styles.actions}><button type="submit" className={styles.primary} disabled={busy}>{busy ? "جارٍ تسجيل القرار…" : `تأكيد ${decisionLabels[active.decision]}`}</button><button type="button" className={styles.secondary} onClick={cancelDecision} disabled={busy}>إلغاء</button></div></form> : <footer className={styles.actions}><button id={`decision-${proposal.id}-accepted`} className={styles.primary} disabled={busy || loading || Boolean(loadError)} onClick={event => openDecision(proposal.id, "accepted", event.currentTarget)}>قبول العرض</button><button id={`decision-${proposal.id}-needs_changes`} className={styles.secondary} disabled={busy || loading || Boolean(loadError)} onClick={event => openDecision(proposal.id, "needs_changes", event.currentTarget)}>طلب تعديل</button><button id={`decision-${proposal.id}-rejected`} className={styles.reject} disabled={busy || loading || Boolean(loadError)} onClick={event => openDecision(proposal.id, "rejected", event.currentTarget)}>رفض العرض</button></footer> : null}
      </article>)}</div>
    </section>
  </main>;
}
