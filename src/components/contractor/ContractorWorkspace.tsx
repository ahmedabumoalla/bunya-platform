"use client";
/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/set-state-in-effect */
import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useAuthIdentity } from "@/components/auth/AuthIdentityProvider";
import { createClient } from "@/lib/supabase/client";
import { optimizeUploadFile } from "@/lib/uploads/client";
import styles from "./ContractorWorkspace.module.css";
type Row = Record<string, any>;
const db = createClient();
const money = (value: unknown) => `${Number(value || 0).toLocaleString("ar-SA", { maximumFractionDigits: 2 })} ر.س`;
const date = (value: unknown) => value ? new Date(String(value)).toLocaleDateString("ar-SA") : "—";
const statusLabels: Record<string, string> = {
    pending: "بانتظار المراجعة", pending_review: "بانتظار المراجعة", approved: "معتمد", rejected: "مرفوض",
    needs_changes: "يحتاج تعديلات", new: "جديدة", viewed: "تم الاطلاع", proposed: "قُدّم عرض",
    draft: "مسودة", under_review: "قيد المراجعة", accepted: "مقبول", awaiting_start: "بانتظار البدء",
    in_progress: "قيد التنفيذ", awaiting_milestone_approval: "بانتظار اعتماد مرحلة", completed: "مكتمل",
    paused: "متوقف مؤقتًا", cancelled: "ملغي", not_started: "لم تبدأ", awaiting_customer_approval: "بانتظار العميل",
    delayed: "متأخرة", pending_admin_review: "بانتظار مراجعة الإدارة", needs_contractor_revision: "تحتاج تعديلك",
    published_to_customer: "مرسلة للعميل", customer_approved: "وافق العميل", customer_rejected: "رفضها العميل",
    budget_change: "تعديل الميزانية", duration_change: "تعديل المدة", clarification: "استفسار", missing_drawings: "طلب مستندات",
    commercial_registration: "السجل التجاري", freelance_certificate: "وثيقة العمل الحر", municipal_license: "رخصة بلدية",
    vat_certificate: "شهادة الضريبة", national_address: "العنوان الوطني", other: "مستند آخر",
    national_id: "الهوية الوطنية", company_profile: "ملف الشركة", portfolio: "عمل سابق",
    daily_report: "تقرير يومي", weekly_report: "تقرير أسبوعي", note: "ملاحظة", evidence: "إثبات إنجاز", issue: "مشكلة",
    unpaid: "لم تُدفع", paid: "مدفوع", partially_paid: "مدفوع جزئيًا", overdue: "متأخر", pending_payment: "بانتظار الدفع",
};
const label = (value: unknown) => statusLabels[String(value)] || String(value || "—");
const tone = (value: unknown) => ["approved", "accepted", "completed", "customer_approved"].includes(String(value)) ? styles.good : ["rejected", "cancelled", "customer_rejected"].includes(String(value)) ? styles.danger : styles.warn;
function Page({ title, description, children, state, stateLabel = "حالة الحساب", backHref, backLabel }: {
    title: string;
    description: string;
    children: ReactNode;
    state?: string;
    stateLabel?: string;
    backHref?: string;
    backLabel?: string;
}) {
    return <section className={`${styles.page} database-page`}>{backHref ? <Link className={styles.backLink} href={backHref}>← {backLabel || "العودة"}</Link> : null}<header className={styles.hero}><div><p className={styles.eyebrow}>مساحة عمل المقاول</p><h1>{title}</h1><p className={styles.description}>{description}</p></div>{state ? <aside className={styles.heroAside}><small>{stateLabel}</small><Badge value={state}/></aside> : null}</header>{children}</section>;
}
function Loading() { return <div className={styles.loading} role="status" aria-live="polite"><span className={styles.loadingMark} aria-hidden="true"/><strong>نجهّز مساحة عملك</strong><span>جارٍ تحميل بيانات حساب المقاول…</span></div>; }
function ErrorBox({ value }: {
    value: string;
}) { return value ? <div className={styles.error} role="alert"><strong>تعذر إتمام الطلب</strong><span>{value}</span></div> : null; }
function Empty({ title, text, action, href }: {
    title: string;
    text: string;
    action?: string;
    href?: string;
}) { return <section className={styles.empty}><div><span className={styles.emptyMark} aria-hidden="true">—</span><h2>{title}</h2><p>{text}</p>{action && href ? <Link className={styles.primary} href={href}>{action}</Link> : null}</div></section>; }
function Badge({ value }: {
    value: unknown;
}) { return <span className={`${styles.badge} ${tone(value)}`}>{label(value)}</span>; }
function SectionHeading({ title, text, count }: {
    title: string;
    text?: string;
    count?: number;
}) { return <header className={styles.sectionHeading}><div><h2>{title}</h2>{text ? <p>{text}</p> : null}</div>{count !== undefined ? <span className={styles.count}>{count.toLocaleString("ar-SA")}</span> : null}</header>; }
function Overview({ items }: {
    items: {
        label: string;
        value: string | number;
        href?: string;
    }[];
}) { return <section className={styles.metrics} aria-label="ملخص النشاط">{items.map(item => { const content = <><span>{item.label}</span><strong>{typeof item.value === "number" ? item.value.toLocaleString("ar-SA") : item.value}</strong>{item.href ? <small>عرض التفاصيل ←</small> : null}</>; return item.href ? <Link className={styles.metric} href={item.href} key={item.label}>{content}</Link> : <article className={styles.metric} key={item.label}>{content}</article>; })}</section>; }
function Progress({ value }: {
    value: unknown;
}) { const percent = Math.max(0, Math.min(100, Number(value) || 0)); return <div className={styles.progress} role="progressbar" aria-label="نسبة إنجاز المشروع" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}><span style={{ width: `${percent}%` }}/></div>; }
function useContractor() { const identity = useAuthIdentity(); return { identity, contractorId: identity.details.contractor?.contractorProfileId || "" }; }
export function ContractorDashboard() {
    const { contractorId } = useContractor();
    const [profile, setProfile] = useState<Row | null>(null), [counts, setCounts] = useState<Record<string, number>>({}), [loading, setLoading] = useState(true), [error, setError] = useState("");
    useEffect(() => {
        let active = true;
        void (async () => {
            if (!contractorId) {
                setLoading(false);
                return;
            }
            const requests = [
                db.from("contractor_profiles").select("*").eq("id", contractorId).single(),
                db.from("contractor_opportunities").select("id", { count: "exact", head: true }).eq("contractor_profile_id", contractorId),
                db.from("contractor_proposals").select("id", { count: "exact", head: true }).eq("contractor_profile_id", contractorId),
                db.from("contractor_projects").select("id", { count: "exact", head: true }).eq("contractor_profile_id", contractorId),
                db.from("contractor_reviews").select("id", { count: "exact", head: true }).eq("contractor_profile_id", contractorId),
                db.from("contractor_documents").select("id", { count: "exact", head: true }).eq("contractor_profile_id", contractorId).eq("is_current", true),
                db.from("contractor_services").select("id", { count: "exact", head: true }).eq("profile_id", contractorId),
                db.from("contractor_portfolio_items").select("id", { count: "exact", head: true }).eq("profile_id", contractorId),
            ];
            const [p, opportunities, proposals, projects, reviews, documents, services, portfolio] = await Promise.all(requests);
            if (!active)
                return;
            const firstError = [p, opportunities, proposals, projects, reviews, documents, services, portfolio].find(x => x.error)?.error;
            if (firstError)
                setError(firstError.message);
            setProfile(p.data as Row);
            setCounts({ opportunities: opportunities.count || 0, proposals: proposals.count || 0, projects: projects.count || 0, reviews: reviews.count || 0, documents: documents.count || 0, services: services.count || 0, portfolio: portfolio.count || 0 });
            setLoading(false);
        })().catch(() => { if (active) {
            setError("تعذر تحميل بيانات الحساب. حدّث الصفحة للمحاولة مجددًا.");
            setLoading(false);
        } });
        return () => { active = false; };
    }, [contractorId]);
    if (loading)
        return <Loading />;
    const profileReady = Boolean(profile?.city && profile?.badge && profile?.summary && profile?.display_name);
    const checks = [{ ok: profileReady, text: "اكتمال بيانات الملف المهني", href: "/contractor/profile" }, { ok: counts.documents > 0, text: "رفع مستند إثبات واحد على الأقل", href: "/contractor/verification" }, { ok: counts.services > 0, text: "إضافة خدمة واحدة على الأقل", href: "/contractor/services" }, { ok: counts.portfolio > 0, text: "إضافة عمل سابق", href: "/contractor/portfolio" }, { ok: profile?.approval_status === "approved", text: "اعتماد الحساب من الإدارة", href: "/contractor/verification" }];
    return <Page title={`مرحبًا ${profile?.display_name || "بك"}`} description="تابع فرصك وعروضك ومشاريعك، وحدّد خطوتك التالية من مكان واحد." state={profile?.approval_status}>
    <ErrorBox value={error}/>
    <Overview items={[{ label: "فرص المشاريع", value: counts.opportunities || 0, href: "/contractor/opportunities" }, { label: "العروض المقدمة", value: counts.proposals || 0, href: "/contractor/proposals" }, { label: "مشاريعك", value: counts.projects || 0, href: "/contractor/projects" }, { label: "تقييمات العملاء", value: counts.reviews || 0, href: "/contractor/reviews" }]}/>
    <section className={styles.grid}>
      <article className={`${styles.panel} ${styles.nextStep}`}><p className={styles.eyebrow}>خطوتك التالية</p><h2>{profile?.approval_status !== "approved" ? "جهّز حسابك لاستقبال الفرص" : "اكتشف المشاريع المناسبة لك"}</h2>
        {profile?.approval_status !== "approved" ? <><p>أكمل ملفك المهني وارفع مستندات نشاطك. يمكنك متابعة قرار الإدارة من صفحة التحقق.</p><div className={styles.actions}><Link className={styles.primary} href="/contractor/verification">متابعة التحقق</Link><Link className={styles.secondary} href="/contractor/profile">إكمال الملف</Link></div></> : <><p>راجع نطاق العمل والمدة والميزانية، ثم قدّم عرضك على الدعوات التي تناسب فريقك. لا يتطلب استقبال الفرص اشتراكًا شهريًا. تُطبّق عمولة بُنية بنسبة ٥٪ على المشاريع المتعاقد عليها.</p><div className={styles.actions}><Link className={styles.primary} href="/contractor/opportunities">استعراض الفرص</Link><Link className={styles.secondary} href="/contractor/projects">متابعة المشاريع</Link></div></>}
        <div className={styles.quickLinks}><Link href="/contractor/services">إدارة الخدمات ←</Link><Link href="/contractor/portfolio">تحديث الأعمال السابقة ←</Link></div>
      </article>
      <article className={styles.panel}><SectionHeading title="جاهزية الحساب" text={`${checks.filter(item => item.ok).length.toLocaleString("ar-SA")} من ${checks.length.toLocaleString("ar-SA")} متطلبات مكتملة`}/><div className={styles.checklist}>{checks.map(item => <Link className={styles.check} href={item.href} key={item.text}><span aria-hidden="true" className={`${styles.checkMark} ${item.ok ? "" : styles.checkMarkPending}`}>{item.ok ? "✓" : "!"}</span><span>{item.text}<small>{item.ok ? "مكتمل" : "يحتاج إلى متابعة"}</small></span><span className={styles.checkArrow} aria-hidden="true">←</span></Link>)}</div></article>
    </section>
  </Page>;
}
export function ContractorOpportunities() {
    const { contractorId } = useContractor();
    const [rows, setRows] = useState<Row[]>([]), [profile, setProfile] = useState<Row | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState("");
    useEffect(() => { void Promise.all([db.rpc("get_contractor_opportunities"), db.from("contractor_profiles").select("approval_status").eq("id", contractorId).single()]).then(([r, p]) => { setRows((r.data || []) as Row[]); setProfile(p.data as Row); setError(r.error?.message || p.error?.message || ""); setLoading(false); }).catch(() => { setError("تعذر تحميل البيانات. حدّث الصفحة للمحاولة مجددًا."); setLoading(false); }); }, [contractorId]);
    if (loading)
        return <Loading />;
    return <Page title="فرص المشاريع" description="مشاريع تناسب تخصصاتك ومناطق عملك. راجع التفاصيل واختر الفرصة المناسبة لفريقك." state={profile?.approval_status}><ErrorBox value={error}/><Overview items={[{ label: "فرص متاحة", value: rows.length }, { label: "مدن المشاريع", value: new Set(rows.map(row => row.city).filter(Boolean)).size }]}/><SectionHeading title="الفرص المناسبة لك" text="اطّلع على متطلبات المشروع قبل إعداد عرضك." count={rows.length}/>{rows.length ? <section className={styles.list}>{rows.map(row => <article className={styles.card} key={row.opportunity_id}><div className={styles.cardHead}><div><h2>{row.title}</h2><p>{row.description}</p></div><Badge value="new"/></div><div className={styles.meta}><span>{row.city} · {row.region}</span><span>آخر موعد: {date(row.proposal_deadline_at)}</span><span>{row.estimated_budget_min || row.estimated_budget_max ? `${money(row.estimated_budget_min)} – ${money(row.estimated_budget_max)}` : "الميزانية غير محددة"}</span></div><div className={styles.actions}><Link className={styles.primary} href={`/contractor/opportunities/${row.opportunity_id}`}>دراسة الفرصة وتقديم عرض</Link></div></article>)}</section> : <Empty title="لا توجد فرص متاحة لهذا الحساب" text={profile?.approval_status !== "approved" ? "لن تُعرض الفرص قبل اعتماد ملف المقاول. أكمل بياناتك وارفع مستندات الإثبات أولًا." : "حسابك جاهز، ولا توجد حاليًا مشاريع مفتوحة تطابق تخصصاتك ومناطق عملك."} action={profile?.approval_status !== "approved" ? "إكمال التحقق" : "مراجعة الخدمات"} href={profile?.approval_status !== "approved" ? "/contractor/verification" : "/contractor/services"}/>}</Page>;
}
export function ContractorProjects() {
    const { contractorId } = useContractor();
    const [rows, setRows] = useState<Row[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState("");
    useEffect(() => { void Promise.resolve(db.from("contractor_projects").select("id,project_code,name,status,project_value,progress,start_at,expected_end_at,payment_status,next_payment_label,updated_at").eq("contractor_profile_id", contractorId).order("updated_at", { ascending: false })).then(r => { setRows((r.data || []) as Row[]); setError(r.error?.message || ""); setLoading(false); }).catch(() => { setError("تعذر تحميل البيانات. حدّث الصفحة للمحاولة مجددًا."); setLoading(false); }); }, [contractorId]);
    if (loading)
        return <Loading />;
    return <Page title="المشاريع" description="المشاريع المسندة إليك ومراحل التنفيذ ونسب الإنجاز الفعلية."><ErrorBox value={error}/><Overview items={[{ label: "إجمالي المشاريع", value: rows.length }, { label: "قيد التنفيذ", value: rows.filter(row => row.status === "in_progress").length }, { label: "بانتظار البدء", value: rows.filter(row => row.status === "awaiting_start").length }, { label: "مكتملة", value: rows.filter(row => row.status === "completed").length }]}/><SectionHeading title="سجل المشاريع" count={rows.length}/>{rows.length ? <section className={styles.list}>{rows.map(row => <article className={styles.card} key={row.id}><div className={styles.cardHead}><div><h2>{row.name}</h2><p>{row.project_code}</p></div><Badge value={row.status}/></div><div className={styles.meta}><span>قيمة المشروع: {money(row.project_value)}</span><span>من {date(row.start_at)} إلى {date(row.expected_end_at)}</span><span>الدفع: {label(row.payment_status)}</span></div><Progress value={row.progress}/><div className={styles.meta}><span>الإنجاز {Number(row.progress || 0).toLocaleString("ar-SA")}%</span>{row.next_payment_label ? <span>الدفعة التالية: {row.next_payment_label}</span> : null}</div><div className={styles.actions}><Link className={styles.primary} href={`/contractor/projects/${row.id}`}>إدارة المشروع</Link></div></article>)}</section> : <Empty title="لا توجد مشاريع مسندة" text="عندما يقبل العميل عرضك، تجد مشروعك هنا مع المراحل والتحديثات ومواعيد التنفيذ." action="عرض الفرص" href="/contractor/opportunities"/>}</Page>;
}
export function ContractorProjectDetail({ id }: {
    id: string;
}) {
    const { contractorId } = useContractor();
    const [project, setProject] = useState<Row | null>(null), [milestones, setMilestones] = useState<Row[]>([]), [updates, setUpdates] = useState<Row[]>([]), [loading, setLoading] = useState(true), [busy, setBusy] = useState(""), [error, setError] = useState("");
    const load = useCallback(async () => { const [p, m, u] = await Promise.all([db.from("contractor_projects").select("*").eq("id", id).eq("contractor_profile_id", contractorId).maybeSingle(), db.from("contractor_project_milestones").select("*").eq("project_id", id).order("sort_order"), db.from("contractor_project_updates").select("*").eq("project_id", id).order("created_at", { ascending: false })]); setProject(p.data as Row); setMilestones((m.data || []) as Row[]); setUpdates((u.data || []) as Row[]); setError(p.error?.message || m.error?.message || u.error?.message || ""); setLoading(false); }, [contractorId, id]);
    useEffect(() => { void load().catch(() => { setError("تعذر تحميل البيانات. حدّث الصفحة للمحاولة مجددًا."); setLoading(false); }); }, [load]);
    const transition = async (milestoneId: string, action: string) => { setBusy(milestoneId); setError(""); try {
        const r = await db.rpc("transition_contractor_milestone", { p_milestone_id: milestoneId, p_action: action, p_note: null });
        if (r.error)
            setError(r.error.message);
        else
            await load();
    }
    catch {
        setError("تعذر تحديث المرحلة. حاول مرة أخرى.");
    }
    finally {
        setBusy("");
    } };
    const addUpdate = async (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); const element = e.currentTarget; setBusy("update"); setError(""); try {
        const form = new FormData(element);
        const r = await db.from("contractor_project_updates").insert({ project_id: id, contractor_profile_id: contractorId, update_type: form.get("type"), title: form.get("title"), description: form.get("description") });
        if (r.error)
            setError(r.error.message);
        else {
            element.reset();
            await load();
        }
    }
    catch {
        setError("تعذر حفظ التحديث. حاول مرة أخرى.");
    }
    finally {
        setBusy("");
    } };
    if (loading)
        return <Loading />;
    if (!project)
        return <Page title="المشروع غير موجود" description="تعذر العثور على هذا المشروع ضمن حسابك."><ErrorBox value={error}/><Empty title="لا يمكن فتح المشروع" text="قد يكون الرابط غير صحيح أو أن المشروع لا يخص حساب المقاول الحالي." action="العودة للمشاريع" href="/contractor/projects"/></Page>;
    return <Page title={project.name} description={`إدارة المشروع ${project.project_code}`} state={project.status} stateLabel="حالة المشروع" backHref="/contractor/projects" backLabel="كل المشاريع"><ErrorBox value={error}/><section className={styles.panel}><div className={styles.detailGrid}><div><span>قيمة المشروع</span><strong>{money(project.project_value)}</strong></div><div><span>الإنجاز</span><strong>{Number(project.progress || 0).toLocaleString("ar-SA")}%</strong></div><div><span>حالة الدفع</span><strong>{label(project.payment_status)}</strong></div><div><span>تاريخ البدء</span><strong>{date(project.start_at)}</strong></div><div><span>النهاية المتوقعة</span><strong>{date(project.expected_end_at)}</strong></div><div><span>العميل</span><strong>{project.customer_label || "عميل بُنية"}</strong></div>{project.platform_commission_rate != null ? <div><span>عمولة بُنية للمشروع</span><strong>{Number(project.platform_commission_rate).toLocaleString("ar-SA")}%</strong></div> : null}{project.platform_commission_amount != null ? <div><span>قيمة العمولة المتفق عليها</span><strong>{money(project.platform_commission_amount)}</strong></div> : null}</div><h2 className={styles.detailHeading}>نطاق المشروع</h2><p>{project.scope}</p></section><section className={styles.panel}><SectionHeading title="مراحل التنفيذ" text="ابدأ كل مرحلة ثم أرسل إنجازها لاعتماد العميل." count={milestones.length}/>{milestones.length ? <div className={styles.timeline}>{milestones.map(m => <article className={styles.timelineItem} key={m.id}><div className={styles.cardHead}><div><h3>{m.name}</h3><p>{m.description}</p></div><Badge value={m.status}/></div><div className={styles.meta}><span>{date(m.start_at)} – {date(m.expected_end_at)}</span><span>الوزن {Number(m.value_percentage)}%</span><span>الإنجاز {Number(m.progress)}%</span></div><div className={styles.actions}>{m.status === "not_started" ? <button disabled={Boolean(busy)} className={styles.primary} onClick={() => void transition(m.id, "start")}>بدء المرحلة</button> : null}{["in_progress", "delayed"].includes(m.status) ? <><button disabled={Boolean(busy)} className={styles.primary} onClick={() => void transition(m.id, "submit")}>إرسال لاعتماد العميل</button><button disabled={Boolean(busy)} className={styles.secondary} onClick={() => void transition(m.id, "delay")}>تسجيل تأخير</button></> : null}</div></article>)}</div> : <p className={styles.muted}>لم تُحدد مراحل لهذا المشروع.</p>}</section><section className={styles.grid}><article className={styles.panel}><SectionHeading title="أضف تحديثًا للمشروع" text="وثّق الإنجاز والملاحظات لإبقاء سجل المشروع واضحًا."/><form className={styles.form} onSubmit={e => void addUpdate(e)}><label>نوع التحديث<select name="type"><option value="daily_report">تقرير يومي</option><option value="weekly_report">تقرير أسبوعي</option><option value="note">ملاحظة</option><option value="evidence">إثبات إنجاز</option><option value="issue">مشكلة</option></select></label><label>العنوان<input name="title" required/></label><label className={styles.wide}>التفاصيل<textarea name="description" minLength={10} required rows={4}/></label><button className={styles.primary} disabled={Boolean(busy)}>{busy === "update" ? "جارٍ حفظ التحديث…" : "حفظ التحديث"}</button></form></article><article className={styles.panel}><SectionHeading title="آخر التحديثات" count={updates.length}/>{updates.length ? <div className={styles.list}>{updates.map(u => <div className={styles.reply} key={u.id}><strong>{u.title}</strong><p>{u.description}</p><small>{date(u.created_at)} · {label(u.update_type)}</small></div>)}</div> : <p className={styles.muted}>لا توجد تحديثات مسجلة بعد.</p>}</article></section></Page>;
}
export function ContractorProposals() {
    const { contractorId } = useContractor();
    const [rows, setRows] = useState<Row[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState("");
    useEffect(() => { void Promise.resolve(db.from("contractor_proposals").select("id,proposal_code,opportunity_id,amount,vat_inclusive,execution_duration,status,valid_until,submitted_at,change_request,rejection_reason,updated_at").eq("contractor_profile_id", contractorId).order("updated_at", { ascending: false })).then(r => { setRows((r.data || []) as Row[]); setError(r.error?.message || ""); setLoading(false); }).catch(() => { setError("تعذر تحميل البيانات. حدّث الصفحة للمحاولة مجددًا."); setLoading(false); }); }, [contractorId]);
    if (loading)
        return <Loading />;
    return <Page title="العروض المقدمة" description="تابع حالة كل عرض ورد العميل وأي تعديلات مطلوبة."><ErrorBox value={error}/><Overview items={[{ label: "إجمالي العروض", value: rows.length }, { label: "قيد المراجعة", value: rows.filter(row => row.status === "under_review").length }, { label: "مقبولة", value: rows.filter(row => row.status === "accepted").length }, { label: "تحتاج تعديلًا", value: rows.filter(row => row.status === "needs_changes").length }]}/><SectionHeading title="عروضك" count={rows.length}/>{rows.length ? <section className={styles.list}>{rows.map(row => <article className={styles.card} key={row.id}><div className={styles.cardHead}><div><h2>{row.proposal_code}</h2><p>{money(row.amount)} {row.vat_inclusive ? "شامل الضريبة" : "غير شامل الضريبة"}</p></div><Badge value={row.status}/></div><div className={styles.meta}><span>مدة التنفيذ: {row.execution_duration || "—"}</span><span>صالح حتى: {date(row.valid_until)}</span><span>التقديم: {date(row.submitted_at)}</span></div>{row.change_request ? <p className={styles.note}>التعديلات المطلوبة: {row.change_request}</p> : null}{row.rejection_reason ? <p className={styles.note}>سبب الرفض: {row.rejection_reason}</p> : null}<div className={styles.actions}><Link className={styles.primary} href={`/contractor/proposals/${row.id}`}>تفاصيل العرض</Link>{["draft", "needs_changes"].includes(row.status) ? <Link className={styles.secondary} href={`/contractor/opportunities/${row.opportunity_id}`}>تعديل العرض</Link> : null}</div></article>)}</section> : <Empty title="لم تقدم عروضًا بعد" text="بعد اعتماد حسابك ستصلك دعوات المشاريع المناسبة، ويمكنك تقديم عرضك من صفحة الفرص." action="عرض الفرص" href="/contractor/opportunities"/>}</Page>;
}
export function ContractorProposalDetail({ id }: {
    id: string;
}) {
    const { contractorId } = useContractor();
    const [row, setRow] = useState<Row | null>(null), [stages, setStages] = useState<Row[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState("");
    useEffect(() => { void Promise.all([db.from("contractor_proposals").select("*").eq("id", id).eq("contractor_profile_id", contractorId).maybeSingle(), db.from("contractor_proposal_stages").select("*").eq("proposal_id", id).order("sort_order")]).then(([p, s]) => { setRow(p.data as Row); setStages((s.data || []) as Row[]); setError(p.error?.message || s.error?.message || ""); setLoading(false); }).catch(() => { setError("تعذر تحميل التفاصيل. حدّث الصفحة للمحاولة مجددًا."); setLoading(false); }); }, [contractorId, id]);
    if (loading)
        return <Loading />;
    if (!row)
        return <Page title="العرض غير موجود" description="هذا العرض غير متاح ضمن حسابك."><ErrorBox value={error}/><Empty title="تعذر فتح العرض" text="تحقق من الرابط أو ارجع إلى قائمة عروضك." action="العودة للعروض" href="/contractor/proposals"/></Page>;
    return <Page title={`العرض ${row.proposal_code}`} description="راجع نطاق العمل والقيمة والمراحل، وتابع قرار العميل على عرضك." state={row.status} stateLabel="حالة العرض" backHref="/contractor/proposals" backLabel="كل العروض"><ErrorBox value={error}/><section className={styles.panel}><div className={styles.detailGrid}><div><span>المبلغ</span><strong>{money(row.amount)}</strong></div><div><span>الضريبة</span><strong>{row.vat_inclusive ? "شامل الضريبة" : "غير شامل"}</strong></div><div><span>مدة التنفيذ</span><strong>{row.execution_duration || "—"}</strong></div><div><span>البدء المقترح</span><strong>{date(row.proposed_start_at)}</strong></div><div><span>صالح حتى</span><strong>{date(row.valid_until)}</strong></div><div><span>تاريخ التقديم</span><strong>{date(row.submitted_at)}</strong></div></div><h2 className={styles.detailHeading}>نطاق العرض</h2><p>{row.scope_details || "—"}</p>{row.warranty ? <p><strong>الضمان:</strong> {row.warranty}</p> : null}{row.team ? <p><strong>فريق العمل:</strong> {row.team}</p> : null}{row.change_request ? <p className={styles.note}>طلب التعديل: {row.change_request}</p> : null}{row.rejection_reason ? <p className={styles.note}>سبب الرفض: {row.rejection_reason}</p> : null}</section><section className={styles.panel}><SectionHeading title="خطة التنفيذ" text="المراحل والمواعيد المقترحة ضمن عرضك." count={stages.length}/>{stages.length ? <div className={styles.timeline}>{stages.map(stage => <div className={styles.timelineItem} key={stage.id}><h3>{stage.name}</h3><p>{stage.description}</p><div className={styles.meta}><span>{stage.duration}</span><span>{Number(stage.value_percentage)}% من قيمة العرض</span><span>{date(stage.expected_at)}</span></div></div>)}</div> : <p className={styles.muted}>لا توجد مراحل مسجلة.</p>}{["draft", "needs_changes"].includes(row.status) ? <div className={styles.actions}><Link className={styles.primary} href={`/contractor/opportunities/${row.opportunity_id}`}>تعديل العرض وإرساله</Link></div> : null}</section></Page>;
}
export function ContractorProjectComments() {
    const { contractorId } = useContractor();
    const [rows, setRows] = useState<Row[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState("");
    useEffect(() => { void Promise.resolve(db.from("contractor_project_comments").select("*").eq("contractor_profile_id", contractorId).order("created_at", { ascending: false })).then(r => { setRows((r.data || []) as Row[]); setError(r.error?.message || ""); setLoading(false); }).catch(() => { setError("تعذر تحميل البيانات. حدّث الصفحة للمحاولة مجددًا."); setLoading(false); }); }, [contractorId]);
    if (loading)
        return <Loading />;
    return <Page title="تعليقات المشاريع" description="تابع طلبات التغيير والاستفسارات وملاحظات الإدارة وردود العملاء."><ErrorBox value={error}/><Overview items={[{ label: "الطلبات والتعليقات", value: rows.length }, { label: "بانتظار الإدارة", value: rows.filter(row => row.status === "pending_admin_review").length }, { label: "تحتاج ردّك", value: rows.filter(row => row.status === "needs_contractor_revision").length }]}/><SectionHeading title="سجل المتابعة" count={rows.length}/>{rows.length ? <section className={styles.list}>{rows.map(row => <article className={styles.card} key={row.id}><div className={styles.cardHead}><div><h2>{row.comment_code}</h2><p>{row.body}</p></div><Badge value={row.status}/></div><div className={styles.meta}><span>النوع: {label(row.type)}</span><span>التاريخ: {date(row.created_at)}</span></div>{row.admin_reason || row.admin_note ? <p className={styles.note}>{row.admin_reason || row.admin_note}</p> : null}{row.customer_decision_note ? <p className={styles.note}>رد العميل: {row.customer_decision_note}</p> : null}</article>)}</section> : <Empty title="لا توجد تعليقات مشاريع" text="تجد هنا طلبات تغيير نطاق العمل والميزانية والمدة، مع ملاحظات الإدارة وقرارات العملاء." action="عرض المشاريع" href="/contractor/projects"/>}</Page>;
}
export function ContractorReviews() {
    const { contractorId } = useContractor();
    const [rows, setRows] = useState<Row[]>([]), [loading, setLoading] = useState(true), [busy, setBusy] = useState(""), [error, setError] = useState("");
    const load = useCallback(async () => { const r = await db.from("contractor_reviews").select("*,contractor_projects(name,project_code),contractor_review_replies(reply,updated_at)").eq("contractor_profile_id", contractorId).order("created_at", { ascending: false }); setRows((r.data || []) as Row[]); setError(r.error?.message || ""); setLoading(false); }, [contractorId]);
    useEffect(() => { void load().catch(() => { setError("تعذر تحميل البيانات. حدّث الصفحة للمحاولة مجددًا."); setLoading(false); }); }, [load]);
    const reply = async (e: FormEvent<HTMLFormElement>, reviewId: string) => { e.preventDefault(); setBusy(reviewId); try {
        const form = new FormData(e.currentTarget), result = await db.from("contractor_review_replies").upsert({ review_id: reviewId, contractor_profile_id: contractorId, reply: form.get("reply") }, { onConflict: "review_id" });
        if (result.error)
            setError(result.error.message);
        else
            await load();
    }
    catch {
        setError("تعذر حفظ الرد. حاول مرة أخرى.");
    }
    finally {
        setBusy("");
    } };
    if (loading)
        return <Loading />;
    return <Page title="التقييمات" description="اطّلع على تجربة العملاء مع فريقك، وأضف ردّك على كل تقييم."><ErrorBox value={error}/><Overview items={[{ label: "تقييمات العملاء", value: rows.length }, { label: "متوسط التقييم", value: rows.length ? `${(rows.reduce((sum, row) => sum + Number(row.rating), 0) / rows.length).toLocaleString("ar-SA", { maximumFractionDigits: 1 })} / ٥` : "—" }]}/><SectionHeading title="آراء العملاء" text="ردّك يظهر بجانب التقييم ويساعد في توضيح تجربة المشروع." count={rows.length}/>{rows.length ? <section className={styles.list}>{rows.map(row => { const savedReply = Array.isArray(row.contractor_review_replies) ? row.contractor_review_replies[0]?.reply : row.contractor_review_replies?.reply; return <article className={styles.card} key={row.id}><div className={styles.cardHead}><div><h2>{row.contractor_projects?.name || row.contractor_projects?.project_code || "تقييم مشروع"}</h2><div className={styles.stars} aria-label={`التقييم ${row.rating} من 5`}>{"★".repeat(Number(row.rating))}{"☆".repeat(5 - Number(row.rating))}</div></div><strong>{Number(row.rating).toLocaleString("ar-SA")}/5</strong></div><p>{row.comment}</p><div className={styles.meta}><span>الالتزام {row.commitment}/5</span><span>الجودة {row.quality}/5</span><span>التواصل {row.communication}/5</span><span>الوقت {row.timeliness}/5</span><span>{date(row.created_at)}</span></div><form className={styles.form} onSubmit={e => void reply(e, row.id)}><label className={styles.wide}>رد المقاول<textarea name="reply" minLength={3} required rows={3} defaultValue={savedReply || ""}/></label><button className={styles.primary} disabled={busy === row.id}>{busy === row.id ? "جارٍ حفظ الرد…" : savedReply ? "تحديث الرد" : "نشر الرد"}</button></form></article>; })}</section> : <Empty title="لا توجد تقييمات حتى الآن" text="يستطيع العميل تقييم المقاول بعد اكتمال مشروع فعلي. ستظهر التقييمات هنا فور إضافتها." action="عرض المشاريع" href="/contractor/projects"/>}</Page>;
}
export function ContractorVerification() {
    const { identity, contractorId } = useContractor();
    const [profile, setProfile] = useState<Row | null>(null), [docs, setDocs] = useState<Row[]>([]), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
    const load = useCallback(async () => { const [p, d] = await Promise.all([db.from("contractor_profiles").select("approval_status,directory_visible,sensitive_changes_pending_review").eq("id", contractorId).single(), db.from("contractor_documents").select("*").eq("contractor_profile_id", contractorId).eq("is_current", true).order("created_at", { ascending: false })]); let hydrated = (d.data || []) as Row[]; hydrated = await Promise.all(hydrated.map(async (item) => ({ ...item, signed_url: item.application_id ? `/api/contractor/documents/${item.id}` : (await db.storage.from("contractor-documents").createSignedUrl(item.storage_path, 300)).data?.signedUrl || "" }))); setProfile(p.data as Row); setDocs(hydrated); setError(p.error?.message || d.error?.message || ""); setLoading(false); }, [contractorId]);
    useEffect(() => { void load().catch(() => { setError("تعذر تحميل البيانات. حدّث الصفحة للمحاولة مجددًا."); setLoading(false); }); }, [load]);
    const upload = async (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); const element = e.currentTarget; if (docs.filter(item => !item.application_id).length >= 5)
        return setError("الحد الأقصى خمسة مستندات. احذف مستندًا غير معتمد قبل رفع بديل."); setBusy(true); setError(""); setMessage(""); try {
        const form = new FormData(element), selected = form.get("file");
        if (!(selected instanceof File) || !selected.size) {
            setBusy(false);
            return setError("اختر ملفًا صالحًا.");
        }
        if (!["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(selected.type) || selected.size > 5 * 1024 * 1024) {
            setBusy(false);
            return setError("الملف يجب أن يكون PDF أو صورة وبحجم لا يتجاوز 5MB.");
        }
        const file = await optimizeUploadFile(selected), safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "-") || "document", path = `${identity.userId}/${contractorId}/${crypto.randomUUID()}-${safe}`;
        const stored = await db.storage.from("contractor-documents").upload(path, file, { contentType: file.type, upsert: false });
        if (stored.error) {
            setBusy(false);
            return setError(stored.error.message);
        }
        const inserted = await db.from("contractor_documents").insert({ contractor_profile_id: contractorId, application_id: null, document_type: form.get("documentType"), document_number: form.get("documentNumber") || null, issued_at: form.get("issuedAt") || null, expires_at: form.get("expiresAt") || null, status: "pending_review", storage_path: path, file_name: file.name, mime_type: file.type, size_bytes: file.size });
        if (inserted.error) {
            await db.storage.from("contractor-documents").remove([path]);
            setError(inserted.error.message);
        }
        else {
            setMessage("تم رفع المستند وإرساله لمراجعة الإدارة.");
            element.reset();
            await load();
        }
    }
    catch {
        setError("تعذر رفع المستند. تحقق من الاتصال وحاول مرة أخرى.");
    }
    finally {
        setBusy(false);
    } };
    const remove = async (row: Row) => { if (row.status === "approved" || row.application_id)
        return; setBusy(true); try {
        const deleted = await db.from("contractor_documents").delete().eq("id", row.id).eq("contractor_profile_id", contractorId).is("application_id", null);
        if (deleted.error)
            setError(deleted.error.message);
        else {
            await db.storage.from("contractor-documents").remove([row.storage_path]);
            await load();
        }
    }
    catch {
        setError("تعذر حذف المستند. حاول مرة أخرى.");
    }
    finally {
        setBusy(false);
    } };
    if (loading)
        return <Loading />;
    return <Page title="المستندات والتحقق" description="ارفع مستندات نشاطك هنا؛ تُحفظ في مساحة خاصة ولا يطّلع عليها إلا حسابك والإدارة." state={profile?.approval_status}><ErrorBox value={error}/>{message ? <div className={styles.message} role="status">{message}</div> : null}<section className={styles.grid}><article className={styles.panel}><h2>حالة التحقق</h2><div className={styles.checklist}><div className={styles.check}><span className={`${styles.checkMark} ${profile?.approval_status === "approved" ? "" : styles.checkMarkPending}`}>{profile?.approval_status === "approved" ? "✓" : "!"}</span><span>اعتماد الإدارة: {label(profile?.approval_status)}</span></div><div className={styles.check}><span className={`${styles.checkMark} ${docs.length ? "" : styles.checkMarkPending}`}>{docs.length ? "✓" : "!"}</span><span>المستندات المرفوعة: {docs.length}</span></div></div><p className={styles.note}>رفع المستند لا يعتمد الحساب آليًا؛ يظهر للإدارة للمراجعة، وستتغير الحالة هنا بعد اتخاذ القرار.</p></article><article className={styles.panel}><SectionHeading title="إضافة مستند" text="أرفق مستندًا واضحًا وحديثًا لدعم التحقق من نشاطك."/><form className={styles.form} onSubmit={e => void upload(e)}><label>نوع المستند<select name="documentType"><option value="commercial_registration">السجل التجاري</option><option value="freelance_certificate">وثيقة العمل الحر</option><option value="municipal_license">رخصة بلدية</option><option value="vat_certificate">شهادة الضريبة</option><option value="national_address">العنوان الوطني</option><option value="other">مستند آخر</option></select></label><label>رقم المستند<input name="documentNumber"/></label><label>تاريخ الإصدار<input name="issuedAt" type="date"/></label><label>تاريخ الانتهاء<input name="expiresAt" type="date"/></label><label className={styles.wide}>الملف <span className={styles.fieldHint}>PDF أو JPG أو PNG أو WebP، بحد أقصى 5 ميجابايت</span><input required name="file" type="file" accept="application/pdf,image/png,image/jpeg,image/webp"/></label><button className={styles.primary} disabled={busy || docs.filter(item => !item.application_id).length >= 5}>{busy ? "جارٍ الرفع…" : "رفع للمراجعة"}</button></form></article></section><section className={styles.panel}><SectionHeading title="مستنداتك" text="افتح الملف للاطلاع عليه أو تابع حالة مراجعته." count={docs.length}/>{docs.length ? <div className={styles.tableWrap} role="region" aria-label="المستندات المرفوعة" tabIndex={0}><table className={styles.table}><caption className={styles.srOnly}>مستندات الحساب وحالة مراجعتها</caption><thead><tr><th scope="col">الملف</th><th scope="col">النوع</th><th scope="col">الرقم</th><th scope="col">الحالة</th><th scope="col">الانتهاء</th><th scope="col">الإجراء</th></tr></thead><tbody>{docs.map(row => <tr key={row.id}><td>{row.signed_url ? <a className={styles.fileLink} href={row.signed_url} target="_blank" rel="noreferrer">{row.file_name}</a> : row.file_name}</td><td>{label(row.document_type)}</td><td>{row.document_number || "—"}</td><td><Badge value={row.status}/>{row.rejection_reason ? <small>{row.rejection_reason}</small> : null}</td><td>{date(row.expires_at)}</td><td>{row.status !== "approved" && !row.application_id ? <button className={styles.dangerButton} disabled={busy} aria-label={`حذف المستند ${row.file_name}`} onClick={() => void remove(row)}>حذف</button> : "محفوظ"}</td></tr>)}</tbody></table></div> : <Empty title="لم ترفع مستندات بعد" text="ارفع سجلًا تجاريًا أو وثيقة عمل حر أو أي إثبات مناسب ليتمكن فريق الإدارة من مراجعة الحساب."/>}</section></Page>;
}
