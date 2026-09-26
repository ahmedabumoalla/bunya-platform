"use client";

import type { FormEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type {
  Product,
  ProductCategory,
  ProductVariant,
  QuoteRequestItem,
} from "@/lib/bunya-types";
import {
  emptyStorefrontQuoteDetails,
  normalizePendingStorefrontQuote,
  type PendingStorefrontQuote,
  type StorefrontQuoteDetails,
} from "@/lib/quotes/pending-draft";
import { createClient } from "@/lib/supabase/client";
import { BunyaHomeMotion } from "./home/BunyaHomeMotion";
import { BunyaLogoIntro } from "./home/BunyaLogoIntro";
import {
  Icon,
  LatestProductCard,
  ProductArtwork,
  ProductCard,
  StoreHeader,
} from "./home/HomeStorefrontUi";

type HomeStorefrontProps = {
  categories: ProductCategory[];
  products: Product[];
  dataError?: string;
};

type QuoteFormState = {
  quantity: number;
  unit: string;
  measurementId: string;
  variantIds: Record<string, string>;
  notes: string;
};

type QuoteErrors = Partial<Record<keyof QuoteFormState, string>>;
type CatalogView = "grid" | "list";
type CatalogSort = "featured" | "name";

const saudiRegions = [
  "الرياض",
  "مكة المكرمة",
  "المدينة المنورة",
  "القصيم",
  "المنطقة الشرقية",
  "عسير",
  "تبوك",
  "حائل",
  "الحدود الشمالية",
  "جازان",
  "نجران",
  "الباحة",
  "الجوف",
] as const;
const saudiRegionSet = new Set<string>(saudiRegions);

type StoreViewTransition = { finished: Promise<void> };
type StoreViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => StoreViewTransition;
};

function getProductUnits(product?: Product) {
  if (!product) return [];
  return [
    ...new Set(
      [product.unit, ...product.units]
        .map((unit) => unit.trim())
        .filter(Boolean),
    ),
  ];
}

type ProductVariantGroup = {
  key: string;
  label: string;
  variants: ProductVariant[];
};

function getProductVariantGroups(product?: Product): ProductVariantGroup[] {
  const groups = new Map<string, ProductVariantGroup>();
  for (const variant of product?.variants ?? []) {
    const attributes = variant.attributes.filter(
      (attribute) => attribute.label.trim() && attribute.value.trim(),
    );
    const singleAttribute = attributes.length === 1 ? attributes[0] : null;
    const key = singleAttribute?.label.trim() || "__variant__";
    const label = singleAttribute?.label.trim() || "الخيار";
    const group = groups.get(key) ?? { key, label, variants: [] };
    group.variants.push(variant);
    groups.set(key, group);
  }
  return [...groups.values()];
}

function variantOptionLabel(variant: ProductVariant, groupKey: string) {
  if (groupKey !== "__variant__") {
    return variant.attributes.find((attribute) => attribute.label === groupKey)?.value || variant.name;
  }
  const attributes = variant.attributes
    .filter((attribute) => attribute.label && attribute.value)
    .map((attribute) => `${attribute.label}: ${attribute.value}`)
    .join(" · ");
  return attributes || variant.name;
}

function createInitialForm(product?: Product): QuoteFormState {
  const defaultMeasurement =
    product?.measurements.find((item) => item.isDefault) ??
    product?.measurements[0];
  const units = getProductUnits(product);
  const variantGroups = getProductVariantGroups(product);

  return {
    quantity: Math.max(product?.minimumOrder || 1, .001),
    unit: defaultMeasurement?.unit ?? units[0] ?? "",
    measurementId: defaultMeasurement?.id ?? "",
    variantIds: Object.fromEntries(
      variantGroups.map((group) => [group.key, group.variants[0]?.id ?? ""]),
    ),
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

function receiptSchedulePart(value: string, part: "date" | "time") {
  const fallback = value || minimumReceiptDateTime();
  const [date, time = "12:00"] = fallback.split("T");
  return part === "date" ? date : time.slice(0, 5);
}

function receiptScheduleSummary(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "حدد التاريخ والساعة";
  return new Intl.DateTimeFormat("ar-SA", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function HomeStorefront({
  categories,
  products,
  dataError,
}: HomeStorefrontProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<
    ProductCategory | "الكل"
  >("الكل");
  const [selectedRegion, setSelectedRegion] = useState("كل المناطق");
  const [deliveryOnly, setDeliveryOnly] = useState(false);
  const [availableOnly, setAvailableOnly] = useState(false);
  const [newOnly, setNewOnly] = useState(false);
  const [catalogFiltersOpen, setCatalogFiltersOpen] = useState(false);
  const [catalogView, setCatalogView] = useState<CatalogView>("grid");
  const [catalogSort, setCatalogSort] = useState<CatalogSort>("featured");
  const [headerCompact, setHeaderCompact] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [activeImageId, setActiveImageId] = useState<string>("");
  const [quoteItems, setQuoteItems] = useState<QuoteRequestItem[]>([]);
  const [quoteForm, setQuoteForm] = useState<QuoteFormState>(() =>
    createInitialForm(products[0]),
  );
  const [errors, setErrors] = useState<QuoteErrors>({});
  const [feedback, setFeedback] = useState("");
  const [storefrontNotice, setStorefrontNotice] = useState("");
  const [duplicateItemId, setDuplicateItemId] = useState<string | null>(null);
  const [quoteDrawerOpen, setQuoteDrawerOpen] = useState(false);
  const [quoteDetails, setQuoteDetails] = useState<StorefrontQuoteDetails>(
    emptyStorefrontQuoteDetails,
  );
  const [quoteDrawerBusy, setQuoteDrawerBusy] = useState(false);
  const [quoteDrawerFeedback, setQuoteDrawerFeedback] = useState("");
  const [quoteSubmissionKey, setQuoteSubmissionKey] = useState(() =>
    createQuoteId("storefront-quote"),
  );
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
      const response = await fetch("/api/public/quote-draft", {
        cache: "no-store",
      }).catch(() => null);
      if (!response?.ok) return;
      const body = (await response.json().catch(() => null)) as {
        draft?: unknown;
      } | null;
      const draft = normalizePendingStorefrontQuote(body?.draft);
      if (!draft) return;
      setQuoteItems(draft.items);
      setQuoteDetails(draft.details);
      setQuoteSubmissionKey(draft.idempotencyKey);
      if (
        new URLSearchParams(window.location.search).get("quote") === "review"
      ) {
        setQuoteDrawerOpen(true);
        const supabase = createClient();
        const { data } = await supabase.auth.getUser();
        if (data.user) {
          const profile = await supabase
            .from("profiles")
            .select("full_name,mobile")
            .eq("id", data.user.id)
            .maybeSingle();
          if (profile.data) {
            setQuoteDetails((current) => ({
              ...current,
              recipientName:
                current.recipientName || profile.data?.full_name || "",
              recipientMobile:
                current.recipientMobile || profile.data?.mobile || "",
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

  const catalogRegions = useMemo(
    () => {
      const productRegions = [...new Set(
        products.flatMap((product) => [
          ...product.regions.map((region) => region.city.trim()),
          ...product.deliveryDetails.regions.map((region) => region.trim()),
        ]),
      )]
        .filter(Boolean)
        .filter((region) => !saudiRegionSet.has(region))
        .sort((first, second) => first.localeCompare(second, "ar"));
      return [...saudiRegions, ...productRegions];
    },
    [products],
  );

  const filteredProducts = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const result = products.filter((product) => {
      const matchesCategory =
        activeCategory === "الكل" || product.category === activeCategory;
      const matchesQuery =
        !normalizedQuery ||
        product.name.toLowerCase().includes(normalizedQuery) ||
        product.category.toLowerCase().includes(normalizedQuery) ||
        product.description.toLowerCase().includes(normalizedQuery);
      const productRegions = [
        ...product.regions.map((region) => region.city),
        ...product.deliveryDetails.regions,
      ];
      const matchesRegion =
        selectedRegion === "كل المناطق" ||
        productRegions.includes(selectedRegion);
      const matchesDelivery = !deliveryOnly || product.deliveryDetails.available;
      const matchesAvailability =
        !availableOnly || product.availabilityStatus !== "حسب الطلب";
      const matchesNew = !newOnly || product.isNew;

      return (
        matchesCategory &&
        matchesQuery &&
        matchesRegion &&
        matchesDelivery &&
        matchesAvailability &&
        matchesNew
      );
    });

    if (catalogSort === "name") {
      return [...result].sort((first, second) =>
        first.name.localeCompare(second.name, "ar"),
      );
    }
    return result;
  }, [
    activeCategory,
    availableOnly,
    catalogSort,
    deliveryOnly,
    newOnly,
    products,
    query,
    selectedRegion,
  ]);

  const activeCatalogFilterCount =
    Number(selectedRegion !== "كل المناطق") +
    Number(deliveryOnly) +
    Number(availableOnly) +
    Number(newOnly) +
    Number(catalogSort !== "featured");

  const resetCatalogFilters = () =>
    updateFilters(() => {
      setQuery("");
      setActiveCategory("الكل");
      setSelectedRegion("كل المناطق");
      setDeliveryOnly(false);
      setAvailableOnly(false);
      setNewOnly(false);
      setCatalogSort("featured");
    });

  const latestProducts = useMemo(
    () => products.filter((product) => product.isNew).slice(0, 4),
    [products],
  );
  const activeImage =
    selectedProduct?.images.find((image) => image.id === activeImageId) ??
    selectedProduct?.images[0];
  const selectedMeasurement = selectedProduct?.measurements.find(
    (item) => item.id === quoteForm.measurementId,
  );
  const selectedVariantGroups = getProductVariantGroups(selectedProduct ?? undefined);
  const selectedVariants = selectedProduct?.variants.filter((variant) =>
    Object.values(quoteForm.variantIds).includes(variant.id),
  ) ?? [];

  const runViewTransition = (update: () => void) => {
    const transitionDocument = document as StoreViewTransitionDocument;
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
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
      if (origin?.isConnected)
        origin.style.viewTransitionName = "store-product-detail";
      setSelectedProduct(null);
    });
    if (origin && transition)
      transition.finished.finally(() => {
        origin.style.viewTransitionName = "";
      });
    else if (origin) origin.style.viewTransitionName = "";
  };

  const updateForm = <Key extends keyof QuoteFormState>(
    key: Key,
    value: QuoteFormState[Key],
  ) => {
    setQuoteForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
    setFeedback("");
  };

  const validateQuote = () => {
    const nextErrors: QuoteErrors = {};

    const minimum = Math.max(selectedProduct?.minimumOrder || 1, .001);
    if (!Number.isFinite(quoteForm.quantity) || quoteForm.quantity < minimum || quoteForm.quantity > 1000000) {
      nextErrors.quantity = `الحد الأدنى لهذا المنتج ${minimum}، والحد الأعلى مليون وحدة.`;
    }

    if (!quoteForm.unit) {
      nextErrors.unit = "اختر وحدة الطلب.";
    }

    if (selectedProduct?.measurements.length && !quoteForm.measurementId) {
      nextErrors.measurementId = "اختر القياس المطلوب.";
    }

    if (selectedVariantGroups.some((group) => !quoteForm.variantIds[group.key])) {
      nextErrors.variantIds = "اختر جميع الخيارات المطلوبة.";
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
      selectedVariants: selectedVariants.map((variant) => ({
        id: variant.id,
        name: variant.name,
        attributes: variant.attributes,
      })),
      desiredReceiptDate: "",
      mapsUrl: "",
      notes: quoteForm.notes.trim() || undefined,
      createdAt: new Date().toISOString(),
    };

    const duplicate = quoteItems.find(
      (current) =>
        current.productId === item.productId &&
        current.measurementId === item.measurementId &&
        current.selectedVariants.map((variant) => variant.id).sort().join(",") ===
          item.selectedVariants.map((variant) => variant.id).sort().join(",") &&
        current.unit === item.unit,
    );
    if (duplicate) {
      setDuplicateItemId(duplicate.id);
      setFeedback(
        "هذا المنتج موجود بنفس القياس والوحدة. يمكنك زيادة كميته بدل تكراره.",
      );
      return;
    }

    setDuplicateItemId(null);
    if (quoteItems.length === 0) {
      setQuoteDetails((current) => ({
        ...current,
        desiredReceiptAt: current.desiredReceiptAt || minimumReceiptDateTime(),
      }));
    }
    setQuoteItems((current) => [item, ...current]);
    setFeedback("");
    setStorefrontNotice(
      `تمت إضافة «${selectedProduct.name}» إلى طلب عرض السعر.`,
    );
    closeProduct();
  };

  const openQuoteDrawer = async () => {
    setSelectedProduct(null);
    setQuoteDrawerOpen(true);
    setQuoteDrawerFeedback("");
    setQuoteDetails((current) => ({
      ...current,
      desiredReceiptAt: current.desiredReceiptAt || minimumReceiptDateTime(),
    }));
    const supabase = createClient();
    const { data } = await supabase.auth.getUser();
    if (!data.user) return;
    const profile = await supabase
      .from("profiles")
      .select("full_name,mobile")
      .eq("id", data.user.id)
      .maybeSingle();
    const profileData = profile.data;
    if (!profileData) return;
    setQuoteDetails((current) => ({
      ...current,
      recipientName: current.recipientName || profileData.full_name || "",
      recipientMobile: current.recipientMobile || profileData.mobile || "",
      siteResponsibleName:
        current.siteResponsibleName || profileData.full_name || "",
      siteResponsibleMobile:
        current.siteResponsibleMobile || profileData.mobile || "",
    }));
  };

  const updateQuoteDetails = <Key extends keyof StorefrontQuoteDetails>(
    key: Key,
    value: StorefrontQuoteDetails[Key],
  ) => {
    setQuoteDetails((current) => ({ ...current, [key]: value }));
    setQuoteDrawerFeedback("");
  };

  const updateReceiptSchedule = (part: "date" | "time", value: string) => {
    setQuoteDetails((current) => {
      const date = receiptSchedulePart(current.desiredReceiptAt, "date");
      const time = receiptSchedulePart(current.desiredReceiptAt, "time");
      return {
        ...current,
        desiredReceiptAt:
          part === "date" ? `${value}T${time}` : `${date}T${value}`,
      };
    });
    setQuoteDrawerFeedback("");
  };

  const updateSiteHours = (
    key: "siteHoursStart" | "siteHoursEnd",
    value: string,
  ) => {
    setQuoteDetails((current) => {
      const next = { ...current, [key]: value };
      return {
        ...next,
        workingHours: `من ${next.siteHoursStart} إلى ${next.siteHoursEnd}`,
      };
    });
    setQuoteDrawerFeedback("");
  };

  const updateQuoteItemQuantity = (id: string, quantity: number) => {
    const item = quoteItems.find(entry => entry.id === id);
    const product = products.find(entry => entry.id === item?.productId);
    if (!Number.isFinite(quantity) || quantity < Math.max(product?.minimumOrder || 1, .001) || quantity > 1000000) return;
    setQuoteItems((current) =>
      current.map((item) => (item.id === id ? { ...item, quantity } : item)),
    );
  };

  const removeQuoteItem = (id: string) => {
    setQuoteItems((current) => current.filter((item) => item.id !== id));
    setQuoteDrawerFeedback("");
  };

  const approveQuoteRequest = async () => {
    if (!quoteItems.length || quoteDrawerBusy) {
      if (!quoteItems.length)
        setQuoteDrawerFeedback("أضف منتجًا واحدًا على الأقل قبل اعتماد الطلب.");
      return;
    }

    const desiredAt = new Date(quoteDetails.desiredReceiptAt);
    const validationMessage = !isGoogleMapsUrl(quoteDetails.mapsUrl)
      ? "ألصق رابط Google Maps الصحيح لمكان التسليم."
      : quoteDetails.locationHint.trim().length < 3
        ? "اكتب وصفًا واضحًا لمكان التسليم."
        : !Number.isFinite(desiredAt.getTime()) ||
            desiredAt.getTime() <= Date.now() + 2 * 60 * 60 * 1000
          ? "حدد موعد استلام صحيحًا بعد أكثر من ساعتين."
          : quoteDetails.recipientName.trim().length < 2 ||
              quoteDetails.recipientMobile.trim().length < 9
            ? "أكمل اسم المستلم ورقم جواله."
            : quoteDetails.siteResponsibleName.trim().length < 2 ||
                quoteDetails.siteResponsibleMobile.trim().length < 9
              ? "أكمل اسم مسؤول الموقع ورقم جواله."
              : (quoteDetails.contractorName.trim() &&
                    quoteDetails.contractorMobile.trim().length < 9) ||
                  (quoteDetails.contractorMobile.trim() &&
                    quoteDetails.contractorName.trim().length < 2)
                ? "أكمل اسم المقاول ورقم جواله معًا، أو اتركهما فارغين."
                : quoteDetails.siteHoursEnd <= quoteDetails.siteHoursStart
                  ? "ساعة نهاية الاستلام يجب أن تكون بعد ساعة البداية."
                  : !quoteDetails.loadingOption || !quoteDetails.unloadingOption
                    ? "حدد مسؤولية التحميل وخيار التنزيل."
                    : !quoteDetails.roadAccess ||
                        quoteDetails.accessInstructions.trim().length < 3
                      ? "حدد سهولة الطريق واكتب تعليمات الوصول."
                      : !quoteDetails.driverDepartureLiabilityAccepted ||
                          !quoteDetails.dataAccuracyAccepted
                        ? "وافق على إقراري مسؤولية الاستلام وصحة البيانات قبل الاعتماد."
                        : "";
    if (validationMessage) {
      setQuoteDrawerFeedback(validationMessage);
      return;
    }

    setQuoteDrawerBusy(true);
    setQuoteDrawerFeedback("");
    const draft: PendingStorefrontQuote = {
      version: 1,
      idempotencyKey: quoteSubmissionKey,
      items: quoteItems,
      details: quoteDetails,
      savedAt: new Date().toISOString(),
    };
    const { data } = await createClient().auth.getUser();
    if (!data.user) {
      const saved = await fetch("/api/public/quote-draft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(draft),
      }).catch(() => null);
      if (!saved?.ok) {
        const body = (await saved?.json().catch(() => null)) as {
          message?: string;
        } | null;
        setQuoteDrawerBusy(false);
        setQuoteDrawerFeedback(
          body?.message || "تعذر حفظ الطلب قبل تسجيل الدخول. حاول مرة أخرى.",
        );
        return;
      }
      router.push(
        `/login?returnTo=${encodeURIComponent("/?quote=review")}`,
      );
      return;
    }

    const response = await fetch("/api/customer/quote-requests", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(draft),
    }).catch(() => null);
    const body = (await response?.json().catch(() => null)) as {
      message?: string;
      requestId?: string;
      outsidePricingHours?: boolean;
    } | null;
    if (!response?.ok || !body?.requestId) {
      setQuoteDrawerBusy(false);
      setQuoteDrawerFeedback(
        body?.message || "تعذر اعتماد الطلب حاليًا. حاول مرة أخرى.",
      );
      return;
    }

    setQuoteItems([]);
    setQuoteSubmissionKey(createQuoteId("storefront-quote"));
    if (body.outsidePricingHours) {
      setQuoteDrawerFeedback(
        body.message ||
          "تم استلام الطلب خارج أوقات التسعير، وسيتم تزويدك بعرض السعر خلال 24 ساعة.",
      );
      window.setTimeout(() => {
        router.push(`/customer/quote-requests/${body.requestId}`);
      }, 2200);
      return;
    }
    setQuoteDrawerOpen(false);
    router.push(`/customer/quote-requests/${body.requestId}`);
  };

  const increaseDuplicateQuantity = () => {
    if (!duplicateItemId || !selectedProduct) {
      return;
    }

    setQuoteItems((current) =>
      current.map((item) =>
        item.id === duplicateItemId
          ? { ...item, quantity: item.quantity + quoteForm.quantity }
          : item,
      ),
    );
    setDuplicateItemId(null);
    setFeedback("");
    setStorefrontNotice(
      `تم تحديث كمية «${selectedProduct.name}» في طلب عرض السعر.`,
    );
    closeProduct();
  };

  return (
    <main
      className="store-home min-h-screen overflow-hidden"
      id="top"
      ref={storefrontRef}
    >
      <BunyaLogoIntro />
      <BunyaHomeMotion
        detailOpen={Boolean(selectedProduct || quoteDrawerOpen)}
        filterKey={`${activeCategory}:${query}`}
        scope={storefrontRef}
      />
      <StoreHeader
        compact={headerCompact}
        menuOpen={mobileMenuOpen}
        onMenuToggle={() => setMobileMenuOpen((current) => !current)}
        onNavigate={() => setMobileMenuOpen(false)}
        onQuoteOpen={() => void openQuoteDrawer()}
        quoteCount={quoteItems.length}
        quoteOpen={quoteDrawerOpen}
      />

      <section aria-label="واجهة تطبيق بُنية" className="native-home-dashboard">
        <div className="native-home-welcome">
          <span className="native-home-eyebrow">بُنية لمواد البناء</span>
          <h1>ابدأ مشروعك من المكان الصحيح</h1>
          <p>مواد، موردون ومقاولون في تجربة واحدة موثوقة.</p>
          <small className="native-home-trust">
            <i aria-hidden="true" /> منتجات ومزودون موثّقون
          </small>
        </div>
        <div className="native-home-search" role="search">
          <Icon name="search" />
          <input
            aria-label="البحث عن المنتجات في التطبيق"
            value={query}
            onChange={(event) => {
              const value = event.currentTarget.value;
              updateFilters(() => setQuery(value));
            }}
            placeholder="ماذا تحتاج لمشروعك؟"
          />
          {query ? (
            <button
              aria-label="مسح البحث"
              onClick={() => updateFilters(() => setQuery(""))}
              type="button"
            >
              <Icon name="close" />
            </button>
          ) : null}
        </div>
        <div className="native-home-actions-heading">
          <strong>خدمات بُنية</strong>
          <small>وصول سريع لما تحتاجه</small>
        </div>
        <div className="native-home-actions" aria-label="الخدمات الرئيسية">
          <a href="#products">
            <span>
              <Icon name="grid" />
            </span>
            <strong>المنتجات</strong>
            <small>مواد البناء</small>
          </a>
          <Link href="/contractors">
            <span>
              <Icon name="search" />
            </span>
            <strong>المقاولون</strong>
            <small>حسب التخصص</small>
          </Link>
          <button
            className="native-home-quote-action"
            onClick={() => void openQuoteDrawer()}
            type="button"
          >
            <span>
              <Icon name="quote" />
              {quoteItems.length ? (
                <b>{quoteItems.length.toLocaleString("ar-SA")}</b>
              ) : null}
            </span>
            <strong>طلب السعر</strong>
            <small>راجع طلبك</small>
          </button>
        </div>
      </section>

      <section
        aria-labelledby="marketplace-title"
        className="store-marketplace-browser"
        id="categories"
      >
        <div className="store-marketplace-browser-inner">
          <div className="store-marketplace-title-row">
            <div>
              <p className="store-eyebrow">سوق مواد البناء</p>
              <h1 id="marketplace-title">كل احتياج مشروعك، في بحث واحد</h1>
              <span>اختر المواد واجمعها ثم أرسل طلبًا واحدًا لأفضل عرض.</span>
            </div>
            <button
              className="store-marketplace-quote"
              onClick={() => void openQuoteDrawer()}
              type="button"
            >
              <Icon name="quote" />
              <span>طلب السعر</span>
              <b>{quoteItems.length.toLocaleString("ar-SA")}</b>
            </button>
          </div>

          <div className="store-marketplace-search" role="search">
            <Icon name="search" />
            <input
              aria-label="البحث في مواد البناء"
              onChange={(event) => {
                const value = event.currentTarget.value;
                updateFilters(() => setQuery(value));
              }}
              placeholder="ابحث عن أسمنت، حديد، بلوك أو عزل..."
              type="search"
              value={query}
            />
            {query ? (
              <button
                aria-label="مسح البحث"
                onClick={() => updateFilters(() => setQuery(""))}
                type="button"
              >
                <Icon name="close" />
              </button>
            ) : null}
          </div>

          <nav
            aria-label="تصنيفات مواد البناء"
            className="store-marketplace-categories"
          >
            {(["الكل", ...categories] as const).map((category) => {
              const isActive = category === activeCategory;
              return (
                <button
                  aria-pressed={isActive}
                  className={isActive ? "active" : ""}
                  key={category}
                  onClick={() =>
                    updateFilters(() => setActiveCategory(category))
                  }
                  type="button"
                >
                  {category}
                </button>
              );
            })}
          </nav>

          <div className="store-marketplace-tools" aria-label="أدوات عرض المنتجات">
            <label className="store-marketplace-region">
              <Icon name="pin" />
              <span className="sr-only">منطقة التوفر</span>
              <select
                aria-label="منطقة التوفر"
                onChange={(event) =>
                  updateFilters(() => setSelectedRegion(event.currentTarget.value))
                }
                value={selectedRegion}
              >
                <option>كل المناطق</option>
                {catalogRegions.map((region) => (
                  <option key={region}>{region}</option>
                ))}
              </select>
            </label>
            <button
              aria-controls="store-catalog-filters"
              aria-expanded={catalogFiltersOpen}
              className={catalogFiltersOpen ? "active" : ""}
              onClick={() => setCatalogFiltersOpen((current) => !current)}
              type="button"
            >
              <Icon name="filter" />
              <span>تصفية</span>
              {activeCatalogFilterCount ? (
                <b>{activeCatalogFilterCount.toLocaleString("ar-SA")}</b>
              ) : null}
            </button>
            <button
              aria-pressed={deliveryOnly}
              className={deliveryOnly ? "active" : ""}
              onClick={() => updateFilters(() => setDeliveryOnly((current) => !current))}
              type="button"
            >
              <Icon name="truck" />
              <span>يوصل للموقع</span>
            </button>
            <div className="store-marketplace-view" role="group" aria-label="طريقة العرض">
              <button
                aria-label="عرض شبكي"
                aria-pressed={catalogView === "grid"}
                className={catalogView === "grid" ? "active" : ""}
                onClick={() => setCatalogView("grid")}
                type="button"
              >
                <Icon name="grid" />
              </button>
              <button
                aria-label="عرض قائمة"
                aria-pressed={catalogView === "list"}
                className={catalogView === "list" ? "active" : ""}
                onClick={() => setCatalogView("list")}
                type="button"
              >
                <Icon name="list" />
              </button>
            </div>
          </div>

          {catalogFiltersOpen ? (
            <div className="store-marketplace-filter-panel" id="store-catalog-filters">
              <div>
                <span>اختيار سريع</span>
                <button
                  aria-pressed={availableOnly}
                  className={availableOnly ? "active" : ""}
                  onClick={() => updateFilters(() => setAvailableOnly((current) => !current))}
                  type="button"
                >
                  متوفر الآن
                </button>
                <button
                  aria-pressed={newOnly}
                  className={newOnly ? "active" : ""}
                  onClick={() => updateFilters(() => setNewOnly((current) => !current))}
                  type="button"
                >
                  وصل حديثًا
                </button>
              </div>
              <label>
                <span>الترتيب</span>
                <select
                  onChange={(event) => setCatalogSort(event.currentTarget.value as CatalogSort)}
                  value={catalogSort}
                >
                  <option value="featured">الأنسب أولًا</option>
                  <option value="name">حسب اسم المنتج</option>
                </select>
              </label>
              <button className="store-marketplace-reset" onClick={resetCatalogFilters} type="button">
                إعادة الضبط
              </button>
            </div>
          ) : null}
        </div>
      </section>

      <section className="store-marketplace-canvas" id="products" data-store-reveal>
        <div className="store-marketplace-layout">
          <aside className="store-marketplace-rail" aria-label="تصفية سريعة حسب التصنيف">
            <div className="store-marketplace-rail-heading">
              <span className="store-marketplace-rail-icon"><Icon name="box" /></span>
              <div><strong>مواد البناء</strong><small>اختيار سريع</small></div>
            </div>
            <div className="store-marketplace-rail-list">
              {(["الكل", ...categories] as const).map((category) => {
                const count = category === "الكل"
                  ? products.length
                  : products.filter((product) => product.category === category).length;
                const isActive = category === activeCategory;
                return (
                  <button
                    aria-pressed={isActive}
                    className={isActive ? "active" : ""}
                    key={category}
                    onClick={() => updateFilters(() => setActiveCategory(category))}
                    type="button"
                  >
                    <span>{category}</span>
                    <b>{count.toLocaleString("ar-SA")}</b>
                  </button>
                );
              })}
            </div>
            <div className="store-marketplace-rail-quick">
              <span>حسب احتياجك</span>
              <button aria-pressed={availableOnly} onClick={() => updateFilters(() => setAvailableOnly((current) => !current))} type="button">
                <Icon name="check" /> متوفر الآن
              </button>
              <button aria-pressed={deliveryOnly} onClick={() => updateFilters(() => setDeliveryOnly((current) => !current))} type="button">
                <Icon name="truck" /> توصيل للموقع
              </button>
              <button aria-pressed={newOnly} onClick={() => updateFilters(() => setNewOnly((current) => !current))} type="button">
                <Icon name="spark" /> وصل حديثًا
              </button>
            </div>
          </aside>

          <div className="store-marketplace-feed">
            <header className="store-marketplace-feed-heading">
              <div>
                <p className="store-eyebrow">كتالوج بُنية</p>
                <h2>المنتجات المطابقة</h2>
              </div>
              <p aria-live="polite">
                <strong>{filteredProducts.length.toLocaleString("ar-SA")}</strong>
                <span> منتج</span>
              </p>
            </header>

            {dataError ? (
              <div className="store-marketplace-empty" role="alert">
                <span><Icon name="box" /></span>
                <h3>تعذر الاتصال بقاعدة البيانات</h3>
                <p>{dataError}</p>
              </div>
            ) : filteredProducts.length > 0 ? (
              <div
                className={`store-product-grid store-product-results-${catalogView}`}
                key={`${activeCategory}:${query}:${selectedRegion}:${deliveryOnly}:${availableOnly}:${newOnly}:${catalogSort}:${catalogView}`}
              >
                {filteredProducts.map((product, index) => (
                  <ProductCard
                    index={index}
                    key={product.id}
                    onOpen={openProduct}
                    product={product}
                  />
                ))}
              </div>
            ) : (
              <div className="store-marketplace-empty">
                <span><Icon name="box" /></span>
                <h3>لا توجد منتجات مطابقة</h3>
                <p>جرّب كلمة بحث أخرى أو أزل بعض عوامل التصفية.</p>
                <button onClick={resetCatalogFilters} type="button">مسح عوامل التصفية</button>
              </div>
            )}
          </div>
        </div>
      </section>

      <section
        id="latest"
        className="store-home-section store-marketplace-latest px-4"
        data-gsap-section
      >
        <div className="mx-auto max-w-7xl">
          <div className="store-section-heading">
            <div>
              <p className="store-eyebrow">وصلت حديثًا</p>
              <h2>أحدث المنتجات</h2>
            </div>
            <a className="store-text-link" href="#products">عرض الكتالوج</a>
          </div>
          <div className="store-latest-grid">
            {latestProducts.length > 0 ? latestProducts.map((product, index) => (
              <LatestProductCard index={index} key={product.id} onOpen={openProduct} product={product} />
            )) : (
              <div className="store-empty rounded-lg p-8 text-center">
                <h3 className="text-xl font-black">لا توجد منتجات حديثة حاليًا</h3>
                <p className="mt-2 font-semibold text-[#2a2a2a]">ستظهر هنا المنتجات المنشورة حديثًا عند إضافتها.</p>
              </div>
            )}
          </div>
        </div>
      </section>

      <nav aria-label="التنقل الرئيسي في التطبيق" className="native-home-tabs">
        <a aria-current="page" href="#top">
          <Icon name="spark" />
          <span>الرئيسية</span>
        </a>
        <a href="#products">
          <Icon name="grid" />
          <span>المنتجات</span>
        </a>
        <button
          aria-label="فتح طلب عرض السعر"
          onClick={() => void openQuoteDrawer()}
          type="button"
        >
          <span className="native-home-tabs-quote">
            <Icon name="quote" />
            {quoteItems.length ? (
              <b>{quoteItems.length.toLocaleString("ar-SA")}</b>
            ) : null}
          </span>
          <span>طلب السعر</span>
        </button>
        <Link href="/contractors">
          <Icon name="search" />
          <span>المقاولون</span>
        </Link>
      </nav>

      {storefrontNotice ? (
        <div aria-live="polite" className="store-cart-toast" role="status">
          <span className="store-cart-toast-icon">
            <Icon name="check" />
          </span>
          <span>
            <strong>{storefrontNotice}</strong>
            <small>
              الطلب الحالي يحتوي على {quoteItems.length.toLocaleString("ar-SA")}{" "}
              منتج.
            </small>
          </span>
          <button
            aria-label="إغلاق رسالة التأكيد"
            onClick={() => setStorefrontNotice("")}
            type="button"
          >
            <Icon name="close" />
          </button>
        </div>
      ) : null}

      {quoteDrawerOpen ? (
        <div
          className="store-quote-drawer-backdrop"
          onMouseDown={() => setQuoteDrawerOpen(false)}
        >
          <aside
            aria-labelledby="store-quote-drawer-title"
            aria-modal="true"
            className="store-quote-drawer"
            id="store-quote-drawer"
            onMouseDown={(event) => event.stopPropagation()}
            role="dialog"
          >
            <header className="store-quote-drawer-header">
              <div>
                <p>طلب عرض السعر</p>
                <h2 id="store-quote-drawer-title">راجع طلبك قبل الاعتماد</h2>
                <span>
                  {quoteItems.length.toLocaleString("ar-SA")} منتج في الطلب
                  الحالي
                </span>
              </div>
              <button
                aria-label="إغلاق قائمة طلب عرض السعر"
                onClick={() => setQuoteDrawerOpen(false)}
                type="button"
              >
                <Icon name="close" />
              </button>
            </header>

            <div className="store-quote-drawer-content">
              <section className="store-quote-drawer-section">
                <div className="store-quote-drawer-section-heading">
                  <h3>المنتجات المطلوبة</h3>
                  <span>{quoteItems.length.toLocaleString("ar-SA")}</span>
                </div>
                {quoteItems.length ? (
                  <div className="store-quote-drawer-items">
                    {quoteItems.map((item) => {
                      const product = products.find(
                        (candidate) => candidate.id === item.productId,
                      );
                      return (
                        <article
                          className="store-quote-drawer-item"
                          key={item.id}
                        >
                          <ProductArtwork image={product?.images[0]} />
                          <div className="store-quote-drawer-item-copy">
                            <div>
                              <h4>{item.productName}</h4>
                              <button
                                onClick={() => removeQuoteItem(item.id)}
                                type="button"
                              >
                                حذف
                              </button>
                            </div>
                            <dl>
                              <div>
                                <dt>الوحدة</dt>
                                <dd>{item.unit}</dd>
                              </div>
                              <div>
                                <dt>القياس</dt>
                                <dd>{item.measurementLabel}</dd>
                              </div>
                              {item.selectedVariants.length ? (
                                <div>
                                  <dt>الخيارات والفئات</dt>
                                  <dd>
                                    {item.selectedVariants.map((variant) =>
                                      variant.attributes.length
                                        ? variant.attributes.map((attribute) => `${attribute.label}: ${attribute.value}`).join("، ")
                                        : variant.name,
                                    ).join(" · ")}
                                  </dd>
                                </div>
                              ) : null}
                            </dl>
                            <label>
                              <span>الكمية</span>
                              <input
                                aria-label={`كمية ${item.productName}`}
                                min={Math.max(product?.minimumOrder || 1, .001)}
                                max={1000000}
                                step="0.001"
                                onChange={(event) =>
                                  updateQuoteItemQuantity(
                                    item.id,
                                    Number(event.target.value),
                                  )
                                }
                                type="number"
                                value={item.quantity}
                              />
                            </label>
                            {item.notes ? <p>{item.notes}</p> : null}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <div className="store-quote-drawer-empty">
                    <Icon name="quote" />
                    <h3>الطلب فارغ</h3>
                    <p>أغلق القائمة واختر منتجًا ثم أضفه إلى طلب عرض السعر.</p>
                  </div>
                )}
              </section>

              {quoteItems.length ? (
                <section className="store-quote-drawer-section">
                  <div className="store-quote-drawer-section-heading">
                    <h3>بيانات الطلب والتسليم</h3>
                    <span>مطلوبة للاعتماد</span>
                  </div>
                  <div className="store-quote-map-card">
                    <div>
                      <Icon name="quote" />
                      <span>
                        <b>منافسة أسعار لمدة 3 ساعات</b>
                        <small>
                          الطلب بين 8 ص و4 م يبدأ فورًا. خارج هذه الفترة يُتاح
                          للمزودين من 6 ص ويبدأ العداد 8 ص بتوقيت الرياض.
                        </small>
                      </span>
                    </div>
                  </div>
                  <div className="store-quote-drawer-form">
                    <div className="store-quote-map-card store-quote-drawer-wide">
                      <div>
                        <Icon name="pin" />
                        <span>
                          <b>موقع التسليم المعتمد</b>
                          <small>
                            ألصق رابط Google Maps مباشرة. هذا الرابط هو المرجع
                            الوحيد للموقع.
                          </small>
                        </span>
                      </div>
                      <input
                        aria-label="رابط Google Maps لموقع التسليم"
                        dir="ltr"
                        onChange={(event) =>
                          updateQuoteDetails("mapsUrl", event.target.value)
                        }
                        placeholder="https://maps.app.goo.gl/..."
                        type="url"
                        value={quoteDetails.mapsUrl}
                      />
                      {isGoogleMapsUrl(quoteDetails.mapsUrl) ? (
                        <a
                          href={quoteDetails.mapsUrl}
                          rel="noreferrer"
                          target="_blank"
                        >
                          فتح الرابط والتأكد من الموقع
                        </a>
                      ) : null}
                    </div>
                    <label>
                      <span>اسم المشروع</span>
                      <input
                        onChange={(event) =>
                          updateQuoteDetails("projectName", event.target.value)
                        }
                        placeholder="اختياري"
                        value={quoteDetails.projectName}
                      />
                    </label>
                    <label>
                      <span>طريقة الاستلام</span>
                      <select
                        onChange={(event) =>
                          updateQuoteDetails(
                            "deliveryMode",
                            event.target
                              .value as StorefrontQuoteDetails["deliveryMode"],
                          )
                        }
                        value={quoteDetails.deliveryMode}
                      >
                        <option value="delivery">توصيل للموقع</option>
                        <option value="pickup">استلام من المزود</option>
                      </select>
                    </label>
                    <label className="store-quote-drawer-wide">
                      <span>وصف مكان التسليم</span>
                      <input
                        onChange={(event) =>
                          updateQuoteDetails("locationHint", event.target.value)
                        }
                        placeholder="اسم الموقع، رقم البوابة أو أقرب معلم"
                        value={quoteDetails.locationHint}
                      />
                    </label>
                    <section className="store-quote-schedule store-quote-drawer-wide">
                      <header>
                        <span className="store-quote-schedule-icon">
                          <Icon name="calendar" />
                        </span>
                        <span>
                          <b>موعد الاستلام المطلوب</b>
                          <small>اختر اليوم والساعة بدقة</small>
                        </span>
                      </header>
                      <div className="store-quote-schedule-grid">
                        <label>
                          <span>التاريخ</span>
                          <input
                            min={minimumReceiptDateTime().slice(0, 10)}
                            onChange={(event) =>
                              updateReceiptSchedule("date", event.target.value)
                            }
                            type="date"
                            value={receiptSchedulePart(
                              quoteDetails.desiredReceiptAt,
                              "date",
                            )}
                          />
                        </label>
                        <label>
                          <span>الساعة</span>
                          <input
                            onChange={(event) =>
                              updateReceiptSchedule("time", event.target.value)
                            }
                            step="900"
                            type="time"
                            value={receiptSchedulePart(
                              quoteDetails.desiredReceiptAt,
                              "time",
                            )}
                          />
                        </label>
                      </div>
                      <output className="store-quote-schedule-summary">
                        <Icon name="clock" />
                        {receiptScheduleSummary(quoteDetails.desiredReceiptAt)}
                      </output>
                    </section>
                    <section className="store-quote-schedule store-quote-drawer-wide">
                      <header>
                        <span className="store-quote-schedule-icon">
                          <Icon name="clock" />
                        </span>
                        <span>
                          <b>نافذة استقبال الموقع</b>
                          <small>حدد بداية ونهاية وقت الاستلام</small>
                        </span>
                      </header>
                      <div className="store-quote-schedule-grid">
                        <label>
                          <span>من الساعة</span>
                          <input
                            onChange={(event) =>
                              updateSiteHours(
                                "siteHoursStart",
                                event.target.value,
                              )
                            }
                            step="900"
                            type="time"
                            value={quoteDetails.siteHoursStart}
                          />
                        </label>
                        <label>
                          <span>إلى الساعة</span>
                          <input
                            onChange={(event) =>
                              updateSiteHours(
                                "siteHoursEnd",
                                event.target.value,
                              )
                            }
                            step="900"
                            type="time"
                            value={quoteDetails.siteHoursEnd}
                          />
                        </label>
                      </div>
                      <output className="store-quote-schedule-summary">
                        <Icon name="clock" />
                        استقبال الموقع {quoteDetails.workingHours}
                      </output>
                    </section>
                    <label>
                      <span>اسم المستلم</span>
                      <input
                        onChange={(event) =>
                          updateQuoteDetails(
                            "recipientName",
                            event.target.value,
                          )
                        }
                        value={quoteDetails.recipientName}
                      />
                    </label>
                    <label>
                      <span>جوال المستلم</span>
                      <input
                        dir="ltr"
                        inputMode="tel"
                        onChange={(event) =>
                          updateQuoteDetails(
                            "recipientMobile",
                            event.target.value,
                          )
                        }
                        placeholder="05xxxxxxxx"
                        value={quoteDetails.recipientMobile}
                      />
                    </label>
                    <label>
                      <span>اسم المسؤول في الموقع</span>
                      <input
                        onChange={(event) =>
                          updateQuoteDetails(
                            "siteResponsibleName",
                            event.target.value,
                          )
                        }
                        value={quoteDetails.siteResponsibleName}
                      />
                    </label>
                    <label>
                      <span>جوال مسؤول الموقع</span>
                      <input
                        dir="ltr"
                        inputMode="tel"
                        onChange={(event) =>
                          updateQuoteDetails(
                            "siteResponsibleMobile",
                            event.target.value,
                          )
                        }
                        placeholder="05xxxxxxxx"
                        value={quoteDetails.siteResponsibleMobile}
                      />
                    </label>
                    <label>
                      <span>اسم المقاول</span>
                      <input
                        onChange={(event) =>
                          updateQuoteDetails(
                            "contractorName",
                            event.target.value,
                          )
                        }
                        placeholder="اختياري"
                        value={quoteDetails.contractorName}
                      />
                    </label>
                    <label>
                      <span>جوال المقاول</span>
                      <input
                        dir="ltr"
                        inputMode="tel"
                        onChange={(event) =>
                          updateQuoteDetails(
                            "contractorMobile",
                            event.target.value,
                          )
                        }
                        placeholder="اختياري"
                        value={quoteDetails.contractorMobile}
                      />
                    </label>
                    <label>
                      <span>مسؤولية التحميل عند المزود</span>
                      <select
                        onChange={(event) =>
                          updateQuoteDetails(
                            "loadingOption",
                            event.target.value,
                          )
                        }
                        value={quoteDetails.loadingOption}
                      >
                        <option value="">حدد الخيار</option>
                        <option value="التحميل ضمن مسؤولية المزود">
                          التحميل ضمن مسؤولية المزود
                        </option>
                        <option value="العميل يوفّر معدات التحميل">
                          العميل يوفّر معدات التحميل
                        </option>
                        <option value="يلزم تنسيق رافعة أو فوركلفت">
                          يلزم تنسيق رافعة أو فوركلفت
                        </option>
                      </select>
                    </label>
                    <label>
                      <span>التنزيل في موقع العميل</span>
                      <select
                        onChange={(event) =>
                          updateQuoteDetails(
                            "unloadingOption",
                            event.target.value,
                          )
                        }
                        value={quoteDetails.unloadingOption}
                      >
                        <option value="">حدد الخيار</option>
                        <option value="العميل يوفّر عمال التنزيل">
                          العميل يوفّر عمال التنزيل
                        </option>
                        <option value="العميل يوفّر رافعة أو فوركلفت">
                          العميل يوفّر رافعة أو فوركلفت
                        </option>
                        <option value="مطلوب تضمين التنزيل في العرض">
                          مطلوب تضمين التنزيل في العرض
                        </option>
                        <option value="لا يلزم تنزيل - استلام مباشر">
                          لا يلزم تنزيل - استلام مباشر
                        </option>
                      </select>
                    </label>
                    <label>
                      <span>سهولة الطريق والوصول</span>
                      <select
                        onChange={(event) =>
                          updateQuoteDetails("roadAccess", event.target.value)
                        }
                        value={quoteDetails.roadAccess}
                      >
                        <option value="">حدد حالة الوصول</option>
                        <option value="سهل ومناسب للشاحنات الكبيرة">
                          سهل ومناسب للشاحنات الكبيرة
                        </option>
                        <option value="مناسب للشاحنات الصغيرة فقط">
                          مناسب للشاحنات الصغيرة فقط
                        </option>
                        <option value="دخول مقيد ويحتاج تنسيقًا مسبقًا">
                          دخول مقيد ويحتاج تنسيقًا مسبقًا
                        </option>
                        <option value="طريق غير ممهد أو تحت الإنشاء">
                          طريق غير ممهد أو تحت الإنشاء
                        </option>
                      </select>
                    </label>
                    <label className="store-quote-drawer-wide">
                      <span>تعليمات الوصول والبوابة</span>
                      <textarea
                        onChange={(event) =>
                          updateQuoteDetails(
                            "accessInstructions",
                            event.target.value,
                          )
                        }
                        placeholder="عرض الطريق، قيود الارتفاع، رقم البوابة، تصريح الدخول أو نقطة تجمع السائق"
                        rows={3}
                        value={quoteDetails.accessInstructions}
                      />
                    </label>
                    <label className="store-quote-drawer-wide">
                      <span>ملاحظات عامة</span>
                      <textarea
                        onChange={(event) =>
                          updateQuoteDetails("notes", event.target.value)
                        }
                        rows={3}
                        value={quoteDetails.notes}
                      />
                    </label>
                    <fieldset className="store-quote-acknowledgements store-quote-drawer-wide">
                      <legend>إقرارات العميل قبل اعتماد الطلب</legend>
                      <label>
                        <input
                          checked={
                            quoteDetails.driverDepartureLiabilityAccepted
                          }
                          onChange={(event) =>
                            updateQuoteDetails(
                              "driverDepartureLiabilityAccepted",
                              event.target.checked,
                            )
                          }
                          type="checkbox"
                        />
                        <span>
                          أقر بتحمل المسؤولية الكاملة عن أي تكلفة أو إعادة توصيل
                          إذا وصل السائق وفق الموعد والبيانات المعتمدة، ثم غادر
                          لعدم وجود مستلم أو تعذر الاستلام من طرفي.
                        </span>
                      </label>
                      <label>
                        <input
                          checked={quoteDetails.dataAccuracyAccepted}
                          onChange={(event) =>
                            updateQuoteDetails(
                              "dataAccuracyAccepted",
                              event.target.checked,
                            )
                          }
                          type="checkbox"
                        />
                        <span>
                          أقر بصحة رابط الموقع وأسماء وأرقام التواصل ومواعيد
                          العمل وخيارات التحميل والتنزيل وتعليمات الوصول الواردة
                          في هذا الطلب.
                        </span>
                      </label>
                    </fieldset>
                  </div>
                </section>
              ) : null}
            </div>

            <footer className="store-quote-drawer-footer">
              {quoteDrawerFeedback ? (
                <p role="alert">{quoteDrawerFeedback}</p>
              ) : null}
              <button
                className="store-quote-approve"
                disabled={quoteDrawerBusy || quoteItems.length === 0}
                onClick={() => void approveQuoteRequest()}
                type="button"
              >
                {quoteDrawerBusy
                  ? "جارٍ تجهيز الطلب..."
                  : "اعتماد طلب عرض السعر"}
              </button>
              <small>
                إذا لم تكن مسجلًا سنحفظ الطلب مؤقتًا، ثم نعيدك إلى هذه القائمة
                بعد تسجيل الدخول.
              </small>
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
                <div className="store-detail-kicker">
                  <p className="store-eyebrow">{selectedProduct.category}</p>
                  <span>{selectedProduct.availabilityStatus}</span>
                  {selectedProduct.isNew ? <span>جديد</span> : null}
                </div>
                <h2 id="product-detail-title">{selectedProduct.name}</h2>
                <p>
                  {selectedProduct.shortDescription ||
                    selectedProduct.description}
                </p>
                <div className="store-detail-identifiers">
                  {selectedProduct.sku ? (
                    <span>
                      رمز المنتج <b dir="ltr">{selectedProduct.sku}</b>
                    </span>
                  ) : null}
                  <span>
                    طريقة العرض <b>{selectedProduct.offerType}</b>
                  </span>
                  <span>
                    الضريبة{" "}
                    <b>
                      {selectedProduct.vatInclusive ? "شاملة" : "تضاف لاحقًا"}
                    </b>
                  </span>
                </div>
              </header>

              <div className="store-detail-facts">
                <InfoBlock
                  icon="box"
                  label="الوحدة الأساسية"
                  value={selectedProduct.unit}
                />
                <InfoBlock
                  icon="check"
                  label="التوفر"
                  value={
                    selectedProduct.availability ||
                    selectedProduct.availabilityStatus
                  }
                />
                <InfoBlock
                  icon="truck"
                  label="التجهيز والتوصيل"
                  value={`${selectedProduct.leadTime} · ${selectedProduct.delivery.window}`}
                />
                <InfoBlock
                  icon="tag"
                  label="الحد الأدنى"
                  value={
                    selectedProduct.minimumOrder === null
                      ? "حسب طلب المشروع"
                      : `${selectedProduct.minimumOrder.toLocaleString("ar-SA")} ${selectedProduct.unit}`
                  }
                />
              </div>

              <section className="store-detail-section store-detail-description">
                <SectionHeading icon="box" title="عن المنتج" />
                <p>
                  {selectedProduct.fullDescription ||
                    selectedProduct.description ||
                    "منتج معتمد ضمن كتالوج بُنية."}
                </p>
              </section>

              <section className="store-detail-section">
                <SectionHeading icon="check" title="المواصفات الفنية" />
                <ul className="store-spec-grid">
                  {selectedProduct.specs.length ? (
                    selectedProduct.specs.map((spec) => (
                      <li className="store-spec-item" key={spec}>
                        <Icon name="check" />
                        {spec}
                      </li>
                    ))
                  ) : (
                    <li className="store-detail-empty">
                      لا توجد مواصفات إضافية مسجلة.
                    </li>
                  )}
                </ul>
              </section>

              <div className="store-detail-lists">
                <section className="store-detail-section">
                  <SectionHeading icon="tag" title="الوحدات والقياسات" />
                  {selectedProduct.units.length ? (
                    <div className="store-unit-list">
                      {selectedProduct.units.map((unit) => (
                        <span key={unit}>{unit}</span>
                      ))}
                    </div>
                  ) : null}
                  <div className="store-measurement-list">
                    {selectedProduct.measurements.length ? (
                      selectedProduct.measurements.map((measurement) => (
                        <span className="store-soft-pill" key={measurement.id}>
                          {measurement.label}
                          <small>
                            {measurement.unit}
                            {measurement.isDefault ? " · الافتراضي" : ""}
                          </small>
                        </span>
                      ))
                    ) : (
                      <span className="store-soft-pill">
                        لا توجد قياسات إضافية لهذا المنتج
                      </span>
                    )}
                  </div>
                </section>
                <section className="store-detail-section">
                  <SectionHeading icon="tag" title="الخيارات والفئات" />
                  {selectedProduct.variants.length ? (
                    <div className="store-variant-list">
                      {selectedProduct.variants.map((variant) => (
                        <article className="store-variant-row" key={variant.id}>
                          <strong>{variant.name}</strong>
                          {variant.attributes.length ? (
                            <div>
                              {variant.attributes.map((attribute) => (
                                <span key={`${variant.id}-${attribute.label}`}>
                                  <small>{attribute.label}</small>
                                  {attribute.value}
                                </span>
                              ))}
                            </div>
                          ) : null}
                        </article>
                      ))}
                    </div>
                  ) : (
                    <p className="store-detail-empty">
                      هذا المنتج لا يحتاج خيارات إضافية.
                    </p>
                  )}
                </section>
              </div>

              <section className="store-detail-section">
                <SectionHeading icon="truck" title="التوفر والتوصيل" />
                <div className="store-delivery-metrics">
                  <DetailValue
                    label="حالة التوصيل"
                    value={
                      selectedProduct.delivery.label ||
                      (selectedProduct.deliveryDetails.available
                        ? "متاح"
                        : "حسب الموقع")
                    }
                  />
                  <DetailValue
                    label="أقصى مدة"
                    value={
                      selectedProduct.deliveryDetails.maximumDuration ||
                      selectedProduct.delivery.window
                    }
                  />
                  <DetailValue
                    label="أقصى مسافة"
                    value={
                      selectedProduct.deliveryDetails.maximumDistanceKm === null
                        ? "حسب الموقع"
                        : `${selectedProduct.deliveryDetails.maximumDistanceKm.toLocaleString("ar-SA")} كم`
                    }
                  />
                  <DetailValue
                    label="تكلفة المسافة"
                    value={
                      selectedProduct.deliveryDetails.pricePerKm === null
                        ? "تحدد في العرض"
                        : `${selectedProduct.deliveryDetails.pricePerKm.toLocaleString("ar-SA")} ر.س/كم`
                    }
                  />
                </div>
                <div className="store-region-list">
                  {(selectedProduct.regions.length
                    ? selectedProduct.regions
                    : selectedProduct.deliveryDetails.regions.map((region) => ({
                        city: region,
                        scope: "منطقة توصيل",
                      }))
                  ).map((region) => (
                    <span
                      className="store-region-row"
                      key={`${region.city}-${region.scope}`}
                    >
                      <strong>{region.city}</strong>
                      <span>{region.scope}</span>
                    </span>
                  ))}
                  {!selectedProduct.deliveryDetails.regions.length &&
                  !selectedProduct.regions.length ? (
                    <p className="store-detail-empty">
                      تُراجع تغطية الموقع عند طلب عرض السعر.
                    </p>
                  ) : null}
                </div>
                <p className="store-delivery-note">
                  {selectedProduct.deliveryDetails.notes ||
                    selectedProduct.deliveryNotes}
                </p>
              </section>

              <section className="store-detail-section store-warranty-card">
                <SectionHeading icon="shield" title="الضمان وشروط الطلب" />
                <div className="store-warranty-summary">
                  <strong>{selectedProduct.warranty.label}</strong>
                  <span>{selectedProduct.warranty.duration}</span>
                </div>
                <p>{selectedProduct.warranty.details}</p>
                <div className="store-order-terms">
                  <span>
                    <small>نوع العرض</small>
                    {selectedProduct.offerType}
                  </span>
                  {selectedProduct.rentalDuration ? (
                    <span>
                      <small>مدة التأجير</small>
                      {selectedProduct.rentalDuration}
                    </span>
                  ) : null}
                  <span>
                    <small>المخزون</small>
                    {selectedProduct.stockQuantity === null
                      ? selectedProduct.availabilityStatus
                      : `${selectedProduct.stockQuantity.toLocaleString("ar-SA")} ${selectedProduct.unit}`}
                  </span>
                </div>
              </section>

              <p className="store-pricing-note">
                <Icon name="quote" />
                <span>
                  <b>سعر عادل من مزودين مؤهلين</b>السعر النهائي يظهر بعد جمع
                  العروض ومقارنة التكلفة والتوصيل.
                </span>
              </p>
            </div>

            <aside
              className="store-quote-panel"
              aria-label="إضافة المنتج إلى طلب عرض السعر"
            >
              <div className="store-quote-heading">
                <span className="store-quote-icon">
                  <Icon name="quote" />
                </span>
                <div>
                  <p className="text-xs font-black text-[#2a2a2a]">
                    طلب عرض سعر
                  </p>
                  <h3 className="text-lg font-black">{selectedProduct.name}</h3>
                </div>
              </div>

              <form className="store-quote-form" onSubmit={addQuoteItem}>
                <label className="store-field store-field-half">
                  <span>الكمية</span>
                  <input
                    min={Math.max(selectedProduct.minimumOrder || 1, .001)}
                    max={1000000}
                    step="0.001"
                    onChange={(event) =>
                      updateForm("quantity", Number(event.target.value))
                    }
                    type="number"
                    value={quoteForm.quantity}
                  />
                  {errors.quantity ? <small>{errors.quantity}</small> : null}
                </label>

                <label className="store-field store-field-half">
                  <span>الوحدة</span>
                  <select
                    value={quoteForm.unit}
                    onChange={(event) => updateForm("unit", event.target.value)}
                  >
                    {getProductUnits(selectedProduct).map((unit) => (
                      <option key={unit} value={unit}>
                        {unit}
                      </option>
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
                      const measurement = selectedProduct.measurements.find(
                        (item) => item.id === event.target.value,
                      );
                      setQuoteForm((current) => ({
                        ...current,
                        measurementId: event.target.value,
                        unit: measurement?.unit ?? current.unit,
                      }));
                      setErrors((current) => ({
                        ...current,
                        measurementId: undefined,
                      }));
                    }}
                  >
                    {selectedProduct.measurements.length === 0 ? (
                      <option value="">بدون قياس إضافي</option>
                    ) : (
                      selectedProduct.measurements.map((measurement) => (
                        <option key={measurement.id} value={measurement.id}>
                          {measurement.label}
                        </option>
                      ))
                    )}
                  </select>
                  {errors.measurementId ? (
                    <small>{errors.measurementId}</small>
                  ) : null}
                </label>

                {selectedVariantGroups.map((group, index) => (
                  <label className="store-field store-field-half" key={group.key}>
                    <span>{group.label}</span>
                    <select
                      value={quoteForm.variantIds[group.key] ?? ""}
                      onChange={(event) => {
                        setQuoteForm((current) => ({
                          ...current,
                          variantIds: {
                            ...current.variantIds,
                            [group.key]: event.target.value,
                          },
                        }));
                        setErrors((current) => ({ ...current, variantIds: undefined }));
                      }}
                    >
                      {group.variants.map((variant) => (
                        <option key={variant.id} value={variant.id}>
                          {variantOptionLabel(variant, group.key)}
                        </option>
                      ))}
                    </select>
                    {index === 0 && errors.variantIds ? <small>{errors.variantIds}</small> : null}
                  </label>
                ))}

                <label className="store-field">
                  <span>ملاحظات اختيارية</span>
                  <textarea
                    onChange={(event) =>
                      updateForm("notes", event.target.value)
                    }
                    placeholder="مثال: بوابة الموقع، وقت مناسب للتنزيل، ملحقات مطلوبة..."
                    rows={3}
                    value={quoteForm.notes}
                  />
                </label>

                <p className="store-quote-after-items">
                  <Icon name="pin" />
                  <span>
                    <b>بعد تجميع المنتجات</b>ستُدخل رابط Google Maps وبيانات
                    المستلم والوصول والإقرارات مرة واحدة للطلب كاملًا.
                  </span>
                </p>

                <button className="store-submit-button" type="submit">
                  إضافة المنتج لعرض السعر
                </button>
              </form>

              {feedback ? (
                <p
                  className={`store-quote-feedback ${feedback.startsWith("تمت") ? "store-quote-feedback-success" : "store-quote-feedback-error"}`}
                >
                  {feedback}
                </p>
              ) : null}
              {duplicateItemId ? (
                <div className="store-duplicate-actions">
                  <button type="button" onClick={increaseDuplicateQuantity}>
                    زيادة كمية العنصر الموجود
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDuplicateItemId(null);
                      setFeedback("");
                    }}
                  >
                    تراجع
                  </button>
                </div>
              ) : null}
            </aside>
          </section>
        </div>
      ) : null}
    </main>
  );
}

function InfoBlock({
  icon,
  label,
  value,
}: {
  icon: "box" | "check" | "truck" | "tag";
  label: string;
  value: string;
}) {
  return (
    <div className="store-info-block">
      <span className="store-info-icon">
        <Icon name={icon} />
      </span>
      <dl>
        <dt>{label}</dt>
        <dd>{value}</dd>
      </dl>
    </div>
  );
}

function SectionHeading({
  icon,
  title,
}: {
  icon: "box" | "check" | "truck" | "shield" | "tag";
  title: string;
}) {
  return (
    <div className="store-detail-section-heading">
      <Icon name={icon} />
      <h3>{title}</h3>
    </div>
  );
}

function DetailValue({ label, value }: { label: string; value: string }) {
  return (
    <dl className="store-detail-value">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </dl>
  );
}
