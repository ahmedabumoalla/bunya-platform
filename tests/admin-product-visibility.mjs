import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';

const require = createRequire(import.meta.url);
const code = ts.transpileModule(readFileSync('src/components/admin/AdminProductReview.tsx', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const product = { id: 'fixture', name: 'منتج تجريبي', review_status: 'approved', is_published: true, updated_at: '2026-10-08T10:00:00Z', product_images: [], stock_quantity: null, offer_type: 'sale' };
function harness(fixture = product) {
  const state = [], effects = [], calls = [];
  let cursor = 0, tree, failure = null, pending, refreshes = 0;
  const hooks = {
    ...React,
    useState(initial) { const i = cursor++; if (!(i in state)) state[i] = initial; return [state[i], value => { state[i] = typeof value === 'function' ? value(state[i]) : value; }]; },
    useRef(initial) { const i = cursor++; if (!(i in state)) state[i] = { current: initial }; return state[i]; },
    useEffect(fn) { effects.push(fn); }, useMemo: fn => fn(),
  };
  const mocks = {
    react: hooks,
    'next/image': { default: () => null },
    'next/navigation': { useRouter: () => ({ refresh() { refreshes++; } }) },
    '@/lib/body-scroll-lock': {},
    './useDialogFocus': {},
    './AdminProductReview.module.css': { default: new Proxy({}, { get: (_, name) => name }) },
    '@/lib/products/image-urls': { isProductVideo: () => false, signProductImageMap: async () => new Map() },
    '@/lib/supabase/client': { createClient: () => ({ from(table) {
      let call;
      return {
        update(payload) { call = { table, payload, filters: {} }; calls.push(call); return this; },
        eq(key, value) { if (call) call.filters[key] = value; return this; },
        select() { return this; }, order() { return this; }, limit() { return this; },
        then(resolve, reject) { return Promise.resolve({ data: table === 'products' ? [fixture] : [], error: null }).then(resolve, reject); },
        async single() {
          if (pending) await pending;
          if (failure === 'offline') throw Error('offline');
          if (failure) return { data: null, error: { message: failure } };
          return { data: { id: fixture.id, ...call.payload, updated_at: '2026-10-08T11:00:00Z' }, error: null };
        },
      };
    } }) },
  };
  const exports = {};
  vm.runInNewContext(code, { exports, require: name => mocks[name] ?? require(name), console });
  const render = () => { cursor = 0; tree = exports.AdminProductReview({}); return tree; };
  function nodes(node = tree) { return !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(child => nodes(child ?? null)) : [node, ...nodes(node.props?.children ?? null)]; }
  const text = node => typeof node === 'string' ? node : !node ? '' : Array.isArray(node) ? node.map(text).join('') : text(node.props?.children);
  const toggle = () => nodes().find(node => node.type === 'button' && node.props['aria-busy'] !== undefined);
  return { render, nodes, text, toggle, calls, effects, setFailure: value => { failure = value; }, setPending: value => { pending = value; }, refreshes: () => refreshes };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
async function ready(fixture) { const h = harness(fixture); h.render(); for (const effect of [...h.effects]) effect(); await tick(); h.render(); return h; }

const h = await ready();
assert.match(h.text(h.render()), /ظاهر في المنصة/);
let release;
h.setPending(new Promise(resolve => { release = resolve; }));
h.toggle().props.onClick();
h.toggle().props.onClick();
h.render();
assert.equal(h.calls.length, 1, 'rapid duplicate click is ignored');
assert.equal(h.toggle().props.disabled, true);
assert.match(h.text(h.toggle()), /جارٍ الحفظ/);
release(); await tick(); h.render();
assert.equal(h.calls[0].payload.is_published, false);
assert.equal(h.calls[0].filters.id, product.id);
assert.equal(h.calls[0].filters.review_status, 'approved');
assert.equal(h.calls[0].filters.updated_at, product.updated_at);
assert.deepEqual(Object.keys(h.calls[0].payload), ['is_published']);
assert.match(h.text(h.toggle()), /إظهار في المنصة/);
assert.match(h.text(h.render()), /بياناته وطلباته السابقة محفوظة/);
h.setPending(null);
h.toggle().props.onClick(); await tick(); h.render();
assert.equal(h.calls[1].payload.is_published, true);
assert.equal(h.calls[1].filters.updated_at, '2026-10-08T11:00:00Z');
assert.match(h.text(h.toggle()), /إخفاء من المنصة/);
assert.equal(h.refreshes(), 2);
for (const failure of ['permission denied', 'stale revision', 'offline']) {
  h.setFailure(failure); h.toggle().props.onClick(); await tick(); h.render();
  assert.equal(h.toggle().props.disabled, false);
  assert.match(h.text(h.toggle()), /إخفاء من المنصة/);
  assert.ok(h.nodes().some(node => node.props?.role === 'alert'));
}
for (const status of ['pending_review', 'rejected', 'draft', 'needs_changes']) {
  const blocked = await ready({ ...product, review_status: status, is_published: false });
  assert.equal(blocked.toggle(), undefined);
}
const hidden = await ready({ ...product, is_published: false });
const statusSelect = hidden.nodes().find(node => node.type === 'select');
statusSelect.props.onChange({ target: { value: 'hidden' } }); hidden.render();
assert.ok(hidden.toggle());
statusSelect.props.onChange({ target: { value: 'published' } }); hidden.render();
assert.equal(hidden.toggle(), undefined);
console.log('PASS product hide/show persistence, duplicate prevention, revision guard, errors/retry, review gating and visibility filters');
