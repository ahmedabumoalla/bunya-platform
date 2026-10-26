import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';
import sharp from 'sharp';
import { flattenVariants } from '../scripts/lib/catalog-import.mjs';

const require = createRequire(import.meta.url);
function load(file, mocks = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  vm.runInNewContext(code, { exports, require: name => Object.hasOwn(mocks, name) ? mocks[name] : require(name), console: { warn() {} } });
  return exports;
}
const manifest = JSON.parse(readFileSync('src/data/catalog/imported.json', 'utf8'));
const provenance = JSON.parse(readFileSync('src/data/catalog/provenance.json', 'utf8'));
const { parsePlatformDetails, filterCatalogVariants } = load('src/lib/catalog/platform-details.ts');
const { loadPlatformCatalog } = load('src/lib/catalog/platform.ts', { 'server-only': {}, '@/data/catalog/imported.json': manifest });
const platform = loadPlatformCatalog();
assert.equal(platform.products.length, 598);
assert.equal(platform.categories.length, 12);
assert.equal(manifest.categories.reduce((sum, category) => sum + category.subcategories.length, 0), 52);
assert.equal(provenance.records.length, 598);
assert.equal(new Set(platform.products.map(product => product.id)).size, 598);
const imagePaths = new Set();
let variants = 0, withoutAttributes = 0;
for (const product of platform.products) {
  assert.ok(product.catalogEntry);
  assert.equal(product.stockQuantity, null);
  assert.equal(product.deliveryDetails.available, false);
  assert.ok(!Object.hasOwn(product, 'providerId'));
  const category = manifest.categories.find(category => category.name === product.category);
  assert.ok(category.subcategories.some(subcategory => subcategory.name === product.catalogEntry.subcategory));
  const bytes = readFileSync(`public${product.catalogEntry.detailsPath}`);
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 24);
  assert.ok(product.catalogEntry.detailsPath.endsWith(`.${hash}.json`));
  const detail = parsePlatformDetails(JSON.parse(bytes), product.id);
  assert.equal(detail.variants.length, product.catalogEntry.variantCount);
  assert.equal(new Set(detail.variants.map(variant => variant.sku)).size, detail.variants.length);
  assert.ok(detail.images.length > 0);
  detail.images.forEach(image => imagePaths.add(image));
  variants += detail.variants.length;
  withoutAttributes += detail.variants.filter(variant => !variant.attributes.length).length;
  const first = detail.variants.find(variant => variant.attributes.length);
  if (first) {
    const filters = Object.fromEntries(first.attributes.map(attribute => [attribute.label, attribute.value]));
    assert.ok(filterCatalogVariants(detail.variants, first.sku, filters).some(variant => variant.sku === first.sku));
    assert.equal(filterCatalogVariants(detail.variants, 'NO-SUCH-SKU-xxxxx', filters).length, 0);
  }
}
assert.equal(variants, 6946);
assert.equal(withoutAttributes, 44);
assert.equal(imagePaths.size, 566);
for (const image of imagePaths) {
  assert.ok(statSync(`public${image}`).size > 0);
  const metadata = await sharp(`public${image}`).metadata();
  assert.equal(metadata.format, 'webp');
  assert.ok(metadata.width > 0 && metadata.height > 0);
}
const example = { id: 'example', variations: [{ sku: 'a-10' }, { sku: 'b-20' }, { sku: 'unknown' }], attributes: [{ name: 'brand', values: [
  { value: 'A', attributes: [{ name: 'size', values: [{ value: '10mm', sku: 'a-10' }] }] },
  { value: 'B', attributes: [{ name: 'size', values: [{ value: '20mm', sku: 'b-20' }] }] },
] }] };
const mapped = flattenVariants(example);
assert.deepEqual(mapped[0].attributes, [{ label: 'brand', value: 'A' }, { label: 'size', value: '10mm' }]);
assert.equal(filterCatalogVariants(mapped, '', { brand: 'A', size: '20mm' }).length, 0, 'Do not invent unavailable combinations');
assert.deepEqual(mapped[2].attributes, [], 'Unknown SKU facts stay unknown');
assert.throws(() => flattenVariants({ ...example, variations: [{ sku: 'a-10' }, { sku: 'a-10' }] }));
assert.throws(() => parsePlatformDetails({ id: 'unexpected' }, 'expected'));

// Homepage keeps the full independent catalog when the supplier database is unavailable.
const homeMocks = {
  '@/components/HomeStorefront': { HomeStorefront: () => null },
  '@/components/legal/LegalPage': { PublicLegalFooter: () => null },
  '@/lib/auth/server': { getAuthIdentity: async () => null },
  '@/lib/auth/public-account': { publicAccountFor: () => ({ signedIn: false, href: '/login' }) },
  '@/lib/catalog/platform': { loadPlatformCatalog },
};
const { default: Home } = load('src/app/page.tsx', { ...homeMocks, '@/lib/catalog/server': { loadPublicCatalog: async () => { throw Error('offline'); } } });
const tree = await Home();
assert.equal(tree.props.children[0].props.products.length, 598);
assert.equal(tree.props.children[0].props.account.signedIn, false);
const { default: WithSupplier } = load('src/app/page.tsx', { ...homeMocks, '@/lib/catalog/server': { loadPublicCatalog: async () => ({ products: [{ id: 'supplier-product' }], categories: ['existing'] }) } });
assert.equal((await WithSupplier()).props.children[0].props.products.length, 599, 'Keep existing supplier products');
console.log('PASS 598 anonymous platform products, 12 categories/52 subcategories, 6946 real SKU paths, 44 explicit unknowns, 566 decodable local images, filters, provenance hashes, independent fallback and supplier preservation.');
