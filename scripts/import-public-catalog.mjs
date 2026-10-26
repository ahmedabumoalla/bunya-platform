import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const cacheDir = path.join(root, 'tmp/brkz-import');
const api = 'https://api.brkz.com';
const headers = { 'content-type': 'application/json', 'accept-language': 'ar_sa', 'app-id': 'buyer-web' };
await mkdir(cacheDir, { recursive: true });

async function jsonRequest(key, endpoint, body) {
  const destination = path.join(cacheDir, `${key}.json`);
  try { return JSON.parse(await readFile(destination, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await fetch(`${api}${endpoint}`, {
      method: body ? 'POST' : 'GET', headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(45000),
    });
    if ((response.status === 429 || response.status >= 500) && attempt < 3) {
      await new Promise(resolve => setTimeout(resolve, 1500 * (attempt + 1)));
      continue;
    }
    if (!response.ok) throw new Error(`${key}: HTTP ${response.status}`);
    const data = await response.json();
    await writeFile(destination, JSON.stringify(data));
    return data;
  }
  throw new Error(`Unable to retrieve ${key}`);
}

async function search(key, filters = {}) {
  const first = await jsonRequest(`${key}-0`, '/contractors/products/search', { page: 0, size: 100, ...filters });
  if (!Array.isArray(first.content) || !Number.isInteger(first.numberOfElements)) throw new Error(`Invalid search: ${key}`);
  const items = [...first.content];
  for (let page = 1; page < first.totalPages; page++) {
    const next = await jsonRequest(`${key}-${page}`, '/contractors/products/search', { page, size: 100, ...filters });
    items.push(...next.content);
  }
  if (new Set(items.map(item => item.id)).size !== first.numberOfElements) throw new Error(`Incomplete search: ${key}`);
  return items;
}

async function parallel(items, work, concurrency = 4) {
  let cursor = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (cursor < items.length) { const index = cursor++; await work(items[index], index); }
  }));
}

let sourceData;
try { sourceData = JSON.parse(await readFile(path.join(cacheDir, 'page.json'), 'utf8')); }
catch (error) {
  if (error.code !== 'ENOENT') throw error;
  const response = await fetch('https://brkz.com/ar/buy-material', { signal: AbortSignal.timeout(45000) });
  if (!response.ok) throw new Error(`Catalog page: HTTP ${response.status}`);
  const html = await response.text();
  const json = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/)?.[1];
  if (!json) throw new Error('Catalog page data not found');
  sourceData = JSON.parse(json);
  await writeFile(path.join(cacheDir, 'page.json'), JSON.stringify(sourceData));
}
const categories = sourceData.props.pageProps.categoriesArr;
const products = await search('all');
console.log(`Catalog: ${products.length} products, ${categories.length} categories`);
const membership = new Map();
await parallel(categories, async category => {
  for (const subcategory of category.subCategories) {
    const items = await search(`subcategory-${subcategory.id}`, { categoryId: category.id, subCategoryId: subcategory.id });
    for (const item of items) {
      const previous = membership.get(item.id);
      if (previous && previous.subcategory.id !== subcategory.id) throw new Error(`Multiple categories for ${item.id}`);
      membership.set(item.id, { category, subcategory });
    }
  }
  console.log(`Classified: ${category.nameI18n.ar_sa}`);
});
const missing = products.filter(item => !membership.has(item.id));
if (missing.length) throw new Error(`Unclassified products: ${missing.map(item => item.id).join(',')}`);

const records = new Array(products.length);
await parallel(products, async (product, index) => {
  const detail = await jsonRequest(`product-${product.id}`, `/contractors/products/${product.id}/variations`);
  if (detail.productId !== product.id || !Array.isArray(detail.variations) || !Array.isArray(detail.attributes)) throw new Error(`Invalid detail ${product.id}`);
  const { category, subcategory } = membership.get(product.id);
  records[index] = { id: product.id, name: detail.name, category: category.nameI18n.ar_sa.trim(), subcategory: subcategory.nameI18n.ar_sa.trim(),
    categoryId: category.id, subcategoryId: subcategory.id, units: detail.units, images: [...new Set([...(product.imageUrls ?? []), ...(detail.imageUrls ?? [])])],
    variations: detail.variations.map(({ sku }) => ({ sku })), attributes: detail.attributes };
  if ((index + 1) % 50 === 0) console.log(`Details ${index + 1}/${products.length}`);
});
const snapshot = { source: 'https://brkz.com/ar/buy-material', retrievedAt: new Date().toISOString(), categories: categories.map(category => ({ id: category.id, name: category.nameI18n.ar_sa.trim(), subcategories: category.subCategories.map(sub => ({ id: sub.id, name: sub.nameI18n.ar_sa.trim() })) })), products: records };
await writeFile(path.join(cacheDir, 'snapshot.json'), JSON.stringify(snapshot));
console.log(JSON.stringify({ products: records.length, variants: records.reduce((sum, product) => sum + product.variations.length, 0), images: new Set(records.flatMap(product => product.images)).size, imageHosts: [...new Set(records.flatMap(product => product.images).map(url => new URL(url).hostname))], sha256: createHash('sha256').update(JSON.stringify(snapshot)).digest('hex') }));
