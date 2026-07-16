"use client";

import type { FormEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import Link from "next/link";
import type { Product, ProductCategory, QuoteRequestItem } from "@/lib/bunya-types";
import {PwaInstallPrompt} from "./PwaInstallPrompt";
import { Icon, LatestProductCard, ProductArtwork, ProductCard, StoreHeader } from "./home/HomeStorefrontUi";

type HomeStorefrontProps = {
  categories: ProductCategory[];
  products: Product[];
};

type QuoteFormState = {
  quantity: number;
  unit: string;
  measurementId: string;
  desiredReceiptDate: string;
  mapsUrl: string;
  notes: string;
};

type QuoteErrors = Partial<Record<keyof QuoteFormState, string>>;

const quoteStorageKey = "bunya-home-quote-items";

type StoreViewTransition = { finished: Promise<void> };
type StoreViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => StoreViewTransition;
};

function getTodayValue() {
  return new Date().toISOString().slice(0, 10);
}

function createInitialForm(product: Product): QuoteFormState {
  const defaultMeasurement = product.measurements.find((item) => item.isDefault) ?? product.measurements[0];

  return {
    quantity: 1,
    unit: defaultMeasurement?.unit ?? product.unit,
    measurementId: defaultMeasurement?.id ?? "",
    desiredReceiptDate: getTodayValue(),
    mapsUrl: "",
    notes: "",
  };
}

function isQuoteRequestItem(value: unknown): value is QuoteRequestItem {
  if (!value || typeof value !== "object") {
    return false;
  }

  const item = value as Record<string, unknown>;
  return (
    typeof item.id === "string" &&
    typeof item.productId === "string" &&
    typeof item.productName === "string" &&
    typeof item.quantity === "number" &&
    typeof item.unit === "string" &&
    typeof item.measurementId === "string" &&
    typeof item.measurementLabel === "string" &&
    typeof item.desiredReceiptDate === "string" &&
    typeof item.mapsUrl === "string" &&
    typeof item.createdAt === "string"
  );
}

function readQuoteItems(): QuoteRequestItem[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(quoteStorageKey);
    if (!raw) {
      return [];
    }

    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isQuoteRequestItem) : [];
  } catch {
    return [];
  }
}

function createQuoteId(productId: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${productId}-${Date.now()}`;
}

function isGoogleMapsUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }

  try {
    const url = new URL(trimmed);
    const host = url.hostname.toLowerCase();
  return (
      host === "maps.app.goo.gl" ||
      host === "goo.gl" ||
      (host.endsWith("google.com") && url.pathname.includes("/maps")) ||
      host.startsWith("maps.google.")
    );
  } catch {
    return false;
  }
}

export function HomeStorefront({ categories, products }: HomeStorefrontProps) {
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<ProductCategory | "الكل">("الكل");
  const [headerCompact, setHeaderCompact] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [activeImageId, setActiveImageId] = useState<string>("");
  const [quoteItems, setQuoteItems] = useState<QuoteRequestItem[]>([]);
  const [quoteForm, setQuoteForm] = useState<QuoteFormState>(() => createInitialForm(products[0]));
  const [errors, setErrors] = useState<QuoteErrors>({});
  const [feedback, setFeedback] = useState("");
  const [duplicateItemId, setDuplicateItemId] = useState<string | null>(null);
  const storageReadyRef = useRef(false);
  const storefrontRef = useRef<HTMLElement>(null);
  const productOriginRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const onScroll = () => setHeaderCompact(window.scrollY > 20);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const root = storefrontRef.current;
    if (!root) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const elements = Array.from(root.querySelectorAll<HTMLElement>("[data-store-reveal]"));
    if (reduceMotion || !("IntersectionObserver" in window)) {
      elements.forEach((element) => element.classList.add("store-revealed"));
      return;
    }

    root.classList.add("store-motion-ready");
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("store-revealed");
        observer.unobserve(entry.target);
      });
    }, { rootMargin: "0px 0px -8%", threshold: 0.08 });
    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      storageReadyRef.current = true;
      setQuoteItems(readQuoteItems());
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, []);

  useEffect(() => {
    if (!selectedProduct) {
      return;
    }

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectedProduct(null);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [selectedProduct]);

  useEffect(() => {
    if (!storageReadyRef.current) {
      return;
    }

    try {
      window.localStorage.setItem(quoteStorageKey, JSON.stringify(quoteItems));
    } catch {
      // The in-memory request remains usable even if persistent storage is blocked.
    }
  }, [quoteItems]);

  const filteredProducts = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return products.filter((product) => {
      const matchesCategory = activeCategory === "الكل" || product.category === activeCategory;
      const matchesQuery =
        !normalizedQuery ||
        product.name.toLowerCase().includes(normalizedQuery) ||
        product.category.toLowerCase().includes(normalizedQuery) ||
        product.description.toLowerCase().includes(normalizedQuery);

      return matchesCategory && matchesQuery;
    });
  }, [activeCategory, products, query]);

  const latestProducts = useMemo(() => products.filter((product) => product.isNew).slice(0, 4), [products]);
  const activeImage = selectedProduct?.images.find((image) => image.id === activeImageId) ?? selectedProduct?.images[0];
  const selectedMeasurement = selectedProduct?.measurements.find((item) => item.id === quoteForm.measurementId);

  const runViewTransition = (update: () => void) => {
    const transitionDocument = document as StoreViewTransitionDocument;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!transitionDocument.startViewTransition || reduceMotion) {
      update();
      return null;
    }
    return transitionDocument.startViewTransition(() => flushSync(update));
  };

  const updateFilters = (update: () => void) => {
    runViewTransition(update);
  };

  const openProduct = (product: Product, origin: HTMLElement) => {
    productOriginRef.current = origin;
    origin.style.viewTransitionName = "store-product-detail";
    const transition = runViewTransition(() => {
      origin.style.viewTransitionName = "";
      setActiveImageId(product.images[0]?.id ?? "");
      setQuoteForm(createInitialForm(product));
      setErrors({});
      setFeedback("");
      setSelectedProduct(product);
    });
    if (!transition) origin.style.viewTransitionName = "";
  };

  const closeProduct = () => {
    const origin = productOriginRef.current;
    const transition = runViewTransition(() => {
      if (origin?.isConnected) origin.style.viewTransitionName = "store-product-detail";
      setSelectedProduct(null);
    });
    if (origin && transition) transition.finished.finally(() => { origin.style.viewTransitionName = ""; });
    else if (origin) origin.style.viewTransitionName = "";
  };

  const updateForm = <Key extends keyof QuoteFormState>(key: Key, value: QuoteFormState[Key]) => {
    setQuoteForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
    setFeedback("");
  };

  const validateQuote = () => {
    const nextErrors: QuoteErrors = {};

    if (!quoteForm.quantity || quoteForm.quantity < 1) {
      nextErrors.quantity = "أدخل كمية صحيحة أكبر من صفر.";
    }

    if (!quoteForm.unit) {
      nextErrors.unit = "اختر وحدة الطلب.";
    }

    if (!quoteForm.measurementId) {
      nextErrors.measurementId = "اختر القياس المطلوب.";
    }

    if (!quoteForm.desiredReceiptDate) {
      nextErrors.desiredReceiptDate = "حدد موعد الاستلام المطلوب.";
    }

    if (!isGoogleMapsUrl(quoteForm.mapsUrl)) {
      nextErrors.mapsUrl = "ألصق رابط Google Maps صالحا لموقع التسليم.";
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const addQuoteItem = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedProduct || !selectedMeasurement || !validateQuote()) {
      setFeedback("راجع الحقول المطلوبة قبل إضافة المنتج.");
      return;
    }

    const item: QuoteRequestItem = {
      id: createQuoteId(selectedProduct.id),
      productId: selectedProduct.id,
      productName: selectedProduct.name,
      quantity: quoteForm.quantity,
      unit: quoteForm.unit,
      measurementId: selectedMeasurement.id,
      measurementLabel: selectedMeasurement.label,
      desiredReceiptDate: quoteForm.desiredReceiptDate,
      mapsUrl: quoteForm.mapsUrl.trim(),
      notes: quoteForm.notes.trim() || undefined,
      createdAt: new Date().toISOString(),
    };

    const duplicate = quoteItems.find((current) =>
      current.productId === item.productId &&
      current.measurementId === item.measurementId &&
      current.unit === item.unit
    );
    if (duplicate) {
      setDuplicateItemId(duplicate.id);
      setFeedback("هذا المنتج موجود بنفس القياس والوحدة. يمكنك زيادة كميته بدل تكراره.");
      return;
    }

    storageReadyRef.current = true;
    setDuplicateItemId(null);
    setQuoteItems((current) => [item, ...current]);
    setFeedback("تمت إضافة المنتج إلى طلب عرض السعر محليا.");
  };

  return (
    <main className="store-home min-h-screen overflow-hidden text-white" ref={storefrontRef}>
      <StoreHeader compact={headerCompact} menuOpen={mobileMenuOpen} onMenuToggle={() => setMobileMenuOpen((current) => !current)} onNavigate={() => setMobileMenuOpen(false)} quoteCount={quoteItems.length} />

      <section className="store-intro px-4" data-store-reveal>
        <div className="store-intro-copy mx-auto">
          <h1>مواد البناء في مكان واحد</h1>
          <p>اطلبها بسهولة</p>
          <div className="store-intro-actions">
            <a className="store-hero-primary" href="#products"><Icon name="grid" />تصفح المنتجات</a>
            <Link className="store-contractor-search" href="/contractors"><Icon name="search" />ابحث عن مقاول</Link>
          </div>
        </div>
      </section>

      <section className="store-search-section px-4" data-store-reveal>
        <div className="store-search mx-auto max-w-3xl">
          <Icon name="search" />
          <input aria-label="البحث عن المنتجات" value={query} onChange={(event) => { const value = event.currentTarget.value; updateFilters(() => setQuery(value)); }} placeholder="ابحث عن أسمنت، حديد، عزل..." />
          {query ? <button aria-label="مسح البحث" className="store-search-clear" onClick={() => updateFilters(() => setQuery(""))} type="button"><Icon name="close" /></button> : null}
        </div>
      </section>

      <section id="categories" className="store-home-section px-4" data-store-reveal>
        <div className="mx-auto max-w-7xl">
          <div className="store-category-heading">
            <div><h2 className="text-xl font-black">التصنيفات</h2><span className="text-sm font-bold text-sky-100/65">فلترة محلية فورية</span></div>
          </div>
          <div className="store-category-row" role="list" aria-label="تصنيفات المنتجات">
            {(["الكل", ...categories] as const).map((category) => {
              const isActive = category === activeCategory;
              return (
                <button
                  aria-pressed={isActive}
                  className={`store-category-chip ${isActive ? "store-category-chip-active" : ""}`}
                  key={category}
                  onClick={() => updateFilters(() => setActiveCategory(category))}
                  type="button"
                >
                  {category}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <section id="latest" className="store-home-section px-4" data-store-reveal>
        <div className="mx-auto max-w-7xl">
          <div className="store-section-heading">
            <div>
              <p className="store-eyebrow">وصلت حديثا</p>
              <h2>أحدث المنتجات</h2>
            </div>
            <a className="store-text-link" href="#products">عرض الشبكة كاملة</a>
          </div>
          <div className="store-latest-grid">
            {latestProducts.map((product, index) => <LatestProductCard index={index} key={product.id} onOpen={openProduct} product={product} />)}
          </div>
        </div>
      </section>

      <section id="products" className="store-home-section store-products-section px-4" data-store-reveal>
        <div className="mx-auto max-w-7xl">
          <div className="store-section-heading">
            <div>
              <p className="store-eyebrow">كتالوج مواد البناء</p>
              <h2>جميع المنتجات</h2>
            </div>
            <p className="store-result-count">{filteredProducts.length.toLocaleString("ar-SA")} منتج مطابق</p>
          </div>

          {filteredProducts.length > 0 ? (
            <div className="store-product-grid" key={`${activeCategory}:${query}`}>
              {filteredProducts.map((product, index) => <ProductCard index={index} key={product.id} onOpen={openProduct} product={product} />)}
            </div>
          ) : (
            <div className="store-empty rounded-lg p-8 text-center">
              <h3 className="text-xl font-black">لا توجد منتجات مطابقة</h3>
              <p className="mt-2 font-semibold text-sky-50/70">جرّب تصنيفا آخر أو امسح نص البحث.</p>
              {query ? <button className="store-empty-clear" onClick={() => updateFilters(() => setQuery(""))} type="button">مسح البحث</button> : null}
            </div>
          )}
        </div>
      </section>

      <PwaInstallPrompt />

      {selectedProduct ? (
        <div className="store-detail-backdrop" onMouseDown={closeProduct}>
          <section
            aria-labelledby="product-detail-title"
            aria-modal="true"
            className="store-detail-panel"
            id="quote"
            onMouseDown={(event) => event.stopPropagation()}
            role="dialog"
          >
            <button
              aria-label="إغلاق تفاصيل المنتج"
              className="store-close-button"
              onClick={closeProduct}
              type="button"
            >
              <Icon name="close" />
            </button>

            <div className="store-detail-visual" aria-label="معرض صور المنتج">
              <ProductArtwork image={activeImage} large />
              <div className="store-detail-thumbs">
                {selectedProduct.images.map((image) => (
                  <button
                    aria-pressed={image.id === activeImageId}
                    className={`store-thumb ${image.id === activeImageId ? "store-thumb-active" : ""}`}
                    key={image.id}
                    onClick={() => setActiveImageId(image.id)}
                    type="button"
                  >
                    <ProductArtwork image={image} />
                    <span>{image.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="store-detail-copy">
              <header className="store-detail-heading">
                <p className="store-eyebrow">{selectedProduct.category}</p>
                <h2 id="product-detail-title">{selectedProduct.name}</h2>
                <p>{selectedProduct.fullDescription}</p>
              </header>

              <div className="store-detail-facts">
                <InfoBlock label="الوحدة الأساسية" value={selectedProduct.unit} />
                <InfoBlock label="حالة التوفر" value={selectedProduct.availabilityStatus} />
                <InfoBlock label="مدة التوصيل" value={selectedProduct.delivery.window} />
                <InfoBlock label="الضمان" value={`${selectedProduct.warranty.label} - ${selectedProduct.warranty.duration}`} />
              </div>

              <section className="store-detail-section">
                <h3>المواصفات</h3>
                <ul className="store-spec-grid">
                  {selectedProduct.specs.map((spec) => (
                    <li className="store-spec-item" key={spec}>
                      <Icon name="check" />
                      {spec}
                    </li>
                  ))}
                </ul>
              </section>

              <div className="store-detail-lists">
                <section className="store-detail-section">
                  <h3>القياسات المتوفرة</h3>
                  <div className="store-measurement-list">
                    {selectedProduct.measurements.map((measurement) => (
                      <span className="store-soft-pill" key={measurement.id}>{measurement.label}</span>
                    ))}
                  </div>
                </section>
                <section className="store-detail-section">
                  <h3>المناطق المتوفر فيها</h3>
                  <div className="store-region-list">
                    {selectedProduct.regions.map((region) => (
                      <span className="store-region-row" key={`${region.city}-${region.scope}`}>
                        <strong>{region.city}</strong>
                        <span>{region.scope}</span>
                      </span>
                    ))}
                  </div>
                </section>
              </div>

              <p className="store-delivery-note">
                {selectedProduct.deliveryNotes}
              </p>
            </div>

            <aside className="store-quote-panel" aria-label="إضافة المنتج إلى طلب عرض السعر">
              <div className="store-quote-heading">
                <span className="store-quote-icon">
                  <Icon name="quote" />
                </span>
                <div>
                  <p className="text-xs font-black text-cyan-100/70">طلب عرض سعر</p>
                  <h3 className="text-lg font-black">{selectedProduct.name}</h3>
                </div>
              </div>

              <form className="store-quote-form" onSubmit={addQuoteItem}>
                <label className="store-field store-field-half">
                  <span>الكمية</span>
                  <input
                    min="1"
                    onChange={(event) => updateForm("quantity", Number(event.target.value))}
                    type="number"
                    value={quoteForm.quantity}
                  />
                  {errors.quantity ? <small>{errors.quantity}</small> : null}
                </label>

                <label className="store-field store-field-half">
                  <span>الوحدة</span>
                  <select value={quoteForm.unit} onChange={(event) => updateForm("unit", event.target.value)}>
                    {selectedProduct.units.map((unit) => (
                      <option key={unit} value={unit}>{unit}</option>
                    ))}
                  </select>
                  {errors.unit ? <small>{errors.unit}</small> : null}
                </label>

                <label className="store-field store-field-half">
                  <span>القياس</span>
                  <select
                    value={quoteForm.measurementId}
                    onChange={(event) => {
                      const measurement = selectedProduct.measurements.find((item) => item.id === event.target.value);
                      setQuoteForm((current) => ({
                        ...current,
                        measurementId: event.target.value,
                        unit: measurement?.unit ?? current.unit,
                      }));
                      setErrors((current) => ({ ...current, measurementId: undefined }));
                    }}
                  >
                    {selectedProduct.measurements.map((measurement) => (
                      <option key={measurement.id} value={measurement.id}>{measurement.label}</option>
                    ))}
                  </select>
                  {errors.measurementId ? <small>{errors.measurementId}</small> : null}
                </label>

                <label className="store-field store-field-half">
                  <span>موعد الاستلام المطلوب</span>
                  <input
                    min={getTodayValue()}
                    onChange={(event) => updateForm("desiredReceiptDate", event.target.value)}
                    type="date"
                    value={quoteForm.desiredReceiptDate}
                  />
                  {errors.desiredReceiptDate ? <small>{errors.desiredReceiptDate}</small> : null}
                </label>

                <label className="store-field">
                  <span>رابط Google Maps</span>
                  <input
                    dir="ltr"
                    onChange={(event) => updateForm("mapsUrl", event.target.value)}
                    placeholder="https://maps.app.goo.gl/..."
                    type="url"
                    value={quoteForm.mapsUrl}
                  />
                  {errors.mapsUrl ? <small>{errors.mapsUrl}</small> : null}
                </label>

                <label className="store-field">
                  <span>ملاحظات اختيارية</span>
                  <textarea
                    onChange={(event) => updateForm("notes", event.target.value)}
                    placeholder="مثال: بوابة الموقع، وقت مناسب للتنزيل، ملحقات مطلوبة..."
                    rows={3}
                    value={quoteForm.notes}
                  />
                </label>

                <button className="store-submit-button" type="submit">
                  إضافة المنتج لعرض السعر
                </button>
              </form>

              {feedback ? (
                <p className={`store-quote-feedback ${feedback.startsWith("تمت") ? "store-quote-feedback-success" : "store-quote-feedback-error"}`}>
                  {feedback}
                </p>
              ) : null}
              {duplicateItemId ? <div className="store-duplicate-actions"><button type="button" onClick={() => { setQuoteItems((current) => current.map((item) => item.id === duplicateItemId ? { ...item, quantity: item.quantity + quoteForm.quantity } : item)); setDuplicateItemId(null); setFeedback("تمت زيادة كمية المنتج الموجود في طلب عرض السعر."); }}>زيادة كمية العنصر الموجود</button><button type="button" onClick={() => { setDuplicateItemId(null); setFeedback(""); }}>تراجع</button></div> : null}
            </aside>
          </section>
        </div>
      ) : null}
    </main>
  );
}

function InfoBlock({ label, value }: { label: string; value: string }) {
  return (
    <dl className="store-info-block">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </dl>
  );
}
