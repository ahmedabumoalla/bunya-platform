import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const exports = {};
new Function('exports', ts.transpileModule(readFileSync('src/lib/quotes/price-invoice-breakdown.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(exports);
const { priceInvoiceBreakdown } = exports;
const cents = value => Math.round(value * 100);
function check(input) {
  const before = JSON.stringify(input);
  const actual = priceInvoiceBreakdown(input);
  assert.equal(JSON.stringify(input), before, 'Rendering must not mutate the saved invoice');
  const all = [...actual.lines, actual.delivery];
  assert.equal(all.reduce((sum, row) => sum + cents(row.vat), 0), cents(input.vat_amount));
  assert.equal(all.reduce((sum, row) => sum + cents(row.gross), 0), cents(input.total));
  assert.equal(all.reduce((sum, row) => sum + cents(row.net), 0), cents(input.total) - cents(input.vat_amount));
  for (const row of all) assert.equal(cents(row.net) + cents(row.vat), cents(row.gross));
  return actual;
}
const legacy = check({ items: [{ line_total: 6938.4 }], subtotal: 6938.4, delivery_fee: 0, vat_rate: 15, vat_amount: 1040.76, total: 7979.16 });
assert.deepEqual(legacy.lines, [{ net: 6938.4, vat: 1040.76, gross: 7979.16 }]);
assert.equal(legacy.net, 6938.4);
const inclusive = check({ pricing_basis: 'inclusive', items: [{ line_total: 230 }], subtotal: 230, delivery_fee: 57.5, vat_rate: 15, vat_amount: 37.5, total: 287.5 });
assert.deepEqual(inclusive.lines, [{ net: 200, vat: 30, gross: 230 }]);
assert.deepEqual(inclusive.delivery, { net: 50, vat: 7.5, gross: 57.5 });
for (const pricing_basis of ['exclusive', 'inclusive']) {
  const small = check({ pricing_basis, items: [{ line_total: 0.04 }, { line_total: 0.04 }, { line_total: 0.04 }], subtotal: 0.12, delivery_fee: 0, vat_rate: 15, vat_amount: 0.02, total: pricing_basis === 'inclusive' ? 0.12 : 0.14 });
  assert.deepEqual(small.lines.map(row => row.vat), [0.01, 0.01, 0], 'Stable allocation prevents three individually rounded cents from overstating VAT');
}
check({ pricing_basis: 'inclusive', items: [{ line_total: 26.22 }, { line_total: 0.33 }, { line_total: 0.33 }], subtotal: 26.88, delivery_fee: 0.01, vat_rate: 15, vat_amount: 3.51, total: 26.89 });
check({ pricing_basis: 'inclusive', items: Array.from({ length: 50 }, () => ({ line_total: 0.01 })), subtotal: 0.5, delivery_fee: 0, vat_rate: 15, vat_amount: 0.07, total: 0.5 });
check({ pricing_basis: 'exclusive', items: [{ line_total: 0 }], subtotal: 0, delivery_fee: 0, vat_rate: 15, vat_amount: 0, total: 0 });
check({ pricing_basis: 'inclusive', items: [{ line_total: 1000000000 }], subtotal: 1000000000, delivery_fee: 0, vat_rate: 15, vat_amount: 130434782.61, total: 1000000000 });
assert.throws(() => priceInvoiceBreakdown({ items: [{ line_total: 1 }], subtotal: 1, delivery_fee: 0, vat_rate: 15, vat_amount: 0.16, total: 1.16 }), /reconcile/);
console.log('PASS invoice breakdown: legacy/gross prices, exact line and delivery VAT reconciliation, stable rounding, fractional lines, 50 tiny lines, zero/large values, snapshot immutability and invalid totals.');
