import "server-only";
import manifest from "@/data/catalog/imported.json";
import options from "@/data/catalog/quote-options.json";
import type { CatalogVariant } from "@/lib/catalog/platform-details";
import type { QuoteRequestItem } from "@/lib/bunya-types";
import type { ManagedQuoteItem } from "./managed-types";

const products = new Map(manifest.products.map(product => [product.id, product]));
const variantOptions = options as Record<string, CatalogVariant[]>;

export function canonicalPlatformQuoteItem(item: QuoteRequestItem, index: number): ManagedQuoteItem {
  const product = products.get(item.productId);
  if (!product) throw new Error("Product is not available");
  if (!Number.isFinite(item.quantity) || item.quantity <= 0 || item.quantity > 1000000 || item.quantity !== Number(item.quantity.toFixed(3))) throw new Error("Invalid item quantity");
  if (product.units.length ? !product.units.includes(item.unit) : item.unit !== "تحددها الإدارة") throw new Error("Product unit is not available");
  const variants = variantOptions[product.id];
  const selected = variants.find(variant => variant.sku === item.selectedVariants[0]?.id);
  if (variants.length ? item.selectedVariants.length !== 1 || !selected : item.selectedVariants.length !== 0) throw new Error("Product variant is not available");
  return {
    id: `line-${index + 1}`, product_id: product.id, product_name: product.name, category: product.category,
    quantity: item.quantity, unit: item.unit, sku: selected?.sku ?? "", attributes: selected?.attributes ?? [],
    image_url: product.images[0] ?? "", notes: item.notes ?? "",
  };
}
