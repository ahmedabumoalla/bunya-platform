/* eslint-disable @next/next/no-img-element */
"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { signProductImage } from "@/lib/products/image-urls";
import { createClient } from "@/lib/supabase/client";
import { PricingWindow, pricingWindowState, useLiveNow } from "./LiveDeadline";
import styles from "./ProviderRfqResponse.module.css";

type Target = {
  sourcing_request_item_id: string;
  request_code: string | null;
  internal_code: string | null;
  response_deadline_at: string;
  pricing_opens_at: string;
  pricing_countdown_starts_at: string;
  product_name: string;
  product_sku: string | null;
  product_description: string | null;
  product_image_storage_path: string | null;
  product_image_url: string | null;
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
  current_lowest_unit_price: number | null;
  current_lowest_landed_cost: number | null;
};
type Existing = {
  id: string;
  response_code: string;
  status: string;
  unit_price: number;
  vat_inclusive: boolean;
  price_expires_at: string;
  notes: string | null;
  available: boolean;
  available_quantity: number;
  region_eligible: boolean;
  preparation_hours: number;
  delivery_hours: number;
  delivery_fee: number;
  submitted_at: string;
  revision_count: number;
  revision_deadline_at: string | null;
  current_competitor_unit_price: number | null;
  current_competitor_landed_cost: number | null;
  can_revise: boolean;
};
const format = (value: string) =>
  new Date(value).toLocaleString("ar-SA", {
    dateStyle: "medium",
    timeStyle: "short",
  });
const localDate = (date: Date) =>
  new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
const amount = (value: number) =>
  `${Number(value).toLocaleString("ar-SA", { maximumFractionDigits: 2 })} ر.س`;

export function ProviderRfqResponse({ id }: { id: string }) {
  const router = useRouter(),
    [target, setTarget] = useState<Target | null>(null),
    [existing, setExisting] = useState<Existing | null>(null),
    [image, setImage] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [price, setPrice] = useState(""),
    [deliveryFee, setDeliveryFee] = useState("0"),
    [vatInclusive, setVatInclusive] = useState(true),
    [priceWindow, setPriceWindow] = useState({ min: "", max: "", initial: "" });
  const now = useLiveNow();
  useEffect(() => {
    const db = createClient();
    let active = true;
    const load = async () => {
      const [context, response] = await Promise.all([
        db.rpc("get_provider_rfq_context", { p_sourcing_item_id: id }),
        db.rpc("get_my_provider_rfq_response", { p_sourcing_item_id: id }),
      ]);
      if (!active) return;
      if (context.error) {
        setError(context.error.message);
        return;
      }
      const value = context.data as unknown as Target,
        current = new Date(),
        maximum = new Date(current),
        initial = new Date(value.response_deadline_at);
      maximum.setHours(maximum.getHours() + 72);
      initial.setHours(initial.getHours() + 48);
      setPriceWindow({
        min: localDate(initial),
        max: localDate(maximum),
        initial: localDate(initial),
      });
      const saved = (response.data as unknown as Existing | null) || null;
      setTarget(value);
      setExisting(saved);
      if (saved?.can_revise) {
        setPrice(String(saved.unit_price));
        setDeliveryFee(String(saved.delivery_fee));
        setVatInclusive(saved.vat_inclusive);
      }
      setImage(
        await signProductImage(
          db,
          value.product_image_storage_path,
          value.product_image_url || "",
          { width: 720, height: 720, quality: 72 },
        ),
      );
    };
    void load();
    const poll = window.setInterval(() => void load(), 30000);
    return () => {
      active = false;
      window.clearInterval(poll);
    };
  }, [id]);
  const totals = useMemo(() => {
    const subtotal = Number(price || 0) * Number(target?.quantity || 0),
      vat = vatInclusive ? 0 : subtotal * 0.15,
      total = subtotal + vat + Number(deliveryFee || 0);
    return { subtotal, vat, total };
  }, [price, deliveryFee, vatInclusive, target?.quantity]);
  const submittedTotals = useMemo(() => {
    const subtotal =
        Number(existing?.unit_price || 0) * Number(target?.quantity || 0),
      vat = existing?.vat_inclusive ? 0 : subtotal * 0.15,
      total = subtotal + vat + Number(existing?.delivery_fee || 0);
    return { subtotal, vat, total };
  }, [existing, target?.quantity]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (existing && !existing.can_revise) return;
    setBusy(true);
    setError("");
    if (
      existing?.can_revise &&
      existing.current_competitor_landed_cost !== null &&
      totals.total >= existing.current_competitor_landed_cost
    ) {
      setBusy(false);
      setError("يجب أن يكون إجمالي عرضك الجديد شامل الضريبة والتوصيل أقل من السعر المنافس الحالي.");
      return;
    }
    const d = new FormData(event.currentTarget),
      result = await createClient().rpc(existing ? "revise_provider_pricing_response" : "submit_provider_pricing_response", {
        p_sourcing_item_id: id,
        p_response: {
          unit_price: Number(d.get("unit_price")),
          vat_inclusive: d.get("vat_inclusive") === "on",
          available: existing ? existing.available : d.get("available") === "on",
          available_quantity: Number(d.get("available_quantity") ?? existing?.available_quantity),
          preparation_hours: Number(d.get("preparation_hours") ?? existing?.preparation_hours),
          delivery_hours: Number(d.get("delivery_hours") ?? existing?.delivery_hours),
          delivery_fee: Number(d.get("delivery_fee")),
          region_eligible: existing ? true : d.get("region_eligible") === "on",
          price_expires_at: new Date(
            String(d.get("price_expires_at")),
          ).toISOString(),
          notes: d.get("notes"),
        },
      });
    setBusy(false);
    if (result.error) {
      setError(result.error.message);
      return;
    }
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
          <p>جارٍ تحميل بيانات الطلب...</p>
        </section>
      </main>
    );
  const windowState = pricingWindowState(
    target.pricing_opens_at,
    target.pricing_countdown_starts_at,
    target.response_deadline_at,
    now,
  );
  return (
    <main className={`database-page ${styles.page}`}>
      <header className={styles.header}>
        <div>
          <p>{existing ? "عرض السعر محفوظ" : "طلب تسعير موجّه لمنشأتك"}</p>
          <h1>{existing ? "تفاصيل العرض المقدم" : "راجع الطلب وقدّم السعر"}</h1>
        </div>
        {existing ? (
          <div className={styles.deadline}>
            <span>تم تقديم العرض</span>
            <strong>{format(existing.submitted_at)}</strong>
          </div>
        ) : (
          <PricingWindow
            opensAt={target.pricing_opens_at}
            startsAt={target.pricing_countdown_starts_at}
            deadlineAt={target.response_deadline_at}
          />
        )}
      </header>
      <div className={styles.layout}>
        <div className={styles.panel}>
          <section className={styles.product}>
            <div className={styles.image}>
              {image ? (
                <img src={image} alt={target.product_name} />
              ) : (
                <div className={styles.placeholder}>لا توجد صورة للمنتج</div>
              )}
            </div>
            <div className={styles.productInfo}>
              <div className={styles.codes}>
                <span>{target.request_code || "—"}</span>
                <span>{target.internal_code || "—"}</span>
                {target.product_sku ? (
                  <span>SKU: {target.product_sku}</span>
                ) : null}
              </div>
              <h2>{target.product_name}</h2>
              <p>
                {target.product_description ||
                  "منتج معتمد ومطلوب تسعيره حسب البيانات التالية."}
              </p>
              <div className={styles.grid}>
                <div className={styles.field}>
                  <span>الكمية المطلوبة</span>
                  <strong>
                    {target.quantity} {target.unit_snapshot}
                  </strong>
                </div>
                <div className={styles.field}>
                  <span>القياس</span>
                  <strong>
                    {target.measurement_snapshot || "بدون قياس إضافي"}
                  </strong>
                </div>
                <div className={styles.field}>
                  <span>الخيارات والفئات</span>
                  <strong>{target.variant_snapshot || "بدون خيارات إضافية"}</strong>
                </div>
                <div className={styles.field}>
                  <span>موعد الاستلام</span>
                  <strong>{format(target.required_at)}</strong>
                </div>
              </div>
            </div>
          </section>
          <section className={styles.section}>
            <h2>بيانات التسليم والمواصفات</h2>
            <div className={styles.grid}>
              <div className={styles.field}>
                <span>المنطقة</span>
                <strong>{target.delivery_region}</strong>
              </div>
              <div className={styles.field}>
                <span>طريقة الاستلام</span>
                <strong>
                  {target.delivery_mode === "pickup"
                    ? "استلام من المزود"
                    : "توصيل لموقع العميل"}
                </strong>
              </div>
              <div className={styles.field}>
                <span>وصف الموقع</span>
                <strong>{target.location_hint || "—"}</strong>
              </div>
            </div>
            <div className={styles.notes}>
              <div className={styles.field}>
                <span>مواصفات المنتج</span>
                <strong>{target.item_notes || "لا توجد مواصفات إضافية"}</strong>
              </div>
              <div className={styles.field}>
                <span>ملاحظات العميل</span>
                <strong>
                  {target.request_notes || "لا توجد ملاحظات إضافية"}
                </strong>
              </div>
            </div>
            {target.google_maps_url ? (
              <div className={styles.map}>
                <div>
                  <span>الموقع الجغرافي للتسليم</span>
                  <strong>
                    {target.location_hint || target.delivery_region}
                  </strong>
                </div>
                <a
                  href={target.google_maps_url}
                  target="_blank"
                  rel="noreferrer"
                >
                  فتح خرائط Google ↗
                </a>
              </div>
            ) : null}
          </section>
        </div>
        <aside className={`${styles.panel} ${styles.formPanel}`}>
          <h2>
            {existing ? `عرضك ${existing.response_code}` : "تفاصيل عرض منشأتك"}
          </h2>
          <p className={styles.scopeNote}>
            هذا التسعير خاص بالمنتج الظاهر فقط. يمكنك تقديم سعره حتى لو لم تكن
            توفر بقية منتجات طلب العميل.
          </p>
          <div className={styles.comparison}>
            <div>
              <span>أقل سعر وحدة من مزود آخر</span>
              <strong>
                {target.current_lowest_unit_price === null
                  ? "لا يوجد عرض بعد"
                  : amount(target.current_lowest_unit_price)}
              </strong>
            </div>
            <div>
              <span>أقل تكلفة واصلة من مزود آخر</span>
              <strong>
                {target.current_lowest_landed_cost === null
                  ? "لا يوجد عرض بعد"
                  : amount(target.current_lowest_landed_cost)}
              </strong>
            </div>
          </div>
          {existing ? (
            <div className={styles.form}>
              <p className={styles.notice}>
                تم استلام عرضك بنجاح، ولا يمكن تقديم عرض ثانٍ لنفس الطلب.
              </p>
              <div className={styles.field}>
                <span>سعر الوحدة</span>
                <strong>{amount(existing.unit_price)}</strong>
              </div>
              <div className={styles.field}>
                <span>الكمية المتوفرة</span>
                <strong>
                  {existing.available_quantity} {target.unit_snapshot}
                </strong>
              </div>
              <div className={styles.field}>
                <span>التجهيز والتوصيل</span>
                <strong>
                  {existing.preparation_hours} ساعة تجهيز +{" "}
                  {existing.delivery_hours} ساعة توصيل
                </strong>
              </div>
              <div className={styles.field}>
                <span>تكلفة التوصيل</span>
                <strong>{amount(existing.delivery_fee)}</strong>
              </div>
              <div className={styles.field}>
                <span>الضريبة</span>
                <strong>
                  {existing.vat_inclusive
                    ? "السعر شامل الضريبة"
                    : "تضاف ضريبة 15%"}
                </strong>
              </div>
              <div className={styles.field}>
                <span>صلاحية السعر</span>
                <strong>{format(existing.price_expires_at)}</strong>
              </div>
              <div className={`${styles.summary} ${styles.wide}`}>
                <div>
                  <span>قيمة المنتجات</span>
                  <strong>{amount(submittedTotals.subtotal)}</strong>
                </div>
                <div>
                  <span>الضريبة المضافة</span>
                  <strong>{amount(submittedTotals.vat)}</strong>
                </div>
                <div>
                  <span>إجمالي العرض الواصل</span>
                  <strong>{amount(submittedTotals.total)}</strong>
                </div>
              </div>
              {existing.notes ? (
                <div className={`${styles.field} ${styles.wide}`}>
                  <span>ملاحظات العرض</span>
                  <strong>{existing.notes}</strong>
                </div>
              ) : null}
              {existing.can_revise ? (
                <form className={`${styles.revisionForm} ${styles.wide}`} onSubmit={submit}>
                  <div className={styles.outbidAlert}>
                    <strong>وصل عرض منافس أقل</strong>
                    <span>أقل تكلفة واصلة حاليًا: {amount(existing.current_competitor_landed_cost || 0)}</span>
                    <small>عرضك السابق محفوظ. يمكنك تقديم تخفيض في هذه الجولة، ويجب أن يصبح الإجمالي شامل الضريبة والتوصيل أقل من السعر المنافس الحالي.</small>
                  </div>
                  <label>
                    سعر الوحدة المخفّض
                    <input name="unit_price" type="number" min="0" max={existing.unit_price} step="0.01" required value={price} onChange={(event) => setPrice(event.target.value)} />
                  </label>
                  <label>
                    تكلفة التوصيل المخفّضة
                    <input name="delivery_fee" type="number" min="0" max={existing.delivery_fee} step="0.01" required value={deliveryFee} onChange={(event) => setDeliveryFee(event.target.value)} />
                  </label>
                  <input name="available_quantity" type="hidden" value={existing.available_quantity} />
                  <input name="preparation_hours" type="hidden" value={existing.preparation_hours} />
                  <input name="delivery_hours" type="hidden" value={existing.delivery_hours} />
                  <input name="price_expires_at" type="hidden" value={priceWindow.initial} />
                  <input name="vat_inclusive" type="hidden" value={existing.vat_inclusive ? "on" : ""} />
                  <label className={styles.wide}>
                    ملاحظة التخفيض
                    <textarea name="notes" rows={2} defaultValue={existing.notes || ""} />
                  </label>
                  <button className={styles.submit} disabled={busy || !price}>
                    {busy ? "جارٍ حفظ التخفيض..." : "تخفيض عرضي وإرساله"}
                  </button>
                </form>
              ) : (
                <p className={`${styles.lockedOffer} ${styles.wide}`}>عرضك محفوظ ومقفل. إذا وصل سعر أقل سيصلك تنبيه ويظهر هنا خيار التخفيض حتى نهاية المنافسة.</p>
              )}
              <Link className={styles.submit} href="/merchant/quotes">
                العودة إلى استجابات التسعير
              </Link>
            </div>
          ) : !windowState.canSubmit ? (
            <div className={styles.closedState}>
              <strong>
                {windowState.kind === "closed"
                  ? "انتهت مهلة التسعير"
                  : "التسعير لم يفتح بعد"}
              </strong>
              <p>
                {windowState.kind === "closed"
                  ? "لا يقبل النظام أي سعر بعد انتهاء العداد."
                  : "يمكنك العودة عند موعد الفتح الموضح أعلى الصفحة. يبدأ عداد الثلاث ساعات الساعة 8 صباحًا."}
              </p>
            </div>
          ) : (
            <form className={styles.form} onSubmit={submit}>
              <label>
                سعر الوحدة (ر.س)
                <input
                  name="unit_price"
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  value={price}
                  onChange={(event) => setPrice(event.target.value)}
                />
              </label>
              <label>
                الكمية المتوفرة
                <input
                  name="available_quantity"
                  type="number"
                  min={target.quantity}
                  step="0.001"
                  required
                  defaultValue={target.quantity}
                />
              </label>
              <label>
                مدة التجهيز بالساعات
                <input
                  name="preparation_hours"
                  type="number"
                  min="0"
                  required
                  defaultValue="0"
                />
              </label>
              <label>
                مدة التوصيل بالساعات
                <input
                  name="delivery_hours"
                  type="number"
                  min="0"
                  required
                  defaultValue="0"
                />
              </label>
              <label>
                تكلفة التوصيل (ر.س)
                <input
                  name="delivery_fee"
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  value={deliveryFee}
                  onChange={(event) => setDeliveryFee(event.target.value)}
                />
              </label>
              <label>
                صلاحية السعر (تغطي 48 ساعة للعميل)
                <input
                  name="price_expires_at"
                  type="datetime-local"
                  min={priceWindow.min}
                  max={priceWindow.max}
                  required
                  defaultValue={priceWindow.initial}
                />
              </label>
              <div className={`${styles.checks} ${styles.wide}`}>
                <label className={styles.check}>
                  <input name="available" type="checkbox" defaultChecked />{" "}
                  المنتج متوفر
                </label>
                <label className={styles.check}>
                  <input name="region_eligible" type="checkbox" required /> أؤكد
                  أنني فتحت رابط Google Maps وراجعت موقع التسليم ومسار الوصول
                  والتنزيل بعناية، ويمكنني التوصيل بالسعر والمدة المدخلين.
                </label>
                <label className={styles.check}>
                  <input
                    name="vat_inclusive"
                    type="checkbox"
                    checked={vatInclusive}
                    onChange={(event) => setVatInclusive(event.target.checked)}
                  />{" "}
                  السعر شامل الضريبة
                </label>
              </div>
              <label className={styles.wide}>
                ملاحظات العرض
                <textarea
                  name="notes"
                  rows={3}
                  placeholder="شروط التحميل أو التوصيل وأي تفاصيل يجب أن يعرفها العميل"
                />
              </label>
              <div className={`${styles.summary} ${styles.wide}`}>
                <div>
                  <span>قيمة المنتجات</span>
                  <strong>{amount(totals.subtotal)}</strong>
                </div>
                <div>
                  <span>الضريبة المضافة</span>
                  <strong>{amount(totals.vat)}</strong>
                </div>
                <div>
                  <span>إجمالي العرض الواصل</span>
                  <strong>{amount(totals.total)}</strong>
                </div>
              </div>
              <p className={styles.notice}>
                تنبيه: راجع موقع التسليم في Google Maps بعناية قبل اعتماد السعر
                والتوفر. يتم اختيار أقل تكلفة مؤهلة بعد التحقق من الكمية وموعد
                التسليم.
              </p>
              {error ? <p className={styles.error}>{error}</p> : null}
              <button className={styles.submit} disabled={busy || !price}>
                {busy ? "جارٍ إرسال العرض..." : "تأكيد وإرسال عرض السعر"}
              </button>
            </form>
          )}
        </aside>
      </div>
    </main>
  );
}
