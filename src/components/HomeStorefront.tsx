"use client";

import type { FormEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import dynamic from "next/dynamic";
import Link from "next/link";
import type { Product, ProductCategory, QuoteRequestItem } from "@/lib/bunya-types";
import {
  emptyStorefrontQuoteDetails,
  normalizePendingStorefrontQuote,
  type PendingStorefrontQuote,
  type StorefrontQuoteDetails,
} from "@/lib/quotes/pending-draft";
import { createClient } from "@/lib/supabase/client";
import { BunyaLogo } from "./brand/BunyaLogo";
import {PwaInstallPrompt} from "./PwaInstallPrompt";
import { BunyaHomeMotion } from "./home/BunyaHomeMotion";
import { BunyaLogoIntro } from "./home/BunyaLogoIntro";
import { Icon, LatestProductCard, ProductArtwork, ProductCard, StoreHeader } from "./home/HomeStorefrontUi";

const BunyaHero3D = dynamic(() => import("./home/BunyaHero3D"), {
  ssr: false,
  loading: () => <div className="bunya-hero-3d" aria-hidden="true" />,
});

type HomeStorefrontProps = {
  categories: ProductCategory[];
  products: Product[];
  dataError?: string;
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

type StoreViewTransition = { finished: Promise<void> };
type StoreViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => StoreViewTransition;
};

function getTodayValue() {
  return new Date().toISOString().slice(0, 10);
}

function getProductUnits(product?: Product) {
  if (!product) return [];
  return [...new Set([product.unit, ...product.units].map((unit) => unit.trim()).filter(Boolean))];
}

function createInitialForm(product?: Product): QuoteFormState {
  const defaultMeasurement = product?.measurements.find((item) => item.isDefault) ?? product?.measurements[0];
  const units = getProductUnits(product);

  return {
    quantity: 1,
    unit: defaultMeasurement?.unit ?? units[0] ?? "",
    measurementId: defaultMeasurement?.id ?? "",
    desiredReceiptDate: getTodayValue(),
    mapsUrl: "",
    notes: "",
  };
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

function localDateTimeValue(date: Date) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function minimumReceiptDateTime() {
  const date = new Date(Date.now() + 3 * 60 * 60 * 1000);
  date.setMinutes(Math.ceil(date.getMinutes() / 15) * 15, 0, 0);
  return localDateTimeValue(date);
}

function detailsFromFirstItem(item: QuoteRequestItem): StorefrontQuoteDetails {
  const requested = new Date(`${item.desiredReceiptDate}T12:00:00`);
  const minimum = new Date(Date.now() + 3 * 60 * 60 * 1000);
  return {
    ...emptyStorefrontQuoteDetails,
    mapsUrl: item.mapsUrl,
    desiredReceiptAt: localDateTimeValue(requested > minimum ? requested : minimum),
  };
}

export function HomeStorefront({ categories, products, dataError }: HomeStorefrontProps) {
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
  const [storefrontNotice, setStorefrontNotice] = useState("");
  const [duplicateItemId, setDuplicateItemId] = useState<string | null>(null);
  const [quoteDrawerOpen, setQuoteDrawerOpen] = useState(false);
  const [quoteDetails, setQuoteDetails] = useState<StorefrontQuoteDetails>(emptyStorefrontQuoteDetails);
  const [quoteDrawerBusy, setQuoteDrawerBusy] = useState(false);
  const [quoteDrawerFeedback, setQuoteDrawerFeedback] = useState("");
  const [quoteSubmissionKey, setQuoteSubmissionKey] = useState(() => createQuoteId("storefront-quote"));
  const storefrontRef = useRef<HTMLElement>(null);
  const productOriginRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const onScroll = () => setHeaderCompact(window.scrollY > 20);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!selectedProduct && !quoteDrawerOpen) {
      return;
    }

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        if (selectedProduct) setSelectedProduct(null);
        else setQuoteDrawerOpen(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [quoteDrawerOpen, selectedProduct]);

  useEffect(() => {
    void (async () => {
      const response = await fetch("/api/public/quote-draft", { cache: "no-store" }).catch(() => null);
      if (!response?.ok) return;
      const body = await response.json().catch(() => null) as { draft?: unknown } | null;
      const draft = normalizePendingStorefrontQuote(body?.draft);
      if (!draft) return;
      setQuoteItems(draft.items);
      setQuoteDetails(draft.details);
      setQuoteSubmissionKey(draft.idempotencyKey);
      if (new URLSearchParams(window.location.search).get("quote") === "review") {
        setQuoteDrawerOpen(true);
        const supabase = createClient();
        const { data } = await supabase.auth.getUser();
        if (data.user) {
          const profile = await supabase.from("profiles").select("full_name,mobile").eq("id", data.user.id).maybeSingle();
          if (profile.data) {
            setQuoteDetails((current) => ({
              ...current,
              recipientName: current.recipientName || profile.data?.full_name || "",
              recipientMobile: current.recipientMobile || profile.data?.mobile || "",
            }));
          }
        }
      }
    })();
  }, []);

  useEffect(() => {
    if (!storefrontNotice) {
      return;
    }

    const timeout = window.setTimeout(() => setStorefrontNotice(""), 4500);
    return () => window.clearTimeout(timeout);
  }, [storefrontNotice]);

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
      setStorefrontNotice("");
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

    if (selectedProduct?.measurements.length && !quoteForm.measurementId) {
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
    if (!selectedProduct || !validateQuote()) {
      setFeedback("راجع الحقول المطلوبة قبل إضافة المنتج.");
      return;
    }

    const item: QuoteRequestItem = {
      id: createQuoteId(selectedProduct.id),
      productId: selectedProduct.id,
      productName: selectedProduct.name,
      quantity: quoteForm.quantity,
      unit: quoteForm.unit,
      measurementId: selectedMeasurement?.id ?? "",
      measurementLabel: selectedMeasurement?.label ?? "بدون قياس إضافي",
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

    setDuplicateItemId(null);
    if (quoteItems.length === 0) setQuoteDetails(detailsFromFirstItem(item));
    setQuoteItems((current) => [item, ...current]);
    setFeedback("");
    setStorefrontNotice(`تمت إضافة «${selectedProduct.name}» إلى طلب عرض السعر.`);
    closeProduct();
  };

  const openQuoteDrawer = async () => {
    setSelectedProduct(null);
    setQuoteDrawerOpen(true);
    setQuoteDrawerFeedback("");
    const supabase = createClient();
    const { data } = await supabase.auth.getUser();
    if (!data.user) return;
    const profile = await supabase.from("profiles").select("full_name,mobile").eq("id", data.user.id).maybeSingle();
    const profileData = profile.data;
    if (!profileData) return;
    setQuoteDetails((current) => ({
      ...current,
      recipientName: current.recipientName || profileData.full_name || "",
      recipientMobile: current.recipientMobile || profileData.mobile || "",
    }));
  };

  const updateQuoteDetails = <Key extends keyof StorefrontQuoteDetails>(key: Key, value: StorefrontQuoteDetails[Key]) => {
    setQuoteDetails((current) => ({ ...current, [key]: value }));
    setQuoteDrawerFeedback("");
  };

  const updateQuoteItemQuantity = (id: string, quantity: number) => {
    if (!Number.isFinite(quantity) || quantity < 1) return;
    setQuoteItems((current) => current.map((item) => item.id === id ? { ...item, quantity } : item));
  };

  const removeQuoteItem = (id: string) => {
    setQuoteItems((current) => current.filter((item) => item.id !== id));
    setQuoteDrawerFeedback("");
  };

  const approveQuoteRequest = async () => {
    if (!quoteItems.length || quoteDrawerBusy) {
      if (!quoteItems.length) setQuoteDrawerFeedback("أضف منتجًا واحدًا على الأقل قبل اعتماد الطلب.");
      return;
    }

    setQuoteDrawerBusy(true);
    setQuoteDrawerFeedback("");
    const draft: PendingStorefrontQuote = { version: 1, idempotencyKey: quoteSubmissionKey, items: quoteItems, details: quoteDetails, savedAt: new Date().toISOString() };
    const { data } = await createClient().auth.getUser();
    if (!data.user) {
      const saved = await fetch("/api/public/quote-draft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(draft),
      }).catch(() => null);
      if (!saved?.ok) {
        const body = await saved?.json().catch(() => null) as { message?: string } | null;
        setQuoteDrawerBusy(false);
        setQuoteDrawerFeedback(body?.message || "تعذر حفظ الطلب قبل تسجيل الدخول. حاول مرة أخرى.");
        return;
      }
      window.location.assign(`/login?returnTo=${encodeURIComponent("/?quote=review")}`);
      return;
    }

    const response = await fetch("/api/customer/quote-requests", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(draft),
    }).catch(() => null);
    const body = await response?.json().catch(() => null) as { message?: string; requestId?: string } | null;
    if (!response?.ok || !body?.requestId) {
      setQuoteDrawerBusy(false);
      setQuoteDrawerFeedback(body?.message || "تعذر اعتماد الطلب حاليًا. حاول مرة أخرى.");
      return;
    }

    setQuoteItems([]);
    setQuoteSubmissionKey(createQuoteId("storefront-quote"));
    setQuoteDrawerOpen(false);
    window.location.assign(`/customer/quote-requests/${body.requestId}`);
  };

  const increaseDuplicateQuantity = () => {
    if (!duplicateItemId || !selectedProduct) {
      return;
    }

    setQuoteItems((current) => current.map((item) =>
      item.id === duplicateItemId ? { ...item, quantity: item.quantity + quoteForm.quantity } : item
    ));
    setDuplicateItemId(null);
    setFeedback("");
    setStorefrontNotice(`تم تحديث كمية «${selectedProduct.name}» في طلب عرض السعر.`);
    closeProduct();
  };

  return (
    <main className="store-home min-h-screen overflow-hidden" ref={storefrontRef}>
      <BunyaLogoIntro />
      <BunyaHomeMotion detailOpen={Boolean(selectedProduct || quoteDrawerOpen)} filterKey={`${activeCategory}:${query}`} scope={storefrontRef} />
      <StoreHeader compact={headerCompact} menuOpen={mobileMenuOpen} onMenuToggle={() => setMobileMenuOpen((current) => !current)} onNavigate={() => setMobileMenuOpen(false)} onQuoteOpen={() => void openQuoteDrawer()} quoteCount={quoteItems.length} quoteOpen={quoteDrawerOpen} />

      <section className="store-intro px-4" data-store-reveal>
        <div className="store-intro-copy mx-auto">
          <BunyaLogo className="store-hero-logo" priority sizes="(max-width: 700px) 224px, 216px" />
          <h1 data-hero-motion>احتياجات البناء في مكان واحد</h1>
          <p data-hero-motion>كل ما يحتاجه مشروعك بسهولة</p>
          <div className="store-intro-actions">
            <a className="store-hero-primary" data-hero-motion href="#products"><Icon name="grid" />تصفح المنتجات</a>
            <Link className="store-contractor-search" data-hero-motion href="/contractors"><Icon name="search" />ابحث عن مقاول</Link>
          </div>
        </div>
        <BunyaHero3D />
      </section>

      <section className="store-search-section px-4" data-store-reveal>
        <div className="store-search mx-auto max-w-3xl">
          <Icon name="search" />
          <input aria-label="البحث عن المنتجات" value={query} onChange={(event) => { const value = event.currentTarget.value; updateFilters(() => setQuery(value)); }} placeholder="ابحث عن أسمنت، حديد، عزل..." />
          {query ? <button aria-label="مسح البحث" className="store-search-clear" onClick={() => updateFilters(() => setQuery(""))} type="button"><Icon name="close" /></button> : null}
        </div>
      </section>

      {dataError ? <section className="store-home-section px-4"><div className="store-empty mx-auto max-w-7xl rounded-lg p-8 text-center" role="alert"><h2 className="text-xl font-black">تعذر الاتصال بقاعدة البيانات</h2><p className="mt-2 font-semibold text-[#2a2a2a]">{dataError}</p></div></section> : null}

      <section id="categories" className="store-home-section px-4" data-gsap-section>
        <div className="mx-auto max-w-7xl">
          <div className="store-category-heading">
            <div><h2 className="text-xl font-black">التصنيفات</h2><span className="text-sm font-bold text-[#2a2a2a]">تصنيفات محدثة من قاعدة البيانات</span></div>
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

      <section id="latest" className="store-home-section px-4" data-gsap-section>
        <div className="mx-auto max-w-7xl">
          <div className="store-section-heading">
            <div>
              <p className="store-eyebrow">وصلت حديثا</p>
              <h2>أحدث المنتجات</h2>
            </div>
            <a className="store-text-link" href="#products">عرض الشبكة كاملة</a>
          </div>
          <div className="store-latest-grid">
            {latestProducts.length > 0
              ? latestProducts.map((product, index) => <LatestProductCard index={index} key={product.id} onOpen={openProduct} product={product} />)
              : <div className="store-empty rounded-lg p-8 text-center"><h3 className="text-xl font-black">لا توجد منتجات حديثة حاليا</h3><p className="mt-2 font-semibold text-[#2a2a2a]">ستظهر هنا المنتجات المنشورة حديثا عند إضافتها.</p></div>}
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
              <p className="mt-2 font-semibold text-[#2a2a2a]">جرّب تصنيفا آخر أو امسح نص البحث.</p>
              {query ? <button className="store-empty-clear" onClick={() => updateFilters(() => setQuery(""))} type="button">مسح البحث</button> : null}
            </div>
          )}
        </div>
      </section>

      <PwaInstallPrompt />

      {storefrontNotice ? (
        <div aria-live="polite" className="store-cart-toast" role="status">
          <span className="store-cart-toast-icon"><Icon name="check" /></span>
          <span>
            <strong>{storefrontNotice}</strong>
            <small>الطلب الحالي يحتوي على {quoteItems.length.toLocaleString("ar-SA")} منتج.</small>
          </span>
          <button aria-label="إغلاق رسالة التأكيد" onClick={() => setStorefrontNotice("")} type="button">
            <Icon name="close" />
          </button>
        </div>
      ) : null}

      {quoteDrawerOpen ? (
        <div className="store-quote-drawer-backdrop" onMouseDown={() => setQuoteDrawerOpen(false)}>
          <aside aria-labelledby="store-quote-drawer-title" aria-modal="true" className="store-quote-drawer" id="store-quote-drawer" onMouseDown={(event) => event.stopPropagation()} role="dialog">
            <header className="store-quote-drawer-header">
              <div>
                <p>طلب عرض السعر</p>
                <h2 id="store-quote-drawer-title">راجع طلبك قبل الاعتماد</h2>
                <span>{quoteItems.length.toLocaleString("ar-SA")} منتج في الطلب الحالي</span>
              </div>
              <button aria-label="إغلاق قائمة طلب عرض السعر" onClick={() => setQuoteDrawerOpen(false)} type="button"><Icon name="close" /></button>
            </header>

            <div className="store-quote-drawer-content">
              <section className="store-quote-drawer-section">
                <div className="store-quote-drawer-section-heading"><h3>المنتجات المطلوبة</h3><span>{quoteItems.length.toLocaleString("ar-SA")}</span></div>
                {quoteItems.length ? <div className="store-quote-drawer-items">{quoteItems.map((item) => {
                  const product = products.find((candidate) => candidate.id === item.productId);
                  return <article className="store-quote-drawer-item" key={item.id}>
                    <ProductArtwork image={product?.images[0]} />
                    <div className="store-quote-drawer-item-copy">
                      <div><h4>{item.productName}</h4><button onClick={() => removeQuoteItem(item.id)} type="button">حذف</button></div>
                      <dl>
                        <div><dt>الوحدة</dt><dd>{item.unit}</dd></div>
                        <div><dt>القياس</dt><dd>{item.measurementLabel}</dd></div>
                        <div><dt>الموعد المضاف</dt><dd>{new Date(`${item.desiredReceiptDate}T12:00:00`).toLocaleDateString("ar-SA")}</dd></div>
                      </dl>
                      <label><span>الكمية</span><input aria-label={`كمية ${item.productName}`} min="1" onChange={(event) => updateQuoteItemQuantity(item.id, Number(event.target.value))} type="number" value={item.quantity} /></label>
                      {item.notes ? <p>{item.notes}</p> : null}
                      <a href={item.mapsUrl} rel="noreferrer" target="_blank">فتح موقع التسليم المضاف</a>
                    </div>
                  </article>;
                })}</div> : <div className="store-quote-drawer-empty"><Icon name="quote" /><h3>الطلب فارغ</h3><p>أغلق القائمة واختر منتجًا ثم أضفه إلى طلب عرض السعر.</p></div>}
              </section>

              {quoteItems.length ? <section className="store-quote-drawer-section">
                <div className="store-quote-drawer-section-heading"><h3>بيانات الطلب والتسليم</h3><span>مطلوبة للاعتماد</span></div>
                <div className="store-quote-drawer-form">
                  <label><span>المدينة أو المنطقة</span><input onChange={(event) => updateQuoteDetails("city", event.target.value)} placeholder="مثال: الرياض" value={quoteDetails.city} /></label>
                  <label><span>اسم المشروع</span><input onChange={(event) => updateQuoteDetails("projectName", event.target.value)} placeholder="اختياري" value={quoteDetails.projectName} /></label>
                  <label className="store-quote-drawer-wide"><span>وصف موقع التسليم</span><input onChange={(event) => updateQuoteDetails("locationHint", event.target.value)} placeholder="الحي، بوابة الموقع أو أقرب معلم" value={quoteDetails.locationHint} /></label>
                  <label className="store-quote-drawer-wide"><span>رابط Google Maps</span><input dir="ltr" onChange={(event) => updateQuoteDetails("mapsUrl", event.target.value)} value={quoteDetails.mapsUrl} /></label>
                  <label><span>موعد الاستلام المطلوب</span><input min={minimumReceiptDateTime()} onChange={(event) => updateQuoteDetails("desiredReceiptAt", event.target.value)} type="datetime-local" value={quoteDetails.desiredReceiptAt} /></label>
                  <label><span>طريقة الاستلام</span><select onChange={(event) => updateQuoteDetails("deliveryMode", event.target.value as StorefrontQuoteDetails["deliveryMode"])} value={quoteDetails.deliveryMode}><option value="delivery">توصيل للموقع</option><option value="pickup">استلام من المزود</option></select></label>
                  <label><span>اسم المستلم</span><input onChange={(event) => updateQuoteDetails("recipientName", event.target.value)} value={quoteDetails.recipientName} /></label>
                  <label><span>جوال المستلم</span><input dir="ltr" inputMode="tel" onChange={(event) => updateQuoteDetails("recipientMobile", event.target.value)} placeholder="05xxxxxxxx" value={quoteDetails.recipientMobile} /></label>
                  <label className="store-quote-drawer-wide"><span>ملاحظات عامة</span><textarea onChange={(event) => updateQuoteDetails("notes", event.target.value)} rows={3} value={quoteDetails.notes} /></label>
                </div>
              </section> : null}
            </div>

            <footer className="store-quote-drawer-footer">
              {quoteDrawerFeedback ? <p role="alert">{quoteDrawerFeedback}</p> : null}
              <button className="store-quote-approve" disabled={quoteDrawerBusy || quoteItems.length === 0} onClick={() => void approveQuoteRequest()} type="button">
                {quoteDrawerBusy ? "جارٍ تجهيز الطلب..." : "اعتماد طلب عرض السعر"}
              </button>
              <small>إذا لم تكن مسجلًا سنحفظ الطلب مؤقتًا، ثم نعيدك إلى هذه القائمة بعد تسجيل الدخول.</small>
            </footer>
          </aside>
        </div>
      ) : null}

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
                    {selectedProduct.measurements.length ? selectedProduct.measurements.map((measurement) => (
                      <span className="store-soft-pill" key={measurement.id}>{measurement.label}</span>
                    )) : <span className="store-soft-pill">لا توجد قياسات إضافية لهذا المنتج</span>}
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
                  <p className="text-xs font-black text-[#2a2a2a]">طلب عرض سعر</p>
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
                    {getProductUnits(selectedProduct).map((unit) => (
                      <option key={unit} value={unit}>{unit}</option>
                    ))}
                  </select>
                  {errors.unit ? <small>{errors.unit}</small> : null}
                </label>

                <label className="store-field store-field-half">
                  <span>القياس</span>
                  <select
                    disabled={selectedProduct.measurements.length === 0}
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
                    {selectedProduct.measurements.length === 0 ? <option value="">بدون قياس إضافي</option> : selectedProduct.measurements.map((measurement) => (
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
              {duplicateItemId ? <div className="store-duplicate-actions"><button type="button" onClick={increaseDuplicateQuantity}>زيادة كمية العنصر الموجود</button><button type="button" onClick={() => { setDuplicateItemId(null); setFeedback(""); }}>تراجع</button></div> : null}
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
