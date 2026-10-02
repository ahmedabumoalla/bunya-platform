"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { isProductVideo, signProductImageMap, type ProductMediaSource } from "@/lib/products/image-urls";
import styles from "./AdminProductChangeReview.module.css";

type JsonObject = Record<string, unknown>;
type Change = { field: string; before: unknown; after: unknown };
type ChangeRequest = {
  id: string;
  status: "pending" | "approved" | "rejected";
  before_snapshot: JsonObject;
  proposed_snapshot: JsonObject;
  changes: Change[];
  request_note: string | null;
  review_reason: string | null;
  created_at: string;
  reviewed_at: string | null;
  products: { id: string; name: string; sku: string | null } | null;
  providers: { company_name: string } | null;
};

const selection = "id,status,before_snapshot,proposed_snapshot,changes,request_note,review_reason,created_at,reviewed_at,products(id,name,sku),providers(company_name)";
const sectionLabels: Record<string, string> = {
  core: "البيانات الأساسية ونوع العرض والتوفر",
  images: "صور وفيديوهات المنتج",
  measurements: "القياسات",
  variants: "الخيارات والفئات",
  specifications: "المواصفات الفنية",
  warranty: "الضمان",
  availability_regions: "مناطق التوفر",
  delivery_config: "إعدادات التوصيل",
  delivery_regions: "مناطق التوصيل",
};
const fieldLabels: Record<string, string> = {
  category_id: "التصنيف",
  custom_category: "التصنيف المخصص",
  sku: "رمز SKU",
  name: "اسم المنتج",
  base_unit: "وحدة البيع",
  short_description: "الوصف المختصر",
  description: "الوصف",
  full_description: "الوصف الكامل",
  availability_status: "حالة التوفر",
  lead_time_label: "مدة التجهيز",
  delivery_window: "مدة التوصيل",
  delivery_notes: "تعليمات التوصيل",
  offer_type: "نوع العرض",
  minimum_order: "الحد الأدنى للطلب",
  stock_quantity: "كمية المخزون",
  rental_duration_value: "مدة التأجير",
  rental_duration_unit: "وحدة مدة التأجير",
  is_available: "خدمة التوصيل متاحة",
  maximum_duration: "المدة القصوى للتوصيل",
  duration_unit: "وحدة المدة",
  price_per_km: "سعر الكيلومتر",
  maximum_distance_km: "أقصى مسافة",
  notes: "ملاحظات",
};
const valueLabels: Record<string, string> = {
  sale: "بيع",
  rental: "تأجير",
  available: "متوفر",
  limited: "كمية محدودة",
  on_request: "حسب الطلب",
  unavailable: "غير متوفر",
};

function textValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "غير مسجل";
  if (typeof value === "boolean") return value ? "نعم" : "لا";
  if (typeof value === "number") return value.toLocaleString("ar-SA", { maximumFractionDigits: 3 });
  if (typeof value === "string") return valueLabels[value] || value;
  if (Array.isArray(value)) {
    if (!value.length) return "لا توجد بيانات";
    return value.map((item, index) => `${index + 1}. ${textValue(item)}`).join("\n");
  }
  const object = value as JsonObject;
  return Object.entries(object)
    .filter(([, item]) => item !== null && item !== "")
    .map(([key, item]) => `${fieldLabels[key] || key}: ${textValue(item)}`)
    .join("\n") || "لا توجد بيانات";
}

function coreChanges(before: unknown, after: unknown) {
  const previous = (before || {}) as JsonObject;
  const proposed = (after || {}) as JsonObject;
  return [...new Set([...Object.keys(previous), ...Object.keys(proposed)])]
    .filter((key) => !["unit_price", "vat_inclusive"].includes(key) && JSON.stringify(previous[key]) !== JSON.stringify(proposed[key]))
    .map((key) => ({ field: key, before: previous[key], after: proposed[key] }));
}

type SnapshotMedia = ProductMediaSource & { id?: string; label?: string; alt_text?: string; is_primary?: boolean };

function MediaSnapshot({ value }: { value: unknown }) {
  const media = useMemo(() => (Array.isArray(value) ? value : [])
    .filter((item): item is SnapshotMedia => !!item && typeof item === "object")
    .sort((a, b) => Number(isProductVideo(a)) - Number(isProductVideo(b)) || Number(b.is_primary === true) - Number(a.is_primary === true)), [value]);
  const [urls, setUrls] = useState(new Map<string, string>());
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    void signProductImageMap(createClient(), media, { width: 720, height: 720, resize: "contain" }).then((result) => {
      if (active) { setUrls(result); setError(false); }
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [media]);
  if (!media.length) return <p>لا توجد وسائط</p>;
  return <div className={styles.mediaGallery}>
    {error ? <p role="status">تعذر تحميل بعض الوسائط.</p> : null}
    {media.map((item, index) => {
      const url = (item.storage_path ? urls.get(item.storage_path) : null) || item.image_url;
      const video = isProductVideo(item);
      return <figure key={item.id || item.storage_path || index}>
        {url ? video ? <video src={url} controls preload="metadata" playsInline aria-label={item.alt_text || item.label || "فيديو المنتج"}>
          <a href={url}>فتح فيديو المنتج</a>
        </video> : <Image src={url} alt={item.alt_text || item.label || "صورة المنتج"} width={480} height={360} unoptimized /> : <p>الوسيط غير متاح للعرض.</p>}
        <figcaption>{item.label || (video ? "فيديو المنتج" : "صورة المنتج")}{item.is_primary && !video ? " · الصورة الرئيسية" : ""}</figcaption>
      </figure>;
    })}
  </div>;
}

export function AdminProductChangeReview({ initialRequestId }: { initialRequestId?: string }) {
  const [requests, setRequests] = useState<ChangeRequest[]>([]);
  const [selected, setSelected] = useState<ChangeRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [reason, setReason] = useState("");
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let active = true;
    const query = createClient().from("product_change_requests").select(selection).order("created_at", { ascending: false }).limit(100);
    void query.then((result) => {
      if (!active) return;
      if (result.error) {
        setError("تعذر تحميل طلبات تعديل المنتجات. تحقق من صلاحية مراجعة المنتجات ثم أعد المحاولة.");
        setLoading(false);
        return;
      }
      const rows = (result.data || []) as unknown as ChangeRequest[];
      setRequests(rows);
      if (initialRequestId) setSelected(rows.find((item) => item.id === initialRequestId) || null);
      setLoading(false);
    });
    return () => { active = false; };
  }, [initialRequestId, version]);

  const pendingCount = useMemo(() => requests.filter((item) => item.status === "pending").length, [requests]);

  async function decide(decision: "approved" | "rejected") {
    if (!selected || saving) return;
    const cleanReason = reason.trim();
    if (cleanReason.length < 5) {
      setError("اكتب ملاحظة واضحة من 5 أحرف على الأقل؛ ستصل هذه الملاحظة إلى المزود.");
      return;
    }
    setSaving(true);
    setError("");
    setFeedback("");
    try {
      const response = await fetch(`/api/admin/product-change-requests/${selected.id}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": `web-product-change-review-${crypto.randomUUID()}` },
        body: JSON.stringify({ decision, reason: cleanReason }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "تعذر حفظ قرار المراجعة.");
      setSelected((current) => current ? { ...current, status: decision, review_reason: cleanReason, reviewed_at: new Date().toISOString() } : current);
      setFeedback(decision === "approved" ? "تم اعتماد التعديلات وتحديث المنتج المنشور، وأُرسل القرار إلى المزود." : "تم رفض الطلب وبقي المنتج المنشور دون تغيير، وأُرسل السبب إلى المزود.");
      setReason("");
      setVersion((value) => value + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر حفظ قرار المراجعة.");
    } finally {
      setSaving(false);
    }
  }

  return <main className={`${styles.page} database-page`}>
    <header className={styles.hero}>
      <div><p>إدارة بيانات الكتالوج</p><h1>طلبات تعديل المنتجات</h1><span>راجع كل قيمة تغيّرت قبل اعتمادها. تظل بيانات المنتج المنشورة كما هي حتى موافقة الإدارة.</span></div>
      <aside><small>بانتظار القرار</small><strong>{pendingCount.toLocaleString("ar-SA")}</strong></aside>
    </header>
    {error ? <p className={styles.error} role="alert">{error}</p> : null}
    {feedback ? <p className={styles.feedback} role="status">{feedback}</p> : null}
    {loading ? <section className={styles.empty}>جارٍ تحميل الطلبات…</section> : null}
    {!loading && !requests.length ? <section className={styles.empty}><h2>لا توجد طلبات تعديل</h2><p>ستظهر هنا الطلبات التي يرسلها المزودون من بطاقات منتجاتهم.</p></section> : null}
    {!loading && requests.length ? <section className={styles.layout}>
      <nav className={styles.queue} aria-label="طلبات تعديل المنتجات">
        {requests.map((request) => <button className={selected?.id === request.id ? styles.active : ""} key={request.id} type="button" onClick={() => { setSelected(request); setReason(""); setError(""); setFeedback(""); }}>
          <span><b>{request.products?.name || "منتج"}</b><small>{request.providers?.company_name || "منشأة مزودة"}</small></span>
          <em data-status={request.status}>{request.status === "pending" ? "بانتظار المراجعة" : request.status === "approved" ? "معتمد" : "مرفوض"}</em>
        </button>)}
      </nav>
      <section className={styles.review}>
        {!selected ? <div className={styles.empty}><h2>اختر طلبًا للمراجعة</h2><p>ستظهر المقارنة الدقيقة بين البيانات السابقة والمقترحة هنا.</p></div> : <>
          <header className={styles.reviewHeader}>
            <div><small>{selected.providers?.company_name || "منشأة مزودة"}</small><h2>{selected.products?.name || "طلب تعديل منتج"}</h2><p>أُرسل في {new Date(selected.created_at).toLocaleString("ar-SA")}{selected.products?.sku ? ` · SKU: ${selected.products.sku}` : ""}</p></div>
            <Link href={`/admin/products/review/${selected.products?.id || ""}`}>فتح بطاقة المنتج الأصلية</Link>
          </header>
          {selected.request_note ? <aside className={styles.note}><b>ملاحظة المزود</b><p>{selected.request_note}</p></aside> : null}
          <aside className={styles.note}><p>سعر المنتج يُحدد عند طلب عرض السعر. لا تشمل مراجعة بيانات الكتالوج السعر أو ضريبته.</p></aside>
          <div className={styles.changes}>
            {(selected.changes || []).map((change) => {
              const rows = change.field === "core" ? coreChanges(change.before, change.after) : [{ field: change.field, before: change.before, after: change.after }];
              if (!rows.length || ["unit_price", "vat_inclusive"].includes(change.field)) return null;
              return <article key={change.field}>
                <h3>{sectionLabels[change.field] || change.field}</h3>
                {rows.map((row) => <div className={styles.diff} key={row.field}>
                  <strong>{change.field === "core" ? fieldLabels[row.field] || row.field : "التغيير الكامل"}</strong>
                  <section><small>قبل التعديل</small>{change.field === "images" ? <MediaSnapshot value={row.before} /> : <pre>{textValue(row.before)}</pre>}</section>
                  <section className={styles.after}><small>بعد التعديل</small>{change.field === "images" ? <MediaSnapshot value={row.after} /> : <pre>{textValue(row.after)}</pre>}</section>
                </div>)}
              </article>;
            })}
          </div>
          {selected.status === "pending" ? <footer className={styles.decision}>
            <label><span>ملاحظة القرار للمزود *</span><textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={3} maxLength={1000} placeholder="وضح سبب الاعتماد أو الرفض" /></label>
            <div><button type="button" className={styles.reject} disabled={saving} onClick={() => void decide("rejected")}>{saving ? "جارٍ الحفظ…" : "رفض التعديلات"}</button><button type="button" className={styles.approve} disabled={saving} onClick={() => void decide("approved")}>{saving ? "جارٍ الحفظ…" : "اعتماد وتحديث المنتج"}</button></div>
          </footer> : <aside className={styles.finalDecision}><b>{selected.status === "approved" ? "تم اعتماد التعديلات" : "تم رفض التعديلات"}</b><p>{selected.review_reason || "لا توجد ملاحظة مسجلة."}</p></aside>}
        </>}
      </section>
    </section> : null}
  </main>;
}
