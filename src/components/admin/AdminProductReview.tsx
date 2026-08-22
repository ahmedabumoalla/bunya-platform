"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import styles from "./AdminProductReview.module.css";

type ReviewDecision = "approved" | "needs_changes" | "rejected";
type ImageRow = { id: string; label: string; alt_text: string; image_url: string | null; storage_path: string | null; is_primary: boolean; sort_order: number; signed_url?: string | null };
type Decision = { outcome: string; reason: string; reviewed_at: string };
type Product = {
  id: string; name: string; sku: string | null; base_unit: string; unit_price: number | null; stock_quantity: number | null;
  review_status: string; is_published: boolean; updated_at: string; created_at: string; custom_category: string | null;
  short_description: string; description: string; full_description: string; availability_summary: string; availability_status: string;
  lead_time_label: string; delivery_label: string; delivery_window: string; delivery_notes: string; offer_type: string;
  minimum_order: number | null; vat_inclusive: boolean; rental_duration_value: number | null; rental_duration_unit: string | null;
  providers: { company_name: string } | null; product_categories: { name: string } | null; product_images: ImageRow[];
  product_review_decisions: Decision[];
};

const productSelection = "id,name,sku,base_unit,unit_price,stock_quantity,review_status,is_published,updated_at,created_at,custom_category,short_description,description,full_description,availability_summary,availability_status,lead_time_label,delivery_label,delivery_window,delivery_notes,offer_type,minimum_order,vat_inclusive,rental_duration_value,rental_duration_unit,providers(company_name),product_categories(name),product_images(id,label,alt_text,image_url,storage_path,is_primary,sort_order),product_review_decisions(outcome,reason,reviewed_at)";
const labels: Record<string, string> = { draft: "مسودة", pending_review: "بانتظار المراجعة", approved: "معتمد", rejected: "مرفوض", needs_changes: "يحتاج تعديلات", inactive: "غير نشط", available: "متوفر", limited: "كمية محدودة", on_request: "حسب الطلب", unavailable: "غير متوفر", sale: "بيع", rental: "تأجير" };
const decisionCopy: Record<ReviewDecision, { title: string; description: string; submit: string }> = {
  approved: { title: "اعتماد المنتج ونشره", description: "سيظهر المنتج للعملاء فور حفظ القرار.", submit: "تأكيد الاعتماد والنشر" },
  needs_changes: { title: "إعادة المنتج للتعديل", description: "لن يُنشر المنتج، وستصل ملاحظاتك إلى المزوّد ليصحح البيانات.", submit: "إرسال طلب التعديلات" },
  rejected: { title: "رفض المنتج", description: "لن يُنشر المنتج، وسيُحفظ سبب الرفض في سجل المراجعة.", submit: "تأكيد رفض المنتج" },
};

const label = (value: string) => labels[value] || value || "—";
const badgeTone = (value: string) => value === "approved" ? styles.success : ["rejected", "inactive"].includes(value) ? styles.danger : styles.warning;
const number = (value: number | null, digits = 2) => value === null ? "—" : Number(value).toLocaleString("ar-SA", { maximumFractionDigits: digits });
const date = (value: string) => new Date(value).toLocaleString("ar-SA");

async function signImages(product: Product) {
  const db = createClient();
  const ordered = [...(product.product_images || [])].sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || a.sort_order - b.sort_order);
  const product_images = await Promise.all(ordered.map(async (image) => {
    if (!image.storage_path) return { ...image, signed_url: image.image_url };
    const signed = await db.storage.from("provider-product-images").createSignedUrl(image.storage_path, 600);
    return { ...image, signed_url: signed.data?.signedUrl || image.image_url };
  }));
  return { ...product, product_images };
}

export function AdminProductReview({ initialProductId }: { initialProductId?: string }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("pending_review");
  const [provider, setProvider] = useState("all");
  const [selected, setSelected] = useState<Product | null>(null);
  const [activeImage, setActiveImage] = useState(0);
  const [reviewDecision, setReviewDecision] = useState<ReviewDecision | null>(null);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [refreshVersion, setRefreshVersion] = useState(0);

  useEffect(() => {
    let active = true;
    void createClient().from("products").select(productSelection).order("updated_at", { ascending: false }).limit(300).then(async (result) => {
      if (!active) return;
      if (result.error) {
        setError("تعذر تحميل المنتجات من قاعدة البيانات. تحقق من صلاحية مراجعة المنتجات ثم أعد المحاولة.");
        setLoading(false);
        return;
      }
      const hydrated = await Promise.all(((result.data || []) as unknown as Product[]).map(signImages));
      if (!active) return;
      setProducts(hydrated);
      setLoading(false);
      if (initialProductId) {
        setSelected(hydrated.find((item) => item.id === initialProductId) || null);
        setStatus("all");
      }
    });
    return () => { active = false; };
  }, [initialProductId, refreshVersion]);

  useEffect(() => {
    if (!selected) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) {
        setSelected(null);
        setReviewDecision(null);
        setReason("");
      }
    };
    window.addEventListener("keydown", close);
    return () => { document.body.style.overflow = previous; window.removeEventListener("keydown", close); };
  }, [saving, selected]);

  const providers = useMemo(() => [...new Set(products.map((item) => item.providers?.company_name).filter(Boolean) as string[])].sort(), [products]);
  const counts = useMemo(() => ({ pending: products.filter((item) => item.review_status === "pending_review").length, approved: products.filter((item) => item.review_status === "approved").length, other: products.filter((item) => !["pending_review", "approved"].includes(item.review_status)).length }), [products]);
  const filtered = useMemo(() => {
    const clean = query.trim().toLocaleLowerCase("ar");
    return products.filter((item) => (status === "all" || item.review_status === status) && (provider === "all" || item.providers?.company_name === provider) && (!clean || [item.name, item.sku, item.providers?.company_name, item.product_categories?.name, item.custom_category].some((value) => value?.toLocaleLowerCase("ar").includes(clean))));
  }, [products, provider, query, status]);

  function closeDialog() {
    if (saving) return;
    setSelected(null);
    setReviewDecision(null);
    setReason("");
  }

  function open(product: Product, decision: ReviewDecision | null = null) {
    setSelected(product);
    setActiveImage(0);
    setReviewDecision(decision);
    setReason(decision === "approved" ? "تمت مراجعة بيانات المنتج واعتمادها." : "");
    setError("");
    setFeedback("");
  }

  function chooseDecision(decision: ReviewDecision) {
    setReviewDecision(decision);
    setReason(decision === "approved" ? "تمت مراجعة بيانات المنتج واعتمادها." : "");
    setError("");
  }

  async function submitReview() {
    if (!selected || !reviewDecision || saving) return;
    const cleanReason = reason.trim();
    if (cleanReason.length < (reviewDecision === "approved" ? 3 : 5)) {
      setError(reviewDecision === "approved" ? "اكتب ملاحظة الاعتماد." : "اكتب سببًا واضحًا من 5 أحرف على الأقل حتى يعرف المزوّد المطلوب.");
      return;
    }
    setSaving(true);
    setError("");
    const result = await createClient().rpc("review_product", { p_product_id: selected.id, p_decision: reviewDecision, p_reason: cleanReason, p_idempotency_key: crypto.randomUUID() });
    if (result.error) {
      setError(`تعذر حفظ قرار المراجعة: ${result.error.message}`);
      setSaving(false);
      return;
    }
    const decisionLabel = reviewDecision === "approved" ? "اعتماد المنتج ونشره" : reviewDecision === "needs_changes" ? "إرسال المنتج للتعديل" : "رفض المنتج";
    setFeedback(`تم ${decisionLabel} وحُفظ القرار في السجل.`);
    setSaving(false);
    setReviewDecision(null);
    setReason("");
    if (!initialProductId) setSelected(null);
    setLoading(true);
    setRefreshVersion((value) => value + 1);
  }

  return <main className={`${styles.page} database-page`}>
    <header className={styles.hero}><div><p>إدارة الكتالوج</p><h1>مراجعة المنتجات</h1><span>افحص المنتج كاملًا، ثم اعتمده وانشره أو أعده للمزوّد مع ملاحظات واضحة.</span></div><aside><div className={styles.metric}><small>بانتظار المراجعة</small><strong>{counts.pending.toLocaleString("ar-SA")}</strong></div><div className={styles.metric}><small>معتمدة</small><strong>{counts.approved.toLocaleString("ar-SA")}</strong></div><div className={styles.metric}><small>حالات أخرى</small><strong>{counts.other.toLocaleString("ar-SA")}</strong></div></aside></header>
    <section className={styles.filters}><label>البحث<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="اسم المنتج، SKU، المنشأة أو التصنيف" /></label><label>حالة المراجعة<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="pending_review">بانتظار المراجعة</option><option value="all">جميع الحالات</option><option value="approved">معتمد</option><option value="needs_changes">يحتاج تعديلات</option><option value="rejected">مرفوض</option><option value="draft">مسودة</option><option value="inactive">غير نشط</option></select></label><label>المنشأة<select value={provider} onChange={(event) => setProvider(event.target.value)}><option value="all">جميع المنشآت</option>{providers.map((name) => <option value={name} key={name}>{name}</option>)}</select></label></section>
    {feedback ? <div className={styles.feedback}>{feedback}</div> : null}
    {error && !selected ? <div className={styles.error}>{error}</div> : null}
    {loading ? <div className={styles.loading}>جارٍ تحميل صور المنتجات وتفاصيلها…</div> : filtered.length ? <section className={styles.list}>{filtered.map((product) => { const productImage = product.product_images.find((item) => item.signed_url); return <article className={styles.card} key={product.id}><div className={styles.visual}>{productImage?.signed_url ? <Image src={productImage.signed_url} alt={productImage.alt_text || product.name} fill sizes="(max-width: 700px) 100vw, 35vw" unoptimized /> : <div className={styles.fallback}><div><b>{product.name.slice(0, 1)}</b><span>لا توجد صورة للمنتج</span></div></div>}</div><div className={styles.body}><header className={styles.heading}><div><small>{product.providers?.company_name || "منشأة غير محددة"} · {product.product_categories?.name || product.custom_category || "بلا تصنيف"}</small><h2>{product.name}</h2></div><span className={`${styles.badge} ${badgeTone(product.review_status)}`}>{label(product.review_status)}</span></header><dl className={styles.facts}><Fact name="السعر" value={product.unit_price === null ? "غير محدد" : `${number(product.unit_price)} ر.س`} /><Fact name="المخزون" value={product.stock_quantity === null ? "غير محدد" : `${number(product.stock_quantity, 3)} ${product.base_unit}`} /><Fact name="نوع العرض" value={label(product.offer_type)} /><Fact name="SKU" value={product.sku || "—"} /></dl><p className={styles.description}>{product.full_description || product.description || product.short_description}</p>{product.review_status === "pending_review" ? <ReviewButtons onChoose={(decision) => open(product, decision)} /> : null}<footer className={styles.footer}><span>آخر تحديث: {date(product.updated_at)}</span><button className={styles.button} type="button" onClick={() => open(product)}>عرض جميع التفاصيل</button></footer></div></article>; })}</section> : <section className={styles.empty}><div><h2>لا توجد منتجات مطابقة</h2><p>{products.length ? "غيّر البحث أو الفلاتر لعرض منتجات أخرى." : "لا توجد منتجات مسجلة في الكتالوج."}</p></div></section>}
    {selected ? <ProductDialog product={selected} activeImage={activeImage} reviewDecision={reviewDecision} reason={reason} saving={saving} error={error} onActiveImage={setActiveImage} onChooseDecision={chooseDecision} onReason={setReason} onSubmit={() => void submitReview()} onClose={closeDialog} /> : null}
  </main>;
}

function ReviewButtons({ onChoose }: { onChoose: (decision: ReviewDecision) => void }) {
  return <div className={styles.reviewButtons} aria-label="إجراءات مراجعة المنتج"><button className={styles.approveButton} type="button" onClick={() => onChoose("approved")}>اعتماد ونشر</button><button className={styles.changesButton} type="button" onClick={() => onChoose("needs_changes")}>طلب تعديلات</button><button className={styles.rejectButton} type="button" onClick={() => onChoose("rejected")}>رفض</button></div>;
}

function ProductDialog({ product, activeImage, reviewDecision, reason, saving, error, onActiveImage, onChooseDecision, onReason, onSubmit, onClose }: { product: Product; activeImage: number; reviewDecision: ReviewDecision | null; reason: string; saving: boolean; error: string; onActiveImage: (value: number) => void; onChooseDecision: (decision: ReviewDecision) => void; onReason: (value: string) => void; onSubmit: () => void; onClose: () => void }) {
  const images = product.product_images.filter((item) => item.signed_url);
  const shown = images[Math.min(activeImage, Math.max(0, images.length - 1))];
  const history = [...(product.product_review_decisions || [])].sort((a, b) => +new Date(b.reviewed_at) - +new Date(a.reviewed_at));
  return <div className={styles.backdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="admin-product-title"><button className={styles.close} type="button" onClick={onClose} disabled={saving} aria-label="إغلاق">×</button><header className={styles.modalHeader}><div><small>{product.providers?.company_name || "منشأة غير محددة"} · {product.product_categories?.name || product.custom_category || "بلا تصنيف"} · {product.sku || "بلا SKU"}</small><h2 id="admin-product-title">{product.name}</h2></div><span className={`${styles.badge} ${badgeTone(product.review_status)}`}>{label(product.review_status)}</span></header>
    {product.review_status === "pending_review" ? <section className={styles.decisionArea}><div className={styles.decisionHeading}><div><strong>قرار المراجعة</strong><span>اختر الإجراء بعد فحص الصور والبيانات أدناه.</span></div><ReviewButtons onChoose={onChooseDecision} /></div>{reviewDecision ? <div className={`${styles.reviewForm} ${styles[reviewDecision]}`}><div><h3>{decisionCopy[reviewDecision].title}</h3><p>{decisionCopy[reviewDecision].description}</p></div><label htmlFor="product-review-reason">ملاحظة القرار {reviewDecision === "approved" ? "" : "(ستظهر للمزوّد)"}</label><textarea id="product-review-reason" rows={3} value={reason} onChange={(event) => onReason(event.target.value)} disabled={saving} placeholder={reviewDecision === "approved" ? "ملاحظة الاعتماد" : "اكتب المطلوب من المزوّد بوضوح"} />{error ? <div className={styles.inlineError}>{error}</div> : null}<div className={styles.confirmRow}><button className={styles.confirmDecision} type="button" onClick={onSubmit} disabled={saving}>{saving ? "جارٍ حفظ القرار…" : decisionCopy[reviewDecision].submit}</button></div></div> : null}</section> : <div className={styles.readOnlyDecision}>تم اتخاذ قرار على هذا المنتج. يمكنك مراجعة التفاصيل وسجل القرارات أدناه.</div>}
    <div className={styles.detail}><div className={styles.gallery}><div className={styles.heroImage}>{shown?.signed_url ? <Image src={shown.signed_url} alt={shown.alt_text || product.name} fill sizes="(max-width: 1000px) 90vw, 46vw" unoptimized /> : <div className={styles.fallback}><div><b>{product.name.slice(0, 1)}</b><span>لم يرفع المزوّد صورة لهذا المنتج</span></div></div>}</div>{images.length > 1 ? <div className={styles.thumbs}>{images.map((image, index) => <button className={index === activeImage ? styles.active : ""} type="button" onClick={() => onActiveImage(index)} key={image.id}><Image src={image.signed_url!} alt="" fill sizes="120px" unoptimized /></button>)}</div> : null}</div><div className={styles.sections}><section className={styles.panel}><h3>البيع والمخزون</h3><dl className={styles.detailFacts}><Fact name="السعر" value={product.unit_price === null ? "غير محدد" : `${number(product.unit_price)} ر.س / ${product.base_unit}`} /><Fact name="الضريبة" value={product.vat_inclusive ? "شامل الضريبة" : "غير شامل الضريبة"} /><Fact name="الحد الأدنى" value={product.minimum_order === null ? "غير محدد" : `${number(product.minimum_order, 3)} ${product.base_unit}`} /><Fact name="المخزون" value={product.stock_quantity === null ? "غير محدد" : `${number(product.stock_quantity, 3)} ${product.base_unit}`} /><Fact name="نوع العرض" value={label(product.offer_type)} /><Fact name="حالة النشر" value={product.is_published ? "منشور" : "غير منشور"} />{product.offer_type === "rental" ? <Fact name="مدة التأجير" value={`${number(product.rental_duration_value)} ${product.rental_duration_unit || ""}`} /> : null}</dl></section><section className={styles.panel}><h3>الوصف الكامل</h3><p className={styles.text}>{product.full_description || product.description || product.short_description || "لا يوجد وصف."}</p></section><section className={styles.panel}><h3>التوفر والتوصيل</h3><dl className={styles.detailFacts}><Fact name="حالة التوفر" value={label(product.availability_status)} /><Fact name="ملخص التوفر" value={product.availability_summary} /><Fact name="مدة التجهيز" value={product.lead_time_label} /><Fact name="طريقة التوصيل" value={product.delivery_label} /><Fact name="نافذة التوصيل" value={product.delivery_window} /><Fact name="ملاحظات التوصيل" value={product.delivery_notes} /></dl></section>{history.length ? <section className={styles.panel}><h3>سجل قرارات المراجعة</h3><div className={styles.history}>{history.map((item, index) => <div key={`${item.reviewed_at}-${index}`}><b>{label(item.outcome)}</b><span>{item.reason}</span><small>{date(item.reviewed_at)}</small></div>)}</div></section> : null}</div></div></section></div>;
}

function Fact({ name, value }: { name: string; value: string }) { return <div><dt>{name}</dt><dd>{value || "—"}</dd></div>; }
