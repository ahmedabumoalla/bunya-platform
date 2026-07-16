"use client";

import type { CSSProperties, FormEvent, KeyboardEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { Product, ProductCategory, ProductImage, QuoteRequestItem } from "@/lib/bunya-types";
import {PwaInstallPrompt} from "./PwaInstallPrompt";

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

type ProductVisualStyle = CSSProperties & {
  "--product-tone"?: string;
  "--product-ink"?: string;
};

const quoteStorageKey = "bunya-home-quote-items";

const visualTone: Record<ProductImage["tone"], { tone: string; ink: string }> = {
  cement: { tone: "#dbe8f7", ink: "#7b8794" },
  steel: { tone: "#b9c9df", ink: "#334155" },
  blocks: { tone: "#d7e0ea", ink: "#64748b" },
  insulation: { tone: "#58a6ff", ink: "#0f3d73" },
  plumbing: { tone: "#eef7ff", ink: "#2f80c8" },
  electric: { tone: "#f5c84c", ink: "#1d4ed8" },
  wood: { tone: "#d8aa68", ink: "#6b3f1d" },
  paint: { tone: "#dceafe", ink: "#2563eb" },
  tools: { tone: "#c6d3e4", ink: "#172554" },
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

function Icon({ name }: { name: "search" | "grid" | "spark" | "quote" | "close" | "plus" | "check" }) {
  const paths = {
    search: (
      <>
        <circle cx="11" cy="11" r="6" />
        <path d="m16 16 4 4" />
      </>
    ),
    grid: (
      <>
        <path d="M4 4h6v6H4z" />
        <path d="M14 4h6v6h-6z" />
        <path d="M4 14h6v6H4z" />
        <path d="M14 14h6v6h-6z" />
      </>
    ),
    spark: (
      <>
        <path d="M12 3v5" />
        <path d="M12 16v5" />
        <path d="M3 12h5" />
        <path d="M16 12h5" />
        <path d="m6 6 3 3" />
        <path d="m15 15 3 3" />
        <path d="m18 6-3 3" />
        <path d="m9 15-3 3" />
      </>
    ),
    quote: (
      <>
        <path d="M7 7h10" />
        <path d="M7 12h7" />
        <path d="M7 17h5" />
        <path d="M5 3h14v18H5z" />
      </>
    ),
    close: (
      <>
        <path d="M6 6 18 18" />
        <path d="M18 6 6 18" />
      </>
    ),
    plus: (
      <>
        <path d="M12 5v14" />
        <path d="M5 12h14" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
  };

  return (
    <svg aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24">
      {paths[name]}
    </svg>
  );
}

function ProductArtwork({ image, large = false }: { image?: ProductImage; large?: boolean }) {
  const tone = image ? visualTone[image.tone] : visualTone.cement;
  const style: ProductVisualStyle = {
    "--product-tone": tone.tone,
    "--product-ink": tone.ink,
  };

  return (
    <figure
      aria-label={image?.alt ?? "صورة منتج مواد بناء"}
      className={`store-product-art ${large ? "store-product-art-large" : ""} ${image ? `store-product-art-${image.tone}` : ""}`}
      role="img"
      style={style}
    >
      <span className="store-art-sheen" />
      <span className="store-art-object store-art-object-main" />
      <span className="store-art-object store-art-object-alt" />
      <figcaption className="sr-only">{image?.alt ?? "صورة منتج مواد بناء"}</figcaption>
    </figure>
  );
}

export function HomeStorefront({ categories, products }: HomeStorefrontProps) {
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<ProductCategory | "الكل">("الكل");
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [activeImageId, setActiveImageId] = useState<string>("");
  const [quoteItems, setQuoteItems] = useState<QuoteRequestItem[]>([]);
  const [quoteForm, setQuoteForm] = useState<QuoteFormState>(() => createInitialForm(products[0]));
  const [errors, setErrors] = useState<QuoteErrors>({});
  const [feedback, setFeedback] = useState("");
  const [duplicateItemId, setDuplicateItemId] = useState<string | null>(null);
  const storageReadyRef = useRef(false);

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

  const openProduct = (product: Product) => {
    setActiveImageId(product.images[0]?.id ?? "");
    setQuoteForm(createInitialForm(product));
    setErrors({});
    setFeedback("");
    setSelectedProduct(product);
  };

  const openProductFromKeyboard = (event: KeyboardEvent<HTMLElement>, product: Product) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openProduct(product);
    }
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
    <main className="store-home min-h-screen overflow-hidden text-white">
      <PwaInstallPrompt />
      <header className="store-header sticky top-0 z-40 border-b border-white/10">
        <div className="store-header-layout mx-auto max-w-[90rem] px-4 py-3">
          <div className="flex items-center justify-between gap-4">
            <a className="flex items-center gap-3" href="#products" aria-label="بُنية - متجر مواد البناء">
              <span className="grid h-12 w-12 place-items-center rounded-lg border border-sky-200/20 bg-sky-300/15 text-2xl font-black shadow-[0_18px_45px_rgb(14_165_233/0.18)]">
                ب
              </span>
              <span>
                <span className="block text-2xl font-black">بُنية</span>
                <span className="block text-xs font-bold text-sky-100/75">متجر مواد البناء</span>
              </span>
            </a>
            <a
              href="#quote"
              className="store-icon-button lg:hidden"
              aria-label={`طلب عرض السعر يحتوي على ${quoteItems.length.toLocaleString("ar-SA")} منتج`}
            >
              <Icon name="quote" />
              <span>{quoteItems.length.toLocaleString("ar-SA")}</span>
            </a>
          </div>

          <div className="store-search relative">
            <Icon name="search" />
            <input
              aria-label="البحث عن المنتجات"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="ابحث عن أسمنت، حديد، عزل..."
              className="w-full rounded-lg border border-white/15 bg-white/10 py-3 pe-4 ps-11 text-sm font-bold text-white outline-none backdrop-blur placeholder:text-sky-100/55 focus:border-sky-200/70 focus:bg-white/14"
            />
          </div>

          <nav className="store-main-nav" aria-label="روابط المتجر">
            <a className="store-nav-link" href="#categories">
              <Icon name="grid" />
              التصنيفات
            </a>
            <a className="store-nav-link" href="#latest">
              <Icon name="spark" />
              أحدث المنتجات
            </a>
            <a
              href="#quote"
              className="store-nav-link hidden lg:inline-flex"
              aria-label={`طلب عرض السعر يحتوي على ${quoteItems.length.toLocaleString("ar-SA")} منتج`}
            >
              <Icon name="quote" />
              طلب السعر
              <span className="store-count">{quoteItems.length.toLocaleString("ar-SA")}</span>
            </a>
          </nav>
          <nav className="store-portal-nav" aria-label="بوابات بُنية">
            <Link className="store-portal-link store-portal-link-primary" href="/login">لوحة التحكم</Link>
            <Link className="store-portal-link" href="/providers/join">بوابة المزودين</Link>
            <Link className="store-portal-link" href="/contractors/join">بوابة المقاولين</Link>
          </nav>
        </div>
      </header>

      <section className="store-intro px-4">
        <div className="store-intro-copy mx-auto">
          <h1>مواد البناء في مكان واحد</h1>
          <p>اطلبها بسهولة</p>
        </div>
      </section>

      <section id="categories" className="px-4 pb-8">
        <div className="mx-auto max-w-7xl">
          <div className="store-category-heading">
            <div><h2 className="text-xl font-black">التصنيفات</h2><span className="text-sm font-bold text-sky-100/65">فلترة محلية فورية</span></div>
            <Link className="store-contractor-search" href="/contractors"><Icon name="search" />ابحث عن مقاول</Link>
          </div>
          <div className="store-category-row" role="list" aria-label="تصنيفات المنتجات">
            {(["الكل", ...categories] as const).map((category) => {
              const isActive = category === activeCategory;
              return (
                <button
                  aria-pressed={isActive}
                  className={`store-category-chip ${isActive ? "store-category-chip-active" : ""}`}
                  key={category}
                  onClick={() => setActiveCategory(category)}
                  type="button"
                >
                  {category}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <section id="latest" className="px-4 pb-8">
        <div className="mx-auto max-w-7xl">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="store-eyebrow">وصلت حديثا</p>
              <h2 className="mt-2 text-2xl font-black">أحدث المنتجات</h2>
            </div>
            <a className="store-text-link" href="#products">
              عرض الشبكة كاملة
            </a>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {latestProducts.map((product) => (
              <button
                className="store-latest-card text-start"
                key={product.id}
                onClick={() => openProduct(product)}
                type="button"
              >
                <ProductArtwork image={product.images[0]} />
                <span className="mt-4 block text-xs font-black text-cyan-100/70">{product.category}</span>
                <span className="mt-2 block text-lg font-black">{product.name}</span>
                <span className="mt-2 block text-sm font-bold text-sky-50/68">{product.leadTime}</span>
              </button>
            ))}
          </div>
        </div>
      </section>

      <section id="products" className="px-4 pb-16">
        <div className="mx-auto max-w-7xl">
          <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="store-eyebrow">كتالوج مواد البناء</p>
              <h2 className="mt-2 text-2xl font-black">المنتجات</h2>
            </div>
            <p className="rounded-lg border border-white/10 bg-white/8 px-4 py-2 text-sm font-bold text-sky-50/72">
              {filteredProducts.length.toLocaleString("ar-SA")} منتج مطابق
            </p>
          </div>

          {filteredProducts.length > 0 ? (
            <div className="store-product-grid">
              {filteredProducts.map((product) => (
                <article
                  aria-label={`عرض تفاصيل ${product.name}`}
                  className="store-product-card"
                  key={product.id}
                  onClick={() => openProduct(product)}
                  onKeyDown={(event) => openProductFromKeyboard(event, product)}
                  role="button"
                  tabIndex={0}
                >
                  <ProductArtwork image={product.images[0]} />
                  <div className="mt-5 flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-black text-cyan-100/70">{product.category}</p>
                      <h3 className="mt-2 text-xl font-black leading-7">{product.name}</h3>
                    </div>
                    <span className="store-status-pill">{product.availabilityStatus}</span>
                  </div>
                  <p className="mt-3 min-h-12 text-sm font-semibold leading-6 text-sky-50/72">{product.shortDescription}</p>
                  <dl className="mt-5 grid gap-2 text-sm">
                    <div className="store-card-fact">
                      <dt>الوحدة</dt>
                      <dd>{product.unit}</dd>
                    </div>
                    <div className="store-card-fact">
                      <dt>التوصيل</dt>
                      <dd>{product.delivery.window}</dd>
                    </div>
                    <div className="store-card-fact">
                      <dt>التوفر</dt>
                      <dd>{product.regions[0]?.city ?? product.availability}</dd>
                    </div>
                  </dl>
                  <span className="store-detail-cue">
                    عرض التفاصيل
                    <Icon name="plus" />
                  </span>
                </article>
              ))}
            </div>
          ) : (
            <div className="store-empty rounded-lg p-8 text-center">
              <h3 className="text-xl font-black">لا توجد منتجات مطابقة</h3>
              <p className="mt-2 font-semibold text-sky-50/70">جرّب تصنيفا آخر أو امسح نص البحث.</p>
            </div>
          )}
        </div>
      </section>

      {selectedProduct ? (
        <div className="store-detail-backdrop" onMouseDown={() => setSelectedProduct(null)}>
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
              onClick={() => setSelectedProduct(null)}
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
