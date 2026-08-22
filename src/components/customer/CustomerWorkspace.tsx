/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/set-state-in-effect */
"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useAuthIdentity } from "@/components/auth/AuthIdentityProvider";
import { createClient } from "@/lib/supabase/client";

type Row = Record<string, any>;
type AddressForm = {
  id: string;
  label: string;
  projectName: string;
  googleMapsUrl: string;
  city: string;
  region: string;
  description: string;
  recipientName: string;
  recipientMobile: string;
  isDefault: boolean;
};

const db = createClient();
const emptyAddress: AddressForm = {
  id: "",
  label: "",
  projectName: "",
  googleMapsUrl: "",
  city: "",
  region: "",
  description: "",
  recipientName: "",
  recipientMobile: "",
  isDefault: false,
};

const statusLabels: Record<string, string> = {
  draft: "مسودة",
  submitted: "مُرسل",
  under_review: "قيد المراجعة",
  sourcing: "جاري التسعير",
  quoted: "تم إصدار العرض",
  ready: "جاهز",
  customer_review: "بانتظار قرارك",
  accepted: "مقبول",
  rejected: "مرفوض",
  expired: "منتهي",
  confirmed: "مؤكد",
  preparing: "قيد التجهيز",
  in_transit: "في الطريق",
  delivered: "تم التسليم",
  cancelled: "ملغي",
  pending: "قيد الانتظار",
  paid: "مدفوع",
  unpaid: "غير مدفوع",
  available: "متاح",
};

const label = (value: unknown) => statusLabels[String(value ?? "")] ?? String(value ?? "—").replaceAll("_", " ");
const date = (value: unknown) => value ? new Date(String(value)).toLocaleString("ar-SA") : "—";
const money = (value: unknown) => `${Number(value ?? 0).toLocaleString("ar-SA", { maximumFractionDigits: 2 })} ر.س`;

function Shell({ title, description, actions, error, message, loading, children }: {
  title: string;
  description: string;
  actions?: ReactNode;
  error?: string;
  message?: string;
  loading?: boolean;
  children: ReactNode;
}) {
  return <main className="database-page customer-workspace">
    <header className="database-page-header">
      <div><p>حساب العميل</p><h1>{title}</h1><span>{description}</span></div>
      {actions ? <aside className="customer-header-actions">{actions}</aside> : null}
    </header>
    {error ? <div className="database-state database-error customer-inline-state"><span>!</span><p>{error}</p></div> : null}
    {message ? <div className="customer-success-message">{message}</div> : null}
    {loading ? <div className="database-state"><span className="database-spinner"/><h2>جارٍ تحميل بياناتك...</h2></div> : children}
  </main>;
}

function Empty({ text, action }: { text: string; action?: ReactNode }) {
  return <div className="database-state customer-empty"><span>✓</span><p>{text}</p>{action}</div>;
}

function Badge({ value }: { value: unknown }) {
  return <span className="database-status">{label(value)}</span>;
}

function useCustomerRows(loader: () => PromiseLike<{ data: any; error: { message: string } | null }>, key: string) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    const result = await loader();
    setRows((result.data ?? []) as Row[]);
    setError(result.error?.message ?? "");
    setLoading(false);
  // The key explicitly identifies the stable query; the inline loader must not retrigger it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => { void load(); }, [load]);
  return { rows, loading, error, setError, load };
}

export function CustomerDashboard() {
  const identity = useAuthIdentity();
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [recent, setRecent] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => { void (async () => {
    const tables = ["quote_requests", "bunya_customer_quotes", "orders", "project_requests"];
    const [metrics, latest] = await Promise.all([
      Promise.all(tables.map(async table => {
        const result = await db.from(table).select("*", { count: "exact", head: true });
        return { table, count: result.count ?? 0, error: result.error };
      })),
      db.from("customer_notifications").select("id,title,message,action_url,read_at,created_at").order("created_at", { ascending: false }).limit(4),
    ]);
    const failure = metrics.find(item => item.error)?.error ?? latest.error;
    if (failure) setError(failure.message);
    else {
      setCounts(Object.fromEntries(metrics.map(item => [item.table, item.count])));
      setRecent(latest.data ?? []);
    }
    setLoading(false);
  })(); }, []);
  const name = identity.profile?.fullName ?? identity.profile?.username ?? "عميل بُنية";
  return <Shell title={`مرحبًا ${name}`} description="كل طلباتك وعروضك ومشاريعك محفوظة في حسابك ويمكنك البدء بإجراء جديد مباشرة." loading={loading} error={error} actions={<Link className="customer-primary-link" href="/customer/quote-request/new">طلب عرض سعر</Link>}>
    <section className="database-metrics">
      <article><span>طلبات الأسعار</span><strong>{counts.quote_requests ?? 0}</strong><small>طلباتك المسجلة</small></article>
      <article><span>العروض</span><strong>{counts.bunya_customer_quotes ?? 0}</strong><small>العروض الصادرة لك</small></article>
      <article><span>الطلبات</span><strong>{counts.orders ?? 0}</strong><small>طلبات الشراء</small></article>
      <article><span>المشاريع</span><strong>{counts.project_requests ?? 0}</strong><small>طلبات المقاولات</small></article>
    </section>
    <section className="database-panel customer-quick-panel">
      <h2>ابدأ من هنا</h2>
      <div className="customer-quick-actions">
        <Link href="/customer/quote-request/new"><b>طلب مواد بناء</b><span>أرسل المنتجات والكميات للحصول على عرض موحد.</span></Link>
        <Link href="/customer/project-requests/new"><b>طلب مشروع مقاولات</b><span>انشر نطاق المشروع واستقبل عروض المقاولين.</span></Link>
        <Link href="/customer/addresses"><b>إدارة عناوين التسليم</b><span>أضف العنوان والمستلم قبل إنشاء الطلب.</span></Link>
        <Link href="/contractors"><b>دليل المقاولين</b><span>استعرض المقاولين المعتمدين واحفظ المناسب.</span></Link>
      </div>
    </section>
    <section className="database-panel customer-list-panel"><div className="database-panel-heading"><div><h2>آخر الإشعارات</h2><p>التحديثات المرتبطة بحسابك</p></div><Link href="/customer/notifications">عرض الكل</Link></div>
      {recent.length ? <div className="customer-cards">{recent.map(item => <article key={item.id}><div><b>{item.title}</b><p>{item.message}</p><small>{date(item.created_at)}</small></div>{item.action_url ? <Link href={String(item.action_url)}>فتح</Link> : null}</article>)}</div> : <Empty text="حسابك جاهز ولا توجد إشعارات جديدة حاليًا."/>}
    </section>
  </Shell>;
}

export function CustomerProjectRequests() {
  const state = useCustomerRows(() => db.from("project_requests").select("id,request_code,title,project_type,city,region,estimated_budget_min,estimated_budget_max,proposal_deadline_at,is_open,created_at").order("created_at", { ascending: false }), "project-requests");
  return <Shell title="طلبات المشاريع" description="مشاريع المقاولات التي أنشأتها والعروض المرتبطة بها." loading={state.loading} error={state.error} actions={<Link className="customer-primary-link" href="/customer/project-requests/new">مشروع جديد</Link>}>
    {state.rows.length ? <div className="customer-cards">{state.rows.map(row => <article key={row.id}><header><div><small>{row.request_code}</small><h2>{row.title}</h2></div><Badge value={row.is_open ? "متاح" : "مغلق"}/></header><dl><div><dt>النوع</dt><dd>{row.project_type}</dd></div><div><dt>الموقع</dt><dd>{row.city}، {row.region}</dd></div><div><dt>الميزانية</dt><dd>{money(row.estimated_budget_min)} – {money(row.estimated_budget_max)}</dd></div><div><dt>آخر موعد</dt><dd>{date(row.proposal_deadline_at)}</dd></div></dl><Link className="customer-card-action" href={`/customer/project-requests/${row.id}`}>عرض المشروع والعروض</Link></article>)}</div> : <Empty text="لا توجد طلبات مشاريع بعد. أنشئ طلبًا وحدد النطاق والميزانية لاستقبال عروض المقاولين." action={<Link className="customer-primary-link" href="/customer/project-requests/new">إنشاء أول مشروع</Link>}/>} 
  </Shell>;
}

export function CustomerQuoteRequests() {
  const state = useCustomerRows(() => db.from("quote_requests").select("id,request_code,project_name,city,status,payment_status,desired_receipt_at,quote_deadline,created_at").order("created_at", { ascending: false }), "quote-requests");
  return <Shell title="طلبات عرض السعر" description="طلبات مواد البناء المرسلة وحالتها الفعلية في دورة التسعير." loading={state.loading} error={state.error} actions={<Link className="customer-primary-link" href="/customer/quote-request/new">طلب جديد</Link>}>
    {state.rows.length ? <div className="customer-cards">{state.rows.map(row => <article key={row.id}><header><div><small>{row.request_code}</small><h2>{row.project_name || `طلب ${row.request_code}`}</h2></div><Badge value={row.status}/></header><dl><div><dt>المدينة</dt><dd>{row.city}</dd></div><div><dt>حالة الدفع</dt><dd>{label(row.payment_status)}</dd></div><div><dt>موعد الاستلام</dt><dd>{date(row.desired_receipt_at)}</dd></div><div><dt>تاريخ الطلب</dt><dd>{date(row.created_at)}</dd></div></dl></article>)}</div> : <Empty text="لم ترسل طلب مواد بعد. اختر المنتجات والكميات وأرسل طلبك ليبدأ فريق بُنية بالتسعير." action={<Link className="customer-primary-link" href="/customer/quote-request/new">إنشاء طلب عرض سعر</Link>}/>} 
  </Shell>;
}

export function CustomerQuotes() {
  const state = useCustomerRows(() => db.from("bunya_customer_quotes").select("id,quote_code,subtotal,vat_amount,delivery_fee,total,status,processing_stage,valid_until,expected_delivery_at,created_at").order("created_at", { ascending: false }), "quotes");
  return <Shell title="عروض بُنية" description="العروض الموحدة الصادرة لك؛ افتح العرض الجاهز لقبوله أو رفضه." loading={state.loading} error={state.error}>
    {state.rows.length ? <div className="customer-cards">{state.rows.map(row => <article key={row.id}><header><div><small>{row.quote_code}</small><h2>{money(row.total)}</h2></div><Badge value={row.status}/></header><dl><div><dt>المجموع</dt><dd>{money(row.subtotal)}</dd></div><div><dt>الضريبة والتوصيل</dt><dd>{money(Number(row.vat_amount) + Number(row.delivery_fee))}</dd></div><div><dt>صلاحية العرض</dt><dd>{date(row.valid_until)}</dd></div><div><dt>التوصيل المتوقع</dt><dd>{date(row.expected_delivery_at)}</dd></div></dl><Link className="customer-card-action" href={`/customer/quotes/${row.id}`}>فتح العرض واتخاذ القرار</Link></article>)}</div> : <Empty text="لا توجد عروض صادرة بعد. بعد إرسال طلب مواد واكتمال التسعير سيظهر العرض هنا." action={<Link className="customer-primary-link" href="/customer/quote-request/new">إرسال طلب مواد</Link>}/>} 
  </Shell>;
}

export function CustomerOrders() {
  const state = useCustomerRows(() => db.from("orders").select("id,order_code,status,payment_status,subtotal,vat_amount,delivery_fee,total,desired_receipt_at,created_at").order("created_at", { ascending: false }), "orders");
  return <Shell title="الطلبات" description="طلبات الشراء المؤكدة وحالتها المالية والتشغيلية." loading={state.loading} error={state.error}>
    {state.rows.length ? <div className="customer-cards">{state.rows.map(row => <article key={row.id}><header><div><small>{row.order_code}</small><h2>{money(row.total)}</h2></div><Badge value={row.status}/></header><dl><div><dt>الدفع</dt><dd>{label(row.payment_status)}</dd></div><div><dt>الموعد المطلوب</dt><dd>{date(row.desired_receipt_at)}</dd></div><div><dt>الضريبة</dt><dd>{money(row.vat_amount)}</dd></div><div><dt>التوصيل</dt><dd>{money(row.delivery_fee)}</dd></div></dl><Link className="customer-card-action" href={`/customer/orders/${row.id}`}>عرض تفاصيل الطلب</Link></article>)}</div> : <Empty text="لا توجد طلبات شراء بعد. قبول عرض بُنية ينشئ طلبًا حقيقيًا ويظهره هنا." action={<Link className="customer-primary-link" href="/customer/quotes">مراجعة العروض</Link>}/>} 
  </Shell>;
}

export function CustomerDeliveries() {
  const state = useCustomerRows(() => db.rpc("get_customer_deliveries"), "deliveries");
  return <Shell title="التوصيلات" description="تتبع التوصيلات المرتبطة بطلباتك واسم السائق وآخر تحديث." loading={state.loading} error={state.error}>
    {state.rows.length ? <div className="customer-cards">{state.rows.map(row => <article key={row.delivery_id}><header><div><small>{row.order_code}</small><h2>توصيل الطلب</h2></div><Badge value={row.latest_status || row.delivery_status}/></header><dl><div><dt>السائق</dt><dd>{row.driver_name || "لم يُسند بعد"}</dd></div><div><dt>الموعد المتوقع</dt><dd>{date(row.expected_at)}</dd></div><div><dt>آخر تحديث</dt><dd>{date(row.latest_update_at)}</dd></div><div><dt>تم التسليم</dt><dd>{date(row.delivered_at)}</dd></div></dl></article>)}</div> : <Empty text="لا توجد توصيلات نشطة. تظهر هنا بعد تجهيز طلب مدفوع وإسناده للتوصيل." action={<Link className="customer-primary-link" href="/customer/orders">عرض الطلبات</Link>}/>} 
  </Shell>;
}

export function CustomerBilling() {
  const state = useCustomerRows(() => db.from("invoices").select("id,invoice_code,order_id,subtotal,vat_amount,delivery_fee,total,status,issued_at,paid_at").order("issued_at", { ascending: false }), "billing");
  return <Shell title="الفواتير" description="الفواتير الصادرة لحسابك وقيمتها وحالة سدادها." loading={state.loading} error={state.error}>
    {state.rows.length ? <div className="customer-cards">{state.rows.map(row => <article key={row.id}><header><div><small>{row.invoice_code}</small><h2>{money(row.total)}</h2></div><Badge value={row.status}/></header><dl><div><dt>المجموع</dt><dd>{money(row.subtotal)}</dd></div><div><dt>الضريبة</dt><dd>{money(row.vat_amount)}</dd></div><div><dt>تاريخ الإصدار</dt><dd>{date(row.issued_at)}</dd></div><div><dt>تاريخ السداد</dt><dd>{date(row.paid_at)}</dd></div></dl><Link className="customer-card-action" href={`/customer/orders/${row.order_id}`}>فتح الطلب المرتبط</Link></article>)}</div> : <Empty text="لا توجد فواتير حتى الآن. تصدر الفاتورة عند إنشاء طلب شراء فعلي."/>}
  </Shell>;
}

export function CustomerSavedContractors() {
  const identity = useAuthIdentity();
  const state = useCustomerRows(() => db.from("saved_contractors").select("contractor_profile_id,contact_requested_at,saved_at,contractor_profiles(id,display_name,commercial_name,city,badge,average_rating,availability)").eq("customer_profile_id", identity.userId).order("saved_at", { ascending: false }), `contractors:${identity.userId}`);
  const remove = async (id: string) => {
    const result = await db.from("saved_contractors").delete().eq("customer_profile_id", identity.userId).eq("contractor_profile_id", id);
    if (result.error) state.setError(result.error.message); else await state.load();
  };
  return <Shell title="المقاولون المحفوظون" description="القائمة التي حفظتها من دليل المقاولين ويمكنك إدارتها من هنا." loading={state.loading} error={state.error} actions={<Link className="customer-primary-link" href="/contractors">استعراض الدليل</Link>}>
    {state.rows.length ? <div className="customer-cards">{state.rows.map(row => { const related = row.contractor_profiles; const contractor = (Array.isArray(related) ? related[0] : related) ?? {}; return <article key={row.contractor_profile_id}><header><div><small>{contractor.badge || "مقاول معتمد"}</small><h2>{contractor.display_name || contractor.commercial_name || "مقاول"}</h2></div><Badge value={contractor.availability}/></header><dl><div><dt>المدينة</dt><dd>{contractor.city || "—"}</dd></div><div><dt>التقييم</dt><dd>{Number(contractor.average_rating || 0).toLocaleString("ar-SA")} / 5</dd></div><div><dt>تاريخ الحفظ</dt><dd>{date(row.saved_at)}</dd></div><div><dt>طلب التواصل</dt><dd>{date(row.contact_requested_at)}</dd></div></dl><div className="customer-card-buttons"><Link className="customer-card-action" href="/contractors">عرض الدليل</Link><button className="customer-secondary-button" onClick={() => void remove(row.contractor_profile_id)}>إزالة من المحفوظات</button></div></article>; })}</div> : <Empty text="لم تحفظ مقاولين بعد. استعرض الدليل واحفظ المقاولين المناسبين لمشاريعك." action={<Link className="customer-primary-link" href="/contractors">فتح دليل المقاولين</Link>}/>} 
  </Shell>;
}

export function CustomerAddresses() {
  const identity = useAuthIdentity();
  const state = useCustomerRows(() => db.from("customer_addresses").select("*").eq("customer_profile_id", identity.userId).order("is_default", { ascending: false }).order("created_at", { ascending: false }), `addresses:${identity.userId}`);
  const [form, setForm] = useState<AddressForm>(emptyAddress);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const edit = (row: Row) => setForm({ id: row.id, label: row.label, projectName: row.project_name, googleMapsUrl: row.google_maps_url, city: row.city, region: row.region, description: row.description ?? "", recipientName: row.recipient_name, recipientMobile: row.recipient_mobile, isDefault: row.is_default });
  const save = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setMessage(""); state.setError("");
    const result = await db.rpc("save_customer_address", { p_id: form.id || null, p_label: form.label, p_project_name: form.projectName, p_google_maps_url: form.googleMapsUrl, p_city: form.city, p_region: form.region, p_description: form.description || null, p_recipient_name: form.recipientName, p_recipient_mobile: form.recipientMobile, p_is_default: form.isDefault });
    if (result.error) state.setError(result.error.message); else { setForm(emptyAddress); setMessage(form.id ? "تم تحديث العنوان." : "تم حفظ العنوان."); await state.load(); }
    setBusy(false);
  };
  const remove = async (id: string) => {
    if (!window.confirm("هل تريد حذف هذا العنوان؟")) return;
    const result = await db.rpc("delete_customer_address", { p_id: id });
    if (result.error) state.setError(result.error.message); else { if (form.id === id) setForm(emptyAddress); setMessage("تم حذف العنوان."); await state.load(); }
  };
  return <Shell title="عناوين التسليم" description="أضف العنوان الصحيح وعدّله في أي وقت قبل استخدامه في طلب جديد." loading={state.loading} error={state.error} message={message}>
    <section className="database-panel database-editor"><h2>{form.id ? "تعديل العنوان" : "إضافة عنوان"}</h2><form className="database-form-grid" onSubmit={save}>
      <label><span>اسم العنوان</span><input required value={form.label} onChange={e => setForm({ ...form, label: e.target.value })} placeholder="المنزل أو موقع المشروع"/></label>
      <label><span>اسم المشروع</span><input required value={form.projectName} onChange={e => setForm({ ...form, projectName: e.target.value })}/></label>
      <label><span>المدينة</span><input required value={form.city} onChange={e => setForm({ ...form, city: e.target.value })}/></label>
      <label><span>المنطقة</span><input required value={form.region} onChange={e => setForm({ ...form, region: e.target.value })}/></label>
      <label><span>اسم المستلم</span><input required value={form.recipientName} onChange={e => setForm({ ...form, recipientName: e.target.value })}/></label>
      <label><span>جوال المستلم</span><input required dir="ltr" inputMode="tel" value={form.recipientMobile} onChange={e => setForm({ ...form, recipientMobile: e.target.value })} placeholder="05xxxxxxxx"/></label>
      <label className="wide"><span>رابط خرائط Google</span><input required dir="ltr" type="url" value={form.googleMapsUrl} onChange={e => setForm({ ...form, googleMapsUrl: e.target.value })}/></label>
      <label className="wide"><span>وصف الموقع</span><textarea rows={3} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}/></label>
      <label className="customer-checkbox wide"><input type="checkbox" checked={form.isDefault} onChange={e => setForm({ ...form, isDefault: e.target.checked })}/> اجعله العنوان الافتراضي</label>
      <footer className="wide"><button disabled={busy}>{busy ? "جارٍ الحفظ..." : form.id ? "حفظ التعديلات" : "إضافة العنوان"}</button>{form.id ? <button className="customer-secondary-button" type="button" onClick={() => setForm(emptyAddress)}>إلغاء التعديل</button> : null}</footer>
    </form></section>
    {state.rows.length ? <div className="customer-cards">{state.rows.map(row => <article key={row.id}><header><div><small>{row.project_name}</small><h2>{row.label}</h2></div>{row.is_default ? <Badge value="افتراضي"/> : null}</header><dl><div><dt>الموقع</dt><dd>{row.city}، {row.region}</dd></div><div><dt>المستلم</dt><dd>{row.recipient_name}</dd></div><div><dt>الجوال</dt><dd dir="ltr">{row.recipient_mobile}</dd></div><div><dt>الوصف</dt><dd>{row.description || "—"}</dd></div></dl><div className="customer-card-buttons"><a className="customer-card-action" href={row.google_maps_url} target="_blank" rel="noreferrer">فتح الخريطة</a><button className="customer-secondary-button" onClick={() => edit(row)}>تعديل</button><button className="customer-danger-button" onClick={() => void remove(row.id)}>حذف</button></div></article>)}</div> : <Empty text="لا توجد عناوين محفوظة. استخدم النموذج أعلاه لإضافة أول عنوان."/>}
  </Shell>;
}

export function CustomerProfile() {
  const identity = useAuthIdentity();
  const [form, setForm] = useState({ fullName: "", username: "" });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => { void (async () => {
    const result = await db.from("profiles").select("full_name,username").eq("id", identity.userId).single();
    if (result.error) setError(result.error.message); else setForm({ fullName: result.data.full_name ?? "", username: result.data.username ?? "" });
    setLoading(false);
  })(); }, [identity.userId]);
  const save = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    const result = await db.from("profiles").update({ full_name: form.fullName.trim() || null, username: form.username.trim() || null }).eq("id", identity.userId);
    if (result.error) setError(result.error.message); else setMessage("تم حفظ بيانات الملف الشخصي.");
    setBusy(false);
  };
  return <Shell title="الملف الشخصي" description="حدّث الاسم الظاهر واسم المستخدم. الجوال الموثق والبريد يعرضان للمرجعية ولا يتغيران من هنا." loading={loading} error={error} message={message}>
    <section className="database-panel database-editor"><form className="database-form-grid" onSubmit={save}>
      <label><span>الاسم الكامل</span><input required minLength={2} value={form.fullName} onChange={e => setForm({ ...form, fullName: e.target.value })}/></label>
      <label><span>اسم المستخدم</span><input required minLength={4} maxLength={40} value={form.username} onChange={e => setForm({ ...form, username: e.target.value })}/></label>
      <label><span>الجوال الموثق</span><input readOnly dir="ltr" value={identity.profile?.mobile ?? "غير مسجل"}/><small>لتغيير الجوال يلزم مسار تحقق جديد حفاظًا على الحساب.</small></label>
      <label><span>البريد الإلكتروني</span><input readOnly dir="ltr" value={identity.profile?.email ?? identity.authEmail ?? "غير مسجل"}/></label>
      <footer className="wide"><button disabled={busy}>{busy ? "جارٍ الحفظ..." : "حفظ الملف الشخصي"}</button></footer>
    </form></section>
  </Shell>;
}
