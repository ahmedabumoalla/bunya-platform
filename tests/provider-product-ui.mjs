import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
function load(file, mocks = {}, globals = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { exports, require: name => Object.hasOwn(mocks, name) ? mocks[name] : require(name), URL, URLSearchParams, console, ...globals });
  return exports;
}
const media = load('src/lib/products/image-urls.ts');
const mocks = {
  'next/link': { default: ({ children, ...props }) => React.createElement('a', props, children) },
  'next/image': { default: () => null },
  'next/navigation': { useRouter: () => ({}), useSearchParams: () => new URLSearchParams() },
  '@/components/auth/AuthIdentityProvider': { useAuthIdentity: () => ({ details: { provider: { providerId: 'owner' } } }) },
  '@/lib/products/image-urls': media,
  '@/lib/supabase/client': { createClient: () => { throw Error('Unexpected database call'); } },
  '@/lib/uploads/product-media-client': {},
  '@/lib/body-scroll-lock': {},
  '@/components/admin/useDialogFocus': { useDialogFocus: () => null },
  './ProviderProducts.module.css': { default: new Proxy({}, { get: (_, key) => key }) },
};
const path = 'src/components/provider/ProviderProducts.tsx';
const ui = load(path, mocks);
for (const flag of ['created', 'change_requested', 'resubmitted']) {
  const feedback = ui.productFeedbackFromQuery(`filter=available&${flag}=1&tag=a&tag=b`);
  assert.ok(feedback.message);
  assert.equal(feedback.query, 'filter=available&tag=a&tag=b');
  assert.equal(ui.productFeedbackFromQuery(feedback.query).message, '');
}
const decisions = [
  { outcome: 'needs_changes', reason: 'Old reason', reviewed_at: '2026-10-01T09:00:00Z' },
  { outcome: 'needs_changes', reason: 'Correct the dimensions', reviewed_at: '2026-10-02T10:00:00Z' },
];
assert.equal(ui.latestProductReviewDecision(decisions), decisions[1]);
assert.equal(decisions[0].reason, 'Old reason');
const product = { id: 'product-id', review_status: 'needs_changes', product_review_decisions: decisions };
const notice = renderToStaticMarkup(React.createElement(ui.ProductReviewNotice, { product }));
assert.match(notice, /Correct the dimensions/);
assert.doesNotMatch(notice, /Old reason/);
assert.match(notice, /href="\/merchant\/products\/product-id\/change-request"/);
assert.equal(renderToStaticMarkup(React.createElement(ui.ProductReviewNotice, { product: { ...product, review_status: 'approved' } })), '');
assert.doesNotMatch(renderToStaticMarkup(React.createElement(ui.ProductReviewNotice, { product, showAction: false })), /<a /);
const photo = { name: 'photo.jpg', type: 'image/jpeg', size: 5 * 1024 ** 2, lastModified: 1 };
const video = { name: 'video.mov', type: 'video/quicktime', size: 100 * 1024 ** 2, lastModified: 2 };
assert.equal(ui.invalidProductMediaFile([photo, video]), undefined);
for (const file of [{ ...photo, size: photo.size + 1 }, { ...video, size: video.size + 1 }, { ...photo, size: 0 }, { ...photo, type: 'application/pdf' }]) assert.equal(ui.invalidProductMediaFile([file]), file);
console.log('PASS feedback URL consumption, latest review reason/CTA SSR, image/video size boundaries');

// Small hook harness executes real component event handlers without a browser.
function harness(componentName, query = '', fixture = null) {
  const values = [], effects = [];
  let cursor = 0, tree, timer, cleared = false, replaced;
  const hooks = {
    ...React,
    useState(initial) { const index = cursor++; if (!(index in values)) values[index] = typeof initial === 'function' ? initial() : initial; return [values[index], next => { values[index] = typeof next === 'function' ? next(values[index]) : next; }]; },
    useRef(initial) { const index = cursor++; if (!(index in values)) values[index] = { current: initial }; return values[index]; },
    useMemo: fn => fn(), useEffect: fn => effects.push(fn),
  };
  let objectIndex = 0;
  const fixtureMocks = fixture ? {
    './ProviderProducts': ui,
    '@/lib/products/image-urls': { ...media, signProductImageMap: async () => new Map() },
    '@/lib/supabase/client': { createClient: () => ({ from(table) { return { select() { return this; }, eq() { return this; }, order() { return this; }, maybeSingle() { return this; }, then(resolve) { return Promise.resolve({ data: table === 'products' ? fixture : table === 'product_categories' ? [] : null, error: null }).then(resolve); } }; } }) },
  } : {};
  const component = load(fixture ? 'src/components/provider/ProviderProductChangeRequest.tsx' : path, { ...mocks, ...fixtureMocks, react: hooks, 'next/navigation': { useRouter: () => ({ replace: (url, options) => { replaced = { url, options }; } }), useSearchParams: () => new URLSearchParams(query) } }, {
    URL: { createObjectURL: () => `blob:${objectIndex++}`, revokeObjectURL: () => {} },
    window: { location: { hash: '#catalog' }, setTimeout(fn, delay) { assert.equal(delay, 5000); timer = fn; return 123; }, clearTimeout(id) { assert.equal(id, 123); cleared = true; } },
  })[componentName];
  function render() { cursor = 0; effects.length = 0; tree = component({ productId: 'product-id' }); return tree; }
  function nodes(predicate, node = tree) { if (!node || typeof node !== 'object') return []; if (Array.isArray(node)) return node.flatMap(child => nodes(predicate, child ?? null)); return [...(predicate(node) ? [node] : []), ...nodes(predicate, node.props?.children ?? null)]; }
  render();
  return { render, nodes, effects, get replaced() { return replaced; }, fireTimer: () => timer(), get cleared() { return cleared; } };
}
const list = harness('ProviderProductsList', 'created=1&filter=available');
list.effects[0]();
const cleanup = list.effects[1]();
assert.equal(list.replaced.url, '/merchant/products?filter=available#catalog');
assert.equal(list.replaced.options.scroll, false);
assert.equal(list.nodes(node => node.props?.['aria-label'] === 'إغلاق رسالة النجاح').length, 1);
list.fireTimer(); list.render();
assert.equal(list.nodes(node => node.props?.['aria-label'] === 'إغلاق رسالة النجاح').length, 0);
cleanup(); assert.equal(list.cleared, true);
const dismiss = harness('ProviderProductsList', 'resubmitted=1');
dismiss.nodes(node => node.props?.['aria-label'] === 'إغلاق رسالة النجاح')[0].props.onClick(); dismiss.render();
assert.equal(dismiss.nodes(node => node.props?.['aria-label'] === 'إغلاق رسالة النجاح').length, 0);

const create = harness('ProviderProductCreate');
const select = files => { create.nodes(node => node.props?.type === 'file')[0].props.onChange({ target: { files, value: '' } }); create.render(); };
select([video, photo, { ...photo, name: 'second.jpg', lastModified: 3 }]);
const primaryButtons = () => create.nodes(node => node.props?.['aria-pressed'] !== undefined);
assert.equal(primaryButtons().length, 2, 'Only images can be primary');
assert.equal(primaryButtons()[0].props['aria-pressed'], true, 'First image is cover even if video was added first');
assert.equal(create.nodes(node => node.type === 'video' && node.props.controls && node.props.playsInline).length, 1);
primaryButtons()[1].props.onClick(); create.render();
assert.equal(primaryButtons()[1].props['aria-pressed'], true);
create.nodes(node => node.type === 'article')[2].props.children.at(-1).props.children[1].props.onClick(); create.render();
assert.equal(primaryButtons()[0].props['aria-pressed'], true, 'Removing selected cover falls back to remaining image');
select(Array.from({ length: 5 }, (_, index) => ({ ...photo, name: `extra-${index}.jpg` })));
assert.equal(create.nodes(node => node.type === 'article').length, 2, 'Seventh media file is rejected');
console.log('PASS timer/manual dismissal and cleanup, query/hash preservation, video controls, image-only main selection/removal fallback, six-file cap');

const edit = harness('ProviderProductChangeRequest', '', {
  ...product, provider_id: 'owner', name: 'Test product', product_measurements: [], product_variants: [], product_specifications: [],
  product_images: [
    { id: 'retained-video', mime_type: 'video/mp4', image_url: 'https://test.invalid/video.mp4', sort_order: 0 },
    { id: 'retained-cover', mime_type: 'image/jpeg', image_url: 'https://test.invalid/cover.jpg', is_primary: true, sort_order: 1 },
  ],
});
edit.effects[0]();
await new Promise(resolve => setImmediate(resolve));
edit.render();
assert.equal(edit.nodes(node => node.props?.['aria-pressed'] === true).length, 1);
assert.equal(edit.nodes(node => node.type === 'video' && node.props.controls).length, 1);
edit.nodes(node => node.props?.type === 'file')[0].props.onChange({ target: { files: [photo, video], value: '' } }); edit.render();
const newCover = edit.nodes(node => node.props?.['aria-pressed'] === false)[0];
newCover.props.onClick(); edit.render();
assert.equal(edit.nodes(node => node.props?.['aria-pressed'] === true).length, 1);
const selectedArticle = edit.nodes(node => node.type === 'article').find(node => React.Children.toArray(node.props.children).some(child => child.props?.['aria-pressed'] === true));
React.Children.toArray(selectedArticle.props.children).at(-1).props.onClick(); edit.render();
assert.equal(edit.nodes(node => node.props?.['aria-pressed'] === true).length, 1, 'Removed new cover falls back to retained image');
assert.equal(edit.nodes(node => node.props?.['aria-pressed'] !== undefined).length, 1, 'Retained/new videos cannot become covers');
const submitLabel = edit.nodes(node => node.props?.type === 'submit')[0].props.children;
assert.match(submitLabel, /إعادة الإرسال/);
const css = require('postcss').parse(readFileSync('src/components/provider/ProviderProducts.module.css', 'utf8'));
assert.ok(css.nodes.length);
console.log('PASS correction editor loading/CTA, retained/new video previews and image cover fallback; CSS parsed');
