import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { flattenVariants, summarizeAttributes } from './lib/catalog-import.mjs';

const root = process.cwd();
const snapshot = JSON.parse(await readFile(path.join(root, 'tmp/brkz-import/snapshot.json'), 'utf8'));
const imageDir = path.join(root, 'public/catalog/images');
const productDir = path.join(root, 'public/catalog/products');
const dataDir = path.join(root, 'src/data/catalog');
await Promise.all([imageDir, productDir, dataDir].map(dir => mkdir(dir, { recursive: true })));
const hash = data => createHash('sha256').update(data).digest('hex').slice(0,24);
const imageName = url => `${hash(url)}.webp`;
const urls = [...new Set(snapshot.products.flatMap(product => product.images))];
let cursor = 0;
let totalBytes = 0;
await Promise.all(Array.from({ length: 4 }, async () => {
  while (cursor < urls.length) {
    const index = cursor++;
    const url = urls[index];
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'res.cloudinary.com' || !parsed.pathname.startsWith('/dtbk6u1pb/image/upload/')) throw new Error(`Unexpected image host/path: ${url}`);
    const destination = path.join(imageDir, imageName(url));
    try { totalBytes += (await stat(destination)).size; continue; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    let buffer;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(45000), redirect: 'error' });
        if (!response.ok) throw new Error(`Image HTTP ${response.status}: ${url}`);
        if (!response.headers.get('content-type')?.startsWith('image/')) throw new Error(`Invalid image MIME: ${url}`);
        const input = Buffer.from(await response.arrayBuffer());
        if (input.length > 20000000) throw new Error(`Oversized image: ${url}`);
        buffer = await sharp(input, { limitInputPixels: 50000000 }).rotate().resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true }).webp({ quality: 88 }).toBuffer();
        break;
      } catch (error) {
        if (attempt === 3) throw error;
        await new Promise(resolve => setTimeout(resolve, 1500 * (attempt + 1)));
      }
    }
    await writeFile(destination, buffer);
    totalBytes += buffer.length;
    if ((index + 1) % 50 === 0) console.log(`Images ${index + 1}/${urls.length}`);
  }
}));

let missingAttributes = 0;
const summaries = [];
const provenance = [];
for (const product of snapshot.products) {
  const variants = flattenVariants(product);
  missingAttributes += variants.filter(variant => !variant.attributes.length).length;
  const attributes = summarizeAttributes(variants);
  const id = `brkz-${product.id}`;
  const units = [...new Set(product.units.map(unit => unit.name.trim()))];
  const images = product.images.map(url => `/catalog/images/${imageName(url)}`);
  // Use factual names/specifications with original summary wording, not copied marketing prose.
  const description = `${product.name} ضمن ${product.category} — ${product.subcategory}. ${units.length ? `وحدات القياس: ${units.join('، ')}.` : ''}`.trim();
  const detail = { id, name: product.name, category: product.category, subcategory: product.subcategory, description, units, images, attributes, variants };
  const serialized = JSON.stringify(detail);
  const detailsPath = `/catalog/products/${id}.${hash(serialized)}.json`;
  await writeFile(path.join(root, 'public', detailsPath), serialized);
  summaries.push({ id, name: product.name, category: product.category, subcategory: product.subcategory, description, units, images, variantCount: variants.length,
    searchText: attributes.map(attribute => `${attribute.label} ${attribute.values.join(' ')}`).join(' '), detailsPath });
  provenance.push({ id, sourceId: product.id, categoryId: product.categoryId, subcategoryId: product.subcategoryId, images: product.images.map(url => ({ source: url, local: `/catalog/images/${imageName(url)}` })), detailsPath });
}
const manifest = { source: snapshot.source, retrievedAt: snapshot.retrievedAt, categories: snapshot.categories, products: summaries };
await writeFile(path.join(dataDir, 'imported.json'), JSON.stringify(manifest));
await writeFile(path.join(dataDir, 'provenance.json'), JSON.stringify({ source: snapshot.source, retrievedAt: snapshot.retrievedAt, records: provenance }));
console.log(JSON.stringify({ products: summaries.length, categories: snapshot.categories.length, subcategories: snapshot.categories.reduce((sum, category) => sum + category.subcategories.length, 0), variants: summaries.reduce((sum, product) => sum + product.variantCount, 0), missingAttributes, images: urls.length, imageBytes: totalBytes }));
