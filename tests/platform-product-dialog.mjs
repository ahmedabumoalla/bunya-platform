import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';

const require = createRequire(import.meta.url);
let state = [], cursor = 0, effects = [], responseMode = 'success', openCount = 0, closeCount = 0, focusCount = 0, dismissed = 0;
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
function load(file, mocks = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { exports, require: name => Object.hasOwn(mocks, name) ? mocks[name] : require(name), document: documentStub, AbortController,
    fetch: async url => { assert.equal(url, entry.detailsPath); return { ok: responseMode === 'success', json: async () => detail }; } });
  return exports;
}
const { PlatformProductDialog } = load('src/components/home/PlatformProductDialog.tsx', {
  react: hooks, '@/lib/catalog/platform-details': load('src/lib/catalog/platform-details.ts'),
  './HomeStorefrontUi': { Icon: () => null, ProductArtwork: () => null },
});
function render() { cursor = 0; effects = []; return PlatformProductDialog({ product, onClose() { dismissed++; } }); }
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
find(tree, node => node.type === 'input').props.onChange({ target: { value: detail.variants[0].sku } });
tree = render(); assert.equal(nodes(tree).filter(node => node.type === 'article').length, 1);
assert.ok(!nodes(tree).some(node => node.type === 'form'), 'No supplier checkout/RFQ mutation');
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
console.log('PASS catalog dialog loading, pagination, SKU search, error/retry, cancellation, Escape, scroll/focus restoration and absence of supplier mutations.');
