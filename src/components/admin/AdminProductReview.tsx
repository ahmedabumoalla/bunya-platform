"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import styles from "./AdminProductReview.module.css";

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

const labels: Record<string, string> = { draft: "مسودة", pending_review: "بانتظار المراجعة", approved: "معتمد", rejected: "مرفوض", needs_changes: "يحتاج تعديلات", inactive: "غير نشط", available: "متوفر", limited: "كمية محدودة", on_request: "حسب الطلب", unavailable: "غير متوفر", sale: "بيع", rental: "تأجير" };
const label = (value: string) => labels[value] || value || "—";
const badgeTone = (value: string) => value === "approved" ? styles.success : ["rejected", "inactive"].includes(value) ? styles.danger : styles.warning;
const number = (value: number | null, digits = 2) => value === null ? "—" : Number(value).toLocaleString("ar-SA", { maximumFractionDigits: digits });
const date = (value: string) => new Date(value).toLocaleString("ar-SA");

async function signImages(product: Product) {
  const db = createClient();
  const ordered = [...(product.product_images || [])].sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || a.sort_order - b.sort_order);
  const product_images = await Promise.all(ordered.map(async image => {
    if (!image.storage_path) return { ...image, signed_url: image.image_url };
    const signed = await db.storage.from("provider-product-images").createSignedUrl(image.storage_path, 600);
    return { ...image, signed_url: signed.data?.signedUrl || image.image_url };
  }));
  return { ...product, product_images };
}

export function AdminProductReview({ initialProductId }: { initialProductId?: string }) {
  const [products, setProducts] = useState<Product[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [query, setQuery] = useState(""), [status, setStatus] = useState("pending_review"), [provider, setProvider] = useState("all");
  const [selected, setSelected] = useState<Product | null>(null), [activeImage, setActiveImage] = useState(0);

  useEffect(() => {
    let active = true;
    void createClient().from("products").select("id,name,sku,base_unit,unit_price,stock_quantity,review_status,is_published,updated_at,created_at,custom_category,short_description,description,full_description,availability_summary,availability_status,lead_time_label,delivery_label,delivery_window,delivery_notes,offer_type,minimum_order,vat_inclusive,rental_duration_value,rental_duration_unit,providers(company_name),product_categories(name),product_images(id,label,alt_text,image_url,storage_path,is_primary,sort_order),product_review_decisions(outcome,reason,reviewed_at)").order("updated_at", { ascending: false }).limit(300).then(async result => {
      if (!active) return;
      if (result.error) { setError("تعذر تحميل المنتجات من قاعدة البيانات. تحقق من صلاحية مراجعة المنتجات ثم أعد المحاولة."); setLoading(false); return; }
      const hydrated = await Promise.all(((result.data || []) as unknown as Product[]).map(signImages));
      if (!active) return;
      setProducts(hydrated); setLoading(false);
      if (initialProductId) { const match = hydrated.find(item => item.id === initialProductId) || null; setSelected(match); if (match) setStatus("all"); }
    });
    return () => { active = false; };
  }, [initialProductId]);
  useEffect(() => {
    if (!selected) return;
    const previous = document.body.style.overflow; document.body.style.overflow = "hidden";
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setSelected(null); };
    window.addEventListener("keydown", close); return () => { document.body.style.overflow = previous; window.removeEventListener("keydown", close); };
  }, [selected]);

  const providers = useMemo(() => [...new Set(products.map(item => item.providers?.company_name).filter(Boolean) as string[])].sort(), [products]);
  const counts = useMemo(() => ({ pending: products.filter(x => x.review_status === "pending_review").length, approved: products.filter(x => x.review_status === "approved").length, other: products.filter(x => !["pending_review", "approved"].includes(x.review_status)).length }), [products]);
  const filtered = useMemo(() => {
    const clean = query.trim().toLocaleLowerCase("ar");
    return products.filter(item => (status === "all" || item.review_status === status) && (provider === "all" || item.providers?.company_name === provider) && (!clean || [item.name, item.sku, item.providers?.company_name, item.product_categories?.name, item.custom_category].some(value => value?.toLocaleLowerCase("ar").includes(clean))));
  }, [products, provider, query, status]);

  const open = (product: Product) => { setSelected(product); setActiveImage(0); };
  return <main className={`${styles.page} database-page`}><header className={styles.hero}><div><p>إدارة الكتالوج</p><h1>مراجعة المنتجات</h1><span>عرض بصري كامل يساعدك على فحص المنتج والمنشأة والسعر والمخزون قبل اتخاذ قرار المراجعة.</span></div><aside><div className={styles.metric}><small>بانتظار المراجعة</small><strong>{counts.pending.toLocaleString("ar-SA")}</strong></div><div className={styles.metric}><small>معتمدة</small><strong>{counts.approved.toLocaleString("ar-SA")}</strong></div><div className={styles.metric}><small>حالات أخرى</small><strong>{counts.other.toLocaleString("ar-SA")}</strong></div></aside></header>
    <section className={styles.filters}><label>البحث<input value={query} onChange={event => setQuery(event.target.value)} placeholder="اسم المنتج، SKU، المنشأة أو التصنيف"/></label><label>حالة المراجعة<select value={status} onChange={event => setStatus(event.target.value)}><option value="pending_review">بانتظار المراجعة</option><option value="all">جميع الحالات</option><option value="approved">معتمد</option><option value="needs_changes">يحتاج تعديلات</option><option value="rejected">مرفوض</option><option value="draft">مسودة</option><option value="inactive">غير نشط</option></select></label><label>المنشأة<select value={provider} onChange={event => setProvider(event.target.value)}><option value="all">جميع المنشآت</option>{providers.map(name => <option value={name} key={name}>{name}</option>)}</select></label></section>
    {error ? <div className={styles.error}>{error}</div> : null}
    {loading ? <div className={styles.loading}>جارٍ تحميل صور المنتجات وتفاصيلها…</div> : filtered.length ? <section className={styles.list}>{filtered.map(product => { const image = product.product_images.find(item => item.signed_url); return <article className={styles.card} key={product.id}><div className={styles.visual}>{image?.signed_url ? <Image src={image.signed_url} alt={image.alt_text || product.name} fill sizes="(max-width: 700px) 100vw, 35vw" unoptimized/> : <div className={styles.fallback}><div><b>{product.name.slice(0, 1)}</b><span>لا توجد صورة للمنتج</span></div></div>}</div><div className={styles.body}><header className={styles.heading}><div><small>{product.providers?.company_name || "منشأة غير محددة"} · {product.product_categories?.name || product.custom_category || "بلا تصنيف"}</small><h2>{product.name}</h2></div><span className={`${styles.badge} ${badgeTone(product.review_status)}`}>{label(product.review_status)}</span></header><dl className={styles.facts}><div><dt>السعر</dt><dd>{product.unit_price === null ? "غير محدد" : `${number(product.unit_price)} ر.س`}</dd></div><div><dt>المخزون</dt><dd>{product.stock_quantity === null ? "غير محدد" : `${number(product.stock_quantity, 3)} ${product.base_unit}`}</dd></div><div><dt>نوع العرض</dt><dd>{label(product.offer_type)}</dd></div><div><dt>SKU</dt><dd>{product.sku || "—"}</dd></div></dl><p className={styles.description}>{product.full_description || product.description || product.short_description}</p><footer className={styles.footer}><span>آخر تحديث: {date(product.updated_at)}</span><button className={styles.button} type="button" onClick={() => open(product)}>عرض المنتج بالحجم الكامل</button></footer></div></article>; })}</section> : <section className={styles.empty}><div><h2>لا توجد منتجات مطابقة</h2><p>{products.length ? "غيّر البحث أو الفلاتر لعرض منتجات أخرى." : "لا توجد منتجات مسجلة في الكتالوج."}</p></div></section>}
    {selected ? <ProductDialog product={selected} activeImage={activeImage} onActiveImage={setActiveImage} onClose={() => setSelected(null)}/> : null}
  </main>;
}

function ProductDialog({ product, activeImage, onActiveImage, onClose }: { product: Product; activeImage: number; onActiveImage: (value: number) => void; onClose: () => void }) {
  const images = product.product_images.filter(item => item.signed_url); const shown = images[Math.min(activeImage, Math.max(0, images.length - 1))];
  const history = [...(product.product_review_decisions || [])].sort((a, b) => +new Date(b.reviewed_at) - +new Date(a.reviewed_at));
  return <div className={styles.backdrop} onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="admin-product-title"><button className={styles.close} onClick={onClose} aria-label="إغلاق">×</button><header className={styles.modalHeader}><div><small>{product.providers?.company_name || "منشأة غير محددة"} · {product.product_categories?.name || product.custom_category || "بلا تصنيف"} · {product.sku || "بلا SKU"}</small><h2 id="admin-product-title">{product.name}</h2></div><span className={`${styles.badge} ${badgeTone(product.review_status)}`}>{label(product.review_status)}</span></header><div className={styles.detail}><div className={styles.gallery}><div className={styles.heroImage}>{shown?.signed_url ? <Image src={shown.signed_url} alt={shown.alt_text || product.name} fill sizes="(max-width: 1000px) 90vw, 46vw" unoptimized/> : <div className={styles.fallback}><div><b>{product.name.slice(0, 1)}</b><span>لم يرفع المزوّد صورة لهذا المنتج</span></div></div>}</div>{images.length > 1 ? <div className={styles.thumbs}>{images.map((image, index) => <button className={index === activeImage ? styles.active : ""} type="button" onClick={() => onActiveImage(index)} key={image.id}><Image src={image.signed_url!} alt="" fill sizes="120px" unoptimized/></button>)}</div> : null}</div><div className={styles.sections}><section className={styles.panel}><h3>البيع والمخزون</h3><dl className={styles.detailFacts}><Fact name="السعر" value={product.unit_price === null ? "غير محدد" : `${number(product.unit_price)} ر.س / ${product.base_unit}`}/><Fact name="الضريبة" value={product.vat_inclusive ? "شامل الضريبة" : "غير شامل الضريبة"}/><Fact name="الحد الأدنى" value={product.minimum_order === null ? "غير محدد" : `${number(product.minimum_order, 3)} ${product.base_unit}`}/><Fact name="المخزون" value={product.stock_quantity === null ? "غير محدد" : `${number(product.stock_quantity, 3)} ${product.base_unit}`}/><Fact name="نوع العرض" value={label(product.offer_type)}/><Fact name="حالة النشر" value={product.is_published ? "منشور" : "غير منشور"}/>{product.offer_type === "rental" ? <Fact name="مدة التأجير" value={`${number(product.rental_duration_value)} ${product.rental_duration_unit || ""}`}/> : null}</dl></section><section className={styles.panel}><h3>الوصف الكامل</h3><p className={styles.text}>{product.full_description || product.description || product.short_description || "لا يوجد وصف."}</p></section><section className={styles.panel}><h3>التوفر والتوصيل</h3><dl className={styles.detailFacts}><Fact name="حالة التوفر" value={label(product.availability_status)}/><Fact name="ملخص التوفر" value={product.availability_summary}/><Fact name="مدة التجهيز" value={product.lead_time_label}/><Fact name="طريقة التوصيل" value={product.delivery_label}/><Fact name="نافذة التوصيل" value={product.delivery_window}/><Fact name="ملاحظات التوصيل" value={product.delivery_notes}/></dl></section>{history.length ? <section className={styles.panel}><h3>سجل قرارات المراجعة</h3><div className={styles.history}>{history.map((item, index) => <div key={`${item.reviewed_at}-${index}`}><b>{label(item.outcome)}</b><span>{item.reason}</span><small>{date(item.reviewed_at)}</small></div>)}</div></section> : null}</div></div></section></div>;
}

function Fact({ name, value }: { name: string; value: string }) { return <div><dt>{name}</dt><dd>{value || "—"}</dd></div>; }
