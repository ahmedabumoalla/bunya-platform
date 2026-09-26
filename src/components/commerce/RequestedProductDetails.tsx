import styles from "./RequestedProductDetails.module.css";

function record(value: unknown): Record<string, unknown> | null {
  const item = Array.isArray(value) ? value[0] : value;
  return item && typeof item === "object" ? item as Record<string, unknown> : null;
}

export function RequestedProductDetails({ snapshot }: { snapshot: unknown }) {
  const item = record(snapshot);
  if (!item) return null;
  const savedLabel = item.variant_label_snapshot ?? item.variant_snapshot;
  const structuredOptions = Array.isArray(item.variant_selections) ? item.variant_selections.flatMap((selection) => {
    const variant = record(selection);
    if (!variant) return [];
    const attributes = record(variant.attributes);
    const values = attributes ? Object.entries(attributes).flatMap(([key, value]) => typeof value === "string" || typeof value === "number" ? [`${key}: ${value}`] : []) : [];
    return values.length ? values : typeof variant.name === "string" && variant.name.trim() ? [variant.name.trim()] : [];
  }) : [];
  const optionLabel = typeof savedLabel === "string" && savedLabel.trim() ? savedLabel.trim() : structuredOptions.join(" · ");
  const specifications = Array.isArray(item.product_specifications_snapshot) ? item.product_specifications_snapshot.filter((value): value is string => typeof value === "string" && Boolean(value.trim())) : [];
  if (!optionLabel && !specifications.length) return null;
  return <div className={styles.details}>
    {optionLabel ? <div className={styles.options}><b>الخيارات المحددة</b><p>{optionLabel}</p></div> : null}
    {specifications.length ? <div className={styles.specifications}><b>مواصفات المنتج</b><ul>{specifications.map((value, index) => <li key={`${index}:${value}`}>{value}</li>)}</ul></div> : null}
  </div>;
}
