import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
let state = [], cursor = 0, effects = [], calls = [], changes = 0;
let responseData = { success: true }, responseOk = true;
const hooks = { ...React, useState(initial) { const index = cursor++; if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial;
  return [state[index], value => { state[index] = typeof value === 'function' ? value(state[index]) : value; }]; }, useEffect(effect) { effects.push(effect); } };
const exports = {};
const code = ts.transpileModule(readFileSync('src/components/quotes/ManagedQuotes.tsx', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
vm.runInNewContext(code, { exports, require: name => name === 'react' ? hooks : name === 'next/link' ? { __esModule:true, default: ({ children, ...props }) => React.createElement('a', props, children) } : name === 'next/image' ? { __esModule:true, default: ({src,alt,width,height,className}) => React.createElement('img',{src,alt,width,height,className}) } : name.endsWith('.module.css') ? { __esModule:true, default: new Proxy({}, { get: (_, key) => key }) } : require(name),
  AbortController, Event, window: { dispatchEvent() {} }, fetch: async (url, options = {}) => { calls.push({ url, options }); return { ok: responseOk, json: async () => responseData }; } });
const { ManagedQuotes, ManagedQuoteDetail, QuoteEditor, CustomerDeliveryCode } = exports;
function reset() { state = []; cursor = 0; effects = []; calls = []; responseData = { success: true }; responseOk = true; }
function render(component, props) { cursor = 0; effects = []; return component(props); }
function nodes(node) { if (!node || typeof node !== 'object') return []; if (Array.isArray(node)) return node.flatMap(nodes); return [node, ...nodes(node.props?.children)]; }
function find(tree, predicate) { const node = nodes(tree).find(predicate); assert.ok(node, 'Expected UI control'); return node; }
const text = node => renderToStaticMarkup(node).replace(/<[^>]*>/g, '');
const flush = () => new Promise(resolve => setImmediate(resolve));
const item = { id: 'line-1', product_id: 'brkz-example', product_name: 'حديد تسليح', category: 'الحديد', quantity: 5, unit: 'طن', sku: 'STEEL-12', attributes: [{ label: 'القطر', value: '12 ملم' }], image_url: '', notes: '' };
const price = { item_id: 'line-1', unit_price: 100, unit: 'طن', offer_type: 'sale', rental_duration_value: null, rental_duration_unit: '', warranty: 'بدون ضمان', delivery_duration: 'يومان', notes: '' };
const request = { id: 'request-id', request_code: 'MQ-01', customer_id: 'customer-id', status: 'offered', revision: 3,
  details: { mapsUrl: 'javascript:alert(1)', recipientName: 'عميل', recipientMobile: '0500000000' }, items: [item], pricing: [price], subtotal: 500, vat_rate: 15, vat_amount: 75, delivery_fee: 0, total: 575,
  valid_until: '2099-01-01T12:00:00Z', expected_delivery_at: '2099-01-02T12:00:00Z', terms: 'شروط العرض', created_at: '2026-10-27T00:00:00Z', accepted_at: null, delivered_at: null };
const customerProps = { request, scope: 'customer', canManage: false, onChanged() { changes++; } };
reset(); let tree = render(ManagedQuoteDetail, customerProps);
const reference = find(tree,node=>node.type==='h2'&&text(node)===request.request_code);
assert.equal(reference.props.dir,'ltr','reference has stable left-to-right order');
assert.equal(reference.props.className,'requestCode');
assert.ok(!text(tree).includes('الدفع يُنسّق مع الإدارة خارج المنصة.'),'removed payment note stays absent');
assert.equal(find(tree,node=>node.type==='bdi'&&text(node)==='0500000000').props.dir,'ltr','phone digits retain their order');
assert.ok(nodes(tree).some(node=>node.props?.className==='detailGrid'),'detail panels share a bounded responsive layout');
assert.ok(!nodes(tree).some(node => node.type === QuoteEditor));
assert.ok(!nodes(tree).some(node => node.type === 'a' && String(node.props.href).startsWith('javascript:')));
find(tree, node => node.type === 'button' && text(node) === 'قبول عرض السعر').props.onClick();
tree = render(ManagedQuoteDetail, customerProps);
assert.equal(calls.length, 0, 'First acceptance click is a review confirmation');
find(tree, node => node.type === 'button' && text(node) === 'تأكيد القبول').props.onClick(); await flush();
assert.deepEqual(JSON.parse(calls[0].options.body), { action: 'accept', revision: 3 });
assert.equal(changes, 1);
reset(); tree = render(ManagedQuoteDetail, { ...customerProps, request: { ...request, valid_until: '2000-01-01T12:00:00Z' } });
assert.ok(!nodes(tree).some(node => node.type === 'button' && text(node) === 'قبول عرض السعر'));
reset(); tree = render(ManagedQuoteDetail, { ...customerProps, scope: 'admin', canManage: false });
assert.ok(!nodes(tree).some(node => node.type === QuoteEditor));
reset(); tree = render(ManagedQuoteDetail, { ...customerProps, scope: 'admin', canManage: true });
assert.ok(nodes(tree).some(node => node.type === QuoteEditor));
const adminAccepted = { ...customerProps, scope: 'admin', canManage: true, request: { ...request, status: 'accepted' } };
reset(); tree = render(ManagedQuoteDetail, adminAccepted);
assert.ok(!nodes(tree).some(node => node.type === QuoteEditor || node.type === CustomerDeliveryCode), 'Accepted quote locked; code is not exposed to admin');
find(tree, node => node.type === 'input').props.onChange({ target: { value: '123456' } }); tree = render(ManagedQuoteDetail, adminAccepted);
find(tree, node => node.type === 'form').props.onSubmit({ preventDefault() {} }); await flush();
assert.deepEqual(JSON.parse(calls[0].options.body), { action: 'confirm_delivery', revision: 3, code: '123456' });
reset(); tree = render(ManagedQuoteDetail, { ...customerProps, request: { ...request, status: 'accepted' } });
assert.ok(nodes(tree).some(node => node.type === CustomerDeliveryCode));
assert.ok(!nodes(tree).some(node => node.type === 'input'), 'Customer never verifies their own code');
reset(); responseData = { code: '654321', expiresAt: '2099-01-02T12:00:00Z' };
tree = render(CustomerDeliveryCode, { requestId: request.id });
assert.equal(calls.length, 0, 'Code is revealed only on explicit click');
find(tree, node => node.type === 'button').props.onClick(); await flush(); tree = render(CustomerDeliveryCode, { requestId: request.id });
assert.equal(calls[0].url, '/api/managed-quotes/request-id/delivery-code');
assert.ok(nodes(tree).some(node => node.props?.['aria-label'] === 'رمز التسليم 654321'));
find(tree, node => node.type === 'button').props.onClick(); tree = render(CustomerDeliveryCode, { requestId: request.id });
assert.ok(!nodes(tree).some(node => node.props?.['aria-label'] === 'رمز التسليم 654321'));

reset(); let submitted;
const editorProps = { request, busy: false, onSubmit: async (action, payload) => { submitted = { action, payload }; } };
tree = render(QuoteEditor, editorProps);
find(tree, node => node.type === 'select' && node.props.value === 'sale').props.onChange({ target: { value: 'rental' } });
tree = render(QuoteEditor, editorProps);
const rentalLabel = find(tree, node => node.type === 'label' && text(node).startsWith('مدة التأجير'));
find(rentalLabel, node => node.type === 'input').props.onChange({ target: { value: '3' } });
tree = render(QuoteEditor, editorProps);
find(tree, node => node.type === 'form').props.onSubmit({ preventDefault() {}, nativeEvent: { submitter: { value: 'publish_quote' } } }); await flush();
assert.equal(submitted.action, 'publish_quote');
assert.equal(submitted.payload.pricing[0].rental_duration_value, 3);
assert.equal(submitted.payload.pricing[0].offer_type, 'rental');
assert.equal(submitted.payload.pricing[0].warranty, 'بدون ضمان');
assert.equal(submitted.payload.vat_rate, 15);

reset(); responseData = { requests: [request], count: 51, canManage: true };
tree = render(ManagedQuotes, { scope: 'admin' }); effects[0](); await flush(); tree = render(ManagedQuotes, { scope: 'admin' });
assert.ok(nodes(tree).some(node => node.props?.href === '/admin/managed-quotes/request-id'));
find(tree, node => node.type === 'button' && text(node) === 'التالي').props.onClick(); tree = render(ManagedQuotes, { scope: 'admin' }); effects[0](); await flush();
assert.equal(calls.at(-1).url, '/api/managed-quotes?scope=admin&page=1');
const portal = readFileSync('src/components/database/RoleDatabasePortal.tsx', 'utf8');
assert.ok(portal.indexOf('if (managedQuoteMatch') < portal.indexOf('if (role === "admin" && pathname === "/admin")'));
assert.ok(readFileSync('src/lib/admin/navigation.ts', 'utf8').includes('["عروض الأسعار", "/admin/managed-quotes"'));
assert.ok(!portal.includes('<CustomerRfqForm'), 'Legacy creation form must not submit provider-based RFQs');
assert.ok(readFileSync('src/app/customer/quote-request/new/page.tsx', 'utf8').includes('redirect("/#products")'));
for (const file of ['src/components/customer/CustomerWorkspace.tsx', 'src/components/customer/CustomerShell.tsx']) {
  const source = readFileSync(file, 'utf8');
  assert.ok(!source.includes('"/customer/quote-request/new"'), 'New request CTAs use the shared catalog/cart');
  assert.ok(source.includes('"/customer/quote-requests"'), 'Historical requests remain accessible');
}
reset(); tree=render(ManagedQuoteDetail,{...customerProps,request:{...request,items:[{...item,image_url:'/catalog/steel.webp'}]}});
assert.ok(renderToStaticMarkup(tree).includes('src="/catalog/steel.webp"'),'existing product photo appears with its item');
const css=readFileSync('src/components/quotes/ManagedQuotes.module.css','utf8');
require('postcss').parse(css);
assert.match(css,/max-width:1120px/);
assert.match(css,/\.page \.requestCode,\.page \.identifier,\.page \.date \{ font-family:var\(--font-plex-arabic\)/,'codes and numerals use existing legible utility font');
assert.match(css,/@media\(max-width:480px\).*\.detailGrid \.facts/s);
console.log('PASS managed quote UI: compact responsive detail, isolated references/phones, product photos, removed payment note, role-gated editor, customer decisions, private code roles, rental payload, pagination and routing.');
