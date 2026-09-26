/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/set-state-in-effect */
"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { useAuthIdentity } from "@/components/auth/AuthIdentityProvider";
import { createClient } from "@/lib/supabase/client";
import {
  LiveDeadline,
  PricingWindow,
  useLiveNow,
} from "@/components/commerce/LiveDeadline";
import { useLocale } from "@/components/i18n/LocaleProvider";
import { intlLocale } from "@/lib/i18n/config";
import { localizedSnapshot } from "@/lib/i18n/content";
import { copy as paymentCopy } from "@/components/payments/PaymobCheckout";
import { CustomerProductImage } from "@/components/customer/CustomerProductImage";
import styles from "./CustomerWorkspace.module.css";
import { customerMapUrl } from "@/lib/customer/presentation";

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
  verifying: "جارٍ التحقق من التوفر",
  quote_ready: "عرض السعر جاهز",
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
  completed: "مكتمل",
  processing: "قيد المعالجة",
  assigned: "تم إسناد السائق",
  arrived: "وصل إلى الموقع",
  out_for_delivery: "خرج للتوصيل",
  succeeded: "تم السداد",
  refunded: "مسترد",
  partially_paid: "مدفوع جزئيًا",
  issued: "صادرة",
  overdue: "متأخرة السداد",
  busy: "مشغول حاليًا",
  unavailable: "غير متاح",
  temporarily_unavailable: "غير متاح مؤقتًا",
  failed: "لم تكتمل العملية",
  pending_admin_review: "بانتظار المراجعة",
  needs_customer_changes: "بانتظار تعديلك",
  published: "منشور",
  receiving_proposals: "استقبال العروض",
  under_customer_review: "بانتظار قرارك",
  awarded: "تم اختيار المقاول",
  in_progress: "قيد التنفيذ",
};

const label = (value: unknown) =>
  statusLabels[String(value ?? "")] ??
  (value ? "الحالة غير متاحة" : "غير محددة");
const date = (value: unknown) =>
  value ? new Date(String(value)).toLocaleString("ar-SA-u-ca-gregory", { timeZone: "Asia/Riyadh", dateStyle: "medium", timeStyle: "short" }) : "—";
const money = (value: unknown) =>
  value == null ? "غير محدد" : `${Number(value).toLocaleString("ar-SA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ر.س`;

function RecordList({ rows, title, searchKeys, statusKey = "status", children }: {
  rows: Row[];
  title: string;
  searchKeys: string[];
  statusKey?: string;
  children: (rows: Row[]) => ReactNode;
}) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const states = [...new Set(rows.map((row) => String(row[statusKey] ?? "")).filter(Boolean))];
  const filtered = rows.filter((row) => {
    const products = row.quote_request_items ?? row.bunya_customer_quote_items ?? row.order_items ?? [];
    const values = [...searchKeys.map((key) => row[key]), ...products.map((item: Row) => item.product_name_snapshot)];
    return (!status || String(row[statusKey]) === status) && (!search.trim() || values.some((value) => String(value ?? "").toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())));
  });
  const pageCount = Math.max(1, Math.ceil(filtered.length / 8));
  const currentPage = Math.min(page, pageCount);
  const visible = filtered.slice((currentPage - 1) * 8, currentPage * 8);
  return (
    <section className={styles.records} aria-label={title}>
      <div className={styles.listHeading}>
        <div><p>سجل حسابك</p><h2>{title} <span>{rows.length.toLocaleString("ar-SA")}</span></h2></div>
        <span className={styles.listHint}>تفاصيل واضحة لكل خطوة</span>
      </div>
      <div className={styles.toolbar}>
        <label><span>البحث في {title}</span><input type="search" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="اكتب الاسم أو الرقم…" /></label>
        {states.length > 1 ? <label><span>الحالة</span><select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="">كل الحالات</option>{states.map((value) => <option key={value} value={value}>{label(value)}</option>)}</select></label> : null}
        <span className={styles.resultCount} role="status">{filtered.length.toLocaleString("ar-SA")} من {rows.length.toLocaleString("ar-SA")}</span>
      </div>
      {filtered.length ? children(visible) : <Empty text="لم نعثر على نتائج تطابق بحثك. جرّب اسمًا أو رقمًا آخر أو أعد عرض السجل كاملًا." action={<button type="button" className="customer-secondary-button" onClick={() => { setSearch(""); setStatus(""); setPage(1); }}>مسح البحث والفلاتر</button>} />}
      {pageCount > 1 ? <nav className={styles.pagination} aria-label={`صفحات ${title}`}><button type="button" className="customer-secondary-button" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>السابق</button><span role="status">صفحة {currentPage.toLocaleString("ar-SA")} من {pageCount.toLocaleString("ar-SA")}</span><button type="button" className="customer-secondary-button" disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}>التالي</button></nav> : null}
    </section>
  );
}

function ProductPreview({ items }: { items?: Row[] | null }) {
  const { locale } = useLocale();
  if (!items?.length) return null;
  return <div className={styles.productPreview}>
    {items.slice(0, 3).map((item) => {
      const name = localizedSnapshot(item.product_name_snapshot, item.product_name_translations, locale);
      return <div key={item.id} className={styles.previewItem}>
        <CustomerProductImage productId={item.product_id} name={name} variant="line" />
        <div><b>{name}</b><span>{Number(item.quantity).toLocaleString(intlLocale(locale))} {item.unit_name_snapshot || item.unit_snapshot}</span></div>
      </div>;
    })}
    {items.length > 3 ? <small>و{(items.length - 3).toLocaleString("ar-SA")} منتجات أخرى داخل التفاصيل</small> : null}
  </div>;
}

function Summary({ entries }: { entries: { label: string; value: ReactNode; detail?: string }[] }) {
  return <section className={styles.summary} aria-label="ملخص السجل">{entries.map((entry) => <article key={entry.label}><span>{entry.label}</span><strong>{entry.value}</strong>{entry.detail ? <small>{entry.detail}</small> : null}</article>)}</section>;
}

function Shell({
  title,
  description,
  actions,
  error,
  message,
  loading,
  onRetry,
  children,
}: {
  title: string;
  description: string;
  actions?: ReactNode;
  error?: string;
  message?: string;
  loading?: boolean;
  onRetry?: () => void;
  children: ReactNode;
}) {
  return (
    <main className={`database-page customer-workspace-page ${styles.workspace}`} aria-busy={loading || undefined}>
      <header className="database-page-header">
        <div>
          <p>بُنية / مساحة العميل</p>
          <h1>{title}</h1>
          <span>{description}</span>
        </div>
        {actions ? (
          <aside className="customer-header-actions">{actions}</aside>
        ) : null}
      </header>
      {error ? (
        <div className="database-state database-error customer-inline-state" role="alert">
          <span>!</span>
          <p>{error}</p>
          {onRetry ? <button type="button" className="customer-secondary-button" disabled={loading} onClick={onRetry}>إعادة المحاولة</button> : null}
        </div>
      ) : null}
      {message ? (
        <div className="customer-success-message" role="status">{message}</div>
      ) : null}
      {loading ? (
        <div className={styles.loading} role="status">
          <span className="database-spinner" aria-hidden="true" />
          <h2>جارٍ تحميل بياناتك…</h2>
          <p>نجهّز آخر تحديثات حسابك.</p>
          <div className={styles.loadingRows} aria-hidden="true"><i /><i /><i /></div>
        </div>
      ) : (
        children
      )}
    </main>
  );
}

function Empty({ text, action }: { text: string; action?: ReactNode }) {
  return (
    <div className="database-state customer-empty">
      <svg viewBox="0 0 48 48" fill="none" aria-hidden="true"><path d="M9 15 24 7l15 8v19l-15 8-15-8V15Z M9 15l15 8 15-8 M24 23v19 M17 11l15 8" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /></svg>
      <p>{text}</p>
      {action}
    </div>
  );
}

function Badge({ value }: { value: unknown }) {
  const status = String(value ?? "");
  const tone = ["paid", "succeeded", "accepted", "completed", "delivered", "available", "افتراضي"].includes(status) ? "positive" : ["rejected", "expired", "cancelled", "overdue"].includes(status) ? "muted" : "pending";
  return <span className={`database-status ${styles.badge}`} data-tone={tone}>{label(value)}</span>;
}

function useCustomerRows(
  loader: () => PromiseLike<{ data: any; error: { message: string } | null }>,
  key: string,
) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await loader();
      setRows((result.data ?? []) as Row[]);
      setError(result.error?.message ?? "");
    } catch {
      setError("تعذر تحميل البيانات. تحقق من الاتصال ثم أعد تحميل الصفحة.");
    } finally {
      setLoading(false);
    }
    // The key explicitly identifies the stable query; the inline loader must not retrigger it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => {
    void load();
  }, [load]);
  return { rows, loading, error, setError, load };
}

export function CustomerDashboard() {
  const identity = useAuthIdentity();
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [recent, setRecent] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    void (async () => {
      const tables = [
        "quote_requests",
        "bunya_customer_quotes",
        "orders",
        "project_requests",
      ];
      const [metrics, latest] = await Promise.all([
        Promise.all(
          tables.map(async (table) => {
            const result = await db
              .from(table)
              .select("*", { count: "exact", head: true });
            return { table, count: result.count ?? 0, error: result.error };
          }),
        ),
        db
          .from("customer_notifications")
          .select("id,title,message,action_url,read_at,created_at")
          .order("created_at", { ascending: false })
          .limit(4),
      ]);
      const failure = metrics.find((item) => item.error)?.error ?? latest.error;
      if (failure) setError(failure.message);
      else {
        setCounts(
          Object.fromEntries(metrics.map((item) => [item.table, item.count])),
        );
        setRecent(latest.data ?? []);
      }
      setLoading(false);
    })();
  }, []);
  const name =
    identity.profile?.fullName ?? identity.profile?.username ?? "عميل بُنية";
  return (
    <Shell
      title={`مرحبًا ${name}`}
      description="من أول طلب مواد إلى اكتمال مشروعك؛ هذه نقطة البداية لمتابعة أعمالك مع بُنية."
      loading={loading}
      error={error}
      actions={
        <Link
          className="customer-primary-link"
          href="/customer/quote-request/new"
        >
          طلب عرض سعر
        </Link>
      }
    >
      <section className={`database-metrics ${styles.dashboardMetrics}`} aria-label="نظرة على حسابك">
        <article>
          <span>طلبات الأسعار</span>
          <strong>{counts.quote_requests ?? 0}</strong>
          <Link href="/customer/quote-requests">متابعة التسعير ←</Link>
        </article>
        <article>
          <span>العروض</span>
          <strong>{counts.bunya_customer_quotes ?? 0}</strong>
          <Link href="/customer/quotes">مراجعة العروض ←</Link>
        </article>
        <article>
          <span>الطلبات</span>
          <strong>{counts.orders ?? 0}</strong>
          <Link href="/customer/orders">متابعة الطلبات ←</Link>
        </article>
        <article>
          <span>المشاريع</span>
          <strong>{counts.project_requests ?? 0}</strong>
          <Link href="/customer/project-requests">عرض المشاريع ←</Link>
        </article>
      </section>
      <section className="database-panel customer-quick-panel">
        <div className={styles.sectionIntro}><span>خطوتك القادمة</span><h2>ماذا يحتاج مشروعك اليوم؟</h2><p>جهّز المواد، ابحث عن مقاول، ورتّب وصول الطلب إلى موقعك.</p></div>
        <div className="customer-quick-actions">
          <Link href="/customer/quote-request/new">
            <b>طلب مواد بناء</b>
            <span>أرسل المنتجات والكميات للحصول على عرض موحد.</span>
          </Link>
          <Link href="/customer/project-requests/new">
            <b>طلب مشروع مقاولات</b>
            <span>انشر نطاق المشروع واستقبل عروض المقاولين.</span>
          </Link>
          <Link href="/customer/addresses">
            <b>إدارة عناوين التسليم</b>
            <span>أضف العنوان والمستلم قبل إنشاء الطلب.</span>
          </Link>
          <Link href="/contractors">
            <b>دليل المقاولين</b>
            <span>استعرض المقاولين المعتمدين واحفظ المناسب.</span>
          </Link>
        </div>
      </section>
      <section className="database-panel customer-list-panel">
        <div className="database-panel-heading">
          <div>
            <h2>آخر الإشعارات</h2>
            <p>التحديثات المرتبطة بحسابك</p>
          </div>
          <Link href="/customer/notifications">عرض الكل</Link>
        </div>
        {recent.length ? (
          <div className="customer-cards">
            {recent.map((item) => (
              <article key={item.id}>
                <div>
                  <b>{item.title}</b>
                  <p>{item.message}</p>
                  <small>{date(item.created_at)}</small>
                </div>
                {typeof item.action_url === "string" && item.action_url.startsWith("/") && !item.action_url.startsWith("//") && !item.action_url.includes("\\") ? (
                  <Link href={item.action_url}>عرض التحديث</Link>
                ) : null}
              </article>
            ))}
          </div>
        ) : (
          <Empty text="حسابك جاهز ولا توجد إشعارات جديدة حاليًا." />
        )}
      </section>
    </Shell>
  );
}

export function CustomerProjectRequests() {
  const state = useCustomerRows(
    () =>
      db
        .from("project_requests")
        .select(
          "id,request_code,title,project_type,city,region,estimated_budget_min,estimated_budget_max,proposal_deadline_at,is_open,created_at",
        )
        .order("created_at", { ascending: false }),
    "project-requests",
  );
  return (
    <Shell
      title="طلبات المشاريع"
      description="مشاريع المقاولات التي أنشأتها والعروض المرتبطة بها."
      loading={state.loading}
      error={state.error}
      onRetry={() => void state.load()}
      actions={
        <Link
          className="customer-primary-link"
          href="/customer/project-requests/new"
        >
          مشروع جديد
        </Link>
      }
    >
      <Summary entries={[{ label: "مشاريعك", value: state.rows.length }, { label: "تستقبل العروض", value: state.rows.filter((row) => row.is_open).length }, { label: "مغلقة", value: state.rows.filter((row) => !row.is_open).length }]} />
      {state.rows.length ? (
        <RecordList rows={state.rows.map((row) => ({ ...row, projectStatus: row.is_open ? "متاح" : "مغلق" }))} title="طلبات المشاريع" searchKeys={["request_code", "title", "project_type", "city", "region"]} statusKey="projectStatus">{(rows) => <div className="customer-cards">
          {rows.map((row) => (
            <article key={row.id}>
              <header>
                <div>
                  <small>{row.request_code}</small>
                  <h2>{row.title}</h2>
                </div>
                <Badge value={row.is_open ? "متاح" : "مغلق"} />
              </header>
              <dl>
                <div>
                  <dt>النوع</dt>
                  <dd>{row.project_type || "غير محدد"}</dd>
                </div>
                <div>
                  <dt>الموقع</dt>
                  <dd>
                    {[row.city, row.region].filter(Boolean).join("، ") || "غير محدد"}
                  </dd>
                </div>
                <div>
                  <dt>الميزانية</dt>
                  <dd>
                    {money(row.estimated_budget_min)} –{" "}
                    {money(row.estimated_budget_max)}
                  </dd>
                </div>
                <div>
                  <dt>آخر موعد</dt>
                  <dd>{date(row.proposal_deadline_at)}</dd>
                </div>
              </dl>
              <Link
                className="customer-card-action"
                href={`/customer/project-requests/${row.id}`}
              >
                عرض المشروع والعروض
              </Link>
            </article>
          ))}
        </div>}</RecordList>
      ) : (
        <Empty
          text="لا توجد طلبات مشاريع بعد. أنشئ طلبًا وحدد النطاق والميزانية لاستقبال عروض المقاولين."
          action={
            <Link
              className="customer-primary-link"
              href="/customer/project-requests/new"
            >
              إنشاء أول مشروع
            </Link>
          }
        />
      )}
    </Shell>
  );
}

export function CustomerQuoteRequests() {
  const state = useCustomerRows(
    () =>
      db
        .from("quote_requests")
        .select(
          "id,request_code,project_name,google_maps_url,status,payment_status,desired_receipt_at,quote_deadline,pricing_opens_at,pricing_countdown_starts_at,created_at,quote_request_items(id,product_id,product_name_snapshot,quantity,unit_name_snapshot)",
        )
        .order("created_at", { ascending: false }),
    "quote-requests",
  );
  return (
    <Shell
      title="طلبات عرض السعر"
      description="طلبات مواد البناء المرسلة وحالتها الفعلية في دورة التسعير."
      loading={state.loading}
      error={state.error}
      onRetry={() => void state.load()}
      actions={
        <Link
          className="customer-primary-link"
          href="/customer/quote-request/new"
        >
          طلب جديد
        </Link>
      }
    >
      <Summary entries={[{ label: "طلبات المواد", value: state.rows.length }, { label: "قيد التسعير", value: state.rows.filter((row) => ["submitted", "sourcing", "verifying"].includes(row.status)).length }, { label: "جاهزة للمراجعة", value: state.rows.filter((row) => ["quote_ready", "customer_review", "quoted"].includes(row.status)).length }]} />
      <details className={styles.explainer}><summary>متى يصلني عرض السعر؟</summary><p>تستمر منافسة المزودين 3 ساعات. الطلب بين 8 ص و4 م يبدأ فورًا؛ والطلب خارج هذه الفترة يُفتح للمعاينة من 6 ص ويبدأ عداده 8 ص بتوقيت الرياض.</p></details>
      {state.rows.length ? (
        <RecordList rows={state.rows} title="طلبات عرض السعر" searchKeys={["request_code", "project_name"]}>{(rows) => <div className="customer-cards">
          {rows.map((row) => (
            <article key={row.id}>
              <header>
                <div>
                  <small>{row.request_code}</small>
                  <h2>{row.project_name || `طلب ${row.request_code}`}</h2>
                </div>
                <Badge value={row.status} />
              </header>
              <ProductPreview items={row.quote_request_items} />
              <dl>
                <div>
                  <dt>الموقع</dt>
                  <dd>
                    {row.google_maps_url
                      ? "رابط Google Maps معتمد"
                      : "غير مكتمل"}
                  </dd>
                </div>
                <div>
                  <dt>حالة الدفع</dt>
                  <dd>{label(row.payment_status)}</dd>
                </div>
                <div>
                  <dt>موعد الاستلام</dt>
                  <dd>{date(row.desired_receipt_at)}</dd>
                </div>
                <div>
                  <dt>تاريخ الطلب</dt>
                  <dd>{date(row.created_at)}</dd>
                </div>
              </dl>
              {row.pricing_opens_at &&
              row.pricing_countdown_starts_at &&
              ["submitted", "sourcing", "verifying"].includes(
                String(row.status),
              ) ? (
                <PricingWindow
                  opensAt={row.pricing_opens_at}
                  startsAt={row.pricing_countdown_starts_at}
                  deadlineAt={row.quote_deadline}
                  compact
                />
              ) : null}
              <Link
                className="customer-card-action"
                href={`/customer/quote-requests/${row.id}`}
              >
                عرض تفاصيل الطلب
              </Link>
            </article>
          ))}
        </div>}</RecordList>
      ) : (
        <Empty
          text="لم ترسل طلب مواد بعد. اختر المنتجات والكميات وأرسل طلبك ليبدأ فريق بُنية بالتسعير."
          action={
            <Link
              className="customer-primary-link"
              href="/customer/quote-request/new"
            >
              إنشاء طلب عرض سعر
            </Link>
          }
        />
      )}
    </Shell>
  );
}

const quoteStatusHelp: Record<string, string> = {
  draft: "الطلب محفوظ كمسودة ولم يُرسل بعد.",
  submitted: "استلمنا طلبك وسيبدأ فريق بُنية مراجعته.",
  sourcing: "يجري جمع الأسعار والتحقق من المنتجات المطلوبة.",
  verifying: "يتحقق فريق بُنية من التوفر وموعد التسليم قبل إصدار العرض.",
  quote_ready: "اكتمل عرض السعر ويمكنك مراجعته واتخاذ القرار.",
  customer_review: "عرض السعر بانتظار مراجعتك وقرارك.",
  accepted: "تم اعتماد العرض وتحويله إلى طلب شراء.",
  rejected: "لم يتم اعتماد هذا الطلب.",
  expired: "انتهت مهلة هذا الطلب.",
  cancelled: "تم إلغاء هذا الطلب.",
};

export function CustomerQuoteRequestDetail({ id }: { id: string }) {
  const { locale } = useLocale();
  const [request, setRequest] = useState<Row | null>(null);
  const [items, setItems] = useState<Row[]>([]);
  const [quote, setQuote] = useState<Row | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    void (async () => {
      const [requestResult, itemsResult, quoteResult] = await Promise.all([
        db
          .from("quote_requests")
          .select(
            "id,request_code,project_name,location_hint,google_maps_url,desired_receipt_at,quote_window_label,quote_deadline,pricing_opens_at,pricing_countdown_starts_at,payment_status,delivery_promise,notes,status,created_at,updated_at,delivery_mode,recipient_name,recipient_mobile,site_responsible_name,site_responsible_mobile,contractor_name,contractor_mobile,working_hours,loading_option,unloading_option,road_access,access_instructions,driver_departure_liability_accepted,data_accuracy_accepted,delivery_details_acknowledged_at",
          )
          .eq("id", id)
          .maybeSingle(),
        db
          .from("quote_request_items")
          .select(
            "id,product_id,product_name_snapshot,product_name_translations,measurement_label_snapshot,measurement_label_translations,variant_label_snapshot,variant_selections,unit_name_snapshot,unit_name_translations,quantity,notes,created_at",
          )
          .eq("request_id", id)
          .order("created_at", { ascending: true }),
        db
          .from("bunya_customer_quotes")
          .select("id,quote_code,total,status,valid_until")
          .eq("customer_request_id", id)
          .maybeSingle(),
      ]);
      const failure =
        requestResult.error ?? itemsResult.error ?? quoteResult.error;
      if (failure) setError(failure.message);
      else {
        setRequest(requestResult.data);
        setItems(itemsResult.data ?? []);
        setQuote(quoteResult.data);
      }
      setLoading(false);
    })();
  }, [id]);

  if (loading)
    return (
      <Shell
        title="تفاصيل طلب عرض السعر"
        description="جارٍ تجهيز بيانات طلبك…"
        loading
      >
        <div />
      </Shell>
    );
  if (error || !request)
    return (
      <Shell
        title="تفاصيل طلب عرض السعر"
        description="تعذر فتح الطلب."
        error={error || "الطلب غير موجود أو لا تملك صلاحية عرضه."}
      >
        <div />
      </Shell>
    );

  const status = String(request.status);
  const currentStep = ["draft", "submitted"].includes(status)
    ? 0
    : ["sourcing", "verifying", "rejected", "expired", "cancelled"].includes(
          status,
        )
      ? 1
      : status === "quote_ready"
        ? 2
        : 3;
  const steps = [
    status === "draft" ? "تحضير الطلب" : "تم إرسال الطلب",
    "التحقق والتسعير",
    "تجهيز عرض السعر",
    "مراجعة العميل",
  ];

  return (
    <Shell
      title={request.project_name || "طلب عرض سعر"}
      description={`رقم الطلب: ${request.request_code}`}
      actions={
        <Link
          className="customer-primary-link customer-back-link"
          href="/customer/quote-requests"
        >
          العودة إلى الطلبات
        </Link>
      }
    >
      <section className="customer-rfq-status">
        <div>
          <small>حالة الطلب الآن</small>
          <h2>{label(request.status)}</h2>
          <p>
            {quoteStatusHelp[status] ??
              "يمكنك متابعة آخر تحديثات الطلب من هذه الصفحة."}
          </p>
        </div>
        <Badge value={request.status} />
      </section>

      {!["rejected", "expired", "cancelled"].includes(status) ? <ol className="customer-rfq-steps">
        {steps.map((step, index) => (
          <li
            key={step}
            aria-current={index === currentStep ? "step" : undefined}
            className={
              index < currentStep
                ? "done"
                : index === currentStep
                  ? "current"
                  : ""
            }
          >
            <span>{index < currentStep ? "✓" : index + 1}</span>
            <b>{step}</b>
          </li>
        ))}
      </ol> : null}

      <div className="customer-rfq-layout">
        <section className="database-panel customer-rfq-products">
          <header>
            <div>
              <small>محتوى الطلب</small>
              <h2>المنتجات المطلوبة</h2>
            </div>
            <strong>
              {items.length} {items.length === 1 ? "منتج" : "منتجات"}
            </strong>
          </header>
          <div className="customer-rfq-items">
            {items.map((item) => (
              <article key={item.id}>
                <CustomerProductImage productId={item.product_id} name={localizedSnapshot(item.product_name_snapshot, item.product_name_translations, locale)} variant="line" />
                <div className={styles.itemCopy}>
                  <h3>{localizedSnapshot(item.product_name_snapshot, item.product_name_translations, locale)}</h3>
                  <p>
                    {item.measurement_label_snapshot
                      ? localizedSnapshot(item.measurement_label_snapshot, item.measurement_label_translations, locale)
                      : "بدون قياس إضافي"}
                    {item.variant_label_snapshot
                      ? ` · ${item.variant_label_snapshot}`
                      : ""}
                    {item.notes ? ` · ${item.notes}` : ""}
                  </p>
                </div>
                <strong>
                  {Number(item.quantity).toLocaleString(intlLocale(locale))}{" "}
                  {localizedSnapshot(item.unit_name_snapshot, item.unit_name_translations, locale)}
                </strong>
              </article>
            ))}
            {!items.length ? <p className={styles.noItems}>لا توجد بنود متاحة لهذا الطلب حاليًا.</p> : null}
          </div>
          {request.notes ? (
            <div className="customer-rfq-note">
              <b>ملاحظات الطلب</b>
              <p>{request.notes}</p>
            </div>
          ) : null}
        </section>

        <aside className="customer-rfq-summary">
          <section className="database-panel">
            <h2>التسليم والموقع</h2>
            <dl>
              <div>
                <dt>طريقة الاستلام</dt>
                <dd>
                  {request.delivery_mode === "pickup"
                    ? "استلام من المزود"
                    : "توصيل إلى الموقع"}
                </dd>
              </div>
              <div>
                <dt>وصف الموقع</dt>
                <dd>{request.location_hint}</dd>
              </div>
              <div>
                <dt>موعد الاستلام المطلوب</dt>
                <dd>{date(request.desired_receipt_at)}</dd>
              </div>
              {request.recipient_name ? (
                <div>
                  <dt>المستلم</dt>
                  <dd>{request.recipient_name}</dd>
                </div>
              ) : null}
              {request.recipient_mobile ? (
                <div>
                  <dt>جوال المستلم</dt>
                  <dd dir="ltr">{request.recipient_mobile}</dd>
                </div>
              ) : null}
              {request.site_responsible_name ? (
                <div>
                  <dt>مسؤول الموقع</dt>
                  <dd>{request.site_responsible_name}</dd>
                </div>
              ) : null}
              {request.site_responsible_mobile ? (
                <div>
                  <dt>جوال مسؤول الموقع</dt>
                  <dd dir="ltr">{request.site_responsible_mobile}</dd>
                </div>
              ) : null}
              {request.contractor_name ? (
                <div>
                  <dt>المقاول</dt>
                  <dd>{request.contractor_name}</dd>
                </div>
              ) : null}
              {request.contractor_mobile ? (
                <div>
                  <dt>جوال المقاول</dt>
                  <dd dir="ltr">{request.contractor_mobile}</dd>
                </div>
              ) : null}
              {request.working_hours ? (
                <div>
                  <dt>مواعيد العمل</dt>
                  <dd>{request.working_hours}</dd>
                </div>
              ) : null}
              {request.loading_option ? (
                <div>
                  <dt>التحميل</dt>
                  <dd>{request.loading_option}</dd>
                </div>
              ) : null}
              {request.unloading_option ? (
                <div>
                  <dt>التنزيل</dt>
                  <dd>{request.unloading_option}</dd>
                </div>
              ) : null}
              {request.road_access ? (
                <div>
                  <dt>سهولة الوصول</dt>
                  <dd>{request.road_access}</dd>
                </div>
              ) : null}
              {request.access_instructions ? (
                <div>
                  <dt>تعليمات الوصول</dt>
                  <dd>{request.access_instructions}</dd>
                </div>
              ) : null}
            </dl>
            {customerMapUrl(request.google_maps_url) ? (
              <a
                className="customer-card-action"
                href={customerMapUrl(request.google_maps_url)!}
                target="_blank"
                rel="noreferrer"
              >
                فتح موقع التسليم في Google Maps
              </a>
            ) : null}
            {request.delivery_details_acknowledged_at ? (
              <p className="customer-success-message">
                تم إقرار مسؤولية الاستلام وصحة البيانات بتاريخ{" "}
                {date(request.delivery_details_acknowledged_at)}.
              </p>
            ) : null}
          </section>

          <section className="database-panel">
            <h2>متابعة الطلب</h2>
            <dl>
              <div>
                <dt>تاريخ الإرسال</dt>
                <dd>{date(request.created_at)}</dd>
              </div>
              <div>
                <dt>{quote ? "نتيجة التسعير" : "مدة منافسة المزودين"}</dt>
                <dd>
                  {quote
                    ? "أُغلقت المنافسة واعتمد العرض النهائي"
                    : request.quote_window_label || "3 ساعات تسعير"}
                </dd>
              </div>
              <div>
                <dt>حالة الدفع</dt>
                <dd>{label(request.payment_status)}</dd>
              </div>
            </dl>
            {!quote ? (
              <>
                <PricingWindow
                  opensAt={request.pricing_opens_at}
                  startsAt={request.pricing_countdown_starts_at}
                  deadlineAt={request.quote_deadline}
                />
                <p className="customer-rfq-wait">
                  إذا أُرسل الطلب خارج 8 ص–4 م، يبدأ عداد الثلاث ساعات الساعة 8
                  صباحًا ويُتاح للمزودين الاطلاع من 6 صباحًا.
                </p>
              </>
            ) : null}
            {quote ? (
              <Link
                className="customer-primary-link customer-rfq-quote"
                href={`/customer/quotes/${quote.id}`}
              >
                فتح عرض السعر{" "}
                {quote.total != null ? `· ${money(quote.total)}` : ""}
              </Link>
            ) : (
              <p className="customer-rfq-wait">
                سيظهر زر عرض السعر هنا فور اكتماله.
              </p>
            )}
          </section>
        </aside>
      </div>
    </Shell>
  );
}

export function CustomerQuotes() {
  const now = useLiveNow();
  const state = useCustomerRows(
    () =>
      db
        .from("bunya_customer_quotes")
        .select(
          "id,quote_code,subtotal,vat_amount,delivery_fee,total,status,processing_stage,valid_until,expected_delivery_at,created_at,bunya_customer_quote_items(id,product_id,product_name_snapshot,quantity,unit_snapshot)",
        )
        .order("created_at", { ascending: false }),
    "quotes",
  );
  return (
    <Shell
      title="عروض بُنية"
      description="العروض الموحدة الصادرة لك؛ افتح العرض الجاهز لقبوله أو رفضه."
      loading={state.loading}
      error={state.error}
      onRetry={() => void state.load()}
    >
      <Summary entries={[{ label: "العروض الصادرة", value: state.rows.length }, { label: "بانتظار قرارك", value: state.rows.filter((row) => ["ready", "customer_review", "quote_ready"].includes(row.status) && new Date(row.valid_until).getTime() > now).length }, { label: "عروض مقبولة", value: state.rows.filter((row) => row.status === "accepted").length }]} />
      {state.rows.length ? (
        <RecordList rows={state.rows} title="عروض الأسعار" searchKeys={["quote_code"]}>{(rows) => <div className="customer-cards">
          {rows.map((row) => {
            const needsDecision = ["ready", "customer_review"].includes(String(row.status));
            const expired = row.status === "expired" || (needsDecision && new Date(row.valid_until).getTime() <= now);
            return (
              <article key={row.id}>
                <header>
                  <div>
                    <small>{row.quote_code}</small>
                    <h2>{money(row.total)}</h2>
                  </div>
                  <Badge value={expired ? "expired" : row.status} />
                </header>
                <ProductPreview items={row.bunya_customer_quote_items} />
                <dl>
                  <div>
                    <dt>المجموع</dt>
                    <dd>{money(row.subtotal)}</dd>
                  </div>
                  <div>
                    <dt>الضريبة والتوصيل</dt>
                    <dd>
                      {money(Number(row.vat_amount) + Number(row.delivery_fee))}
                    </dd>
                  </div>
                  <div>
                    <dt>صلاحية العرض</dt>
                    <dd>{date(row.valid_until)}</dd>
                  </div>
                  <div>
                    <dt>التوصيل المتوقع</dt>
                    <dd>{date(row.expected_delivery_at)}</dd>
                  </div>
                </dl>
                {needsDecision ? <LiveDeadline
                  target={row.valid_until}
                  label="المتبقي لاعتماد العرض"
                  expiredLabel="انتهت صلاحية العرض"
                  tone="warning"
                /> : null}
                <Link
                  className="customer-card-action"
                  href={`/customer/quotes/${row.id}`}
                >
                  {expired || !needsDecision ? "عرض تفاصيل السعر" : "مراجعة العرض واتخاذ القرار"}
                </Link>
              </article>
            );
          })}
        </div>}</RecordList>
      ) : (
        <Empty
          text="لا توجد عروض صادرة بعد. بعد إرسال طلب مواد واكتمال التسعير سيظهر العرض هنا."
          action={
            <Link
              className="customer-primary-link"
              href="/customer/quote-request/new"
            >
              إرسال طلب مواد
            </Link>
          }
        />
      )}
    </Shell>
  );
}

export function CustomerOrders() {
  const { locale } = useLocale();
  const state = useCustomerRows(
    () =>
      db
        .from("orders")
        .select(
          "id,order_code,customer_quote_id,status,payment_status,subtotal,vat_amount,delivery_fee,total,desired_receipt_at,created_at,order_items(id,product_id,product_name_snapshot,quantity,unit_name_snapshot)",
        )
        .order("created_at", { ascending: false }),
    "orders",
  );
  return (
    <Shell
      title="طلبات الشراء"
      description="تابع تجهيز المواد، راجع تفاصيل الدفع، واطّلع على موعد الاستلام من مكان واحد."
      loading={state.loading}
      error={state.error}
      onRetry={() => void state.load()}
    >
      <Summary entries={[{ label: "طلبات الشراء", value: state.rows.length }, { label: "قيد التنفيذ", value: state.rows.filter((row) => !["delivered", "completed", "cancelled"].includes(row.status)).length }, { label: "مكتملة", value: state.rows.filter((row) => ["delivered", "completed"].includes(row.status)).length }]} />
      {state.rows.length ? (
        <RecordList rows={state.rows} title="طلبات الشراء" searchKeys={["order_code"]}>{(rows) => <div className="customer-cards">
          {rows.map((row) => (
            <article key={row.id}>
              <header>
                <div>
                  <small>{row.order_code}</small>
                  <h2>{money(row.total)}</h2>
                </div>
                <Badge value={row.status} />
              </header>
              <ProductPreview items={row.order_items} />
              <dl>
                <div>
                  <dt>الدفع</dt>
                  <dd>{label(row.payment_status)}</dd>
                </div>
                <div>
                  <dt>الموعد المطلوب</dt>
                  <dd>{date(row.desired_receipt_at)}</dd>
                </div>
                <div>
                  <dt>الضريبة</dt>
                  <dd>{money(row.vat_amount)}</dd>
                </div>
                <div>
                  <dt>التوصيل</dt>
                  <dd>{money(row.delivery_fee)}</dd>
                </div>
              </dl>
              <Link
                className="customer-card-action"
                href={`/customer/orders/${row.id}`}
              >
                عرض تفاصيل الطلب
              </Link>
              {row.customer_quote_id && row.status !== "cancelled" && !["paid", "succeeded", "refunded"].includes(String(row.payment_status)) ? <Link className="customer-card-action" href={`/customer/quotes/${row.customer_quote_id}/payment`}>{paymentCopy[locale].pay}</Link> : null}
            </article>
          ))}
        </div>}</RecordList>
      ) : (
        <Empty
          text="لا توجد طلبات شراء بعد. قبول عرض بُنية ينشئ طلبًا حقيقيًا ويظهره هنا."
          action={
            <Link className="customer-primary-link" href="/customer/quotes">
              مراجعة العروض
            </Link>
          }
        />
      )}
    </Shell>
  );
}

export function CustomerDeliveries() {
  const state = useCustomerRows(
    () => db.rpc("get_customer_deliveries"),
    "deliveries",
  );
  return (
    <Shell
      title="التوصيلات"
      description="تابع رحلة المواد إلى موقعك، واطّلع على السائق وموعد الوصول وآخر تحديث للتسليم."
      loading={state.loading}
      error={state.error}
      onRetry={() => void state.load()}
    >
      <Summary entries={[{ label: "سجل التوصيلات", value: state.rows.length }, { label: "بانتظار الاستلام", value: state.rows.filter((row) => !row.confirmed_at && !["cancelled", "delivered", "completed"].includes(row.delivery_status)).length }, { label: "تم استلامها", value: state.rows.filter((row) => row.confirmed_at || row.delivered_at).length }]} />
      <details className={styles.explainer}><summary>استلام الطلب وتأكيد التسليم</summary><p>راجع المواد والكميات عند وصول السائق، ثم سلّمه رمز التسليم بعد استلام كامل البضاعة. يدخله السائق أو المزود لإثبات التسليم.</p></details>
      {state.rows.length ? (
        <RecordList rows={state.rows} title="التوصيلات" searchKeys={["order_code", "driver_name"]} statusKey="delivery_status">{(rows) => <div className="customer-cards">
          {rows.map((row) => (
            <article key={row.delivery_id}>
              <header>
                <div>
                  <small>{row.order_code}</small>
                  <h2>{row.confirmed_at ? "اكتمل التسليم" : row.delivery_status === "arrived" ? "طلبك وصل إلى الموقع" : "رحلة طلبك إلى الموقع"}</h2>
                </div>
                <Badge value={row.latest_status || row.delivery_status} />
              </header>
              <dl>
                <div>
                  <dt>السائق</dt>
                  <dd>{row.driver_name || "لم يُسند بعد"}</dd>
                </div>
                <div>
                  <dt>الموعد المتوقع</dt>
                  <dd>{date(row.expected_at)}</dd>
                </div>
                <div>
                  <dt>آخر تحديث</dt>
                  <dd>{date(row.latest_update_at)}</dd>
                </div>
                <div>
                  <dt>تاريخ التسليم</dt>
                  <dd>{row.delivered_at ? date(row.delivered_at) : "بانتظار الاستلام"}</dd>
                </div>
              </dl>
              {customerMapUrl(row.google_maps_url) ? (
                <a className="customer-card-action" href={customerMapUrl(row.google_maps_url)!} target="_blank" rel="noreferrer">
                  فتح موقع التسليم في Google Maps
                </a>
              ) : null}
              {row.delivery_status === "arrived" && !row.confirmed_at ? (
                <p className="customer-delivery-note">وصل السائق إلى الموقع. سلّمه الرمز بعد استلام كامل البضاعة ومراجعتها.</p>
              ) : null}
              {row.confirmed_at ? (
                <p className="customer-delivery-message success">✓ تم إثبات التسليم في {date(row.confirmed_at)} والطلب {row.order_status === "completed" ? "مغلق" : "مكتمل التسليم"}.</p>
              ) : null}
              {row.order_id ? <Link className="customer-card-action" href={`/customer/orders/${row.order_id}`}>عرض مواد الطلب وتفاصيله</Link> : null}
            </article>
          ))}
        </div>}</RecordList>
      ) : (
        <Empty
          text="لا توجد توصيلات نشطة. تظهر هنا بعد تجهيز طلب مدفوع وإسناده للتوصيل."
          action={
            <Link className="customer-primary-link" href="/customer/orders">
              عرض الطلبات
            </Link>
          }
        />
      )}
    </Shell>
  );
}

export function CustomerBilling() {
  const state = useCustomerRows(
    () =>
      db
        .from("invoices")
        .select(
          "id,invoice_code,order_id,subtotal,vat_amount,delivery_fee,total,status,issued_at,paid_at",
        )
        .order("issued_at", { ascending: false }),
    "billing",
  );
  return (
    <Shell
      title="الفواتير"
      description="الفواتير الصادرة لحسابك وقيمتها وحالة سدادها."
      loading={state.loading}
      error={state.error}
      onRetry={() => void state.load()}
    >
      <Summary entries={[{ label: "الفواتير الصادرة", value: state.rows.length }, { label: "قيمة الفواتير", value: money(state.rows.filter((row) => !["cancelled", "void", "refunded"].includes(row.status)).reduce((total, row) => total + Number(row.total ?? 0), 0)), detail: "باستثناء الملغاة والمستردة" }, { label: "فواتير مسددة", value: state.rows.filter((row) => row.paid_at || row.status === "paid").length }]} />
      {state.rows.length ? (
        <RecordList rows={state.rows} title="الفواتير" searchKeys={["invoice_code"]}>{(rows) => <div className="customer-cards">
          {rows.map((row) => (
            <article key={row.id}>
              <header>
                <div>
                  <small>{row.invoice_code}</small>
                  <h2>{money(row.total)}</h2>
                </div>
                <Badge value={row.status} />
              </header>
              <dl>
                <div>
                  <dt>المجموع</dt>
                  <dd>{money(row.subtotal)}</dd>
                </div>
                <div>
                  <dt>الضريبة</dt>
                  <dd>{money(row.vat_amount)}</dd>
                </div>
                <div>
                  <dt>تاريخ الإصدار</dt>
                  <dd>{date(row.issued_at)}</dd>
                </div>
                <div>
                  <dt>تاريخ السداد</dt>
                  <dd>{row.paid_at ? date(row.paid_at) : "لم يُسجّل سداد بعد"}</dd>
                </div>
              </dl>
              <Link
                className="customer-card-action"
                href={`/customer/orders/${row.order_id}`}
              >
                فتح الطلب المرتبط
              </Link>
            </article>
          ))}
        </div>}</RecordList>
      ) : (
        <Empty text="لا توجد فواتير حتى الآن. ستجد هنا تفاصيل المبالغ والضريبة بعد إصدار فاتورة لطلبك." action={<Link className="customer-primary-link" href="/customer/orders">متابعة طلبات الشراء</Link>} />
      )}
    </Shell>
  );
}

export function CustomerSavedContractors() {
  const identity = useAuthIdentity();
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const state = useCustomerRows(
    () =>
      db
        .from("saved_contractors")
        .select(
          "contractor_profile_id,contact_requested_at,saved_at,contractor_profiles(id,display_name,commercial_name,city,badge,average_rating,availability)",
        )
        .eq("customer_profile_id", identity.userId)
        .order("saved_at", { ascending: false }),
    `contractors:${identity.userId}`,
  );
  const remove = async (id: string) => {
    if (removingId) return;
    setRemovingId(id);
    setMessage("");
    const result = await db
      .from("saved_contractors")
      .delete()
      .eq("customer_profile_id", identity.userId)
      .eq("contractor_profile_id", id);
    if (result.error) state.setError(result.error.message);
    else { setMessage("أُزيل المقاول من المحفوظات. يمكنك حفظه مجددًا من الدليل."); await state.load(); }
    setRemovingId(null);
  };
  return (
    <Shell
      title="المقاولون المحفوظون"
      description="القائمة التي حفظتها من دليل المقاولين ويمكنك إدارتها من هنا."
      loading={state.loading}
      error={state.error}
      onRetry={() => void state.load()}
      message={message}
      actions={
        <Link className="customer-primary-link" href="/contractors">
          استعراض الدليل
        </Link>
      }
    >
      {state.rows.length ? (
        <RecordList rows={state.rows.map((row) => { const contractor = (Array.isArray(row.contractor_profiles) ? row.contractor_profiles[0] : row.contractor_profiles) ?? {}; return { ...row, contractorName: contractor.display_name || contractor.commercial_name, contractorCity: contractor.city, contractorAvailability: contractor.availability }; })} title="المقاولون المحفوظون" searchKeys={["contractorName", "contractorCity"]} statusKey="contractorAvailability">{(rows) => <div className="customer-cards">
          {rows.map((row) => {
            const related = row.contractor_profiles;
            const contractor =
              (Array.isArray(related) ? related[0] : related) ?? {};
            return (
              <article key={row.contractor_profile_id}>
                <header>
                  <div>
                    <small>{contractor.badge || "من قائمة مقاولِيك"}</small>
                    <h2>
                      {contractor.display_name ||
                        contractor.commercial_name ||
                        "مقاول"}
                    </h2>
                  </div>
                  <Badge value={contractor.availability} />
                </header>
                <dl>
                  <div>
                    <dt>المدينة</dt>
                    <dd>{contractor.city || "—"}</dd>
                  </div>
                  <div>
                    <dt>التقييم</dt>
                    <dd>
                      {contractor.average_rating != null && Number(contractor.average_rating) > 0 ? `${Number(contractor.average_rating).toLocaleString("ar-SA")} / 5` : "لا توجد تقييمات بعد"}
                    </dd>
                  </div>
                  <div>
                    <dt>تاريخ الحفظ</dt>
                    <dd>{date(row.saved_at)}</dd>
                  </div>
                  <div>
                    <dt>طلب التواصل</dt>
                    <dd>{row.contact_requested_at ? date(row.contact_requested_at) : "لم تطلب التواصل بعد"}</dd>
                  </div>
                </dl>
                <div className="customer-card-buttons">
                  <Link className="customer-card-action" href="/contractors">
                    عرض الدليل
                  </Link>
                  <button
                    className="customer-secondary-button"
                    disabled={Boolean(removingId)}
                    onClick={() => void remove(row.contractor_profile_id)}
                  >
                    {removingId === row.contractor_profile_id ? "جارٍ الإزالة…" : "إزالة من المحفوظات"}
                  </button>
                </div>
              </article>
            );
          })}
        </div>}</RecordList>
      ) : (
        <Empty
          text="لم تحفظ مقاولين بعد. استعرض الدليل واحفظ المقاولين المناسبين لمشاريعك."
          action={
            <Link className="customer-primary-link" href="/contractors">
              فتح دليل المقاولين
            </Link>
          }
        />
      )}
    </Shell>
  );
}

export function CustomerAddresses() {
  const identity = useAuthIdentity();
  const state = useCustomerRows(
    () =>
      db
        .from("customer_addresses")
        .select("*")
        .eq("customer_profile_id", identity.userId)
        .order("is_default", { ascending: false })
        .order("created_at", { ascending: false }),
    `addresses:${identity.userId}`,
  );
  const [form, setForm] = useState<AddressForm>(emptyAddress);
  const [busy, setBusy] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const edit = (row: Row) => {
    setMessage("");
    setForm({
      id: row.id,
      label: row.label,
      projectName: row.project_name,
      googleMapsUrl: row.google_maps_url,
      city: row.city,
      region: row.region,
      description: row.description ?? "",
      recipientName: row.recipient_name,
      recipientMobile: row.recipient_mobile,
      isDefault: row.is_default,
    });
    document.getElementById("customer-address-name")?.focus();
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    state.setError("");
    const result = await db.rpc("save_customer_address", {
      p_id: form.id || null,
      p_label: form.label,
      p_project_name: form.projectName,
      p_google_maps_url: form.googleMapsUrl,
      p_city: form.city,
      p_region: form.region,
      p_description: form.description || null,
      p_recipient_name: form.recipientName,
      p_recipient_mobile: form.recipientMobile,
      p_is_default: form.isDefault,
    });
    if (result.error) state.setError(result.error.message);
    else {
      setForm(emptyAddress);
      setMessage(form.id ? "تم تحديث العنوان." : "تم حفظ العنوان.");
      await state.load();
    }
    setBusy(false);
  };
  const remove = async (id: string) => {
    if (removingId || busy) return;
    if (!window.confirm("هل تريد حذف هذا العنوان؟")) return;
    setRemovingId(id);
    state.setError("");
    setMessage("");
    const result = await db.rpc("delete_customer_address", { p_id: id });
    if (result.error) state.setError(result.error.message);
    else {
      if (form.id === id) setForm(emptyAddress);
      setMessage("تم حذف العنوان.");
      await state.load();
    }
    setRemovingId(null);
  };
  return (
    <Shell
      title="عناوين التسليم"
      description="أضف العنوان الصحيح وعدّله في أي وقت قبل استخدامه في طلب جديد."
      loading={state.loading}
      error={state.error}
      onRetry={() => void state.load()}
      message={message}
    >
      <Summary entries={[{ label: "عناوينك المحفوظة", value: state.rows.length }, { label: "المدن", value: new Set(state.rows.map((row) => row.city).filter(Boolean)).size }, { label: "العنوان الافتراضي", value: state.rows.find((row) => row.is_default)?.label || "لم يُحدد بعد" }]} />
      <section className="database-panel database-editor" id="customer-address-editor">
        <header className={styles.editorIntro}><h2>{form.id ? "تعديل العنوان" : "إضافة موقع تسليم"}</h2><p>احفظ بيانات موقعك والمستلم لتستخدمها مباشرة في طلباتك القادمة. رابط الخريطة يساعد على الوصول بدقة؛ وصف الموقع اختياري.</p></header>
        <form className="database-form-grid" onSubmit={save}>
          <label>
            <span>اسم العنوان</span>
            <input
              id="customer-address-name"
              required
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
              placeholder="المنزل أو موقع المشروع"
            />
          </label>
          <label>
            <span>اسم المشروع</span>
            <input
              required
              value={form.projectName}
              onChange={(e) =>
                setForm({ ...form, projectName: e.target.value })
              }
            />
          </label>
          <label>
            <span>المدينة</span>
            <input
              required
              value={form.city}
              onChange={(e) => setForm({ ...form, city: e.target.value })}
            />
          </label>
          <label>
            <span>المنطقة</span>
            <input
              required
              value={form.region}
              onChange={(e) => setForm({ ...form, region: e.target.value })}
            />
          </label>
          <label>
            <span>اسم المستلم</span>
            <input
              required
              value={form.recipientName}
              onChange={(e) =>
                setForm({ ...form, recipientName: e.target.value })
              }
            />
          </label>
          <label>
            <span>جوال المستلم</span>
            <input
              required
              dir="ltr"
              type="tel"
              inputMode="tel"
              value={form.recipientMobile}
              onChange={(e) =>
                setForm({ ...form, recipientMobile: e.target.value })
              }
              placeholder="05xxxxxxxx"
            />
          </label>
          <label className="wide">
            <span>رابط خرائط Google</span>
            <input
              required
              dir="ltr"
              type="url"
              value={form.googleMapsUrl}
              onChange={(e) =>
                setForm({ ...form, googleMapsUrl: e.target.value })
              }
            />
          </label>
          <label className="wide">
            <span>وصف الموقع</span>
            <textarea
              rows={3}
              value={form.description}
              onChange={(e) =>
                setForm({ ...form, description: e.target.value })
              }
            />
          </label>
          <label className="customer-checkbox wide">
            <input
              type="checkbox"
              checked={form.isDefault}
              onChange={(e) =>
                setForm({ ...form, isDefault: e.target.checked })
              }
            />{" "}
            اجعله العنوان الافتراضي
          </label>
          <footer className="wide">
            <button disabled={busy || Boolean(removingId)}>
              {busy
                ? "جارٍ الحفظ..."
                : form.id
                  ? "حفظ التعديلات"
                  : "إضافة العنوان"}
            </button>
            {form.id ? (
              <button
                className="customer-secondary-button"
                type="button"
                onClick={() => setForm(emptyAddress)}
              >
                إلغاء التعديل
              </button>
            ) : null}
          </footer>
        </form>
      </section>
      {state.rows.length ? (
        <RecordList rows={state.rows} title="العناوين المحفوظة" searchKeys={["label", "project_name", "city", "recipient_name"]}>{(rows) => <div className="customer-cards">
          {rows.map((row) => (
            <article key={row.id}>
              <header>
                <div>
                  <small>{row.project_name}</small>
                  <h2>{row.label}</h2>
                </div>
                {row.is_default ? <Badge value="افتراضي" /> : null}
              </header>
              <dl>
                <div>
                  <dt>الموقع</dt>
                  <dd>
                    {row.city}، {row.region}
                  </dd>
                </div>
                <div>
                  <dt>المستلم</dt>
                  <dd>{row.recipient_name}</dd>
                </div>
                <div>
                  <dt>الجوال</dt>
                  <dd dir="ltr">{row.recipient_mobile}</dd>
                </div>
                <div>
                  <dt>الوصف</dt>
                  <dd>{row.description || "—"}</dd>
                </div>
              </dl>
              <div className="customer-card-buttons">
                {customerMapUrl(row.google_maps_url) ? <a
                  className="customer-card-action"
                  href={customerMapUrl(row.google_maps_url)!}
                  target="_blank"
                  rel="noreferrer"
                >
                  فتح الخريطة
                </a> : null}
                <button
                  className="customer-secondary-button"
                  disabled={busy || Boolean(removingId)}
                  onClick={() => edit(row)}
                >
                  تعديل
                </button>
                <button
                  className="customer-danger-button"
                  disabled={busy || Boolean(removingId)}
                  onClick={() => void remove(row.id)}
                >
                  {removingId === row.id ? "جارٍ الحذف…" : "حذف"}
                </button>
              </div>
            </article>
          ))}
        </div>}</RecordList>
      ) : (
        <Empty text="لا توجد عناوين محفوظة. استخدم النموذج أعلاه لإضافة أول عنوان." />
      )}
    </Shell>
  );
}

export function CustomerProfile() {
  const identity = useAuthIdentity();
  const [form, setForm] = useState({ fullName: "", username: "" });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => {
    void (async () => {
      const result = await db
        .from("profiles")
        .select("full_name,username")
        .eq("id", identity.userId)
        .single();
      if (result.error) setError(result.error.message);
      else
        setForm({
          fullName: result.data.full_name ?? "",
          username: result.data.username ?? "",
        });
      setLoading(false);
    })();
  }, [identity.userId]);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    const result = await db
      .from("profiles")
      .update({
        full_name: form.fullName.trim() || null,
        username: form.username.trim() || null,
      })
      .eq("id", identity.userId);
    if (result.error) setError(result.error.message);
    else setMessage("تم حفظ بيانات الملف الشخصي.");
    setBusy(false);
  };
  return (
    <Shell
      title="الملف الشخصي"
      description="حدّث الاسم الظاهر واسم المستخدم. الجوال الموثق والبريد يعرضان للمرجعية ولا يتغيران من هنا."
      loading={loading}
      error={error}
      message={message}
    >
      <section className={styles.identityBanner} aria-label="ملخص حسابك">
        <span className={styles.identityAvatar} aria-hidden="true">{(form.fullName || identity.profile?.fullName || "ب").trim().slice(0, 1)}</span>
        <div><small>حساب العميل في بُنية</small><h2>{form.fullName || "ملفك الشخصي"}</h2><p>بيانات واضحة لتواصل أسهل ومتابعة أدق لطلباتك ومشاريعك.</p></div>
      </section>
      <section className="database-panel database-editor">
        <header className={styles.editorIntro}><h2>بيانات الحساب</h2><p>الاسم واسم المستخدم قابلان للتعديل. بيانات التواصل الموثقة تظهر أدناه للمرجعية.</p></header>
        <form className="database-form-grid" onSubmit={save}>
          <label>
            <span>الاسم الكامل</span>
            <input
              required
              minLength={2}
              autoComplete="name"
              value={form.fullName}
              onChange={(e) => setForm({ ...form, fullName: e.target.value })}
            />
          </label>
          <label>
            <span>اسم المستخدم</span>
            <input
              required
              minLength={4}
              maxLength={40}
              autoComplete="username"
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
            />
          </label>
          <label>
            <span>الجوال الموثق</span>
            <input
              readOnly
              dir="ltr"
              value={identity.profile?.mobile ?? "غير مسجل"}
            />
            <small>لتغيير الجوال يلزم مسار تحقق جديد حفاظًا على الحساب.</small>
          </label>
          <label>
            <span>البريد الإلكتروني</span>
            <input
              readOnly
              dir="ltr"
              value={
                identity.profile?.email ?? identity.authEmail ?? "غير مسجل"
              }
            />
          </label>
          <footer className="wide">
            <button disabled={busy}>
              {busy ? "جارٍ الحفظ..." : "حفظ الملف الشخصي"}
            </button>
            <Link className="customer-card-action" href="/customer/support">المساعدة في بيانات الحساب</Link>
          </footer>
        </form>
      </section>
    </Shell>
  );
}
