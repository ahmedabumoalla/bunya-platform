export type RfqProduct = {
  id: string; name: string; base_unit: string; description: string | null;
  minimum_order: number | null; stock_quantity: number | null;
  product_brands: { name: string } | null;
  product_units: { id: string; name: string; is_base: boolean }[];
  product_measurements: { id: string; label: string; unit_id: string | null; is_default: boolean; sort_order: number }[];
  product_variants: { id: string; name: string; attributes: Record<string, unknown>; is_active: boolean; sort_order: number }[];
  product_specifications: { value: string; sort_order: number }[];
};
export const rfqProductSelect = "id,name,base_unit,description,minimum_order,stock_quantity,product_brands(name),product_units(id,name,is_base),product_measurements(id,label,unit_id,is_default,sort_order),product_variants(id,name,attributes,is_active,sort_order),product_specifications(value,sort_order)";
export type RfqSelection = { product_id: string; quantity: string; unit_id: string; measurement_id: string; variant_ids: Record<string, string> };
export const minimumQuantity = (product?: RfqProduct) => Math.max(Number(product?.minimum_order) || 1, .001);
export const productUnits = (product?: RfqProduct) => product?.product_units.length ? product.product_units : product?.base_unit ? [{ id: "", name: product.base_unit, is_base: true }] : [];
export const productMeasurements = (product: RfqProduct | undefined, unitId: string) => [...(product?.product_measurements ?? [])].filter(item => !item.unit_id || item.unit_id === unitId).sort((a, b) => a.sort_order - b.sort_order);
export function variantAttributes(variant: RfqProduct["product_variants"][number]) {
  return Object.entries(variant.attributes ?? {}).filter(([, value]) => value !== null && value !== undefined && String(value).trim()).map(([label, value]) => ({ label, value: String(value) }));
}
export function productVariantGroups(product?: RfqProduct) {
  const labels: Record<string, string> = { brand: "العلامة التجارية", manufacturer: "المصنّع", factory: "المصنع", size: "المقاس", color: "اللون", model: "الموديل", grade: "الدرجة" };
  const groups = new Map<string, { key: string; label: string; options: { id: string; label: string }[] }>();
  for (const variant of [...(product?.product_variants ?? [])].filter(item => item.is_active).sort((a, b) => a.sort_order - b.sort_order)) {
    const attributes = variantAttributes(variant);
    const key = attributes.length === 1 ? attributes[0].label.trim() : "__variant__";
    const group = groups.get(key) ?? { key, label: labels[key.toLowerCase()] ?? (key === "__variant__" ? "الفئة المتوفرة" : key), options: [] };
    group.options.push({ id: variant.id, label: attributes.length === 1 ? attributes[0].value : attributes.map(item => `${item.label}: ${item.value}`).join(" · ") || variant.name });
    groups.set(key, group);
  }
  return [...groups.values()];
}
export function fixedProductBrand(product?: RfqProduct) {
  if (product?.product_brands?.name) return product.product_brands.name;
  const specification = product?.product_specifications.find(item => /^(?:المصنّ?ع|العلامة التجارية|الشركة المصنعة|المصنع|brand|manufacturer)/i.test(item.value.trim()));
  return specification?.value.split(/[:：]/).slice(1).join(":").trim() ?? "";
}
export function initialProductSelection(product?: RfqProduct): RfqSelection {
  const units = productUnits(product);
  const measurement = product?.product_measurements.find(item => item.is_default && (!item.unit_id || units.some(unit => unit.id === item.unit_id)));
  const unitId = measurement?.unit_id || units.find(item => item.is_base)?.id || units[0]?.id || "";
  const measurements = productMeasurements(product, unitId);
  return { product_id: product?.id ?? "", quantity: String(minimumQuantity(product)), unit_id: unitId, measurement_id: measurement?.id || (measurements.length === 1 ? measurements[0].id : ""), variant_ids: Object.fromEntries(productVariantGroups(product).map(group => [group.key, group.options.length === 1 ? group.options[0].id : ""])) };
}
export function productSelectionError(product: RfqProduct | undefined, selection: RfqSelection) {
  if (!product || product.id !== selection.product_id) return "اختر منتجًا من القائمة المتاحة.";
  const units = productUnits(product);
  if (!units.some(unit => unit.id === selection.unit_id)) return "اختر وحدة بيع متوفرة لهذا المنتج.";
  const quantity = Number(selection.quantity);
  if (!Number.isFinite(quantity) || quantity < minimumQuantity(product) || quantity > 1_000_000 || Math.abs(quantity * 1000 - Math.round(quantity * 1000)) > .000001) return `الحد الأدنى للطلب ${minimumQuantity(product)}، والكمية تقبل حتى 3 منازل عشرية.`;
  const measurements = productMeasurements(product, selection.unit_id);
  if ((measurements.length && !measurements.some(item => item.id === selection.measurement_id)) || (selection.measurement_id && !measurements.some(item => item.id === selection.measurement_id))) return "اختر مقاسًا متوفرًا لوحدة البيع المحددة.";
  const groups = productVariantGroups(product);
  if (groups.some(group => !group.options.some(item => item.id === selection.variant_ids[group.key])) || Object.keys(selection.variant_ids).some(key => !groups.some(group => group.key === key))) return "اختر العلامة والفئات المتوفرة المطلوبة لهذا المنتج.";
  return "";
}
