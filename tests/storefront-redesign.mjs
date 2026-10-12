import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
const documentStub = { documentElement: {}, body: { dataset: {}, style: { overflow: 'auto' } } };
function load(file, mocks = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  vm.runInNewContext(code, { exports, require: name => Object.hasOwn(mocks, name) ? mocks[name] : require(name),
    console, URL, document: documentStub, window: { matchMedia: () => ({ matches: true }) } });
  return exports;
}
let state = [], cursor = 0, effects = [], refreshes = 0;
const hooks = { ...React,
  useState(initial) { const i = cursor++; if (!(i in state)) state[i] = typeof initial === 'function' ? initial() : initial;
    return [state[i], value => { state[i] = typeof value === 'function' ? value(state[i]) : value; }]; },
  useRef: () => ({ current: null }), useMemo: fn => fn(), useCallback: fn => fn, useEffect: fn => effects.push(fn),
};
const link = { default: ({ children, ...props }) => React.createElement('a', props, children) };
const account = load('src/lib/auth/public-account.ts', { './types': load('src/lib/auth/types.ts') });
const ui = load('src/components/home/HomeStorefrontUi.tsx', {
  'next/link': link, '@/lib/auth/public-account': account,
  '@/lib/products/image-urls': { isProductVideo: () => false },
  '@/components/brand/BunyaLogo': { BunyaLogo: () => React.createElement('span', null, 'بُنية') },
  './PublicAccountLink': { PublicAccountLink: () => null },
});
const { HomeStorefront } = load('src/components/HomeStorefront.tsx', {
  react: hooks, 'next/link': link, 'next/navigation': { useRouter: () => ({ refresh() { refreshes++; } }) },
  '@/lib/quotes/pending-draft': load('src/lib/quotes/pending-draft.ts'),
  '@/lib/supabase/client': { createClient() { throw Error('No live data calls allowed in this test'); } },
  './home/BunyaHomeMotion': { BunyaHomeMotion: () => null }, './home/HomeStorefrontUi': ui,
});
const base = { sku: 'sku', unit: 'كيس', units: ['كيس'], description: 'مواد بناء', shortDescription: '',
  fullDescription: '', availability: 'متوفر', availabilityStatus: 'متوفر', leadTime: '',
  specs: [], measurements: [], variants: [], images: [], minimumOrder: 1,
  delivery: { label: 'توصيل', window: 'يومان', notes: '' },
  deliveryDetails: { available: true, regions: ['الرياض'], notes: '', maximumDuration: null, maximumDistanceKm: null, pricePerKm: null },
  regions: [{ city: 'الرياض', scope: '' }], warranty: { label: '', duration: '', details: '' },
  deliveryNotes: '', offerType: 'بيع', stockQuantity: 20, rentalDuration: null };
const products = [
  { ...base, id: 'cement', name: 'أسمنت', category: 'الأسمنت', isNew: true },
  { ...base, id: 'steel', name: 'حديد', category: 'الحديد', availabilityStatus: 'حسب الطلب',
    deliveryDetails: { ...base.deliveryDetails, available: false } },
];
const props = { products, categories: ['الأسمنت', 'الحديد'] };
function render(overrides = {}) { cursor = 0; effects = []; return HomeStorefront({ ...props, ...overrides }); }
function nodes(node) { if (!node || typeof node !== 'object') return []; if (Array.isArray(node)) return node.flatMap(nodes);
  return [node, ...nodes(node.props?.children)]; }
function find(tree, predicate) { const found = nodes(tree).find(predicate); assert.ok(found, 'Expected control exists'); return found; }
function cardIds(tree) { return nodes(tree).filter(n => n.type === ui.ProductCard).map(n => n.props.product.id); }
function buttonText(node) { return renderToStaticMarkup(node).replace(/<[^>]+>/g, ''); }
let tree = render();
assert.deepEqual(cardIds(tree), ['cement', 'steel']);
assert.equal(nodes(tree).filter(n => n.type === 'h1').length, 1);
const homeHtml = renderToStaticMarkup(tree);
assert.ok(homeHtml.indexOf('class="sf-quick-links"') < homeHtml.indexOf('class="sf-marketplace-search"'));
for (const href of ['/providers/join', '/contractors/join']) assert.ok(homeHtml.includes(`href="${href}"`), 'Guest join links remain in page navigation');
assert.ok(!nodes(tree).some(n => n.props?.['aria-label'] === 'منطقة التوفر'));
const searchBar = find(tree, n => n.props?.className === 'sf-discovery-bar');
assert.ok(nodes(searchBar).some(n => n.props?.['aria-label'] === 'طريقة العرض'));
find(searchBar, n => n.props?.['aria-label'] === 'عرض قائمة').props.onClick();
tree = render(); assert.ok(nodes(tree).some(n => n.props?.className === 'sf-product-grid sf-product-results-list'));
find(tree, n => n.type === 'input' && n.props.type === 'search').props.onChange({ currentTarget: { value: 'حديد' } });
tree = render(); assert.deepEqual(cardIds(tree), ['steel']);
find(tree, n => n.props?.['aria-label'] === 'مسح البحث').props.onClick();
tree = render(); assert.deepEqual(cardIds(tree), ['cement', 'steel']);
const categories = find(tree, n => n.props?.['aria-label'] === 'تصنيفات مواد البناء');
find(categories, n => n.type === 'button' && buttonText(n).includes('الأسمنت')).props.onClick();
tree = render(); assert.deepEqual(cardIds(tree), ['cement']);
find(tree, n => n.props?.['aria-controls'] === 'sf-catalog-filters').props.onClick();
tree = render();
assert.equal(find(tree, n => n.props?.['aria-controls'] === 'sf-catalog-filters').props['aria-expanded'], true);
const filterDialog = find(tree, n => n.type === 'dialog');
assert.ok(!nodes(filterDialog).some(n => n.props?.['aria-label'] === 'طريقة العرض'));
assert.equal(filterDialog.props['aria-labelledby'], 'sf-filter-title');
let modalOpened = 0, modalClosed = 0, focusRestored = 0;
filterDialog.props.ref.current = { showModal() { modalOpened++; }, close() { modalClosed++; } };
find(tree, n => n.props?.['aria-controls'] === 'sf-catalog-filters').props.ref.current = { focus() { focusRestored++; } };
const releaseModal = effects[0]();
assert.equal(modalOpened, 1); assert.equal(documentStub.body.style.overflow, 'hidden');
find(tree, n => n.type === 'select' && n.props['aria-label'] === 'منطقة التوفر').props.onChange({ currentTarget: { value: 'جازان' } });
tree = render(); assert.deepEqual(cardIds(tree), []);
find(tree, n => n.type === 'button' && buttonText(n) === 'إعادة الضبط').props.onClick();
tree = render(); assert.deepEqual(cardIds(tree), ['cement', 'steel']);
find(tree, n => n.type === 'button' && buttonText(n) === 'متوفر').props.onClick();
tree = render(); assert.deepEqual(cardIds(tree), ['cement']);
find(tree, n => n.type === 'button' && buttonText(n) === 'متوفر').props.onClick();
tree = render();
find(tree, n => n.type === 'button' && buttonText(n) === 'الأحدث').props.onClick();
tree = render(); assert.deepEqual(cardIds(tree), ['cement']);
find(tree, n => n.type === 'button' && buttonText(n) === 'إعادة الضبط').props.onClick();
tree = render();
find(tree, n => n.props?.['aria-label'] === 'يوصل للموقع').props.onClick();
tree = render(); assert.deepEqual(cardIds(tree), ['cement']);
tree = render(); assert.ok(nodes(tree).some(n => n.props?.className === 'sf-product-grid sf-product-results-list'));
const applyFilters = find(tree, n => n.props?.className === 'sf-filter-apply');
assert.ok(buttonText(applyFilters).includes('١'), 'Result count reflects the selected filters');
applyFilters.props.onClick();
releaseModal();
assert.equal(modalClosed, 1); assert.equal(documentStub.body.style.overflow, 'auto'); assert.equal(focusRestored, 1);
tree = render();
assert.ok(!nodes(tree).some(n => n.props?.id === 'sf-catalog-filters'));
assert.deepEqual(cardIds(tree), ['cement'], 'Closing filters preserves the selected delivery filter');
assert.ok(nodes(tree).some(n => n.props?.className === 'sf-product-grid sf-product-results-list'));
// Native Escape cancellation, close button and backdrop close without discarding filters.
for (const method of ['cancel', 'close', 'backdrop']) {
  find(tree, n => n.props?.['aria-controls'] === 'sf-catalog-filters').props.onClick();
  tree = render();
  const dialog = find(tree, n => n.type === 'dialog');
  if (method === 'cancel') {
    let prevented = false;
    dialog.props.onCancel({ preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
  } else if (method === 'close') find(tree, n => n.props?.['aria-label'] === 'إغلاق التصفية').props.onClick();
  else {
    const backdrop = {};
    dialog.props.onClick({ target: {}, currentTarget: backdrop });
    tree = render(); assert.ok(nodes(tree).some(n => n.type === 'dialog'), 'Content clicks do not dismiss');
    dialog.props.onClick({ target: backdrop, currentTarget: backdrop });
  }
  tree = render(); assert.ok(!nodes(tree).some(n => n.type === 'dialog')); assert.deepEqual(cardIds(tree), ['cement']);
}
find(tree, n => n.type === ui.ProductCard).props.onOpen(products[0], { style: {} });
tree = render(); assert.ok(nodes(tree).some(n => n.props?.role === 'dialog'));
state = []; tree = render({ products: [] });
assert.ok(renderToStaticMarkup(tree).includes('نجهّز لك مواد مشروعك'));
assert.equal(find(tree, n => n.type === ui.StoreHeader).props.hasLatestProducts, false);
tree = render({ dataError: 'انقطع الاتصال' });
find(tree, n => n.type === 'button' && buttonText(n) === 'إعادة المحاولة').props.onClick();
assert.equal(refreshes, 1);
const closedHeader = renderToStaticMarkup(React.createElement(ui.StoreHeader, { quoteCount: 0, hasLatestProducts: false }));
assert.ok(!closedHeader.includes('sf-mobile-menu'));
assert.ok(!closedHeader.includes('href="#latest"'));

// A saved foreign locale must not mount translation observers or read/update profile preferences.
state = []; cursor = 0; effects = [];
const config = load('src/lib/i18n/config.ts');
let dataCalls = 0;
const { LocaleProvider } = load('src/components/i18n/LocaleProvider.tsx', {
  react: hooks, '@/lib/i18n/config': config,
  '@/lib/i18n/messages': { translate: (locale, key) => `${locale}:${key}`, translateStatus: (_, value) => value },
  '@/lib/supabase/client': { createClient() { dataCalls++; throw Error('Language preferences should remain paused'); } },
});
const context = LocaleProvider({ initialLocale: 'en', children: null }).props.value;
for (const effect of effects) effect();
await context.setLocale('en');
assert.equal(context.locale, 'ar'); assert.equal(context.direction, 'rtl'); assert.equal(dataCalls, 0);
assert.equal(documentStub.documentElement.lang, 'ar');
// A saved English cookie must also keep server-loaded product content Arabic.
const queriedLocales = [];
const catalogClient = { from(table) {
  let requestedLocale;
  const query = {
    select() { return query; }, order() { return query; }, in() { return query; }, not() { return query; },
    eq(column, value) { if (column === 'locale') { requestedLocale = value; queriedLocales.push(value); } return query; },
    then(resolve) {
      const data = table === 'products' ? [{ id: 'catalog-product', name: 'منتج مسجل', category_id: 'category',
        base_unit: 'كيس', availability_status: 'available', delivery_label: '', delivery_window: '',
        delivery_notes: '', offer_type: 'sale' }]
        : table === 'product_categories' ? [{ id: 'category', name: 'مواد البناء' }]
        : table === 'product_translations' && requestedLocale === 'en' ? [{ product_id: 'catalog-product', name: 'English product' }]
        : [];
      return Promise.resolve({ data, error: null }).then(resolve);
    },
  };
  return query;
} };
const { loadPublicCatalog } = load('src/lib/catalog/server.ts', {
  'server-only': {}, '@/lib/i18n/config': config,
  'next/headers': { cookies: async () => ({ get: () => ({ value: 'en' }) }) },
  '@/lib/supabase/server': { createClient: async () => catalogClient },
  '@/lib/supabase/admin': { createAdminClient() { throw Error('No image signing needed'); } },
  '@/lib/products/image-urls': { isProductVideo: () => false },
});
const catalog = await loadPublicCatalog();
assert.equal(catalog.products[0].name, 'منتج مسجل');
assert.equal(queriedLocales.length, 4);
assert.ok(queriedLocales.every(locale => locale === 'ar'));
console.log('PASS storefront search, category/region/delivery filtering, reset, list view, product details, empty/error states, menu semantics and paused translation with saved English preference. No browser or live mutations.');
