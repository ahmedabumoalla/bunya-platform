/* eslint-disable react-hooks/set-state-in-effect, @typescript-eslint/no-explicit-any, @next/next/no-img-element */
"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useAuthIdentity } from "@/components/auth/AuthIdentityProvider";
import { createClient } from "@/lib/supabase/client";
import {
  PricingWindow,
  pricingWindowState,
  useLiveNow,
} from "@/components/commerce/LiveDeadline";
import { signProductImageMap } from "@/lib/products/image-urls";
import styles from "./ProviderWorkspace.module.css";
import { useLocale } from "@/components/i18n/LocaleProvider";
import { intlLocale } from "@/lib/i18n/config";
import { localizedSnapshot } from "@/lib/i18n/content";
import { RequestedProductDetails } from "@/components/commerce/RequestedProductDetails";
import { policyForAudience, policyParagraphs, type PolicyAudience } from "@/lib/policies/registry";

type Row = Record<string, any>;
const db = createClient();
const money = (value: unknown) =>
  new Intl.NumberFormat("ar-SA", { style: "currency", currency: "SAR" }).format(
    Number(value || 0),
  );
const date = (value: unknown) =>
  value
    ? new Date(String(value)).toLocaleString("ar-SA", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "—";
const labels: Record<string, string> = {
  assigned: "مسند",
  preparing: "قيد التجهيز",
  ready: "جاهز",
  handed_to_driver: "سُلّم للسائق",
  delivered: "تم التسليم",
  cancelled: "ملغي",
  evaluating: "قيد التقييم",
  selected: "مختار",
  not_selected: "غير مختار",
  needs_update: "يحتاج تعديل",
  expired: "منتهي",
  pending_review: "تحت المراجعة",
  approved: "معتمد",
  transferring: "قيد التحويل",
  transferred: "تم التحويل",
  rejected: "مرفوض",
  available: "متاح",
  settled: "مسوّى",
  pending: "معلق",
  reversed: "معكوس",
  open: "مفتوح",
  read: "مقروء",
};
const status = (value: unknown) =>
  labels[String(value)] || String(value || "—");
function Shell({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className={styles.workspace}>
      <header className={styles.hero}>
        <div className={styles.heroContent}>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
      </header>
      {children}
    </div>
  );
}
function Empty({
  text,
  action,
  href,
}: {
  text: string;
  action?: string;
  href?: string;
}) {
  return (
    <div className={styles.empty}>
      <p>{text}</p>
      {action && href ? (
        <Link className={styles.primary} href={href}>
          {action}
        </Link>
      ) : null}
    </div>
  );
}
function ErrorBox({ value }: { value: string }) {
  return value ? <div className={styles.error} role="alert">{value}</div> : null;
}

export function ProviderQuoteRequests() {
  const identity = useAuthIdentity(),
    providerId = identity.details.provider?.providerId,
    [rows, setRows] = useState<Row[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const now = useLiveNow();
  useEffect(() => {
    if (!providerId) return;
    void (async () => {
      const result = await db.rpc("get_my_provider_rfq_list");
      if (result.error) setError(result.error.message);
      else {
        const values = (Array.isArray(result.data) ? result.data : []) as Row[];
        const signed = await signProductImageMap(
          db,
          values.map((row) => String(row.product_image_storage_path || "")),
          { width: 480, height: 360, quality: 72 },
        );
        setRows(
          values.map((row) => ({
            ...row,
            signed_image_url:
              signed.get(String(row.product_image_storage_path || "")) ||
              row.product_image_url ||
              "",
          })),
        );
      }
      setLoading(false);
    })();
  }, [providerId]);
  if (loading)
    return (
      <Shell
        title="طلبات التحقق والتسعير"
        description="جارٍ تحميل الطلبات الموجهة لمنشأتك…"
      >
        <div className={styles.loading} role="status">جارٍ تحميل طلبات التسعير…</div>
      </Shell>
    );
  return (
    <Shell
      title="طلبات التحقق والتسعير"
      description="كل بطاقة تمثل منتجًا واحدًا تستطيع منشأتك توفيره؛ ليس مطلوبًا منك تسعير بقية منتجات طلب العميل."
    >
      <div className={styles.policyNotice}>
        <b>نافذة التسعير</b>
        <span>
          3 ساعات للطلبات بين 8 ص و4 م. الطلبات خارجها تُفتح للمعاينة من 6 ص
          ويبدأ عدادها 8 ص بتوقيت الرياض.
        </span>
      </div>
      <ErrorBox value={error} />
      {rows.length ? (
        <div className={styles.cards}>
          {rows.map((row) => {
            const window = pricingWindowState(
                row.pricing_opens_at,
                row.pricing_countdown_starts_at,
                row.response_deadline_at,
                now,
              ),
              answered = Boolean(row.existing_response_code);
            return (
              <article
                className={`${styles.card} ${styles.rfqCard}`}
                key={row.sourcing_request_item_id}
              >
                <div className={styles.rfqImage}>
                  {row.signed_image_url ? (
                    <img src={row.signed_image_url} alt={row.product_name} />
                  ) : (
                    <span>لا توجد صورة</span>
                  )}
                </div>
                <div className={styles.rfqBody}>
                  <div className={styles.cardHead}>
                    <div>
                      <small>{row.internal_code || row.request_code}</small>
                      <b>{row.product_name || "منتج مطلوب"}</b>
                    </div>
                    <span className={styles.badge}>
                      {answered
                        ? row.can_revise
                          ? "متاح تخفيض السعر"
                          : "تم حفظ عرضك"
                        : window.kind === "closed"
                          ? "انتهت المهلة"
                          : window.kind === "locked"
                            ? "يفتح لاحقًا"
                            : "متاح للتسعير"}
                    </span>
                  </div>
                  <div className={styles.row}>
                    <strong>
                      {row.quantity} {row.unit_snapshot}
                    </strong>
                    {row.product_sku ? (
                      <span>SKU: {row.product_sku}</span>
                    ) : null}
                    {row.measurement_snapshot ? (
                      <span>القياس: {row.measurement_snapshot}</span>
                    ) : null}
                    <span>الاستلام {date(row.required_at)}</span>
                  </div>
                  <RequestedProductDetails snapshot={row} />
                  <div className={styles.priceSignal}>
                    <span>{answered ? "سعر وحدتك المحفوظ" : "أقل سعر وحدة من مزود آخر حتى الآن"}</span>
                    <strong>
                      {answered
                        ? money(row.existing_unit_price)
                        : row.current_lowest_unit_price == null
                        ? "لا يوجد عرض منافس بعد"
                        : money(row.current_lowest_unit_price)}
                    </strong>
                  </div>
                  {answered && row.current_lowest_unit_price != null ? <p className={styles.itemOnly}>أقل سعر وحدة من مزود آخر: <b>{money(row.current_lowest_unit_price)}</b>{row.can_revise ? " · يمكنك تخفيض عرضك الآن." : ""}</p> : null}
                  <p className={styles.itemOnly}>
                    سعّر هذا المنتج فقط إذا كان متوفرًا لديك؛ لا يلزم توفير كامل
                    منتجات طلب العميل.
                  </p>
                  <PricingWindow
                    opensAt={row.pricing_opens_at}
                    startsAt={row.pricing_countdown_starts_at}
                    deadlineAt={row.response_deadline_at}
                    compact
                  />
                  {window.canSubmit || answered ? (
                    <Link
                      className={styles.primary}
                      href={`/merchant/quote-requests/${row.sourcing_request_item_id}`}
                    >
                      {answered
                        ? "عرض السعر المقدم"
                        : "مراجعة الموقع وإدخال السعر"}
                    </Link>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <Empty
          text="لا توجد طلبات تسعير موجهة لمنشأتك الآن. عند مطابقة أحد منتجاتك مع طلب عميل سيظهر المنتج هنا تلقائيًا."
          action="إدارة المنتجات"
          href="/merchant/products"
        />
      )}
    </Shell>
  );
}

export function ProviderQuotes() {
  const { locale } = useLocale();
  const identity = useAuthIdentity(),
    providerId = identity.details.provider?.providerId,
    [rows, setRows] = useState<Row[]>([]),
    [error, setError] = useState("");
  useEffect(() => {
    if (!providerId) return;
    void (async () => {
      const r = await db
        .from("provider_pricing_responses")
        .select(
          "id,response_code,sourcing_request_item_id,unit_price,vat_inclusive,price_expires_at,status,evaluation_notes,created_at,internal_sourcing_request_items(quantity,unit_snapshot,delivery_region,quote_request_items(product_name_snapshot,product_name_translations,unit_name_snapshot,unit_name_translations))",
        )
        .eq("provider_id", providerId)
        .order("created_at", { ascending: false });
      if (r.error) setError(r.error.message);
      else setRows(r.data || []);
    })();
  }, [providerId]);
  return (
    <Shell
      title="استجابات التسعير"
      description="سجل عروضك الفعلية ونتيجة التقييم وصلاحية كل سعر."
    >
      <ErrorBox value={error} />
      {rows.length ? (
        <div className={styles.cards}>
          {rows.map((row) => (
            <article className={styles.card} key={row.id}>
              <div className={styles.cardHead}>
                <b>{row.response_code}</b>
                <span className={styles.badge} data-status={row.status}>{status(row.status)}</span>
              </div>
              <div className={styles.row}>
                <span>
                  {localizedSnapshot(
                    row.internal_sourcing_request_items?.quote_request_items?.product_name_snapshot,
                    row.internal_sourcing_request_items?.quote_request_items?.product_name_translations,
                    locale,
                  )}
                </span>
                <strong>
                  {new Intl.NumberFormat(intlLocale(locale), { style: "currency", currency: "SAR" }).format(Number(row.unit_price || 0))} /{" "}
                  {localizedSnapshot(
                    row.internal_sourcing_request_items?.quote_request_items?.unit_name_snapshot ?? row.internal_sourcing_request_items?.unit_snapshot,
                    row.internal_sourcing_request_items?.quote_request_items?.unit_name_translations,
                    locale,
                  )}
                </strong>
                <span>
                  {row.vat_inclusive ? "شامل الضريبة" : "غير شامل الضريبة"}
                </span>
              </div>
              <small>صالح حتى {date(row.price_expires_at)}</small>
              {row.evaluation_notes ? <p>{row.evaluation_notes}</p> : null}
              <Link
                className={styles.secondary}
                href={`/merchant/quote-requests/${row.sourcing_request_item_id}`}
              >
                عرض الطلب وتحديث الرد
              </Link>
            </article>
          ))}
        </div>
      ) : (
        <Empty
          text="لم تُرسل منشأتك استجابة تسعير بعد. افتح الطلبات الواردة وأرسل أول عرض."
          action="عرض طلبات التسعير"
          href="/merchant/quote-requests"
        />
      )}
    </Shell>
  );
}

export function ProviderOrders() {
  const identity = useAuthIdentity(),
    providerId = identity.details.provider?.providerId,
    [rows, setRows] = useState<Row[]>([]),
    [error, setError] = useState("");
  useEffect(() => {
    if (!providerId) return;
    void (async () => {
      const r = await db
        .from("internal_fulfillment_orders")
        .select(
          "id,fulfillment_code,delivery_region,required_at,assigned_value,status,created_at",
        )
        .eq("provider_id", providerId)
        .order("created_at", { ascending: false });
      if (r.error) setError(r.error.message);
      else setRows(r.data || []);
    })();
  }, [providerId]);
  const active = rows.filter(
    (x) => !["delivered", "cancelled"].includes(x.status),
  ).length;
  return (
    <Shell
      title="أوامر التوريد"
      description="تابع الأوامر المسندة وحدّث التجهيز والتسليم من صفحة كل أمر."
    >
      <ErrorBox value={error} />
      {rows.length ? (
        <>
          <div className={styles.metrics}>
            <div className={styles.metric}>
              الأوامر النشطة<b>{active}</b>
            </div>
            <div className={styles.metric}>
              إجمالي قيمة الإسناد
              <b>
                {money(
                  rows.reduce((s, r) => s + Number(r.assigned_value || 0), 0),
                )}
              </b>
            </div>
            <div className={styles.metric}>
              مكتملة<b>{rows.filter((r) => r.status === "delivered").length}</b>
            </div>
          </div>
          <div className={styles.cards}>
            {rows.map((row) => (
              <article className={styles.card} key={row.id}>
                <div className={styles.cardHead}>
                  <b>{row.fulfillment_code}</b>
                  <span className={styles.badge} data-status={row.status}>{status(row.status)}</span>
                </div>
                <div className={styles.row}>
                  <span>{row.delivery_region}</span>
                  <strong>{money(row.assigned_value)}</strong>
                  <span>المطلوب: {date(row.required_at)}</span>
                </div>
                <Link
                  className={styles.primary}
                  href={`/merchant/orders/${row.id}`}
                >
                  فتح أمر التوريد
                </Link>
              </article>
            ))}
          </div>
        </>
      ) : (
        <Empty
          text="لا توجد أوامر توريد مسندة الآن. تظهر هنا تلقائيًا بعد اختيار عرضك وسداد العميل."
          action="متابعة عروض الأسعار"
          href="/merchant/quotes"
        />
      )}
    </Shell>
  );
}

export function ProviderNotifications() {
  const identity = useAuthIdentity(),
    [rows, setRows] = useState<Row[]>([]),
    [filter, setFilter] = useState("all"),
    [error, setError] = useState("");
  const load = useCallback(async () => {
    const r = await db
      .from("notifications")
      .select("id,title,message,action_url,read_at,created_at,type")
      .eq("profile_id", identity.userId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (r.error) setError(r.error.message);
    else setRows(r.data || []);
  }, [identity.userId]);
  useEffect(() => {
    void load();
  }, [load]);
  const shown = filter === "unread" ? rows.filter((r) => !r.read_at) : rows;
  const markAll = async () => {
    await db
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("profile_id", identity.userId)
      .is("read_at", null);
    await load();
  };
  return (
    <Shell
      title="الإشعارات"
      description="تنبيهات الطلبات والتسعير والتوصيل والدعم المرتبطة بحسابك."
    >
      <ErrorBox value={error} />
      <div className={styles.row}>
        <div className={styles.tabs}>
          <button
            className={`${styles.tab} ${filter === "all" ? styles.tabActive : ""}`}
            onClick={() => setFilter("all")}
          >
            الكل ({rows.length})
          </button>
          <button
            className={`${styles.tab} ${filter === "unread" ? styles.tabActive : ""}`}
            onClick={() => setFilter("unread")}
          >
            غير المقروء ({rows.filter((r) => !r.read_at).length})
          </button>
        </div>
        <button className={styles.secondary} onClick={() => void markAll()}>
          تحديد الكل كمقروء
        </button>
      </div>
      {shown.length ? (
        <div className={styles.cards}>
          {shown.map((row) => (
            <article className={styles.card} key={row.id}>
              <div className={styles.cardHead}>
                <b>{row.title}</b>
                {!row.read_at ? (
                  <span className={styles.badge}>جديد</span>
                ) : null}
              </div>
              <p>{row.message}</p>
              <div className={styles.row}>
                <small>{date(row.created_at)}</small>
                {row.action_url ? (
                  <Link className={styles.secondary} href={row.action_url}>
                    فتح
                  </Link>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <Empty
          text={
            filter === "unread"
              ? "اطلعت على جميع إشعاراتك."
              : "لا توجد إشعارات بعد. ستظهر هنا تحديثات التسعير والأوامر والدعم تلقائيًا."
          }
        />
      )}
    </Shell>
  );
}

export function ProviderFinance() {
  const identity = useAuthIdentity(),
    providerId = identity.details.provider?.providerId,
    [transactions, setTransactions] = useState<Row[]>([]),
    [banks, setBanks] = useState<Row[]>([]),
    [settlements, setSettlements] = useState<Row[]>([]),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    if (!providerId) return;
    const [t, b, s] = await Promise.all([
      db
        .from("financial_transactions")
        .select("*")
        .eq("provider_id", providerId)
        .order("created_at", { ascending: false }),
      db
        .from("provider_bank_accounts")
        .select(
          "id,bank_name,account_holder_name,iban_last4,is_verified,is_primary,is_active,created_at",
        )
        .eq("provider_id", providerId)
        .order("created_at", { ascending: false }),
      db
        .from("settlement_requests")
        .select(
          "id,settlement_code,amount,status,notes,admin_notes,created_at,transferred_at",
        )
        .eq("provider_id", providerId)
        .order("created_at", { ascending: false }),
    ]);
    const failed = [t, b, s].find((x) => x.error);
    if (failed?.error) setError(failed.error.message);
    setTransactions(t.data || []);
    setBanks(b.data || []);
    setSettlements(s.data || []);
  }, [providerId]);
  useEffect(() => {
    void load();
  }, [load]);
  const balance = Number(transactions[0]?.balance_after || 0),
    reserved = settlements
      .filter((s) =>
        ["pending_review", "approved", "transferring"].includes(s.status),
      )
      .reduce((n, s) => n + Number(s.amount), 0),
    available = Math.max(0, balance - reserved);
  const submit = async (e: FormEvent<HTMLFormElement>, action: string) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(e.currentTarget),
      body = Object.fromEntries(form);
    try {
      const r = await fetch("/api/provider/finance", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...body, action }),
        }),
        p = await r.json();
      if (!r.ok) throw new Error(p.error);
      setMessage(
        action === "bank"
          ? "أضيف الحساب وبانتظار اعتماد الإدارة."
          : "تم إرسال طلب الصرف للمراجعة.",
      );
      e.currentTarget.reset();
      await load();
    } catch (x) {
      setError(x instanceof Error ? x.message : "تعذر التنفيذ");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Shell
      title="المالية والتسويات"
      description="لوحة مالية حقيقية تعرض الرصيد والحركات والحسابات البنكية وطلبات الصرف."
    >
      <ErrorBox value={error} />
      {message ? <div className={styles.message} role="status">{message}</div> : null}
      <div className={styles.metrics}>
        <div className={styles.metric}>
          الرصيد الدفتري<b>{money(balance)}</b>
        </div>
        <div className={styles.metric}>
          محجوز للتسوية<b>{money(reserved)}</b>
        </div>
        <div className={styles.metric}>
          متاح للصرف<b>{money(available)}</b>
        </div>
        <div className={styles.metric}>
          تم تحويله
          <b>
            {money(
              settlements
                .filter((s) => s.status === "transferred")
                .reduce((n, s) => n + Number(s.amount), 0),
            )}
          </b>
        </div>
      </div>
      <div className={styles.grid}>
        <section className={styles.panel}>
          <h2>إضافة حساب بنكي</h2>
          <p className={styles.muted}>أضف بيانات الحساب، ثم تابع حالة اعتماده أدناه.</p>
          <form
            className={styles.form}
            onSubmit={(e) => void submit(e, "bank")}
          >
            <label>
              البنك
              <input required name="bankName" />
            </label>
            <label>
              اسم صاحب الحساب
              <input required name="accountHolderName" />
            </label>
            <label className={styles.wide}>
              رقم الآيبان
              <input
                required
                name="iban"
                dir="ltr"
                placeholder="SA00 0000 0000 0000 0000 0000"
              />
            </label>
            <button className={styles.primary} disabled={busy}>
              حفظ وإرسال للاعتماد
            </button>
          </form>
          <div className={styles.cards}>
            {banks.map((b) => (
              <div className={styles.card} key={b.id}>
                <div className={styles.row}>
                  <b>
                    {b.bank_name} •••• {b.iban_last4}
                  </b>
                  <span className={styles.badge}>
                    {b.is_verified ? "معتمد" : "بانتظار الاعتماد"}
                  </span>
                </div>
                <small>
                  {b.account_holder_name}
                  {b.is_primary ? " · الحساب الرئيسي" : ""}
                </small>
                {b.is_active && !b.is_primary ? (
                  <button
                    className={styles.secondary}
                    onClick={async () => {
                      await fetch("/api/provider/finance", {
                        method: "POST",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify({ action: "primary", id: b.id }),
                      });
                      await load();
                    }}
                  >
                    تعيين رئيسي
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        </section>
        <section className={styles.panel}>
          <h2>طلب صرف</h2>
          <p className={styles.muted}>اختر حسابًا معتمدًا وحدد مبلغًا ضمن رصيدك المتاح.</p>
          <form
            className={styles.form}
            onSubmit={(e) => void submit(e, "settlement")}
          >
            <label>
              المبلغ
              <input
                required
                name="amount"
                type="number"
                min="1"
                max={available}
                step="0.01"
              />
            </label>
            <label>
              الحساب
              <select required name="bankAccountId" defaultValue="">
                <option value="" disabled>
                  اختر حسابًا معتمدًا
                </option>
                {banks
                  .filter((b) => b.is_active && b.is_verified)
                  .map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.bank_name} •••• {b.iban_last4}
                    </option>
                  ))}
              </select>
            </label>
            <label className={styles.wide}>
              ملاحظات
              <textarea name="notes" rows={3} />
            </label>
            <button
              className={styles.primary}
              disabled={busy || available <= 0}
            >
              إرسال طلب الصرف
            </button>
          </form>
          <div className={styles.cards}>
            {settlements.map((s) => (
              <div className={styles.card} key={s.id}>
                <div className={styles.row}>
                  <b>{s.settlement_code}</b>
                  <strong>{money(s.amount)}</strong>
                  <span className={styles.badge} data-status={s.status}>{status(s.status)}</span>
                </div>
                <small>{date(s.created_at)}</small>
                {s.admin_notes ? <p>{s.admin_notes}</p> : null}
              </div>
            ))}
          </div>
        </section>
      </div>
      <section className={styles.panel}>
        <h2>الحركات المالية</h2>
        {transactions.length ? (
          <div className={styles.tableWrap} tabIndex={0} role="region" aria-label="سجل الحركات المالية">
            <table className={styles.table} aria-label="الحركات المالية">
              <thead>
                <tr>
                  <th>المرجع</th>
                  <th>النوع</th>
                  <th>المبلغ</th>
                  <th>الرصيد</th>
                  <th>الحالة</th>
                  <th>التاريخ</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((t) => (
                  <tr key={t.id}>
                    <td>{t.transaction_code}</td>
                    <td>{status(t.type)}</td>
                    <td>{money(t.amount)}</td>
                    <td>{money(t.balance_after)}</td>
                    <td>{status(t.status)}</td>
                    <td>{date(t.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty text="لا توجد حركات مالية بعد. تُسجل الحركة تلقائيًا عند اكتمال أوامر التوريد والتسويات." />
        )}
      </section>
    </Shell>
  );
}

export function ProviderPolicies({ audience = "provider" }: { audience?: PolicyAudience }) {
  const [rows, setRows] = useState<Row[]>([]),
    [selected, setSelected] = useState<Row | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    void (async () => {
      const r = await db
        .from("platform_policies")
        .select(
          "id,policy_key,title,summary,body,version,published_at,updated_at",
        )
        .eq("is_published", true)
        .order("published_at", { ascending: false });
      if (r.error) setError(r.error.message);
      else {
        const policies = (r.data ?? []).filter(policy => policyForAudience(policy.policy_key, audience));
        setRows(policies);
        setSelected(policies[0] || null);
      }
    })();
  }, [audience]);
  const body = useMemo(() => policyParagraphs(selected?.body).join("\n\n"), [selected]);
  return (
    <Shell
      title="السياسات"
      description="آخر النسخ المنشورة من الإدارة، وتظهر هنا فور نشرها."
    >
      <ErrorBox value={error} />
      <nav className={styles.policyLinks} aria-label="الوثائق الأساسية"><Link href="/terms">شروط الاستخدام</Link><Link href="/privacy">الخصوصية</Link><Link href={`/policies?audience=${audience}`}>مركز السياسات</Link></nav>
      {rows.length ? (
        <div className={styles.policyLayout}>
          <section className={styles.policyList} aria-label="السياسات المنشورة">
            <p className={styles.sectionEyebrow}>الوثائق المنشورة · {rows.length}</p>
            <div className={styles.policyChoices}>
              {rows.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`${styles.policyChoice} ${selected?.id === p.id ? styles.policyChoiceActive : ""}`}
                  aria-pressed={selected?.id === p.id}
                  aria-controls="workspace-policy-content"
                  onClick={() => setSelected(p)}
                >
                  <b>{p.title}</b>
                  <span>{p.summary}</span>
                  <small>
                    الإصدار {p.version} · {date(p.published_at)}
                  </small>
                </button>
              ))}
            </div>
          </section>
          <article className={`${styles.panel} ${styles.policyArticle}`} id="workspace-policy-content" aria-live="polite">
            <p className={styles.sectionEyebrow}>الإصدار {selected?.version} · {date(selected?.published_at)}</p>
            <h2>{selected?.title}</h2>
            <p className={styles.muted}>{selected?.summary}</p>
            <div className={styles.policyBody}>{body}</div>
          </article>
        </div>
      ) : (
        <Empty text="لا توجد سياسة منشورة حاليًا. ستظهر السياسات هنا فور نشرها من الإدارة." />
      )}
    </Shell>
  );
}

function ProfileSection({ id, title, description, children }: { id: string; title: string; description: string; children: React.ReactNode }) {
  return <fieldset className={styles.profileSection} id={id}><legend>{title}</legend><p className={styles.sectionDescription}>{description}</p><div className={styles.sectionFields}>{children}</div></fieldset>;
}

function ProfileInput({ label, name, value, type = "text", required = false }: { label: string; name: string; value: string; type?: string; required?: boolean }) {
  return <label>{label}<input name={name} type={type} required={required} defaultValue={value} dir={type === "email" || type === "url" ? "ltr" : "auto"}/></label>;
}

export function ProviderProfile() {
  const identity = useAuthIdentity(),
    providerId = identity.details.provider?.providerId,
    [data, setData] = useState<Row>({}),
    [docs, setDocs] = useState<Row[]>([]),
    [logo, setLogo] = useState(""),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    if (!providerId) return;
    const [p, pr, d] = await Promise.all([
      db.from("providers").select("*").eq("id", providerId).single(),
      db
        .from("provider_profiles")
        .select("*")
        .eq("provider_id", providerId)
        .maybeSingle(),
      db
        .from("provider_documents")
        .select("*")
        .eq("provider_id", providerId)
        .order("created_at", { ascending: false }),
    ]);
    if (p.error || pr.error || d.error) {
      setError(p.error?.message || pr.error?.message || d.error?.message || "");
      return;
    }
    setData({ ...p.data, ...pr.data });
    setDocs(d.data || []);
    if (p.data.logo_path) {
      const signed = await db.storage
        .from("provider-logos")
        .createSignedUrl(p.data.logo_path, 600);
      setLogo(signed.data?.signedUrl || "");
    }
  }, [providerId]);
  useEffect(() => {
    void load();
  }, [load]);
  const save = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    const f = new FormData(e.currentTarget);
    f.set("action", "save");
    f.set("deliveryAvailable", String(f.get("deliveryAvailable") === "on"));
    try {
      const r = await fetch("/api/provider/profile", {
          method: "POST",
          body: f,
        }),
        p = await r.json();
      if (!r.ok) throw new Error(p.error);
      setMessage("تم حفظ بيانات المنشأة وإرسال التغييرات للمراجعة.");
      await load();
    } catch (x) {
      setError(x instanceof Error ? x.message : "تعذر الحفظ");
    } finally {
      setBusy(false);
    }
  };
  const upload = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    const form = e.currentTarget;
    const f = new FormData(form);
    f.set("action", "document");
    try {
      const r = await fetch("/api/provider/profile", {
          method: "POST",
          body: f,
        }),
        p = await r.json();
      if (!r.ok) throw new Error(p.error);
      setMessage("تم رفع المستند للمراجعة.");
      form.reset();
      await load();
    } catch (x) {
      setError(x instanceof Error ? x.message : "تعذر الرفع");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Shell
      title="ملف المنشأة"
      description="بيانات تعريف المنشأة وعنوانها الوطني وسجلاتها ومستندات الإثبات."
    >
      <ErrorBox value={error} />
      <section className={styles.profileOverview} aria-label="ملخص المنشأة">
        <div className={styles.profileIdentity}>
          {logo ? <img className={styles.logo} src={logo} alt="شعار المنشأة"/> : <div className={`${styles.logo} ${styles.logoPlaceholder}`} aria-hidden="true">{String(data.company_name || "ب").trim().slice(0, 1)}</div>}
          <div><p className={styles.sectionEyebrow}>ملف المنشأة</p><h2>{data.company_name || "بيانات منشأتك"}</h2><p className={styles.muted}>{data.contact_name || "التعريف والتواصل والمستندات في مكان واحد"}</p></div>
        </div>
        <dl className={styles.profileFacts}>
          <div><dt>المدينة</dt><dd>{data.city || "غير مضافة"}</dd></div>
          <div><dt>خدمة التوصيل</dt><dd>{data.delivery_available ? "متوفرة" : "غير متوفرة"}</dd></div>
          <div><dt>مستندات الإثبات</dt><dd>{docs.length} مستند</dd></div>
        </dl>
      </section>
      <nav className={styles.sectionNav} aria-label="أقسام ملف المنشأة">
        <a href="#provider-identity">التعريف</a><a href="#provider-contact">التواصل</a><a href="#provider-legal">السجلات</a><a href="#provider-address">العنوان</a><a href="#provider-documents">المستندات</a>
      </nav>
      <form className={`${styles.panel} ${styles.profileForm}`} onSubmit={(e) => void save(e)} aria-busy={busy}>
        <ProfileSection id="provider-identity" title="التعريف بالمنشأة" description="الاسم والشعار والمعلومات التي تعرّف بمنشأتك على المنصة.">
          <ProfileInput name="companyName" label="اسم المنشأة" value={data.company_name || ""} required/>
          <ProfileInput name="username" label="اسم المستخدم العام" value={data.username || ""}/>
          <ProfileInput name="websiteUrl" label="الموقع الإلكتروني" type="url" value={data.website_url || ""}/>
          <label>تحديث الشعار<input name="logo" type="file" accept="image/png,image/jpeg,image/webp"/><small className={styles.fieldHint}>PNG أو JPEG أو WebP</small></label>
          <label className={styles.wide}>نبذة المنشأة<textarea name="publicDescription" rows={4} defaultValue={data.public_description || ""}/></label>
        </ProfileSection>
        <ProfileSection id="provider-contact" title="معلومات التواصل" description="بيانات المسؤول ووسائل التواصل المرتبطة بالمنشأة.">
          <ProfileInput name="contactName" label="اسم المسؤول" value={data.contact_name || ""} required/>
          <ProfileInput name="mobile" label="الجوال" value={data.mobile || ""} required/>
          <ProfileInput name="email" label="البريد الإلكتروني" type="email" value={data.email || ""} required/>
        </ProfileSection>
        <ProfileSection id="provider-legal" title="السجلات والتعريف" description="أرقام التسجيل الرسمية للمنشأة.">
          <ProfileInput name="commercialRegistrationNumber" label="رقم السجل التجاري" value={data.commercial_registration_number || ""}/>
          <ProfileInput name="vatNumber" label="الرقم الضريبي" value={data.vat_number || ""}/>
        </ProfileSection>
        <ProfileSection id="provider-address" title="العنوان الوطني والتوصيل" description="تفاصيل موقع المنشأة وعنوانها المسجّل.">
          <ProfileInput name="nationalAddressShortCode" label="العنوان المختصر" value={data.national_address_short_code || ""}/>
          <ProfileInput name="buildingNumber" label="رقم المبنى" value={data.building_number || ""}/>
          <ProfileInput name="streetName" label="الشارع" value={data.street_name || ""}/>
          <ProfileInput name="district" label="الحي" value={data.district || ""}/>
          <ProfileInput name="city" label="المدينة" value={data.city || ""}/>
          <ProfileInput name="region" label="المنطقة" value={data.region || ""}/>
          <ProfileInput name="postalCode" label="الرمز البريدي" value={data.postal_code || ""}/>
          <ProfileInput name="secondaryNumber" label="الرقم الفرعي" value={data.secondary_number || ""}/>
          <ProfileInput name="country" label="الدولة" value={data.country || "السعودية"}/>
          <ProfileInput name="googleMapsUrl" label="رابط خرائط Google" type="url" value={data.google_maps_url || ""}/>
          <label className={`${styles.wide} ${styles.checkboxField}`}><input name="deliveryAvailable" type="checkbox" defaultChecked={Boolean(data.delivery_available)}/><span>المنشأة توفر التوصيل</span></label>
        </ProfileSection>
        <footer className={styles.saveBar}><p>تُرسل التغييرات للمراجعة بعد الحفظ.</p><button className={styles.primary} disabled={busy}>{busy ? "جارٍ الحفظ…" : "حفظ ملف المنشأة"}</button></footer>
      </form>
      {message ? <div className={styles.message} role="status">{message}</div> : null}
      <section className={`${styles.panel} ${styles.documentSection}`} id="provider-documents" aria-labelledby="provider-documents-title">
        <h2 id="provider-documents-title">مستندات الإثبات</h2>
        <p className={styles.muted}>أرفق مستندات منشأتك وتابع حالة مراجعتها وتواريخ انتهائها.</p>
        <form className={styles.form} onSubmit={(e) => void upload(e)}>
          <label>
            نوع المستند
            <select name="documentType">
              <option value="commercial_registration">السجل التجاري</option>
              <option value="vat_certificate">شهادة الضريبة</option>
              <option value="national_address">العنوان الوطني</option>
              <option value="bank_certificate">شهادة الآيبان</option>
              <option value="license">ترخيص</option>
              <option value="other">مستند آخر</option>
            </select>
          </label>
          <label>
            رقم المستند
            <input name="documentNumber" />
          </label>
          <label>
            تاريخ الانتهاء
            <input name="expiresAt" type="date" />
          </label>
          <label>
            الملف
            <input
              required
              name="file"
              type="file"
              accept="application/pdf,image/png,image/jpeg,image/webp"
            />
          </label>
          <button className={styles.primary} disabled={busy}>
            رفع للمراجعة
          </button>
        </form>
        {docs.length ? (
          <div className={styles.tableWrap} tabIndex={0} role="region" aria-label="سجل مستندات المنشأة">
            <table className={styles.table} aria-label="مستندات الإثبات">
              <thead>
                <tr>
                  <th>المستند</th>
                  <th>الرقم</th>
                  <th>الحالة</th>
                  <th>الانتهاء</th>
                  <th>الرفع</th>
                </tr>
              </thead>
              <tbody>
                {docs.map((d) => (
                  <tr key={d.id}>
                    <td>{d.file_name}</td>
                    <td>{d.document_number || "—"}</td>
                    <td><span className={styles.badge} data-status={d.status}>{status(d.status)}</span></td>
                    <td>{d.expires_at || "—"}</td>
                    <td>{date(d.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty text="لم ترفع منشأتك مستندات إثبات بعد." />
        )}
      </section>
    </Shell>
  );
}
