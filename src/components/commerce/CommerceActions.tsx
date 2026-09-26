/* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
"use client";

import { FormEvent, type ReactNode, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { createClient } from "@/lib/supabase/client";
import { useLocale } from "@/components/i18n/LocaleProvider";
import { intlLocale } from "@/lib/i18n/config";

type Target = {
  sourcing_request_item_id: string;
  response_deadline_at: string;
  product_name: string;
  quantity: number;
  unit_snapshot: string;
  measurement_snapshot: string | null;
  variant_snapshot: string | null;
  item_notes: string | null;
  delivery_region: string;
  required_at: string;
  location_hint: string;
  google_maps_url: string | null;
  delivery_mode: string;
  request_notes: string | null;
  recipient_name: string | null;
  recipient_mobile: string | null;
  site_responsible_name: string | null;
  site_responsible_mobile: string | null;
  contractor_name: string | null;
  contractor_mobile: string | null;
  working_hours: string | null;
  loading_option: string | null;
  unloading_option: string | null;
  road_access: string | null;
  access_instructions: string | null;
  current_lowest_unit_price: number | null;
  current_lowest_landed_cost: number | null;
};

type DeliveryConfirmationResponse = {
  accepted?: boolean;
  notificationDelivered?: boolean;
  message?: string;
  error?: string;
};

async function confirmDeliveryWithNotifications(id: string, code: string) {
  try {
    const response = await fetch(`/api/deliveries/${id}/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    return (await response.json()) as DeliveryConfirmationResponse;
  } catch {
    return { error: "تعذر الاتصال بخدمة تأكيد التسليم. حاول مرة أخرى." };
  }
}

export { CustomerRfqForm, CustomerQuoteDecision } from "@/components/customer/CustomerCommerce";

export function ProviderRfqResponse({ id }: { id: string }) {
  const router = useRouter();
  const [target, setTarget] = useState<Target | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void createClient()
      .rpc("get_provider_rfq_context", { p_sourcing_item_id: id })
      .then(({ data, error }) => {
        if (error) setError(error.message);
        else setTarget(data as unknown as Target);
      });
  }, [id]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const d = new FormData(event.currentTarget);
    const { error } = await createClient().rpc(
      "submit_provider_pricing_response",
      {
        p_sourcing_item_id: id,
        p_response: {
          unit_price: Number(d.get("unit_price")),
          vat_inclusive: d.get("vat_inclusive") === "on",
          available: d.get("available") === "on",
          available_quantity: Number(d.get("available_quantity")),
          preparation_hours: Number(d.get("preparation_hours")),
          delivery_hours: Number(d.get("delivery_hours")),
          delivery_fee: Number(d.get("delivery_fee")),
          region_eligible: d.get("region_eligible") === "on",
          price_expires_at: new Date(
            String(d.get("price_expires_at")),
          ).toISOString(),
          notes: d.get("notes"),
        },
      },
    );
    setBusy(false);
    if (error)
      return setError(
        error.message.includes("Delivery location review required")
          ? "يجب فتح موقع التسليم ومراجعة مسار الوصول ثم تأكيد إمكانية التوصيل قبل إرسال العرض."
          : error.message,
      );
    router.push("/merchant/quotes");
    router.refresh();
  }
  if (error && !target)
    return (
      <main className="database-page">
        <section className="database-state database-error">
          <h1>تعذر فتح الطلب</h1>
          <p>{error}</p>
        </section>
      </main>
    );
  if (!target)
    return (
      <main className="database-page">
        <section className="database-state">
          <p>جارٍ التحميل...</p>
        </section>
      </main>
    );
  return (
    <main className="database-page">
      <header className="database-page-header">
        <div>
          <p>طلب تسعير داخلي</p>
          <h1>{target.product_name || "منتج"}</h1>
          <span>
            آخر موعد للرد:{" "}
            {new Date(target.response_deadline_at).toLocaleString("ar-SA")}
          </span>
        </div>
        <aside>
          <small>أقل عرض واصل حاليًا</small>
          <strong>
            {target.current_lowest_landed_cost === null
              ? "لا يوجد عرض بعد"
              : `${Number(target.current_lowest_landed_cost).toLocaleString("ar-SA")} ر.س`}
          </strong>
          {target.current_lowest_unit_price !== null ? (
            <small>
              سعر الوحدة:{" "}
              {Number(target.current_lowest_unit_price).toLocaleString("ar-SA")}{" "}
              ر.س
            </small>
          ) : null}
        </aside>
      </header>
      <section className="database-panel">
        <dl className="admin-detail-meta">
          <div>
            <dt>الكمية</dt>
            <dd>
              {target.quantity} {target.unit_snapshot}
            </dd>
          </div>
          <div>
            <dt>القياس</dt>
            <dd>{target.measurement_snapshot || "—"}</dd>
          </div>
          <div>
            <dt>الخيارات والفئات</dt>
            <dd>{target.variant_snapshot || "—"}</dd>
          </div>
          <div>
            <dt>طريقة الاستلام</dt>
            <dd>{target.delivery_mode === "pickup" ? "استلام" : "توصيل"}</dd>
          </div>
          <div>
            <dt>وصف مكان التسليم</dt>
            <dd>{target.location_hint || "—"}</dd>
          </div>
          <div>
            <dt>الموعد المطلوب</dt>
            <dd>{new Date(target.required_at).toLocaleString("ar-SA")}</dd>
          </div>
          <div>
            <dt>مواعيد العمل</dt>
            <dd>{target.working_hours || "—"}</dd>
          </div>
          <div>
            <dt>اسم المستلم</dt>
            <dd>{target.recipient_name || "—"}</dd>
          </div>
          <div>
            <dt>جوال المستلم</dt>
            <dd dir="ltr">{target.recipient_mobile || "—"}</dd>
          </div>
          <div>
            <dt>مسؤول الموقع</dt>
            <dd>{target.site_responsible_name || "—"}</dd>
          </div>
          <div>
            <dt>جوال المسؤول</dt>
            <dd dir="ltr">{target.site_responsible_mobile || "—"}</dd>
          </div>
          <div>
            <dt>المقاول</dt>
            <dd>{target.contractor_name || "لا يوجد"}</dd>
          </div>
          <div>
            <dt>جوال المقاول</dt>
            <dd dir="ltr">{target.contractor_mobile || "—"}</dd>
          </div>
          <div>
            <dt>التحميل</dt>
            <dd>{target.loading_option || "—"}</dd>
          </div>
          <div>
            <dt>التنزيل</dt>
            <dd>{target.unloading_option || "—"}</dd>
          </div>
          <div>
            <dt>سهولة الطريق</dt>
            <dd>{target.road_access || "—"}</dd>
          </div>
          <div>
            <dt>تعليمات الوصول</dt>
            <dd>{target.access_instructions || "—"}</dd>
          </div>
          <div>
            <dt>مواصفات المنتج</dt>
            <dd>{target.item_notes || "—"}</dd>
          </div>
          <div>
            <dt>ملاحظات الطلب</dt>
            <dd>{target.request_notes || "—"}</dd>
          </div>
        </dl>
        {target.google_maps_url ? (
          <p>
            <a
              className="customer-card-action"
              href={target.google_maps_url}
              target="_blank"
              rel="noreferrer"
            >
              فتح موقع التسليم في Google Maps
            </a>
          </p>
        ) : null}
        <div className="provider-location-warning" role="alert">
          <strong>راجع الموقع قبل التسعير</strong>
          <p>
            افتح رابط Google Maps وتحقق من مسار الوصول والبوابة وخيارات التنزيل.
            لا تؤكد التوفر أو السعر حتى تتأكد من إمكانية التوصيل للموقع.
          </p>
        </div>
        <p className="customer-success-message">
          هذه البيانات أقر العميل بصحتها ومسؤولية الاستلام قبل إرسال الطلب. سعّر
          التوصيل والتنزيل وفقها.
        </p>
        <form className="application-form" onSubmit={submit}>
          <div className="form-grid">
            <label className="portal-field">
              <span>سعر الوحدة الجديد</span>
              <input
                name="unit_price"
                type="number"
                min="0"
                step="0.01"
                required
              />
            </label>
            <label>
              <input name="vat_inclusive" type="checkbox" /> السعر شامل الضريبة
            </label>
            <label>
              <input name="available" type="checkbox" /> متوفر
            </label>
            <label className="portal-field">
              <span>الكمية المتوفرة</span>
              <input
                name="available_quantity"
                type="number"
                min="0"
                step="0.001"
                required
              />
            </label>
            <label className="portal-field">
              <span>مدة التجهيز بالساعات</span>
              <input name="preparation_hours" type="number" min="0" required />
            </label>
            <label className="portal-field">
              <span>مدة التوصيل بالساعات</span>
              <input name="delivery_hours" type="number" min="0" required />
            </label>
            <label className="portal-field">
              <span>تكلفة التوصيل</span>
              <input
                name="delivery_fee"
                type="number"
                min="0"
                step="0.01"
                required
              />
            </label>
            <label className="provider-location-check">
              <input name="region_eligible" type="checkbox" required /> أؤكد
              أنني راجعت رابط Google Maps وتعليمات الوصول ويمكنني التوصيل للموقع
              بالسعر والمدة المدخلين.
            </label>
            <label className="portal-field">
              <span>صلاحية السعر</span>
              <input name="price_expires_at" type="datetime-local" required />
            </label>
            <label className="portal-field">
              <span>ملاحظات العرض</span>
              <textarea name="notes" />
            </label>
          </div>
          {error ? <p className="portal-form-error">{error}</p> : null}
          <button className="portal-primary-button" disabled={busy}>
            {busy ? "جارٍ الحفظ..." : "إرسال العرض النهائي"}
          </button>
        </form>
      </section>
    </main>
  );
}

export function AdminQuoteAssembly({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function assemble() {
    setBusy(true);
    const { data, error } = await createClient().rpc(
      "assemble_bunya_customer_quote",
      { p_sourcing_request_id: id },
    );
    setBusy(false);
    if (error || !data)
      return setMessage(error?.message || "فشل التجميع وسُجّل تنبيه تشغيلي.");
    router.push(`/admin/bunya-quotes/${data}`);
    router.refresh();
  }
  return (
    <main className="database-page">
      <header className="database-page-header">
        <div>
          <p>إجراء إداري محمي</p>
          <h1>تجميع عرض بُنية</h1>
          <span>يختار المحرك السعر المؤهل ويضيف نسبة ربح كل مزود المعتمدة إلى سعر العميل. العروض الصادرة تحتفظ بأسعارها.</span>
        </div>
      </header>
      <section className="database-panel">
        <p>طلب التوريد: {id}</p>
        {message ? <p className="portal-form-error">{message}</p> : null}
        <button
          className="portal-primary-button"
          disabled={busy}
          onClick={() => void assemble()}
        >
          {busy ? "جارٍ الاختيار والتجميع..." : "اختيار الأسعار وتجميع العرض"}
        </button>
      </section>
    </main>
  );
}

export function AdminOutbox() {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [error, setError] = useState("");
  async function load() {
    const result = await createClient()
      .from("outbox_events")
      .select(
        "id,event_type,status,attempts,next_attempt_at,dead_letter_at,sanitized_error,created_at",
      )
      .order("created_at", { ascending: false })
      .limit(100);
    if (result.error) setError(result.error.message);
    else setRows(result.data ?? []);
  }
  useEffect(() => {
    void load();
  }, []);
  async function retry(id: string) {
    const response = await fetch(`/api/admin/notifications/${id}/retry`, {
      method: "POST",
    });
    const body = (await response.json()) as { message?: string };
    if (!response.ok) setError(body.message || "تعذر إعادة المحاولة");
    else await load();
  }
  return (
    <main className="database-page">
      <header className="database-page-header">
        <div>
          <p>Outbox</p>
          <h1>حالة الإشعارات الحقيقية</h1>
          <span>المحاولات، الجدولة وDead-letter من قاعدة البيانات.</span>
        </div>
      </header>
      {error ? <p className="portal-form-error">{error}</p> : null}
      <section className="database-panel">
        <div className="database-table-wrap">
          <table>
            <thead>
              <tr>
                <th>الحدث</th>
                <th>الحالة</th>
                <th>المحاولات</th>
                <th>الموعد التالي</th>
                <th>الخطأ</th>
                <th>الإجراء</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={String(row.id)}>
                  <td>{String(row.event_type)}</td>
                  <td>{String(row.status)}</td>
                  <td>{String(row.attempts)}</td>
                  <td>
                    {row.next_attempt_at
                      ? new Date(String(row.next_attempt_at)).toLocaleString(
                          "ar-SA",
                        )
                      : "—"}
                  </td>
                  <td>{String(row.sanitized_error || "—")}</td>
                  <td>
                    {["failed", "dead_letter"].includes(String(row.status)) ? (
                      <button onClick={() => void retry(String(row.id))}>
                        إعادة المحاولة
                      </button>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

export function DriverDeliveryConfirmation() {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [code, setCode] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  async function load() {
    const result = await createClient()
      .from("provider_delivery_assignments")
      .select("id,order_id,status,expected_at")
      .order("expected_at");
    setRows(result.data ?? []);
  }
  useEffect(() => {
    void load();
  }, []);
  async function confirm(id: string) {
    const result = await confirmDeliveryWithNotifications(id, code[id] || "");
    setMessage(
      result.error
        ? result.error
        : result.accepted
          ? "تم تأكيد التسليم."
          : result.message ||
            "الرمز غير صحيح أو منتهي أو أن الحالة لا تسمح بالتأكيد.",
    );
    await load();
  }
  return (
    <main className="database-page">
      <header className="database-page-header">
        <div>
          <p>التوصيلات المسندة</p>
          <h1>تأكيد استلام العميل</h1>
          <span>لا يظهر الرمز للسائق؛ يدخله العميل عند الاستلام.</span>
        </div>
      </header>
      {message ? <p>{message}</p> : null}
      <section className="database-panel">
        {rows.length ? (
          rows.map((row) => (
            <article className="database-detail" key={String(row.id)}>
              <p>الطلب: {String(row.order_id)}</p>
              <p>الحالة: {String(row.status)}</p>
              {String(row.status) === "arrived" ? (
                <div>
                  <input
                    aria-label="رمز العميل"
                    inputMode="numeric"
                    value={code[String(row.id)] || ""}
                    onChange={(e) =>
                      setCode((v) => ({
                        ...v,
                        [String(row.id)]: e.target.value,
                      }))
                    }
                  />
                  <button onClick={() => void confirm(String(row.id))}>
                    تأكيد الرمز
                  </button>
                </div>
              ) : null}
            </article>
          ))
        ) : (
          <p>لا توجد توصيلات مسندة.</p>
        )}
      </section>
    </main>
  );
}

export function AdminDeliveryCode({ id }: { id: string }) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function reissue() {
    setBusy(true);
    const response = await fetch(`/api/admin/deliveries/${id}/reissue-code`, {
      method: "POST",
    });
    const body = (await response.json()) as {
      message?: string;
      status?: string;
    };
    setBusy(false);
    setMessage(
      response.ok
        ? `حالة الإرسال: ${body.status}`
        : body.message || "تعذر الإصدار",
    );
  }
  return (
    <main className="database-page">
      <header className="database-page-header">
        <div>
          <p>إجراء محمي</p>
          <h1>إعادة إصدار رمز التسليم</h1>
          <span>
            يبطل الرمز السابق، ولا يُحفظ الرمز الجديد أو يظهر للإدارة.
          </span>
        </div>
      </header>
      <section className="database-panel">
        <p>التوصيل: {id}</p>
        {message ? <p>{message}</p> : null}
        <button
          className="portal-primary-button"
          disabled={busy}
          onClick={() => void reissue()}
        >
          {busy ? "جارٍ الإصدار والإرسال..." : "إصدار رمز جديد وإرساله للعميل"}
        </button>
      </section>
    </main>
  );
}

export function ProviderFulfillment({ id }: { id: string }) {
  const [row, setRow] = useState<Record<string, unknown> | null>(null);
  const [message, setMessage] = useState("");
  async function load() {
    const result = await createClient()
      .from("internal_fulfillment_orders")
      .select(
        "id,fulfillment_code,status,delivery_region,required_at,assigned_value,payment_released_at",
      )
      .eq("id", id)
      .maybeSingle();
    if (result.error) setMessage(result.error.message);
    else setRow(result.data);
  }
  useEffect(() => {
    void load();
  }, [id]);
  async function move(status: "preparing" | "ready") {
    const result = await createClient().rpc("transition_fulfillment_order", {
      p_fulfillment_id: id,
      p_status: status,
      p_note: null,
    });
    setMessage(
      result.error ? result.error.message : "تم تحديث الحالة وتسجيل الحدث.",
    );
    await load();
  }
  if (!row)
    return (
      <main className="database-page">
        <section className="database-state">
          {message || "جارٍ التحميل..."}
        </section>
      </main>
    );
  const status = String(row.status);
  return (
    <main className="database-page">
      <header className="database-page-header">
        <div>
          <p>{String(row.fulfillment_code)}</p>
          <h1>أمر التجهيز</h1>
          <span>ظهر هذا الأمر بعد تحرير الدفع فقط.</span>
        </div>
      </header>
      <section className="database-panel">
        <dl className="admin-detail-meta">
          <div>
            <dt>الحالة</dt>
            <dd>{status}</dd>
          </div>
          <div>
            <dt>المنطقة</dt>
            <dd>{String(row.delivery_region)}</dd>
          </div>
          <div>
            <dt>الموعد</dt>
            <dd>{new Date(String(row.required_at)).toLocaleString("ar-SA")}</dd>
          </div>
          <div>
            <dt>القيمة المسندة</dt>
            <dd>{String(row.assigned_value)}</dd>
          </div>
        </dl>
        {message ? <p>{message}</p> : null}
        {status === "assigned" ? (
          <button
            className="portal-primary-button"
            onClick={() => void move("preparing")}
          >
            بدء التجهيز
          </button>
        ) : status === "preparing" ? (
          <button
            className="portal-primary-button"
            onClick={() => void move("ready")}
          >
            تأكيد الجاهزية
          </button>
        ) : null}
      </section>
    </main>
  );
}

type DriverDetailIconName =
  | "contacts"
  | "calendar"
  | "clock"
  | "handling"
  | "route"
  | "note"
  | "phone"
  | "box"
  | "archive";

function DriverDetailIcon({ name }: { name: DriverDetailIconName }) {
  const paths: Record<DriverDetailIconName, ReactNode> = {
    contacts: (
      <>
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
      </>
    ),
    calendar: (
      <>
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M16 3v4M8 3v4M3 11h18" />
      </>
    ),
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    handling: (
      <>
        <path d="M4 20h16M5 20V9h14v11M8 9V5h8v4M9 13h6M12 13v7" />
      </>
    ),
    route: (
      <>
        <circle cx="6" cy="18" r="2" />
        <circle cx="18" cy="6" r="2" />
        <path d="M8 18h3a3 3 0 0 0 3-3v-6a3 3 0 0 1 3-3" />
      </>
    ),
    note: (
      <>
        <path d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h5" />
      </>
    ),
    phone: (
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.2 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.69 2.8a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.33 1.85.56 2.81.69A2 2 0 0 1 22 16.92z" />
    ),
    box: (
      <>
        <path d="m21 8-9-5-9 5 9 5 9-5Z" />
        <path d="m3 8 9 5 9-5M3 8v8l9 5 9-5V8M12 13v8" />
      </>
    ),
    archive: (
      <>
        <path d="M4 7h16v13H4zM3 3h18v4H3z" />
        <path d="M9 11h6" />
      </>
    ),
  };
  return (
    <svg
      aria-hidden="true"
      className="driver-detail-icon"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
    >
      {paths[name]}
    </svg>
  );
}

export function DriverDeliveryWorkflow() {
  const { locale, t, status: localizedStatus } = useLocale();
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [showCompleted, setShowCompleted] = useState(false);
  async function load() {
    setLoading(true);
    const db = createClient();
    void db.rpc("mark_driver_activity");
    const result = await db.rpc("get_my_driver_deliveries");
    setLoading(false);
    if (result.error) setMessage(result.error.message);
    else setRows(result.data ?? []);
  }
  useEffect(() => {
    void load();
  }, []);
  async function move(
    id: string,
    status: "picked_up" | "in_transit" | "arrived" | "failed_delivery",
  ) {
    setBusyId(id);
    const result = await createClient().rpc("transition_delivery_assignment", {
      p_assignment_id: id,
      p_status: status,
      p_note: null,
    });
    setBusyId("");
    setMessage(
      result.error ? result.error.message : t("deliveryStatusUpdated"),
    );
    await load();
  }
  async function confirm(id: string) {
    const code = (codes[id] || "").replace(/\D/g, "").slice(0, 12);
    if (code.length < 4) return setMessage(t("enterDeliveryCode"));
    setBusyId(id);
    const result = await confirmDeliveryWithNotifications(id, code);
    setBusyId("");
    setMessage(
      result.error
        ? result.error
        : result.accepted
          ? result.message || t("deliveryCompleted")
          : result.message || t("invalidDeliveryCode"),
    );
    await load();
  }
  const completedRows = rows.filter((row) =>
    ["delivered", "failed_delivery"].includes(String(row.delivery_status)),
  );
  const activeRows = rows.filter(
    (row) =>
      !["delivered", "failed_delivery"].includes(
        String(row.delivery_status),
      ),
  );
  return (
    <main className="database-page">
      <header className="database-page-header">
        <div>
          <p>{t("deliveryExecution")}</p>
          <h1>{t("assignedDeliveries")}</h1>
          <span>{t("deliveryTasksCaption")}</span>
        </div>
        <div className="driver-workflow-actions">
          <button
            aria-expanded={showCompleted}
            aria-label={`${t("completedDeliveries")}: ${completedRows.length}`}
            className="driver-archive-button"
            onClick={() => setShowCompleted((current) => !current)}
            title={t("completedDeliveries")}
            type="button"
          >
            <DriverDetailIcon name="archive" />
            {completedRows.length ? <span>{completedRows.length}</span> : null}
          </button>
          <LogoutButton className="driver-workflow-logout">
            <span aria-hidden>↪</span>
            <b>{t("logout")}</b>
          </LogoutButton>
        </div>
      </header>
      {message ? (
        <p className="database-state" role="status">
          {message}
        </p>
      ) : null}
      <section className="database-panel driver-task-list">
        {loading ? (
          <p>{t("loading")}</p>
        ) : activeRows.length ? (
          activeRows.map((row) => {
            const id = String(row.delivery_id),
              status = String(row.delivery_status),
              items = Array.isArray(row.items)
                ? (row.items as Record<string, unknown>[])
                : [];
            const recipientMobile = String(row.recipient_mobile || "").trim();
            const siteMobile = String(row.site_responsible_mobile || "").trim();
            return (
              <details
                className="database-detail driver-delivery-detail"
                key={id}
              >
                <summary className="driver-delivery-heading">
                  <span className="driver-task-icon">
                    <DriverDetailIcon name="box" />
                  </span>
                  <div>
                    <small>{String(row.fulfillment_code || "")}</small>
                    <h2>{String(row.order_code || row.order_id)}</h2>
                    <p>
                      {String(row.recipient_name || "—")} ·{" "}
                      {new Date(String(row.expected_at)).toLocaleString(
                        intlLocale(locale),
                      )}
                    </p>
                  </div>
                  <span>{localizedStatus(status)}</span>
                </summary>
                <div className="driver-delivery-body">
                  <section
                    className="driver-detail-section"
                    aria-labelledby={`contacts-${id}`}
                  >
                    <h3 id={`contacts-${id}`}>
                      <DriverDetailIcon name="contacts" />
                      {t("deliveryContacts")}
                    </h3>
                    <div className="driver-contact-list">
                      <div className="driver-contact-row">
                        <div>
                          <small>{t("recipient")}</small>
                          <strong>{String(row.recipient_name || "—")}</strong>
                          <span dir="ltr">{recipientMobile || "—"}</span>
                        </div>
                        {recipientMobile ? (
                          <a
                            href={`tel:${recipientMobile.replace(/\s+/g, "")}`}
                            aria-label={t("callRecipient")}
                            title={t("callRecipient")}
                          >
                            <DriverDetailIcon name="phone" />
                          </a>
                        ) : null}
                      </div>
                      <div className="driver-contact-row">
                        <div>
                          <small>{t("siteResponsible")}</small>
                          <strong>
                            {String(row.site_responsible_name || "—")}
                          </strong>
                          <span dir="ltr">{siteMobile || "—"}</span>
                        </div>
                        {siteMobile ? (
                          <a
                            href={`tel:${siteMobile.replace(/\s+/g, "")}`}
                            aria-label={t("callSiteResponsible")}
                            title={t("callSiteResponsible")}
                          >
                            <DriverDetailIcon name="phone" />
                          </a>
                        ) : null}
                      </div>
                    </div>
                  </section>
                  <section
                    className="driver-detail-section"
                    aria-labelledby={`site-${id}`}
                  >
                    <h3 id={`site-${id}`}>
                      <DriverDetailIcon name="handling" />
                      {t("siteReadiness")}
                    </h3>
                    <dl className="driver-operation-list">
                      <div className="driver-operation-metrics">
                        <div>
                          <DriverDetailIcon name="calendar" />
                          <dt>{t("deliveryTime")}</dt>
                          <dd>
                            {new Date(String(row.expected_at)).toLocaleString(
                              intlLocale(locale),
                            )}
                          </dd>
                        </div>
                        <div>
                          <DriverDetailIcon name="clock" />
                          <dt>{t("workingHours")}</dt>
                          <dd>{String(row.working_hours || "—")}</dd>
                        </div>
                      </div>
                      <div className="driver-operation-row">
                        <DriverDetailIcon name="handling" />
                        <dt>{t("loadingUnloading")}</dt>
                        <dd>
                          {String(row.loading_option || "—")} ·{" "}
                          {String(row.unloading_option || "—")}
                        </dd>
                      </div>
                      <div className="driver-operation-row">
                        <DriverDetailIcon name="route" />
                        <dt>{t("roadAccess")}</dt>
                        <dd>{String(row.road_access || "—")}</dd>
                      </div>
                      <div className="driver-operation-row">
                        <DriverDetailIcon name="note" />
                        <dt>{t("accessInstructions")}</dt>
                        <dd>{String(row.access_instructions || "—")}</dd>
                      </div>
                    </dl>
                  </section>
                  {items.length ? (
                    <section className="driver-detail-section driver-order-items">
                      <h3>
                        <DriverDetailIcon name="box" />
                        {t("products")}
                      </h3>
                      <div className="driver-order-list">
                        {items.map((item, index) => (
                          <div key={`${id}-${index}`}>
                            <strong>{String(item.product_name || "—")}</strong>
                            <span>
                              {String(item.quantity || "—")}{" "}
                              {String(item.unit_name || "")}
                            </span>
                          </div>
                        ))}
                      </div>
                    </section>
                  ) : null}
                  <div className="driver-delivery-actions">
                    {row.google_maps_url ? (
                      <a
                        className="driver-map-action"
                        href={String(row.google_maps_url)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <DriverDetailIcon name="route" />
                        {t("openGoogleMaps")}
                      </a>
                    ) : null}
                    {status === "assigned" ? (
                      <button
                        className="driver-primary-action"
                        disabled={busyId === id}
                        onClick={() => void move(id, "picked_up")}
                      >
                        {t("pickedUpFromProvider")}
                      </button>
                    ) : status === "picked_up" ? (
                      <button
                        className="driver-primary-action"
                        disabled={busyId === id}
                        onClick={() => void move(id, "in_transit")}
                      >
                        {t("outForDelivery")}
                      </button>
                    ) : status === "in_transit" ? (
                      <button
                        className="driver-primary-action"
                        disabled={busyId === id}
                        onClick={() => void move(id, "arrived")}
                      >
                        {t("arrivedCustomer")}
                      </button>
                    ) : null}
                  </div>
                  {status === "arrived" ? (
                    <div className="customer-delivery-confirm">
                      <strong>{t("customerDeliveryCode")}</strong>
                      <small>{t("deliveryCodeWarning")}</small>
                      <input
                        aria-label={t("customerCode")}
                        autoComplete="one-time-code"
                        dir="ltr"
                        inputMode="numeric"
                        maxLength={12}
                        value={codes[id] || ""}
                        onChange={(e) =>
                          setCodes((v) => ({
                            ...v,
                            [id]: e.target.value.replace(/\D/g, ""),
                          }))
                        }
                      />
                      <button
                        disabled={busyId === id}
                        onClick={() => void confirm(id)}
                      >
                        {t("confirmAndClose")}
                      </button>
                    </div>
                  ) : null}
                  {!["delivered", "failed_delivery"].includes(status) ? (
                    <button
                      className="driver-failure-action"
                      disabled={busyId === id}
                      onClick={() => void move(id, "failed_delivery")}
                    >
                      {t("deliveryFailed")}
                    </button>
                  ) : null}
                </div>
              </details>
            );
          })
        ) : (
          <p>{rows.length ? t("noActiveDeliveries") : t("noAssignedTasks")}</p>
        )}
      </section>
      {showCompleted ? (
        <section className="driver-completed-panel" aria-live="polite">
          <header>
            <div>
              <small>{completedRows.length}</small>
              <h2>{t("completedDeliveries")}</h2>
            </div>
            <button
              aria-label={t("cancel")}
              onClick={() => setShowCompleted(false)}
              type="button"
            >
              ×
            </button>
          </header>
          {completedRows.length ? (
            <div className="driver-completed-list">
              {completedRows.map((row) => {
                const status = String(row.delivery_status);
                return (
                  <article key={String(row.delivery_id)}>
                    <span className="driver-completed-icon">
                      <DriverDetailIcon name="archive" />
                    </span>
                    <div>
                      <strong>{String(row.order_code || row.order_id)}</strong>
                      <small>
                        {String(row.recipient_name || "—")} ·{" "}
                        {new Date(
                          String(row.delivered_at || row.expected_at),
                        ).toLocaleString(intlLocale(locale))}
                      </small>
                    </div>
                    <b>{localizedStatus(status)}</b>
                  </article>
                );
              })}
            </div>
          ) : (
            <p>{t("noCompletedDeliveries")}</p>
          )}
        </section>
      ) : null}
    </main>
  );
}

export function ProviderFulfillmentWorkflow({ id }: { id: string }) {
  const [row, setRow] = useState<Record<string, unknown> | null>(null);
  const [drivers, setDrivers] = useState<Record<string, unknown>[]>([]);
  const [delivery, setDelivery] = useState<Record<string, unknown> | null>(
    null,
  );
  const [driverId, setDriverId] = useState("");
  const [deliveryCode, setDeliveryCode] = useState("");
  const [message, setMessage] = useState("");
  const [confirming, setConfirming] = useState(false);
  async function load() {
    const db = createClient();
    const [f, d, a] = await Promise.all([
      db
        .from("internal_fulfillment_orders")
        .select(
          "id,fulfillment_code,status,delivery_region,required_at,assigned_value,payment_released_at",
        )
        .eq("id", id)
        .maybeSingle(),
      db
        .from("provider_drivers")
        .select("id,full_name,mobile,status")
        .eq("status", "active"),
      db
        .from("provider_delivery_assignments")
        .select(
          "id,status,expected_at,assigned_at,delivered_at,assigned_driver_id,provider_drivers(full_name,mobile)",
        )
        .eq("fulfillment_order_id", id)
        .maybeSingle(),
    ]);
    if (f.error) setMessage(f.error.message);
    else setRow(f.data);
    setDrivers(d.data ?? []);
    if (!a.error) setDelivery(a.data);
  }
  useEffect(() => {
    void load();
  }, [id]);
  async function move(status: "preparing" | "ready") {
    const result = await createClient().rpc("transition_fulfillment_order", {
      p_fulfillment_id: id,
      p_status: status,
      p_note: null,
    });
    setMessage(
      result.error ? result.error.message : "تم تحديث الحالة وتسجيل الحدث.",
    );
    await load();
  }
  async function assign() {
    if (!driverId) {
      setMessage("اختر سائقًا نشطًا أولًا.");
      return;
    }
    const response = await fetch("/api/provider/deliveries/assign-driver", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fulfillmentId: id, driverId }),
    });
    const result = (await response.json()) as {
      message?: string;
      error?: string;
    };
    setMessage(result.message || result.error || "تعذر إكمال إسناد السائق.");
    if (response.ok) setDriverId("");
    await load();
  }
  async function confirmDelivery() {
    const code = deliveryCode.replace(/\D/g, "").slice(0, 12);
    if (code.length < 4 || !delivery?.id) {
      setMessage("أدخل رمز التسليم الذي وصل للعميل.");
      return;
    }
    setConfirming(true);
    setMessage("");
    const result = await confirmDeliveryWithNotifications(
      String(delivery.id),
      code,
    );
    setConfirming(false);
    setMessage(
      result.error
        ? result.error
        : result.accepted
          ? result.message ||
            "تم إثبات التسليم وإغلاق الطلب وإشعار العميل والمزود."
          : result.message || "الرمز غير صحيح أو منتهي أو تم قفل المحاولات.",
    );
    if (result.accepted) setDeliveryCode("");
    await load();
  }
  if (!row)
    return (
      <main className="database-page">
        <section className="database-state">
          {message || "جارٍ التحميل..."}
        </section>
      </main>
    );
  const status = String(row.status);
  const deliveryStatus = String(delivery?.status || "");
  const hasAssignedDriver = Boolean(delivery?.assigned_driver_id);
  const canAssignDriver =
    Boolean(delivery) &&
    ["ready", "out_for_delivery"].includes(status) &&
    !["delivered", "failed_delivery"].includes(deliveryStatus) &&
    (!hasAssignedDriver || deliveryStatus === "assigned");
  return (
    <main className="database-page">
      <header className="database-page-header">
        <div>
          <p>{String(row.fulfillment_code)}</p>
          <h1>أمر التجهيز والتوصيل</h1>
          <span>لا يظهر إلا بعد نجاح الدفع الموثوق.</span>
        </div>
      </header>
      <section className="database-panel">
        <dl className="admin-detail-meta">
          <div>
            <dt>الحالة</dt>
            <dd>{status}</dd>
          </div>
          <div>
            <dt>المنطقة</dt>
            <dd>{String(row.delivery_region)}</dd>
          </div>
          <div>
            <dt>الموعد</dt>
            <dd>{new Date(String(row.required_at)).toLocaleString("ar-SA")}</dd>
          </div>
          <div>
            <dt>القيمة</dt>
            <dd>{String(row.assigned_value)}</dd>
          </div>
        </dl>
        {message ? <p>{message}</p> : null}
        {status === "assigned" ? (
          <button
            className="portal-primary-button"
            onClick={() => void move("preparing")}
          >
            بدء التجهيز
          </button>
        ) : status === "preparing" ? (
          <button
            className="portal-primary-button"
            onClick={() => void move("ready")}
          >
            تأكيد الجاهزية
          </button>
        ) : null}
        {delivery ? (
          <section className="customer-delivery-confirm provider-delivery-confirm">
            <div>
              <strong>التوصيل المرتبط بأمر التوريد</strong>
              <small>
                الحالة: {String(delivery.status)} · الموعد:{" "}
                {new Date(String(delivery.expected_at)).toLocaleString("ar-SA")}
              </small>
            </div>
            <dl className="admin-detail-meta">
              <div>
                <dt>السائق المسند</dt>
                <dd>
                  {String(
                    (delivery.provider_drivers as { full_name?: string } | null)
                      ?.full_name || "لم يُسند سائق",
                  )}
                </dd>
              </div>
              <div>
                <dt>رقم السائق</dt>
                <dd dir="ltr">
                  {String(
                    (delivery.provider_drivers as { mobile?: string } | null)
                      ?.mobile || "—",
                  )}
                </dd>
              </div>
            </dl>
            {canAssignDriver ? (
              <div className="provider-driver-assignment">
                <div>
                  <strong>
                    {hasAssignedDriver
                      ? "تغيير السائق قبل بدء الرحلة"
                      : "إسناد الطلب إلى سائق"}
                  </strong>
                  <small>
                    {hasAssignedDriver
                      ? "يمكن تغيير السائق ما دامت الرحلة لم تبدأ."
                      : "اختر سائقًا نشطًا ليظهر الطلب في بوابته وتصل تفاصيل الإسناد للعميل والسائق."}
                  </small>
                </div>
                {drivers.length ? (
                  <div className="provider-driver-assignment-controls">
                    <select
                      aria-label="اختيار السائق"
                      value={driverId}
                      onChange={(event) => setDriverId(event.target.value)}
                    >
                      <option value="">اختر سائقًا نشطًا</option>
                      {drivers.map((driver) => (
                        <option
                          value={String(driver.id)}
                          key={String(driver.id)}
                        >
                          {String(driver.full_name)} ·{" "}
                          {String(driver.mobile || "")}
                        </option>
                      ))}
                    </select>
                    <button
                      disabled={!driverId}
                      onClick={() => void assign()}
                      type="button"
                    >
                      إسناد السائق
                    </button>
                  </div>
                ) : (
                  <p>
                    لا يوجد سائق نشط. أضف سائقًا، ثم يغيّر كلمة المرور المؤقتة
                    عند أول دخول ليصبح جاهزًا للإسناد.
                  </p>
                )}
                <Link
                  className="provider-driver-manage-link"
                  href="/merchant/drivers"
                >
                  إدارة السائقين وإضافة سائق جديد
                </Link>
              </div>
            ) : null}
            {String(delivery.status) === "arrived" ? (
              <div className="customer-delivery-code-row">
                <input
                  aria-label="رمز التسليم الذي وصل للعميل"
                  autoComplete="one-time-code"
                  dir="ltr"
                  inputMode="numeric"
                  maxLength={12}
                  placeholder="رمز التسليم"
                  value={deliveryCode}
                  onChange={(event) =>
                    setDeliveryCode(event.target.value.replace(/\D/g, ""))
                  }
                />
                <button
                  disabled={confirming}
                  onClick={() => void confirmDelivery()}
                  type="button"
                >
                  {confirming ? "جارٍ التحقق…" : "تأكيد التسليم وإغلاق الطلب"}
                </button>
              </div>
            ) : null}
          </section>
        ) : null}
      </section>
    </main>
  );
}
