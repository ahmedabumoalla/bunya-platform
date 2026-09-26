"use client";

import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { LiveDeadline, useLiveNow } from "@/components/commerce/LiveDeadline";
import { useLocale } from "@/components/i18n/LocaleProvider";
import { intlLocale } from "@/lib/i18n/config";
import { localizedSnapshot } from "@/lib/i18n/content";
import { copy as paymentCopy } from "@/components/payments/PaymobCheckout";
import { CustomerProductImage } from "@/components/customer/CustomerProductImage";
import styles from "./CustomerCommerce.module.css";
import { customerMapUrl, customerReadableText } from "@/lib/customer/presentation";

type Product = { id: string; name: string; base_unit: string };

function RfqSection({ number, title, description, children }: {
  number: number;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <fieldset className={styles.section} id={`rfq-section-${number}`}>
      <legend className={styles.sectionLegend}>
        <span className={styles.sectionNumber}>{String(number).padStart(2, "0")}</span>
        <span>{title}</span>
      </legend>
      <p className={styles.sectionDescription}>{description}</p>
      {children}
    </fieldset>
  );
}

function customerMoney(value: unknown, locale: string) {
  if (value === null || value === undefined || value === "" || !Number.isFinite(Number(value))) return "—";
  return new Intl.NumberFormat(locale, {
    style: "currency", currency: "SAR", minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(Number(value));
}

function customerDate(value: unknown, locale: string) {
  if (!value || !Number.isFinite(new Date(String(value)).getTime())) return "—";
  return new Intl.DateTimeFormat(locale, {
    calendar: "gregory", dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Riyadh",
  }).format(new Date(String(value)));
}

export function CustomerRfqForm() {
  const router = useRouter();
  const [products, setProducts] = useState<Product[]>([]);
  const [items, setItems] = useState([
    { product_id: "", quantity: "1", unit: "", measurement: "", notes: "" },
  ]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [productsLoading, setProductsLoading] = useState(true);
  const [productsError, setProductsError] = useState("");
  useEffect(() => {
    let active = true;
    void createClient()
      .from("products")
      .select("id,name,base_unit")
      .eq("is_published", true)
      .eq("review_status", "approved")
      .order("name")
      .then(({ data, error }) => {
        if (!active) return;
        setProductsLoading(false);
        if (error) setProductsError("تعذر تحميل المنتجات. أعد تحميل الصفحة للمحاولة مجددًا.");
        else setProducts((data ?? []) as Product[]);
      });
    return () => { active = false; };
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const data = new FormData(event.currentTarget);
    const siteHoursStart = String(data.get("site_hours_start") || "");
    const siteHoursEnd = String(data.get("site_hours_end") || "");
    if (!siteHoursStart || !siteHoursEnd || siteHoursEnd <= siteHoursStart) {
      setBusy(false);
      setMessage("ساعة نهاية الاستلام يجب أن تكون بعد ساعة البداية.");
      return;
    }
    const draft = {
      version: 1,
      idempotencyKey: crypto.randomUUID(),
      savedAt: new Date().toISOString(),
      items: items.map((item, index) => {
        const product = products.find((p) => p.id === item.product_id);
        return {
          id: `portal-${index}`,
          productId: item.product_id,
          productName: product?.name || "",
          quantity: Number(item.quantity),
          unit: item.unit || product?.base_unit || "وحدة",
          measurementId: "",
          measurementLabel: item.measurement || "بدون قياس إضافي",
          selectedVariants: [],
          desiredReceiptDate: "",
          mapsUrl: "",
          notes: item.notes || undefined,
          createdAt: new Date().toISOString(),
        };
      }),
      details: {
        locationHint: String(data.get("location_hint") || ""),
        mapsUrl: String(data.get("google_maps_url") || ""),
        desiredReceiptAt: new Date(
          String(data.get("desired_receipt_at")),
        ).toISOString(),
        deliveryMode:
          data.get("delivery_mode") === "pickup" ? "pickup" : "delivery",
        projectName: String(data.get("project_name") || ""),
        recipientName: String(data.get("recipient_name") || ""),
        recipientMobile: String(data.get("recipient_mobile") || ""),
        siteResponsibleName: String(data.get("site_responsible_name") || ""),
        siteResponsibleMobile: String(
          data.get("site_responsible_mobile") || "",
        ),
        contractorName: String(data.get("contractor_name") || ""),
        contractorMobile: String(data.get("contractor_mobile") || ""),
        siteHoursStart,
        siteHoursEnd,
        workingHours: `من ${siteHoursStart} إلى ${siteHoursEnd}`,
        loadingOption: String(data.get("loading_option") || ""),
        unloadingOption: String(data.get("unloading_option") || ""),
        roadAccess: String(data.get("road_access") || ""),
        accessInstructions: String(data.get("access_instructions") || ""),
        driverDepartureLiabilityAccepted: data.get("driver_ack") === "on",
        dataAccuracyAccepted: data.get("data_ack") === "on",
        notes: String(data.get("request_notes") || ""),
      },
    };
    try {
      const response = await fetch("/api/customer/quote-requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(draft),
      });
      const body = (await response.json()) as {
        message?: string;
        requestId?: string;
        outsidePricingHours?: boolean;
      };
      setBusy(false);
      if (!response.ok || !body.requestId)
        return setMessage(body.message || "تعذر إرسال الطلب.");
      if (body.outsidePricingHours) {
        setMessage(
          body.message ||
            "تم استلام الطلب خارج أوقات التسعير، وسيتم تزويدك بعرض السعر خلال 24 ساعة.",
        );
        window.setTimeout(() => {
          router.push(`/customer/quote-requests/${body.requestId}`);
          router.refresh();
        }, 2200);
        return;
      }
      router.push(`/customer/quote-requests/${body.requestId}`);
      router.refresh();
    } catch {
      setMessage("تعذر إرسال الطلب. تحقق من الاتصال ثم حاول مجددًا.");
    } finally {
      setBusy(false);
    }
  }
  const selectedItems = items.filter((item) => item.product_id);
  return (
    <main className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <Link href="/customer/quote-requests" className={styles.backLink}>طلبات التسعير ←</Link>
          <p className={styles.eyebrow}>من قائمة المواد إلى عرض واحد</p>
          <h1>طلب عرض سعر جديد</h1>
          <p>حدّد احتياج مشروعك، وسنُرسل طلبك للمزودين للحصول على عرض سعر موحّد.</p>
        </div>
        <span className={styles.headerNote}>٤ خطوات لإكمال طلبك</span>
      </header>
      <nav className={styles.stepNav} aria-label="أقسام طلب عرض السعر">
        {["المنتجات", "التسليم", "التواصل", "المراجعة والإرسال"].map((label, index) => (
          <a href={`#rfq-section-${index + 1}`} key={label}><span>{String(index + 1).padStart(2, "0")}</span>{label}</a>
        ))}
      </nav>
      <div className={styles.layout}>
        <form className={styles.form} onSubmit={submit} aria-busy={busy}>
          <RfqSection number={1} title="المنتجات المطلوبة" description="اختر المنتجات والكميات. أضف القياس والمواصفات لتساعد المزود على تسعير طلبك بدقة.">
            {productsLoading ? <p className={styles.notice} role="status">جارٍ تحميل المنتجات المتاحة…</p> : null}
            {productsError ? <p className={styles.error} role="alert">{productsError}</p> : null}
            {!productsLoading && !productsError && !products.length ? <p className={styles.notice}>لا توجد منتجات متاحة لطلب التسعير حاليًا.</p> : null}
            <div className={styles.productList}>
              {items.map((item, index) => {
                const product = products.find((entry) => entry.id === item.product_id);
                const update = (field: "product_id" | "quantity" | "unit" | "measurement" | "notes", value: string) => {
                  setItems((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, [field]: value } : entry));
                };
                return (
                  <fieldset className={styles.productEditor} key={index}>
                    <legend className={styles.productLegend}>المنتج {index + 1}</legend>
                    <div className={styles.productEditorGrid}>
                      <div className={styles.selectedProduct}>
                        <CustomerProductImage productId={item.product_id || null} name={product?.name || "اختر المنتج لعرض صورته"} variant="tile" className={styles.editorImage} />
                        <strong>{product?.name || "منتجك التالي"}</strong>
                        <small>{product?.base_unit ? `وحدة البيع: ${product.base_unit}` : "اختر من منتجات بُنية المتاحة"}</small>
                      </div>
                      <div className={styles.fields}>
                        <label className={`${styles.field} ${styles.fullWidth}`}>
                          <span>المنتج <small>مطلوب</small></span>
                          <select required value={item.product_id} disabled={productsLoading || !!productsError} onChange={(event) => update("product_id", event.target.value)}>
                            <option value="">اختر المنتج من القائمة</option>
                            {products.map((entry) => <option value={entry.id} key={entry.id}>{entry.name}</option>)}
                          </select>
                        </label>
                        <label className={styles.field}><span>الكمية <small>مطلوبة</small></span><input type="number" min="0.001" step="0.001" required value={item.quantity} onChange={(event) => update("quantity", event.target.value)} inputMode="decimal" /></label>
                        <label className={styles.field}><span>الوحدة</span><input value={item.unit} placeholder={product?.base_unit || "وحدة المنتج الأساسية"} onChange={(event) => update("unit", event.target.value)} /></label>
                        <label className={styles.field}><span>القياس <small>اختياري</small></span><input value={item.measurement} placeholder="مثل الطول أو المقاس" onChange={(event) => update("measurement", event.target.value)} /></label>
                        <label className={styles.field}><span>المواصفات <small>اختيارية</small></span><input value={item.notes} placeholder="أي تفاصيل خاصة بالمنتج" onChange={(event) => update("notes", event.target.value)} /></label>
                        {items.length > 1 ? <button className={styles.removeButton} type="button" aria-label={`حذف المنتج ${index + 1}${product ? `: ${product.name}` : ""}`} onClick={() => setItems((current) => current.filter((_, entryIndex) => entryIndex !== index))}>حذف المنتج</button> : null}
                      </div>
                    </div>
                  </fieldset>
                );
              })}
            </div>
            <button type="button" className={styles.addButton} onClick={() => setItems((current) => [...current, { product_id: "", quantity: "1", unit: "", measurement: "", notes: "" }])}><span aria-hidden="true">＋</span> إضافة منتج آخر</button>
          </RfqSection>
          <RfqSection number={2} title="الموقع وموعد التسليم" description="ثبّت الموقع ووقت الاستلام، ثم وضّح تجهيزات الموقع ومتطلبات الوصول.">
            <div className={styles.fields}>
              <label className={styles.field}><span>طريقة الاستلام</span><select name="delivery_mode"><option value="delivery">توصيل للموقع</option><option value="pickup">استلام من المزود</option></select></label>
              <label className={styles.field}><span>اسم المشروع <small>اختياري</small></span><input name="project_name" placeholder="اسم المشروع أو الموقع" /></label>
              <label className={`${styles.field} ${styles.fullWidth}`}><span>رابط Google Maps <small>مطلوب</small></span><input name="google_maps_url" dir="ltr" type="url" placeholder="https://maps.app.goo.gl/..." required aria-describedby="rfq-map-help" /><small id="rfq-map-help">انسخ رابط الموقع من خرائط Google ليصل المزود إلى العنوان الصحيح.</small></label>
              <label className={styles.field}><span>وصف مكان التسليم <small>مطلوب</small></span><input name="location_hint" placeholder="اسم الموقع، البوابة أو أقرب معلم" required minLength={3} /></label>
              <label className={styles.field}><span>موعد الاستلام المطلوب <small>مطلوب</small></span><input name="desired_receipt_at" type="datetime-local" required /></label>
              <label className={styles.field}><span>بداية استقبال الموقع</span><input defaultValue="07:00" name="site_hours_start" required step="900" type="time" /></label>
              <label className={styles.field}><span>نهاية استقبال الموقع</span><input defaultValue="16:00" name="site_hours_end" required step="900" type="time" /></label>
            </div>
            <div className={styles.subsection}>
              <h3>تجهيزات الموقع والوصول</h3>
              <div className={styles.fields}>
                <label className={styles.field}><span>مسؤولية التحميل</span><select name="loading_option" required defaultValue=""><option value="" disabled>حدد الخيار</option><option>التحميل ضمن مسؤولية المزود</option><option>العميل يوفّر معدات التحميل</option><option>يلزم تنسيق رافعة أو فوركلفت</option></select></label>
                <label className={styles.field}><span>خيار التنزيل</span><select name="unloading_option" required defaultValue=""><option value="" disabled>حدد الخيار</option><option>العميل يوفّر عمال التنزيل</option><option>العميل يوفّر رافعة أو فوركلفت</option><option>مطلوب تضمين التنزيل في العرض</option><option>لا يلزم تنزيل - استلام مباشر</option></select></label>
                <label className={styles.field}><span>سهولة الطريق والوصول</span><select name="road_access" required defaultValue=""><option value="" disabled>حدد حالة الوصول</option><option>سهل ومناسب للشاحنات الكبيرة</option><option>مناسب للشاحنات الصغيرة فقط</option><option>دخول مقيد ويحتاج تنسيقًا مسبقًا</option><option>طريق غير ممهد أو تحت الإنشاء</option></select></label>
                <label className={styles.field}><span>تعليمات الوصول والبوابة</span><input name="access_instructions" required minLength={3} placeholder="رقم البوابة أو آلية السماح بالدخول" /></label>
              </div>
            </div>
          </RfqSection>
          <RfqSection number={3} title="بيانات التواصل والاستلام" description="أضف الأشخاص المعنيين بالاستلام لتسهيل التنسيق عند وصول الطلب.">
            <div className={styles.fields}>
              <label className={styles.field}><span>اسم المستلم <small>مطلوب</small></span><input name="recipient_name" autoComplete="name" required /></label>
              <label className={styles.field}><span>جوال المستلم <small>مطلوب</small></span><input name="recipient_mobile" type="tel" dir="ltr" autoComplete="tel" placeholder="05xxxxxxxx" required /></label>
              <label className={styles.field}><span>اسم مسؤول الموقع <small>مطلوب</small></span><input name="site_responsible_name" required /></label>
              <label className={styles.field}><span>جوال مسؤول الموقع <small>مطلوب</small></span><input name="site_responsible_mobile" type="tel" dir="ltr" placeholder="05xxxxxxxx" required /></label>
              <label className={styles.field}><span>اسم المقاول <small>اختياري</small></span><input name="contractor_name" /></label>
              <label className={styles.field}><span>جوال المقاول <small>اختياري</small></span><input name="contractor_mobile" type="tel" dir="ltr" placeholder="05xxxxxxxx" /></label>
            </div>
          </RfqSection>
          <RfqSection number={4} title="مراجعة الطلب وإرساله" description="راجع المنتجات والبيانات أعلاه، وأضف ما تود أن يعرفه المزود قبل التسعير.">
            {selectedItems.length ? <ul className={styles.reviewList}>{selectedItems.map((item, index) => {
              const product = products.find((entry) => entry.id === item.product_id);
              return <li key={index}><CustomerProductImage productId={item.product_id} name={product?.name || "المنتج"} variant="line" className={styles.reviewImage} /><div><strong>{product?.name}</strong><span>{item.quantity} {item.unit || product?.base_unit || "وحدة"}{item.measurement ? ` · ${item.measurement}` : ""}</span></div></li>;
            })}</ul> : <p className={styles.notice}>ابدأ باختيار منتج في القسم الأول، وسيظهر ملخصه هنا.</p>}
            <label className={styles.field}><span>ملاحظات الطلب <small>اختيارية</small></span><textarea name="request_notes" rows={3} placeholder="أي تفاصيل إضافية تساعد في تجهيز عرض السعر" /></label>
            <div className={styles.acknowledgments}>
              <label><input name="driver_ack" type="checkbox" required /><span>أقر بتحمل المسؤولية الكاملة إذا وصل السائق حسب الموعد والبيانات ثم غادر لعدم وجود مستلم أو تعذر الاستلام من طرفي.</span></label>
              <label><input name="data_ack" type="checkbox" required /><span>أقر بصحة رابط الموقع وبيانات التواصل ومواعيد العمل وخيارات التحميل والتنزيل وتعليمات الوصول.</span></label>
            </div>
            {message ? <p className={styles.notice} role="status">{message}</p> : null}
            <div className={styles.submitRow}>
              <div><strong>جاهز للحصول على عرضك؟</strong><p>يُرسل الطلب بعد اكتمال الحقول المطلوبة والإقرارات.</p></div>
              <button className={styles.primaryButton} disabled={busy || productsLoading || !products.length}>{busy ? "جارٍ إنشاء الطلب…" : "إرسال طلب عرض السعر"}</button>
            </div>
          </RfqSection>
        </form>
        <aside className={styles.aside} aria-label="دليل طلب التسعير">
          <div className={styles.summaryCard}>
            <p className={styles.eyebrow}>طلبك في بُنية</p>
            <div className={styles.summaryCount}><strong>{selectedItems.length}</strong><span>منتج مضاف للتسعير</span></div>
            <p>تُحدّد الأسعار بعد مراجعة المنتجات وكمياتها ومتطلبات التسليم.</p>
            <a href="#rfq-section-4" className={styles.secondaryButton}>مراجعة الطلب</a>
          </div>
          <div className={styles.guide}><h2>متى يصل عرض السعر؟</h2><p>مدة التسعير 3 ساعات للطلبات المرسلة بين 8 صباحًا و4 عصرًا.</p><p>خارج هذه الفترة، يُتاح الطلب للمزودين من 6 صباحًا ويبدأ عداده الساعة 8 صباح اليوم التالي بتوقيت الرياض.</p></div>
        </aside>
      </div>
    </main>
  );
}

export function CustomerQuoteDecision({ id }: { id: string }) {
  const { locale, status: localizedStatus } = useLocale();
  const router = useRouter();
  const now = useLiveNow();
  const [quote, setQuote] = useState<Record<string, unknown> | null>(null);
  const [request, setRequest] = useState<Record<string, unknown> | null>(null);
  const [delivery, setDelivery] = useState<Record<string, unknown> | null>(
    null,
  );
  const [order, setOrder] = useState<Record<string, unknown> | null>(null);
  const [items, setQuoteItems] = useState<Record<string, unknown>[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const db = createClient();
    void (async () => {
      const [q, i, d, o] = await Promise.all([
        db.from("bunya_customer_quotes").select("*").eq("id", id).maybeSingle(),
        db
          .from("bunya_customer_quote_items")
          .select(
            "id,product_id,product_name_snapshot,product_name_translations,quantity,unit_snapshot,unit_name_translations,measurement_snapshot,measurement_label_translations,unit_price,line_total",
          )
          .eq("bunya_customer_quote_id", id),
        db.rpc("get_customer_delivery_tracking", {
          p_customer_quote_id: id,
          p_request_id: null,
        }),
        db
          .from("orders")
          .select("id,payment_status")
          .eq("customer_quote_id", id)
          .maybeSingle(),
      ]);
      if (q.error) setError("تعذر تحميل العرض. أعد تحميل الصفحة للمحاولة مجددًا.");
      else {
        setQuote(q.data);
        if (q.data?.customer_request_id) {
          const details = await db
            .from("quote_requests")
            .select(
              "google_maps_url,location_hint,desired_receipt_at,recipient_name,recipient_mobile,site_responsible_name,site_responsible_mobile,contractor_name,contractor_mobile,working_hours,loading_option,unloading_option,road_access,access_instructions,delivery_details_acknowledged_at",
            )
            .eq("id", q.data.customer_request_id)
            .maybeSingle();
          if (details.error) setError("تعذر تحميل بيانات التسليم. أعد تحميل الصفحة للمحاولة مجددًا.");
          else setRequest(details.data);
        }
      }
      if (!i.error) setQuoteItems(i.data ?? []);
      else setError("تعذر تحميل منتجات العرض. أعد تحميل الصفحة للمحاولة مجددًا.");
      if (!d.error)
        setDelivery(
          (d.data?.[0] as Record<string, unknown> | undefined) ?? null,
        );
      if (!o.error) setOrder(o.data);
    })().catch(() => setError("تعذر تحميل العرض. تحقق من الاتصال ثم أعد المحاولة.")).finally(() => setLoading(false));
  }, [id]);
  async function decide(accept: boolean) {
    setBusy(true);
    setError("");
    try {
      const db = createClient();
      const result = accept
        ? await db.rpc("accept_customer_quote", {
            p_quote_id: id,
            p_idempotency_key: crypto.randomUUID(),
          })
        : await db.rpc("reject_customer_quote", { p_quote_id: id });
      setBusy(false);
      if (result.error)
        return setError(
          result.error.message.includes("delivery details")
            ? "لا يمكن اعتماد العرض قبل اكتمال بيانات التسليم وإقرارات العميل."
            : result.error.message,
        );
      if (accept) router.push(`/customer/quotes/${id}/payment`);
      else router.push("/customer/quotes");
      router.refresh();
    } catch {
      setError("تعذر حفظ قرارك. تحقق من الاتصال ثم حاول مجددًا.");
    } finally {
      setBusy(false);
    }
  }
  if (!quote)
    return (
      <main className={styles.page}>
        <section className={styles.emptyState} aria-live="polite">
          <h1>{loading ? "جارٍ تحميل عرض السعر…" : "عرض السعر غير متاح"}</h1>
          <p>{error || (loading ? "نحضّر تفاصيل المنتجات والتسليم." : "العرض غير متاح أو لا تملك صلاحية الوصول إليه.")}</p>
          {!loading ? <Link href="/customer/quotes" className={styles.secondaryButton}>العودة إلى عروض الأسعار</Link> : null}
        </section>
      </main>
    );
  const expired = new Date(String(quote.valid_until)).getTime() <= now;
  const paid = ["paid", "succeeded"].includes(String(order?.payment_status || "").toLowerCase());
  const reviewable = ["ready", "customer_review"].includes(String(quote.status));
  const money = (value: unknown) => customerMoney(value, intlLocale(locale));
  const date = (value: unknown) => customerDate(value, intlLocale(locale));
  const quoteLabels: Record<string, string> = { preparing: "جارٍ تجهيز العرض", accepted: "تم اعتماد العرض", rejected: "عرض مرفوض", expired: "انتهت الصلاحية" };
  const quoteStatus = reviewable ? (expired ? "انتهت الصلاحية" : "بانتظار قرارك") : quoteLabels[String(quote.status)] || localizedStatus(quote.status);
  return (
    <main className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <Link href="/customer/quotes" className={styles.backLink}>عروض الأسعار ←</Link>
          <p className={styles.eyebrow}>{String(quote.quote_code || "عرض السعر")}</p>
          <h1>عرض بُنية الموحّد</h1>
          <p>كل منتجات طلبك في عرض واحد. راجع التفاصيل ثم تابع إلى اعتماد الطلب.</p>
        </div>
        <span className={`${styles.statusBadge} ${expired && reviewable ? styles.warningBadge : ""}`}>{paid ? "تم السداد" : quoteStatus}</span>
      </header>
      <div className={styles.layout}>
        <div className={styles.form}>
          <section className={styles.panel} aria-labelledby="quote-products-heading">
            <div className={styles.panelHeading}><div><p className={styles.eyebrow}>تفاصيل العرض</p><h2 id="quote-products-heading">المنتجات والكميات</h2></div><span className={styles.itemCount}>{items.length} منتج</span></div>
            <div className={styles.quoteProducts}>
              {items.map((item, index) => {
                const name = localizedSnapshot(item.product_name_snapshot, item.product_name_translations, locale);
                const unit = localizedSnapshot(item.unit_snapshot, item.unit_name_translations, locale);
                const measurement = localizedSnapshot(item.measurement_snapshot, item.measurement_label_translations, locale);
                return (
                  <article key={String(item.id || index)} className={styles.quoteProduct}>
                    <CustomerProductImage productId={String(item.product_id || "")} name={name} variant="line" className={styles.quoteImage} />
                    <div className={styles.quoteProductBody}>
                      <h3>{name}</h3>
                      {measurement && measurement !== "—" ? <p>{measurement}</p> : null}
                      <dl className={styles.productNumbers}>
                        <div><dt>الكمية</dt><dd>{String(item.quantity)} {unit}</dd></div>
                        <div><dt>سعر الوحدة</dt><dd>{money(item.unit_price)}</dd></div>
                        <div className={styles.lineTotal}><dt>إجمالي المنتج</dt><dd>{money(item.line_total)}</dd></div>
                      </dl>
                    </div>
                  </article>
                );
              })}
              {!items.length ? <p className={styles.notice}>{loading ? "جارٍ تحميل المنتجات…" : "لا توجد منتجات متاحة للعرض حاليًا."}</p> : null}
            </div>
            {quote.terms ? <div className={styles.subsection}><h3>شروط العرض</h3><p className={styles.quoteTerms}>{customerReadableText(quote.terms)}</p></div> : null}
          </section>
          {request ? (
            <section className={styles.panel} aria-labelledby="quote-delivery-heading">
              <div className={styles.panelHeading}><div><p className={styles.eyebrow}>بيانات طلبك المعتمدة</p><h2 id="quote-delivery-heading">التسليم والاستلام</h2></div></div>
              <dl className={styles.detailsGrid}>
                <div><dt>مكان التسليم</dt><dd>{String(request.location_hint || "—")}</dd></div>
                <div><dt>موعد الاستلام · بتوقيت الرياض</dt><dd>{date(request.desired_receipt_at)}</dd></div>
                <div><dt>المستلم</dt><dd>{String(request.recipient_name || "—")}<span dir="ltr">{String(request.recipient_mobile || "—")}</span></dd></div>
                <div><dt>مسؤول الموقع</dt><dd>{String(request.site_responsible_name || "—")}<span dir="ltr">{String(request.site_responsible_mobile || "—")}</span></dd></div>
                <div><dt>المقاول</dt><dd>{String(request.contractor_name || "لا يوجد")}{request.contractor_mobile ? <span dir="ltr">{String(request.contractor_mobile)}</span> : null}</dd></div>
                <div><dt>مواعيد العمل</dt><dd>{String(request.working_hours || "—")}</dd></div>
                <div><dt>التحميل</dt><dd>{String(request.loading_option || "—")}</dd></div>
                <div><dt>التنزيل</dt><dd>{String(request.unloading_option || "—")}</dd></div>
                <div><dt>سهولة الطريق</dt><dd>{String(request.road_access || "—")}</dd></div>
                <div><dt>تعليمات الوصول</dt><dd>{String(request.access_instructions || "—")}</dd></div>
              </dl>
              {customerMapUrl(request.google_maps_url) ? <a className={styles.secondaryButton} href={customerMapUrl(request.google_maps_url)!} target="_blank" rel="noreferrer">فتح موقع التسليم في Google Maps ↗</a> : null}
              <p className={request.delivery_details_acknowledged_at ? styles.success : styles.notice}>{request.delivery_details_acknowledged_at ? "تم تسجيل إقرار مسؤولية الاستلام وصحة هذه البيانات." : "بيانات التسليم أو الإقرارات غير مكتملة؛ لن يسمح النظام بالاعتماد."}</p>
            </section>
          ) : null}
          {delivery ? (
            <section className={styles.panel} aria-labelledby="quote-tracking-heading">
              <div className={styles.panelHeading}><div><p className={styles.eyebrow}>{String(delivery.order_code)}</p><h2 id="quote-tracking-heading">متابعة التوصيل</h2></div><span className={styles.statusBadge}>{localizedStatus(delivery.delivery_status)}</span></div>
              <dl className={styles.detailsGrid}>
                <div><dt>السائق المسند</dt><dd>{String(delivery.driver_name || "لم يُسند سائق بعد")}</dd></div>
                <div><dt>رقم السائق</dt><dd>{delivery.driver_mobile ? <a dir="ltr" href={`tel:${String(delivery.driver_mobile)}`}>{String(delivery.driver_mobile)}</a> : "يظهر بعد الإسناد"}</dd></div>
                <div><dt>موعد الوصول المتوقع</dt><dd>{date(delivery.expected_at)}</dd></div>
                <div><dt>آخر تحديث</dt><dd>{date(delivery.latest_update_at)}</dd></div>
              </dl>
              {String(delivery.delivery_status) === "arrived" ? <CustomerDeliveryCode key={String(delivery.delivery_id)} deliveryId={String(delivery.delivery_id)} /> : <p className={styles.notice}>سيظهر رمز التسليم هنا عند وصول السائق إلى الموقع.</p>}
            </section>
          ) : null}
        </div>
        <aside className={styles.aside} aria-label="ملخص المبلغ وقرار العرض">
          <section className={styles.summaryCard}>
            <p className={styles.eyebrow}>ملخص عرض السعر</p>
            <h2>إجمالي طلبك</h2>
            <strong className={styles.quoteTotal}>{money(quote.total)}</strong>
            <p>شامل الضريبة ورسوم التوصيل الموضحة.</p>
            <dl className={styles.costBreakdown}>
              <div><dt>قيمة المنتجات</dt><dd>{money(quote.subtotal)}</dd></div>
              <div><dt>ضريبة القيمة المضافة</dt><dd>{money(quote.vat_amount)}</dd></div>
              <div><dt>التوصيل</dt><dd>{money(quote.delivery_fee)}</dd></div>
              <div className={styles.totalRow}><dt>الإجمالي</dt><dd>{money(quote.total)}</dd></div>
            </dl>
            {reviewable ? <div className={styles.validity}><LiveDeadline target={String(quote.valid_until)} label="المتبقي لاعتماد العرض" expiredLabel="انتهت صلاحية العرض" tone="warning" /><p>العرض صالح لمدة 48 ساعة من إصداره. لا يمكن اعتماده بعد انتهاء المهلة.</p></div> : <p className={styles.validityDate}>صلاحية العرض حتى {date(quote.valid_until)}</p>}
            {error ? <p className={styles.error} role="alert">{error}</p> : null}
            <div className={styles.decisionActions} aria-busy={busy}>
              {reviewable ? <>
                <button className={styles.primaryButton} disabled={busy || expired || !request?.delivery_details_acknowledged_at} onClick={() => void decide(true)}>{busy ? "جارٍ حفظ القرار…" : expired ? "انتهت صلاحية العرض" : "قبول ومتابعة الدفع"}</button>
                <button className={styles.secondaryButton} disabled={busy} onClick={() => void decide(false)}>رفض العرض</button>
                {!request?.delivery_details_acknowledged_at ? <p>يلزم اكتمال بيانات التسليم والإقرارات لاعتماد العرض.</p> : null}
              </> : <>
                {String(quote.status) === "accepted" && !paid ? <Link className={styles.primaryButton} href={`/customer/quotes/${id}/payment`}>{paymentCopy[locale].pay}</Link> : null}
                {paid ? <p className={styles.success}>تم السداد بنجاح وتحديث الطلب.</p> : <p>الحالة الحالية: {quoteStatus}</p>}
              </>}
            </div>
          </section>
        </aside>
      </div>
    </main>
  );
}

function CustomerDeliveryCode({ deliveryId }: { deliveryId: string }) {
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    void fetch(`/api/customer/deliveries/${deliveryId}/code`, {
      cache: "no-store",
    })
      .then(async (response) => {
        const body = (await response.json()) as {
          code?: string;
          error?: string;
        };
        if (!response.ok || !body.code)
          throw new Error(body.error || "رمز التسليم غير متاح حاليًا.");
        if (active) setCode(body.code);
      })
      .catch((error: unknown) => {
        if (active)
          setMessage(
            error instanceof Error ? error.message : "تعذر تحميل رمز التسليم.",
          );
      });
    return () => {
      active = false;
    };
  }, [deliveryId]);

  if (message)
    return <p className={styles.error} role="alert">{message}</p>;
  return (
    <div className={styles.deliveryCode} aria-live="polite">
      <div>
        <strong>رمز التسليم الخاص بك</strong>
        <small>
          لا تسلّمه للسائق أو المزود إلا بعد استلام كامل البضاعة ومراجعتها.
        </small>
      </div>
      {code ? (
        <div className={styles.deliveryCodeValue}>
          <code dir="ltr">{code}</code>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard
                .writeText(code)
                .then(() => setCopied(true))
                .catch(() => setMessage("تعذر نسخ الرمز. يمكنك نسخه يدويًا."));
            }}
          >
            {copied ? "تم النسخ ✓" : "نسخ الرمز"}
          </button>
        </div>
      ) : (
        <span className={styles.notice}>
          جارٍ تحميل الرمز الآمن…
        </span>
      )}
    </div>
  );
}
