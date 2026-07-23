import "server-only";

import type { Product, ProductImage } from "@/lib/bunya-types";
import { createClient } from "@/lib/supabase/server";

type CatalogProductRow = {
  id: string;
  category_id: string;
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

const availabilityLabels = {
  available: "متوفر",
  limited: "كمية محدودة",
  on_request: "حسب الطلب",
} as const;

export async function loadPublicCatalog(): Promise<{ categories: string[]; products: Product[] }> {
  const supabase = await createClient();
  const [categoriesResult, productsResult] = await Promise.all([
    supabase.from("product_categories").select("id,name,sort_order").eq("is_active", true).order("sort_order"),
    supabase.from("products").select("id,category_id,name,base_unit,short_description,description,full_description,availability_summary,availability_status,lead_time_label,delivery_label,delivery_window,delivery_notes,is_new").eq("is_published", true).order("created_at", { ascending: false }),
  ]);

  if (categoriesResult.error) throw new Error(`تعذر تحميل تصنيفات المنتجات: ${categoriesResult.error.message}`);
  if (productsResult.error) throw new Error(`تعذر تحميل المنتجات: ${productsResult.error.message}`);

  const rows = (productsResult.data ?? []) as CatalogProductRow[];
  const ids = rows.map((row) => row.id);
  if (ids.length === 0) {
    return { categories: (categoriesResult.data ?? []).map((row) => row.name), products: [] };
  }

  const [images, units, measurements, specs, warranties, regions] = await Promise.all([
    supabase.from("product_images").select("id,product_id,label,alt_text,tone,sort_order").in("product_id", ids).order("sort_order"),
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

  const products = rows.map<Product>((row) => ({
    id: row.id,
    name: row.name,
    category: categoryNames.get(row.category_id) ?? "غير مصنف",
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
    images: (images.data ?? []).filter((item) => item.product_id === row.id).map((item) => ({
      id: item.id,
      label: item.label,
      alt: item.alt_text,
      tone: item.tone as ProductImage["tone"],
    })),
    deliveryNotes: row.delivery_notes,
    isNew: row.is_new,
  }));

  return { categories: (categoriesResult.data ?? []).map((row) => row.name), products };
}
