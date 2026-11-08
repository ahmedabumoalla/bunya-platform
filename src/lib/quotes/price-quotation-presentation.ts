type Attribute = { label: string; value: string };
type ProductIdentity = { product_id: string; product_name: string; sku: string; category?: string };

// These catalog titles contain supplier labels that differ from their tagged
// brand value. Keep the correction quotation-only; retain source catalog data.
const catalogItemNames: Record<string, string> = {
  "لفائف عزل بوليستر عادي درع الخليج": "لفائف عزل بوليستر عادي",
  "لفائف عزل بوليستر عادي - سيل": "لفائف عزل بوليستر عادي",
};

const normalizeLabel = (value: string) => value.normalize("NFKC").replace(/[\u064b-\u065f\u0670]/g, "").replace(/[أإآ]/g, "ا").trim().toLocaleLowerCase().replace(/[\s_-]+/g, " ");

export function isQuotationBrandAttribute(attribute: Attribute) {
  return ["العلامة التجارية", "علامة تجارية", "اسم العلامة التجارية", "الماركة", "ماركة", "brand", "brand name", "manufacturer", "الشركة المصنعة"].includes(normalizeLabel(attribute.label));
}

export function quotationKeepsBrand(product: ProductIdentity) {
  // Imported SKUs retain the category identity for historical immutable rows
  // that predate category snapshots. Never infer iron from a word in a tool name.
  return ["الحديد", "حديد", "steel", "iron"].includes(normalizeLabel(product.category ?? ""))
    || (product.product_id.startsWith("brkz-") && /^(?:ST|STE)-/.test(product.sku));
}

export function quotationProductName(product: ProductIdentity, attributes: Attribute[]) {
  if (quotationKeepsBrand(product)) return product.product_name;
  let name = product.product_id.startsWith("brkz-") ? catalogItemNames[product.product_name] ?? product.product_name : product.product_name;
  for (const { value } of attributes.filter(isQuotationBrandAttribute)) {
    const brand = value.trim();
    if (!brand) continue;
    // Match the declared brand only, with word boundaries. Do not build a
    // global brand blacklist: words such as "ألياف" can be material names.
    const escaped = brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s*");
    const candidate = name.replace(new RegExp(`(^|[\\s،,:;()—–-])${escaped}(?=$|[\\s،,:;()—–-])`, "giu"), "$1").replace(/\s+/g, " ").replace(/^[\s،,:;()—–-]+|[\s،,:;()—–-]+$/g, "");
    if (candidate) name = candidate;
  }
  return name;
}

export function quotationItemPresentation<T extends ProductIdentity & { attributes: Attribute[] }>(item: T): T {
  if (quotationKeepsBrand(item)) return item;
  return { ...item, product_name: quotationProductName(item, item.attributes), attributes: item.attributes.filter(attribute => !isQuotationBrandAttribute(attribute)) };
}
