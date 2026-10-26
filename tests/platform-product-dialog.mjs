import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';

const require = createRequire(import.meta.url);
let state = [], cursor = 0, effects = [], responseMode = 'success', openCount = 0, closeCount = 0, focusCount = 0, dismissed = 0;
let addedSelection, addError = null, reviews = 0;
const dialogRef = { current: { showModal() { openCount++; }, close() { closeCount++; } } };
const documentStub = { activeElement: { focus() { focusCount++; } }, body: { style: { overflow: 'auto' } } };
const hooks = { ...React,
  useState(initial) { const index = cursor++; if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial;
    return [state[index], value => { state[index] = typeof value === 'function' ? value(state[index]) : value; }]; },
  useRef: () => dialogRef, useMemo: fn => fn(), useEffect: fn => effects.push(fn),
};
const manifest = JSON.parse(readFileSync('src/data/catalog/imported.json', 'utf8'));
const entry = manifest.products[0];
const detail = JSON.parse(readFileSync(`public${entry.detailsPath}`, 'utf8'));
const product = { ...entry, catalogEntry: entry, images: entry.images.map((url, index) => ({ id: `${index}`, url, tone: 'cement', alt: entry.name })) };
let renderedProduct = product, responseDetail = detail;
function load(file, mocks = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { exports, require: name => Object.hasOwn(mocks, name) ? mocks[name] : require(name), document: documentStub, AbortController,
    fetch: async url => { assert.equal(url, renderedProduct.catalogEntry.detailsPath); return { ok: responseMode === 'success', json: async () => responseDetail }; } });
  return exports;
}
const { PlatformProductDialog } = load('src/components/home/PlatformProductDialog.tsx', {
  react: hooks, '@/lib/catalog/platform-details': load('src/lib/catalog/platform-details.ts'),
  './HomeStorefrontUi': { Icon: () => null, ProductArtwork: () => null },
});
function render() { cursor = 0; effects = []; return PlatformProductDialog({ product: renderedProduct, onClose() { dismissed++; }, onAddSelection(selection) { addedSelection = selection; return addError; }, onReviewQuote() { reviews++; } }); }
function nodes(node) { if (!node || typeof node !== 'object') return []; if (Array.isArray(node)) return node.flatMap(nodes); return [node, ...nodes(node.props?.children)]; }
function find(tree, predicate) { const node = nodes(tree).find(predicate); assert.ok(node); return node; }
const flush = () => new Promise(resolve => setImmediate(resolve));
let tree = render();
assert.ok(nodes(tree).some(node => node.props?.role === 'status'));
const restore = effects[0]();
const cancelFetch = effects[1]();
assert.equal(openCount, 1); assert.equal(documentStub.body.style.overflow, 'hidden');
await flush(); tree = render();
assert.equal(nodes(tree).filter(node => node.type === 'article').length, 30);
find(tree, node => node.props?.className === 'sf-catalog-more').props.onClick();
tree = render(); assert.equal(nodes(tree).filter(node => node.type === 'article').length, 60);
find(tree, node => node.type === 'input' && node.props.type === 'search').props.onChange({ target: { value: detail.variants[0].sku } });
tree = render(); assert.equal(nodes(tree).filter(node => node.type === 'article').length, 1);
const submit = () => find(tree, node => node.type === 'form').props.onSubmit({ preventDefault() {} });
submit(); tree = render();
assert.ok(nodes(tree).some(node => node.props?.role === 'alert'), 'Missing SKU is rejected');
find(tree, node => node.props?.className === 'sf-catalog-select-variant').props.onClick();
tree = render();
find(tree, node => node.type === 'input' && node.props.type === 'number').props.onChange({ target: { value: '0.0001' } });
tree = render(); submit(); tree = render();
assert.equal(addedSelection, undefined, 'More than three decimal places is rejected');
find(tree, node => node.type === 'input' && node.props.type === 'number').props.onChange({ target: { value: '2.5' } });
tree = render(); submit(); tree = render();
assert.equal(addedSelection.sku, detail.variants[0].sku);
assert.equal(addedSelection.quantity, 2.5);
assert.deepEqual(JSON.parse(JSON.stringify(addedSelection.attributes)), detail.variants[0].attributes, 'Only real complete SKU paths enter cart');
assert.ok(nodes(tree).some(node => node.props?.className === 'sf-catalog-added'));
find(tree, node => node.type === 'button' && node.props.children === 'مراجعة طلب عرض السعر').props.onClick(); assert.equal(reviews, 1);
addError = 'الكمية الإجمالية تتجاوز الحد'; submit(); tree = render();
assert.ok(nodes(tree).some(node => node.props?.role === 'alert' && node.props.children === addError));
assert.ok(!nodes(tree).some(node => node.props?.className === 'sf-catalog-added'));
addError = null;
let prevented = false; tree.props.onCancel({ preventDefault() { prevented = true; } });
assert.equal(prevented, true); assert.equal(dismissed, 1);
restore(); cancelFetch(); assert.equal(closeCount, 1); assert.equal(focusCount, 1); assert.equal(documentStub.body.style.overflow, 'auto');
state = []; responseMode = 'failure'; tree = render(); effects[1](); await flush(); tree = render();
assert.ok(nodes(tree).some(node => node.props?.role === 'alert'));
const alert = find(tree, node => node.props?.role === 'alert');
find(alert, node => node.type === 'button').props.onClick();
responseMode = 'success'; tree = render(); effects[1](); await flush(); tree = render();
assert.ok(!nodes(tree).some(node => node.props?.role === 'alert'));
assert.equal(nodes(tree).filter(node => node.type === 'article').length, 30);
// Closing before the response arrives must not update the unmounted dialog.
state = []; tree = render(); const abort = effects[1](); abort(); await flush(); tree = render();
assert.ok(nodes(tree).some(node => node.props?.role === 'status'));
for (const incomplete of [manifest.products.find(product => !product.variantCount), manifest.products.find(product => !product.units.length)]) {
  assert.ok(incomplete);
  renderedProduct = { ...incomplete, catalogEntry: incomplete, images: incomplete.images.map((url, index) => ({ id: `${index}`, url, tone: 'cement', alt: incomplete.name })) };
  responseDetail = JSON.parse(readFileSync(`public${incomplete.detailsPath}`, 'utf8'));
  state = []; addedSelection = undefined; tree = render(); effects[1](); await flush(); tree = render();
  if (responseDetail.variants.length) {
    find(tree, node => node.props?.className === 'sf-catalog-select-variant').props.onClick(); tree = render();
  }
  submit(); tree = render();
  assert.ok(addedSelection, 'Every product can be requested even with unpublished source facts');
  if (!responseDetail.variants.length) { assert.equal(addedSelection.sku, ''); assert.equal(addedSelection.attributes.length, 0); }
  if (!responseDetail.units.length) assert.equal(addedSelection.unit, 'تحددها الإدارة');
}
console.log('PASS catalog dialog loading, pagination, SKU search, validated exact-SKU cart selection, review, quantity limits, error/retry, cancellation, Escape and focus restoration.');
