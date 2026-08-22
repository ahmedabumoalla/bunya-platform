import "server-only";

import type { Product, ProductImage } from "@/lib/bunya-types";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type CatalogProductRow = {
  id: string;
  category_id: string | null;
  custom_category: string | null;
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

export async function loadPublicCatalog(): Promise<{ categories: string[]; products: Product[] }> {
  const supabase = await createClient();
  const [categoriesResult, productsResult] = await Promise.all([
    supabase.from("product_categories").select("id,name,sort_order").eq("is_active", true).order("sort_order"),
    supabase.from("products").select("id,category_id,custom_category,name,base_unit,short_description,description,full_description,availability_summary,availability_status,lead_time_label,delivery_label,delivery_window,delivery_notes,is_new").eq("is_published", true).order("created_at", { ascending: false }),
  ]);

  if (categoriesResult.error) throw new Error(`تعذر تحميل تصنيفات المنتجات: ${categoriesResult.error.message}`);
  if (productsResult.error) throw new Error(`تعذر تحميل المنتجات: ${productsResult.error.message}`);

  const rows = (productsResult.data ?? []) as CatalogProductRow[];
  const ids = rows.map((row) => row.id);
  if (ids.length === 0) {
    return { categories: (categoriesResult.data ?? []).map((row) => row.name), products: [] };
  }

  const [images, units, measurements, specs, warranties, regions] = await Promise.all([
    supabase.from("product_images").select("id,product_id,label,alt_text,tone,storage_path,image_url,is_primary,sort_order").in("product_id", ids).order("is_primary", { ascending: false }).order("sort_order"),
    supabase.from("product_units").select("id,product_id,name,sort_order").in("product_id", ids).order("sort_order"),
    supabase.from("product_measurements").select("id,product_id,unit_id,label,is_default,sort_order").in("product_id", ids).order("sort_order"),
    supabase.from("product_specifications").select("product_id,value,sort_order").in("product_id", ids).order("sort_order"),
    supabase.from("product_warranties").select("product_id,label,duration,details").in("product_id", ids),
    supabase.from("product_availability_regions").select("product_id,city,scope").in("product_id", ids),
  ]);

  const relatedError = [images.error, units.error, measurements.error, specs.error, warranties.error, regions.error].find(Boolean);
  if (relatedError) throw new Error(`تعذر تحميل تفاصيل المنتجات: ${relatedError.message}`);

  const categoryNames = new Map((categoriesResult.data ?? []).map((row) => [row.id, row.name]));
  const unitNames = new Map((units.data ?? []).map((row) => [row.id, row.name]));
  const imageRows = (images.data ?? []) as CatalogImageRow[];
  const storedImages = imageRows.filter((image) => image.storage_path);
  const signedImageUrls = new Map<string, string>();

  if (storedImages.length > 0) {
    const admin = createAdminClient();
    const signed = await admin.storage
      .from("provider-product-images")
      .createSignedUrls(storedImages.map((image) => image.storage_path!), 3600);

    for (const image of signed.data ?? []) {
      if (image.path && image.signedUrl) signedImageUrls.set(image.path, image.signedUrl);
    }
  }

  const products = rows.map<Product>((row) => ({
    id: row.id,
    name: row.name,
    category: row.custom_category || (row.category_id ? categoryNames.get(row.category_id) : null) || "غير مصنف",
    unit: row.base_unit,
    description: row.description,
    shortDescription: row.short_description,
    fullDescription: row.full_description,
    availability: row.availability_summary,
    availabilityStatus: availabilityLabels[row.availability_status] ?? "حسب الطلب",
    leadTime: row.lead_time_label,
    specs: (specs.data ?? []).filter((item) => item.product_id === row.id).map((item) => item.value),
    measurements: (measurements.data ?? []).filter((item) => item.product_id === row.id).map((item) => ({
      id: item.id,
      label: item.label,
      unit: unitNames.get(item.unit_id) ?? row.base_unit,
      isDefault: item.is_default,
    })),
    units: (units.data ?? []).filter((item) => item.product_id === row.id).map((item) => item.name),
    delivery: { label: row.delivery_label, window: row.delivery_window, notes: row.delivery_notes },
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
    deliveryNotes: row.delivery_notes,
    isNew: row.is_new,
  }));

  return { categories: (categoriesResult.data ?? []).map((row) => row.name), products };
}
