import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import {PDFDocument, PDFName, PDFRawStream, decodePDFRawStream} from 'pdf-lib';
import jsQR from 'jsqr';
import sharp from 'sharp';

const require = createRequire(import.meta.url);
function load(file, mocks = {}) {
  const exports = {};
  const source = ts.transpileModule(readFileSync(file, 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  new Function('exports','require',source)(exports, name => Object.hasOwn(mocks,name) ? mocks[name] : require(name));
  return exports;
}
const policy = load('src/lib/quotes/price-quotation-policy.ts');
const invoicePolicy = load('src/lib/quotes/price-invoice-policy.ts');
const presentation = load('src/lib/quotes/price-quotation-presentation.ts');
const renderedText=[];
const recordingSharp=(input,...args)=>{if(input?.text)renderedText.push(input.text.text);return sharp(input,...args);};
const stationery = load('src/lib/quotes/price-quotation-pdf.ts', {'server-only':{}, './price-quotation-policy':policy,'./price-quotation-presentation':presentation,'./price-invoice-breakdown':load('src/lib/quotes/price-invoice-breakdown.ts'),sharp:recordingSharp});
const {renderPriceInvoicePdf} = load('src/lib/quotes/price-invoice-pdf.ts', {'server-only':{},'./price-quotation-pdf':stationery});
const {priceInvoiceQr} = load('src/lib/quotes/price-invoice-validation.ts');

const invoice = {
  id:'11111111-1111-4111-8111-111111111112', status:'issued', invoice_number:'INV-PREVIEW-0001', invoice_type:'standard',
  issued_at:'2026-11-08T20:00:00.000Z', supply_date:'2026-11-09', quotation_id:'11111111-1111-4111-8111-111111111111',quotation_code:'QT-PREVIEW-001',
  seller:{name:'شركة العنوان الحصري',vat_number:'312872746700003',commercial_registration:'5850157983',address:'AKAA8043 — 8043 حي الخالدية، خميس مشيط 62411 — المملكة العربية السعودية'},
  buyer:{name:'شركة تجريبية — للمعاينة فقط',phone:'+966500000000',address:'الرياض — عنوان تجريبي',vat_number:'310000000000003'},
  items:[{product_id:'preview',product_name:'مكعبات فلين',sku:'EPS-01-20020-12',unit:'حبة',quantity:210,unit_price:33.04,line_total:6938.4,attributes:[{label:'مقاس',value:'200 × 40 × 20 mm'},{label:'نوع',value:'ضغط 12'}],notes:''}],
  subtotal:6938.4,delivery_fee:0,vat_rate:15,vat_amount:1040.76,total:7979.16,currency:'SAR',qr_payload:'',
  sales_policy:invoicePolicy.priceInvoicePolicy(),
};
invoice.qr_payload = priceInvoiceQr({seller_name:invoice.seller.name,seller_vat:invoice.seller.vat_number,issued_at:invoice.issued_at,total:invoice.total,vat_amount:invoice.vat_amount});
const expectedFields = [invoice.seller.name,invoice.seller.vat_number,new Date(invoice.issued_at).toISOString(),invoice.total.toFixed(2),invoice.vat_amount.toFixed(2)];
function assertTlv(payload) {
  const bytes = Buffer.from(payload,'base64');
  let offset = 0;
  const fields = [];
  while(offset < bytes.length) {
    assert.equal(bytes[offset++], fields.length + 1);
    const length = bytes[offset++];
    const value = bytes.subarray(offset, offset + length);
    assert.equal(value.length,length);
    fields.push(value.toString('utf8'));
    offset += length;
  }
  assert.deepEqual(fields,expectedFields,'UTF-8 TLV issuer, VAT ID, issue timestamp and two-decimal totals remain exact');
}
function decodedQrImages(pdf) {
  const payloads = [];
  for (const [,object] of pdf.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFRawStream) || object.dict.get(PDFName.of('Subtype')) !== PDFName.of('Image')) continue;
    const width=object.dict.get(PDFName.of('Width'))?.asNumber(),height=object.dict.get(PDFName.of('Height'))?.asNumber();
    if (!width || !height || width !== height || width < 100 || object.dict.get(PDFName.of('ColorSpace')) !== PDFName.of('DeviceRGB')) continue;
    const rgb=decodePDFRawStream(object).decode();
    assert.equal(rgb.length,width*height*3);
    const rgba=new Uint8ClampedArray(width*height*4);
    for(let i=0;i<width*height;i++){rgba.set(rgb.subarray(i*3,i*3+3),i*4);rgba[i*4+3]=255;}
    const decoded=jsQR(rgba,width,height);
    if(decoded)payloads.push(decoded.data);
  }
  return payloads;
}
mkdirSync('tmp',{recursive:true});
for(const type of ['standard','simplified']) {
  renderedText.length=0;
  const bytes=await renderPriceInvoicePdf({...invoice,invoice_type:type,buyer:type==='simplified'?{...invoice.buyer,name:'عميل نقدي',vat_number:''}:invoice.buyer});
  const pdf=await PDFDocument.load(bytes);
  assert.equal(pdf.getPageCount(),1,'all sales terms share the invoice page, with no dedicated policy page');
  for(const label of ['الوحدة','الكمية','نسبة الضريبة','مبلغ الضريبة','الإجمالي قبل الضريبة','الإجمالي شامل الضريبة','سعر الوحدة قبل الضريبة'])assert.ok(renderedText.some(text=>text.includes(label)),label+' is included in the invoice table');
  for(const value of ['210','33.04','1,040.76','6,938.40','7,979.16'])assert.ok(renderedText.some(text=>text.includes(value)),value+' is included in the financial breakdown');
  assert.ok(renderedText.some(text=>text.includes('تم استلام البضاعة بحالتها الأصلية ومطابقة للمواصفات الواردة في الفاتورة وبحالة ممتازة')));
  assert.ok(!renderedText.some(text=>/إقرار استلام|اسم المستلم|التوقيع|تاريخ الاستلام/.test(text)));
  for(const section of invoice.sales_policy)assert.ok(renderedText.some(text=>text.replaceAll('\u200f','').includes(section.body)),section.title+' is rendered completely');
  assert.match(pdf.getTitle(), type==='standard'?/فاتورة ضريبية INV-/:/فاتورة ضريبية مبسطة INV-/);
  const decoded=decodedQrImages(pdf);
  assert.deepEqual(decoded,[invoice.qr_payload],'the actual PDF embeds a digitally decodable tax QR with the saved payload');
  assertTlv(decoded[0]);
  writeFileSync(`tmp/price-invoice-${type}-preview.pdf`,bytes);
}
const draftBytes=await renderPriceInvoicePdf({...invoice,status:'draft',invoice_number:'DRAFT',qr_payload:''});
const draft=await PDFDocument.load(draftBytes);
assert.equal(draft.getPageCount(),1,'the preview also keeps totals and full policy on its invoice page');
assert.match(draft.getTitle(),/مسودة.*فاتورة ضريبية DRAFT/);
assert.match(draft.getSubject(),/معاينة تجريبية — غير صالحة كفاتورة ضريبية/);
assert.deepEqual(decodedQrImages(draft),[`PREVIEW_ONLY:${invoice.quotation_id}`],'preview QR must decode to an explicit non-tax marker, never a tax TLV');
writeFileSync('tmp/price-invoice-draft-preview.pdf',draftBytes);
await assert.rejects(()=>renderPriceInvoicePdf({...invoice,qr_payload:''}),/QR payload is missing/);
const nextConfig=load('next.config.ts').default;
for(const route of ['/api/price-quotations/*/invoice/pdf','/api/price-quotations/*/invoice/preview'])assert.ok(nextConfig.outputFileTracingIncludes[route].includes('./src/app/fonts/IBMPlexSansArabic-Regular.ttf'));
console.log('PASS standard/simplified invoice PDFs; actual embedded QR digital decoding and UTF-8 TLV data; experimental preview metadata and non-tax QR marker; missing payload rejection; route font packaging. Synthetic fixtures only.');

renderedText.length=0;
const grossInvoice={...invoice,pricing_basis:'inclusive',subtotal:7979.16,items:[{...invoice.items[0],quantity:1,unit_price:7979.16,line_total:7979.16}]};
const grossBytes=await renderPriceInvoicePdf(grossInvoice);
const grossPdf=await PDFDocument.load(grossBytes);
assert.equal(grossPdf.getPageCount(),1);
assert.deepEqual(decodedQrImages(grossPdf),[invoice.qr_payload]);
assert.ok(renderedText.some(text=>text.includes('سعر الوحدة شامل الضريبة')));
assert.ok(renderedText.some(text=>text.includes('6,938.40')),'net taxable breakdown stays exact');
for(const section of invoice.sales_policy)assert.ok(renderedText.some(text=>text.replaceAll('\u200f','').includes(section.body)));
writeFileSync('tmp/price-invoice-inclusive-preview.pdf',grossBytes);
console.log('PASS gross-priced invoice: inclusive column labels, exact net/tax breakdown, unchanged total/QR, all policy terms on same page.');
