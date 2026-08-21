"use client";

import Link from "next/link";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useAuthIdentity } from "@/components/auth/AuthIdentityProvider";
import { createClient } from "@/lib/supabase/client";
import { optimizeUploadFile } from "@/lib/uploads/client";
import styles from "./ProviderProducts.module.css";

type Category = { id: string; name: string };
type SelectedImage = { file: File; preview: string };
type ProviderProduct = {
  id: string;
  name: string;
  sku: string | null;
  base_unit: string;
  unit_price: number | null;
  stock_quantity: number | null;
  review_status: string;
  is_published: boolean;
  updated_at: string;
  custom_category: string | null;
  product_categories: { name: string } | null;
};

type ProviderProductImage = {
  id: string;
  label: string;
  alt_text: string;
  image_url: string | null;
  storage_path: string | null;
  is_primary: boolean;
  sort_order: number;
  signed_url: string | null;
};

type ProviderProductDetails = ProviderProduct & {
  short_description: string;
  description: string;
  full_description: string;
  availability_summary: string;
  availability_status: string;
  lead_time_label: string;
  delivery_label: string;
  delivery_window: string;
  delivery_notes: string;
  offer_type: string;
  minimum_order: number | null;
  vat_inclusive: boolean;
  rental_duration_value: number | null;
  rental_duration_unit: string | null;
  created_at: string;
  product_images: ProviderProductImage[];
};

const reviewLabels: Record<string, string> = {
  draft: "مسودة",
  pending_review: "بانتظار المراجعة",
  approved: "معتمد",
  rejected: "مرفوض",
  needs_changes: "يحتاج تعديلات",
  inactive: "غير نشط",
};

const reviewClasses: Record<string, string> = {
  approved: "provider-status-success",
  rejected: "provider-status-danger",
  needs_changes: "provider-status-warning",
  pending_review: "provider-status-info",
};

export function ProviderProductsList() {
  const identity = useAuthIdentity();
  const searchParams = useSearchParams();
  const providerId = identity.details.provider?.providerId;
  const [products, setProducts] = useState<ProviderProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [details, setDetails] = useState<ProviderProductDetails | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState("");
  const [activeImage, setActiveImage] = useState(0);
  const detailRequest = useRef(0);

  useEffect(() => {
    let active = true;
    const load = async () => {
      if (!providerId) {
        if (active) {
          setError("تعذر تحديد منشأة المزود المرتبطة بالحساب.");
          setLoading(false);
        }
        return;
      }
      const { data, error: loadError } = await createClient()
        .from("products")
        .select("id,name,sku,base_unit,unit_price,stock_quantity,review_status,is_published,updated_at,custom_category,product_categories(name)")
        .eq("provider_id", providerId)
        .order("updated_at", { ascending: false });
      if (!active) return;
      if (loadError) setError("تعذر تحميل منتجات المنشأة. تحقق من الاتصال ثم أعد المحاولة.");
      else setProducts((data ?? []) as unknown as ProviderProduct[]);
      setLoading(false);
    };
    void load();
    return () => { active = false; };
  }, [providerId]);

  const filtered = useMemo(() => {
    const value = query.trim().toLocaleLowerCase("ar");
    if (!value) return products;
    return products.filter((product) =>
      product.name.toLocaleLowerCase("ar").includes(value) || product.sku?.toLocaleLowerCase("en").includes(value),
    );
  }, [products, query]);

  useEffect(() => {
    if (!detailId) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDetailId(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [detailId]);

  const closeDetails = () => {
    detailRequest.current += 1;
    setDetailId(null);
    setDetails(null);
    setDetailsError("");
    setActiveImage(0);
  };

  const openDetails = async (productId: string) => {
    const requestId = detailRequest.current + 1;
    detailRequest.current = requestId;
    setDetailId(productId);
    setDetails(null);
    setDetailsError("");
    setDetailsLoading(true);
    setActiveImage(0);

    if (!providerId) {
      setDetailsError("تعذر تحديد منشأة المزود المرتبطة بالحساب.");
      setDetailsLoading(false);
      return;
    }

    const db = createClient();
    const result = await db
      .from("products")
      .select(
        "id,name,sku,base_unit,unit_price,stock_quantity,review_status,is_published,updated_at,created_at,short_description,description,full_description,availability_summary,availability_status,lead_time_label,delivery_label,delivery_window,delivery_notes,offer_type,minimum_order,vat_inclusive,rental_duration_value,rental_duration_unit,custom_category,product_categories(name),product_images(id,label,alt_text,image_url,storage_path,is_primary,sort_order)",
      )
      .eq("id", productId)
      .eq("provider_id", providerId)
      .maybeSingle();

    if (detailRequest.current !== requestId) return;
    if (result.error || !result.data) {
      setDetailsError("تعذر تحميل تفاصيل المنتج. أعد المحاولة.");
      setDetailsLoading(false);
      return;
    }

    const product = result.data as unknown as Omit<ProviderProductDetails, "product_images"> & {
      product_images: Omit<ProviderProductImage, "signed_url">[];
    };
    const orderedImages = [...(product.product_images ?? [])].sort(
      (first, second) => Number(second.is_primary) - Number(first.is_primary) || first.sort_order - second.sort_order,
    );
    const hydratedImages = await Promise.all(
      orderedImages.map(async (image) => {
        if (!image.storage_path) return { ...image, signed_url: image.image_url };
        const signed = await db.storage.from("provider-product-images").createSignedUrl(image.storage_path, 600);
        return { ...image, signed_url: signed.data?.signedUrl ?? image.image_url };
      }),
    );

    if (detailRequest.current !== requestId) return;
    setDetails({ ...product, product_images: hydratedImages });
    setDetailsLoading(false);
  };

  return (
    <section className="provider-page-stack">
      <header className="provider-page-header">
        <div>
          <p>كتالوج المنشأة</p>
          <h2>المنتجات</h2>
          <span>أضف منتجات منشأتك وأرسلها للمراجعة قبل ظهورها في الكتالوج العام.</span>
        </div>
        <div><Link className="provider-primary" href="/merchant/products/new">＋ إضافة منتج</Link></div>
      </header>

      {searchParams.get("created") === "1" ? <p className="provider-toast" role="status">✓ تم إنشاء المنتج بنجاح.</p> : null}
      {error ? <p className="provider-toast provider-toast-error" role="alert">{error}</p> : null}

      <div className="provider-filters">
        <label className="provider-search">
          <span aria-hidden>⌕</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ابحث بالاسم أو رمز SKU" aria-label="البحث في المنتجات" />
        </label>
      </div>

      {loading ? (
        <div className="provider-skeleton" aria-label="جارٍ تحميل المنتجات"><i /><i /><i /></div>
      ) : filtered.length === 0 ? (
        <div className="provider-empty">
          <span aria-hidden>▦</span>
          <h3>{products.length ? "لا توجد نتائج مطابقة" : "لم تُضف منتجات بعد"}</h3>
          <p>{products.length ? "غيّر عبارة البحث لعرض المنتجات." : "أنشئ أول منتج وأرسله إلى الإدارة للمراجعة."}</p>
          {!products.length ? <Link className="provider-primary" href="/merchant/products/new">إضافة أول منتج</Link> : null}
        </div>
      ) : (
        <div className="provider-product-grid">
          {filtered.map((product) => (
            <article className={`${styles.clickableCard} provider-product-card`} key={product.id}>
              <button
                className={styles.cardTrigger}
                type="button"
                onClick={() => void openDetails(product.id)}
                aria-label={`عرض التفاصيل الكاملة للمنتج ${product.name}`}
              />
              <div className="provider-product-visual"><b>{product.name.slice(0, 1)}</b><span>{product.custom_category || product.product_categories?.name || "منتج"}</span></div>
              <div className="provider-product-body">
                <header>
                  <div><small>{product.sku || "بدون SKU"}</small><h3>{product.name}</h3></div>
                  <span className={`provider-status ${reviewClasses[product.review_status] ?? "provider-status-info"}`}>{reviewLabels[product.review_status] ?? product.review_status}</span>
                </header>
                <dl>
                  <div><dt>السعر</dt><dd>{product.unit_price === null ? "—" : `${Number(product.unit_price).toLocaleString("ar-SA")} ر.س`}</dd></div>
                  <div><dt>المخزون</dt><dd>{product.stock_quantity === null ? "—" : `${Number(product.stock_quantity).toLocaleString("ar-SA")} ${product.base_unit}`}</dd></div>
                  <div><dt>النشر</dt><dd>{product.is_published ? "منشور" : "غير منشور"}</dd></div>
                </dl>
                <p>آخر تحديث: {new Date(product.updated_at).toLocaleString("ar-SA")}</p>
                <span className={styles.viewHint}>عرض التفاصيل الكاملة <b aria-hidden>←</b></span>
              </div>
            </article>
          ))}
        </div>
      )}

      {detailId ? (
        <ProviderProductDetailsDialog
          product={details}
          loading={detailsLoading}
          error={detailsError}
          activeImage={activeImage}
          onActiveImage={setActiveImage}
          onClose={closeDetails}
          onRetry={() => void openDetails(detailId)}
        />
      ) : null}
    </section>
  );
}

function ProviderProductDetailsDialog({
  product,
  loading,
  error,
  activeImage,
  onActiveImage,
  onClose,
  onRetry,
}: {
  product: ProviderProductDetails | null;
  loading: boolean;
  error: string;
  activeImage: number;
  onActiveImage: (index: number) => void;
  onClose: () => void;
  onRetry: () => void;
}) {
  const images = product?.product_images.filter((image) => image.signed_url) ?? [];
  const shownImage = images[Math.min(activeImage, Math.max(images.length - 1, 0))];

  return (
    <div className="provider-modal-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section
        className={`${styles.detailModal} provider-modal`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="provider-product-detail-title"
        aria-busy={loading}
      >
        <button className="provider-modal-close" type="button" onClick={onClose} aria-label="إغلاق تفاصيل المنتج">×</button>

        {loading ? (
          <div className={styles.detailLoading} role="status">
            <span />
            <span />
            <span />
            <p>جارٍ تحميل تفاصيل المنتج…</p>
          </div>
        ) : error || !product ? (
          <div className={styles.detailError} role="alert">
            <b aria-hidden>!</b>
            <h3>تعذر عرض التفاصيل</h3>
            <p>{error || "لم يتم العثور على المنتج."}</p>
            <button className="provider-secondary" type="button" onClick={onRetry}>إعادة المحاولة</button>
          </div>
        ) : (
          <div className={styles.detailContent}>
            <header className={styles.detailHeader}>
              <div>
                <small>{product.custom_category || product.product_categories?.name || "منتج"} · {product.sku || "بدون SKU"}</small>
                <h3 id="provider-product-detail-title">{product.name}</h3>
              </div>
              <span className={`provider-status ${reviewClasses[product.review_status] ?? "provider-status-info"}`}>
                {reviewLabels[product.review_status] ?? product.review_status}
              </span>
            </header>

            {product.review_status === "pending_review" ? (
              <p className={styles.readOnlyNotice}>⌛ المنتج تحت المراجعة. يمكنك مشاهدة جميع بياناته، ولا يمكن تعديله حتى تنتهي المراجعة.</p>
            ) : null}

            <div className={styles.gallery}>
              {shownImage?.signed_url ? (
                <Image
                  className={styles.heroImage}
                  src={shownImage.signed_url}
                  alt={shownImage.alt_text || product.name}
                  width={1200}
                  height={800}
                  unoptimized
                />
              ) : (
                <div className={styles.imageFallback}><b>{product.name.slice(0, 1)}</b><span>لا توجد صورة متاحة</span></div>
              )}
              {images.length > 1 ? (
                <div className={styles.thumbnails} aria-label="صور المنتج">
                  {images.map((image, index) => (
                    <button
                      type="button"
                      key={image.id}
                      className={index === activeImage ? styles.activeThumbnail : undefined}
                      onClick={() => onActiveImage(index)}
                      aria-label={`عرض الصورة ${index + 1}`}
                      aria-pressed={index === activeImage}
                    >
                      <Image src={image.signed_url!} alt="" width={160} height={110} unoptimized />
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <section className={styles.detailSection}>
              <h4>السعر والمخزون</h4>
              <dl className={styles.detailGrid}>
                <DetailValue label="نوع العرض" value={product.offer_type === "rental" ? "تأجير" : "بيع"} />
                <DetailValue label="السعر" value={product.unit_price === null ? "غير محدد" : `${formatProductNumber(product.unit_price, 2)} ر.س / ${product.base_unit}`} />
                <DetailValue label="الضريبة" value={product.vat_inclusive ? "السعر شامل الضريبة" : "السعر غير شامل الضريبة"} />
                <DetailValue label="الحد الأدنى" value={product.minimum_order === null ? "غير محدد" : `${formatProductNumber(product.minimum_order)} ${product.base_unit}`} />
                <DetailValue label="المخزون" value={product.stock_quantity === null ? "غير محدد" : `${formatProductNumber(product.stock_quantity)} ${product.base_unit}`} />
                <DetailValue label="حالة النشر" value={product.is_published ? "منشور" : "غير منشور"} />
                {product.offer_type === "rental" ? <DetailValue label="مدة التأجير" value={`${formatProductNumber(product.rental_duration_value)} ${product.rental_duration_unit || ""}`} /> : null}
              </dl>
            </section>

            <section className={styles.detailSection}>
              <h4>وصف المنتج</h4>
              <p className={styles.description}>{product.full_description || product.description || product.short_description}</p>
            </section>

            <section className={styles.detailSection}>
              <h4>التوفر والتوصيل</h4>
              <dl className={styles.detailGrid}>
                <DetailValue label="حالة التوفر" value={availabilityLabels[product.availability_status] ?? product.availability_status} />
                {product.availability_status === "limited" ? <DetailValue label="الكمية المحدودة" value={product.stock_quantity === null ? "غير محددة" : `${formatProductNumber(product.stock_quantity)} ${product.base_unit}`} /> : null}
                <DetailValue label="مدة التجهيز" value={product.lead_time_label} />
                <DetailValue label="نافذة التوصيل" value={product.delivery_window} />
                <DetailValue label="ملاحظات التوصيل" value={product.delivery_notes} wide />
              </dl>
            </section>

            <footer className={styles.detailFooter}>
              <div><span>تاريخ الإضافة</span><b>{new Date(product.created_at).toLocaleString("ar-SA")}</b></div>
              <div><span>آخر تحديث</span><b>{new Date(product.updated_at).toLocaleString("ar-SA")}</b></div>
              <button className="provider-secondary" type="button" onClick={onClose}>إغلاق</button>
            </footer>
          </div>
        )}
      </section>
    </div>
  );
}

function DetailValue({ label, value, wide = false }: { label: string; value: string; wide?: boolean }) {
  return <div className={wide ? styles.wideDetail : undefined}><dt>{label}</dt><dd>{value || "—"}</dd></div>;
}

const availabilityLabels: Record<string, string> = {
  available: "متوفر",
  limited: "كمية محدودة",
  on_request: "حسب الطلب",
  unavailable: "غير متوفر حاليًا",
  out_of_stock: "غير متوفر حاليًا",
};

function formatProductNumber(value: number | null, maximumFractionDigits = 3) {
  if (value === null) return "غير محدد";
  return Number(value).toLocaleString("ar-SA", { maximumFractionDigits });
}

export function ProviderProductCreate() {
  const identity = useAuthIdentity();
  const router = useRouter();
  const providerId = identity.details.provider?.providerId;
  const [categories, setCategories] = useState<Category[]>([]);
  const [loadingCategories, setLoadingCategories] = useState(true);
  const [offerType, setOfferType] = useState("sale");
  const [categoryId, setCategoryId] = useState("");
  const [availabilityStatus, setAvailabilityStatus] = useState("available");
  const [images, setImages] = useState<SelectedImage[]>([]);
  const previewUrls = useRef<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void createClient().from("product_categories").select("id,name").eq("is_active", true).order("sort_order").then(({ data, error: categoryError }) => {
      if (!active) return;
      if (categoryError) setError("تعذر تحميل تصنيفات المنتجات.");
      else setCategories((data ?? []) as Category[]);
      setLoadingCategories(false);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => () => {
    previewUrls.current.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  const selectImages = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.target.files ?? []);
    const invalid = selected.find((file) => !["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 5 * 1024 * 1024);
    if (invalid) {
      setError(`الصورة ${invalid.name} غير مدعومة أو أكبر من 5MB.`);
      event.target.value = "";
      return;
    }
    const existing = new Set(images.map(({ file }) => `${file.name}:${file.size}:${file.lastModified}`));
    const additions = selected.filter((file) => !existing.has(`${file.name}:${file.size}:${file.lastModified}`));
    if (images.length + additions.length > 6) {
      setError(`يمكن رفع 6 صور كحد أقصى. لديك ${images.length.toLocaleString("ar-SA")} صورة محددة حاليًا.`);
      event.target.value = "";
      return;
    }
    const next = [...images, ...additions.map((file) => ({ file, preview: URL.createObjectURL(file) }))];
    previewUrls.current = next.map((image) => image.preview);
    setImages(next);
    setError(additions.length || selected.length === 0 ? "" : "الصور المحددة مضافة مسبقًا.");
    event.target.value = "";
  };

  const removeImage = (index: number) => {
    setImages((current) => {
      URL.revokeObjectURL(current[index].preview);
      const next = current.filter((_, imageIndex) => imageIndex !== index);
      previewUrls.current = next.map((image) => image.preview);
      return next;
    });
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setError("");
    if (!providerId) {
      setError("تعذر تحديد منشأة المزود المرتبطة بالحساب.");
      return;
    }

    const form = new FormData(event.currentTarget);
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const reviewStatus = submitter?.value === "pending_review" ? "pending_review" : "draft";
    const rentalDurationValue = Number(form.get("rental_duration_value") || 0);
    const rentalDurationUnit = String(form.get("rental_duration_unit") ?? "").trim();
    if (offerType === "rental" && (!rentalDurationValue || !rentalDurationUnit)) {
      setError("حدد مدة التأجير ووحدتها للمنتج المعروض للإيجار.");
      return;
    }
    if (reviewStatus === "pending_review" && images.length === 0) {
      setError("أضف صورة واحدة على الأقل قبل إرسال المنتج للمراجعة.");
      return;
    }
    const limitedQuantity = Number(form.get("stock_quantity") || 0);
    if (availabilityStatus === "limited" && limitedQuantity <= 0) {
      setError("حدد الكمية المتوفرة عندما تكون حالة التوفر «كمية محدودة».");
      return;
    }

    setBusy(true);
    try {
      form.set("intent", reviewStatus);
      const optimizedImages = await Promise.all(images.map((image) => optimizeUploadFile(image.file)));
      optimizedImages.forEach((image) => form.append("images", image, image.name));
      const response = await fetch("/api/provider/products", { method: "POST", body: form });
      const result = await response.json() as { error?: string };
      if (!response.ok) {
        setError(result.error ?? "تعذر إنشاء المنتج.");
        return;
      }
      previewUrls.current.forEach((url) => URL.revokeObjectURL(url));
      previewUrls.current = [];
      setImages([]);
      router.push("/merchant/products?created=1");
      router.refresh();
    } catch {
      setError("تعذر الاتصال بالخادم أثناء إنشاء المنتج.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="provider-page-stack">
      <header className="provider-page-header">
        <div>
          <p>كتالوج المنشأة</p>
          <h2>إضافة منتج جديد</h2>
          <span>احفظه كمسودة لإكماله لاحقًا، أو أرسله للمراجعة ليتم اعتماده ونشره.</span>
        </div>
        <div><Link className="provider-secondary" href="/merchant/products">العودة للمنتجات</Link></div>
      </header>

      <form className="provider-product-form" onSubmit={submit}>
        <fieldset className="provider-form-section">
          <legend><span>1</span> البيانات الأساسية</legend>
          <div className="provider-form-grid">
            <label className="provider-field"><span>اسم المنتج *</span><input name="name" required minLength={2} maxLength={160} /></label>
            <label className="provider-field"><span>التصنيف *</span><select name="category_id" required disabled={loadingCategories} value={categoryId} onChange={(event) => setCategoryId(event.target.value)}><option value="">{loadingCategories ? "جارٍ تحميل التصنيفات…" : "اختر التصنيف"}</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}<option value="other">أخرى</option></select></label>
            {categoryId === "other" ? <label className="provider-field"><span>اكتب التصنيف الآخر *</span><input name="custom_category" required minLength={2} maxLength={80} placeholder="مثال: مواد عزل صوتي" /></label> : null}
            <label className="provider-field"><span>رمز SKU</span><input name="sku" maxLength={80} dir="ltr" placeholder="اختياري" /></label>
            <label className="provider-field"><span>وحدة البيع *</span><input name="base_unit" required defaultValue="وحدة" placeholder="كيس، طن، متر…" /></label>
            <label className="provider-field wide"><span>وصف المنتج *</span><textarea name="description" required minLength={10} rows={4} placeholder="اكتب وصفًا واضحًا ومواصفات المنتج الأساسية" /></label>
          </div>
        </fieldset>

        <fieldset className="provider-form-section">
          <legend><span>2</span> صور المنتج</legend>
          <label className="provider-image-drop">
            <span aria-hidden>▧</span>
            <strong>اختر صور المنتج</strong>
            <small>JPEG أو PNG أو WebP، حتى 5MB للصورة، وبحد أقصى 6 صور. يمكنك الضغط مرة أخرى لإضافة صور دون حذف المحدد سابقًا، والصورة الأولى ستكون الرئيسية.</small>
            <input className="provider-image-input" type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={selectImages} />
          </label>
          {images.length ? <div className="provider-image-list">{images.map((image, index) => <article key={`${image.file.name}-${image.file.lastModified}`}>
            <Image src={image.preview} alt={`معاينة ${image.file.name}`} width={320} height={224} unoptimized />
            <strong>{image.file.name}</strong>
            <small>{index === 0 ? "الصورة الرئيسية" : `الصورة ${index + 1}`} · {(image.file.size / 1024 / 1024).toLocaleString("ar-SA", { maximumFractionDigits: 2 })}MB</small>
            <footer><button type="button" onClick={() => removeImage(index)}>إزالة</button></footer>
          </article>)}</div> : <p className="provider-muted">يمكن حفظ المسودة دون صور، لكن يلزم إرفاق صورة واحدة على الأقل عند الإرسال للمراجعة.</p>}
        </fieldset>

        <fieldset className="provider-form-section">
          <legend><span>3</span> السعر والمخزون</legend>
          <div className="provider-form-grid compact">
            <label className="provider-field"><span>نوع العرض *</span><select name="offer_type" value={offerType} onChange={(event) => setOfferType(event.target.value)}><option value="sale">بيع</option><option value="rental">تأجير</option></select></label>
            <label className="provider-field"><span>سعر الوحدة (ر.س) *</span><input name="unit_price" type="number" min="0" step="0.01" required /></label>
            <label className="provider-field"><span>الحد الأدنى للطلب</span><input name="minimum_order" type="number" min="0.001" step="0.001" /></label>
            <label className="provider-check"><input name="vat_inclusive" type="checkbox" defaultChecked /> السعر شامل ضريبة القيمة المضافة</label>
            {offerType === "rental" ? <><label className="provider-field"><span>مدة التأجير *</span><input name="rental_duration_value" type="number" min="0.01" step="0.01" required /></label><label className="provider-field"><span>وحدة المدة *</span><select name="rental_duration_unit" required><option value="">اختر</option><option value="ساعة">ساعة</option><option value="يوم">يوم</option><option value="أسبوع">أسبوع</option><option value="شهر">شهر</option></select></label></> : null}
          </div>
        </fieldset>

        <fieldset className="provider-form-section">
          <legend><span>4</span> التوفر والتوصيل</legend>
          <div className="provider-form-grid">
            <label className="provider-field"><span>حالة التوفر *</span><select name="availability_status" value={availabilityStatus} onChange={(event) => setAvailabilityStatus(event.target.value)}><option value="available">متوفر</option><option value="limited">كمية محدودة</option><option value="on_request">حسب الطلب</option><option value="unavailable">غير متوفر حاليًا</option></select></label>
            {availabilityStatus === "limited" ? <label className="provider-field"><span>الكمية المتوفرة *</span><input name="stock_quantity" type="number" min="0.001" step="0.001" required placeholder="حدد الكمية المحدودة" /></label> : null}
            <label className="provider-field"><span>مدة التجهيز *</span><input name="lead_time_label" required defaultValue="خلال 24 ساعة" /></label>
            <label className="provider-field"><span>نافذة التوصيل *</span><input name="delivery_window" required defaultValue="يتم تحديدها بعد اعتماد الطلب" /></label>
            <label className="provider-field wide"><span>ملاحظات التوصيل *</span><textarea name="delivery_notes" required rows={3} defaultValue="يتم تنسيق موعد وموقع التسليم مع العميل بعد اعتماد الطلب." /></label>
          </div>
        </fieldset>

        {error ? <p className="provider-toast provider-toast-error" role="alert">{error}</p> : null}
        <footer className="provider-form-actions">
          <Link className="provider-secondary" href="/merchant/products">إلغاء</Link>
          <button className="provider-secondary" name="intent" value="draft" type="submit" disabled={busy || loadingCategories}>{busy ? "جارٍ الحفظ…" : "حفظ كمسودة"}</button>
          <button className="provider-primary" name="intent" value="pending_review" type="submit" disabled={busy || loadingCategories}>{busy ? "جارٍ الإرسال…" : "حفظ وإرسال للمراجعة"}</button>
        </footer>
      </form>
    </section>
  );
}
