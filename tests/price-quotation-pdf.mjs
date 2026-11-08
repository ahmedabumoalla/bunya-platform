import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import path from 'node:path';

// Read the real font's Unicode character map: a workstation's fallback fonts
// must not make a PDF test pass when the server would render missing-glyph boxes.
const fontPath = 'src/app/fonts/IBMPlexSansArabic-Regular.ttf';
const font = readFileSync(fontPath);
let cmapOffset;
for (let i = 0; i < font.readUInt16BE(4); i++) {
  const offset = 12 + i * 16;
  if (font.toString('ascii', offset, offset + 4) === 'cmap') cmapOffset = font.readUInt32BE(offset + 8);
}
assert.ok(cmapOffset, 'bundled PDF font contains a character map');
const maps = Array.from({length: font.readUInt16BE(cmapOffset + 2)}, (_, i) => cmapOffset + font.readUInt32BE(cmapOffset + 8 + i * 8));
function hasGlyph(code) {
  return maps.some(offset => {
    const format = font.readUInt16BE(offset);
    if (format === 12) {
      for (let i = 0; i < font.readUInt32BE(offset + 12); i++) {
        const group = offset + 16 + i * 12;
        if (code >= font.readUInt32BE(group) && code <= font.readUInt32BE(group + 4)) return font.readUInt32BE(group + 8) + code - font.readUInt32BE(group) !== 0;
      }
    } else if (format === 4 && code <= 0xffff) {
      const count = font.readUInt16BE(offset + 6) / 2;
      for (let i = 0; i < count; i++) {
        const end = font.readUInt16BE(offset + 14 + i * 2), start = font.readUInt16BE(offset + 16 + count * 2 + i * 2);
        if (code < start || code > end) continue;
        const delta = font.readInt16BE(offset + 16 + count * 4 + i * 2);
        const rangeAt = offset + 16 + count * 6 + i * 2, range = font.readUInt16BE(rangeAt);
        const glyph = range ? font.readUInt16BE(rangeAt + range + (code - start) * 2) : code;
        return (range && glyph === 0 ? 0 : (glyph + delta) & 0xffff) !== 0;
      }
    }
    return false;
  });
}
const checkedCharacters = new Set();
const printedText = [];
function verifiedSharp(input, options) {
  if (input?.text) {
    assert.equal(input.text.fontfile, path.resolve(fontPath));
    assert.match(input.text.font, /^IBM Plex Sans Arabic /);
    const plain = input.text.text.replace(/<[^>]+>/g, '').replace(/&(amp|lt|gt|quot);/g, (_, name) => ({amp:'&',lt:'<',gt:'>',quot:'"'})[name]);
    printedText.push(plain);
    for (const character of plain) {
      if (/\s|\p{Cf}/u.test(character) || checkedCharacters.has(character)) continue;
      assert.ok(hasGlyph(character.codePointAt(0)), `PDF font must contain ${JSON.stringify(character)} without OS fallback`);
      checkedCharacters.add(character);
    }
  }
  return sharp(input, options);
}

const require = createRequire(import.meta.url);
function load(file, mocks = {}) {
  const exports = {};
  const source = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  new Function('exports','require',source)(exports, name => Object.hasOwn(mocks, name) ? mocks[name] : require(name));
  return exports;
}
const policy = load('src/lib/quotes/price-quotation-policy.ts');
const presentation = load('src/lib/quotes/price-quotation-presentation.ts');
const { renderPriceQuotationPdf } = load('src/lib/quotes/price-quotation-pdf.ts', { 'server-only': {}, './price-quotation-policy': policy, './price-quotation-presentation':presentation, sharp: verifiedSharp });
const nextConfig = load('next.config.ts').default;
for (const route of ['/api/price-quotations/*/pdf', '/api/price-quotations/*/send']) {
  assert.ok(nextConfig.outputFileTracingIncludes[route].includes('./' + fontPath), `${route} bundles the PDF font`);
}
const quotation = {
  id:'11111111-1111-4111-8111-111111111111', quotation_code:'QT-PREVIEW-001', source_request_id:null, source_request_code:null,
  customer_name:'عميل تجريبي — للمعاينة فقط', customer_phone:'+966500000000', customer_address:'الرياض — موقع العميل', customer_tax_number:'',
  delivery_city:'الرياض', delivery_window:'من يومين إلى أربعة أيام من استلام الدفعة',
  policy_version:policy.PRICE_QUOTATION_POLICY_VERSION,
  items:[{product_id:'preview',product_name:'حديد تسليح',sku:'SKU-8MM',unit:'طن',quantity:2,unit_price:2478.27,line_total:4956.54,attributes:[{label:'القطر',value:'8 ملم'},{label:'الطول',value:'6 متر'},{label:'مقاس',value:'200 × 40 × 20 mm'}],notes:'يرجى التنسيق قبل التسليم'},
    {product_id:'preview-2',product_name:'سلك تربيط مجلفن — علامة ممنوعة',sku:'SKU-22',unit:'لفة',quantity:10,unit_price:40,line_total:400,attributes:[{label:'الوزن',value:'6 كيلو'},{label:'العلامة التجارية',value:'علامة ممنوعة'}],notes:''}],
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
assert.ok('QuotationSKUC.R:AKAA0123456789×'.split('').every(character => checkedCharacters.has(character)), 'Latin labels, identifiers, numbers and measurements were exercised');
assert.ok(printedText.every(value=>!value.includes('علامة ممنوعة')),'direct quotation PDF rendering removes nonsteel brand labels and branded names');
console.log(`PASS bundled font coverage (${checkedCharacters.size} characters without fallback), route font packaging, quotation policy, Arabic PDF metadata, sample (${pdf.getPageCount()} pages), 50-item long PDF (${longPdf.getPageCount()} pages), escaped markup and version rejection.`);
