export type CatalogVariant = { sku: string; attributes: { label: string; value: string }[] };
export type PlatformProductDetails = {
  id: string;
  name: string;
  category: string;
  subcategory: string;
  description: string;
  units: string[];
  images: string[];
  attributes: { label: string; values: string[] }[];
  variants: CatalogVariant[];
};

export function parsePlatformDetails(value: unknown, expectedId: string): PlatformProductDetails {
  if (!value || typeof value !== "object") throw new Error("Invalid catalog detail");
  const data = value as PlatformProductDetails;
  if (data.id !== expectedId || ![data.name, data.category, data.subcategory, data.description].every(item => typeof item === "string") ||
    !Array.isArray(data.units) || !data.units.every(item => typeof item === "string") ||
    !Array.isArray(data.images) || !data.images.every(item => typeof item === "string" && /^\/catalog\/images\/[a-f0-9]+\.webp$/.test(item)) ||
    !Array.isArray(data.attributes) || !data.attributes.every(item => item && typeof item.label === "string" && Array.isArray(item.values) && item.values.every(value => typeof value === "string")) ||
    !Array.isArray(data.variants) || !data.variants.every(item => item && typeof item.sku === "string" && Array.isArray(item.attributes) && item.attributes.every(attribute => attribute && typeof attribute.label === "string" && typeof attribute.value === "string"))) {
    throw new Error("Invalid catalog detail");
  }
  return data;
}

export function filterCatalogVariants(variants: CatalogVariant[], query: string, filters: Record<string, string>) {
  const text = query.trim().toLocaleLowerCase();
  return variants.filter(variant =>
    (!text || `${variant.sku} ${variant.attributes.map(attribute => attribute.value).join(" ")}`.toLocaleLowerCase().includes(text)) &&
    Object.entries(filters).every(([label, value]) => !value || variant.attributes.some(attribute => attribute.label === label && attribute.value === value)),
  );
}
