"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Product } from "@/lib/bunya-types";
import { filterCatalogVariants, parsePlatformDetails, type PlatformProductDetails } from "@/lib/catalog/platform-details";
import { Icon, ProductArtwork } from "./HomeStorefrontUi";

export function PlatformProductDialog({ product, onClose }: { product: Product; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [details, setDetails] = useState<PlatformProductDetails | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [imageIndex, setImageIndex] = useState(0);
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [visibleCount, setVisibleCount] = useState(30);

  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    dialog?.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      dialog?.close();
      document.body.style.overflow = overflow;
      previousFocus?.focus();
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(product.catalogEntry!.detailsPath, { signal: controller.signal });
        if (!response.ok) throw new Error("Catalog unavailable");
        const data = parsePlatformDetails(await response.json(), product.id);
        if (!controller.signal.aborted) setDetails(data);
      } catch {
        if (!controller.signal.aborted) setError(true);
      }
    }
    void load();
    return () => controller.abort();
  }, [product.id, product.catalogEntry, attempt]);

  const variants = useMemo(() => filterCatalogVariants(details?.variants ?? [], query, filters), [details, query, filters]);
  return (
    <dialog className="sf-catalog-dialog" ref={dialogRef} aria-labelledby="platform-product-title" onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="sf-catalog-dialog-inner">
        <header className="sf-catalog-dialog-header">
          <div><p>{product.category} / {product.catalogEntry?.subcategory}</p><h2 id="platform-product-title">{product.name}</h2></div>
          <button className="sf-catalog-close" type="button" aria-label="إغلاق تفاصيل المنتج" onClick={onClose}><Icon name="close" /></button>
        </header>
        <div className="sf-catalog-overview">
          <div>
            <ProductArtwork image={product.images[imageIndex]} large />
            {product.images.length > 1 && <div className="sf-catalog-thumbs" aria-label="صور المنتج">{product.images.map((image, index) => <button key={image.id} type="button" aria-label={`عرض صورة ${index + 1}`} aria-pressed={imageIndex === index} onClick={() => setImageIndex(index)}><ProductArtwork image={image} /></button>)}</div>}
          </div>
          <div className="sf-catalog-summary">
            <span className="sf-catalog-label">كتالوج بُنية</span>
            <p>{product.description}</p>
            <dl><div><dt>التصنيف</dt><dd>{product.category}</dd></div><div><dt>التصنيف الفرعي</dt><dd>{product.catalogEntry?.subcategory}</dd></div><div><dt>وحدات القياس</dt><dd>{product.units.join("، ") || "غير محددة"}</dd></div><div><dt>الخيارات</dt><dd>{product.catalogEntry?.variantCount.toLocaleString("ar-SA")}</dd></div></dl>
            <p className="sf-catalog-note">استعرض المواصفات والعلامات التجارية والمقاسات لكل خيار. الأسعار والتوفر والتوصيل لم تُحدد بعد.</p>
          </div>
        </div>
        {!details && !error && <p className="sf-catalog-state" role="status">جارٍ تحميل المواصفات والخيارات…</p>}
        {error && <div className="sf-catalog-state" role="alert"><p>تعذر تحميل التفاصيل. حاول مرة أخرى.</p><button type="button" onClick={() => { setError(false); setAttempt(value => value + 1); }}>إعادة المحاولة</button></div>}
        {details && <section className="sf-catalog-options" aria-labelledby="catalog-options-title">
          <div className="sf-catalog-options-heading"><h3 id="catalog-options-title">الخيارات والمواصفات</h3><span aria-live="polite">{variants.length.toLocaleString("ar-SA")} خيار</span></div>
          <div className="sf-catalog-option-filters">
            <label><span>ابحث في الخيارات</span><input type="search" value={query} placeholder="علامة تجارية، مقاس أو رمز…" onChange={event => { setQuery(event.target.value); setVisibleCount(30); }} /></label>
            {details.attributes.map(attribute => <label key={attribute.label}><span>{attribute.label}</span><select value={filters[attribute.label] || ""} onChange={event => { setFilters(current => ({ ...current, [attribute.label]: event.target.value })); setVisibleCount(30); }}><option value="">الكل</option>{attribute.values.map(value => <option key={value} value={value}>{value}</option>)}</select></label>)}
          </div>
          {(query || Object.values(filters).some(Boolean)) && <button className="sf-catalog-reset" type="button" onClick={() => { setQuery(""); setFilters({}); setVisibleCount(30); }}>مسح التصفية</button>}
          <div className="sf-catalog-variants">
            {variants.slice(0, visibleCount).map(variant => <article className="sf-catalog-variant" key={variant.sku}><dl>{variant.attributes.map((attribute, index) => <div key={`${attribute.label}-${index}`}><dt>{attribute.label}</dt><dd>{attribute.value}</dd></div>)}</dl>{!variant.attributes.length && <p>لم تُنشر مواصفات إضافية لهذا الرمز.</p>}<p className="sf-catalog-sku">رمز الخيار <b dir="ltr">{variant.sku}</b></p></article>)}
          </div>
          {!variants.length && <p className="sf-catalog-state">لا توجد خيارات تطابق التصفية الحالية.</p>}
          {variants.length > visibleCount && <button className="sf-catalog-more" type="button" onClick={() => setVisibleCount(value => value + 30)}>عرض المزيد من الخيارات ({(variants.length - visibleCount).toLocaleString("ar-SA")})</button>}
        </section>}
      </div>
    </dialog>
  );
}
