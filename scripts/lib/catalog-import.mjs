/** Preserve complete SKU paths; never make a Cartesian product of independent options. */
export function flattenVariants(product) {
  const paths = new Map();
  function walk(groups, ancestors = []) {
    for (const group of groups ?? []) {
      if (typeof group.name !== 'string' || !Array.isArray(group.values)) throw new Error('Invalid attribute group');
      for (const option of group.values) {
        const attributes = [...ancestors, { label: group.name.trim(), value: String(option.value).trim() }];
        if (option.sku) {
          const previous = paths.get(option.sku);
          if (previous && JSON.stringify(previous) !== JSON.stringify(attributes)) throw new Error(`Conflicting SKU ${option.sku}`);
          paths.set(option.sku, attributes);
        }
        if (option.attributes) walk(option.attributes, attributes);
      }
    }
  }
  walk(product.attributes);
  const skus = new Set(product.variations.map(variation => variation.sku));
  if (skus.size !== product.variations.length) throw new Error(`Duplicate SKU in ${product.id}`);
  for (const sku of paths.keys()) if (!skus.has(sku)) throw new Error(`Unlisted SKU ${sku}`);
  return product.variations.map(({ sku }) => ({ sku, attributes: paths.get(sku) ?? [] }));
}

export function summarizeAttributes(variants) {
  const groups = new Map();
  for (const variant of variants) for (const attribute of variant.attributes) {
    if (!groups.has(attribute.label)) groups.set(attribute.label, new Set());
    groups.get(attribute.label).add(attribute.value);
  }
  return [...groups].map(([label, values]) => ({ label, values: [...values] }));
}
