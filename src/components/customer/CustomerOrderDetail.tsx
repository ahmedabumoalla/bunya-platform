"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuthIdentity } from "@/components/auth/AuthIdentityProvider";
import { useLocale } from "@/components/i18n/LocaleProvider";
import { CustomerProductImage } from "@/components/customer/CustomerProductImage";
import { intlLocale } from "@/lib/i18n/config";
import { localizedSnapshot } from "@/lib/i18n/content";
import { createClient } from "@/lib/supabase/client";
import styles from "./CustomerOrderDetail.module.css";

export const CUSTOMER_ORDER_DETAIL_SELECT = "id,order_code,customer_quote_id,subtotal,vat_amount,delivery_fee,discount_code,discount_amount,total,payment_status,status,desired_receipt_at,google_maps_url,notes,completed_at,created_at,updated_at,order_items(id,product_id,product_name_snapshot,product_name_translations,quantity,unit_name_snapshot,unit_name_translations,measurement_snapshot,measurement_label_translations,unit_price,line_total),order_status_history(id,to_status,changed_at),invoices(id,invoice_code,status,issued_at,paid_at,total)";

type OrderItem = {
  id: string;
  product_id: string | null;
  product_name_snapshot: string;
  product_name_translations: unknown;
  quantity: number | string;
  unit_name_snapshot: string;
  unit_name_translations: unknown;
  measurement_snapshot: string | null;
  measurement_label_translations: unknown;
  unit_price: number | string;
  line_total: number | string;
};
type OrderHistory = { id: string; to_status: string; changed_at: string };
type OrderInvoice = { id: string; invoice_code: string; status: string; issued_at: string; paid_at: string | null; total: number | string };
type Order = {
  id: string;
  order_code: string;
  customer_quote_id: string | null;
  subtotal: number | string;
  vat_amount: number | string;
  delivery_fee: number | string;
  discount_code: string | null;
  discount_amount: number | string;
  total: number | string;
  payment_status: string;
  status: string;
  desired_receipt_at: string | null;
  google_maps_url: string | null;
  notes: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  order_items: OrderItem[];
  order_status_history: OrderHistory[];
  invoices: OrderInvoice | OrderInvoice[] | null;
};

const orderLabels: Record<string, string> = {
  confirmed: "طلب مؤكد", preparing: "جارٍ التجهيز", ready_for_pickup: "جاهز للاستلام",
  assigned_driver: "تم إسناد سائق", out_for_delivery: "في الطريق إليك", delivered: "تم التسليم",
  completed: "طلب مكتمل", cancelled: "طلب ملغي",
};
const paymentLabels: Record<string, string> = {
  pending: "بانتظار السداد", unpaid: "غير مسدد", awaiting_payment: "بانتظار السداد",
  processing: "جارٍ معالجة الدفع", paid: "تم السداد", succeeded: "تم السداد", failed: "تعذر السداد",
  refunded: "تم استرداد المبلغ", partially_refunded: "استرداد جزئي", cancelled: "دفع ملغي", expired: "انتهت مهلة الدفع",
};
const invoiceLabels: Record<string, string> = { unpaid: "فاتورة غير مسددة", paid: "فاتورة مسددة", refunded: "تم استرداد المبلغ", cancelled: "فاتورة ملغاة" };

function orderMoney(value: unknown, locale: string) {
  if (value === null || value === undefined || value === "" || !Number.isFinite(Number(value))) return "—";
  return new Intl.NumberFormat(locale, { style: "currency", currency: "SAR", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value));
}

function orderDate(value: string | null | undefined, locale: string) {
  if (!value || !Number.isFinite(new Date(value).getTime())) return "غير محدد";
  return new Intl.DateTimeFormat(locale, { calendar: "gregory", dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Riyadh" }).format(new Date(value));
}

function orderMapsDestination(value: string | null) {
  if (!value || /[\\\u0000-\u001f\u007f]/.test(value)) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    const host = url.hostname.toLowerCase();
    const directMapHosts = ["maps.app.goo.gl", "maps.google.com", "maps.google.com.sa"];
    const googleHosts = ["google.com", "www.google.com", "google.com.sa", "www.google.com.sa", "goo.gl"];
    if (!directMapHosts.includes(host) && !(googleHosts.includes(host) && /^\/maps(?:\/|$)/.test(url.pathname))) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function CustomerOrderDetail({ id }: { id: string }) {
  const { userId } = useAuthIdentity();
  const { locale } = useLocale();
  const [result, setResult] = useState<{ key: string; order: Order | null } | null>(null);
  const [error, setError] = useState<{ key: string; message: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const key = `${userId}:${id}`;

  useEffect(() => {
    let active = true;
    void (async () => {
      if (!userId) throw new Error("missing-session");
      const response = await createClient().from("orders").select(CUSTOMER_ORDER_DETAIL_SELECT).eq("id", id).eq("customer_profile_id", userId).maybeSingle();
      if (response.error) throw response.error;
      if (!active) return;
      setResult({ key, order: response.data as Order | null });
      setError(null);
    })().catch(() => {
      if (active) setError({ key, message: userId ? "تعذر تحميل تفاصيل الطلب. تحقق من الاتصال ثم حاول مجددًا." : "يرجى تسجيل الدخول لعرض تفاصيل طلبك." });
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id, key, revision, userId]);

  const order = result?.key === key ? result.order : null;
  const message = error?.key === key ? error.message : "";
  const waiting = loading || (result?.key !== key && !message);
  const refresh = () => { setLoading(true); setError(null); setRevision((current) => current + 1); };

  if (!order) return (
    <main className={styles.page}>
      <Link href="/customer/orders" className={styles.backLink}>العودة إلى طلباتي ←</Link>
      <section className={styles.state} aria-live="polite" aria-busy={waiting}>
        <span className={styles.stateIcon} aria-hidden="true">{waiting ? "…" : "—"}</span>
        <h1>{waiting ? "جارٍ تحميل تفاصيل الطلب…" : message ? "تعذر تحميل الطلب" : "الطلب غير متاح"}</h1>
        <p>{waiting ? "نحضّر تفاصيل المنتجات والدفع والتسليم." : message || "لم نعثر على هذا الطلب ضمن حسابك."}</p>
        {!waiting ? <div className={styles.actions}>{message ? <button className={styles.primaryButton} onClick={refresh}>إعادة المحاولة</button> : null}<Link href="/customer/orders" className={styles.secondaryButton}>عرض جميع الطلبات</Link></div> : null}
      </section>
    </main>
  );

  const money = (value: unknown) => orderMoney(value, intlLocale(locale));
  const date = (value: string | null | undefined) => orderDate(value, intlLocale(locale));
  const history = [...(order.order_status_history ?? [])].sort((a, b) => new Date(a.changed_at).getTime() - new Date(b.changed_at).getTime());
  const items = order.order_items ?? [];
  const invoices = Array.isArray(order.invoices) ? order.invoices : order.invoices ? [order.invoices] : [];
  const mapsUrl = orderMapsDestination(order.google_maps_url);
  const isPaid = ["paid", "succeeded"].includes(order.payment_status);

  return (
    <main className={styles.page} aria-busy={loading}>
      <Link href="/customer/orders" className={styles.backLink}>طلباتي ←</Link>
      <header className={styles.header}>
        <div><p className={styles.eyebrow}>تفاصيل طلبك</p><h1>الطلب <bdi>{order.order_code}</bdi></h1><p>منتجات مشروعك، ومواعيدها، وتفاصيل السداد في مكان واحد.</p></div>
        <div className={styles.badges}><span className={`${styles.badge} ${order.status === "cancelled" ? styles.mutedBadge : ""}`}>{orderLabels[order.status] || "حالة الطلب قيد التحديث"}</span><span className={`${styles.badge} ${isPaid ? styles.paidBadge : styles.paymentBadge}`}>{paymentLabels[order.payment_status] || "حالة الدفع قيد التحديث"}</span></div>
      </header>
      {message ? <p className={styles.error} role="alert">{message} <button disabled={loading} onClick={refresh}>إعادة المحاولة</button></p> : null}
      <dl className={styles.overview}>
        <div><dt>تاريخ الطلب</dt><dd>{date(order.created_at)}</dd></div>
        <div><dt>موعد الاستلام المطلوب</dt><dd>{date(order.desired_receipt_at)}</dd></div>
        <div><dt>{order.completed_at ? "اكتمل الطلب في" : "آخر تحديث"}</dt><dd>{date(order.completed_at || order.updated_at)}</dd></div>
      </dl>
      <div className={styles.layout}>
        <div className={styles.mainColumn}>
          <section className={styles.panel} aria-labelledby="order-products-title">
            <div className={styles.panelHeading}><div><p className={styles.eyebrow}>قائمة المواد</p><h2 id="order-products-title">منتجات الطلب</h2></div><span className={styles.count}>{items.length} منتج</span></div>
            {items.length ? <div className={styles.products}>{items.map((item) => {
              const name = localizedSnapshot(item.product_name_snapshot, item.product_name_translations, locale);
              const unit = localizedSnapshot(item.unit_name_snapshot, item.unit_name_translations, locale);
              const measurement = localizedSnapshot(item.measurement_snapshot, item.measurement_label_translations, locale);
              return <article className={styles.product} key={item.id}>
                <CustomerProductImage productId={item.product_id} name={name} variant="line" className={styles.productImage} />
                <div className={styles.productBody}><h3>{name}</h3>{measurement && measurement !== "—" ? <p>{measurement}</p> : null}<dl className={styles.productNumbers}><div><dt>الكمية</dt><dd>{String(item.quantity)} {unit}</dd></div><div><dt>سعر الوحدة</dt><dd>{money(item.unit_price)}</dd></div><div><dt>إجمالي المنتج</dt><dd>{money(item.line_total)}</dd></div></dl></div>
              </article>;
            })}</div> : <p className={styles.notice}>لا توجد تفاصيل منتجات متاحة لهذا الطلب حاليًا.</p>}
          </section>
          <section className={styles.panel} aria-labelledby="order-delivery-title">
            <div className={styles.panelHeading}><div><p className={styles.eyebrow}>من التجهيز إلى موقعك</p><h2 id="order-delivery-title">التسليم والاستلام</h2></div></div>
            <dl className={styles.deliveryDetails}><div><dt>موعد الاستلام المطلوب</dt><dd>{date(order.desired_receipt_at)}</dd></div><div><dt>حالة الطلب</dt><dd>{orderLabels[order.status] || "قيد التحديث"}</dd></div></dl>
            <p className={styles.supportingText}>جميع المواعيد معروضة بتوقيت الرياض. تابع عمليات التوصيل للاطّلاع على آخر تحديثات الشحنات.</p>
            <div className={styles.actions}>{mapsUrl ? <a className={styles.secondaryButton} href={mapsUrl} target="_blank" rel="noopener noreferrer">موقع التسليم على الخريطة ↗</a> : null}<Link className={styles.secondaryButton} href="/customer/deliveries">متابعة عمليات التوصيل ←</Link></div>
            {order.notes ? <div className={styles.notes}><h3>ملاحظات الطلب</h3><p>{order.notes}</p></div> : null}
          </section>
          <section className={styles.panel} aria-labelledby="order-history-title">
            <div className={styles.panelHeading}><div><p className={styles.eyebrow}>مراحل التنفيذ</p><h2 id="order-history-title">سجل الطلب</h2></div></div>
            {history.length ? <ol className={styles.timeline}>{history.map((entry) => <li key={entry.id}><span className={styles.timelineDot} aria-hidden="true" /><div><h3>{orderLabels[entry.to_status] || "تحديث حالة الطلب"}</h3><time dateTime={entry.changed_at}>{date(entry.changed_at)}</time></div></li>)}</ol> : <p className={styles.notice}>لا توجد تحديثات إضافية مسجلة لهذا الطلب حتى الآن.</p>}
          </section>
        </div>
        <aside className={styles.aside} aria-label="الملخص المالي وروابط الطلب">
          <section className={styles.summary}>
            <p className={styles.eyebrow}>الملخص المالي</p><h2>إجمالي الطلب</h2><strong className={styles.total}>{money(order.total)}</strong><p className={styles.supportingText}>يشمل الضريبة والتوصيل بعد احتساب الخصم.</p>
            <dl className={styles.costs}><div><dt>قيمة المنتجات</dt><dd>{money(order.subtotal)}</dd></div><div><dt>ضريبة القيمة المضافة</dt><dd>{money(order.vat_amount)}</dd></div><div><dt>رسوم التوصيل</dt><dd>{money(order.delivery_fee)}</dd></div><div><dt>الخصم{order.discount_code ? <small>{order.discount_code}</small> : null}</dt><dd>{money(order.discount_amount)}</dd></div><div className={styles.costTotal}><dt>الإجمالي النهائي</dt><dd>{money(order.total)}</dd></div></dl>
            <div className={`${styles.paymentNote} ${isPaid ? styles.paymentSuccess : ""}`}><span>حالة الدفع</span><strong>{paymentLabels[order.payment_status] || "قيد التحديث"}</strong></div>
            <div className={styles.summaryActions}>{order.customer_quote_id ? <Link href={`/customer/quotes/${order.customer_quote_id}`} className={styles.primaryButton}>عرض تفاصيل عرض السعر</Link> : null}<Link href="/customer/billing" className={styles.secondaryButton}>الفواتير والمدفوعات</Link></div>
          </section>
          {invoices.length ? <section className={styles.invoicePanel} aria-label="فاتورة الطلب"><h2>الفاتورة المرتبطة</h2>{invoices.map((invoice) => <div className={styles.invoice} key={invoice.id}><strong><bdi>{invoice.invoice_code}</bdi></strong><span>{invoiceLabels[invoice.status] || "حالة الفاتورة قيد التحديث"}</span><dl><div><dt>قيمة الفاتورة</dt><dd>{money(invoice.total)}</dd></div><div><dt>تاريخ الإصدار</dt><dd>{date(invoice.issued_at)}</dd></div>{invoice.paid_at ? <div><dt>تاريخ السداد</dt><dd>{date(invoice.paid_at)}</dd></div> : null}</dl></div>)}</section> : null}
          <section className={styles.help}><h2>تحتاج مساعدة في طلبك؟</h2><p>تواصل مع فريق الدعم واذكر رقم الطلب لمساعدتك في المتابعة.</p><Link href="/customer/support">التواصل مع الدعم ←</Link></section>
        </aside>
      </div>
    </main>
  );
}
