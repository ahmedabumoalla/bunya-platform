import "server-only";

import type { Product, ProductImage } from "@/lib/bunya-types";
import { signProductImageMap } from "@/lib/products/image-urls";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { cookies } from "next/headers";
import { defaultLocale, isAppLocale, localeCookieName } from "@/lib/i18n/config";

type CatalogProductRow = {
  id: string;
  category_id: string | null;
  custom_category: string | null;
  sku: string | null;
  name: string;
  base_unit: string;
  short_description: string;
  description: string;
  full_description: string;
  availability_summary: string;
  availability_status: "available" | "limited" | "on_request";
  lead_time_label: string;
  delivery_label: string;
  delivery_window: string;
  delivery_notes: string;
  offer_type: "sale" | "rental";
  minimum_order: number | null;
  stock_quantity: number | null;
  vat_inclusive: boolean;
  rental_duration_value: number | null;
  rental_duration_unit: string | null;
  is_new: boolean;
};

type CatalogImageRow = {
  id: string;
  product_id: string;
  label: string;
  alt_text: string;
  tone: ProductImage["tone"];
  storage_path: string | null;
  image_url: string | null;
  is_primary: boolean;
  sort_order: number;
};

const availabilityLabels = {
  available: "متوفر",
  limited: "كمية محدودة",
  on_request: "حسب الطلب",
} as const;

const durationUnitLabels: Record<string, string> = {
  hour: "ساعة",
  day: "يوم",
  week: "أسبوع",
  month: "شهر",
  year: "سنة",
};

function formatDuration(value: number | null, unit: string | null) {
  if (value === null || !unit) return null;
  const formattedValue = Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
  return `${formattedValue} ${durationUnitLabels[unit] ?? unit}`;
}

function normalizeVariantAttributes(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== null && item !== undefined && String(item).trim())
    .map(([label, item]) => ({ label, value: String(item) }));
}

export async function loadPublicCatalog(): Promise<{ categories: string[]; products: Product[] }> {
  const storedLocale = (await cookies()).get(localeCookieName)?.value;
  const locale = isAppLocale(storedLocale) ? storedLocale : defaultLocale;
  const supabase = await createClient();
  const [categoriesResult, productsResult] = await Promise.all([
    supabase.from("product_categories").select("id,name,sort_order").eq("is_active", true).order("sort_order"),
    supabase.from("products").select("id,category_id,custom_category,sku,name,base_unit,short_description,description,full_description,availability_summary,availability_status,lead_time_label,delivery_label,delivery_window,delivery_notes,offer_type,minimum_order,stock_quantity,vat_inclusive,rental_duration_value,rental_duration_unit,is_new").eq("is_published", true).order("created_at", { ascending: false }),
  ]);

  if (categoriesResult.error) throw new Error(`تعذر تحميل تصنيفات المنتجات: ${categoriesResult.error.message}`);
  if (productsResult.error) throw new Error(`تعذر تحميل المنتجات: ${productsResult.error.message}`);

  const rows = (productsResult.data ?? []) as CatalogProductRow[];
  const ids = rows.map((row) => row.id);
  if (ids.length === 0) {
    return { categories: (categoriesResult.data ?? []).map((row) => row.name), products: [] };
  }

  const [images, units, measurements, variants, specs, warranties, regions, productTranslations, categoryTranslations, unitTranslations, measurementTranslations] = await Promise.all([
    supabase.from("product_images").select("id,product_id,label,alt_text,tone,storage_path,image_url,is_primary,sort_order").in("product_id", ids).order("is_primary", { ascending: false }).order("sort_order"),
    supabase.from("product_units").select("id,product_id,name,sort_order").in("product_id", ids).order("sort_order"),
    supabase.from("product_measurements").select("id,product_id,unit_id,label,is_default,sort_order").in("product_id", ids).order("sort_order"),
    supabase.from("product_variants").select("id,product_id,name,sku,attributes,sort_order").in("product_id", ids).eq("is_active", true).order("sort_order"),
    supabase.from("product_specifications").select("product_id,value,sort_order").in("product_id", ids).order("sort_order"),
    supabase.from("product_warranties").select("product_id,label,duration,details").in("product_id", ids),
    supabase.from("product_availability_regions").select("product_id,city,scope").in("product_id", ids),
    supabase.from("product_translations").select("product_id,name,short_description,description,full_description,availability_summary,lead_time_label,delivery_label,delivery_window,delivery_notes").eq("locale", locale).in("product_id", ids).not("reviewed_at", "is", null),
    supabase.from("product_category_translations").select("category_id,name").eq("locale", locale).not("reviewed_at", "is", null),
    supabase.from("product_unit_translations").select("unit_id,name").eq("locale", locale).not("reviewed_at", "is", null),
    supabase.from("product_measurement_translations").select("measurement_id,label").eq("locale", locale).not("reviewed_at", "is", null),
  ]);

  const relatedError = [images.error, units.error, measurements.error, variants.error, specs.error, warranties.error, regions.error, productTranslations.error, categoryTranslations.error, unitTranslations.error, measurementTranslations.error].find(Boolean);
  if (relatedError) throw new Error(`تعذر تحميل تفاصيل المنتجات: ${relatedError.message}`);

  const categoryTranslationNames = new Map((categoryTranslations.data ?? []).map((row) => [row.category_id, row.name]));
  const categoryNames = new Map((categoriesResult.data ?? []).map((row) => [row.id, categoryTranslationNames.get(row.id) ?? row.name]));
  const unitTranslationNames = new Map((unitTranslations.data ?? []).map((row) => [row.unit_id, row.name]));
  const unitNames = new Map((units.data ?? []).map((row) => [row.id, unitTranslationNames.get(row.id) ?? row.name]));
  const measurementTranslationLabels = new Map((measurementTranslations.data ?? []).map((row) => [row.measurement_id, row.label]));
  const productTranslationRows = new Map((productTranslations.data ?? []).map((row) => [row.product_id, row]));
  const imageRows = (images.data ?? []) as CatalogImageRow[];
  const storedImages = imageRows.filter((image) => image.storage_path);
  const signedImageUrls = storedImages.length
    ? await signProductImageMap(
        createAdminClient(),
        storedImages.map((image) => image.storage_path!),
        { width: 720, height: 720, quality: 72 },
      )
    : new Map<string, string>();

  const products = rows.map<Product>((row) => {
    const translated = productTranslationRows.get(row.id);
    return ({
    id: row.id,
    sku: row.sku,
    name: translated?.name ?? row.name,
    category: row.custom_category || (row.category_id ? categoryNames.get(row.category_id) : null) || "غير مصنف",
    unit: (units.data ?? []).find((unit) => unit.product_id === row.id && unit.name === row.base_unit)?.id
      ? unitNames.get((units.data ?? []).find((unit) => unit.product_id === row.id && unit.name === row.base_unit)!.id) ?? row.base_unit
      : row.base_unit,
    description: translated?.description || row.description,
    shortDescription: translated?.short_description || row.short_description,
    fullDescription: translated?.full_description || row.full_description,
    availability: translated?.availability_summary || row.availability_summary,
    availabilityStatus: availabilityLabels[row.availability_status] ?? "حسب الطلب",
    leadTime: translated?.lead_time_label || row.lead_time_label,
    specs: (specs.data ?? []).filter((item) => item.product_id === row.id).map((item) => item.value),
    measurements: (measurements.data ?? []).filter((item) => item.product_id === row.id).map((item) => ({
      id: item.id,
      label: measurementTranslationLabels.get(item.id) ?? item.label,
      unit: unitNames.get(item.unit_id) ?? row.base_unit,
      isDefault: item.is_default,
    })),
    variants: (variants.data ?? []).filter((item) => item.product_id === row.id).map((item) => ({
      id: item.id,
      name: item.name,
      sku: item.sku,
      attributes: normalizeVariantAttributes(item.attributes),
    })),
    units: (units.data ?? []).filter((item) => item.product_id === row.id).map((item) => item.name),
    delivery: { label: translated?.delivery_label || row.delivery_label, window: translated?.delivery_window || row.delivery_window, notes: translated?.delivery_notes || row.delivery_notes },
    deliveryDetails: {
      available: Boolean(row.delivery_label.trim()) && !row.delivery_label.includes("غير متاح"),
      maximumDuration: translated?.delivery_window || row.delivery_window || null,
      pricePerKm: null,
      maximumDistanceKm: null,
      regions: (regions.data ?? []).filter((item) => item.product_id === row.id).map((item) => item.city),
      notes: translated?.delivery_notes || row.delivery_notes,
    },
    regions: (regions.data ?? []).filter((item) => item.product_id === row.id).map((item) => ({ city: item.city, scope: item.scope })),
    warranty: (() => {
      const warranty = (warranties.data ?? []).find((item) => item.product_id === row.id);
      return warranty
        ? { label: warranty.label, duration: warranty.duration, details: warranty.details }
        : { label: "لا توجد معلومات ضمان", duration: "—", details: "لم تُسجل معلومات ضمان لهذا المنتج." };
    })(),
    images: imageRows.filter((item) => item.product_id === row.id).map((item) => ({
      id: item.id,
      label: item.label,
      alt: item.alt_text,
      tone: item.tone as ProductImage["tone"],
      url: (item.storage_path ? signedImageUrls.get(item.storage_path) : null) || item.image_url,
    })),
    deliveryNotes: translated?.delivery_notes || row.delivery_notes,
    offerType: row.offer_type === "rental" ? "تأجير" : "بيع",
    minimumOrder: row.minimum_order,
    stockQuantity: row.stock_quantity,
    vatInclusive: row.vat_inclusive,
    rentalDuration: row.offer_type === "rental" ? formatDuration(row.rental_duration_value, row.rental_duration_unit) : null,
    isNew: row.is_new,
    });
  });

  return { categories: (categoriesResult.data ?? []).map((row) => categoryNames.get(row.id) ?? row.name), products };
}
