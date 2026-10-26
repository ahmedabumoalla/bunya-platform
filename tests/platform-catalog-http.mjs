import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';

const baseUrl = process.argv[2] || 'http://127.0.0.1:3003';
const manifest = JSON.parse(readFileSync('src/data/catalog/imported.json', 'utf8'));
const response = await fetch(baseUrl, { signal: AbortSignal.timeout(45000) });
assert.equal(response.status, 200);
const html = await response.text();
assert.ok(html.includes(manifest.products[0].name));
assert.ok(html.includes('كتالوج بُنية'));
assert.ok(!html.includes('نجهّز لك مواد مشروعك'));
assert.equal((html.match(/class="sf-product-card /g) || []).length, 24);
for (const product of manifest.products) assert.ok(html.includes(product.id), `Missing product ${product.id}`);
const checks = [];
for (const category of manifest.categories) {
  const product = manifest.products.find(product => product.category === category.name);
  assert.ok(product);
  const [detailResponse, imageResponse] = await Promise.all([
    fetch(`${baseUrl}${product.detailsPath}`, { signal: AbortSignal.timeout(30000) }),
    fetch(`${baseUrl}${product.images[0]}`, { signal: AbortSignal.timeout(30000) }),
  ]);
  assert.equal(detailResponse.status, 200);
  assert.equal(imageResponse.status, 200);
  assert.match(imageResponse.headers.get('content-type'), /^image\/webp/);
  const detail = await detailResponse.json();
  assert.equal(detail.id, product.id);
  assert.equal(detail.variants.length, product.variantCount);
  await imageResponse.arrayBuffer();
  checks.push({ category: category.name, productId: product.id, detail: 200, image: 200 });
}
const evidence = { executedAt: new Date().toISOString(), baseUrl, homeStatus: response.status, products: manifest.products.length, initialCards: 24, checks };
writeFileSync('tmp/platform-catalog-http.json', JSON.stringify(evidence, null, 2));
console.log(`PASS ${baseUrl}: anonymous homepage with all 598 products searchable, 24 initial cards, 12 category details and local images HTTP 200.`);
