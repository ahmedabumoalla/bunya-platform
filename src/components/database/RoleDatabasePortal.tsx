"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useAuthIdentity } from "@/components/auth/AuthIdentityProvider";
import type { AppRole } from "@/lib/auth/types";
import { createClient } from "@/lib/supabase/client";

type MetricConfig = { label: string; table: string };
type RouteConfig = {
  path: string;
  title: string;
  description: string;
  table?: string;
  rpc?: string;
  fields?: string[];
  metrics?: MetricConfig[];
  detail?: boolean;
  empty?: string;
};

type DataRow = Record<string, unknown>;
type LoadState = {
  loading: boolean;
  rows: DataRow[];
  counts: Record<string, number>;
  error: string | null;
};

const route = (
  path: string,
  title: string,
  table: string,
  fields: string[],
  description = "بيانات حقيقية مقروءة مباشرة من Supabase وفق صلاحيات الحساب.",
  detail = true,
): RouteConfig => ({ path, title, table, fields, description, detail });

const adminRoutes: RouteConfig[] = [
  {
    path: "/admin",
    title: "مركز قيادة المنصة",
    description: "مؤشرات حقيقية من قاعدة البيانات وفق صلاحيات الإدارة.",
    table: "admin_alerts",
    fields: ["alert_type", "title", "priority", "status", "created_at"],
    metrics: [
      { label: "المستخدمون", table: "profiles" },
      { label: "المزودون", table: "providers" },
      { label: "المقاولون", table: "contractor_profiles" },
      { label: "الطلبات", table: "orders" },
      { label: "طلبات الأسعار", table: "quote_requests" },
      { label: "طلبات المشاريع", table: "project_requests" },
    ],
    detail: false,
    empty: "لا توجد تنبيهات إدارية حالية.",
  },
  route("/admin/users", "المستخدمون", "profiles", ["username", "full_name", "mobile", "email", "is_active", "created_at"]),
  route("/admin/join-requests/providers", "طلبات انضمام المزودين", "provider_applications", ["company_name", "contact_name", "mobile", "email", "status", "created_at"]),
  route("/admin/join-requests/contractors", "طلبات انضمام المقاولين", "contractor_applications", ["contractor_name", "mobile", "email", "status", "created_at"]),
  route("/admin/drivers", "السائقون", "provider_drivers", ["full_name", "mobile", "email", "status", "must_change_password", "created_at"]),
  route("/admin/admins", "المدراء", "admin_users", ["profile_id", "role_id", "is_active", "last_active_at", "created_at"]),
  route("/admin/catalog", "التصنيفات", "product_categories", ["name", "slug", "is_active", "sort_order", "created_at"]),
  route("/admin/products/review", "مراجعة المنتجات", "products", ["name", "sku", "review_status", "is_published", "provider_id", "created_at"]),
  route("/admin/pricing", "الأسعار والتوفر", "provider_product_prices", ["provider_id", "product_id", "unit_price", "vat_inclusive", "expires_at", "freshness_status"]),
  route("/admin/sourcing", "محرك التوريد", "internal_sourcing_requests", ["request_code", "status", "created_at", "completed_at"]),
  route("/admin/bunya-quotes", "عروض بُنية", "bunya_customer_quotes", ["quote_code", "customer_profile_id", "subtotal", "total", "status", "created_at"]),
  route("/admin/quote-requests", "طلبات عرض السعر", "quote_requests", ["request_code", "requester_role", "status", "payment_status", "quote_deadline", "created_at"]),
  route("/admin/orders", "الطلبات", "orders", ["order_code", "customer_profile_id", "status", "payment_status", "total", "created_at"]),
  route("/admin/deliveries", "التوصيل", "provider_delivery_assignments", ["order_id", "provider_id", "assigned_driver_id", "status", "expected_at", "delivered_at"]),
  route("/admin/delivery-monitoring", "مراقبة التوصيل", "provider_delivery_assignments", ["order_id", "provider_id", "assigned_driver_id", "status", "expected_at", "updated_at"]),
  route("/admin/delivery-codes", "سجلات تأكيد التسليم", "delivery_confirmation_records", ["assignment_id", "assigned_driver_id", "confirmed_by_user_id", "confirmed_at", "created_at"]),
  route("/admin/project-requests", "طلبات المشاريع", "project_requests", ["request_code", "project_name", "city", "status", "estimated_budget", "created_at"]),
  route("/admin/contractor-opportunities", "فرص المقاولين", "contractor_opportunities", ["opportunity_code", "title", "city", "status", "proposal_deadline", "created_at"]),
  route("/admin/contractor-proposals", "عروض المقاولين", "contractor_proposals", ["proposal_code", "contractor_profile_id", "status", "total_amount", "created_at"]),
  route("/admin/contractor-projects", "مشاريع المقاولات", "contractor_projects", ["project_code", "project_request_id", "contractor_profile_id", "status", "contract_value", "created_at"]),
  route("/admin/contractor-documents", "مستندات المقاولين", "contractor_documents", ["contractor_profile_id", "document_type", "document_number", "status", "expires_at", "created_at"]),
  route("/admin/reviews", "التقييمات", "contractor_reviews", ["contractor_profile_id", "customer_profile_id", "rating", "is_visible", "created_at"]),
  route("/admin/finance", "الحركات المالية", "financial_transactions", ["transaction_code", "profile_id", "transaction_type", "amount", "status", "created_at"]),
  route("/admin/settlements/providers", "تسويات المزودين", "settlement_requests", ["request_code", "provider_id", "amount", "status", "created_at"]),
  route("/admin/settlements/contractors", "تسويات المقاولين", "contractor_settlement_requests", ["request_code", "contractor_profile_id", "amount", "status", "created_at"]),
  route("/admin/invoices", "الفواتير", "invoices", ["invoice_code", "customer_profile_id", "subtotal", "vat", "total", "status", "created_at"]),
  route("/admin/notifications", "الإشعارات", "notifications", ["recipient_profile_id", "title", "body", "read_at", "created_at"]),
  route("/admin/support", "تذاكر الدعم", "support_tickets", ["ticket_code", "requester_profile_id", "subject", "priority", "status", "created_at"]),
  route("/admin/policies", "السياسات", "platform_policies", ["policy_key", "title", "is_active", "created_at", "updated_at"]),
  route("/admin/audit", "سجل التدقيق", "audit_logs", ["actor_profile_id", "action", "entity_type", "entity_id", "created_at"], undefined, false),
  route("/admin/settings", "إعدادات المنصة", "platform_settings", ["setting_key", "section", "value", "is_sensitive", "updated_at"], undefined, false),
  route("/admin/operations", "الأحداث التشغيلية", "admin_operation_events", ["operation_type", "operation_id", "status", "error_message", "occurred_at"], undefined, false),
  route("/admin/alerts", "التنبيهات الإدارية", "admin_alerts", ["alert_type", "title", "priority", "status", "created_at"]),
  route("/admin/project-comments", "تعليقات المشاريع", "contractor_project_comments", ["comment_code", "project_request_id", "type", "status", "created_at"]),
];

const providerRoutes: RouteConfig[] = [
  {
    path: "/merchant",
    title: "لوحة المزود",
    description: "مؤشرات منشأتك من قاعدة البيانات تحت سياسات RLS.",
    table: "internal_fulfillment_orders",
    fields: ["order_id", "provider_id", "status", "total_amount", "created_at"],
    metrics: [
      { label: "المنتجات", table: "products" },
      { label: "طلبات التسعير", table: "internal_sourcing_request_targets" },
      { label: "الاستجابات", table: "provider_pricing_responses" },
      { label: "أوامر التوريد", table: "internal_fulfillment_orders" },
      { label: "السائقون", table: "provider_drivers" },
    ],
    detail: false,
  },
  route("/merchant/products", "المنتجات", "products", ["name", "sku", "base_unit", "review_status", "is_published", "updated_at"]),
  route("/merchant/products/new", "إنشاء منتج", "products", ["name", "sku", "base_unit", "review_status", "is_published", "created_at"], "يعرض هذا المسار السجلات الحقيقية فقط؛ لا تُحفظ مسودات محلية.", false),
  route("/merchant/orders", "أوامر التوريد", "internal_fulfillment_orders", ["order_id", "provider_id", "status", "subtotal", "total", "created_at"]),
  route("/merchant/drivers", "السائقون", "provider_drivers", ["full_name", "mobile", "email", "status", "must_change_password", "updated_at"]),
  route("/merchant/drivers/new", "إنشاء حساب سائق", "provider_drivers", ["full_name", "mobile", "email", "status", "created_at"], "إنشاء Auth user للسائق يحتاج Backend privileged action؛ لا توجد محاكاة محلية.", false),
  route("/merchant/finance", "المالية", "settlement_requests", ["request_code", "amount", "status", "reviewed_at", "created_at"]),
  route("/merchant/notifications", "الإشعارات", "notifications", ["title", "body", "read_at", "created_at"], undefined, false),
  route("/merchant/profile", "ملف المنشأة", "providers", ["company_name", "status", "owner_profile_id", "created_at", "updated_at"], undefined, false),
  route("/merchant/quote-requests", "طلبات التحقق والتسعير", "internal_sourcing_request_targets", ["sourcing_item_id", "provider_id", "status", "sent_at", "viewed_at"]),
  route("/merchant/quotes", "استجابات التسعير", "provider_pricing_responses", ["response_code", "request_item_id", "unit_price", "status", "price_expires_at", "created_at"]),
  route("/merchant/support", "تذاكر الدعم", "support_tickets", ["ticket_code", "subject", "priority", "status", "created_at"]),
];

const customerRoutes: RouteConfig[] = [
  {
    path: "/customer",
    title: "لوحة العميل",
    description: "طلباتك وعروضك ومشاريعك الفعلية من قاعدة البيانات.",
    table: "quote_requests",
    fields: ["request_code", "status", "payment_status", "quote_deadline", "created_at"],
    metrics: [
      { label: "طلبات الأسعار", table: "quote_requests" },
      { label: "عروض بُنية", table: "bunya_customer_quotes" },
      { label: "الطلبات", table: "orders" },
      { label: "طلبات المشاريع", table: "project_requests" },
      { label: "الإشعارات", table: "customer_notifications" },
    ],
    detail: false,
  },
  route("/customer/addresses", "العناوين", "customer_addresses", ["label", "city", "recipient_name", "recipient_mobile", "is_default", "created_at"]),
  route("/customer/billing", "الفواتير", "invoices", ["invoice_code", "subtotal", "vat", "total", "status", "issued_at"]),
  route("/customer/contractors", "المقاولون المحفوظون", "saved_contractors", ["contractor_profile_id", "created_at"], undefined, false),
  { path: "/customer/deliveries", title: "التوصيلات", description: "إسقاط آمن لتوصيلات العميل من قاعدة البيانات.", rpc: "get_customer_deliveries", fields: ["delivery_id", "order_id", "status", "expected_at", "delivered_at"], detail: false },
  route("/customer/notifications", "الإشعارات", "customer_notifications", ["title", "body", "read_at", "created_at"], undefined, false),
  route("/customer/orders", "الطلبات", "orders", ["order_code", "status", "payment_status", "subtotal", "total", "created_at"]),
  route("/customer/profile", "الملف الشخصي", "profiles", ["username", "full_name", "mobile", "email", "is_active", "updated_at"], undefined, false),
  route("/customer/project-requests", "طلبات المشاريع", "project_requests", ["request_code", "project_name", "city", "status", "estimated_budget", "created_at"]),
  route("/customer/project-requests/new", "طلب مشروع جديد", "project_requests", ["request_code", "project_name", "city", "status", "created_at"], "لا تُحفظ مسودة محلية؛ ستظهر الطلبات المحفوظة فعليًا فقط.", false),
  route("/customer/quote-request/new", "طلب عرض سعر جديد", "quote_requests", ["request_code", "status", "quote_deadline", "created_at"], "لا تُحفظ مسودة محلية؛ ستظهر الطلبات المحفوظة فعليًا فقط.", false),
  route("/customer/quote-requests", "طلبات عرض السعر", "quote_requests", ["request_code", "status", "payment_status", "quote_deadline", "created_at"]),
  route("/customer/quotes", "عروض بُنية", "bunya_customer_quotes", ["quote_code", "subtotal", "vat", "total", "status", "valid_until"]),
  route("/customer/support", "تذاكر الدعم", "support_tickets", ["ticket_code", "subject", "priority", "status", "created_at"]),
];

const contractorRoutes: RouteConfig[] = [
  {
    path: "/contractor",
    title: "لوحة المقاول",
    description: "الفرص والعروض والمشاريع الفعلية المرتبطة بملف المقاول.",
    table: "contractor_projects",
    fields: ["project_code", "status", "contract_value", "start_date", "expected_end_date"],
    metrics: [
      { label: "الفرص", table: "contractor_opportunities" },
      { label: "العروض", table: "contractor_proposals" },
      { label: "المشاريع", table: "contractor_projects" },
      { label: "الإشعارات", table: "contractor_notifications" },
    ],
    detail: false,
  },
  route("/contractor/finance", "المالية", "contractor_financial_transactions", ["transaction_code", "project_id", "transaction_type", "amount", "status", "created_at"]),
  route("/contractor/notifications", "الإشعارات", "contractor_notifications", ["title", "body", "read_at", "created_at"], undefined, false),
  { path: "/contractor/opportunities", title: "فرص المشاريع", description: "إسقاط آمن للفرص المتاحة لهذا المقاول.", rpc: "get_contractor_opportunities", fields: ["opportunity_id", "opportunity_code", "title", "city", "proposal_deadline", "status"], detail: true },
  route("/contractor/portfolio", "معرض الأعمال", "contractor_portfolio_items", ["title", "description", "is_visible", "is_approved", "created_at"]),
  route("/contractor/profile", "الملف المهني", "contractor_profiles", ["display_name", "commercial_name", "city", "approval_status", "availability", "updated_at"], undefined, false),
  route("/contractor/project-comments", "تعليقات المشاريع", "contractor_project_comments", ["comment_code", "project_request_id", "type", "status", "created_at"]),
  route("/contractor/projects", "المشاريع", "contractor_projects", ["project_code", "project_request_id", "status", "contract_value", "start_date", "expected_end_date"]),
  route("/contractor/proposals", "العروض المقدمة", "contractor_proposals", ["proposal_code", "opportunity_id", "status", "total_amount", "submitted_at", "created_at"]),
  route("/contractor/reviews", "التقييمات", "contractor_reviews", ["rating", "review_text", "is_visible", "created_at"]),
  route("/contractor/services", "الخدمات", "contractor_services", ["name", "description", "status", "created_at", "updated_at"]),
  route("/contractor/support", "تذاكر الدعم", "contractor_support_tickets", ["ticket_code", "subject", "priority", "status", "created_at"]),
  route("/contractor/verification", "المستندات والتحقق", "contractor_documents", ["document_type", "document_number", "status", "expires_at", "created_at"]),
];

const driverRoutes: RouteConfig[] = [
  {
    path: "/driver",
    title: "لوحة السائق",
    description: "التوصيلات المسندة لهذا السائق فقط وفق RLS.",
    table: "provider_delivery_assignments",
    fields: ["order_id", "status", "pickup_at", "expected_at", "delivered_at", "updated_at"],
    metrics: [
      { label: "التوصيلات المسندة", table: "provider_delivery_assignments" },
      { label: "تحديثات التوصيل", table: "provider_delivery_updates" },
      { label: "تأكيدات التسليم", table: "delivery_confirmation_records" },
    ],
    detail: false,
  },
];

const roleRoutes: Record<AppRole, RouteConfig[]> = {
  admin: adminRoutes,
  provider: providerRoutes,
  customer: customerRoutes,
  contractor: contractorRoutes,
  driver: driverRoutes,
};

const fieldLabels: Record<string, string> = {
  id: "المعرّف",
  created_at: "تاريخ الإنشاء",
  updated_at: "آخر تحديث",
  occurred_at: "وقت الحدث",
  name: "الاسم",
  full_name: "الاسم الكامل",
  display_name: "اسم العرض",
  commercial_name: "الاسم التجاري",
  company_name: "المنشأة",
  project_name: "المشروع",
  title: "العنوان",
  subject: "الموضوع",
  status: "الحالة",
  priority: "الأولوية",
  email: "البريد الإلكتروني",
  mobile: "الجوال",
  city: "المدينة",
  amount: "المبلغ",
  total: "الإجمالي",
  subtotal: "المجموع الفرعي",
  vat: "الضريبة",
  unit_price: "سعر الوحدة",
  payment_status: "حالة الدفع",
  is_active: "نشط",
  is_published: "منشور",
  read_at: "وقت القراءة",
  expected_at: "الموعد المتوقع",
  delivered_at: "وقت التسليم",
};

function resolveRoute(role: AppRole, pathname: string) {
  const routes = roleRoutes[role];
  const exact = routes.find((item) => item.path === pathname);
  if (exact) return { config: exact, detailId: null };

  const parent = [...routes]
    .filter((item) => item.detail && pathname.startsWith(`${item.path}/`))
    .sort((a, b) => b.path.length - a.path.length)[0];
  if (!parent) return { config: routes[0], detailId: null };
  const remainder = pathname.slice(parent.path.length + 1);
  return { config: parent, detailId: remainder && !remainder.includes("/") ? decodeURIComponent(remainder) : null };
}

export function RoleDatabasePortal({ role, children }: { role: AppRole; children?: ReactNode }) {
  const pathname = usePathname();
  const identity = useAuthIdentity();
  const { config, detailId } = useMemo(() => resolveRoute(role, pathname), [pathname, role]);
  const [state, setState] = useState<LoadState>({ loading: true, rows: [], counts: {}, error: null });

  useEffect(() => {
    if (pathname === "/driver/change-password") return;
    let active = true;
    const load = async () => {
      setState({ loading: true, rows: [], counts: {}, error: null });
      const supabase = createClient();
      const metricPromise = Promise.all(
        (config.metrics ?? []).map(async (metric) => {
          const result = await supabase.from(metric.table).select("*", { count: "exact", head: true });
          if (result.error) throw result.error;
          return [metric.label, result.count ?? 0] as const;
        }),
      );

      let dataResult: { data: unknown; error: { message: string } | null } = { data: [], error: null };
      if (config.rpc) {
        dataResult = await supabase.rpc(config.rpc);
      } else if (config.table) {
        let query = supabase.from(config.table).select("*").limit(detailId ? 1 : 100);
        if (detailId) query = query.eq("id", detailId);
        dataResult = await query;
      }

      try {
        const counts = Object.fromEntries(await metricPromise);
        if (dataResult.error) throw dataResult.error;
        const raw = dataResult.data;
        const rows = Array.isArray(raw) ? raw as DataRow[] : raw ? [raw as DataRow] : [];
        if (active) setState({ loading: false, rows, counts, error: null });
      } catch {
        if (active) {
          setState({
            loading: false,
            rows: [],
            counts: {},
            error: "تعذر تحميل البيانات الحقيقية من Supabase. لم يتم عرض أي بيانات بديلة أو وهمية.",
          });
        }
      }
    };
    void load();
    return () => { active = false; };
  }, [config, detailId, pathname]);

  if (pathname === "/driver/change-password") return children;

  const viewer = identity.profile?.fullName ?? identity.profile?.username ?? "مستخدم بُنية";
  return (
    <main className="database-page" data-role={role}>
      <header className="database-page-header">
        <div>
          <p>Supabase · Live Data</p>
          <h1>{detailId ? `تفاصيل ${config.title}` : config.title}</h1>
          <span>{config.description}</span>
        </div>
        <aside><small>الحساب الحالي</small><strong>{viewer}</strong></aside>
      </header>

      {config.metrics?.length ? (
        <section className="database-metrics" aria-label="المؤشرات الحقيقية">
          {config.metrics.map((metric) => (
            <article key={metric.label}>
              <span>{metric.label}</span>
              <strong>{state.loading ? "…" : (state.counts[metric.label] ?? 0).toLocaleString("ar-SA")}</strong>
              <small>حسب صلاحيات RLS</small>
            </article>
          ))}
        </section>
      ) : null}

      {state.loading ? <LoadingState /> : state.error ? <ErrorState message={state.error} /> : state.rows.length === 0 ? (
        <EmptyState message={config.empty ?? "لا توجد بيانات حقيقية مسجلة في هذا القسم حتى الآن."} />
      ) : detailId ? (
        <DetailView row={state.rows[0]} />
      ) : (
        <RowsTable config={config} rows={state.rows} />
      )}
    </main>
  );
}

function RowsTable({ config, rows }: { config: RouteConfig; rows: DataRow[] }) {
  const fields = (config.fields ?? Object.keys(rows[0]).slice(0, 6)).filter((field) => rows.some((row) => field in row));
  return (
    <section className="database-panel">
      <div className="database-panel-heading">
        <div><h2>السجلات</h2><p>{rows.length.toLocaleString("ar-SA")} سجل حقيقي</p></div>
        <span>Live</span>
      </div>
      <div className="database-table-wrap">
        <table>
          <thead><tr>{fields.map((field) => <th key={field}>{fieldLabels[field] ?? humanize(field)}</th>)}{config.detail ? <th>التفاصيل</th> : null}</tr></thead>
          <tbody>{rows.map((row, index) => <tr key={String(row.id ?? index)}>{fields.map((field) => <td key={field}>{formatValue(row[field])}</td>)}{config.detail ? <td>{row.id ? <Link href={`${config.path}/${encodeURIComponent(String(row.id))}`}>فتح السجل</Link> : "—"}</td> : null}</tr>)}</tbody>
        </table>
      </div>
    </section>
  );
}

function DetailView({ row }: { row: DataRow }) {
  return (
    <section className="database-panel database-detail">
      <div className="database-panel-heading"><div><h2>بيانات السجل</h2><p>القيم المسموح بها لهذا الحساب عبر RLS.</p></div><span>DB</span></div>
      <dl>{Object.entries(row).map(([key, value]) => <div key={key}><dt>{fieldLabels[key] ?? humanize(key)}</dt><dd>{formatValue(value)}</dd></div>)}</dl>
    </section>
  );
}

function LoadingState() {
  return <section className="database-state" aria-live="polite"><span className="database-spinner" /><h2>جارٍ تحميل البيانات الحقيقية</h2><p>يتم التحقق من الجلسة وسياسات الوصول.</p></section>;
}

function EmptyState({ message }: { message: string }) {
  return <section className="database-state"><span aria-hidden>∅</span><h2>لا توجد بيانات</h2><p>{message}</p></section>;
}

function ErrorState({ message }: { message: string }) {
  return <section className="database-state database-error" role="alert"><span aria-hidden>!</span><h2>تعذر جلب البيانات</h2><p>{message}</p></section>;
}

function humanize(value: string) {
  return value.replaceAll("_", " ");
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "نعم" : "لا";
  if (typeof value === "number") return value.toLocaleString("ar-SA");
  if (typeof value === "string") {
    const time = Date.parse(value);
    if (/^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(time)) return new Date(time).toLocaleString("ar-SA");
    return value;
  }
  const serialized = JSON.stringify(value);
  return serialized.length > 180 ? `${serialized.slice(0, 177)}…` : serialized;
}
