import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { webcrypto } from 'node:crypto';
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
function harness(componentName, query = '', fixture = null, options = {}) {
  const values = [], effects = [];
  let cursor = 0, tree, timer, cleared = false, replaced, pushed, submitted;
  const hooks = {
    ...React,
    useState(initial) { const index = cursor++; if (!(index in values)) values[index] = typeof initial === 'function' ? initial() : initial; return [values[index], next => { values[index] = typeof next === 'function' ? next(values[index]) : next; }]; },
    useRef(initial) { const index = cursor++; if (!(index in values)) values[index] = { current: initial }; return values[index]; },
    useMemo: fn => fn(), useEffect: fn => effects.push(fn),
  };
  let objectIndex = 0, selectedColumns = '', signedSources = [];
  const fixtureMocks = fixture ? {
    './ProviderProducts': ui,
    '@/lib/products/image-urls': { ...media, signProductImageMap: async (_, sources) => { signedSources = sources; return new Map(sources.filter(item => item.storage_path).map(item => [item.storage_path, `https://storage.invalid/signed/${item.id}`])); } },
    '@/lib/uploads/product-media-client': { uploadProductMedia: async()=>{}, discardProductMedia: async()=>{} },
    '@/lib/supabase/client': { createClient: () => ({ from(table) { return { select(columns) { if(table === 'products')selectedColumns = columns; return this; }, eq() { return this; }, order() { return this; }, maybeSingle() { return this; }, then(resolve,reject) { return (options.transportError ? Promise.reject(Error('offline')) : Promise.resolve({ data: table === 'products' ? fixture : table === 'product_categories' ? [] : null, error: options.pendingError && table === 'product_change_requests' ? {message:'denied'} : null })).then(resolve,reject); } }; } }) },
  } : {};
  const component = load(componentName === 'ProviderProductChangeRequest' ? 'src/components/provider/ProviderProductChangeRequest.tsx' : path, { ...mocks, ...fixtureMocks, react: hooks, 'next/navigation': { useRouter: () => ({ push:url=>{pushed=url;},refresh(){}, replace: (url, options) => { replaced = { url, options }; } }), useSearchParams: () => new URLSearchParams(query) } }, {
    crypto:webcrypto,
    FormData:class extends FormData { constructor(fields) {super();for(const [key,value] of Object.entries(fields||{}))this.set(key,value);} },
    fetch:async(url,init)=>{submitted={url,...init};return Response.json({reviewStatus:'pending_review'});},
    URL: { createObjectURL: () => `blob:${objectIndex++}`, revokeObjectURL: () => {} },
    window: { location: { hash: '#catalog' }, setTimeout(fn, delay) { assert.equal(delay, 5000); timer = fn; return 123; }, clearTimeout(id) { assert.equal(id, 123); cleared = true; } },
  })[componentName];
  function render() { cursor = 0; effects.length = 0; tree = component({ productId: 'product-id' }); return tree; }
  function nodes(predicate, node = tree) { if (!node || typeof node !== 'object') return []; if (Array.isArray(node)) return node.flatMap(child => nodes(predicate, child ?? null)); return [...(predicate(node) ? [node] : []), ...nodes(predicate, node.props?.children ?? null)]; }
  render();
  return { render, nodes, effects, get submitted(){return submitted;},get pushed(){return pushed;},get selectedColumns() { return selectedColumns; }, get signedSources() { return signedSources; }, get replaced() { return replaced; }, fireTimer: () => timer(), get cleared() { return cleared; } };
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

const gallery = [
  {id:'video',mime_type:'video/mp4',storage_path:'owner/product/video.mp4',is_primary:true,sort_order:0},
  {id:'secondary',mime_type:'image/jpeg',storage_path:'owner/product/second.jpg',is_primary:false,sort_order:0},
  {id:'chosen',mime_type:'image/jpeg',storage_path:'owner/product/cover.jpg',alt_text:'Selected product cover',is_primary:true,sort_order:4},
];
const baseProduct = {...product,name:'Product',base_unit:'piece',stock_quantity:null,updated_at:'2026-10-02T00:00:00Z'};
const cards = harness('ProviderProductsList','',[
  {...baseProduct,product_images:gallery},
  {...baseProduct,id:'external',product_images:[{id:'external-cover',image_url:'https://images.invalid/existing.jpg',sort_order:0}]},
  {...baseProduct,id:'empty',product_images:[]},
  {...baseProduct,id:'only-video',product_images:[gallery[0]]},
]);
cards.effects[2](); await new Promise(resolve=>setImmediate(resolve)); cards.render();
assert.match(cards.selectedColumns,/product_images\(.*is_primary,sort_order\)/);
assert.deepEqual(Array.from(cards.signedSources,item=>item.id),['chosen','external-cover']);
const cardImages = cards.nodes(node=>node.type === mocks['next/image'].default);
assert.deepEqual(cardImages.map(node=>node.props.src),['https://storage.invalid/signed/chosen','https://images.invalid/existing.jpg']);
assert.equal(cardImages[0].props.alt,'Selected product cover');
assert.equal(cards.nodes(node=>node.type === 'article').length,4);
assert.equal(ui.providerProductCover(gallery).id,'chosen');
assert.equal(ui.providerProductCover(gallery.slice(0,2)).id,'secondary');
assert.equal(ui.providerProductCover([gallery[0]]),null);
assert.equal(gallery[0].id,'video','Cover selection must not reorder saved gallery');
console.log('PASS actual product list loads media, signs only image covers and renders selected/private and legacy/external photos; missing media and videos keep fallback');

const correctionFixture={...baseProduct,provider_id:'owner',product_measurements:[],product_variants:[],product_specifications:[],product_images:[gallery[2]],lead_time_label:'Two days',delivery_window:'Morning',delivery_notes:'Original delivery note'};
const submitEditor=harness('ProviderProductChangeRequest','',correctionFixture);
submitEditor.effects[0]();await new Promise(resolve=>setImmediate(resolve));submitEditor.render();
const fields=Object.fromEntries(submitEditor.nodes(node=>node.props?.name && ['input','textarea','select'].includes(node.type)).map(node=>[node.props.name,node.props.value??node.props.defaultValue??'']));
assert.equal(fields.delivery_notes,'Original delivery note');
fields.delivery_notes='Supplier is responsible for delivery';
await submitEditor.nodes(node=>node.type==='form')[0].props.onSubmit({preventDefault(){},currentTarget:fields});
assert.equal(submitEditor.submitted.url,'/api/provider/products/product-id/change-requests');
assert.equal(submitEditor.submitted.method,'POST');
assert.equal(submitEditor.submitted.body.get('delivery_notes'),fields.delivery_notes);
assert.equal(submitEditor.submitted.body.get('primary_image'),'chosen');
assert.deepEqual(JSON.parse(submitEditor.submitted.body.get('retained_image_ids')),['chosen']);
assert.equal(submitEditor.pushed,'/merchant/products?resubmitted=1');
for(const options of [{transportError:true},{pendingError:true}]){
 const failed=harness('ProviderProductChangeRequest','',correctionFixture,options);
 failed.effects[0]();await new Promise(resolve=>setImmediate(resolve));failed.render();
 assert.equal(failed.nodes(node=>node.props?.role==='alert').length,1);
 assert.equal(failed.nodes(node=>node.type==='form').length,0);
 const retry=failed.nodes(node=>node.type==='button'&&node.props.children==='إعادة المحاولة')[0];assert.ok(retry);retry.props.onClick();failed.render();
 assert.equal(failed.nodes(node=>node.props?.role==='alert').length,0);
}
console.log('PASS loaded correction form submits edited delivery note and retained cover, redirects after saving, and recovers from transport/pending-query errors');
