import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
const documentStub = { documentElement: {}, body: { dataset: {}, style: { overflow: 'auto' } } };
const windowStub = { matchMedia: () => ({ matches: true }), location: { search: '' } };
function load(file, mocks = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  vm.runInNewContext(code, { exports, require: name => Object.hasOwn(mocks, name) ? mocks[name] : require(name),
    console, URL, URLSearchParams, document: documentStub, window: windowStub,
    fetch: async () => ({ ok: true, json: async () => ({ draft: null }) }) });
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
  '@/lib/supabase/client': { createClient: () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }) },
  './home/BunyaHomeMotion': { BunyaHomeMotion: () => null }, './home/HomeStorefrontUi': ui,
  './home/PlatformProductDialog': { PlatformProductDialog: () => null },
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

// The shared mobile bar preserves routes and the RFQ handler; deep links open even an empty request.
const contractorNav = renderToStaticMarkup(React.createElement(ui.PublicMobileNav, { active: 'contractors' }));
assert.ok(contractorNav.includes('aria-current="page" href="/contractors"'));
for (const href of ['/', '/#products', '/?quote=review']) assert.ok(contractorNav.includes(`href="${href}"`));
state = []; tree = render();
windowStub.location.search = '?quote=review';
effects[3]();
await new Promise(resolve => setImmediate(resolve));
tree = render();
let quoteDrawer = find(tree, n => n.props?.id === 'store-quote-drawer');
assert.equal(quoteDrawer.props['data-empty'], true);
assert.ok(!nodes(quoteDrawer).some(n => n.props?.className === 'sf-rfq-approve'));
find(quoteDrawer, n => n.type === 'a' && n.props.href === '#products').props.onClick();
tree = render(); assert.ok(!nodes(tree).some(n => n.props?.id === 'store-quote-drawer'));
windowStub.location.search = '';
find(tree, n => n.type === ui.ProductCard).props.onOpen(products[0], { style: {} });
tree = render();
find(tree, n => n.type === 'form').props.onSubmit({ preventDefault() {} });
tree = render();
assert.equal(find(tree, n => n.type === ui.PublicMobileNav).props.quoteCount, 1);
find(tree, n => n.type === ui.PublicMobileNav).props.onQuoteOpen();
await new Promise(resolve => setImmediate(resolve));
tree = render(); quoteDrawer = find(tree, n => n.props?.id === 'store-quote-drawer');
assert.equal(quoteDrawer.props['data-empty'], false);
assert.ok(nodes(quoteDrawer).some(n => n.props?.className === 'sf-rfq-approve'));
const quantity = find(quoteDrawer, n => n.type === 'input' && n.props.type === 'number');
quantity.props.onChange({ target: { value: '3' } });
tree = render(); assert.equal(find(tree, n => n.type === 'input' && n.props.type === 'number').props.value, 3);
find(tree, n => n.type === 'button' && buttonText(n) === 'حذف').props.onClick();
tree = render(); assert.equal(find(tree, n => n.props?.id === 'store-quote-drawer').props['data-empty'], true);

// Directory filters still operate on supplied approved records, and share the mobile navigation.
const directoryStyles = new Proxy({}, { get: (_, key) => key });
const { ContractorsDirectory } = load('src/components/ContractorsDirectory.tsx', {
  react: hooks, 'next/link': link, './ContractorsDirectory.module.css': { default: directoryStyles },
  './home/HomeStorefrontUi': ui, './brand/BunyaLogo': { BunyaLogo: () => null },
  '@/lib/auth/public-account': account,
  '@/lib/supabase/client': { createClient() { throw Error('Directory data access not expected in filter tests'); } },
});
const contractorBase = { approvalStatus: 'approved', displayName: 'مقاول', city: 'الرياض', workRegions: ['الرياض'], serviceTypes: ['تشطيبات'], summary: '', badge: '', yearsExperience: 2, averageRating: 4, projectsCount: 3, availability: 'available', workItems: [], phone: '', email: '' };
const contractorRecords = [{ ...contractorBase, id: 'one', commercialName: 'المقاول الأول' }, { ...contractorBase, id: 'two', commercialName: 'المقاول الثاني', city: 'جدة', workRegions: ['جدة'], serviceTypes: ['عظم'] }, { ...contractorBase, id: 'hidden', commercialName: 'غير معتمد', approvalStatus: 'pending' }];
function directory(overrides = {}) { cursor = 0; effects = []; return ContractorsDirectory({ contractors: contractorRecords, ...overrides }); }
function directoryCount(node) { return nodes(node).filter(n => n.type === 'article').length; }
state = []; tree = directory(); assert.equal(directoryCount(tree), 2);
assert.equal(find(tree, n => n.type === ui.PublicMobileNav).props.active, 'contractors');
find(tree, n => n.type === 'input').props.onChange({ target: { value: 'الأول' } });
tree = directory(); assert.equal(directoryCount(tree), 1);
find(tree, n => n.type === 'input').props.onChange({ target: { value: '' } });
tree = directory(); nodes(tree).filter(n => n.type === 'select')[0].props.onChange({ target: { value: 'جدة' } });
tree = directory(); assert.equal(directoryCount(tree), 1);
nodes(tree).filter(n => n.type === 'select')[1].props.onChange({ target: { value: 'تشطيبات' } });
tree = directory(); assert.equal(directoryCount(tree), 0);
find(tree, n => n.type === 'button' && buttonText(n) === 'إعادة الضبط').props.onClick();
tree = directory(); assert.equal(directoryCount(tree), 2);
assert.ok(renderToStaticMarkup(directory({ contractors: [] })).includes('لا يوجد مقاولون متاحون حاليًا'));
tree = directory({ dataError: 'تعذر الاتصال' });
assert.equal(directoryCount(tree), 0); assert.ok(nodes(tree).some(n => n.props?.role === 'alert'));

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
// Imported products add exact selected SKU facts to the shared quote cart.
state = [];
const importedProducts = Array.from({ length: 51 }, (_, index) => ({ ...base, id: `brkz-${index}`, name: `Catalog ${index}`, category: 'الحديد',
  catalogEntry: { subcategory: index < 30 ? 'تسليح' : 'شبك', variantCount: 2, searchText: index === 50 ? 'UniqueBrand' : '', detailsPath: `/catalog/products/${index}.json` } }));
const catalogProps = { products: importedProducts, categories: ['الحديد'] };
tree = render(catalogProps); assert.equal(cardIds(tree).length, 24);
find(tree, n => n.type === 'button' && buttonText(n) === 'عرض المزيد من المنتجات').props.onClick();
tree = render(catalogProps); assert.equal(cardIds(tree).length, 48);
find(tree, n => n.type === 'button' && buttonText(n) === 'عرض المزيد من المنتجات').props.onClick();
tree = render(catalogProps); assert.equal(cardIds(tree).length, 51);
find(tree, n => n.type === 'input' && n.props.type === 'search').props.onChange({ currentTarget: { value: 'UniqueBrand' } });
tree = render(catalogProps); assert.deepEqual(cardIds(tree), ['brkz-50'], 'Search includes variant facts beyond the first page');
find(tree, n => n.props?.['aria-label'] === 'مسح البحث').props.onClick();
tree = render(catalogProps); assert.equal(cardIds(tree).length, 24, 'Filters reset pagination');
const subcategory = find(tree, n => n.props?.className === 'sf-subcategory-filter');
find(subcategory, n => n.type === 'select').props.onChange({ target: { value: 'شبك' } });
tree = render(catalogProps); assert.equal(cardIds(tree).length, 21);
find(tree, n => n.type === ui.ProductCard).props.onOpen(importedProducts[30], {});
tree = render(catalogProps);
assert.ok(nodes(tree).some(n => n.props?.product?.id === 'brkz-30' && typeof n.props?.onClose === 'function'));
const getPlatformDialog = () => find(tree, n => n.props?.product?.id === 'brkz-30' && typeof n.props?.onAddSelection === 'function');
const selection = { sku: 'STEEL-20', quantity: 2, unit: 'كيس', notes: '', attributes: [{ label: 'المقاس', value: '20' }] };
assert.equal(getPlatformDialog().props.onAddSelection(selection), null);
tree = render(catalogProps);
assert.equal(find(tree, n => n.type === ui.PublicMobileNav).props.quoteCount, 1);
assert.equal(getPlatformDialog().props.onAddSelection({ ...selection, quantity: 3 }), null);
tree = render(catalogProps);
assert.equal(find(tree, n => n.type === ui.PublicMobileNav).props.quoteCount, 1, 'Duplicate SKU/unit merges quantities');
assert.ok(getPlatformDialog().props.onAddSelection({ ...selection, quantity: 1000000 }), 'Duplicate total cannot exceed maximum');
tree = render(catalogProps);
assert.equal(getPlatformDialog().props.onAddSelection({ ...selection, sku: 'STEEL-25' }), null);
tree = render(catalogProps);
assert.equal(find(tree, n => n.type === ui.PublicMobileNav).props.quoteCount, 2, 'Different SKU stays a separate cart line');
getPlatformDialog().props.onReviewQuote();
await Promise.resolve(); tree = render(catalogProps);
assert.ok(!nodes(tree).some(n => typeof n.props?.onAddSelection === 'function'), 'Review closes product dialog');
assert.equal(nodes(tree).filter(n => n.props?.className === 'sf-rfq-drawer-item').length, 2);
const quantities = nodes(tree).filter(n => n.type === 'input' && n.props['aria-label'] === 'كمية Catalog 30');
assert.deepEqual(quantities.map(n => n.props.value).sort(), [2, 5]);
assert.ok(quantities.every(n => n.props.min === .001));
assert.ok(renderToStaticMarkup(tree).includes('عرض سعر من إدارة بُنية'));
assert.ok(!renderToStaticMarkup(tree).includes('منافسة أسعار لمدة 3 ساعات'));
console.log('PASS storefront filters, catalog pagination/subcategories/variant search, shared cart SKU merging and quantity limits, admin RFQ copy, directory navigation and translation. No browser or live mutations.');
