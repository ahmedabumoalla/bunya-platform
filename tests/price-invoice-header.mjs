import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';

const require = createRequire(import.meta.url);
function load(file, mocks = {}) {
  const exports = {};
  const source = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  new Function('exports', 'require', source)(exports, name => Object.hasOwn(mocks, name) ? mocks[name] : require(name));
  return exports;
}
const printed = [];
const recordingSharp = (input, ...args) => { if (input?.text) printed.push(input.text.text); return sharp(input, ...args); };
const stationery = load('src/lib/quotes/price-quotation-pdf.ts', {
  'server-only': {}, sharp: recordingSharp,
  './price-quotation-policy': load('src/lib/quotes/price-quotation-policy.ts'),
  './price-quotation-presentation': load('src/lib/quotes/price-quotation-presentation.ts'),
  './price-invoice-breakdown': load('src/lib/quotes/price-invoice-breakdown.ts'),
});
const { renderPriceInvoicePdf } = load('src/lib/quotes/price-invoice-pdf.ts', { 'server-only': {}, './price-quotation-pdf': stationery });
const { priceInvoiceQr } = load('src/lib/quotes/price-invoice-validation.ts');
const { priceInvoicePolicy } = load('src/lib/quotes/price-invoice-policy.ts');
const invoice = {
  id: 'header-fixture', status: 'issued', invoice_number: 'INV-20261109-000123', invoice_type: 'standard',
  issued_at: '2026-11-09T00:00:00Z', supply_date: '2026-11-09', quotation_id: 'quote-fixture', quotation_code: 'QUO-20261109-HEADER', customer_number: 'CUS-000123',
  seller: { name: 'شركة العنوان الحصري', commercial_registration: '5850157983', vat_number: '312872746700003', address: '8043 حي الخالدية، خميس مشيط 62411، المملكة العربية السعودية' },
  buyer: { name: 'عميل تجريبي', phone: '+966500000000', address: 'الرياض — عنوان تجريبي', vat_number: '310000000000003' },
  items: [{ product_id: 'fixture', product_name: 'مادة بناء', sku: 'TEST-01', unit: 'حبة', quantity: 2, unit_price: 50, line_total: 100, attributes: [], notes: '' }],
  subtotal: 100, delivery_fee: 0, vat_rate: 15, vat_amount: 15, total: 115, currency: 'SAR', sales_policy: priceInvoicePolicy(),
};
function withQr(value) { return { ...value, qr_payload: priceInvoiceQr({ seller_name: value.seller.name, seller_vat: value.seller.vat_number, issued_at: value.issued_at, total: value.total, vat_amount: value.vat_amount }) }; }
for (const type of ['standard', 'simplified']) {
  printed.length = 0;
  const bytes = await renderPriceInvoicePdf(withQr({ ...invoice, invoice_type: type }));
  assert.equal((await PDFDocument.load(bytes)).getPageCount(), 1);
  for (const expected of ['بيانات العميل', 'رقم العميل:', 'CUS-000123', 'رقم الفاتورة', 'تاريخ الإصدار', 'تاريخ التوريد', invoice.seller.name, invoice.seller.vat_number, invoice.seller.commercial_registration, invoice.seller.address]) assert.ok(printed.some(value => value.includes(expected)), expected);
  assert.ok(!printed.some(value => /بيانات المشتري|بيانات البائع|رمز الفاتورة الضريبية/.test(value)));
  assert.ok(printed.findIndex(value => value.includes(invoice.seller.name)) < printed.findIndex(value => value.includes('بيانات العميل')));
  writeFileSync(`tmp/invoice-header-${type}-numbered.pdf`, bytes);
}
const long = withQr({ ...invoice, items: Array.from({ length: 50 }, () => ({ ...invoice.items[0], notes: 'مواد تجريبية للتأكد من استمرار الجدول والبيانات بين الصفحات.' })), subtotal: 5000, vat_amount: 750, total: 5750 });
const longBytes = await renderPriceInvoicePdf(long);
const longPdf = await PDFDocument.load(longBytes);
assert.ok(longPdf.getPageCount() > 1 && longPdf.getPageCount() < 20, 'The repeated seller header still leaves bounded room for multipage item tables');
writeFileSync('tmp/invoice-header-long.pdf', longBytes);
console.log(`PASS invoice header: seller data, client terminology/number, aligned metadata labels, no seller card/QR caption, standard/simplified one page and 50-item pagination (${longPdf.getPageCount()} pages).`);
