import "server-only";
import manifest from "@/data/catalog/imported.json";
import options from "@/data/catalog/quote-options.json";
import type { ManagedQuoteContext } from "./managed-server";
import { ManagedQuoteError } from "./managed-server";
import type { PriceQuotationCatalogProduct, PriceQuotationDraftItem, PriceQuotationItem } from "./price-quotation-types";
import type { CatalogVariant } from "@/lib/catalog/platform-details";
import { canonicalPlatformQuoteItem } from "./managed-catalog";

const variants = options as Record<string, CatalogVariant[]>;

export async function priceQuotationCatalog(context: ManagedQuoteContext, search: string, id: string | null) {
  const term = search.toLocaleLowerCase().trim();
  const matches = manifest.products.filter(product => id ? product.id === id : `${product.name} ${product.searchText}`.toLocaleLowerCase().includes(term));
  const platform: PriceQuotationCatalogProduct[] = matches.slice(0, 30).map(product => ({ id: product.id, name: product.name, category: product.category, units: product.units.length ? product.units : ["تحددها الإدارة"], variants: id ? variants[product.id] ?? [] : [], image_url: product.images[0] ?? "" }));
  if (id?.startsWith("brkz-")) return { products: platform, total: matches.length, hasMore: false };
  let query = context.admin.from("products").select("id,name,base_unit,sku", { count: "exact" }).eq("is_published", true).eq("review_status", "approved").neq("availability_status", "unavailable");
  if (id) query = query.eq("id", id);
  else if (term) query = query.ilike("name", `%${term.replace(/[\\%_]/g, "\\$&")}%`);
  const result = await query.order("name").limit(30);
  if (result.error) throw new ManagedQuoteError(503, "تعذر تحميل كتالوج المنتجات. أعد المحاولة.");
  const supplier: PriceQuotationCatalogProduct[] = [];
  for (const product of result.data ?? []) {
    const row: PriceQuotationCatalogProduct = { id: product.id, name: product.name, category: "منتجات المنصة", units: [product.base_unit], variants: [], image_url: "" };
    if (id) {
      const [units, selections, measurements] = await Promise.all([
        context.admin.from("product_units").select("id,name").eq("product_id", id).order("sort_order"),
        context.admin.from("product_variants").select("id,sku,attributes").eq("product_id", id).eq("is_active", true).order("sort_order"),
        context.admin.from("product_measurements").select("id,label,unit_id").eq("product_id", id).order("sort_order"),
      ]);
      if (units.error || selections.error || measurements.error) throw new ManagedQuoteError(503, "تعذر تحميل مواصفات المنتج.");
      row.units = units.data?.length ? [...new Set(units.data.map(unit => String(unit.name)))] : [product.base_unit];
      row.measurements = (measurements.data ?? []).map(measurement => ({ id: measurement.id, label: measurement.label, unit: units.data?.find(unit => unit.id === measurement.unit_id)?.name ?? product.base_unit }));
      row.variants = (selections.data ?? []).map(selection => ({ id: selection.id, sku: selection.sku || selection.id, attributes: Object.entries(selection.attributes ?? {}).map(([label, value]) => ({ label, value: String(value) })) }));
    }
    supplier.push(row);
  }
  const total = matches.length + (result.count ?? 0);
  const products = [...supplier, ...platform].slice(0, 30);
  return { products, total, hasMore: total > products.length };
}

export async function canonicalPriceQuotationItem(context: ManagedQuoteContext, item: PriceQuotationDraftItem, index: number): Promise<Omit<PriceQuotationItem, "line_total">> {
  if (item.product_id.startsWith("brkz-")) {
    try {
      const canonical = canonicalPlatformQuoteItem({ id: String(index), productId: item.product_id, productName: "", unit: item.unit, quantity: item.quantity, selectedVariants: item.sku ? [{ id: item.sku, name: "", attributes: [] }] : [], measurementId: "", measurementLabel: "", desiredReceiptDate: "", mapsUrl: "", createdAt: "", notes: item.notes }, index);
      return { product_id: canonical.product_id, product_name: canonical.product_name, sku: canonical.sku, unit: canonical.unit, quantity: canonical.quantity, attributes: canonical.attributes, notes: item.notes ?? "", unit_price: item.unit_price };
    } catch { throw new ManagedQuoteError(400, "أعد اختيار المنتج ووحدته ومواصفاته من الكتالوج."); }
  }
  const [{ data: product, error }, { data: selections, error: variantError }] = await Promise.all([
    context.admin.from("products").select("id,name,sku").eq("id", item.product_id).eq("is_published", true).maybeSingle(),
    context.admin.from("product_variants").select("id,sku").eq("product_id", item.product_id).eq("is_active", true),
  ]);
  if (error || variantError) throw new ManagedQuoteError(503, "تعذر التحقق من المنتج.");
  const selection = selections?.find(row => (row.sku || row.id) === item.sku);
  const selectedIds = item.variant_ids?.length ? item.variant_ids : selection ? [selection.id] : [];
  if (!product || selectedIds.some(id => !selections?.some(row => row.id === id)) || ((selections?.length ?? 0) > 0 && !selectedIds.length) || (!selections?.length && !!item.sku)) throw new ManagedQuoteError(400, "المنتج أو المواصفات غير متاحة.");
  const canonical = await context.admin.rpc("canonicalize_rfq_catalog_item", { p_item: { product_id: item.product_id, unit: item.unit, quantity: item.quantity, variant_ids: selectedIds, measurement_id: item.measurement_id || "", measurement: "" } });
  if (canonical.error || !canonical.data) throw new ManagedQuoteError(400, "أعد اختيار وحدة المنتج ومواصفاته.");
  const row = canonical.data;
  const attributes: { label: string; value: string }[] = [];
  if (row.measurement) attributes.push({ label: "القياس", value: String(row.measurement) });
  for (const variant of row.variant_selections ?? []) for (const [label, value] of Object.entries(variant.attributes ?? {})) attributes.push({ label, value: String(value) });
  for (const specification of row.product_specifications_snapshot ?? []) attributes.push({ label: "المواصفات", value: String(specification) });
  return { product_id: product.id, product_name: row.product_name, unit: row.unit, quantity: row.quantity, unit_price: item.unit_price, sku: selections?.filter(variant => selectedIds.includes(variant.id)).map(variant => variant.sku).filter(Boolean).join(" / ") || product.sku || "", attributes, notes: item.notes ?? "" };
}
