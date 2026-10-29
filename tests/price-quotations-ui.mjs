import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
let state = [], cursor = 0, effects = [], calls = [], pushed = [], handler, locationSearch = '';
const hooks = { ...React, useState(initial) {
  const index = cursor++;
  if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial;
  return [state[index], value => { state[index] = typeof value === 'function' ? value(state[index]) : value; }];
}, useRef(initial) {
  const index = cursor++;
  if (!(index in state)) state[index] = { current: initial };
  return state[index];
}, useEffect(effect) { effects.push(effect); } };
const dependencies = new Map();
function sourceModule(file) {
  if (dependencies.has(file)) return dependencies.get(file);
  const exports = {};
  const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  vm.runInNewContext(code + (file.endsWith('PriceQuotations.tsx') ? '\nexports.ProductPicker = ProductPicker; exports.PriceQuotationList = PriceQuotationList;' : ''), {
    exports, require: name => name === 'react' ? hooks : name === 'next/link' ? { __esModule: true, default: ({ children, ...props }) => React.createElement('a', props, children) }
      : name === 'next/navigation' ? { useRouter: () => ({ push: url => pushed.push(url) }) }
      : name.endsWith('.module.css') ? { __esModule: true, default: new Proxy({}, { get: (_, key) => key }) }
      : name.startsWith('@/lib/quotes/') ? sourceModule(`${name.replace('@/', 'src/')}.ts`) : require(name),
    AbortController, URLSearchParams, setTimeout, clearTimeout, crypto: { randomUUID }, window: { location: { get search() { return locationSearch; } } },
    fetch: async (url, options = {}) => { calls.push({ url, options }); const result = handler(url, options); return { ok: result.ok ?? true, json: async () => result.body }; },
  });
  dependencies.set(file, exports); return exports;
}
const { PriceQuotationComposer, PriceQuotationDetail, PriceQuotationList, ProductPicker } = sourceModule('src/components/quotes/PriceQuotations.tsx');
function reset() { state = []; cursor = 0; effects = []; calls = []; pushed = []; locationSearch = ''; handler = () => ({ body: { requests: [], count: 0 } }); }
function render(component, props = {}) { cursor = 0; effects = []; return component(props); }
function nodes(node) { if (!node || typeof node !== 'object') return []; if (Array.isArray(node)) return node.flatMap(nodes); return [node, ...nodes(node.props?.children)]; }
function find(tree, predicate) { const node = nodes(tree).find(predicate); assert.ok(node, 'Expected UI control'); return node; }
const text = node => renderToStaticMarkup(node).replace(/<[^>]*>/g, '');
const flush = () => new Promise(resolve => setImmediate(resolve));
const field = (tree, label) => find(find(tree, node => node.type === 'label' && text(node).startsWith(label)), node => ['input', 'select', 'textarea'].includes(node.type));
const line = { key: 'fixture-1', product_id: 'brkz-steel', product_name: 'حديد تسليح', sku: 'ST-12', unit: 'طن', quantity: 1, quantityText: '1', unit_price: 0, priceText: '', attributes: [{ label: 'القطر', value: '12 ملم' }], notes: '' };
const quote = { id: 'quote-id', quotation_code: 'QT-2026-0001', source_request_id: null, source_request_code: null, customer_name: '', customer_phone: '+966500000000', customer_address: '', customer_tax_number: '', delivery_city: 'الرياض', delivery_window: '3 أيام', policy_version: 'exclusive-address-sales-v1', items: [{ ...line, quantity: 2, unit_price: 100, line_total: 200 }], subtotal: 200, vat_rate: 15, vat_amount: 30, delivery_fee: 0, total: 230, valid_until: null, terms: '', created_at: '2026-10-29T00:00:00Z', send_status: 'draft', sent_at: null, send_error: null };

reset(); let tree = render(PriceQuotationComposer);
assert.equal(field(tree, 'رقم واتساب العميل').props.required, true);
assert.equal(field(tree, 'اسم العميل أو المنشأة').props.required, undefined);
assert.equal(field(tree, 'الرقم الضريبي').props.required, undefined);
find(tree, node => node.type === ProductPicker).props.onAdd(line);
tree = render(PriceQuotationComposer);
field(tree, 'رقم واتساب العميل').props.onChange({ target: { value: '0500000000' } });
field(tree, 'الكمية').props.onChange({ target: { value: '2.005' } });
field(tree, 'سعر الوحدة قبل الضريبة').props.onChange({ target: { value: '1' } });
field(tree, 'مدينة التسليم').props.onChange({ target: { value: 'الرياض' } });
field(tree, 'مدة التوريد').props.onChange({ target: { value: '3 أيام' } });
field(tree, 'ملاحظات إضافية').props.onChange({ target: { value: 'تفاصيل العميل' } });
tree = render(PriceQuotationComposer);
assert.ok(text(tree).includes('2.01'), 'Editor uses integer-fils half-up rounding, matching saved quote');
assert.ok(text(tree).includes('سياسة البيع وشروط العرض'));
assert.ok(text(tree).includes('سداد كامل المبلغ'));
handler = () => ({ ok: false, body: { message: 'اتصال غير متاح' } });
find(tree, node => node.type === 'form').props.onSubmit({ preventDefault() {} }); await flush();
tree = render(PriceQuotationComposer);
assert.ok(text(tree).includes('اتصال غير متاح'));
const firstBody = JSON.parse(calls[0].options.body);
assert.equal(firstBody.source_request_id, null);
assert.equal(firstBody.customer_name, '');
assert.equal(firstBody.items[0].quantity, 2.005);
assert.equal(firstBody.delivery_city, 'الرياض');
assert.equal(firstBody.delivery_window, '3 أيام');
find(tree, node => node.type === 'form').props.onSubmit({ preventDefault() {} }); await flush();
assert.equal(JSON.parse(calls[1].options.body).idempotency_key, firstBody.idempotency_key, 'Retry same draft keeps idempotency key');
tree = render(PriceQuotationComposer);
field(tree, 'ملاحظات إضافية').props.onChange({ target: { value: 'تفاصيل جديدة' } });
tree = render(PriceQuotationComposer);
handler = () => ({ body: { quotation: quote } });
find(tree, node => node.type === 'form').props.onSubmit({ preventDefault() {} }); await flush();
assert.notEqual(JSON.parse(calls[2].options.body).idempotency_key, firstBody.idempotency_key, 'Changed draft receives a new key');
assert.deepEqual(pushed, ['/admin/price-quotations/quote-id']);
assert.ok(calls.every(call => !call.url.endsWith('/send')), 'Saving never sends WhatsApp');

reset(); locationSearch = '?request=source-request';
const request = { id: 'source-request', request_code: 'BQ-SOURCE', details: { recipientName: 'عميل الطلب', recipientMobile: '0500000000', locationHint: 'الرياض' }, items: [{ id: 'line-1', product_id: line.product_id, product_name: line.product_name, sku: line.sku, unit: line.unit, quantity: 4, notes: '', attributes: line.attributes }], pricing: [{ item_id: 'line-1', unit_price: 120 }], delivery_fee: 10, vat_rate: 15, terms: 'شروط الطلب' };
handler = url => ({ body: url === '/api/managed-quotes/source-request' ? { request } : { requests: [request], count: 1 } });
tree = render(PriceQuotationComposer); effects[0](); await flush(); await flush(); tree = render(PriceQuotationComposer);
assert.equal(field(tree, 'اسم العميل أو المنشأة').props.value, 'عميل الطلب');
assert.equal(field(tree, 'الكمية').props.value, '4');
assert.equal(field(tree, 'سعر الوحدة قبل الضريبة').props.value, '120');
find(tree, node => node.type === ProductPicker).props.onAdd({ ...line, key: 'extra-line', priceText: '5' });
tree = render(PriceQuotationComposer);
handler = () => ({ body: { quotation: quote } });
find(tree, node => node.type === 'form').props.onSubmit({ preventDefault() {} }); await flush();
const linkedBody = JSON.parse(calls.at(-1).options.body);
assert.equal(linkedBody.source_request_id, request.id);
assert.equal(linkedBody.items.length, 2, 'Linked request can include additional independently selected products');
assert.equal(linkedBody.items[0].source_item_id, 'line-1');
assert.equal(linkedBody.items[1].source_item_id, undefined);

reset(); locationSearch = '?request=source-request';
handler = url => ({ body: url === '/api/managed-quotes/source-request' ? { request } : { requests: [request], count: 1 } });
tree = render(PriceQuotationComposer); effects[0](); await flush(); await flush(); tree = render(PriceQuotationComposer);
find(tree, node => node.type === ProductPicker).props.onAdd({ ...line, key: 'independent-line', priceText: '5' });
tree = render(PriceQuotationComposer);
find(tree, node => node.type === 'button' && text(node) === 'إلغاء الربط وإزالة منتجات الطلب').props.onClick();
tree = render(PriceQuotationComposer);
handler = () => ({ body: { quotation: quote } });
find(tree, node => node.type === 'form').props.onSubmit({ preventDefault() {} }); await flush();
const detachedBody = JSON.parse(calls.at(-1).options.body);
assert.equal(detachedBody.source_request_id, null);
assert.equal(detachedBody.items.length, 1, 'Detaching removes historical source snapshots and keeps independently selected products');
assert.equal(detachedBody.items[0].source_item_id, undefined);
assert.equal(detachedBody.items[0].unit_price, 5);

reset(); handler = () => ({ body: { quotation: quote } });
tree = render(PriceQuotationDetail, { id: quote.id }); effects[0](); await flush(); tree = render(PriceQuotationDetail, { id: quote.id });
assert.ok(nodes(tree).some(node => node.props?.href === '/api/price-quotations/quote-id/pdf'));
assert.ok(nodes(tree).some(node => node.props?.href === '/api/price-quotations/quote-id/pdf?download=1'));
assert.equal(calls.filter(call => call.options.method === 'POST').length, 0);
handler = url => url.endsWith('/send') ? { body: { quotation: { ...quote, send_status: 'submitted' }, message: 'قَبِل مزود واتساب الملف' } } : { body: { quotation: quote } };
find(tree, node => node.type === 'button' && text(node) === 'إرسال PDF إلى واتساب').props.onClick(); await flush();
tree = render(PriceQuotationDetail, { id: quote.id });
assert.equal(calls.at(-1).url, '/api/price-quotations/quote-id/send');
assert.equal(calls.at(-1).options.method, 'POST');
assert.ok(!nodes(tree).some(node => node.type === 'button' && text(node).includes('إرسال PDF إلى واتساب')), 'Submitted files cannot be sent again');
assert.ok(text(tree).includes('تأكيد القراءة غير متاح'));

reset(); handler = () => ({ body: { quotation: quote } });
tree = render(PriceQuotationDetail, { id: quote.id }); effects[0](); await flush(); tree = render(PriceQuotationDetail, { id: quote.id });
handler = () => ({ body: { quotation: { ...quote, send_status: 'failed' }, message: 'لم يُرسل العرض' } });
find(tree, node => node.type === 'button' && text(node) === 'إرسال PDF إلى واتساب').props.onClick(); await flush(); tree = render(PriceQuotationDetail, { id: quote.id });
const failedNotice = find(tree, node => node.type === 'p' && text(node) === 'لم يُرسل العرض');
assert.equal(failedNotice.props.role, 'alert'); assert.equal(failedNotice.props.className, 'error');

reset(); handler = () => ({ body: { quotation: quote } });
tree = render(PriceQuotationDetail, { id: quote.id }); effects[0](); await flush(); tree = render(PriceQuotationDetail, { id: quote.id });
handler = () => ({ ok: false, body: { message: 'انقطع الاتصال' } });
find(tree, node => node.type === 'button' && text(node) === 'إرسال PDF إلى واتساب').props.onClick(); await flush(); await flush();
tree = render(PriceQuotationDetail, { id: quote.id });
assert.ok(!nodes(tree).some(node => node.type === 'button' && text(node).includes('إرسال PDF إلى واتساب')), 'Unknown send outcome prevents accidental duplicate retry');
assert.ok(text(tree).includes('راجع واتساب العميل'));

reset(); handler = () => ({ body: { quotations: [quote], count: 51 } });
tree = render(PriceQuotationList); effects[0](); await flush(); tree = render(PriceQuotationList);
find(tree, node => node.type === 'button' && text(node) === 'التالي').props.onClick();
tree = render(PriceQuotationList); effects[0](); await flush();
assert.equal(calls.at(-1).url, '/api/price-quotations?page=1');

reset(); let added;
const product = { id: 'brkz-steel', name: 'حديد تسليح', category: 'الحديد', units: ['طن', 'قطعة'], image_url: '', variants: [{ sku: 'ST-12', attributes: [{ label: 'القطر', value: '12 ملم' }] }, { sku: 'ST-16', attributes: [{ label: 'القطر', value: '16 ملم' }] }] };
handler = () => ({ body: { products: [product], hasMore: false } });
const pickerProps = { disabled: false, onAdd: value => { added = value; } };
tree = render(ProductPicker, pickerProps); effects[0](); await new Promise(resolve => setTimeout(resolve, 300)); tree = render(ProductPicker, pickerProps);
find(tree, node => node.type === 'button' && text(node).startsWith('حديد تسليح')).props.onClick(); await flush(); tree = render(ProductPicker, pickerProps);
field(tree, 'المواصفات / رمز المنتج').props.onChange({ target: { value: 'ST-16' } });
field(tree, 'الوحدة').props.onChange({ target: { value: 'قطعة' } });
tree = render(ProductPicker, pickerProps);
find(tree, node => node.type === 'button' && text(node) === 'إضافة إلى العرض').props.onClick();
assert.equal(added.sku, 'ST-16'); assert.equal(added.unit, 'قطعة'); assert.equal(added.attributes[0].value, '16 ملم');

reset(); added = null;
const supplier = { ...product, id: 'supplier-product', units: ['طن', 'قطعة'], measurements: [{ id: 'measure-ton', label: '12 متر', unit: 'طن' }, { id: 'measure-piece', label: '6 متر', unit: 'قطعة' }], variants: [
  { id: 'red', sku: 'RED', attributes: [{ label: 'اللون', value: 'أحمر' }] }, { id: 'blue', sku: 'BLUE', attributes: [{ label: 'اللون', value: 'أزرق' }] }, { id: 'brand', sku: 'BRAND', attributes: [{ label: 'المصنع', value: 'المصنع' }] },
] };
handler = () => ({ body: { products: [supplier], hasMore: false } });
tree = render(ProductPicker, pickerProps); effects[0](); await new Promise(resolve => setTimeout(resolve, 300)); tree = render(ProductPicker, pickerProps);
find(tree, node => node.type === 'button' && text(node).startsWith('حديد تسليح')).props.onClick(); await flush(); tree = render(ProductPicker, pickerProps);
find(tree, node => node.type === 'button' && text(node) === 'إضافة إلى العرض').props.onClick(); tree = render(ProductPicker, pickerProps);
assert.equal(added, null, 'Supplier product requires all attribute groups');
assert.ok(text(tree).includes('اختر قيمة لكل نوع'));
field(tree, 'اللون: أحمر').props.onChange({ target: { checked: true } }); tree = render(ProductPicker, pickerProps);
field(tree, 'اللون: أزرق').props.onChange({ target: { checked: true } }); tree = render(ProductPicker, pickerProps);
assert.equal(field(tree, 'اللون: أحمر').props.checked, false, 'Choosing another color replaces conflicting attribute');
field(tree, 'المصنع: المصنع').props.onChange({ target: { checked: true } }); tree = render(ProductPicker, pickerProps);
field(tree, 'الوحدة').props.onChange({ target: { value: 'قطعة' } }); tree = render(ProductPicker, pickerProps);
assert.equal(field(tree, 'القياس').props.value, 'measure-piece', 'Unit change resets measurement to a matching option');
find(tree, node => node.type === 'button' && text(node) === 'إضافة إلى العرض').props.onClick();
assert.deepEqual(Array.from(added.variant_ids), ['blue', 'brand']);
assert.equal(added.measurement_id, 'measure-piece');
assert.equal(added.sku, '');

handler = () => ({ ok: false, body: { message: 'كتالوج غير متاح' } });
tree = render(ProductPicker, pickerProps);
field(tree, 'البحث في منتجات المنصة').props.onChange({ target: { value: 'منتج آخر' } });
tree = render(ProductPicker, pickerProps); effects[0](); await new Promise(resolve => setTimeout(resolve, 300)); tree = render(ProductPicker, pickerProps);
assert.ok(!nodes(tree).some(node => node.type === 'button' && text(node).startsWith('حديد تسليح')), 'Failed refresh clears stale catalog results');
assert.ok(!nodes(tree).some(node => node.type === 'button' && text(node) === 'إضافة إلى العرض'), 'Failed catalog refresh clears stale selection');

const css = readFileSync('src/components/quotes/PriceQuotations.module.css', 'utf8');
require('postcss').parse(css);
assert.match(css, /@media\(max-width:1000px\).*grid-template-columns:minmax\(0,1fr\)/s);
assert.match(css, /@media\(max-width:480px\).*\.fields,\.facts/s);
assert.match(css, /focus-visible/);
const portal = readFileSync('src/components/database/RoleDatabasePortal.tsx', 'utf8');
assert.ok(portal.indexOf('if (priceQuotationMatch') < portal.indexOf('if (role === "admin" && pathname === "/admin")'));
assert.ok(readFileSync('src/lib/admin/navigation.ts', 'utf8').includes('["عروض الأسعار", "/admin/price-quotations"'));
console.log('PASS price quotation UI: independent mobile-only draft, SKU/unit selection, integer totals, policy/delivery fields, retry idempotency, save without send, PDF links, explicit send and ambiguous retry lock, pagination, responsive CSS and routing.');
