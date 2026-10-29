import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { PDFDocument } from 'pdf-lib';

const require = createRequire(import.meta.url);
function load(file, mocks = {}) {
  const exports = {};
  const source = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  new Function('exports','require',source)(exports, name => Object.hasOwn(mocks, name) ? mocks[name] : require(name));
  return exports;
}
const policy = load('src/lib/quotes/price-quotation-policy.ts');
const { renderPriceQuotationPdf } = load('src/lib/quotes/price-quotation-pdf.ts', { 'server-only': {}, './price-quotation-policy': policy });
const quotation = {
  id:'11111111-1111-4111-8111-111111111111', quotation_code:'QT-PREVIEW-001', source_request_id:null, source_request_code:null,
  customer_name:'عميل تجريبي — للمعاينة فقط', customer_phone:'0500000000', customer_address:'الرياض — موقع العميل', customer_tax_number:'',
  delivery_city:'الرياض', delivery_window:'من يومين إلى أربعة أيام من استلام الدفعة',
  policy_version:policy.PRICE_QUOTATION_POLICY_VERSION,
  items:[{product_id:'preview',product_name:'حديد تسليح',sku:'SKU-8MM',unit:'طن',quantity:2,unit_price:2478.27,line_total:4956.54,attributes:[{label:'القطر',value:'8 ملم'},{label:'الطول',value:'6 متر'}],notes:'يرجى التنسيق قبل التسليم'},
    {product_id:'preview-2',product_name:'سلك تربيط مجلفن',sku:'SKU-22',unit:'لفة',quantity:10,unit_price:40,line_total:400,attributes:[{label:'الوزن',value:'6 كيلو'}],notes:''}],
  subtotal:5356.54,vat_rate:15,vat_amount:818.48,delivery_fee:100,total:6275.02,
  valid_until:'2026-11-05T13:00:00.000Z',terms:'التواصل قبل الوصول إلى الموقع.',created_at:'2026-10-29T10:00:00.000Z',send_status:'draft',sent_at:null,send_error:null,
};
const clauses = policy.priceQuotationPolicy(quotation);
assert.equal(clauses.length,13);
assert.match(clauses[1].body,/الرياض/);
assert.match(clauses[2].body,/2026/);
assert.ok(!JSON.stringify(clauses).match(/BRKZ|Stride|505120689|SA66|أبها/));
assert.match(clauses[0].body,/١٠٠٪/);
assert.throws(()=>policy.priceQuotationPolicy({...quotation,policy_version:'unknown'}),/Unsupported/);
const pdfBytes = await renderPriceQuotationPdf(quotation);
const pdf = await PDFDocument.load(pdfBytes);
assert.ok(pdf.getPageCount() >= 2 && pdf.getPageCount() <= 3,'sample contains quotation and complete sales terms');
assert.match(pdf.getTitle(),/QT-PREVIEW-001/);
assert.equal(pdf.getAuthor(),'شركة العنوان الحصري');
assert.ok(pdfBytes.length < 4_000_000);
mkdirSync('tmp',{recursive:true});
writeFileSync('tmp/price-quotation-preview.pdf',pdfBytes);

const long = {...quotation,items:Array.from({length:50},(_,index)=>({...quotation.items[0],product_name:`منتج ${index+1} <script> & "علامة"`,notes:'وصف مواد ومواصفات مطولة للتأكد من ترحيل البنود بين الصفحات. '.repeat(10)})),terms:'هذه شروط إضافية طويلة لتجربة العرض دون اقتصاص. '.repeat(90)};
const longBytes = await renderPriceQuotationPdf(long);
const longPdf = await PDFDocument.load(longBytes);
assert.ok(longPdf.getPageCount()>5,'large quotes paginate');
assert.ok(longPdf.getPageCount()<60,'pagination terminates within realistic bounds');
assert.ok(longBytes.length<15_000_000,'bounded upload size');
for(const page of longPdf.getPages()) { assert.equal(page.getWidth(),595.28); assert.equal(page.getHeight(),841.89); }
writeFileSync('tmp/price-quotation-long-preview.pdf',longBytes);
console.log(`PASS quotation policy, Arabic PDF metadata, sample (${pdf.getPageCount()} pages), 50-item long PDF (${longPdf.getPageCount()} pages), escaped markup and version rejection.`);
