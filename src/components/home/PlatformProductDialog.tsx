"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { Product } from "@/lib/bunya-types";
import { filterCatalogVariants, parsePlatformDetails, type PlatformProductDetails } from "@/lib/catalog/platform-details";
import { Icon, ProductArtwork } from "./HomeStorefrontUi";

export type PlatformCatalogSelection = {
  sku: string;
  attributes: { label: string; value: string }[];
  quantity: number;
  unit: string;
  notes: string;
};

export function PlatformProductDialog({ product, onClose, onAddSelection, onReviewQuote }: {
  product: Product;
  onClose: () => void;
  onAddSelection: (selection: PlatformCatalogSelection) => string | null;
  onReviewQuote: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [details, setDetails] = useState<PlatformProductDetails | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [imageIndex, setImageIndex] = useState(0);
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [visibleCount, setVisibleCount] = useState(30);
  const [selectedSku, setSelectedSku] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unit, setUnit] = useState(product.units[0] || "تحددها الإدارة");
  const [notes, setNotes] = useState("");
  const [formError, setFormError] = useState("");
  const [added, setAdded] = useState(false);

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
  const selectedVariant = details?.variants.find(variant => variant.sku === selectedSku);
  function selectSku(sku: string) {
    setSelectedSku(sku);
    setAdded(false);
    setFormError("");
  }
  function addSelection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAdded(false);
    const amount = Number(quantity);
    if (!details || (details.variants.length > 0 && !selectedVariant)) { setFormError("اختر المواصفات المطلوبة للمنتج."); return; }
    if (!quantity.trim() || !Number.isFinite(amount) || amount < .001 || amount > 1000000 || amount !== Number(amount.toFixed(3))) {
      setFormError("أدخل كمية بين 0.001 ومليون، بحد أقصى ثلاث خانات عشرية."); return;
    }
    const units = details.units.length ? details.units : ["تحددها الإدارة"];
    if (!units.includes(unit)) { setFormError("اختر وحدة متاحة لهذا المنتج."); return; }
    const message = onAddSelection({ sku: selectedVariant?.sku || "", attributes: selectedVariant?.attributes || [], quantity: amount, unit, notes: notes.trim() });
    setFormError(message || "");
    setAdded(!message);
  }
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
            <p className="sf-catalog-note">اختر مواصفات منتجاتك وكمياتها وأرسل طلبك لإدارة بُنية. الإدارة تجهز لك عرض السعر والتوصيل والضمان.</p>
          </div>
        </div>
        {!details && !error && <p className="sf-catalog-state" role="status">جارٍ تحميل المواصفات والخيارات…</p>}
        {error && <div className="sf-catalog-state" role="alert"><p>تعذر تحميل التفاصيل. حاول مرة أخرى.</p><button type="button" onClick={() => { setError(false); setAttempt(value => value + 1); }}>إعادة المحاولة</button></div>}
        {details && <form className="sf-catalog-add-form" onSubmit={addSelection} aria-label="إضافة المنتج إلى طلب عرض السعر">
          <h3>أضف إلى طلب عرض السعر</h3>
          <label className="sf-catalog-sku-select"><span>المواصفات المطلوبة</span><select value={selectedSku} disabled={!details.variants.length} onChange={event => selectSku(event.target.value)} aria-describedby="catalog-selected-specification">
            <option value="">{details.variants.length ? "اختر خيار المنتج" : "تحدد المواصفات مع الإدارة"}</option>
            {details.variants.map(variant => <option key={variant.sku} value={variant.sku}>{variant.attributes.map(attribute => `${attribute.label}: ${attribute.value}`).join(" · ") || variant.sku}</option>)}
          </select></label>
          <p id="catalog-selected-specification" className="sf-catalog-selected-specification">{selectedVariant ? <><b dir="ltr">{selectedVariant.sku}</b><span>{selectedVariant.attributes.map(attribute => `${attribute.label}: ${attribute.value}`).join(" · ") || "لم تُنشر مواصفات إضافية لهذا الرمز."}</span></> : details.variants.length ? "يمكنك البحث في الخيارات أدناه ثم اختيار المواصفات المناسبة." : "لم تُنشر خيارات لهذا المنتج. يمكنك إضافته، وستوضح الإدارة مواصفاته في عرض السعر."}</p>
          <div className="sf-catalog-add-fields">
            <label><span>الكمية</span><input type="number" min="0.001" max="1000000" step="0.001" value={quantity} onChange={event => { setQuantity(event.target.value); setAdded(false); setFormError(""); }} /></label>
            <label><span>الوحدة</span><select value={unit} onChange={event => { setUnit(event.target.value); setAdded(false); setFormError(""); }}>{(details.units.length ? details.units : ["تحددها الإدارة"]).map(value => <option key={value} value={value}>{value}</option>)}</select></label>
            <label className="sf-catalog-add-notes"><span>ملاحظات اختيارية</span><textarea rows={2} maxLength={1000} value={notes} onChange={event => { setNotes(event.target.value); setAdded(false); }} placeholder="أي تفاصيل إضافية عن هذا المنتج" /></label>
          </div>
          {formError && <p className="sf-catalog-form-error" role="alert">{formError}</p>}
          {added && <p className="sf-catalog-added" role="status">تمت إضافة المنتج إلى طلب عرض السعر.</p>}
          <div className="sf-catalog-add-actions"><button className="sf-catalog-add-button" type="submit">إضافة المنتج إلى عرض السعر</button><button type="button" onClick={onClose}>متابعة اختيار المنتجات</button>{added && <button type="button" onClick={onReviewQuote}>مراجعة طلب عرض السعر</button>}</div>
        </form>}
        {details && <section className="sf-catalog-options" aria-labelledby="catalog-options-title">
          <div className="sf-catalog-options-heading"><h3 id="catalog-options-title">الخيارات والمواصفات</h3><span aria-live="polite">{variants.length.toLocaleString("ar-SA")} خيار</span></div>
          <div className="sf-catalog-option-filters">
            <label><span>ابحث في الخيارات</span><input type="search" value={query} placeholder="علامة تجارية، مقاس أو رمز…" onChange={event => { setQuery(event.target.value); setVisibleCount(30); }} /></label>
            {details.attributes.map(attribute => <label key={attribute.label}><span>{attribute.label}</span><select value={filters[attribute.label] || ""} onChange={event => { setFilters(current => ({ ...current, [attribute.label]: event.target.value })); setVisibleCount(30); }}><option value="">الكل</option>{attribute.values.map(value => <option key={value} value={value}>{value}</option>)}</select></label>)}
          </div>
          {(query || Object.values(filters).some(Boolean)) && <button className="sf-catalog-reset" type="button" onClick={() => { setQuery(""); setFilters({}); setVisibleCount(30); }}>مسح التصفية</button>}
          <div className="sf-catalog-variants">
            {variants.slice(0, visibleCount).map(variant => <article className="sf-catalog-variant" key={variant.sku} data-selected={selectedSku === variant.sku}><dl>{variant.attributes.map((attribute, index) => <div key={`${attribute.label}-${index}`}><dt>{attribute.label}</dt><dd>{attribute.value}</dd></div>)}</dl>{!variant.attributes.length && <p>لم تُنشر مواصفات إضافية لهذا الرمز.</p>}<p className="sf-catalog-sku">رمز الخيار <b dir="ltr">{variant.sku}</b></p><button type="button" className="sf-catalog-select-variant" aria-pressed={selectedSku === variant.sku} aria-label={`اختيار المواصفات ${variant.sku}`} onClick={() => selectSku(variant.sku)}>{selectedSku === variant.sku ? "المواصفات المختارة" : "اختيار هذه المواصفات"}</button></article>)}
          </div>
          {!variants.length && <p className="sf-catalog-state">{details.variants.length ? "لا توجد خيارات تطابق التصفية الحالية." : "المواصفات التفصيلية تحددها الإدارة في عرض السعر."}</p>}
          {variants.length > visibleCount && <button className="sf-catalog-more" type="button" onClick={() => setVisibleCount(value => value + 30)}>عرض المزيد من الخيارات ({(variants.length - visibleCount).toLocaleString("ar-SA")})</button>}
        </section>}
      </div>
    </dialog>
  );
}
