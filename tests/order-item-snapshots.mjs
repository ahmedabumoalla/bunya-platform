import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const exports = {};
const source = readFileSync(new URL("../src/lib/quotes/order-item-snapshots.ts", import.meta.url), "utf8");
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText, { exports });
const match = exports.matchOrderItemSnapshots;
const line = { product_id: "product", product_name_snapshot: "Product", quantity: 1, unit_snapshot: "piece", measurement_snapshot: "size", unit_price: 11, line_total: 11 };
const quotes = [
  { ...line, id: "quote-a", quote_request_items: { variant_label_snapshot: "Brand A" } },
  { ...line, id: "quote-b", quote_request_items: { variant_label_snapshot: "Brand B" } },
];

test("exact source links preserve distinct brands for identically priced lines", () => {
  const result = match([
    { ...line, id: "order-b", bunya_customer_quote_item_id: "quote-b" },
    { ...line, id: "order-a", bunya_customer_quote_item_id: "quote-a" },
  ], quotes);
  assert.equal(result.get("order-b").variant_label_snapshot, "Brand B");
  assert.equal(result.get("order-a").variant_label_snapshot, "Brand A");
});

test("missing explicit source never falls back to another product option", () => {
  assert.equal(match([{ ...line, id: "order", bunya_customer_quote_item_id: "absent" }], [quotes[0]]).size, 0);
});

test("legacy ambiguous options remain unresolved while unique matches still work", () => {
  assert.equal(match([{ ...line, id: "legacy" }], quotes).size, 0);
  assert.equal(match([{ ...line, id: "legacy" }], [quotes[0]]).get("legacy").variant_label_snapshot, "Brand A");
});
