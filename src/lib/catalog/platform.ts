import "server-only";
import manifest from "@/data/catalog/imported.json";
import type { Product } from "@/lib/bunya-types";

/** Platform-owned display catalog: no supplier identity, stock, or transactional IDs. */
export function loadPlatformCatalog(): { categories: string[]; products: Product[] } {
  return {
    categories: manifest.categories.map(category => category.name),
    products: manifest.products.map(item => ({
      id: item.id, sku: null, name: item.name, category: item.category,
      unit: item.units[0] || "غير محددة", units: item.units,
      description: item.description, shortDescription: item.subcategory, fullDescription: item.description,
      availability: "كتالوج المنتجات", availabilityStatus: "حسب الطلب",
      leadTime: "غير محدد", specs: [], measurements: [], variants: [],
      delivery: { label: "غير محدد", window: "غير محدد", notes: "" },
      deliveryDetails: { available: false, maximumDuration: null, pricePerKm: null, maximumDistanceKm: null, regions: [], notes: "" },
      regions: [], warranty: { label: "غير محدد", duration: "", details: "" },
      images: item.images.map((url, index) => ({ id: `${item.id}-${index}`, url, label: `صورة ${index + 1}`, alt: item.name, tone: "cement", mimeType: "image/webp" })),
      deliveryNotes: "", offerType: "بيع", minimumOrder: null, stockQuantity: null, rentalDuration: null,
      catalogEntry: { subcategory: item.subcategory, variantCount: item.variantCount, searchText: item.searchText, detailsPath: item.detailsPath },
    })),
  };
}
